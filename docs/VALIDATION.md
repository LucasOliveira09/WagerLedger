# Validação da entrega

## Ambiente e reprodução

Validação local em 03/10/2026, no Windows, com Bun 1.4.2, PostgreSQL 18 e
MiniStack 1.5.18. As imagens e dependências estão fixadas no Compose e lockfile.
Execute o setup descrito no [README](../README.md) e depois:

```sh
bun run lint
bun run typecheck
bun run build
bun test
```

Resultado da suíte completa: **63 testes passaram, zero falhas e 353 assertions,
distribuídos em 41 arquivos**. Lint, tipos e build também passaram.
Os resultados são evidência local de correção; não constituem benchmark ou
validação de um deployment na AWS.

Também foi criado um clone local separado dos arquivos versionados, com
`bun install --frozen-lockfile` e uma cópia de `.env.example`. Nesse clone,
Compose, migrations, inicialização de filas, lint, tipos, build e os 63 testes
passaram. API e worker inicializados a partir do clone executaram a demonstração
com sucesso. Essa verificação reutilizou a infraestrutura Docker local; os testes
criaram bancos e filas próprios, com as três migrations aplicadas desde zero.
O PRD autoral estava presente no clone; o enunciado original ignorado estava ausente.

Os testes usam bancos e filas temporários reais. O harness cria cada banco
com prefixo `wagerledger_test_` e UUID validado, aplica as migrations e remove
somente esse recurso. Filas também têm nomes únicos. A role limitada é utilizada
nos cenários de endurecimento SQL e nos workers dos testes com vários processos.
Os testes não exigem API/worker iniciados manualmente.

## Cenários comprovados

| Cenário | Evidência executável | Resultado esperado |
| --- | --- | --- |
| Money exato, escala e overflow | `tests/unit/money.test.ts` | Sem arredondamento ou perda de precisão acima do limite seguro de Number |
| Atomicidade do pacote financeiro | `tests/integration/unit-of-work.test.ts`, `inbox-atomicity.test.ts` | Falha após escrita reverte saldo, transação, ledger, inbox e outbox |
| Migrations e proteção no banco | `wallet-schema.test.ts`, `transaction-schema.test.ts`, `database-hardening.test.ts` em integração | Up/down, imutabilidade, direção/valor/tipo financeiro, constraints e role limitada |
| Idempotência e conflitos | `tests/integration/idempotency.test.ts` | Snapshot preservado; key/payload e identidade externa divergentes conflitam |
| Saldo 100, duas BET de 80 e 50 duplicatas | `tests/concurrency/bet-races.test.ts` | Saldo 20, um débito e efeitos únicos |
| Carteiras independentes | Mesmo teste de concorrência | Outra carteira progride enquanto uma mantém lock |
| WIN, LOSS e reversões | `win-loss.test.ts`, `reversals.test.ts` em integração | LOSS sem ledger; reversão integral, concorrência e insuficiência auditadas |
| Referência fora de ordem | `pending-reference.test.ts`, `reference-worker.test.ts`, `incompatible-pending-reference.test.ts` | Resolução única; backoff/expiração; identidade incompatível rejeitada |
| Consulta paginada e reconciliação | `queries.test.ts`, `reconciliation.test.ts` em integração | Cursor estável sob inserções; leitura consistente e divergência sem correção automática |
| API HTTP e SQS | Testes `http-*.test.ts`, `sqs-consumer.test.ts` | Contratos e códigos HTTP reais; operação compartilhada sem duplicação |
| Retry, auditoria FAILED e DLQ indisponível | `sqs-failures.test.ts`, `failed-audit.test.ts`, `failed-dlq-recovery.test.ts` | Sem ack antecipado; permanente auditado; temporário esgotado pode ser reenviado após recuperação |
| Publishers concorrentes | `tests/integration/outbox-publishers.test.ts` | SKIP LOCKED, IDs estáveis e retry persistente |
| Três processos reais | `tests/concurrency/multi-process.test.ts` | Três PIDs distintos, todos com trabalho, 60 mensagens, reinício e sete carteiras reconciliadas |
| Morte entre commit e ack | `tests/recovery/commit-before-ack.test.ts` | Redelivery por outro PID; uma inbox, um débito e eventos SQL únicos |
| Morte antes/depois da publicação | `tests/recovery/outbox-crash.test.ts` | Outro publisher recupera eventos; envio repetido mantém eventId |
| Shutdown e métricas do worker | `tests/recovery/shutdown.test.ts` | Processo drena operação, responde health/metrics e sai com código zero |
| Observabilidade | `observability.test.ts`, `financial-telemetry.test.ts` em integração | Readiness detecta dependências indisponíveis; métricas e JSON sem payload financeiro |

O cenário de três processos imprime uma linha JSON com os PIDs efetivos. Na
execução registrada: `28784`, `27404` e `31304`; esses números variam por execução.
Parte das mensagens usa grupos SQS distintos para a mesma carteira, de propósito,
para verificar a proteção do PostgreSQL sem depender da ordenação FIFO.

## Demonstração manual

Com API e worker ativos, `bun run demo` passou exercitando os tipos financeiros,
replay, saldo insuficiente, referência fora de ordem, SQS e reconciliação.
Resultado: saldo final 100.00 BRL, sete lançamentos e diferença 0.00.

## Limites das evidências

- Concorrência usa processos do sistema operacional; morte abrupta encerra
  subprocessos reais, com barreiras para alcançar o intervalo crítico.
- No Windows, o teste gracioso aciona o handler SIGTERM por IPC. Ele comprova
  o dreno e a ordem de encerramento, sem provar entrega de sinais POSIX pelo SO.
- O teste de duplicação da outbox usa uma fila standard para observar a entrega
  duplicada real, sem ocultá-la pela janela de deduplicação FIFO. O consumidor
  de teste deduplica por eventId; um consumidor externo deve fazer o mesmo.
- Relógio controlado cobre limites/TTL do worker de referências. Não é necessário
  esperar 24 horas para demonstrar expiração.
- Sem IdP por decisão de escopo; sem medição de carga, infraestrutura AWS,
  conversão cambial, partidas dobradas ou collector de traces.

A revisão independente de código examinou constraints SQL, referências,
idempotência, auditoria e recuperação da DLQ. As correções receberam testes
de regressão; a última revisão dessas correções não encontrou bloqueadores.
