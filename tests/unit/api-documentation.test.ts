import { expect, test } from 'bun:test';
import { createOpenApiDocument } from '../../src/interfaces/http/swagger.js';
import { createPostmanCollection, createPostmanEnvironment } from '../../scripts/docs/postman-collection.js';
import { parseWager } from '../../src/interfaces/contracts/wager.dto.js';
import { WagerTransaction } from '../../src/domain/wager-transaction.js';
import { Money } from '../../src/domain/money.js';

test('exemplos dos cinco tipos no Swagger passam pela validação real da entrada', () => {
  const operation = createOpenApiDocument().paths['/wagering/transactions']!.post!;
  const body = operation.requestBody;
  if (!body || '$ref' in body) throw new Error('Request body documentado ausente.');
  const examples = body.content['application/json']!.examples!;
  expect(Object.keys(examples).sort()).toEqual(['BET', 'LOSS', 'REFUND', 'ROLLBACK', 'WIN']);
  for (const example of Object.values(examples)) {
    if ('$ref' in example) throw new Error('Exemplo deve ser executável.');
    const parsed = parseWager(example.value);
    expect(() => WagerTransaction.create({ ...parsed, id: crypto.randomUUID(), money: Money.from(parsed.money),
      idempotencyKey: 'swagger-example', payloadHash: 'example' })).not.toThrow();
  }
});

test('documentos versionados permanecem atualizados e collection cobre os endpoints HTTP', async () => {
  const document = createOpenApiDocument();
  const collection = createPostmanCollection();
  const artifacts = [
    ['openapi.json', document], ['WagerLedger.postman_collection.json', collection],
    ['WagerLedger.local.postman_environment.json', createPostmanEnvironment()],
  ] as const;
  for (const [name, expected] of artifacts) {
    expect(await Bun.file(new URL(`../../docs/${name}`, import.meta.url)).json()).toEqual(expected);
  }
  const requests = collection.item.flatMap(folder => folder.item);
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const method of ['get', 'post'] as const) {
      if (!operations[method]) continue;
      expect(requests.some(item => item.request.method === method.toUpperCase() &&
        item.request.url.replace('{{baseUrl}}', '').split('?')[0]!.replace(/\{\{([^}]+)\}\}/g, '{$1}')
          .replace(/bet-\{runId\}/g, '{externalTransactionId}') === path)).toBe(true);
    }
  }
});
