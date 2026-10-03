import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, ParameterObject, ResponseObject } from '@nestjs/swagger';
import { openApiSchemas, sampleIds, schemaRef, uuidSchema } from './openapi-schemas.js';

const correlation: ParameterObject = {
  name: 'X-Correlation-Id',
  in: 'header',
  required: false,
  description: 'Identificador para correlacionar logs/eventos. Se omitido, a API gera um UUID.',
  schema: { type: 'string', minLength: 1, maxLength: 128 },
  example: 'teste-local-001',
};
const pathId = (name: string): ParameterObject => ({
  name,
  in: 'path',
  required: true,
  schema: uuidSchema,
});
const jsonResponse = (schema: string, description: string, example?: unknown): ResponseObject => ({
  description,
  content: {
    'application/json': {
      schema: schemaRef(schema),
      ...(example === undefined ? {} : { example }),
    },
  },
});
const errorResponse = (code: string, description: string) =>
  jsonResponse('ErrorResponse', description, { error: { code, message: description } });
const invalid = errorResponse(
  'INVALID_PAYLOAD',
  'Contrato inválido: campos desconhecidos, UUID, Money, cursor ou parâmetro inválido.',
);
const unavailable = errorResponse(
  'INFRASTRUCTURE_UNAVAILABLE',
  'Dependência indisponível; tente novamente preservando a Idempotency-Key.',
);
const walletNotFound = errorResponse('WALLET_NOT_FOUND', 'Carteira inexistente.');
const transactionNotFound = errorResponse('TRANSACTION_NOT_FOUND', 'Transação inexistente.');
const queryErrors = { 400: invalid, 404: transactionNotFound, 503: unavailable };
const baseWager = {
  providerId: 'provider-demo',
  externalTransactionId: 'bet-001',
  walletId: sampleIds.walletId,
  playerId: sampleIds.playerId,
  roundId: 'round-001',
  gameId: 'game-001',
  kind: 'BET',
  money: { amount: '80.00', currency: 'BRL' },
};
const transactionResult = (status: string, balance: string, failureCode?: string) => ({
  transactionId: sampleIds.transactionId,
  status,
  balance: { amount: balance, currency: 'BRL' },
  idempotentReplay: false,
  ...(failureCode ? { failureCode } : {}),
});

export function createOpenApiDocument(): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('WagerLedger — API financeira')
    .setVersion('0.1.0')
    .setDescription(
      [
        'Backend de apostas com Money exato, ledger auditável, idempotência persistente e entrada HTTP/SQS.',
        '**Como testar:** crie uma carteira, copie seu id e playerId e submeta uma BET com Idempotency-Key. No Postman, use a collection e o roteiro em docs/TESTING.md.',
        '**Money:** valores são strings com duas casas, por exemplo "80.00". BET/WIN/REFUND/ROLLBACK exigem valor positivo; LOSS aceita zero e não movimenta saldo. OPENING é interno.',
        '**Idempotência:** a key é global. Mesmo payload/key reproduz código HTTP, status e saldo originais, alterando apenas idempotentReplay. Payload divergente ou mesma identidade externa com nova key retorna 409.',
        '**Referências:** REFUND/ROLLBACK exigem referência integral com mesmo provider, jogador, carteira, moeda e rodada. Referência ausente resulta em 202; inicie o worker e consulte o GET para acompanhar a resolução. Um replay continua mostrando o aceite original.',
        '**Autenticação:** esta entrega local não possui IdP. O providerId é declarado no payload e validado no domínio. Não há autenticação Bearer implementada.',
        '**SQS:** contratos HTTP abaixo. A collection exercita a API; o envio SQS e a recuperação de falhas são cobertos por bun run demo e pelas suites. MiniStack emula o SQS localmente.',
      ].join('\n\n'),
    )
    .addTag('Carteiras', 'Abertura, saldo, ledger e reconciliação.')
    .addTag('Transações', 'Submissão e consulta das operações financeiras.')
    .addTag('Operação', 'Liveness, readiness e métricas do processo.')
    .addServer(
      '/',
      'API que está servindo esta documentação; permite mudar a porta sem editar exemplos.',
    )
    .build();

  return {
    ...config,
    openapi: '3.0.3',
    security: [],
    components: { schemas: openApiSchemas },
    paths: {
      '/wallets': {
        post: {
          tags: ['Carteiras'],
          operationId: 'openWallet',
          summary: 'Criar carteira com saldo inicial auditável',
          description:
            'Carteira única por jogador/moeda. Saldo positivo gera OPENING, crédito no ledger e eventos no mesmo commit. Saldo zero cria a carteira sem lançamento. A criação não utiliza Idempotency-Key; repetição do jogador/moeda retorna 409.',
          parameters: [correlation],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: schemaRef('OpenWalletInput'),
                example: {
                  playerId: sampleIds.playerId,
                  initialBalance: { amount: '100.00', currency: 'BRL' },
                },
              },
            },
          },
          responses: {
            201: jsonResponse('Wallet', 'Carteira criada.', {
              id: sampleIds.walletId,
              playerId: sampleIds.playerId,
              balance: { amount: '100.00', currency: 'BRL' },
              version: 1,
            }),
            400: invalid,
            409: errorResponse('RESOURCE_CONFLICT', 'Já existe uma carteira para o jogador/moeda.'),
            503: unavailable,
          },
        },
      },
      '/wallets/{walletId}': {
        get: {
          tags: ['Carteiras'],
          operationId: 'getWallet',
          summary: 'Consultar saldo e versão atuais',
          parameters: [pathId('walletId')],
          responses: {
            200: jsonResponse('Wallet', 'Estado atual da carteira.'),
            400: invalid,
            404: walletNotFound,
            503: unavailable,
          },
        },
      },
      '/wallets/{walletId}/ledger': {
        get: {
          tags: ['Carteiras'],
          operationId: 'getWalletLedger',
          summary: 'Consultar ledger imutável com paginação estável',
          description:
            'Lançamentos em ordem crescente por sequência. A primeira página fixa a versão superior; novos lançamentos ficam para outra navegação. Use nextCursor sem modificá-lo; null indica fim. O cursor pertence à carteira consultada.',
          parameters: [
            pathId('walletId'),
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Tamanho da página.',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
              example: 2,
            },
            {
              name: 'cursor',
              in: 'query',
              required: false,
              description: 'Cursor retornado pela página anterior. Omita na primeira página.',
              schema: { type: 'string', minLength: 1, maxLength: 512 },
            },
          ],
          responses: {
            200: jsonResponse('LedgerPage', 'Página de lançamentos e cursor seguinte.'),
            400: invalid,
            404: walletNotFound,
            503: unavailable,
          },
        },
      },
      '/wallets/{walletId}/reconciliation': {
        post: {
          tags: ['Carteiras'],
          operationId: 'reconcileWallet',
          summary: 'Conferir saldo contra a soma do ledger',
          description:
            'Leitura em um snapshot SQL consistente; inclui OPENING. difference = storedBalance − calculatedBalance. Divergência gera log/métrica e consistent=false, sem corrigir saldo ou histórico. Não é necessário enviar body.',
          parameters: [pathId('walletId'), correlation],
          responses: {
            200: jsonResponse('Reconciliation', 'Resultado da comparação.', {
              walletId: sampleIds.walletId,
              storedBalance: { amount: '100.00', currency: 'BRL' },
              calculatedBalance: { amount: '100.00', currency: 'BRL' },
              checkedEntries: 1,
              difference: { amount: '0.00', currency: 'BRL' },
              consistent: true,
            }),
            400: invalid,
            404: walletNotFound,
            503: unavailable,
          },
        },
      },
      '/wagering/transactions': {
        post: {
          tags: ['Transações'],
          operationId: 'submitWager',
          summary: 'Processar BET, WIN, LOSS, REFUND ou ROLLBACK',
          description:
            'Confirma transação, saldo, ledger e outbox atomicamente. Key tem unicidade global; prefira prefixar com o provedor. Rejeição financeira retorna 422 com TransactionResult; entrada inválida retorna ErrorResponse. REFUND e ROLLBACK são únicos por referência e tipo, portanto podem coexistir sobre uma BET. Um ROLLBACK de WIN/REFUND sem saldo rejeita com REVERSAL_INSUFFICIENT_FUNDS.',
          parameters: [
            correlation,
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              description:
                'Identidade persistente do pedido. Reutilize em retries com o mesmo payload; uma nova key não substitui uma identidade externa já utilizada.',
              schema: { type: 'string', minLength: 1, maxLength: 256 },
              example: 'provider-demo:bet-001',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: schemaRef('WagerInput'),
                examples: {
                  BET: { summary: 'Aposta de 80.00', value: baseWager },
                  WIN: {
                    summary: 'Ganho de 20.00 referenciando a BET',
                    value: {
                      ...baseWager,
                      kind: 'WIN',
                      externalTransactionId: 'win-001',
                      money: { amount: '20.00', currency: 'BRL' },
                      referenceExternalTransactionId: 'bet-001',
                    },
                  },
                  LOSS: {
                    summary: 'Perda sem movimentação de saldo',
                    value: {
                      ...baseWager,
                      kind: 'LOSS',
                      externalTransactionId: 'loss-001',
                      money: { amount: '0.00', currency: 'BRL' },
                    },
                  },
                  REFUND: {
                    summary: 'Reembolso integral da BET',
                    value: {
                      ...baseWager,
                      kind: 'REFUND',
                      externalTransactionId: 'refund-001',
                      referenceExternalTransactionId: 'bet-001',
                    },
                  },
                  ROLLBACK: {
                    summary: 'Reversão integral do WIN',
                    value: {
                      ...baseWager,
                      kind: 'ROLLBACK',
                      externalTransactionId: 'rollback-001',
                      money: { amount: '20.00', currency: 'BRL' },
                      referenceExternalTransactionId: 'win-001',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: jsonResponse(
              'TransactionResult',
              'Processada ou replay de uma operação processada.',
              transactionResult('PROCESSED', '20.00'),
            ),
            202: jsonResponse(
              'TransactionResult',
              'Aceita aguardando referência; consulte o GET para obter o estado atual.',
              transactionResult('PENDING_REFERENCE', '100.00'),
            ),
            400: invalid,
            404: walletNotFound,
            409: errorResponse(
              'IDEMPOTENCY_CONFLICT',
              'Key usada com payload diferente. Também pode retornar EXTERNAL_TRANSACTION_CONFLICT para identidade externa já associada a outra key.',
            ),
            422: jsonResponse(
              'TransactionResult',
              'Rejeição de negócio persistida sem movimento financeiro.',
              transactionResult('REJECTED', '20.00', 'INSUFFICIENT_FUNDS'),
            ),
            503: {
              description:
                'Infraestrutura indisponível (ErrorResponse) ou replay de FAILED auditado na entrada SQS (TransactionResult). Um aceite anterior mantém seu snapshot 202 mesmo se o estado atual for FAILED.',
              content: {
                'application/json': {
                  schema: { oneOf: [schemaRef('ErrorResponse'), schemaRef('TransactionResult')] },
                  examples: {
                    unavailable: {
                      value: {
                        error: {
                          code: 'INFRASTRUCTURE_UNAVAILABLE',
                          message: 'Serviço temporariamente indisponível.',
                        },
                      },
                    },
                    auditedFailure: {
                      value: transactionResult(
                        'FAILED',
                        '100.00',
                        'INFRASTRUCTURE_PERMANENT_FAILURE',
                      ),
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/wagering/transactions/{transactionId}': {
        get: {
          tags: ['Transações'],
          operationId: 'getTransaction',
          summary: 'Consultar estado atual pelo ID interno',
          description:
            'Retorna o estado atual, incluindo resolução de pendências; não é o snapshot do POST.',
          parameters: [pathId('transactionId')],
          responses: { 200: jsonResponse('Transaction', 'Operação encontrada.'), ...queryErrors },
        },
      },
      '/providers/{providerId}/wagering/transactions/{externalTransactionId}': {
        get: {
          tags: ['Transações'],
          operationId: 'getExternalTransaction',
          summary: 'Consultar pela identidade externa do provedor',
          description:
            'Mesmo estado atual do GET por ID interno. Encode os identificadores ao construir a URL.',
          parameters: [
            {
              name: 'providerId',
              in: 'path',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 100 },
              example: 'provider-demo',
            },
            {
              name: 'externalTransactionId',
              in: 'path',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 200 },
              example: 'bet-001',
            },
          ],
          responses: { 200: jsonResponse('Transaction', 'Operação encontrada.'), ...queryErrors },
        },
      },
      '/health/live': {
        get: {
          tags: ['Operação'],
          operationId: 'liveness',
          summary: 'Verificar se o processo responde',
          description:
            'Aberto; não consulta PostgreSQL/SQS. Uma resposta 200 não garante que as dependências estejam disponíveis.',
          responses: {
            200: jsonResponse('Liveness', 'Processo respondendo.', { status: 'alive' }),
          },
        },
      },
      '/health/ready': {
        get: {
          tags: ['Operação'],
          operationId: 'readiness',
          summary: 'Verificar disponibilidade de PostgreSQL e SQS',
          description: 'Consulta SQL e as três filas com timeout. Não exige autenticação.',
          responses: {
            200: jsonResponse('Readiness', 'Dependências disponíveis.', {
              status: 'ready',
              postgres: true,
              sqs: true,
            }),
            503: jsonResponse('Readiness', 'Uma ou mais dependências indisponíveis.', {
              status: 'not_ready',
              postgres: false,
              sqs: true,
            }),
          },
        },
      },
      '/metrics': {
        get: {
          tags: ['Operação'],
          operationId: 'metrics',
          summary: 'Consultar métricas Prometheus deste processo',
          description:
            'Contadores, gauges e histogramas locais ao processo; reiniciam junto dele. Workers expõem métricas próprias quando METRICS_PORT é configurado. Séries surgem após uso dos fluxos instrumentados.',
          responses: {
            200: {
              description:
                'Métricas em texto. O processo recém-iniciado pode ainda não possuir séries.',
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                  example: 'transactions_total{status="PROCESSED"} 1\n',
                },
              },
            },
          },
        },
      },
    },
  };
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createOpenApiDocument(), {
    jsonDocumentUrl: 'docs/openapi.json',
    yamlDocumentUrl: 'docs/openapi.yaml',
    customSiteTitle: 'WagerLedger — documentação da API',
    swaggerOptions: { docExpansion: 'list', displayRequestDuration: true, validatorUrl: null },
  });
}
