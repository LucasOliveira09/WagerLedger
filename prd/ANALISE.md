# Estudo do PRD — WagerLedger

Data: 03/10/2026. Referência: enunciado original preservado localmente em
`../readme_da_vaga/README.md`. O PRD autoral está em `README.md` desta pasta.
Este estudo interpreta o desafio; não declara funcionalidades implementadas.

## Premissas de trabalho

- Entrega de backend em 2 dias e meio, priorizando todos os requisitos obrigatórios.
- Sem frontend requerido; TanStack aparece na apresentação da empresa, não na stack obrigatória.
- BRL pode reduzir o escopo operacional, mantendo domínio multi-moeda e testes de conflitos.
- Autenticação é opcional e não pontua; o usuário decidiu entregar sem IdP, com ponto de extensão documentado.
- PRD autoral e planejamento em `prd/` são públicos; o enunciado original fica ignorado.
- Documentação pública terá setup real e decisões técnicas; commits terão prefixo em inglês e texto em português.

## Leitura de todas as seções

| Seção | Exigência | Implicação para a entrega |
| --- | --- | --- |
| 1 — Visão | Serviço financeiro distribuído correto sob duplicação, desordem e concorrência | Demonstração precisa incluir falhas e múltiplas instâncias |
| 2 — Auth | IdP externo se implementado; alternativa sem auth documentada e extensível | Evitar auth artesanal; health aberto e identidade de domínio sempre validada |
| 3 — Domínio | Entrega at-least-once; sem duplicar dinheiro, perder eventos ou saldo negativo | PostgreSQL é fonte final de garantias |
| 4 — Stack | Bun 1.x, TS estrito, NestJS, PostgreSQL, SQS, Compose e migrations reversíveis | MikroORM preferencial; TypeORM aceito; Prisma proibido |
| 5 — Restrições | Exatidão, idempotência persistente, ledger imutável, locks locais e constraints SQL | SQL precisa ser testado por escrita direta, não apenas via API |
| 6 — Modelagem | Classes encapsuladas com factories e rehydrate; Money e ledger imutáveis | Domínio independente de framework e ORM |
| 7 — Negócio | BET/WIN/LOSS/REFUND/ROLLBACK, validação de referência e replay original | Rejeições e pendências persistidas; failureCode estável |
| 8 — Concorrência | Wallet como unidade; três ou mais instâncias | Testes de corrida reais, inclusive disputa 100/80/80 |
| 9 — HTTP | Criação, consultas, operações, reconciliação e health | Distinguir validação, conflito, rejeição, pendência e indisponibilidade |
| 10 — SQS | Mesmo caso de uso, inbox, ack após commit, retry, DLQ e shutdown | Redelivery e SIGTERM entram na demonstração |
| 11 — Outbox | Evento gravado atomicamente; publishers concorrentes e crash recovery | Quatro eventos concretos com envelope versionado |
| 12 — Observabilidade | Logs JSON, métricas mínimas, liveness/readiness | Logs sem dados sensíveis ou payload financeiro completo |
| 13 — Testes | Unidade, PostgreSQL/SQS reais, concorrência e reinícios | Mocks não substituem as provas de integração |
| 14 — Avaliação | 100 pontos e falhas eliminatórias | Opcionais só após correção e recuperação comprovadas |

## Priorização pela avaliação

| Área | Pontos | Prova mínima |
| --- | --- | --- |
| Correção financeira | 20 | Money exato, operações/reversões e reconciliação |
| Concorrência | 20 | Disputa de saldo, wallets distintas e pelo menos 3 processos |
| Idempotência | 15 | 50 duplicatas simultâneas, replay e conflito de payload |
| Mensageria e falhas | 15 | Inbox, outbox, retry/DLQ, crash e shutdown |
| Modelagem e arquitetura | 10 | Factories, invariantes, portas e justificativas |
| Testes | 10 | Integração real e experimentos de falha repetíveis |
| Observabilidade | 5 | Logs, métricas e health inspecionáveis |
| Documentação | 5 | Setup reproduzível, decisões, trade-offs e limitações |

Os quatro primeiros blocos somam 70 pontos e concentram os riscos eliminatórios.

## Operações e invariantes

| Operação | Saldo | Ledger | Referência |
| --- | --- | --- | --- |
| OPENING | Crédito inicial | CREDIT se saldo inicial maior que zero | Interna; nunca aceita nos transportes |
| BET | Débito | DEBIT | Rejeita insuficiência de saldo |
| WIN | Crédito | CREDIT | Pode referenciar BET da rodada |
| LOSS | Sem mudança | Nenhum | Resultado registrado e evento de processamento |
| REFUND | Crédito | CREDIT | BET processada, mesmo valor, uma vez por tipo |
| ROLLBACK | Inverso | Direção inversa | BET/WIN/REFUND processada, mesmo valor, uma vez por tipo |

Referência resolvida por provider e ID externo, validando provider, player,
wallet, moeda e rodada. Reversão que causaria saldo negativo é rejeitada com
código diferente de BET sem saldo. Sem reversões parciais.

Wallet é única por player/moeda. Version começa em 1, inclusive com OPENING,
e só aumenta em mudanças posteriores de saldo. LOSS, rejeição e replay
não aumentam version. Estados PROCESSED, REJECTED e FAILED são terminais.

Transições propostas: PENDING para PROCESSED, REJECTED, FAILED ou PENDING_REFERENCE;
PENDING_REFERENCE para PROCESSED, REJECTED ou FAILED; nova tentativa sem resolução
mantém PENDING_REFERENCE e atualiza o agendamento. Não voltar a PENDING para
simular um processamento novo. Falha transitória não deve virar FAILED terminal.

Money interno pode ser negativo para aritmética e diferença de reconciliação;
contratos de entrada rejeitam negativos. Escala de saída sempre 2. Valores com
mais casas são rejeitados, sem arredondamento silencioso. A representação proposta
é bigint em centavos; os esqueletos do PRD permitem adaptar a implementação.

## Inventário HTTP

| Método e rota | Aceite |
| --- | --- |
| POST /wallets | Wallet, OPENING e ledger atômicos; duplicata é conflito |
| GET /wallets/:walletId | Saldo string, moeda e version |
| GET /wallets/:walletId/ledger | Cursor opaco, ordem estável, limites validados |
| GET /wagering/transactions/:transactionId | Estado e failureCode auditáveis |
| GET /providers/:providerId/wagering/transactions/:externalTransactionId | Busca pela identidade externa composta |
| POST /wagering/transactions | Header obrigatório e replay persistente |
| POST /wallets/:walletId/reconciliation | Snapshot consistente, diferença assinada, sem correção automática |
| GET /health/live | Vida do processo, sem depender de disponibilidade externa |
| GET /health/ready | PostgreSQL e SQS realmente alcançáveis |

Proposta de códigos: 201 criação de wallet; 200 operação processada/consultas;
202 pendente; 400 contrato inválido; 404 recurso de consulta ausente;
409 conflito; 422 rejeição de negócio; 503 infraestrutura transitória.
Replay preserva status HTTP e snapshot original, mudando apenas o indicador
idempotentReplay. Os contratos exatos serão fixados antes dos controladores.

## Idempotência, transações e eventos

- Header HTTP é obrigatório e autoritativo; não substituí-lo silenciosamente pelo default recomendado.
- Key precisa de escopo documentado; proposta inicial de unicidade global com prefixo do provider recomendado.
- Também garantir unicidade de provider + externalTransactionId; key nova não pode movimentar a mesma operação outra vez.
- Hash SHA-256 sobre JSON canônico: chaves ordenadas recursivamente, somente campos de negócio, ausências opcionais normalizadas e sem metadados/header.
- Mesma key e hash igual: replay. Hash divergente: conflito. O saldo retornado não é recalculado.
- Inbox deduplica messageId por consumer e também verifica hash; key financeira continua protegendo mensagens com IDs diferentes.
- Contexto ORM novo para cada requisição, job e retry evita compartilhar entidades mutáveis.
- Persistir transaction, eventual wallet/ledger, inbox e outbox no mesmo commit.
- Eventos: WagerTransactionProcessed, WagerTransactionRejected, WalletBalanceChanged e WagerTransactionPendingReference.
- WalletBalanceChanged ocorre apenas se o saldo muda; LOSS ainda gera WagerTransactionProcessed.
- Cada evento tem subclasse, eventId, aggregateId, correlationId, causationId opcional, occurredAt, version e dados JSON estáveis.
- Publisher pode repetir evento após morte entre envio e marcação; eventId estável permite consumo idempotente.
- Destino dos eventos deve ser separado da fila de comandos para evitar consumo recursivo acidental.

## Armadilhas e interpretações a fechar

1. Referência fora de ordem em FIFO: persistir pendência e dar ack após commit. Esperar a referência na mesma mensagem pode bloquear o grupo que a contém.
2. Replay após outras apostas: devolver saldo original, não saldo atual.
3. Replay de PENDING_REFERENCE: decidir entre snapshot original de aceite e representação final; GET sempre serve para consultar estado atual.
4. REFUND e ROLLBACK da mesma referência: o texto limita por tipo. Não ampliar essa restrição sem decisão explícita.
5. Referência existente mas ainda pendente: aguardar; referência terminal rejeitada/failed: propor rejeição distinta de referência inexistente.
6. WIN com referência fornecida: validar vínculo e tipo; sem referência continua permitido pelo PRD.
7. Valores zero de operações financeiras: o PRD rejeita negativos, mas não define zero. Fechar regra antes dos testes, conciliando ledger e version.
8. Valores máximos: NUMERIC(20,2) impõe teto. Validar entrada e overflow de saldo antes de gravar; domínio usa exatidão, não Number.
9. Reconciliação sob escrita concorrente: duas consultas em snapshots diferentes podem inventar uma divergência.
10. Cursor por data isolada: empates e timestamps anteriores ao commit podem tornar paginação instável. Preferir sequência de ledger por wallet, alocada sob seu lock.
11. Retry e lock: manter ordem única wallet → transaction; não deixar worker de referência adquirir a ordem inversa.
12. Ack perdido após commit: redelivery consulta registros persistidos e não aplica efeitos novamente.
13. Poison message sem identidade válida: DLQ com motivo; não inventar transação financeira para payload ilegível.
14. Imutabilidade SQL: testar UPDATE/DELETE bloqueados e role sem TRUNCATE, não somente campos readonly.
15. Outbox: não descartar eventos ao esgotar retry; sinalizar falha operacional e preservar recuperação.
16. FAILED auditável: diferenciar falha permanente de infraestrutura de rejeição de domínio; política será fechada com o consumidor.

Taxonomia inicial a avaliar: INSUFFICIENT_FUNDS, REVERSAL_INSUFFICIENT_FUNDS,
CURRENCY_MISMATCH, WALLET_IDENTITY_MISMATCH, REFERENCE_MISMATCH,
REFERENCE_KIND_INVALID, REFERENCE_NOT_PROCESSED, REFERENCE_NOT_FOUND,
REVERSAL_ALREADY_APPLIED, AMOUNT_MISMATCH, AMOUNT_OUT_OF_RANGE.
Conflitos de idempotência usam errorCode de transporte/aplicação, sem alterar
a transação financeira que já foi confirmada.

## Evidências obrigatórias

- 50 submissões simultâneas da mesma BET: uma aplicação, um débito e replay consistente.
- Saldo 100, duas BET de 80: uma PROCESSED, uma REJECTED, saldo 20 e um débito.
- Carteiras distintas em paralelo, sem lock global.
- Três ou mais processos concorrentes com PostgreSQL compartilhado.
- Worker morto após commit e antes do ack: redelivery sem duplicação.
- Dois publishers da outbox e morte após commit financeiro antes da publicação.
- REFUND e ROLLBACK anteriores à referência: resolução eventual ou rejeição por prazo.
- Retry, DLQ, reinício e shutdown: recuperação sem perda dos registros.
- Constraints e migrations up/down contra PostgreSQL real.
- Atomicidade com falha injetada entre etapas de persistência.
- Ao final de cada cenário: saldo armazenado igual ao reconstruído pelo ledger.

## Ambiente observado

Docker Engine 29.6.1 e Compose v5.3.0 respondem. Node v24.13.1 está disponível.
Bun não foi encontrado no PATH nem em `.bun/bin/bun.exe`; preparar Bun 1.x
é a primeira tarefa. O remoto já aponta para o GitHub do WagerLedger.
Não foram instaladas dependências nem iniciados containers durante este estudo.

LocalStack atual exige token segundo sua documentação; MiniStack declara suporte
a SQS. Escolher imagem fixada somente após provar FIFO, redelivery e DLQ.
Não assumir que a declaração de suporte do emulador substitui esses testes.

Fontes oficiais e proposta de arquitetura: `../ARCHITECTURE.md`.
