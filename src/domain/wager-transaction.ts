import { DomainError } from './domain-error.js';
import type { FailureCode } from './failure-code.js';
import type { Money } from './money.js';
import type { LedgerDirection } from './wallet-ledger-entry.js';

export type WagerKind = 'OPENING' | 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
export type WagerStatus = 'PENDING' | 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';
export interface CreateWagerProps {
  id: string; providerId: string; externalTransactionId: string; idempotencyKey: string;
  payloadHash: string; walletId: string; playerId: string; roundId: string; gameId: string;
  kind: WagerKind; money: Money; referenceExternalTransactionId?: string; createdAt?: Date;
}
export interface WagerState extends CreateWagerProps {
  status: WagerStatus; referenceTransactionId?: string; failureCode?: FailureCode; processedAt?: Date;
}

export class WagerTransaction {
  private _status: WagerStatus;
  private _referenceTransactionId: string | undefined;
  private _failureCode: FailureCode | undefined;
  private processedTimestamp: number | undefined;
  private readonly timestamp: number;
  private readonly props: Readonly<CreateWagerProps>;

  private constructor(state: WagerState) {
    this.props = Object.freeze({ ...state });
    this._status = state.status; this._referenceTransactionId = state.referenceTransactionId;
    this._failureCode = state.failureCode; this.processedTimestamp = state.processedAt?.getTime();
    this.timestamp = (state.createdAt ?? new Date()).getTime();
  }

  static create(props: CreateWagerProps): WagerTransaction {
    const provider = props.providerId;
    if (provider.length === 0 || provider.length > 100 || /[\u0000-\u001f]/.test(provider) || (props.kind === 'OPENING' ? provider !== '__internal__' : provider.startsWith('__'))) throw new DomainError('INVALID_PROVIDER', 'Identidade de provedor inválida ou reservada.');
    if ((props.kind === 'REFUND' || props.kind === 'ROLLBACK') && !props.referenceExternalTransactionId) throw new DomainError('INVALID_REFERENCE', 'Reversão exige referência externa.');
    if (props.money.isNegative() || (props.kind !== 'LOSS' && !props.money.isPositive())) throw new DomainError('INVALID_AMOUNT', 'Operação financeira exige valor positivo.');
    return new WagerTransaction({ ...props, status: 'PENDING' });
  }

  static rehydrate(state: WagerState): WagerTransaction { return new WagerTransaction(state); }
  get id() { return this.props.id; }
  get providerId() { return this.props.providerId; }
  get externalTransactionId() { return this.props.externalTransactionId; }
  get idempotencyKey() { return this.props.idempotencyKey; }
  get payloadHash() { return this.props.payloadHash; }
  get walletId() { return this.props.walletId; }
  get playerId() { return this.props.playerId; }
  get roundId() { return this.props.roundId; }
  get gameId() { return this.props.gameId; }
  get kind() { return this.props.kind; }
  get money() { return this.props.money; }
  get referenceExternalTransactionId() { return this.props.referenceExternalTransactionId; }
  get createdAt() { return new Date(this.timestamp); }
  get status() { return this._status; }
  get referenceTransactionId() { return this._referenceTransactionId; }
  get failureCode() { return this._failureCode; }
  get processedAt() { return this.processedTimestamp === undefined ? undefined : new Date(this.processedTimestamp); }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertMutable(); this._status = 'PROCESSED'; this._referenceTransactionId = referenceTransactionId; this.processedTimestamp = at.getTime();
  }
  markPendingReference(): void { this.assertMutable(); this._status = 'PENDING_REFERENCE'; }
  reject(code: FailureCode, at = new Date()): void { this.assertMutable(); this._status = 'REJECTED'; this._failureCode = code; this.processedTimestamp = at.getTime(); }
  fail(code: FailureCode, at = new Date()): void { this.assertMutable(); this._status = 'FAILED'; this._failureCode = code; this.processedTimestamp = at.getTime(); }
  isTerminal(): boolean { return ['PROCESSED', 'REJECTED', 'FAILED'].includes(this.status); }
  affectsBalance(): boolean { return this.kind !== 'LOSS'; }
  requiresReference(): boolean { return this.kind === 'REFUND' || this.kind === 'ROLLBACK'; }
  matchesPayload(hash: string): boolean { return this.payloadHash === hash; }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (this.kind === 'LOSS') throw new DomainError('INVALID_LEDGER', 'LOSS não gera lançamento.');
    if (this.kind === 'ROLLBACK') {
      if (!reference) throw new DomainError('INVALID_REFERENCE', 'Referência necessária.');
      return reference.kind === 'BET' ? 'CREDIT' : 'DEBIT';
    }
    return this.kind === 'BET' ? 'DEBIT' : 'CREDIT';
  }
  private assertMutable(): void {
    if (this.isTerminal()) throw new DomainError('INVALID_TRANSACTION_STATE', 'Estado terminal não pode ser alterado.');
  }
}
