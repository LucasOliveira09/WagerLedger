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

Resultado inicial da entrega: **63 testes passaram, zero falhas e 353 assertions,
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

## Collection e Swagger

A extensão de documentação adicionou o [guia de testes](TESTING.md), a collection
Postman com 35 cenários, o ambiente local e o OpenAPI versionado. Foram verificados:

- Newman 6.2.2: 35 cenários e **75 assertions sem falhas**, incluindo polling
  da referência fora de ordem. Na execução registrada, houve 39 requisições
  HTTP ao todo; a contagem varia com os GETs adicionais do polling.
- Swagger Parser 13.1.0: especificação OpenAPI 3.0.3 válida, com dez paths
  e referências internas resolvidas.
- Chrome via Playwright 1.63.0: dez operações renderizadas; Try it out executou
  GET de liveness e POST de carteira reais, sem erros de console ou rede.
- A resposta real de OPENING foi validada contra o schema Transaction por Ajv,
  incluindo `providerId: "__internal__"` e `failureCode: null`.
- Os testes detectam artefatos desatualizados e verificam exemplos financeiros
  contra os parsers e factories reais. O teste HTTP verifica UI/assets/JSON/YAML
  e o contrato de uma OPENING consultada no banco.

Após essa extensão, a suíte completa passou com **66 testes, 385 assertions,
zero falhas e 43 arquivos**. A collection foi executada contra banco descartável,
API em porta temporária, role limitada e worker de referências/publicação.
As ferramentas externas de verificação foram instaladas em uma pasta temporária,
sem acrescentar dependências de teste ao runtime do projeto.

## Comentários e guias de estudo

A extensão de estudo do código adicionou comentários explicativos em 30 arquivos
TypeScript e os guias [de estrutura](GUIA_DO_CODIGO.md),
[de fluxos financeiros](FLUXOS_FINANCEIROS.md) e
[de requisitos/evidências](REQUISITOS_E_EVIDENCIAS.md). O enunciado original
permaneceu ignorado pelo Git.

Lint, checagem de tipos, build e os **30 testes unitários, com 110 assertions**,
passaram. A comparação com o commit `dd53779`, usando o compilador TypeScript
com remoção de comentários e sem source maps, produziu JavaScript idêntico
nos 30 arquivos comentados. Links relativos dos guias e blocos de código
também foram verificados. Uma revisão independente comparou as explicações
com código, testes e enunciado local, sem encontrar correções obrigatórias.

A suíte completa de integração/concorrência/recuperação não foi reexecutada
para esta extensão documental; seus resultados anteriores continuam sendo
as evidências históricas descritas acima. Não houve inicialização ou parada
de serviços nesta etapa.

## Experimento opcional de carga

A extensão adicionou `bun run test:load`, com gerador HTTP, API e publisher em
processos distintos e recursos temporários reais. Os testes pequenos verificam
limites/configuração, percentis, contabilização de erros, timeout/cancelamento,
subprocessos, exclusão do aquecimento e auditoria dos eventos. Uma regressão
remove eventos e outra duplica seus tipos para verificar que a auditoria reprova.

Foram executados os cenários de uma carteira disputada e 16 carteiras independentes,
com oito clientes por 10 segundos, antes e depois de preparar 100 BETs por carteira.
Os quatro cenários aprovaram respostas, saldo/ledger, versão e eventos, sem erros
ou pendências finais. Os [resultados locais](LOAD_RESULTS.md) registram taxas,
percentis, locks e publicação; a [metodologia](LOAD_TESTING.md) explica o alcance.

Após a implementação, `bun test` passou com **76 testes, 454 assertions, zero
falhas e 49 arquivos**, em 26,85 segundos. Lint, checagem de tipos e build também
passaram. O benchmark completo é opcional e não faz parte desse tempo da suíte.
A revisão independente identificou a necessidade de auditar eventos ausentes
e excluir lag residual do aquecimento; as correções receberam regressões e a
revisão seguinte não encontrou bloqueadores materiais no harness.

## Legibilidade e formatação

A revisão visual padronizou o TypeScript de `src/`, `tests/` e `scripts/`, com
Prettier 3.9.9 fixado como dependência de desenvolvimento. Foram expandidas
instruções comprimidas, interfaces, objetos e assinaturas longas; métodos e
etapas lógicas receberam separação visual. O ESLint exige chaves em condições
e loops. EditorConfig e os comandos `format`/`format:check` mantêm o padrão.

A comparação contra `08519a8` abrangeu **129 arquivos TypeScript**. Cada versão
foi compilada com `transpileModule` do TypeScript, usando as opções do projeto,
sem comentários/source maps; o JavaScript foi normalizado pelo transpiler Bun
com minificação de sintaxe/espaços. As saídas normalizadas foram idênticas.
Isso verifica a equivalência dessa representação executável; as diferenças
de linhas e source maps são esperadas numa alteração de formatação.
As configurações TypeScript também preservaram o conteúdo JSON original.

A suíte completa passou com **76 testes, 454 assertions, zero falhas e 49
arquivos**, em 30,51 segundos. Formatação, lint, tipos e build passaram.
A revisão independente identificou que `docs/` ignorava também `scripts/docs/`;
a exclusão foi ancorada na raiz como `/docs/`, e o gerador Postman entrou no
formatter. Depois desse ajuste, a comparação dos 129 arquivos e os checks
de formatação/lint/tipos passaram novamente; os dois testes da documentação
passaram com 19 assertions, confirmando artefatos gerados sincronizados.
Documentos, enunciado ignorado e artefatos gerados ficaram fora do formatter.

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
- A carga local usa modelo fechado e janelas curtas; não comprova capacidade
  sustentada, chegada fixa de requisições ou desempenho na AWS.
- Sem IdP por decisão de escopo; sem infraestrutura AWS,
  conversão cambial, partidas dobradas ou collector de traces.

A revisão independente de código examinou constraints SQL, referências,
idempotência, auditoria e recuperação da DLQ. As correções receberam testes
de regressão; a última revisão dessas correções não encontrou bloqueadores.
