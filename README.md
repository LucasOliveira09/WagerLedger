# WagerLedger

Processador financeiro distribuído de transações de apostas, com foco em
precisão monetária, idempotência persistente, concorrência entre instâncias
e consistência entre o saldo das carteiras e um ledger auditável.

## Escopo

- Processamento de apostas, ganhos, perdas, reembolsos e reversões.
- Entrada por API HTTP e AWS SQS.
- Registro financeiro auditável e reconciliação de saldo.
- Inbox e transactional outbox para recuperação após falhas.
- Testes de unidade, integração e concorrência real.

## Stack prevista

Bun 1.x, TypeScript em modo estrito, NestJS, PostgreSQL, AWS SQS via
LocalStack ou MiniStack e Docker Compose. A proposta usa MikroORM; as versões
e a compatibilidade serão validadas no bootstrap.

## Estado atual

Bootstrap NestJS validado com Bun 1.4.2. As operações financeiras estão em implementação.

## Desenvolvimento

Instale Bun 1.4.2 e execute:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run start:dev
```

A API inicia na porta 3000 (`PORT` permite alterar). Os endpoints financeiros
serão adicionados nos próximos incrementos. Acompanhe [as tarefas](prd/tasks/todo.md).

A proposta técnica, suas decisões e limitações estão em [ARCHITECTURE.md](ARCHITECTURE.md).
