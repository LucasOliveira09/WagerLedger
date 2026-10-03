import { Money } from '../domain/money.js';
import { DomainError } from '../domain/domain-error.js';
import type { FinancialReadStore } from './ports/financial-read-store.js';
import type { Telemetry } from './ports/telemetry.js';
import type { EventContext } from '../domain/events/integration-event.js';

export class ReconcileWallet {
  constructor(
    private readonly store: FinancialReadStore,
    private readonly telemetry: Telemetry,
  ) {}

  async execute(walletId: string, context: EventContext) {
    const snapshot = await this.store.reconciliation(walletId);

    if (!snapshot) {
      throw new DomainError('WALLET_NOT_FOUND', 'Carteira inexistente.');
    }

    // Diferença assinada = saldo armazenado - soma do ledger. Detectar divergência
    // não autoriza corrigir saldo ou reescrever histórico; este caso de uso só consulta.
    const difference = Money.rehydrate(snapshot.storedBalance).subtract(
      Money.rehydrate(snapshot.calculatedBalance),
    );
    const consistent = difference.isZero();

    if (!consistent) {
      this.telemetry.count('reconciliation_divergences_total');
      this.telemetry.log('error', 'reconciliation_diverged', {
        walletId,
        correlationId: context.correlationId,
      });
    }

    return { walletId, ...snapshot, difference: difference.toJSON(), consistent };
  }
}
