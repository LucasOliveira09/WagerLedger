# Tarefas — WagerLedger

Estado: execução em andamento; tarefas concluídas carregam evidências.
Comandos de tarefas pendentes são alvos futuros até seus scripts serem validados.
Cada tarefa deve terminar em verificação e commit coerente. Arquivos são previsões;
se o incremento ultrapassar cinco arquivos ou dois subsistemas independentes,
dividi-lo antes de implementar.

## T01 — Preparar Bun e compatibilidade da stack

- [x] Concluída e verificada.
- Evidência: Bun 1.4.2, NestJS 12.1.2, MikroORM 7.2.3; build/typecheck passaram; servidor HTTP, DI e ORM sem conexão iniciaram em smoke real.
- Dependências: nenhuma.
- Aceite: Bun 1.x disponível; versões candidatas de NestJS/MikroORM resolvidas; bootstrap mínimo inicia com DI e decorators.
- Verificação: bun --version; bun run build; smoke de inicialização com Bun.
- Arquivos previstos: package.json, bun.lock, tsconfig.json, src/main.ts, src/app.module.ts.

## T02 — Definir verificação estática e scripts

- [x] Concluída e verificada.
- Evidência: lint, TypeScript estrito e build passaram executando os CLIs com Bun; scripts por suite definidos e finais de linha padronizados em LF.
- Dependências: T01.
- Aceite: Typecheck estrito e lint funcionam; scripts de teste distinguem suites; build não depende de Node como runtime da aplicação.
- Verificação: bun run typecheck; bun run lint; bun run build.
- Arquivos previstos: package.json, tsconfig.json, eslint.config.js.

## T03 — Provar PostgreSQL e SQS em Compose

- [x] Concluída e verificada.
- Evidência: PostgreSQL 18 saudável; MiniStack 1.5.18 passou teste real de FIFO/dedup/redelivery/DLQ; imagens por digest e filas inicializadas.
- Dependências: T01.
- Aceite: Imagens fixadas; PostgreSQL responde; FIFO, visibilidade, redelivery e DLQ comprovados no emulador escolhido.
- Verificação: docker compose config; docker compose up -d; bun run test:integration -- tests/integration/sqs-capabilities.test.ts.
- Arquivos previstos: compose.yaml, .env.example, scripts/init-queues.ts, tests/integration/sqs-capabilities.test.ts.

Marco: ambiente e compatibilidade provados antes do processamento financeiro.

## T04 — Implementar Money exato

- [x] Concluída e verificada.
- Evidência: 14 testes unitários passaram; centavos bigint, escala estrita, overflow, sinais e conflitos de moeda comprovados.
- Dependências: T02.
- Aceite: Bigint em centavos; factories e operações imutáveis; escala, entradas inválidas, limites e conflitos de moeda testados.
- Verificação: bun run test:unit -- tests/unit/money.test.ts; bun run typecheck.
- Arquivos previstos: src/domain/money.ts, src/domain/domain-error.ts, tests/unit/money.test.ts.

## T05 — Implementar Wallet e ledger

- [x] Concluída e verificada.
- Evidência: 17 testes unitários cumulativos passaram; movimento retorna ledger balanceado; débito insuficiente e moeda divergente preservam saldo/version.
- Dependências: T04.
- Aceite: Factories/rehydrate; version e saldo preservam invariantes; ledger imutável valida direção e aritmética.
- Verificação: bun run test:unit -- tests/unit/wallet.test.ts tests/unit/wallet-ledger-entry.test.ts.
- Arquivos previstos: src/domain/wallet.ts, src/domain/wallet-ledger-entry.ts, tests/unit/wallet.test.ts, tests/unit/wallet-ledger-entry.test.ts.

## T06 — Fechar contratos financeiros e estados

- [x] Concluída e verificada.
- Evidência: 20 testes unitários cumulativos passaram; estados terminais, exigência de referência e valor positivo protegidos; interpretações de replay/zero/keys registradas em ARCHITECTURE.md.
- Dependências: T04.
- Aceite: Decisões de zero, WIN/referências, replay pendente e scope da key registradas; transições terminais protegidas; failureCodes estáveis.
- Verificação: bun run test:unit -- tests/unit/wager-transaction.test.ts; revisão das interpretações contra ANALISE.md.
- Arquivos previstos: src/domain/wager-transaction.ts, src/domain/failure-code.ts, tests/unit/wager-transaction.test.ts, ARCHITECTURE.md.

## T07 — Criar schema mínimo de wallet e ledger

- [x] Concluída e verificada.
- Evidência: PostgreSQL real validou unicidade, saldo não negativo, igualdade saldo/ledger no commit, imutabilidade e migrations down/up; Money reidratado sem Number.
- Dependências: T03, T05.
- Aceite: Migration up/down; Money reidratado exatamente; unicidade player/moeda, saldo não negativo e ledger imutável no banco.
- Verificação: bun run test:integration -- tests/integration/wallet-schema.test.ts; migration up/down em banco descartável.
- Arquivos previstos: src/infrastructure/persistence/migrations/001-wallet-ledger.ts, src/infrastructure/persistence/wallet-mapping.ts, tests/integration/wallet-schema.test.ts.

## T08 — Completar schema transacional e de mensageria

- [x] Concluída e verificada.
- Evidência: unicidade de key/identidade externa/inbox, estados terminais e migrations up/down testados; role da aplicação sem TRUNCATE; schema de inbox/outbox e mappings exatos criados.
- Dependências: T06, T07.
- Aceite: Constraints de idempotência, identidade externa, inbox e reversão por tipo; outbox e snapshots persistidos; status/valores/FKs verificados.
- Verificação: bun run test:integration -- tests/integration/transaction-schema.test.ts; round-trip de mappings.
- Arquivos previstos: src/infrastructure/persistence/migrations/002-transactions-messaging.ts, src/infrastructure/persistence/transaction-mapping.ts, src/infrastructure/persistence/message-mapping.ts, tests/integration/transaction-schema.test.ts.

## T09 — Isolar unidades de trabalho e locks

- [x] Concluída e verificada.
- Evidência: escrita real seguida de falha injetada foi revertida; execuções usam instâncias de domínio distintas, contexto ORM novo e lock de linha por wallet; retry limitado a três tentativas.
- Dependências: T08.
- Aceite: Contexto novo por execução/retry; lock por wallet e ordem de aquisição única; falha injetada provoca rollback completo.
- Verificação: bun run test:integration -- tests/integration/unit-of-work.test.ts.
- Arquivos previstos: src/application/ports/financial-unit-of-work.ts, src/infrastructure/persistence/mikro-financial-unit-of-work.ts, tests/integration/unit-of-work.test.ts.

## T10 — Definir eventos concretos de processamento

- [x] Concluída e verificada.
- Evidência: 21 testes unitários cumulativos passaram; envelopes versionados com eventId estável, tipo concreto e snapshots JSON independentes de Money.
- Dependências: T06.
- Aceite: Envelope abstrato com IDs/contexto/version; eventos Processed/Rejected/PendingReference com payload JSON estável.
- Verificação: bun run test:unit -- tests/unit/wager-events.test.ts.
- Arquivos previstos: src/domain/events/integration-event.ts, src/domain/events/wager-transaction-processed.ts, src/domain/events/wager-transaction-rejected.ts, src/domain/events/wager-transaction-pending-reference.ts, tests/unit/wager-events.test.ts.

## T11 — Definir evento de saldo e modelos de inbox/outbox

- [x] Concluída e verificada.
- Evidência: 23 testes unitários cumulativos passaram; evento de saldo valida lançamento, inbox protege estado e outbox possui retry/publicação explícitos.
- Dependências: T05, T10.
- Aceite: WalletBalanceChanged somente em mudança; Inbox/Outbox encapsulam transições e retry sem payload mutável.
- Verificação: bun run test:unit -- tests/unit/message-models.test.ts.
- Arquivos previstos: src/domain/events/wallet-balance-changed.ts, src/domain/inbox-message.ts, src/domain/outbox-message.ts, tests/unit/message-models.test.ts.

## T12 — Criar carteira com abertura auditável

- [x] Concluída e verificada.
- Evidência: criação via HTTP real retornou 201, duplicata 409 e inválidos 400; crédito inicial gerou um ledger e dois eventos atômicos; saldo zero não gera abertura e version inicia em 1.
- Dependências: T09, T11.
- Aceite: POST cria wallet/OPENING/CREDIT/outbox atomicamente quando saldo positivo; zero não gera OPENING; wallet nasce na version 1 e duplicata é conflito.
- Verificação: bun run test:integration -- tests/integration/open-wallet.test.ts; chamada HTTP real.
- Arquivos previstos: src/application/open-wallet.ts, src/interfaces/http/wallet-controller.ts, src/interfaces/http/open-wallet.dto.ts, tests/integration/open-wallet.test.ts.

## T13 — Implementar hash e replay persistente

- [x] Concluída e verificada.
- Evidência: hash SHA-256 canônico determinístico testado; replay persistido, payload divergente e identidade externa com nova key verificados no PostgreSQL.
- Dependências: T06, T09.
- Aceite: SHA-256 canônico documentado; key obrigatória; divergência conflita; key nova com mesmo provider/ID externo não duplica; snapshots preservados.
- Verificação: bun run test:unit -- tests/unit/canonical-payload.test.ts; bun run test:integration -- tests/integration/idempotency.test.ts.
- Arquivos previstos: src/application/canonical-payload.ts, src/application/idempotency.ts, tests/unit/canonical-payload.test.ts, tests/integration/idempotency.test.ts.

## T14 — Processar BET pelo caso de uso compartilhado

- [x] Concluída e verificada.
- Evidência: débito e rejeição persistidos no PostgreSQL; HTTP real validou chave obrigatória, replay, conflito, insuficiência e exclusão de OPENING público; lint/tipos/build passaram.
- Dependências: T12, T11, T13.
- Aceite: BET aplica débito/ledger/outbox atômicos; insuficiência gera rejeição persistida; HTTP distingue processado, inválido, conflito e falha transitória.
- Verificação: bun run test:integration -- tests/integration/submit-bet.test.ts; bun run build.
- Arquivos previstos: src/application/process-wager.ts, src/interfaces/http/wager-controller.ts, src/interfaces/http/wager.dto.ts, src/interfaces/http/error-filter.ts, tests/integration/submit-bet.test.ts.

## T15 — Provar corrida de saldo e 50 duplicatas

- [x] Concluída e verificada.
- Evidência: 50 submissões paralelas produziram um único débito/dois eventos; disputa 100/80/80 terminou em 20 com uma rejeição; carteira distinta progrediu enquanto outra mantinha lock; saldo/ledger conferidos no SQL. Prova com três processos segue em T28.
- Dependências: T14.
- Aceite: Cenário 100/80/80 resulta em saldo 20 e um débito; 50 replays não duplicam; wallets distintas não usam lock global.
- Verificação: bun run test:concurrency -- tests/concurrency/bet-races.test.ts; reconciliar cada resultado.
- Arquivos previstos: tests/concurrency/bet-races.test.ts, tests/support/process-harness.ts.

Marco: primeiro fluxo financeiro completo, replay e corrida de saldo comprovados.

## T16 — Processar WIN e LOSS

- [x] Concluída e verificada.
- Evidência: WIN com referência credita; LOSS zero persiste sem ledger/versão/evento de saldo; moeda e rodada divergentes rejeitam sem efeito; regras puras e PostgreSQL testados.
- Dependências: T14.
- Aceite: WIN credita; LOSS não gera ledger/version/evento de saldo; identidade/moeda e referência opcional são verificadas.
- Verificação: bun run test:unit -- tests/unit/wager-rules.test.ts; bun run test:integration -- tests/integration/win-loss.test.ts.
- Arquivos previstos: src/application/process-wager.ts, src/domain/wager-transaction.ts, tests/unit/wager-rules.test.ts, tests/integration/win-loss.test.ts.

## T17 — Processar REFUND e ROLLBACK

- [x] Concluída e verificada.
- Evidência: valor parcial/tipo inválido rejeitados; refunds concorrentes resultaram em uma reversão e uma rejeição auditável; rollback de ganho gasto rejeitou com REVERSAL_INSUFFICIENT_FUNDS e nenhum ledger; unicidade por referência/tipo preservada.
- Dependências: T16.
- Aceite: Tipo, vínculo e valor de referência validados; reversões únicas por tipo; reversão sem saldo tem failureCode próprio e não altera ledger.
- Verificação: bun run test:integration -- tests/integration/reversals.test.ts; concorrência sobre a mesma referência.
- Arquivos previstos: src/application/process-wager.ts, src/application/resolve-reference.ts, tests/integration/reversals.test.ts.

## T18 — Persistir referências fora de ordem

- [x] Concluída e verificada.
- Evidência: REFUND antes de BET retorna 202 e grava pendência/evento sem ledger; replay mantém saldo/status originais após chegada da referência; referência rejeitada gera 422 REFERENCE_NOT_PROCESSED. Resolução agendada segue em T19.
- Dependências: T17.
- Aceite: Referência ausente produz PENDING_REFERENCE/outbox sem dinheiro; reprocessar usa operação original; referência terminal inválida tem resposta distinta.
- Verificação: bun run test:integration -- tests/integration/pending-reference.test.ts.
- Arquivos previstos: src/application/process-wager.ts, src/application/resolve-reference.ts, tests/integration/pending-reference.test.ts.

## T19 — Agendar resolução e expiração de pendências

- [x] Concluída e verificada.
- Evidência: dois workers resolveram a mesma pendência com um ledger; snapshot original preservado; relógio controlado comprovou backoff, respeito ao agendamento e rejeição por limite sem dinheiro; política e ordem de locks documentadas.
- Dependências: T18.
- Aceite: Backoff e TTL/limite documentados; múltiplos workers não aplicam duas vezes; expiração gera rejeição/evento, sem deadlock por ordem inversa.
- Verificação: bun run test:integration -- tests/integration/reference-worker.test.ts; teste concorrente com relógio controlável.
- Arquivos previstos: src/interfaces/workers/reference-worker.ts, src/application/retry-pending-reference.ts, tests/integration/reference-worker.test.ts, ARCHITECTURE.md.

## T20 — Consultar carteira, transações e ledger

- [ ] Concluída e verificada.
- Dependências: T17.
- Aceite: Todos os GET do PRD disponíveis; cursor opaco com ordem total e limite validado; consultas de transação interna/externa consistentes.
- Verificação: bun run test:integration -- tests/integration/queries.test.ts; cursor sob inserções concorrentes.
- Arquivos previstos: src/application/query-wallet.ts, src/application/query-transactions.ts, src/interfaces/http/wallet-controller.ts, src/interfaces/http/wager-controller.ts, tests/integration/queries.test.ts.

## T21 — Reconciliar saldo em snapshot consistente

- [ ] Concluída e verificada.
- Dependências: T20.
- Aceite: OPENING incluído no cálculo; diferença assinada; divergência sinalizada/logada e não corrigida; escrita concorrente não gera falso positivo.
- Verificação: bun run test:integration -- tests/integration/reconciliation.test.ts.
- Arquivos previstos: src/application/reconcile-wallet.ts, src/interfaces/http/wallet-controller.ts, tests/integration/reconciliation.test.ts.

Marco: operações e consultas fechadas, inclusive referências e reconciliação.

## T22 — Consumir SQS com inbox atômica

- [ ] Concluída e verificada.
- Dependências: T03, T15, T18.
- Aceite: Mesmo caso de uso do HTTP; inbox/hash e efeitos no mesmo commit; ack após commit; PENDING_REFERENCE libera FIFO; messageIds distintos não duplicam operação.
- Verificação: bun run test:integration -- tests/integration/sqs-consumer.test.ts; HTTP e SQS simultâneos.
- Arquivos previstos: src/infrastructure/messaging/sqs-client.ts, src/interfaces/workers/wager-consumer.ts, src/interfaces/workers/wager-message.ts, tests/integration/sqs-consumer.test.ts.

## T23 — Classificar retry e DLQ

- [ ] Concluída e verificada.
- Dependências: T22.
- Aceite: Negócio terminal recebe ack; transitórios têm backoff/limite; poison messages e erros permanentes chegam à DLQ; remover origem somente após envio confirmado.
- Verificação: bun run test:integration -- tests/integration/sqs-failures.test.ts; inspecionar mensagens na DLQ.
- Arquivos previstos: src/interfaces/workers/wager-consumer.ts, src/infrastructure/messaging/retry-policy.ts, tests/integration/sqs-failures.test.ts.

## T24 — Publicar outbox com múltiplos publishers

- [ ] Concluída e verificada.
- Dependências: T11, T14, T03.
- Aceite: Destino de eventos separado; SKIP LOCKED evita disputa; eventId estável e retry persistente; timeout impede transação sem limite.
- Verificação: bun run test:integration -- tests/integration/outbox-publishers.test.ts; dois publishers sobre a mesma tabela.
- Arquivos previstos: src/interfaces/workers/outbox-publisher.ts, src/infrastructure/messaging/event-publisher.ts, tests/integration/outbox-publishers.test.ts.

## T25 — Implementar shutdown dos workers

- [ ] Concluída e verificada.
- Dependências: T19, T23, T24.
- Aceite: SIGTERM para novas leituras; operações em andamento terminam ou mensagens voltam à visibilidade; conexões são fechadas sem ack antecipado.
- Verificação: bun run test:recovery -- tests/recovery/shutdown.test.ts.
- Arquivos previstos: src/interfaces/workers/worker-lifecycle.ts, src/main-worker.ts, tests/recovery/shutdown.test.ts.

Marco: entrega por fila, publicação e recuperação operacional prontas para testes de morte.

## T26 — Provar morte após commit antes do ack

- [ ] Concluída e verificada.
- Dependências: T25.
- Aceite: Processo realmente morto no intervalo crítico; redelivery não repete débito/eventos SQL; saldo final reconciliado após reinício.
- Verificação: bun run test:recovery -- tests/recovery/commit-before-ack.test.ts.
- Arquivos previstos: tests/recovery/commit-before-ack.test.ts, tests/support/failure-injection.ts, tests/support/process-harness.ts.

## T27 — Provar recuperação da outbox

- [ ] Concluída e verificada.
- Dependências: T24, T25.
- Aceite: Morte antes de publicar não perde evento; morte após envio aceita duplicata com eventId igual; consumidor de teste deduplica.
- Verificação: bun run test:recovery -- tests/recovery/outbox-crash.test.ts.
- Arquivos previstos: tests/recovery/outbox-crash.test.ts, tests/support/failure-injection.ts.

## T28 — Provar pelo menos três processos

- [ ] Concluída e verificada.
- Dependências: T15, T19, T26, T27.
- Aceite: Três ou mais processos, carteiras compartilhadas/distintas e reversões simultâneas; referência fora de ordem resolve; reinício preserva reconciliação.
- Verificação: bun run test:concurrency -- tests/concurrency/multi-process.test.ts; registrar número real de PIDs.
- Arquivos previstos: tests/concurrency/multi-process.test.ts, tests/support/process-harness.ts.

## T29 — Completar métricas e health

- [ ] Concluída e verificada.
- Dependências: T22, T24, T21.
- Aceite: Logs JSON seguros; métricas de status/duplicatas/retry/DLQ/locks/outbox lag/latência; liveness aberto e readiness consulta PG/SQS.
- Verificação: bun run test:integration -- tests/integration/observability.test.ts; indisponibilizar dependências e conferir readiness.
- Arquivos previstos: src/infrastructure/observability/logger.ts, src/infrastructure/observability/metrics.ts, src/interfaces/http/health-controller.ts, tests/integration/observability.test.ts.

## T30 — Documentar extensão de identidade sem IdP

- [ ] Concluída e verificada.
- Dependências: T14.
- Aceite: Decisão aceita de adiar IdP; porta de identidade explícita e desenho OIDC; health aberto; provider ainda validado no domínio.
- Verificação: Revisão de ARCHITECTURE.md; teste das validações de identidade existentes; bun run typecheck.
- Arquivos previstos: src/application/ports/provider-identity.ts, ARCHITECTURE.md.

## T31 — Validar entrega reproduzível

- [ ] Concluída e verificada.
- Dependências: T28, T29, T30.
- Aceite: Clone/setup com comandos reais; build/lint/tipos e todas as suites passam; README/arquitetura listam decisões, limites e demonstração.
- Verificação: bun run lint; bun run typecheck; bun run build; bun run test:unit; bun run test:integration; bun run test:concurrency; bun run test:recovery.
- Arquivos previstos: README.md, ARCHITECTURE.md, compose.yaml.

## Critério final

Nenhuma falha eliminatória do PRD. Evidências reproduzíveis com PostgreSQL/SQS
reais, três ou mais processos e igualdade saldo/ledger após cada cenário.
IdP, dashboard, OpenTelemetry, partidas dobradas e teste de carga não são marcos
desta entrega. Opcionais só entram depois de T31 e com tempo restante.
