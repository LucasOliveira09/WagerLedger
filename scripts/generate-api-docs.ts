import { createOpenApiDocument } from '../src/interfaces/http/swagger.js';
import { createPostmanCollection, createPostmanEnvironment } from './docs/postman-collection.js';

const artifacts = [
  ['openapi.json', createOpenApiDocument()],
  ['WagerLedger.postman_collection.json', createPostmanCollection()],
  ['WagerLedger.local.postman_environment.json', createPostmanEnvironment()],
] as const;

for (const [name, value] of artifacts) {
  await Bun.write(
    new URL(`../docs/${name}`, import.meta.url),
    JSON.stringify(value, null, 2) + '\n',
  );
  console.log(`Documentação gerada: docs/${name}`);
}
