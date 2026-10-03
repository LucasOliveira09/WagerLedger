import { Migration } from '@mikro-orm/migrations';

export class Migration003 extends Migration {
  override up(): void {
    // Defesa para gravações SQL que contornem o domínio: valida identidade, referência,
    // direção, valor e quantidade de lançamentos das operações financeiras processadas.
    // Também preserva a solicitação original e o envelope da outbox durante atualizações.
    this.addSql(`
      CREATE FUNCTION assert_financial_operation() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE target_id uuid; current_tx wager_transactions; reference_tx wager_transactions;
        current_wallet wallets; entries integer; actual_amount numeric; actual_direction text; expected_direction text;
      BEGIN
        IF TG_TABLE_NAME = 'wallet_ledger' THEN target_id := NEW.transaction_id; ELSE target_id := NEW.id; END IF;
        SELECT * INTO current_tx FROM wager_transactions WHERE id=target_id;
        SELECT count(*),min(amount),min(direction) INTO entries,actual_amount,actual_direction FROM wallet_ledger WHERE transaction_id=target_id;
        IF current_tx.status <> 'PROCESSED' OR current_tx.kind = 'LOSS' THEN
          IF entries <> 0 THEN RAISE EXCEPTION 'Nonfinancial transaction cannot have ledger' USING ERRCODE='23514'; END IF;
          RETURN NULL;
        END IF;
        SELECT * INTO current_wallet FROM wallets WHERE id=current_tx.wallet_id;
        IF current_tx.player_id <> current_wallet.player_id OR current_tx.currency <> current_wallet.currency THEN RAISE EXCEPTION 'Processed transaction identity mismatch' USING ERRCODE='23514'; END IF;
        expected_direction := CASE WHEN current_tx.kind='BET' THEN 'DEBIT' ELSE 'CREDIT' END;
        IF current_tx.kind IN ('REFUND','ROLLBACK') OR current_tx.reference_external_transaction_id IS NOT NULL THEN
          SELECT * INTO reference_tx FROM wager_transactions WHERE id=current_tx.reference_transaction_id;
          IF reference_tx.id IS NULL OR reference_tx.status <> 'PROCESSED' OR reference_tx.provider_id <> current_tx.provider_id OR reference_tx.external_transaction_id <> current_tx.reference_external_transaction_id OR reference_tx.player_id <> current_tx.player_id OR reference_tx.wallet_id <> current_tx.wallet_id OR reference_tx.currency <> current_tx.currency OR reference_tx.round_id <> current_tx.round_id THEN RAISE EXCEPTION 'Invalid processed reference' USING ERRCODE='23514'; END IF;
          IF (current_tx.kind='ROLLBACK' AND reference_tx.kind NOT IN ('BET','WIN','REFUND')) OR (current_tx.kind<>'ROLLBACK' AND reference_tx.kind<>'BET') THEN RAISE EXCEPTION 'Invalid reference kind' USING ERRCODE='23514'; END IF;
          IF current_tx.kind IN ('REFUND','ROLLBACK') AND current_tx.amount <> reference_tx.amount THEN RAISE EXCEPTION 'Reversal amount mismatch' USING ERRCODE='23514'; END IF;
          IF current_tx.kind='ROLLBACK' THEN expected_direction := CASE WHEN reference_tx.kind='BET' THEN 'CREDIT' ELSE 'DEBIT' END; END IF;
        END IF;
        IF entries <> 1 OR actual_amount <> current_tx.amount OR actual_direction <> expected_direction THEN RAISE EXCEPTION 'Financial ledger mismatch' USING ERRCODE='23514'; END IF;
        RETURN NULL;
      END $$;
      CREATE CONSTRAINT TRIGGER financial_operation_consistent AFTER INSERT OR UPDATE ON wager_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_financial_operation();
      CREATE CONSTRAINT TRIGGER ledger_operation_consistent AFTER INSERT ON wallet_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_financial_operation();
      CREATE FUNCTION protect_transaction_request() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ROW(NEW.id,NEW.provider_id,NEW.external_transaction_id,NEW.idempotency_key,NEW.payload_hash,NEW.wallet_id,NEW.player_id,NEW.round_id,NEW.game_id,NEW.kind,NEW.amount,NEW.currency,NEW.reference_external_transaction_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.provider_id,OLD.external_transaction_id,OLD.idempotency_key,OLD.payload_hash,OLD.wallet_id,OLD.player_id,OLD.round_id,OLD.game_id,OLD.kind,OLD.amount,OLD.currency,OLD.reference_external_transaction_id,OLD.created_at) THEN RAISE EXCEPTION 'Transaction request is immutable' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER transaction_request_immutable BEFORE UPDATE ON wager_transactions FOR EACH ROW EXECUTE FUNCTION protect_transaction_request();
      CREATE FUNCTION protect_outbox_payload() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ROW(NEW.id,NEW.aggregate_id,NEW.event_type,NEW.payload,NEW.occurred_at) IS DISTINCT FROM ROW(OLD.id,OLD.aggregate_id,OLD.event_type,OLD.payload,OLD.occurred_at) OR (OLD.published_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'Outbox event is immutable' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER outbox_payload_immutable BEFORE UPDATE ON outbox_messages FOR EACH ROW EXECUTE FUNCTION protect_outbox_payload();
      ALTER TABLE outbox_messages ADD CONSTRAINT outbox_envelope CHECK (payload ?& ARRAY['eventId','eventType','aggregateId','correlationId','occurredAt','version','data'] AND payload->>'eventType'=event_type AND payload->>'aggregateId'=aggregate_id::text);
    `);
  }

  override down(): void {
    this.addSql(`ALTER TABLE outbox_messages DROP CONSTRAINT outbox_envelope;
      DROP TRIGGER outbox_payload_immutable ON outbox_messages; DROP FUNCTION protect_outbox_payload();
      DROP TRIGGER transaction_request_immutable ON wager_transactions; DROP FUNCTION protect_transaction_request();
      DROP TRIGGER ledger_operation_consistent ON wallet_ledger;
      DROP TRIGGER financial_operation_consistent ON wager_transactions; DROP FUNCTION assert_financial_operation();`);
  }
}
