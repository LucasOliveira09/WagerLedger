import { defineEntity, p } from '@mikro-orm/core';
import { Money } from '../../domain/money.js';
import { Wallet } from '../../domain/wallet.js';
import type { InferEntity } from '@mikro-orm/core';

export const WalletRecord = defineEntity({
  name: 'WalletRecord', tableName: 'wallets',
  properties: {
    id: p.uuid().primary(), playerId: p.uuid().fieldName('player_id'), currency: p.string(),
    balance: p.decimal('string').precision(20).scale(2), version: p.integer(),
    createdAt: p.datetime().fieldName('created_at'), updatedAt: p.datetime().fieldName('updated_at'),
  },
});
export type WalletRecordType = InferEntity<typeof WalletRecord>;
export function rehydrateWallet(record: WalletRecordType): Wallet {
  return Wallet.rehydrate({ ...record, balance: Money.rehydrate({ amount: record.balance, currency: record.currency }) });
}
