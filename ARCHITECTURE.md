# Arquitetura do WagerLedger

## Estado

Implementação verificada em 03/10/2026 com Bun 1.4.2, NestJS 12.1.2,
MikroORM 7.2.3, TypeScript 5.9.3, PostgreSQL 18 e MiniStack 1.5.18.
HTTP, SQS, referências, outbox, observabilidade e recuperação estão implementados.
As imagens Docker são fixadas por digest. Evidências e limites da verificação
estão em [docs/VALIDATION.md](docs/VALIDATION.md).

## Objetivo e limites

Processar operações financeiras recebidas por HTTP e SQS mantendo saldo,
transação, ledger, inbox e outbox consistentes. A janela de entrega é de
2 dias e meio. Os requisitos obrigatórios têm prioridade sobre diferenciais.

Os exemplos e cenários financeiros usam BRL. Money valida códigos de moeda
e rejeita operações entre moedas distintas; não há conversão cambial.
Frontend, partidas dobradas, dashboard, OpenTelemetry e teste de carga
ficaram fora do escopo desta entrega.

## Decisões adotadas

| Decisão | Motivação | Consequência e alternativa |
| --- | --- | --- |
| Um projeto NestJS com entradas HTTP e workers | Compartilhar os mesmos casos de uso | Papéis executáveis separadamente, sem criar microserviços nesta entrega |
| MikroORM | Controle transacional explícito e compatibilidade provada com Bun/NestJS | Contexto isolado por execução/retry; SQL explícito para constraints, inbox/outbox e reconciliação |
| Money imutável com centavos em `bigint` | Aritmética exata em escala fixa de duas casas | JSON usa strings; Decimal seria alternativa com precisão configurada |
| Persistência em `NUMERIC(20,2)` e moeda separada | Representação exata e verificável por SQL | Validar limites antes da escrita; nunca converter valores financeiros para `number` |
| Lock pessimista da linha da wallet | Serializar operações da mesma carteira entre processos | Hot wallets têm espera; wallets distintas continuam concorrentes |
| Idempotência e inbox persistentes | Redelivery e HTTP concorrente sobrevivem a reinícios | Constraints únicas são a garantia final |
| Transactional outbox | Não perder eventos depois de confirmar o saldo | Publicação pode repetir; consumidores deduplicam pelo `eventId` |
| MiniStack 1.5.18 | Testes reais comprovaram FIFO, deduplicação, visibilidade e DLQ | Setup local sem token externo; teste no serviço AWS e deployment ficam fora desta validação |

## Organização

`src/domain/` contém Money, Wallet, WagerTransaction, WalletLedgerEntry,
InboxMessage, OutboxMessage, eventos e erros, sem dependências do NestJS ou ORM.
`src/application/` contém casos de uso e portas transacionais.
`src/infrastructure/` contém persistência, mappings, migrations, SQS e observabilidade.
`src/interfaces/` contém controladores HTTP, validação e entradas dos workers.
`tests/` separa unidade, integração, concorrência e recuperação após falhas.

Factories criam ou reidratam entidades. Transições de estado ficam nas classes
do domínio. Entidades de persistência não substituem as entidades do domínio.

## Fronteira transacional

1. Validar contrato e construir hash SHA-256 do JSON canônico dos campos de negócio.
2. Abrir contexto isolado do ORM e transação SQL; bloquear a wallet.
3. Resolver idempotência e, para SQS, inbox; conferir o hash em duplicatas.
4. Validar identidade, moeda, referência, reversão e disponibilidade de saldo.
5. Persistir decisão, snapshot de resposta, eventual saldo/ledger e eventos na outbox.
6. Confirmar a transação antes de responder ou executar `DeleteMessage` no SQS.

Uma rejeição de negócio é resultado persistido, com failureCode e evento,
sem movimentação financeira. Falhas transitórias provocam rollback e retry
limitado com contexto novo. Violações de unicidade concorrentes exigem rollback
e leitura da operação vencedora; não se continua uma transação SQL abortada.

HTTP, SQS e reprocessamento de referências usam a mesma ordem de locks:
wallet antes das transações financeiras associadas. Workers de referências
descobrem candidatos sem manter locks financeiros em ordem inversa.

Cada execução usa `em.fork()` e uma transação nova. O lock pessimista da wallet
é adquirido antes de verificar saldo e referências. `lock_timeout=2s` e
`statement_timeout=5s` limitam a espera; abertura de conexão tem timeout de 2s.
Deadlock, falha de serialização, timeout de lock e corrida de unicidade podem
provocar até três tentativas, com backoff de 20/40ms e rollback entre elas.
Esses limites controlam tentativas individuais, sem prometer um SLA de ponta a ponta.

## Garantias no banco

- Wallet única por `(player_id, currency)` e saldo não negativo.
- Unicidade de idempotency key e de `(provider_id, external_transaction_id)`.
- Inbox única por `(consumer_name, message_id)`, com hash persistido.
- No máximo um ledger por `(wallet_id, transaction_id)`.
- Reversão única por referência e tipo quando efetivamente processada.
- Foreign keys, checks de status, valores e aritmética do ledger.
- Trigger que bloqueie UPDATE e DELETE do ledger; role da aplicação sem TRUNCATE.
- Validação adiada até o commit de saldo igual à soma assinada do ledger.
- Operação financeira processada com exatamente um lançamento, valor e direção
  compatíveis; operações não processadas e LOSS sem lançamento.
- Referências processadas com vínculos, tipo e valor corretos; rollback com
  direção inversa ao movimento original.
- Pedido original, snapshot de resposta, estados terminais e conteúdo da outbox
  protegidos contra alterações.

As três migrations têm `up/down` testados em bancos descartáveis. Constraints
deferidas permitem inserir transação/ledger/estado durante o mesmo commit,
sem exigir que cada escrita intermediária já represente o resultado completo.
A role da aplicação tem as permissões necessárias à execução, sem permissões
para alterar o schema, desabilitar triggers ou apagar o histórico financeiro.
O dono do schema é usado separadamente para migrations.

A verificação de saldo soma o histórico da carteira em cada movimento.
Essa escolha privilegia uma defesa verificável no banco, com custo proporcional
ao número de lançamentos da carteira; carteiras com histórico extenso precisam
de profiling antes de definir uma meta de throughput. Uma alternativa é validar
incrementos e checkpoints auditados, com invariantes adicionais. A implementação
atual não apresenta essa otimização como já entregue.

## Mensageria e recuperação

FIFO usa `MessageGroupId = walletId`; a deduplicação do broker é uma otimização.
Referência ausente será persistida como PENDING_REFERENCE e a mensagem confirmada
após commit, permitindo que a referência avance na fila. Um worker fará retry
com backoff persistido: 1 segundo inicial, exponencial limitado a 5 minutos,
até 20 tentativas ou 24 horas de TTL, o que ocorrer primeiro. Na ausência de
interrupções, o limite de tentativas encerra antes do TTL; o TTL limita também
pendências após indisponibilidade prolongada. Esgotamento gera REFERENCE_NOT_FOUND,
rejeição e evento no mesmo commit, sem lançamento. A política é injetável para
testes com relógio controlado. Candidatos são descobertos sem lock; estado e
agendamento são novamente conferidos sob o lock da carteira. Não há retry
financeiro apenas porque o cliente repetiu uma submissão já aceita.

Publishers usam `FOR UPDATE SKIP LOCKED` na outbox. A implementação mantém
o lock durante uma publicação com timeout curto, marcando publicação no mesmo
commit. Isso evita disputa entre publishers vivos, mas pode repetir o evento
se o processo morrer depois do envio. Leasing é alternativa se os testes
mostrarem contenção ou transações longas. Falhas não descartam eventos silenciosamente.

Rejeição de negócio recebe ack após commit, com auditoria e evento. Erro
transitório provoca rollback e backoff de visibilidade entre 1 e 60 segundos,
com limite padrão de cinco entregas. Esgotamento segue para DLQ sem transformar
a operação em FAILED: após recuperar a dependência, o comando pode ser reenviado.
Contrato inválido e conflito de identidade seguem para DLQ sem inventar uma
operação financeira válida.

Erro de infraestrutura classificado como permanente tenta registrar FAILED,
failureCode, inbox e evento em uma nova transação sem movimentação financeira.
Uma operação já terminal preserva sua decisão. Se o banco não permitir gravar
a auditoria, o consumidor não confirma a mensagem; o redrive do broker pode
encaminhá-la à DLQ após o limite configurado, sem uma auditoria SQL confirmada.
Classes SQL 22, 23 e 42 são permanentes para o consumidor; os demais erros
de infraestrutura são tratados como transitórios. A política é deliberadamente
conservadora e deve ser revista para novos adaptadores de produção.

No envio explícito à DLQ, a origem só é removida após confirmação do envio.
Se a auditoria FAILED confirmar e a DLQ falhar, o redelivery consulta o estado
atual e tenta novamente. Esse estado interno é separado do snapshot original
de resposta, que pode continuar indicando um aceite PENDING_REFERENCE.
SIGTERM interrompe novas leituras e conclui operações em andamento ou devolve
sua visibilidade.

API e workers possuem executáveis separados (`start:api`, `start:worker`).
`WORKER_ROLES=consumer,publisher,reference` seleciona os papéis; várias instâncias
podem executar os mesmos papéis. Shutdown cancela o long polling, devolve
mensagens recebidas após a solicitação e aguarda operações em andamento antes
de fechar SQS/ORM. No Windows, o teste de encerramento gracioso usa IPC para
acionar o handler SIGTERM; não é evidência de entrega de sinais POSIX pelo SO.
Testes de morte abrupta usam encerramento real do subprocesso.
Recuperação da outbox é testada também com destino standard para observar
duplicação real sem depender da janela de deduplicação FIFO. Em ambos os casos,
consumidores precisam deduplicar eventId. Publishers concorrentes não garantem
ordem global de publicação; eventos de saldo carregam walletVersion para que
consumidores detectem eventos antigos e evitem regressão de projeções.
O harness utiliza [Bun.spawn e IPC](https://bun.com/docs/runtime/child-process).

## Contratos e leituras

Valores financeiros exigem strings decimais canônicas com exatamente duas casas,
sem espaços, sinal positivo ou zeros extras à esquerda. BET/WIN/REFUND/ROLLBACK
exigem valor positivo; LOSS pode ter zero. OPENING só existe com saldo inicial
positivo. O limite é 999999999999999999.99, compatível com NUMERIC(20,2).

Replay usa o snapshot original de submissão, incluindo saldo e código HTTP.
Uma aceitação PENDING_REFERENCE continua sendo replay de seu aceite original;
GET de transação retorna o estado atual e permite acompanhar a resolução.
Keys têm unicidade global; recomenda-se prefixo de provider, sem gerá-lo
automaticamente no lugar do header. A identidade externa também é única.
WIN com referência valida BET processada e os mesmos vínculos; sem referência
é permitido. Referência existente ainda pendente e compatível aguarda;
identidade divergente rejeita imediatamente, mesmo se a referência estiver
pendente. Referência terminal sem aprovação rejeita com REFERENCE_NOT_PROCESSED.
Reversões continuam únicas por tipo: um REFUND e um ROLLBACK da mesma BET são
permitidos, conforme a interpretação explícita do PRD. Unicidade global entre
tipos exigiria uma alteração do contrato de negócio.

Reconciliação compara saldo e ledger no mesmo snapshot de leitura e não corrige
divergências. Ledger usa paginação por cursor base64url com versão do formato,
carteira, sequência anterior e limite superior fixado na primeira página.
A ordem é crescente por sequência; inserções posteriores ficam para uma nova
navegação. O cursor é validado, mas não assinado e não representa autorização.

## Autenticação e observabilidade

O usuário decidiu adiar IdP nesta entrega, conforme permitido pelo desafio,
e priorizar os requisitos pontuados. A implementação mantém uma porta
explícita de identidade para futura integração OIDC. Health continua aberto;
mensagens internas continuam sujeitas à validação da identidade de domínio.

A porta ProviderIdentityPort recebe o provider declarado e o header Authorization;
DeclaredProviderIdentity é explicitamente no-op nesta entrega, sem autenticação.
Um adaptador OIDC deverá verificar assinatura via JWKS, issuer, audience,
expiração e escopos do token emitido pelo IdP externo, mapear a identidade
verificada para um providerId e rejeitar divergências com o payload. Os GETs e
criação de carteira deverão receber guards/autorizações de escopo apropriado;
health permanece aberto. SQS é canal interno com permissão IAM separada e mantém
validação de domínio. Nenhum token, credencial ou senha é armazenado pelo domínio.

Os logs de processamento são JSON com IDs de correlação/mensagem/transação,
sem payload financeiro completo ou credenciais. Os logs de inicialização do
NestJS e das migrations mantêm o formato dessas bibliotecas.
Métricas cobrem status, duplicatas, retries, DLQ, conflitos/espera de locks,
outbox lag, latência e divergências de reconciliação. São locais a cada processo
e reiniciam junto dele; não representam totais históricos persistidos.
Labels usam categorias limitadas, sem IDs de jogador/carteira como dimensão.

Liveness responde sem consultar dependências. Readiness verifica uma leitura
SQL e acesso às filas SQS com timeout; indisponibilidade retorna 503.
Workers expõem seus próprios endpoints quando METRICS_PORT é configurado.
Outbox lag é atualizado durante os ciclos do publisher e mede o evento mais
antigo ainda não publicado. Não há collector OpenTelemetry nem servidor
Prometheus incluído no Compose.

## Limites da entrega

As validações locais usam PostgreSQL e SQS emulado com subprocessos reais.
Não houve implantação na AWS, teste de carga, teste de partição prolongada de
rede nem integração com um IdP. A janela de visibilidade padrão é de 30 segundos;
operações excepcionalmente longas podem receber entrega concorrente, resolvida
pelos locks e pela idempotência persistente. Não há heartbeat de extensão da
visibilidade nesta versão. A outbox retém eventos publicados e as inboxes não
têm política automática de expurgo; retenção e arquivamento são decisões futuras.

## Referências técnicas

- [PostgreSQL: locks de linha](https://www.postgresql.org/docs/current/explicit-locking.html).
- [PostgreSQL: SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html).
- [MikroORM: transações e concorrência](https://mikro-orm.io/docs/transactions).
- [NestJS: integração MikroORM](https://docs.nestjs.com/recipes/mikroorm).
- [SQS: visibilidade e redelivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html).
- [SQS FIFO: janela de deduplicação](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html).
- [LocalStack: token obrigatório](https://docs.localstack.cloud/aws/getting-started/auth-token/).
- [MiniStack: suporte SQS](https://ministack.org/docs/services/sqs).
