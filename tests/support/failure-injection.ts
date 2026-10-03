import type {
  FinancialSession,
  FinancialUnitOfWork,
} from '../../src/application/ports/financial-unit-of-work.js';

export function failAfterWrite(
  uow: FinancialUnitOfWork,
  method: Exclude<keyof FinancialSession, 'wallet'>,
  error: Error,
  failures = Infinity,
): FinancialUnitOfWork {
  return {
    run: (walletId, operation) =>
      uow.run(walletId, (session) =>
        operation(
          new Proxy(session, {
            get(target, property) {
              if (property === method) {
                return async (...args: unknown[]) => {
                  const original = Reflect.get(target, property) as (
                    ...args: unknown[]
                  ) => Promise<unknown>;
                  const result = await original.apply(target, args);

                  if (failures > 0) {
                    failures--;
                    throw error;
                  }

                  return result;
                };
              }

              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
        ),
      ),
  };
}
