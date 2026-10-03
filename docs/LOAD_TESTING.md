# Teste de carga local

`bun run test:load` mede requisições financeiras HTTP com PostgreSQL e SQS
emulado reais. Executa dois cenários, verifica os dados persistidos e grava
um relatório JSON. Os [resultados registrados](LOAD_RESULTS.md) são amostras
locais, sem compromisso de capacidade em produção.

## Executar

Instale as dependências com o lockfile e copie `.env.example` para `.env`,
conforme o [README](../README.md). Com Docker disponível, na raiz do projeto:

```sh
docker compose up -d --wait
bun run test:load
```

O comando aplica migrations em bancos próprios e cria suas filas. Não exige
iniciar API ou worker manualmente. Cada cenário usa um banco temporário,
três filas temporárias e dois subprocessos: API e publisher. O gerador é o
processo pai. As portas HTTP são escolhidas pelo sistema operacional.

Os recursos normais da demonstração são preservados. O comando aceita somente
hosts locais em `MIGRATION_DATABASE_URL` e `SQS_ENDPOINT`; a conexão de migration
precisa poder criar/remover bancos. API e publisher usam `wagerledger_app`.
Ao concluir ou tratar uma falha, o harness encerra seus processos e remove
seus bancos/filas. Uma morte abrupta do processo pai pode impedir essa limpeza.

## Cenários e etapas

| Cenário | Distribuição de requisições |
| --- | --- |
| `hot-wallet` | Todas as requisições disputam uma carteira |
| `independent-wallets` | Distribuição circular entre `LOAD_WALLETS` carteiras |

Cada carteira começa com `"1000000.00"` BRL. Cada operação é uma BET de
`"1.00"`, com key e identidade externa únicas, sem retry do cliente. Esse saldo
acomoda os limites configuráveis sem transformar o experimento em teste de
saldo insuficiente. Dinheiro continua em `Money`, strings e centavos `bigint`;
os números do relatório representam contagens, durações e taxas.

1. Cria carteiras e, opcionalmente, histórico por carteira. O histórico é
   composto por BETs reais, enviadas sequencialmente pela API.
2. Executa o aquecimento e aguarda a outbox drenar e seu gauge de lag zerar.
3. Captura os contadores iniciais e mede a carga HTTP.
4. Aguarda publicação dos eventos e captura os contadores finais.
5. Encerra a API para drenar handlers, confere novamente a outbox e audita
   saldo, ledger, versão, transações e eventos.

Preparação e aquecimento ficam fora das estatísticas HTTP e dos deltas dos
contadores. A observação do lag inclui a carga e sua drenagem. A duração total
do comando inclui criação de recursos, preparação, auditoria e limpeza;
portanto, excede a duração configurada da carga.

## Parâmetros

Configure variáveis de ambiente antes de executar:

| Variável | Padrão | Limites | Significado |
| --- | --- | --- | --- |
| `LOAD_DURATION_SECONDS` | 10 | 1–300 | Janela para iniciar requisições, por cenário |
| `LOAD_CONCURRENCY` | 8 | 1–64 | Clientes lógicos simultâneos |
| `LOAD_WALLETS` | 16 | 2–100 | Carteiras do cenário distribuído |
| `LOAD_HISTORY_ENTRIES` | 0 | 0–10000 | BETs de preparação por carteira |
| `LOAD_WARMUP_REQUESTS` | 20 | 0–10000 | Requisições de aquecimento por cenário |
| `LOAD_MAX_REQUESTS` | 10000 | 1–100000 | Limite de requisições medidas por cenário |
| `LOAD_TIMEOUT_SECONDS` | 15 | 1–60 | Timeout de cada requisição |
| `LOAD_DRAIN_SECONDS` | 60 | 1–300 | Prazo de cada espera de drenagem |

Exemplo no PowerShell, para observar um histórico maior:

```powershell
$env:LOAD_DURATION_SECONDS = '30'
$env:LOAD_CONCURRENCY = '8'
$env:LOAD_HISTORY_ENTRIES = '100'
bun run test:load
```

Para voltar aos padrões, remova essas variáveis do terminal:

```powershell
Remove-Item Env:LOAD_DURATION_SECONDS, Env:LOAD_CONCURRENCY, Env:LOAD_HISTORY_ENTRIES
```

## Interpretar o relatório

Cada execução grava `artifacts/load/<data>-<identificador>.json` e atualiza
`artifacts/load/latest.json`. Esses arquivos são ignorados pelo Git. O relatório
inclui configuração, revisão Git, versões, CPU/memória do host e Docker,
imagens declaradas no Compose, versão efetiva do PostgreSQL e PIDs.
Não inclui URLs com credenciais nem payloads financeiros completos.

| Campo | Interpretação |
| --- | --- |
| `workload.successfulRps` | Respostas válidas por segundo |
| `workload.throughputRps` | Todas as respostas concluídas por segundo, incluindo erros |
| `workload.latency` | p50, p95, p99, mínimo e máximo em milissegundos |
| `workload.errors`, `errorRate`, `failures`, `statusCounts` | Erros, proporção, classificação e distribuição de status HTTP |
| `workload.requestLimitReached` | A execução atingiu o limite de requisições antes ou junto da duração |
| `metrics.api.lockWaitSeconds`, `lockWaitCount` | Soma e contagem da espera observada por locks de carteira |
| `metrics.api.lockConflicts`, `databaseRetries` | Conflitos SQL e retries registrados na API |
| `metrics.publisher.retries` | Retries de publicação durante a observação |
| `metrics.maxOutboxLagSeconds`, `lagSamples` | Máximo observado e amostras do gauge do publisher |
| `outbox.elapsedMs`, `pendingEvents` | Tempo das esperas finais e eventos SQL ainda sem publicação confirmada |
| `financial` | Reconciliação, saldo esperado, ledger, versão e concordância com respostas |
| `events` | Quantidade esperada e auditoria dos tipos/associações dos eventos |

Os percentis usam nearest rank: p95 é a amostra na posição `ceil(0,95 × N)`
depois de ordenar as latências. Por exemplo, p95 de 200 ms indica que pelo
menos 95% das amostras demoraram até esse valor. Incluímos operações com erro;
assim, falhas lentas não desaparecem do cálculo.

A latência começa antes do envio e termina após leitura e validação do corpo
JSON: inclui transporte, espera pelo lock e processamento. Não é o mesmo valor
do histograma de processamento interno da API. O denominador do throughput
inclui o término das requisições em andamento após fechar a janela de envios.

O monitor consulta `/metrics` a cada 250 ms e usa deltas para excluir o
aquecimento. O lag é um gauge atualizado pelo publisher em seus ciclos;
seu máximo amostrado pode perder um pico entre consultas. Conflitos de lock
iguais a zero não significam espera igual a zero: normalmente o PostgreSQL
aguarda o lock sem gerar erro SQL. `lockWaitSeconds / lockWaitCount` ajuda a
observar essa espera média, sem representar um percentil.

## Critérios de aprovação

Uma resposta só é válida com HTTP 200, status PROCESSED, sem replay, ID de
transação novo e saldo BRL serializado em escala 2. O resultado exige:

- Pelo menos uma requisição medida, zero erros e coleta de métricas sem falhas.
- Quantidade de BETs medidas persistidas igual à quantidade de sucessos.
- Saldo esperado calculado com `Money`, reconciliação exata, uma entrada por
  movimento e versão correspondente em todas as carteiras.
- Dois eventos por OPENING/BET processada: um `WagerTransactionProcessed` e
  um `WalletBalanceChanged`, associados à mesma transação/carteira.
- Outbox sem pendências dentro dos prazos de drenagem.

Saída `0` significa aprovação desses critérios; `1`, falha; interrupção tratada
por SIGINT/SIGTERM resulta em `130`. Não impomos um valor arbitrário de RPS como
critério. O teste de regressão da auditoria remove eventos do banco temporário
e também simula tipos duplicados: ambos precisam falhar, mesmo com outbox vazia
ou quantidade total aparentemente correta.

## Alcance e limites

O gerador usa `fetch` do Bun em **modelo fechado**: cada cliente espera a resposta
antes de enviar a próxima operação. Quando a aplicação fica lenta, a taxa
oferecida também diminui. Esse modelo caracteriza concorrência fixa; não prova
resistência a uma taxa externa constante nem elimina coordinated omission.
Para medir uma meta de chegada fixa, uma evolução é usar k6 com arrival rate
e infraestrutura separada para o gerador.

Usamos Bun para reutilizar o runtime do projeto, controlar API/publisher por
IPC e evitar uma dependência adicional para o experimento opcional. A escolha
favorece reprodução do fluxo e auditoria; k6 oferece cenários e ferramentas
mais completos para campanhas de capacidade prolongadas.

O experimento exercita HTTP, PostgreSQL e o envio da outbox ao MiniStack.
Não envia apostas pela SQS, não inicia o consumidor nem o worker de referências,
e não inspeciona cada mensagem na fila de saída. Publicação confirmada significa
que o SDK retornou sucesso e o publisher marcou a linha; não prova processamento
por um consumidor externo. Recuperação, redelivery e duplicatas são exercitados
pelas outras suítes. A fila de eventos do experimento é standard, criada pelo
harness de integração; a configuração normal da demonstração é FIFO.

API, gerador, publisher e containers compartilham a máquina. Os subprocessos
descartam stdout e silenciam a inicialização do Nest; os logs de processamento
continuam sendo construídos, mas o custo de exibição num terminal fica excluído.
O monitor e o próprio gerador também consomem recursos. Janelas curtas não
demonstram estabilidade prolongada, retenção de milhões de registros, capacidade
na AWS ou desempenho sob partição de rede. Comparar históricos ajuda a formular
hipóteses; atribuir um gargalo à trigger exige profiling e análise das consultas.

## Organização do código e referências

`tests/load/config.ts` limita configuração; `generator.ts` envia e valida
requisições; `services.ts`/`service-process.ts` controlam subprocessos;
`environment.ts` provisiona recursos e audita a outbox; `monitor.ts` coleta
métricas; `scenario.ts` coordena as etapas; `run.ts` grava o relatório.
Os testes pequenos do harness entram em `bun test`; o benchmark completo é
executado somente por `bun run test:load`.

- [Bun: fetch](https://bun.com/docs/runtime/networking/fetch).
- [Bun: subprocessos e IPC](https://bun.com/docs/runtime/child-process).
- [k6: diferenças entre modelos aberto e fechado](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/).
