# PRD — WagerLedger

## Objetivo

Entregar um backend financeiro distribuído que processe transações de apostas
por HTTP e SQS, mantendo saldo, ledger e eventos consistentes sob duplicação,
concorrência, entrega fora de ordem e reinício de processos.

## Escopo obrigatório

- Carteira única por jogador e moeda; abertura com crédito auditável.
- BET, WIN, LOSS, REFUND e ROLLBACK com validações e rejeições persistidas.
- Money exato, contratos em strings decimais e saldo nunca negativo.
- Idempotência persistente, conflito de payload e replay do resultado original.
- Ledger imutável no banco; consultas paginadas e reconciliação consistente.
- Entrada HTTP e SQS pelo mesmo caso de uso; inbox, retry, DLQ e shutdown.
- Transactional outbox e publicação recuperável com múltiplos publishers.
- Logs estruturados, métricas e health de liveness/readiness.
- Testes com PostgreSQL e SQS reais, corridas e pelo menos três processos.

## Stack e decisões de escopo

Bun 1.x, TypeScript estrito, NestJS, PostgreSQL, MikroORM e Docker Compose.
O emulador SQS será validado entre MiniStack e LocalStack.
BRL será a moeda operacional inicial, com domínio capaz de detectar conflitos
de moeda. A entrega não inclui IdP; uma porta de identidade e o desenho de
integração futura serão documentados. Frontend e diferenciais são posteriores
aos critérios obrigatórios.

## Critérios de aceite

1. Duas BET de 80 sobre saldo 100 produzem uma aprovação, uma rejeição,
   saldo 20 e exatamente um débito.
2. Cinquenta submissões simultâneas da mesma operação não repetem efeitos.
3. HTTP, fila e workers mantêm garantias com três ou mais processos.
4. Morte após commit, redelivery e eventos duplicados permitem recuperação segura.
5. Referências fora de ordem são resolvidas ou rejeitadas por prazo documentado.
6. Todo cenário financeiro termina com saldo igual ao reconstruído pelo ledger.
7. Build, tipos, lint e suites obrigatórias passam com setup reproduzível.

## Documentos

- [Estudo e interpretações](ANALISE.md).
- [Plano](tasks/plan.md).
- [Tarefas e evidências](tasks/todo.md).
- [Arquitetura](../ARCHITECTURE.md).

Este PRD é a especificação autoral da solução. O enunciado original permanece
local e não integra os arquivos publicados.
