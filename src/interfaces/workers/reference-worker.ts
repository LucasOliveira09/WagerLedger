import type { MikroORM } from '@mikro-orm/postgresql';
import type { RetryPendingReference } from '../../application/retry-pending-reference.js';

export class ReferenceWorker {
  private stopping = false;
  constructor(private readonly orm: MikroORM, private readonly retry: RetryPendingReference) {}
  requestStop(): void { this.stopping = true; }
  async tick(now = new Date()): Promise<number> {
    // Esta varredura não reserva operações. RetryPendingReference obtém o lock da
    // carteira e relê a transação, tornando seguro haver vários workers de referências.
    const candidates = await this.orm.em.fork().execute<{ id: string; wallet_id: string }[]>(
      "select id,wallet_id from wager_transactions where status='PENDING_REFERENCE' and (next_attempt_at is null or next_attempt_at<=?) order by created_at,id limit 100", [now]);
    let handled = 0;
    for (const candidate of candidates) {
      if (this.stopping) break;
      if (await this.retry.execute(candidate.id, candidate.wallet_id, now)) handled++;
    }
    return handled;
  }
}
