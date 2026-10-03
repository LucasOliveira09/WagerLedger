import type { MikroORM } from '@mikro-orm/postgresql';
import type { RetryPendingReference } from '../../application/retry-pending-reference.js';

export class ReferenceWorker {
  constructor(private readonly orm: MikroORM, private readonly retry: RetryPendingReference) {}
  async tick(now = new Date()): Promise<number> {
    const candidates = await this.orm.em.fork().execute<{ id: string; wallet_id: string }[]>(
      "select id,wallet_id from wager_transactions where status='PENDING_REFERENCE' and (next_attempt_at is null or next_attempt_at<=?) order by created_at,id limit 100", [now]);
    let handled = 0;
    for (const candidate of candidates) if (await this.retry.execute(candidate.id, candidate.wallet_id, now)) handled++;
    return handled;
  }
}
