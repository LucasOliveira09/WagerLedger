import { DomainError } from '../../domain/domain-error.js';
import { Money } from '../../domain/money.js';

export function objectInput(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('INVALID_PAYLOAD', 'Objeto JSON esperado.');
  }

  const record = input as Record<string, unknown>;

  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new DomainError('INVALID_PAYLOAD', 'Payload contém campos não permitidos.');
  }

  return record;
}

export function stringInput(value: unknown, name: string, max = 200): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  ) {
    throw new DomainError('INVALID_PAYLOAD', `Campo ${name} inválido.`);
  }

  return value;
}

export function uuidInput(value: unknown, name: string): string {
  const result = stringInput(value, name, 36);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new DomainError('INVALID_PAYLOAD', `Campo ${name} deve ser UUID.`);
  }

  return result.toLowerCase();
}

export function moneyInput(value: unknown) {
  const props = objectInput(value, ['amount', 'currency']);

  return Money.from({
    amount: stringInput(props.amount, 'amount', 21),
    currency: stringInput(props.currency, 'currency', 3),
  }).toJSON();
}

export function correlationInput(value: unknown): string {
  return value === undefined ? crypto.randomUUID() : stringInput(value, 'correlationId', 128);
}
