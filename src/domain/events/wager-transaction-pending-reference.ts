import { IntegrationEvent } from './integration-event.js';
import { wagerEventProps } from './wager-event-data.js';
import type { EventContext, IntegrationEventProps } from './integration-event.js';
import type { WagerEventData } from './wager-event-data.js';
import type { WagerTransaction } from '../wager-transaction.js';
import type { Wallet } from '../wallet.js';

export class WagerTransactionPendingReference extends IntegrationEvent<WagerEventData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerEventData>) {
    super(props);
    Object.freeze(this);
  }

  static from(
    tx: WagerTransaction,
    wallet: Wallet,
    context: EventContext,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(
      wagerEventProps(tx, wallet, context, 'PENDING_REFERENCE'),
    );
  }
}
