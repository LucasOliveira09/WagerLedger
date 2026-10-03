import type { SchemaObject } from '@nestjs/swagger';

export const sampleIds = {
  walletId: '8f0b0467-8479-4d24-a4b5-06795d33cd19',
  playerId: '6f8486c3-9559-41b5-adbc-67f3e8b5a9ef',
  transactionId: 'e3dd1a78-2579-4474-82ae-34f924665102',
};
export const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
export const uuidSchema: SchemaObject = { type: 'string', format: 'uuid', example: sampleIds.walletId };
const text = (description: string, maxLength = 200, example?: string): SchemaObject => ({
  type: 'string', minLength: 1, maxLength, pattern: '^[^\\u0000-\\u001f]+$', description,
  ...(example === undefined ? {} : { example }),
});
const amount: SchemaObject = {
  type: 'string', pattern: '^(0|[1-9][0-9]{0,17})\\.[0-9]{2}$', maxLength: 21, example: '80.00',
  description: 'Decimal exato com duas casas; máximo 999999999999999999.99. Sem sinais, notação científica, arredondamento ou zeros extras à esquerda.',
};
const moneyProperties = {
  amount,
  currency: { type: 'string', minLength: 3, maxLength: 3, example: 'BRL', description: 'Código de moeda reconhecido pelo runtime Intl. Deve coincidir com a moeda da carteira; não há conversão cambial.' } satisfies SchemaObject,
};
const wagerProperties = {
  providerId: { ...text('Identidade declarada do provedor. Prefixo __ reservado para operações internas.', 100, 'provider-demo'), pattern: '^(?!__)[^\\u0000-\\u001f]+$' },
  externalTransactionId: text('Identidade única dentro do provedor. Nova key com a mesma identidade retorna conflito.', 200, 'bet-001'),
  walletId: { ...uuidSchema, description: 'ID da carteira criada em POST /wallets.' },
  playerId: { ...uuidSchema, example: sampleIds.playerId, description: 'Jogador proprietário da carteira.' },
  roundId: text('Rodada. Referências devem pertencer à mesma rodada.', 200, 'round-001'),
  gameId: text('Identificador do jogo.', 200, 'game-001'),
  referenceExternalTransactionId: text('ID externo da operação referenciada no mesmo provedor. Obrigatório para REFUND/ROLLBACK; opcional para WIN.', 200, 'bet-001'),
};
function wagerSchema(kind: string, description: string, requiresReference = false): SchemaObject {
  return {
    type: 'object', additionalProperties: false, description,
    required: ['providerId', 'externalTransactionId', 'walletId', 'playerId', 'roundId', 'gameId', 'kind', 'money', ...(requiresReference ? ['referenceExternalTransactionId'] : [])],
    properties: { ...wagerProperties, kind: { type: 'string', enum: [kind] }, money: schemaRef(kind === 'LOSS' ? 'Money' : 'PositiveMoney') },
  };
}
const statuses: SchemaObject = { type: 'string', enum: ['PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'] };
const failureCodes: SchemaObject = {
  type: 'string', enum: ['INSUFFICIENT_FUNDS', 'REVERSAL_INSUFFICIENT_FUNDS', 'CURRENCY_MISMATCH', 'WALLET_IDENTITY_MISMATCH',
    'REFERENCE_MISMATCH', 'REFERENCE_KIND_INVALID', 'REFERENCE_NOT_PROCESSED', 'REFERENCE_NOT_FOUND',
    'REVERSAL_ALREADY_APPLIED', 'AMOUNT_MISMATCH', 'AMOUNT_OUT_OF_RANGE', 'INFRASTRUCTURE_PERMANENT_FAILURE'],
  description: 'Motivo estável da rejeição/falha; presente apenas quando aplicável.',
};
export const openApiSchemas: Record<string, SchemaObject> = {
  Money: { type: 'object', additionalProperties: false, required: ['amount', 'currency'], properties: moneyProperties },
  PositiveMoney: { type: 'object', additionalProperties: false, required: ['amount', 'currency'], properties: { ...moneyProperties, amount: { ...amount, not: { enum: ['0.00'] } } } },
  SignedMoney: { type: 'object', additionalProperties: false, required: ['amount', 'currency'], properties: { ...moneyProperties, amount: { ...amount, pattern: '^-?(0|[1-9][0-9]{0,17})\\.[0-9]{2}$', maxLength: 22, description: 'Valor exato com sinal, utilizado na reconciliação. Não é aceito como entrada financeira.' } } },
  OpenWalletInput: {
    type: 'object', additionalProperties: false, required: ['playerId', 'initialBalance'],
    properties: { playerId: { ...uuidSchema, example: sampleIds.playerId }, initialBalance: schemaRef('Money') },
  },
  Wallet: {
    type: 'object', required: ['id', 'playerId', 'balance', 'version'],
    properties: { id: uuidSchema, playerId: { ...uuidSchema, example: sampleIds.playerId }, balance: schemaRef('Money'),
      version: { type: 'integer', minimum: 1, example: 2, description: 'Inicia em 1; incrementa quando o saldo muda. LOSS não incrementa.' } },
  },
  BetInput: wagerSchema('BET', 'Debita o valor da carteira. Saldo insuficiente gera REJECTED/INSUFFICIENT_FUNDS sem lançamento.'),
  WinInput: wagerSchema('WIN', 'Credita o valor. Uma referência opcional deve ser uma BET processada com vínculos compatíveis.'),
  LossInput: wagerSchema('LOSS', 'Registra a perda sem movimentar saldo, gerar ledger ou incrementar a versão. Aceita 0.00.'),
  RefundInput: wagerSchema('REFUND', 'Credita integralmente uma BET processada. No máximo um REFUND processado por referência.', true),
  RollbackInput: wagerSchema('ROLLBACK', 'Inverte integralmente BET, WIN ou REFUND. No máximo um ROLLBACK processado por referência. Débito sem saldo rejeita com REVERSAL_INSUFFICIENT_FUNDS.', true),
  WagerInput: {
    description: 'Escolha o tipo financeiro. Campos desconhecidos são rejeitados; OPENING é exclusivamente interno.',
    oneOf: ['BetInput', 'WinInput', 'LossInput', 'RefundInput', 'RollbackInput'].map(schemaRef),
    discriminator: { propertyName: 'kind', mapping: { BET: '#/components/schemas/BetInput', WIN: '#/components/schemas/WinInput', LOSS: '#/components/schemas/LossInput', REFUND: '#/components/schemas/RefundInput', ROLLBACK: '#/components/schemas/RollbackInput' } },
  },
  TransactionResult: {
    type: 'object', required: ['transactionId', 'status', 'balance', 'idempotentReplay'],
    properties: { transactionId: { ...uuidSchema, example: sampleIds.transactionId }, status: statuses, balance: schemaRef('Money'),
      idempotentReplay: { type: 'boolean', example: false, description: 'True em replay. Saldo, status e código HTTP preservam o resultado original.' }, failureCode: failureCodes },
  },
  Transaction: {
    type: 'object', required: ['id', 'providerId', 'externalTransactionId', 'walletId', 'playerId', 'roundId', 'gameId', 'kind', 'money', 'status', 'referenceExternalTransactionId', 'referenceTransactionId', 'failureCode', 'createdAt', 'processedAt'],
    properties: { id: { ...uuidSchema, example: sampleIds.transactionId }, ...wagerProperties,
      providerId: text('Identidade do provedor; OPENING utiliza o provedor interno reservado __internal__.', 100, 'provider-demo'),
      kind: { type: 'string', enum: ['OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'] }, money: schemaRef('Money'), status: statuses,
      referenceExternalTransactionId: { type: 'string', nullable: true }, referenceTransactionId: { ...uuidSchema, nullable: true },
      failureCode: { ...failureCodes, enum: [...failureCodes.enum!, null], nullable: true }, createdAt: { type: 'string', format: 'date-time' }, processedAt: { type: 'string', format: 'date-time', nullable: true } },
  },
  LedgerEntry: {
    type: 'object', required: ['id', 'walletId', 'transactionId', 'direction', 'money', 'balanceBefore', 'balanceAfter', 'sequence', 'createdAt'],
    properties: { id: uuidSchema, walletId: uuidSchema, transactionId: { ...uuidSchema, example: sampleIds.transactionId },
      direction: { type: 'string', enum: ['CREDIT', 'DEBIT'] }, money: schemaRef('PositiveMoney'), balanceBefore: schemaRef('Money'), balanceAfter: schemaRef('Money'),
      sequence: { type: 'integer', minimum: 1, example: 2 }, createdAt: { type: 'string', format: 'date-time' } },
  },
  LedgerPage: {
    type: 'object', required: ['entries', 'nextCursor'],
    properties: { entries: { type: 'array', items: schemaRef('LedgerEntry') }, nextCursor: { type: 'string', nullable: true, description: 'Cursor opaco para a próxima página. Null indica fim dessa navegação.' } },
  },
  Reconciliation: {
    type: 'object', required: ['walletId', 'storedBalance', 'calculatedBalance', 'checkedEntries', 'difference', 'consistent'],
    properties: { walletId: uuidSchema, storedBalance: schemaRef('Money'), calculatedBalance: schemaRef('SignedMoney'),
      checkedEntries: { type: 'integer', minimum: 0 }, difference: schemaRef('SignedMoney'),
      consistent: { type: 'boolean', description: 'Saldo armazenado igual à soma assinada do ledger, incluindo abertura. Divergências não são corrigidas automaticamente.' } },
  },
  ErrorResponse: {
    type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message'],
      properties: { code: { type: 'string', example: 'INVALID_PAYLOAD' }, message: { type: 'string', example: 'Payload contém campos não permitidos.' } } } },
  },
  Liveness: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['alive'] } } },
  Readiness: { type: 'object', required: ['status', 'postgres', 'sqs'], properties: { status: { type: 'string', enum: ['ready', 'not_ready'] }, postgres: { type: 'boolean' }, sqs: { type: 'boolean' } } },
};
