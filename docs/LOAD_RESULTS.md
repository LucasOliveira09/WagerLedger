# Resultados locais de carga

Experimentos executados em **03/10/2026**, após uma execução curta de controle.
Os quatro cenários abaixo foram aprovados: zero erros HTTP, saldo/ledger/versão
consistentes, eventos esperados presentes e outbox sem pendências ao final.
Use a [metodologia](LOAD_TESTING.md) para reproduzir e interpretar os campos.

## Ambiente e configuração

| Item | Valor registrado |
| --- | --- |
| Host | Windows `10.0.26200`, x64 |
| CPU | Intel Core i5-10400F 2.90 GHz, 12 CPUs lógicas |
| Memória do host | 17.106.477.056 bytes, aproximadamente 15,93 GiB |
| Docker Engine | 29.6.1; 12 CPUs; 8.289.210.368 bytes, aproximadamente 7,72 GiB |
| Runtime | Bun 1.4.2; TypeScript 5.9.3; NestJS 12.1.2; MikroORM 7.2.3 |
| Serviços | PostgreSQL 18.6; MiniStack 1.5.18; imagens fixadas por digest no Compose |
| Processos | Gerador, API e publisher em três PIDs distintos, na mesma máquina |
| Revisão do harness | `5e8fc3cf4b0e08a92c15de827aad64192d9311ae` |
| Modelo | Fechado, oito clientes; uma API e um publisher |
| Carga | BET de `"1.00"` BRL; saldo inicial `"1000000.00"` por carteira |
| Janela | 10 segundos de envio por cenário; término das requisições incluído nas taxas |
| Aquecimento | 20 requisições por cenário, fora da medição |
| Limites | 10.000 requisições; timeout 15s; cada espera de drenagem até 60s |
| Distribuição | Uma carteira ou 16 carteiras; histórico de zero ou 100 BETs por carteira |

Os relatórios registram PostgreSQL efetivo como `18.6`. Recursos do Docker são
compartilhados pelos containers; não equivalem a recursos dedicados por serviço.
A execução sem histórico começou às `19:05:48.691Z` e terminou às
`19:06:42.913Z`; a execução com histórico foi de `19:07:59.911Z` a
`19:09:39.024Z`. São horários UTC, equivalentes a 16h no fuso de São Paulo.
Os intervalos completos incluem preparação, publicação, auditoria e limpeza.

O primeiro relatório registrou árvore Git limpa. O segundo registrou árvore
com alterações apenas de documentação do experimento; o harness era o mesmo.
Os números abaixo usam essas duas execuções, sem testes da suíte simultâneos.
Uma execução exploratória anterior, realizada enquanto havia outras verificações,
não integra as tabelas. Não houve otimização do código de produção nesta etapa.

## Requisições e latência

| Histórico por carteira | Cenário | Sucessos | Sucessos/s | p50 ms | p95 ms | p99 ms | Erros |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | Uma carteira | 406 | 39,91 | 191,10 | 322,59 | 439,36 | 0 |
| 0 | 16 carteiras | 1.141 | 113,96 | 57,53 | 132,94 | 161,49 | 0 |
| 100 | Uma carteira | 472 | 46,53 | 150,36 | 255,39 | 280,80 | 0 |
| 100 | 16 carteiras | 1.263 | 125,88 | 60,81 | 88,02 | 108,84 | 0 |

Nenhuma execução atingiu o limite de requisições. O tempo medido efetivo foi,
respectivamente, 10.173,84 ms; 10.012,55 ms; 10.144,19 ms; 10.033,06 ms.
Todas as respostas medidas foram HTTP 200 com PROCESSED, sem replay.

## Locks, publicação e auditoria

| Histórico | Cenário | Espera média por lock ms | Lag máximo observado s | Drenagem final s | Eventos auditados |
| --- | --- | ---: | ---: | ---: | ---: |
| 0 | Uma carteira | 168,17 | 2,944 | 2,82 | 854 |
| 0 | 16 carteiras | 4,50 | 24,440 | 24,66 | 2.354 |
| 100 | Uma carteira | 144,56 | 2,749 | 2,81 | 1.186 |
| 100 | 16 carteiras | 4,30 | 26,319 | 26,45 | 5.798 |

A espera média é a soma `wallet_lock_wait_seconds` dividida pela contagem de
aquisições medidas, convertida para milissegundos. Houve **zero conflitos SQL,
zero retries de banco e zero retries do publisher** em todos os cenários;
isso não elimina a espera normal por lock. A coleta não registrou falhas.

As contagens de eventos incluem OPENING, histórico, aquecimento e medição.
Cada movimento apresentou exatamente um WagerTransactionProcessed e um
WalletBalanceChanged associados à mesma transação/carteira. Os contadores
PROCESSED da API corresponderam às quantidades de sucessos medidas.
Todas as carteiras reconciliaram com o saldo esperado; quantidade de entradas
e versão corresponderam aos movimentos, e zero eventos ficaram pendentes.

## Como defender esses resultados

A carteira disputada apresentou espera de lock maior e throughput menor que
as carteiras distribuídas. É um comportamento compatível com a serialização
por carteira adotada para evitar saldo negativo e efeitos concorrentes indevidos.
A comparação caracteriza este ambiente e esta concorrência; não estima o
limite máximo da aplicação.

A API distribuída concluiu operações mais rápido que o publisher único escoou
os dois eventos de cada movimento. A fila de publicação continuou acumulada
após os envios, com aproximadamente 25–26 segundos para drenar. Aprovar o
experimento significa que os eventos foram preservados e publicados dentro do
prazo; não significa backlog estável sob carga contínua nessa taxa.
Um próximo experimento deve variar a quantidade de publishers e medir conexão
SQL, latência SQS e crescimento da outbox antes de escolher batching ou leases.

Preparar 100 apostas por carteira **não demonstrou degradação** nestas amostras;
algumas métricas ficaram melhores. Janelas curtas, cache e variação da máquina
impedem atribuir causalidade a essa diferença. Esse histórico é pequeno diante
de milhões de lançamentos. A limitação do SUM completo da trigger continua
sendo uma hipótese arquitetural a investigar com histórico maior, repetições,
profiling e análise do plano das consultas.

Há uma amostra por combinação de histórico/cenário, sem intervalo de confiança,
teste prolongado ou gerador separado. O modelo fechado reduz a taxa oferecida
quando as respostas ficam lentas. A publicação usa SQS emulada e fila standard
no harness, sem consumidor externo. Não há evidência de capacidade na AWS,
validação de chegada fixa ou processamento exatamente uma vez por destinatários.

## Relatórios brutos

Os arquivos locais são ignorados pelo Git para manter o repositório limpo:

- `artifacts/load/2026-10-03T19-05-48-691Z-770c3199.json`: sem histórico.
- `artifacts/load/2026-10-03T19-07-59-911Z-a25dd240.json`: 100 BETs por carteira.

Ao reproduzir, os nomes, PIDs e resultados mudam. `latest.json` aponta para o
conteúdo da última execução, e este documento preserva somente as evidências
resumidas da execução registrada.
