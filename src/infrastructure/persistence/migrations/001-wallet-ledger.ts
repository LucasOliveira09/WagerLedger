import { Migration } from '@mikro-orm/migrations';

export class Migration001 extends Migration {
  override up(): void {
    this.addSql(`
      CREATE TABLE wallets (
        id uuid PRIMARY KEY, player_id uuid NOT NULL, currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        balance numeric(20,2) NOT NULL CHECK (balance >= 0 AND balance <= 999999999999999999.99),
        version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(player_id,currency), UNIQUE(id,currency)
      );
      CREATE TABLE wallet_ledger (
        id uuid PRIMARY KEY, wallet_id uuid NOT NULL, transaction_id uuid NOT NULL,
        currency varchar(3) NOT NULL, direction varchar(6) NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
        amount numeric(20,2) NOT NULL CHECK (amount > 0 AND amount <= 999999999999999999.99),
        balance_before numeric(20,2) NOT NULL CHECK (balance_before >= 0 AND balance_before <= 999999999999999999.99),
        balance_after numeric(20,2) NOT NULL CHECK (balance_after >= 0 AND balance_after <= 999999999999999999.99),
        sequence integer NOT NULL CHECK (sequence >= 1), created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(wallet_id,currency) REFERENCES wallets(id,currency),
        UNIQUE(wallet_id,transaction_id), UNIQUE(wallet_id,sequence),
        CHECK (balance_after = balance_before + CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
      );
      CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Ledger is immutable' USING ERRCODE = '23514'; END $$;
      CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
      CREATE FUNCTION assert_wallet_ledger_balance() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE target_id uuid; stored numeric; calculated numeric;
      BEGIN
        IF TG_TABLE_NAME = 'wallets' THEN target_id := NEW.id; ELSE target_id := NEW.wallet_id; END IF;
        SELECT balance INTO stored FROM wallets WHERE id = target_id;
        SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0) INTO calculated FROM wallet_ledger WHERE wallet_id = target_id;
        IF stored IS DISTINCT FROM calculated THEN RAISE EXCEPTION 'Wallet and ledger differ' USING ERRCODE = '23514'; END IF;
        RETURN NULL;
      END $$;
      CREATE CONSTRAINT TRIGGER wallet_balance_consistent AFTER INSERT OR UPDATE ON wallets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wallet_ledger_balance();
      CREATE CONSTRAINT TRIGGER ledger_balance_consistent AFTER INSERT ON wallet_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wallet_ledger_balance();
      CREATE FUNCTION enforce_wallet_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.version <> 1 THEN RAISE EXCEPTION 'Wallet starts at version 1' USING ERRCODE = '23514'; END IF;
        ELSE
          IF NEW.player_id <> OLD.player_id OR NEW.currency <> OLD.currency THEN RAISE EXCEPTION 'Wallet identity is immutable' USING ERRCODE = '23514'; END IF;
          IF NEW.balance <> OLD.balance THEN
            IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'Invalid wallet version' USING ERRCODE = '23514'; END IF;
          ELSE
            IF NEW.version <> OLD.version THEN RAISE EXCEPTION 'Unchanged balance requires unchanged version' USING ERRCODE = '23514'; END IF;
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER wallet_version BEFORE INSERT OR UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION enforce_wallet_version();
    `);
  }
  override down(): void {
    this.addSql('DROP TABLE wallet_ledger; DROP TABLE wallets; DROP FUNCTION enforce_wallet_version(); DROP FUNCTION assert_wallet_ledger_balance(); DROP FUNCTION forbid_ledger_mutation();');
  }
}
