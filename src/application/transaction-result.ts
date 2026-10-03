import type { MoneyProps } from '../domain/money.js';
import type { WagerStatus } from '../domain/wager-transaction.js';
import type { FailureCode } from '../domain/failure-code.js';

export interface TransactionResult {
  transactionId: string; status: WagerStatus; balance: MoneyProps;
  idempotentReplay: boolean; failureCode?: FailureCode;
}
export interface SubmissionResult { statusCode: number; body: TransactionResult; currentStatus?: WagerStatus }
