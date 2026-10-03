import { Migration } from '@mikro-orm/migrations';

export class Migration002 extends Migration {
  override up(): void {
    this.addSql(`
      CREATE TABLE wager_transactions (
        id uuid PRIMARY KEY, provider_id varchar(100) NOT NULL, external_transaction_id varchar(200) NOT NULL,
        idempotency_key varchar(256) NOT NULL UNIQUE, payload_hash varchar(64) NOT NULL,
        wallet_id uuid NOT NULL REFERENCES wallets(id), player_id uuid NOT NULL,
        round_id varchar(200) NOT NULL, game_id varchar(200) NOT NULL,
        kind varchar(8) NOT NULL CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        amount numeric(20,2) NOT NULL CHECK (amount >= 0 AND amount <= 999999999999999999.99),
        currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        status varchar(20) NOT NULL CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        reference_external_transaction_id varchar(200), reference_transaction_id uuid REFERENCES wager_transactions(id),
        failure_code varchar(64), processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        response_snapshot jsonb, reference_attempts integer NOT NULL DEFAULT 0 CHECK(reference_attempts >= 0), next_attempt_at timestamptz,
        CHECK (kind = 'LOSS' OR amount > 0),
        CHECK (kind NOT IN ('REFUND','ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
        CHECK (status NOT IN ('REJECTED','FAILED') OR failure_code IS NOT NULL),
        CHECK (kind <> 'OPENING' OR provider_id = '__internal__'),
        UNIQUE(provider_id,external_transaction_id), UNIQUE(id,wallet_id,currency)
      );
      ALTER TABLE wallet_ledger ADD CONSTRAINT ledger_transaction_fk FOREIGN KEY(transaction_id,wallet_id,currency) REFERENCES wager_transactions(id,wallet_id,currency);
      CREATE UNIQUE INDEX reversal_once ON wager_transactions(reference_transaction_id,kind) WHERE kind IN ('REFUND','ROLLBACK') AND status = 'PROCESSED';
      CREATE INDEX references_due ON wager_transactions(next_attempt_at,id) WHERE status = 'PENDING_REFERENCE';
      CREATE TABLE inbox_messages (
        message_id varchar(200) NOT NULL, consumer_name varchar(100) NOT NULL, payload_hash varchar(64) NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
        PRIMARY KEY(consumer_name,message_id)
      );
      CREATE TABLE outbox_messages (
        id uuid PRIMARY KEY, aggregate_id uuid NOT NULL, event_type varchar(100) NOT NULL, payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        next_attempt_at timestamptz, published_at timestamptz,
        CHECK (payload->>'eventId' = id::text)
      );
      CREATE INDEX outbox_due ON outbox_messages(next_attempt_at,occurred_at,id) WHERE published_at IS NULL;
      CREATE FUNCTION protect_transaction_state() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status IN ('PROCESSED','REJECTED','FAILED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal transaction is immutable' USING ERRCODE = '23514'; END IF;
        IF OLD.response_snapshot IS NOT NULL AND NEW.response_snapshot IS DISTINCT FROM OLD.response_snapshot THEN RAISE EXCEPTION 'Replay snapshot is immutable' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER terminal_transaction BEFORE UPDATE ON wager_transactions FOR EACH ROW EXECUTE FUNCTION protect_transaction_state();
      CREATE FUNCTION assert_transaction_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE current_tx wager_transactions; entries integer; actual_amount numeric;
      BEGIN
        SELECT * INTO current_tx FROM wager_transactions WHERE id = NEW.id;
        SELECT count(*), min(amount) INTO entries,actual_amount FROM wallet_ledger WHERE transaction_id = current_tx.id;
        IF current_tx.status = 'PROCESSED' AND current_tx.kind <> 'LOSS' THEN
          IF entries <> 1 OR actual_amount <> current_tx.amount THEN RAISE EXCEPTION 'Processed transaction requires matching ledger' USING ERRCODE = '23514'; END IF;
        ELSE
          IF entries <> 0 THEN RAISE EXCEPTION 'Nonfinancial transaction cannot have ledger' USING ERRCODE = '23514'; END IF;
        END IF;
        RETURN NULL;
      END $$;
      CREATE CONSTRAINT TRIGGER transaction_ledger_consistent AFTER INSERT OR UPDATE ON wager_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_transaction_ledger();
      DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'wagerledger_app') THEN
          CREATE ROLE wagerledger_app LOGIN PASSWORD 'local-development-only';
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO wagerledger_app;
      GRANT SELECT,INSERT,UPDATE ON wallets,wager_transactions,inbox_messages,outbox_messages TO wagerledger_app;
      GRANT SELECT,INSERT ON wallet_ledger TO wagerledger_app;
    `);
  }
  override down(): void {
    this.addSql(`ALTER TABLE wallet_ledger DROP CONSTRAINT ledger_transaction_fk;
      DROP TABLE outbox_messages; DROP TABLE inbox_messages; DROP TABLE wager_transactions;
      DROP FUNCTION protect_transaction_state(); DROP FUNCTION assert_transaction_ledger();`);
  }
}
