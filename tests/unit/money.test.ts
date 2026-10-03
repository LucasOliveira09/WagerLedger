import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money.js';

describe('Money', () => {
  test('soma centavos com exatidão e mantém os operandos imutáveis', () => {
    const first = Money.from({ amount: '0.10', currency: 'BRL' });
    expect(first.add(Money.from({ amount: '0.20', currency: 'BRL' })).toJSON()).toEqual({
      amount: '0.30',
      currency: 'BRL',
    });
    expect(first.toString()).toBe('0.10');
  });
  test('subtração e negação preservam diferença negativa interna', () => {
    const value = Money.from({ amount: '25.00', currency: 'BRL' });
    expect(Money.zero('BRL').subtract(value).toString()).toBe('-25.00');
    expect(value.negate().negate().equals(value)).toBe(true);
    expect(value.isPositive()).toBe(true);
    expect(value.negate().isNegative()).toBe(true);
    expect(Money.zero('BRL').isZero()).toBe(true);
  });
  test.each(['', 'NaN', 'Infinity', '1e2', '-1.00', '1.001', '1', '1.0', ' 1.00', '01.00'])(
    'rejeita entrada inválida %s sem arredondar',
    (amount) => {
      expect(() => Money.from({ amount, currency: 'BRL' })).toThrow();
    },
  );
  test('preserva valor acima da precisão segura de Number e rejeita overflow', () => {
    const value = Money.from({ amount: '999999999999999999.99', currency: 'BRL' });
    expect(value.toString()).toBe('999999999999999999.99');
    expect(() => value.add(Money.from({ amount: '0.01', currency: 'BRL' }))).toThrow();
  });
  test('operações entre moedas distintas falham', () => {
    const brl = Money.from({ amount: '1.00', currency: 'BRL' });
    const usd = Money.from({ amount: '1.00', currency: 'USD' });

    for (const operation of [
      () => brl.add(usd),
      () => brl.subtract(usd),
      () => brl.equals(usd),
      () => brl.isLessThan(usd),
    ]) {
      expect(operation).toThrow();
    }
  });
});
