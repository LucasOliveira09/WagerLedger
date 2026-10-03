# Entendendo o código do WagerLedger

Este guia descreve a implementação atual, com base no código e no enunciado
local da vaga. É uma explicação autoral: o documento original permanece em
`readme_da_vaga/`, ignorado pelo Git.

Leia este documento para entender onde cada responsabilidade fica. Depois,
acompanhe os exemplos de [fluxos financeiros](FLUXOS_FINANCEIROS.md) e a
[relação entre requisitos e evidências](REQUISITOS_E_EVIDENCIAS.md).
Para executar requisições, use [TESTING.md](TESTING.md).

## 1. O problema que estamos resolvendo

Um provedor envia resultados financeiros de apostas de um jogador. Nosso
backend decide se cada operação pode acontecer, atualiza a carteira, registra
seu histórico e produz eventos. Ele precisa continuar correto quando:

- Duas apostas tentam gastar o mesmo saldo ao mesmo tempo.
- A mesma operação chega repetida, inclusive por HTTP e SQS.
- Um estorno chega antes da aposta que ele precisa referenciar.
- Um processo morre depois de confirmar o banco e antes de confirmar a mensagem.
- A fila de saída fica indisponível ou recebe um evento repetido.

Não há lógica de sorteio, cálculo de odds ou definição de vencedores. O provedor
declara BET, WIN, LOSS, REFUND ou ROLLBACK; validamos o efeito financeiro declarado.

## 2. Estrutura e direção das dependências

```text
src/
  domain/                    Dinheiro, entidades e regras financeiras
    events/                  Fatos de negócio com contratos versionados
  application/               Coordenação das operações
    ports/                   Contratos para banco, mensageria, identidade e telemetria
  infrastructure/
    persistence/             MikroORM, SQL e reconstrução das entidades
      migrations/            Schema e garantias no PostgreSQL
    messaging/               AWS SDK e políticas de falhas
    observability/           Logs, métricas e readiness
  interfaces/
    contracts/               Validação da entrada compartilhada
    http/                    Controllers, erros HTTP e Swagger
    workers/                 Consumo, publicação e tarefas periódicas
  app.module.ts              Composição das dependências da API
  main.ts                    Inicialização da API
  main-worker.ts             Inicialização dos workers
scripts/                     Migrations, filas, demonstração e documentação
tests/                       Unidade, integração, concorrência e recuperação
docs/                        Guias, evidências, OpenAPI e Postman
prd/                         Requisitos e planejamento autorais
```

O domínio não importa NestJS, MikroORM ou AWS SDK. Os casos de uso trabalham
com o domínio e com portas. Uma porta descreve a capacidade necessária,
como executar uma transação financeira, sem escolher a biblioteca usada.
Os adaptadores implementam essas portas; os pontos de composição os conectam.

Isso permite testar `Money` sem banco e usar `ProcessWager` tanto em um
controller quanto em um consumidor de fila. Não temos duas implementações
independentes das regras financeiras.

## 3. Stack e processos

| Tecnologia | Responsabilidade nesta implementação |
| --- | --- |
| Bun 1.4.2 | Executa TypeScript, scripts, servidor dos workers e testes |
| TypeScript 5.9.3 | Tipos estritos; `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes` habilitados |
| NestJS 12.1.2 | HTTP, controllers, injeção de dependências e encerramento da API |
| MikroORM 7.2.3 | Conexões, transações e mapeamento de carteiras/operações |
| PostgreSQL 18 | Persistência, locks de linha, unicidade, constraints e triggers |
| AWS SDK SQS | Recebe, envia e confirma mensagens usando o protocolo SQS |
| MiniStack 1.5.18 | Emula SQS no ambiente local |
| Docker Compose | Inicia PostgreSQL e MiniStack, com imagens fixadas por digest |

O Compose contém as dependências. API e workers são iniciados com Bun fora
dos containers. O banco é exposto em `127.0.0.1:55432`, SQS em
`127.0.0.1:14566` e a API usa porta 3000 por padrão. O PostgreSQL tem volume;
as filas precisam ser inicializadas novamente quando o emulador for recriado.

`main.ts` cria a aplicação NestJS, registra o filtro de erros, instala Swagger,
habilita shutdown hooks e abre HTTP. `app.module.ts` usa factories para
conectar os casos de uso ao ORM, à telemetria e ao adaptador de identidade.

`main-worker.ts` cria ORM e cliente SQS, encontra as filas já existentes e
inicializa os papéis definidos em `WORKER_ROLES`. O padrão executa
`consumer,publisher,reference`; podemos distribuí-los em processos separados.
A API não inicia automaticamente esses workers.

## 4. Domínio: o significado das classes

### Money: dinheiro exato e imutável

Em `src/domain/money.ts`, a entrada `"80.00"` é convertida em `8000n`.
`bigint` permite somar e subtrair inteiros sem aproximação de ponto flutuante.
Na API e nos eventos, o valor volta a ser string decimal. No banco, usamos
`NUMERIC(20,2)`, com limite `999999999999999999.99`.

`Money.from()` valida duas casas, valor não negativo e código de moeda
reconhecido por `Intl.supportedValuesOf('currency')`. `rehydrate()` reconstrói
um valor persistido e também permite sinal negativo; não repete a validação
de entrada, mas o construtor mantém o limite monetário.

`add`, `subtract` e `negate` retornam novos objetos. Nenhuma dessas operações
altera um `Money` já presente em um lançamento ou evento. Somar BRL com USD
gera erro: suportar códigos de moeda não significa converter moedas.
`number` continua sendo usado para contagens, versões e duração, nunca
para o valor financeiro das operações.

### Wallet: saldo atual e versão

Em `wallet.ts`, uma carteira pertence a um jogador e uma moeda. Começa na
versão 1. O banco garante unicidade de `(player_id, currency)`.

`debit()` e `credit()` validam moeda e valor positivo, calculam o novo saldo,
impedem saldo negativo e constroem um `WalletLedgerEntry`. Só depois alteram
saldo e versão em memória. A sequência do lançamento é a nova versão.
Esses métodos não gravam SQL: o caso de uso precisa persistir o resultado.

`Wallet` é nosso agregado: o objeto que concentra as regras da carteira.
O lock entre processos é responsabilidade da unidade de trabalho, não
de uma variável ou mutex dentro desse objeto.

### WalletLedgerEntry: histórico imutável

`wallet-ledger-entry.ts` guarda valor, direção, saldo anterior, saldo posterior,
carteira, operação e sequência. Sua factory confere a equação do lançamento:
crédito soma; débito subtrai. O banco também valida essa equação.

O ledger não pode ser atualizado ou apagado pela aplicação. Para desfazer
uma aposta, criamos outra operação e outro lançamento. Assim, a auditoria
preserva o que aconteceu e como foi compensado.

### WagerTransaction: operação e resultado

`wager-transaction.ts` mantém os identificadores, o tipo, o valor, a referência
e o estado. Os dados da solicitação ficam preservados; o estado pode mudar
enquanto não for terminal.

| Tipo | Efeito | Referência |
| --- | --- | --- |
| OPENING | Crédito que explica o saldo inicial positivo | Exclusivamente interno |
| BET | Débito | Normalmente sem referência |
| WIN | Crédito | Opcional; quando informada, exige BET processada compatível |
| LOSS | Nenhum movimento | Não exige referência |
| REFUND | Crédito integral de uma BET | Obrigatória |
| ROLLBACK | Inverte BET, WIN ou REFUND | Obrigatória e integral |

OPENING usa `providerId: "__internal__"`; o parser público não aceita esse tipo
nem o namespace reservado. LOSS admite valor zero; os demais exigem positivo.

| Estado | Significado |
| --- | --- |
| PENDING | Estado inicial do objeto criado durante o processamento |
| PENDING_REFERENCE | Operação persistida aguardando uma referência válida |
| PROCESSED | Operação concluída; LOSS também pode ter esse estado sem ledger |
| REJECTED | Regra de negócio impediu a execução; há código de motivo |
| FAILED | Falha permanente de infraestrutura auditada; não movimenta saldo |

Os três últimos são terminais. Os métodos do domínio bloqueiam alterações
após esses estados; não implementam uma matriz completa de transições entre
todos os estados não terminais. Os casos de uso organizam os caminhos esperados.

`reference-rules.ts` confere provedor, jogador, carteira, moeda e rodada antes
de conferir estado/tipo/valor. `gameId` é registrado, mas não integra essa
comparação. Uma reversão deve ter o mesmo valor da operação original; WIN
pode ter prêmio diferente do valor da BET referenciada.

`domain-error.ts` representa falhas conhecidas. `failure-code.ts` define os
motivos tipados usados nos resultados e na auditoria.

### Inbox, outbox e eventos

`inbox-message.ts` representa o recebimento confirmado de uma mensagem
por um consumidor. A identidade persistida é `(consumerName, messageId)`.

`outbox-message.ts` preserva o envelope de um evento e controla tentativas,
próxima tentativa e publicação. O ID da outbox é o `eventId`, mantido nos retries.
Ela não descarta eventos depois de um limite de tentativas.

`events/integration-event.ts` define a classe abstrata e faz cópia imutável dos
dados. `toJSON()` produz o envelope com IDs, correlação, data, tipo, versão e
dados. `causationId` identifica a causa; `correlationId` conecta um fluxo nos logs.

As classes concretas são `WagerTransactionProcessed`,
`WagerTransactionRejected`, `WagerTransactionPendingReference`,
`WagerTransactionFailed` e `WalletBalanceChanged`. Cada contrato está na versão 1.
`wager-event-data.ts` reúne a construção dos dados comuns dos eventos de operação.
`WalletBalanceChanged` inclui `walletVersion`: essa é a versão da carteira,
diferente de `version`, que identifica a versão do contrato do evento.

## 5. Aplicação: quem coordena cada operação

| Arquivo em `src/application/` | Responsabilidade |
| --- | --- |
| `open-wallet.ts` | Cria carteira e audita saldo inicial positivo com OPENING/ledger/outbox |
| `process-wager.ts` | Entrada compartilhada HTTP/SQS; coordena inbox, idempotência e commit |
| `apply-wager.ts` | Aplica identidade, referências, movimento, resultado e eventos na sessão bloqueada |
| `canonical-payload.ts` | Ordena chaves recursivamente e calcula SHA-256 do conteúdo |
| `idempotency.ts` | Reproduz o primeiro resultado ou rejeita reutilização divergente |
| `transaction-result.ts` | Define resultado de submissão, HTTP e estado atual interno |
| `retry-pending-reference.ts` | Resolve, reagenda ou expira referências pendentes |
| `fail-wager.ts` | Audita FAILED após rollback de falha permanente de infraestrutura |
| `financial-queries.ts` | Consulta carteira/operação e pagina ledger com cursor estável |
| `reconcile-wallet.ts` | Compara saldo e soma do ledger sem corrigir dados |

As portas em `application/ports/` são:

- `financial-unit-of-work.ts`: delimita commit/rollback e oferece uma sessão
  com acesso à carteira e aos registros relacionados.
- `financial-read-store.ts`: consultas sem precisar modificar o agregado.
- `event-publisher.ts`: envio de um evento persistido, com sinal de cancelamento.
- `telemetry.ts`: logs e métricas; permite usar uma implementação neutra em testes.
- `provider-identity.ts`: ponto de extensão da autenticação do provedor.

O adaptador atual `DeclaredProviderIdentity` não autentica. A submissão HTTP
chama a porta, mas não valida JWT. Os GETs e criação de carteira também não
têm autorização por usuário. Isso é o escopo acordado sem IdP, não uma
implementação de segurança equivalente a autenticação.

## 6. Persistência: de objetos a SQL

`orm.ts` configura as entidades, as três migrations e pool de até dez conexões
por processo. `wallet-mapping.ts` e `transaction-mapping.ts` definem registros
MikroORM separados do domínio e funções para reidratar as entidades.
Campos financeiros são decimais mapeados como string.

`mikro-financial-unit-of-work.ts` cria um EntityManager novo por tentativa,
abre uma transação e bloqueia a linha da carteira com `FOR UPDATE`. Seus métodos
usam o mesmo EntityManager: SQL direto e operações ORM participam do mesmo
commit. `flush()` envia SQL ao banco; ainda não é commit.

Ledger, inbox e outbox usam SQL parametrizado na sessão, sem classes de
mapeamento próprias. `mikro-financial-read-store.ts` implementa consultas de
carteira, operação, ledger e reconciliação. A soma financeira da reconciliação
é calculada por SQL e retorna valores decimais como strings.

As migrations estão detalhadas em [FLUXOS_FINANCEIROS.md](FLUXOS_FINANCEIROS.md).
As garantias do banco complementam as validações do domínio; uma não substitui
a outra. Nem toda regra ou permissão operacional futura já está implementada.

## 7. Interfaces: contratos e execução

`interfaces/contracts/input-validation.ts` recebe `unknown`, verifica objeto,
campos permitidos, strings, UUIDs, dinheiro e correlação. `wager.dto.ts` usa
essas funções para transformar uma entrada não confiável em `WagerInput`.
Ter um tipo TypeScript não valida o JSON recebido em runtime.

Em `interfaces/http/`, `wallet-controller.ts` cria/consulta carteiras, lista
ledger e reconcilia; `wager-controller.ts` submete e consulta operações,
incluindo o controller para identidade externa do provedor.
`open-wallet.dto.ts` valida a criação. `error-filter.ts` converte exceções
em respostas seguras, sem expor detalhes SQL ou stack traces.

Rejeição financeira persistida sai diretamente como resultado 422. Erros
de contrato chegam ao filtro e normalmente viram 400; ausência vira 404;
conflitos viram 409; infraestrutura não tratada vira 503.

`swagger.ts` monta e publica OpenAPI/UI. `openapi-schemas.ts` descreve os
contratos, exemplos e respostas. Swagger documenta a API; os parsers continuam
sendo a validação real. Testes verificam exemplos e sincronização dos artefatos.

Em `interfaces/workers/`, `wager-message.ts` valida o envelope SQS e extrai o
contrato compartilhado. `wager-consumer.ts` recebe, processa e confirma comandos.
`reference-worker.ts` busca pendências vencidas. `outbox-publisher.ts` publica
eventos. `worker-lifecycle.ts` mantém os loops e drena trabalho ao encerrar.

## 8. AWS local e observabilidade

`infrastructure/messaging/sqs-client.ts` configura endpoint, região e credenciais
locais, com até três tentativas do SDK. `retry-policy.ts` classifica falhas e
calcula o atraso do consumidor. `event-publisher.ts` envia eventos; em FIFO,
usa a carteira como grupo e o `eventId` como deduplication ID.

As filas são `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e
`wager-events.fifo`. A ordenação FIFO ajuda, mas o banco garante a correção
inclusive com grupos distintos para a mesma carteira.

`observability/telemetry.ts` escreve logs JSON com campos permitidos e mantém
contadores, histogramas e gauges locais ao processo. Medimos resultados,
duplicatas, retries, DLQ, locks, latência, atraso da outbox e divergências.
Não usamos IDs individuais como labels das métricas.

`health-service.ts` verifica uma leitura SQL e acesso às filas com timeouts.
`health-controller.ts` expõe liveness, readiness e métricas na API. Workers
podem expor esses endpoints com `METRICS_PORT`, uma porta por processo.
Liveness indica que o processo responde; readiness indica acesso às dependências.

## 9. Arquivos de apoio e testes

| Arquivo/pasta | Como usar e por que existe |
| --- | --- |
| `package.json` / `bun.lock` | Scripts e versões fixadas das dependências |
| `tsconfig.json` / `tsconfig.build.json` | Tipagem estrita e compilação do runtime para `dist/` |
| `eslint.config.js` | Regras estáticas de qualidade do código |
| `.env.example` | Configuração pública exclusivamente local; `.env` fica ignorado |
| `compose.yaml` | PostgreSQL e MiniStack locais |
| `AGENTS.md` | Convenções de código, commits e explicações em português |
| `scripts/migrate.ts` | Aplica/reverte migrations com o usuário dono do schema |
| `scripts/init-queues.ts` | Cria filas e configura DLQ/redrive |
| `scripts/demo.ts` | Exercita HTTP/SQS e verifica o resultado financeiro final |
| `scripts/generate-api-docs.ts` | Regenera OpenAPI e arquivos Postman |
| `scripts/docs/postman-collection.ts` | Fonte da collection, incluindo variáveis e assertions |
| `docs/openapi.json` e arquivos Postman | Artefatos públicos gerados a partir das fontes |
| `ARCHITECTURE.md` | Decisões, alternativas, consequências e limites |
| `prd/README.md`, `ANALISE.md`, `tasks/` | PRD autoral, estudo e histórico do planejamento |

`tests/unit/` verifica domínio, hashes, eventos, telemetria, ciclo de vida e
documentação sem PostgreSQL/SQS. `tests/integration/` usa banco e filas reais
locais. `tests/concurrency/` provoca disputas de saldo/keys e três processos.
`tests/recovery/` interrompe processos nas janelas críticas e verifica retomada.

Em `tests/support/`, `test-database.ts` cria/migra/remove bancos exclusivos;
`test-queues.ts` faz isso com filas; `process-harness.ts` e `worker-process.ts`
controlam subprocessos; `failure-injection.ts` fornece barreiras de falha.
Testar recuperação exige controlar exatamente onde a interrupção ocorre.

## 10. Caminho sugerido para estudar

1. Leia `money.ts`, `wallet.ts` e `wallet-ledger-entry.ts`; acompanhe seus testes unitários.
2. Leia `open-wallet.ts`, depois `process-wager.ts`, `idempotency.ts` e `apply-wager.ts`.
3. Abra a unidade de trabalho e as migrations para entender o que o banco protege.
4. Acompanhe os exemplos de [fluxos financeiros](FLUXOS_FINANCEIROS.md).
5. Leia consumidor, publisher e testes de recuperação para entender o ack e as duplicatas.
6. Use Swagger/Postman seguindo [TESTING.md](TESTING.md) e confira ledger/reconciliação.

Autenticação com IdP, implantação AWS/IAM, frontend, conversão cambial,
partidas dobradas, dashboard, OpenTelemetry e teste de carga não fazem parte
da implementação atual. As evidências locais estão em [VALIDATION.md](VALIDATION.md).
