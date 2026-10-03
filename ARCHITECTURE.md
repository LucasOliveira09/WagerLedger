# Arquitetura do WagerLedger

## Estado

Proposta técnica elaborada em 03/10/2026 a partir do desafio. A aplicação ainda
não foi implementada; as garantias descritas abaixo precisam ser comprovadas
pelos testes. Versões de dependências e imagens serão fixadas no bootstrap.

## Objetivo e limites

Processar operações financeiras recebidas por HTTP e SQS mantendo saldo,
transação, ledger, inbox e outbox consistentes. A janela de entrega é de
2 dias e meio. Os requisitos obrigatórios têm prioridade sobre diferenciais.

Propõe-se começar com BRL nos contratos, mantendo Money preparado para
comparação e rejeição de moedas diferentes. Frontend, partidas dobradas,
dashboard, OpenTelemetry e teste de carga ficam para depois dos testes obrigatórios.

## Decisões propostas

| Decisão | Motivação | Consequência e alternativa |
| --- | --- | --- |
| Um projeto NestJS com entradas HTTP e workers | Compartilhar os mesmos casos de uso | Papéis executáveis separadamente, sem criar microserviços nesta entrega |
| MikroORM | Preferência do desafio e controle transacional explícito | Contexto isolado por requisição/job; TypeORM continua alternativa se a compatibilidade falhar |
| Money imutável com centavos em `bigint` | Aritmética exata em escala fixa de duas casas | JSON usa strings; Decimal seria alternativa com precisão configurada |
| Persistência em `NUMERIC(20,2)` e moeda separada | Representação exata e verificável por SQL | Validar limites antes da escrita; nunca converter valores financeiros para `number` |
| Lock pessimista da linha da wallet | Serializar operações da mesma carteira entre processos | Hot wallets têm espera; wallets distintas continuam concorrentes |
| Idempotência e inbox persistentes | Redelivery e HTTP concorrente sobrevivem a reinícios | Constraints únicas são a garantia final |
| Transactional outbox | Não perder eventos depois de confirmar o saldo | Publicação pode repetir; consumidores deduplicam pelo `eventId` |
| Emulador SQS escolhido por teste de compatibilidade | FIFO, visibilidade e DLQ precisam funcionar de verdade | MiniStack é candidato sem credencial; LocalStack atual exige token |

## Organização

`src/domain/` conterá Money, Wallet, WagerTransaction, WalletLedgerEntry,
InboxMessage, OutboxMessage, eventos e erros, sem dependências do NestJS ou ORM.
`src/application/` conterá casos de uso e portas transacionais.
`src/infrastructure/` conterá persistência, mappings, migrations, SQS e observabilidade.
`src/interfaces/` conterá controladores HTTP e entradas dos workers.
`tests/` separará unidade, integração, concorrência e recuperação após falhas.

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

HTTP, SQS e reprocessamento de referências usarão a mesma ordem de locks:
wallet antes das transações financeiras associadas. Workers de referências
descobrem candidatos sem manter locks financeiros em ordem inversa.

## Garantias planejadas no banco

- Wallet única por `(player_id, currency)` e saldo não negativo.
- Unicidade de idempotency key e de `(provider_id, external_transaction_id)`.
- Inbox única por `(consumer_name, message_id)`, com hash persistido.
- No máximo um ledger por `(wallet_id, transaction_id)`.
- Reversão única por referência e tipo quando efetivamente processada.
- Foreign keys, checks de status, valores e aritmética do ledger.
- Trigger que bloqueie UPDATE e DELETE do ledger; role da aplicação sem TRUNCATE.

Limites de valor e verificações entre tabelas serão fechados na migration.
Constraints locais não bastam, por si sós, para provar igualdade entre saldo
e soma do ledger: essa garantia combina transação, lock e testes de reconciliação.

## Mensageria e recuperação

FIFO usará `MessageGroupId = walletId`; a deduplicação do broker é uma otimização.
Referência ausente será persistida como PENDING_REFERENCE e a mensagem confirmada
após commit, permitindo que a referência avance na fila. Um worker fará retry
com backoff e prazo máximo configurável; esgotamento produzirá rejeição auditável.

Publishers usarão `FOR UPDATE SKIP LOCKED` na outbox. A proposta inicial mantém
o lock durante uma publicação com timeout curto, marcando publicação no mesmo
commit. Isso evita disputa entre publishers vivos, mas pode repetir o evento
se o processo morrer depois do envio. Leasing é alternativa se os testes
mostrarem contenção ou transações longas. Falhas não descartam eventos silenciosamente.

Erro de negócio recebe ack após commit; erro transitório recebe retry;
erro permanente vai para DLQ. Se houver envio explícito à DLQ, a mensagem original
só é removida após confirmação do envio. SIGTERM interrompe novas leituras
e conclui operações em andamento ou devolve sua visibilidade.

## Contratos e leituras

Replay terminal usa o snapshot original, incluindo saldo e código HTTP.
GET de transação retorna o estado atual. O replay de uma aceitação pendente
precisa ter política explícita antes da implementação, sem recalcular saldo.
Reconciliação compara saldo e ledger no mesmo snapshot de leitura e não corrige
divergências. Ledger usa paginação por cursor opaco e ordem total estável.

## Autenticação e observabilidade

O usuário decidiu adiar IdP nesta entrega, conforme permitido pelo desafio,
e priorizar os requisitos pontuados. A implementação deverá manter uma porta
explícita de identidade para futura integração OIDC. Health continua aberto;
mensagens internas continuam sujeitas à validação da identidade de domínio.

Logs JSON terão identificadores de correlação, sem payload financeiro completo
ou credenciais. Métricas cobrirão status, duplicatas, retries, DLQ, locks,
outbox lag e latência. Liveness e readiness terão verificações distintas.

## Pontos a fechar antes das respectivas implementações

Valores zero; referência ainda pendente ou rejeitada; referência opcional de WIN;
limites/TTL de retry; escopo da key; replay pendente; códigos HTTP e de falha;
paginação estável; destino e ordem dos eventos publicados. O PRD limita reversões
por tipo: não se imporá unicidade global entre REFUND e ROLLBACK sem documentar
uma mudança de interpretação.

## Referências técnicas

- [PostgreSQL: locks de linha](https://www.postgresql.org/docs/current/explicit-locking.html).
- [PostgreSQL: SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html).
- [MikroORM: transações e concorrência](https://mikro-orm.io/docs/transactions).
- [NestJS: integração MikroORM](https://docs.nestjs.com/recipes/mikroorm).
- [SQS: visibilidade e redelivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html).
- [SQS FIFO: janela de deduplicação](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html).
- [LocalStack: token obrigatório](https://docs.localstack.cloud/aws/getting-started/auth-token/).
- [MiniStack: suporte SQS](https://ministack.org/docs/services/sqs).
