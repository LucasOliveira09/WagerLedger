import { DomainError } from './domain-error.js';

export interface MoneyProps { amount: string; currency: string }

const MAX_CENTS = 99999999999999999999n;
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

export class Money {
  private constructor(private readonly cents: bigint, public readonly currency: string) {
    if (cents > MAX_CENTS || cents < -MAX_CENTS) throw new DomainError('AMOUNT_OUT_OF_RANGE', 'Valor excede o limite monetário.');
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    if (typeof props?.amount !== 'string' || !/^(0|[1-9]\d*)\.\d{2}$/.test(props.amount)) {
      throw new DomainError('INVALID_MONEY', 'Valor deve ser uma string decimal não negativa com duas casas.');
    }
    if (props.amount.length > 21) throw new DomainError('AMOUNT_OUT_OF_RANGE', 'Valor excede o limite monetário.');
    if (!CURRENCIES.has(props.currency)) throw new DomainError('INVALID_CURRENCY', 'Moeda inválida.');
    return new Money(BigInt(props.amount.replace('.', '')), props.currency);
  }

  static rehydrate(props: MoneyProps): Money {
    return new Money(BigInt(props.amount.replace('.', '')), props.currency);
  }

  static zero(currency: string): Money { return Money.from({ amount: '0.00', currency }); }
  add(other: Money): Money { this.assertSameCurrency(other); return new Money(this.cents + other.cents, this.currency); }
  subtract(other: Money): Money { this.assertSameCurrency(other); return new Money(this.cents - other.cents, this.currency); }
  negate(): Money { return new Money(-this.cents, this.currency); }
  isZero(): boolean { return this.cents === 0n; }
  isPositive(): boolean { return this.cents > 0n; }
  isNegative(): boolean { return this.cents < 0n; }
  isLessThan(other: Money): boolean { this.assertSameCurrency(other); return this.cents < other.cents; }
  equals(other: Money): boolean { this.assertSameCurrency(other); return this.cents === other.cents; }
  toJSON(): MoneyProps { return { amount: this.toString(), currency: this.currency }; }

  toString(): string {
    const absolute = this.cents < 0n ? -this.cents : this.cents;
    return `${this.cents < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) throw new DomainError('CURRENCY_MISMATCH', 'Operações exigem a mesma moeda.');
  }
}
