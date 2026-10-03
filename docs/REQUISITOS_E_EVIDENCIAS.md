# Requisitos da vaga e evidências no projeto

Esta é uma interpretação autoral do enunciado local, comparada com a implementação.
Não reproduz o README original. Use o [guia do código](GUIA_DO_CODIGO.md) para
entender a estrutura e os [fluxos financeiros](FLUXOS_FINANCEIROS.md) para
acompanhar a execução. A execução histórica dos testes está em
[VALIDATION.md](VALIDATION.md).

## 1. O que a avaliação procura

O desafio avalia correção financeira distribuída. Uma resposta HTTP correta
isolada não basta: precisa continuar correta com duplicatas, concorrência,
reinícios e falhas de fila. Os testes precisam atingir essas situações e
conferir os dados persistidos, não só verificar uma mensagem de sucesso.

| Área | Peso | Como nosso código aborda |
| --- | --- | --- |
| Correção financeira | 20 | Money exato, saldo protegido, ledger, reversões e reconciliação |
| Concorrência | 20 | Lock por carteira, unicidade SQL e múltiplos processos |
| Idempotência | 15 | Key/hash/snapshot persistidos e inbox |
| Mensageria e falhas | 15 | SQS, outbox, retries, DLQ, retomada e shutdown |
| Modelagem e arquitetura | 10 | Classes com invariantes, factories, portas e adaptadores |
| Testes | 10 | Unidade, integração real, disputas e interrupção de processos |
| Observabilidade | 5 | JSON, métricas e health separados |
| Documentação | 5 | Setup, decisões, testes manuais e explicação do código |

As primeiras quatro áreas somam 70 pontos e orientaram nossa prioridade.
Esses pesos não representam uma nota já obtida: a avaliação cabe aos avaliadores.
Autenticação não é pontuada no enunciado e a entrega sem IdP é aceita com
decisão documentada e ponto de extensão explícito.

## 2. Requisito, implementação e prova

Os caminhos da coluna de código são relativos a `src/`. Os caminhos de teste
são relativos a `tests/`. “Implementado” significa que o mecanismo está no código;
o alcance da comprovação depende dos cenários executados.

| Requisito interpretado | Código atual | Evidência executável |
| --- | --- | --- |
| Bun, TS estrito, NestJS, PostgreSQL, SQS local e migrations | `package.json`, configurações TS, Compose, `main.ts`, `infrastructure/persistence/orm.ts` | Setup e verificação em clone registrados em VALIDATION |
| Dinheiro sem ponto flutuante, escala 2, limite e moedas | `domain/money.ts`, mapeamentos decimais string | `unit/money.test.ts` |
| Entidades encapsuladas e reconstrução de estado | `domain/wallet.ts`, `wager-transaction.ts`, `wallet-ledger-entry.ts`, inbox/outbox | Testes de domínio em `unit/` |
| Carteira única, sem negativo, versão inicia 1 e muda com saldo | Wallet, `migrations/001-wallet-ledger.ts` | `unit/wallet.test.ts`, `integration/wallet-schema.test.ts` |
| Saldo inicial explicado no histórico | `application/open-wallet.ts` | `integration/open-wallet.test.ts`, `http-wallet.test.ts` |
| BET, WIN e LOSS com efeitos distintos | `application/apply-wager.ts`, WagerTransaction | `integration/submit-bet.test.ts`, `win-loss.test.ts` |
| Referências e reversões integrais, únicas por tipo | `domain/reference-rules.ts`, apply-wager, migrations 002/003 | `unit/wager-rules.test.ts`, `integration/reversals.test.ts` |
| Estados terminais e solicitação imutáveis | WagerTransaction, triggers 002/003 | `unit/wager-transaction.test.ts`, `integration/transaction-schema.test.ts`, `database-hardening.test.ts` |
| Ledger obrigatório para movimento, sem lançamento em LOSS/rejeição | WalletLedgerEntry, apply-wager, triggers 001/002/003 | `unit/wallet-ledger-entry.test.ts`, integração financeira e endurecimento SQL |
| Mesma key/mesmo negócio reproduz primeira resposta | `application/idempotency.ts`, `saveTransaction()` na sessão | `integration/idempotency.test.ts` |
| Key divergente ou identidade externa reutilizada conflita | Hash canônico, índices únicos e resolveIdempotency | `unit/canonical-payload.test.ts`, `integration/idempotency.test.ts` |
| Inbox confirma junto com o resultado financeiro | `application/process-wager.ts`, sessão SQL | `integration/inbox-atomicity.test.ts`, `sqs-consumer.test.ts` |
| Atomicidade de carteira/operação/ledger/inbox/outbox | `mikro-financial-unit-of-work.ts` | `integration/unit-of-work.test.ts`, `inbox-atomicity.test.ts` |
| 100.00 disputados por duas BET de 80.00 | Lock pessimista por carteira | `concurrency/bet-races.test.ts` |
| 50 submissões duplicadas geram só um efeito | Key persistida, replay, lock e unicidade | `concurrency/bet-races.test.ts` |
| Carteiras diferentes podem prosseguir em paralelo | Locks de linha distintos | `concurrency/bet-races.test.ts` |
| Pelo menos três processos simultâneos | `main-worker.ts` e coordenação no PostgreSQL | `concurrency/multi-process.test.ts` |
| Referência ausente persistida, ack e retomada limitada | apply-wager, RetryPendingReference, ReferenceWorker | `integration/pending-reference.test.ts`, `reference-worker.test.ts`, `incompatible-pending-reference.test.ts` |
| API de criação, consultas, ledger e submissão | Controllers e FinancialQueries | `integration/http-*.test.ts`, `queries.test.ts` |
| Reconciliação consistente com diferença assinada, sem correção | ReconcileWallet e SQL de leitura única | `integration/reconciliation.test.ts` |
| SQS com retry, poison message e DLQ | WagerConsumer, wager-message, retry-policy | `integration/sqs-failures.test.ts`, `sqs-capabilities.test.ts` |
| Falha permanente auditável sem destruir resultado anterior | `application/fail-wager.ts` | `integration/failed-audit.test.ts`, `failed-dlq-recovery.test.ts` |
| Outbox persistida e publishers concorrentes recuperáveis | OutboxMessage e OutboxPublisher | `integration/outbox-publishers.test.ts`, `recovery/outbox-crash.test.ts` |
| Eventos concretos, versionados e JSON monetário string | `domain/events/` | `unit/wager-events.test.ts`, `message-models.test.ts` |
| Morte depois de commit, antes de ack | Commit antes de DeleteMessage e dedup persistente | `recovery/commit-before-ack.test.ts` |
| Encerramento drena operações em andamento | WorkerLifecycle e handlers dos pontos de entrada | `unit/worker-lifecycle.test.ts`, `recovery/shutdown.test.ts` |
| JSON sem payload financeiro, métricas e health | `infrastructure/observability/` | `unit/telemetry.test.ts`, `integration/observability.test.ts`, `financial-telemetry.test.ts` |
| Swagger/Postman úteis e sincronizados | `interfaces/http/swagger.ts`, schemas e fontes dos scripts | `unit/api-documentation.test.ts`, `integration/swagger.test.ts`; execução Newman registrada |
| Experimento opcional de carga com auditoria | `tests/load/`, comando `test:load` | Testes unitários do gerador/monitor e integração `load-*.test.ts`; [resultados locais](LOAD_RESULTS.md) |

O conflito real de key com payload divergente é exercitado em integração;
em unidade, verificamos a distinção dos hashes. Essa distribuição é a cobertura
atual, embora o enunciado também cite idempotência entre os cenários unitários.

## 3. O que cada conjunto de testes demonstra

- **Unidade:** operações exatas, invariantes locais e contratos. Não demonstra
  locks do PostgreSQL nem comportamento de uma SQS real.
- **Integração:** banco PostgreSQL e emulador SQS em containers; migrations,
  rollback, permissões, consultas, retry e publicação. Não é deployment na AWS.
- **Concorrência:** chamadas paralelas e três subprocessos com PIDs distintos;
  todos efetivamente trabalham. Parte das mensagens usa grupos diferentes para
  a mesma carteira, verificando independência da ordenação FIFO.
- **Recuperação:** interrupções controladas antes/depois do envio e entre
  commit/ack. Verifica se outro processo retoma sem outro movimento financeiro.
- **Carga opcional:** concorrência HTTP fixa com banco e publicação reais,
  taxas/percentis e auditoria final. [Metodologia](LOAD_TESTING.md); não prova
  capacidade sustentada ou uma meta de chegada fixa.

O teste de duplicação da publicação usa fila standard para observar a duplicata
sem a janela de deduplicação FIFO escondê-la. No teste gracioso em Windows,
IPC aciona o handler SIGTERM: comprova o dreno, mas não entrega de sinal POSIX
pelo sistema operacional. Relógio controlado verifica TTL sem esperar 24 horas.

A última execução completa registrada antes da inclusão destes comentários
passou com **66 testes, 385 assertions e zero falhas em 43 arquivos**.
Esse é um resultado histórico, não uma declaração de que a suíte completa
foi reexecutada a cada alteração de documentação.

## 4. Limites e decisões de escopo

| Tema | Estado atual e consequência |
| --- | --- |
| IdP | Adiado por decisão acordada; porta no-op e desenho futuro em ARCHITECTURE; sem autenticação/autorização efetivas |
| AWS | SDK SQS funciona contra MiniStack; sem deployment, IaC ou validação de IAM; cliente ainda configura credenciais locais explicitamente |
| Containers da aplicação | Compose sobe dependências; API/workers são processos Bun locais |
| FIFO | Otimiza ordenação, sem ser a fonte da garantia financeira |
| Duplicatas de eventos | EventId é estável; consumidor externo deve deduplicar e tratar ordenação/versionamento |
| Visibilidade SQS | 30 segundos por padrão, sem heartbeat de extensão; entrega concorrente continua possível |
| Retenção | Sem expurgo automático de inbox/outbox publicada |
| Métricas | Em memória por processo; sem servidor Prometheus/collector/dashboard incluído |
| Capacidade | Experimento local registrado em LOAD_RESULTS; sem meta de throughput em produção demonstrada |
| Contabilidade | Ledger por carteira; não é sistema de partidas dobradas |
| Moedas | Validação e separação por moeda; sem câmbio |
| Falha de banco | Rollback protege o pacote; auditoria FAILED depende de conseguir gravar depois |
| CI/CD | Não há pipeline ou implantação automática nesta entrega |

O desafio aceita escolhas técnicas justificadas. Por isso registramos locks
pessimistas, Money em centavos e ausência de IdP em vez de afirmar que todas
as sugestões do enunciado foram implementadas literalmente. O documento
[ARCHITECTURE.md](../ARCHITECTURE.md) preserva os trade-offs dessas decisões.
