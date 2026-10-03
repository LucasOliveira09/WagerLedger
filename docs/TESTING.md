# Como testar o WagerLedger

Você pode usar o Swagger no navegador, a collection do Postman ou a demonstração
por terminal. O Swagger e a collection cobrem os contratos HTTP; a demonstração
também envia um comando para o SQS emulado pelo MiniStack.

## 1. Iniciar o ambiente

Na raiz do repositório, com Bun 1.4.2 e Docker disponíveis:

```sh
bun install --frozen-lockfile
docker compose up -d --wait
bun run migration:up
bun run queues:init
bun run start:api
```

Em outro terminal, na mesma pasta:

```sh
bun run start:worker
```

A API usa a porta 3000 por padrão. O worker resolve referências pendentes,
consome comandos SQS e publica a outbox. Sem o worker, os cenários HTTP
imediatos funcionam, mas a referência fora de ordem não é resolvida.
Os valores de `.env.example` são os padrões locais; copie para `.env` caso
queira configurar portas/conexões conforme o [README](../README.md).

## 2. Testar com Postman

Importe estes dois arquivos pelo botão **Import** do Postman:

- [WagerLedger.postman_collection.json](WagerLedger.postman_collection.json).
- [WagerLedger.local.postman_environment.json](WagerLedger.local.postman_environment.json).

Selecione o ambiente **WagerLedger — local**. A variável `baseUrl` deve ser
`http://127.0.0.1:3000`; ajuste-a se mudou a porta da API. A collection usa
**No Auth**, pois esta entrega não implementa autenticação com IdP.

Para testar tudo, abra a collection, clique em **Run** e execute uma iteração
com todas as pastas, na ordem em que aparecem. Para localhost, use o aplicativo
desktop do Postman ou seu Desktop Agent. Não é necessário copiar IDs manualmente:
a requisição de criação gera um UUID novo de jogador e execução e salva os IDs
na collection. Não crie variáveis de ambiente com os mesmos nomes desses IDs,
pois elas podem sobrescrever os valores da collection.

Também é possível clicar em **Send** em cada requisição, seguindo a ordem.
Se quiser começar novamente, execute **01 — Criar carteira com 100.00 BRL**.
Isso prepara uma execução nova e mantém o histórico da anterior.

| Pasta | O que observar |
| --- | --- |
| 00 — Disponibilidade | Live 200; readiness com PostgreSQL/SQS disponíveis; métricas em texto |
| 01 — Carteira, idempotência e operações | BET, replay, conflitos, rejeição, consultas, WIN, LOSS, REFUND, ROLLBACK, paginação e reconciliação |
| 02 — Referência fora de ordem | REFUND 202 antes da BET; worker resolve; GET mostra PROCESSED; replay mantém o aceite original 202 |
| 03 — Validações e erros esperados | Ausência de key, Money numérico, OPENING público, reembolso parcial, UUID/cursor/limit inválidos e carteira duplicada |

Cada requisição possui testes em **Scripts → Post-response**. Os resultados
aparecem em **Test Results** ou no relatório do Runner. Respostas 400, 404, 409
e 422 são esperadas nos cenários descritos; os testes aprovam quando o código
e o motivo correspondem ao caso. Se o HTTP recebido divergir do esperado,
o fluxo do Runner é interrompido para evitar requisições dependentes de um
resultado inválido.

### Fluxo financeiro e saldo esperado

| Etapa | Efeito | Saldo BRL |
| --- | --- | --- |
| Abertura | Crédito inicial de 100.00 | 100.00 |
| BET | Débito de 80.00 | 20.00 |
| Replay e conflitos | Nenhum novo lançamento | 20.00 |
| Outra BET de 80.00 | Rejeitada por saldo insuficiente | 20.00 |
| WIN | Crédito de 20.00 | 40.00 |
| LOSS de 0.00 | Registro sem movimento | 40.00 |
| REFUND da BET | Crédito de 80.00 | 120.00 |
| Segundo REFUND | Rejeitado por reversão já aplicada | 120.00 |
| ROLLBACK do WIN | Débito de 20.00 | 100.00 |
| REFUND antes da referência | Aceito como PENDING_REFERENCE, sem movimento | 100.00 |
| BET referenciada | Débito de 10.00 | 90.00 |
| Worker resolve o REFUND | Crédito de 10.00 | 100.00 |

O GET **Aguardar resolução da referência** faz polling a cada 250ms, por até
20 segundos. Se o worker não resolver, o teste falha e o Runner para. A resposta
principal exibida pelo Postman pode mostrar PENDING_REFERENCE, enquanto os GETs
adicionais do script observam a resolução; reenvie o GET para ver o estado final
no body. O replay do POST original continua retornando 202 com
`idempotentReplay: true`, conforme o contrato de idempotência.

Ao concluir a collection, a reconciliação deve retornar `consistent: true`,
saldo armazenado/calculado **100.00**, diferença **0.00** e **sete lançamentos**.
LOSS, replays e rejeições não geram lançamentos. Os dados das execuções manuais
permanecem no banco; nenhum script da collection apaga carteiras ou histórico.

## 3. Testar com Swagger

Com a API ativa, abra [http://localhost:3000/docs](http://localhost:3000/docs).
A interface possui os grupos Carteiras, Transações e Operação, com schemas,
headers, parâmetros, exemplos e códigos de resposta documentados.

1. Abra **POST /wallets**, clique em **Try it out**, informe um UUID novo de
   jogador e saldo inicial `"100.00"` BRL e clique em **Execute**.
2. Copie `id` da resposta para `walletId` e mantenha o mesmo `playerId` nas
   operações seguintes. Os UUIDs presentes nos exemplos são ilustrativos.
3. Abra **POST /wagering/transactions** e selecione o exemplo **BET**. Substitua
   os IDs, informe uma `Idempotency-Key` inédita e execute.
4. Repita o mesmo payload/key para conferir `idempotentReplay: true`. Depois,
   altere apenas o valor, mantendo a key: a resposta deve ser 409.
5. Escolha os exemplos WIN, LOSS, REFUND e ROLLBACK. Para cada nova operação,
   use uma key e um ID externo novos. As referências usam IDs **externos** das
   operações anteriores; mantenha provider, jogador, carteira, moeda e rodada.
6. Consulte o GET da carteira, o ledger e o POST de reconciliação.

Money exige strings com duas casas: `"20.00"`, nunca `20`, `"20"` ou
`"20.001"`. REFUND/ROLLBACK exigem valor integral; o rollback de WIN/REFUND
debita a carteira e pode ser rejeitado se o dinheiro já tiver sido gasto.
`X-Correlation-Id` é opcional; `Idempotency-Key` é obrigatório na submissão.
Não existe um token Bearer necessário para esses testes.

As especificações também estão disponíveis em:

- JSON servido pela API: [http://localhost:3000/docs/openapi.json](http://localhost:3000/docs/openapi.json).
- YAML servido pela API: [http://localhost:3000/docs/openapi.yaml](http://localhost:3000/docs/openapi.yaml).
- Arquivo versionado: [openapi.json](openapi.json).

A interface utiliza assets locais da dependência Swagger UI; a configuração
desabilita o serviço externo de validação da especificação.

## 4. Testar SQS e recuperação

Com API e worker ativos, em um terceiro terminal:

```sh
bun run demo
```

O script envia uma LOSS pela fila `wager-transactions.fifo`, além de exercitar
HTTP, referências e reconciliação. O resultado esperado é 100.00 BRL e sete
lançamentos. O [README](../README.md#sqs-e-eventos) documenta o envelope SQS.

Os cenários de três processos, mensagens duplicadas, retries/DLQ e morte
abrupta são verificações automatizadas:

```sh
bun run test:concurrency
bun run test:recovery
bun run test:integration
```

Essas suites iniciam seus próprios processos e recursos temporários.
A collection demonstra o fluxo HTTP; não substitui esses testes de concorrência
e recuperação. Consulte [VALIDATION.md](VALIDATION.md) para as evidências.

## 5. Regenerar os arquivos

```sh
bun run docs:generate
```

Esse comando atualiza OpenAPI, collection e ambiente em `docs/`, sem precisar
iniciar API ou Docker. A especificação está em `src/interfaces/http/swagger.ts`
e `openapi-schemas.ts`; o roteiro da collection está em
`scripts/docs/postman-collection.ts`. Altere essas fontes e regenere os artefatos.
Testes detectam arquivos gerados desatualizados e exemplos de entrada inválidos.

Como alternativa ao aplicativo, com Node e Newman disponíveis:

```sh
newman run docs/WagerLedger.postman_collection.json -e docs/WagerLedger.local.postman_environment.json --timeout-script 30000
```

O timeout de script permite o polling de até 20s. Newman é uma ferramenta
opcional de validação e não foi adicionado às dependências da aplicação.

## Diagnóstico

| Sintoma | Verificação |
| --- | --- |
| Conexão HTTP recusada | API iniciada? `baseUrl` e PORT coincidem? |
| Readiness 503 | Docker ativo, migrations aplicadas e `queues:init` executado? |
| Variáveis/UUIDs vazios | Execute a criação da carteira antes das operações; confira o ambiente selecionado |
| Referência não resolve | Worker ativo e com papel `reference`? A BET referenciada possui os mesmos vínculos? |
| 409 inesperado | Reutilizou uma key com payload diferente ou ID externo com outra key? Inicie uma execução nova |
| Saldo diferente do roteiro | Enviou operações fora da ordem ou repetiu uma operação com identidade nova? Consulte ledger e reconciliação |

## Fontes da integração

- [NestJS: integração OpenAPI/Swagger](https://docs.nestjs.com/openapi/introduction).
- [Especificação OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html).
- [Postman: variáveis](https://learning.postman.com/docs/sending-requests/variables/variables/).
- [Postman: scripts que enviam requisições](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-send-request/).
- [Postman: execução com Newman](https://learning.postman.com/docs/collections/using-newman-cli/command-line-integration-with-newman/).
