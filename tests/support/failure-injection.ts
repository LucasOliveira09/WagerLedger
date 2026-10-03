import type { FinancialSession, FinancialUnitOfWork } from '../../src/application/ports/financial-unit-of-work.js';

export function failAfterWrite(uow: FinancialUnitOfWork, method: Exclude<keyof FinancialSession, 'wallet'>, error: Error): FinancialUnitOfWork {
  return { run: (walletId, operation) => uow.run(walletId, session => operation(new Proxy(session, { get(target, property) {
    if (property === method) return async (...args: unknown[]) => {
      const original = Reflect.get(target, property) as (...args: unknown[]) => Promise<unknown>;
      await original.apply(target, args); throw error;
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } }))) };
}
