# Plano de implementação — WagerLedger

Estado: execução autorizada pelo usuário. O PRD autoral está em `../README.md`;
o estudo em `../ANALISE.md`; a arquitetura pública em `../../ARCHITECTURE.md`.
Esta pasta é pública; o enunciado original permanece ignorado em `readme_da_vaga/`.

## Resultado esperado

Backend executável via Compose que processe HTTP e SQS pelo mesmo caso de uso,
com PostgreSQL garantindo concorrência, idempotência, ledger e eventos atômicos.
Entrega exige evidências reais de unidade, integração, concorrência e falhas.

## Decisões e limites

Propor MikroORM, Money com bigint, NUMERIC(20,2), lock pessimista por wallet,
contexto isolado por job, inbox e outbox SQL. Validar versões e emulador no
bootstrap. O usuário decidiu adiar IdP e priorizar os requisitos pontuados.
Decisões ainda abertas no estudo devem ser fechadas antes das tarefas afetadas.

## Dependências e etapas

1. Ambiente e compatibilidade: Bun/Nest/MikroORM/PostgreSQL/SQS.
2. Primeiro caminho completo: criar wallet com OPENING, ledger e consulta.
3. Caminho crítico: BET via HTTP, idempotência persistente e corrida 100/80/80.
4. Completar operações, referências fora de ordem e consultas/reconciliação.
5. SQS com inbox, retry, DLQ e shutdown; publicar outbox concorrentemente.
6. Provar falhas e pelo menos três processos; fechar observabilidade e documentação.

As bases necessárias antecedem cada caminho; não construir toda a infraestrutura
antes de demonstrar uma operação financeira completa. Observabilidade começa
no bootstrap e recebe métricas à medida que cada fluxo nasce.

## Distribuição da janela de 2 dias e meio

| Bloco | Entrega verificável | Marco de saída |
| --- | --- | --- |
| Primeiro dia | Compatibilidade, domínio mínimo, wallet e BET | HTTP real + corrida de saldo + replay persistente |
| Segundo dia | Operações restantes, referências, inbox/outbox e consultas | HTTP e SQS compartilham invariantes; retry/DLQ demonstrados |
| Meio dia final | Crash recovery, 3 instâncias, observabilidade e documentação | Suite reproduzível e clone/setup validado |

Esse orçamento é uma ordem de prioridade, não uma promessa de duração por tarefa.
Reserva final é para falhas encontradas e reprodução da entrega, sem novos opcionais.

## Comandos alvo

Ainda não existem scripts ou Compose. Criá-los e validá-los no bootstrap;
não apresentar os comandos abaixo como já disponíveis.

| Comando planejado | Finalidade |
| --- | --- |
| `bun install --frozen-lockfile` | Instalação reproduzível após gerar lockfile |
| `bun run build` | Build compatível com NestJS |
| `bun run typecheck` | TypeScript estrito |
| `bun run lint` | Verificação de estilo e erros |
| `bun run start:dev` | Desenvolvimento local |
| `bun run start:api` | Papel HTTP |
| `bun run start:worker` | Consumo e processamento assíncrono |
| `bun run migration:up` / `bun run migration:down` | Aplicar/reverter migrations |
| `bun run test:unit` | Domínio e contratos puros |
| `bun run test:integration` | PostgreSQL e SQS em containers |
| `bun run test:concurrency` | Corridas e três ou mais processos |
| `bun run test:recovery` | Mortes, reinícios e redelivery |
| `docker compose up -d --build` | Ambiente completo |

## Estilo e fronteiras

Classes e tipos em PascalCase; métodos e variáveis em camelCase; arquivos em
kebab-case. Domínio com factories, estado encapsulado e transições explícitas:

```ts
const wager = WagerTransaction.create(props);
wager.reject(FailureCode.InsufficientFunds);
```

Sempre: validar contratos, proteger invariantes no SQL, testar cada incremento
e fazer commit coerente em português. Consultar o usuário para alterar escopo
da entrega ou regras já combinadas. Nunca: dinheiro em Number, segredos no Git,
ledger mutável, idempotência somente em memória ou publicação antes do commit.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Bun/decorators/ORM incompatíveis | Smoke test antes do domínio e versões fixadas |
| Emulador não reproduz FIFO/DLQ | Prova de capacidades no início e alternativa permitida pelo PRD |
| Locks em ordem inversa | Política única documentada e teste concorrente com referências |
| Contexto ORM compartilhado | Fork por requisição/job e por retry |
| Replays/pending sem contrato claro | Fechar snapshots antes de persistir resultados |
| Reconciliação e cursor inconsistentes | Snapshot único e sequência por wallet |
| Outbox publica e morre | eventId persistido e teste de duplicação segura |
| Prazo consumido por opcionais | Critérios obrigatórios como marco de saída |

## Revisão e aceite

Revisar proposta técnica e interpretações com o usuário antes de implementar.
Marcos do todo exigem testes, build e documentação atualizados. O aceite final
combina todas as evidências de `../ANALISE.md` e nenhuma falha eliminatória.
