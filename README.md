# WagerLedger

Backend financeiro de apostas com entrada HTTP e SQS, dinheiro exato,
idempotência persistente e ledger auditável. Processa BET, WIN, LOSS, REFUND
e ROLLBACK, inclusive com mensagens duplicadas, referências fora de ordem
e múltiplos processos concorrentes.

Saldo, transação, lançamento, inbox e outbox são confirmados na mesma transação
PostgreSQL. Os testes incluem três workers em processos reais, morte após commit
antes do ack e recuperação da publicação de eventos.

## Stack

- Bun **1.4.2**, TypeScript **5.9.3** em modo estrito e NestJS **12.1.2**.
- MikroORM **7.2.3** com PostgreSQL **18**.
- AWS SDK SQS e MiniStack **1.5.18** no ambiente local.
- Docker Compose com imagens fixadas por digest e dependências com lockfile.

## Executar localmente

Pré-requisitos: Git, Bun 1.4.2 e Docker com Compose. Execute os comandos na raiz
do repositório; as portas locais utilizadas são 3000, 55432 e 14566.

```sh
git clone https://github.com/LucasOliveira09/WagerLedger.git
cd WagerLedger
bun install --frozen-lockfile
```

Copie `.env.example` para `.env`. No PowerShell:

```powershell
Copy-Item .env.example .env
```

Em shells Unix, use `cp .env.example .env`. Bun carrega esse arquivo
automaticamente. Os valores fornecidos são exclusivos do ambiente local.

```sh
docker compose up -d --wait
bun run migration:up
bun run queues:init
bun run start:api
```

Em outro terminal, na mesma pasta:

```sh
bun run start:worker
```

O worker executa consumidor, publisher e resolução de referências. Para dividir
papéis, configure `WORKER_ROLES=consumer`, `publisher` ou `reference`, ou uma
lista separada por vírgulas. É possível iniciar várias instâncias. Para expor
health e métricas de um worker, defina `METRICS_PORT` com uma porta livre por
processo, por exemplo 3001. Na API, esses endpoints usam a própria porta HTTP.

A migration utiliza `MIGRATION_DATABASE_URL`, com o dono do schema. A aplicação
utiliza `DATABASE_URL`, com a role limitada `wagerledger_app`. O setup local cria
essa role nas migrations. O banco persiste em volume Docker; as filas devem ser
inicializadas novamente quando o emulador for recriado.

## Demonstração

Com API e worker ativos, execute em um terceiro terminal:

```sh
bun run demo
```

O script cria uma carteira nova com 100.00 BRL, aplica uma BET de 80.00, repete
a mesma operação e rejeita outra BET de 80.00 por saldo insuficiente. Em seguida,
exercita WIN, LOSS, REFUND, ROLLBACK, REFUND antes da BET e uma LOSS via SQS.
Confere os resultados e termina com **100.00 BRL, sete lançamentos e diferença
de reconciliação 0.00**. Os dados da demonstração permanecem no histórico;
cada execução usa identificadores novos. `API_URL` permite mudar o destino HTTP.

## API HTTP

Documentação interativa: [http://localhost:3000/docs](http://localhost:3000/docs),
com a API ativa. A collection Postman, o ambiente local e o OpenAPI versionado
estão em `docs/`. Siga o [guia de testes manuais](docs/TESTING.md) para importar
a collection, executar os cenários e conferir os saldos esperados.

| Método | Endpoint | Resultado |
| --- | --- | --- |
| POST | `/wallets` | Cria carteira por jogador e moeda |
| GET | `/wallets/:walletId` | Saldo e versão atuais |
| GET | `/wallets/:walletId/ledger?limit=50&cursor=...` | Ledger paginado |
| POST | `/wallets/:walletId/reconciliation` | Compara saldo armazenado e ledger |
| POST | `/wagering/transactions` | Submete operação financeira |
| GET | `/wagering/transactions/:transactionId` | Estado atual pelo ID interno |
| GET | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Estado atual pela identidade externa |
| GET | `/health/live` | Processo respondendo |
| GET | `/health/ready` | PostgreSQL e filas SQS acessíveis |
| GET | `/metrics` | Métricas em formato Prometheus |

Criação de carteira, com UUID de jogador:

```json
{
  "playerId": "6f8486c3-9559-41b5-adbc-67f3e8b5a9ef",
  "initialBalance": { "amount": "100.00", "currency": "BRL" }
}
```

Submissão: envie `Content-Type: application/json` e o header obrigatório
`Idempotency-Key`, por exemplo `provider-demo:bet-001`. Use o `walletId` retornado
pela criação. `X-Correlation-Id` é opcional.

```json
{
  "providerId": "provider-demo",
  "externalTransactionId": "bet-001",
  "walletId": "<UUID retornado pela criação>",
  "playerId": "6f8486c3-9559-41b5-adbc-67f3e8b5a9ef",
  "roundId": "round-001",
  "gameId": "game-001",
  "kind": "BET",
  "money": { "amount": "80.00", "currency": "BRL" }
}
```

Uma submissão processada retorna:

```json
{
  "transactionId": "<UUID da operação>",
  "status": "PROCESSED",
  "balance": { "amount": "20.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

| HTTP | Significado |
| --- | --- |
| 201 | Carteira criada |
| 200 | Operação processada, consulta ou reconciliação concluída |
| 202 | Operação aceita aguardando referência |
| 400 | Contrato inválido, campo desconhecido ou header obrigatório ausente |
| 404 | Carteira ou transação inexistente |
| 409 | Carteira duplicada, key divergente ou identidade externa já usada |
| 422 | Rejeição financeira persistida, com `failureCode` |
| 503 | Infraestrutura indisponível ou replay de falha permanente auditada |

Money exige uma string decimal com exatamente duas casas, sem arredondamento,
como `"80.00"`. BET/WIN/REFUND/ROLLBACK exigem valor positivo; LOSS aceita zero
e não movimenta saldo. OPENING é interno e somente existe com saldo inicial
positivo. O limite de valor é 999999999999999999.99.

REFUND exige `referenceExternalTransactionId` de uma BET. ROLLBACK referencia
BET, WIN ou REFUND e inverte seu efeito. As reversões exigem o valor integral
e os mesmos provider, jogador, carteira, moeda e rodada. WIN pode omitir
referência; quando presente, ela deve ser uma BET processada.

A key tem unicidade global. Repetir a key e o mesmo payload retorna o snapshot
original, com `idempotentReplay: true`, sem novo movimento. O saldo/status do
snapshot pode diferir do estado atual: um aceite 202 continua sendo reproduzido
como 202 depois da resolução da referência. Consulte o GET da transação para
acompanhar seu estado atual. Uma identidade externa com uma nova key retorna 409.

Ledger aceita `limit` entre 1 e 100, padrão 50, e devolve `entries` e `nextCursor`.
Use o cursor retornado nas páginas seguintes. A paginação fixa o limite superior
na primeira página e exclui novos lançamentos dessa navegação.

## SQS e eventos

`queues:init` cria `wager-transactions.fifo`, sua DLQ
`wager-transactions-dlq.fifo` e a fila de saída `wager-events.fifo`.
Envie comandos com `MessageGroupId = walletId` e um `MessageDeduplicationId`.
O corpo é o envelope abaixo; `data` contém o mesmo contrato HTTP, acrescido
de `idempotencyKey`:

```json
{
  "messageId": "provider-demo:message-001",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-10-03T00:00:00.000Z",
  "correlationId": "demo-001",
  "data": {
    "idempotencyKey": "provider-demo:bet-001",
    "providerId": "provider-demo",
    "externalTransactionId": "bet-001",
    "walletId": "<UUID da carteira>",
    "playerId": "<UUID do jogador>",
    "roundId": "round-001",
    "gameId": "game-001",
    "kind": "BET",
    "money": { "amount": "80.00", "currency": "BRL" }
  }
}
```

O consumidor confirma mensagens somente após o commit. Pendências liberam a
fila e são resolvidas pelo worker de referências. Erros temporários recebem
retry; poison messages, falhas permanentes e retries esgotados vão à DLQ.
Falha no envio à DLQ mantém a mensagem original disponível para recuperação.

A outbox publica eventos `WagerTransactionProcessed`, `WagerTransactionRejected`,
`WagerTransactionPendingReference`, `WagerTransactionFailed` e
`WalletBalanceChanged`. O envelope contém `eventId`, `eventType`, `aggregateId`,
`version`, `occurredAt`, `correlationId`, `data` e, quando presente, `causationId`.
Publicações podem se repetir: consumidores devem deduplicar por `eventId`.

## Verificação

Com a infraestrutura local ativa:

```sh
bun run lint
bun run typecheck
bun run build
bun run test:unit
bun run test:integration
bun run test:concurrency
bun run test:recovery
```

`bun test` executa todas as suites. Os testes criam bancos e filas temporários
com nomes únicos e removem seus próprios recursos ao concluir. A conexão de
migration precisa poder criar esses bancos. Eles iniciam seus próprios processos;
API e worker manuais são necessários apenas para a demonstração.

Os cenários e limites da validação estão em [docs/VALIDATION.md](docs/VALIDATION.md).
Para desenvolvimento, `bun run start:dev` habilita watch. `migration:down`
reverte a última migration e destina-se à manutenção do schema.
`bun run docs:generate` regenera a especificação OpenAPI e os arquivos do Postman.

## Decisões e limites

O domínio usa centavos em `bigint`; PostgreSQL usa `NUMERIC(20,2)`. Locks de linha
serializam operações da mesma carteira entre processos, e constraints/triggers
protegem o ledger e a consistência financeira. Inbox deduplica entregas e outbox
mantém eventos recuperáveis após a confirmação financeira.

Esta entrega adia autenticação com IdP, conforme o escopo acordado. A porta
`ProviderIdentityPort` está ligada à API com um adaptador sem autenticação;
a integração futura está descrita em [ARCHITECTURE.md](ARCHITECTURE.md).
Não há conversão cambial, partidas dobradas, teste de carga, dashboard ou
OpenTelemetry. As garantias testadas são de correção e recuperação, sem uma
meta de throughput comprovada.

- [Arquitetura e trade-offs](ARCHITECTURE.md).
- [Guia do código e da estrutura](docs/GUIA_DO_CODIGO.md).
- [Fluxos financeiros explicados passo a passo](docs/FLUXOS_FINANCEIROS.md).
- [Requisitos da vaga e evidências no projeto](docs/REQUISITOS_E_EVIDENCIAS.md).
- [Códigos de rejeição e orientação de reenvio](docs/FAILURE_CODES.md).
- [PRD autoral](prd/README.md).
- [Tarefas e evidências](prd/tasks/todo.md).
