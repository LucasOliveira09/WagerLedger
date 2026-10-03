import { IntegrationEvent } from './integration-event.js';
import { wagerEventProps } from './wager-event-data.js';
import type { EventContext, IntegrationEventProps } from './integration-event.js';
import type { WagerEventData } from './wager-event-data.js';
import type { WagerTransaction } from '../wager-transaction.js';
import type { Wallet } from '../wallet.js';

export class WagerTransactionRejected extends IntegrationEvent<WagerEventData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;
  private constructor(props: IntegrationEventProps<WagerEventData>) { super(props); Object.freeze(this); }
  static from(tx: WagerTransaction, wallet: Wallet, context: EventContext): WagerTransactionRejected {
    return new WagerTransactionRejected(wagerEventProps(tx, wallet, context, 'REJECTED'));
  }
}
