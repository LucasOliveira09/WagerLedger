import { createHash } from 'node:crypto';

// Ordena chaves recursivamente para JSONs com a mesma informação produzirem o mesmo hash.
// A ordem de arrays continua significativa; propriedades undefined são omitidas.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }

  return value;
}

export function payloadHash(payload: object): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');
}
