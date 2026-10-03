# Acompanhando uma operação do início ao fim

Este documento explica o comportamento atual. O mapa dos arquivos está em
[GUIA_DO_CODIGO.md](GUIA_DO_CODIGO.md); comandos e collection estão em
[TESTING.md](TESTING.md). Os exemplos usam BRL e identificadores simbólicos;
requisições reais exigem UUIDs nos campos de jogador e carteira.

## 1. Abrir uma carteira com 100.00

1. `POST /wallets` chega ao `WalletController.create()`.
2. `parseOpenWallet()` valida campos e converte o dinheiro com `Money.from()`.
3. `OpenWallet.execute()` cria `Wallet` com saldo 100.00 e versão 1.
4. A unidade de trabalho abre uma transação SQL sem lock de carteira existente.
5. A sessão insere a carteira. A unicidade jogador/moeda impede duas iguais.
6. Como o valor é positivo, cria uma operação interna OPENING já processada.
7. Insere um crédito de 100.00, de saldo zero para 100.00, sequência 1.
8. Insere na outbox os eventos de operação processada e saldo alterado.
9. O banco verifica as constraints adiadas e confirma o commit; HTTP retorna 201.

Não chamamos `wallet.credit(100.00)` nessa abertura: `Wallet.open()` já definiu
o saldo inicial. Chamar novamente somaria duas vezes. OPENING explica sua origem.
Com saldo inicial zero, a carteira continua na versão 1, sem OPENING, ledger
ou eventos de abertura; o primeiro movimento posterior terá sequência 2.

Criar carteira não usa a `Idempotency-Key` das operações. Repetir jogador/moeda
gera conflito; não é um replay da criação anterior.

## 2. Receber uma BET de 80.00 por HTTP

O controller recebe JSON como `unknown`, valida seu contrato com `parseWager`,
chama a porta de identidade e exige `Idempotency-Key`. A correlação vem de
`X-Correlation-Id` ou de um UUID gerado. O adaptador de identidade atual é no-op.

`ProcessWager.execute()` faz então:

1. Constrói `Money` e calcula o hash do payload de negócio.
2. Chama `uow.run(walletId, callback)`.
3. A implementação abre transação e lê a carteira com lock pessimista de escrita.
4. Confere se a key já existe. Se existir, reproduz o snapshot ou gera conflito.
5. Confere se `(providerId, externalTransactionId)` já está associado a outra key.
6. Cria uma `WagerTransaction` PENDING e chama `applyWager()` na sessão bloqueada.

`applyWager()` verifica jogador e moeda, confere eventual referência e aplica
`wallet.debit(80.00)`. A carteira produz um lançamento de saldo 100.00 para
20.00, sequência 2, e muda para versão 2. A operação vira PROCESSED.

A sessão grava operação e snapshot de resposta, carteira, ledger e dois eventos
na outbox. Nada é enviado à SQS dentro desse fluxo. O commit torna todo o
pacote durável antes da resposta HTTP 200:

```json
{
  "transactionId": "<id gerado>",
  "status": "PROCESSED",
  "balance": { "amount": "20.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

Se alguma gravação ou constraint falhar, a transação inteira sofre rollback.
O objeto em memória é descartado com a tentativa; não há saldo parcialmente
confirmado só porque um `flush()` anterior já enviou SQL.

## 3. Duas BET de 80.00 disputando 100.00

As duas operações têm keys diferentes e podem chegar em processos diferentes.

| Momento | Processo A | Processo B |
| --- | --- | --- |
| Início | Obtém lock da carteira e lê 100.00 | Aguarda o mesmo lock |
| Aplicação | Debita 80.00; prepara saldo 20.00 | Ainda aguarda |
| Commit A | Confirma operação, saldo, ledger e outbox; libera lock | Pode obter o lock |
| Leitura B | Já terminou | Lê o saldo confirmado de 20.00 |
| Resultado B | PROCESSED | REJECTED / INSUFFICIENT_FUNDS |

A ordem A/B pode inverter. O resultado financeiro é o mesmo: uma aprovada,
uma rejeitada, saldo 20.00 e um débito além do crédito de abertura.
A rejeitada não altera versão nem cria lançamento; registra operação,
snapshot e evento de rejeição, retornando 422.

O lock é da linha da carteira. Outra carteira pode prosseguir. Não dependemos
de mutex de JavaScript, número de instâncias ou ordenação da fila para isso.
A unidade de trabalho define `lock_timeout` de 2 segundos e
`statement_timeout` de 5 segundos. Ela repete até três tentativas para os
códigos SQL de deadlock, serialização, lock indisponível e violação de unicidade,
com espera de 20 e 40 ms. Isso não significa que qualquer indisponibilidade
será recuperada; ao esgotar ou receber outro erro, propaga a falha.

## 4. Repetir a operação e comparar as identidades

Há três identidades com funções distintas:

| Identidade | Uso |
| --- | --- |
| `idempotencyKey` global | Reconhece a mesma operação e preserva sua primeira resposta |
| `(providerId, externalTransactionId)` | Identifica a operação no sistema do provedor e permite referências |
| `(consumerName, messageId)` | Reconhece a entrega lógica já processada na inbox |

O SHA-256 de negócio ordena as chaves dos objetos recursivamente; mudar a ordem
das propriedades JSON não muda o hash. A ordem dos arrays continua significativa.
A key e os headers/metadados não entram no hash de negócio.

| Nova submissão | Comportamento |
| --- | --- |
| Mesma key e mesmo negócio | Mesmo ID, saldo/status/HTTP originais e `idempotentReplay: true` |
| Mesma key, valor ou outro campo de negócio diferente | IDEMPOTENCY_CONFLICT, HTTP 409 |
| Nova key, mesma identidade externa | EXTERNAL_TRANSACTION_CONFLICT, HTTP 409 |
| Nova key e nova identidade externa | Nova operação, sujeita às regras financeiras |

Se aquela BET retornou saldo 20.00 e depois houve um WIN, o replay ainda mostra
20.00. Consulte `GET /wallets/:walletId` para o saldo atual. Replays de pendências
também preservam o 202 original; o GET da operação revela seu estado atual.

Os índices únicos no PostgreSQL protegem corridas que a consulta prévia não
consegue eliminar. Após um rollback por unicidade, uma nova tentativa pode
encontrar o registro vencedor e classificá-lo como replay ou conflito.

## 5. WIN, LOSS e reversões

WIN credita o prêmio informado, sem calcular probabilidades. Se referencia
uma BET, a referência precisa estar processada e ser compatível, mas o prêmio
pode ser diferente do valor apostado. LOSS registra resultado processado sem
movimentar dinheiro: a BET já fez o débito.

REFUND credita exatamente o valor integral da BET referenciada. ROLLBACK de
BET também credita; ROLLBACK de WIN ou REFUND debita o valor original.
Não existem reversões parciais nem ROLLBACK de outro ROLLBACK.

Antes do movimento, verificamos:

1. Referência do mesmo provedor, jogador, carteira, moeda e rodada.
2. Estado PROCESSED e tipo permitido.
3. Valor igual para REFUND/ROLLBACK.
4. Ausência de outra reversão processada do mesmo tipo para essa referência.
5. Saldo suficiente quando a inversão exige débito.

A unicidade é **por referência e tipo**. Um REFUND processado impede outro
REFUND daquela BET; um ROLLBACK impede outro ROLLBACK. O contrato atual permite
REFUND e ROLLBACK distintos sobre a mesma BET, comportamento também exercitado
em `tests/integration/reversals.test.ts`. Não há exclusão mútua entre os dois tipos.

Exemplo de insuficiência: saldo 100.00, WIN de 50.00 → saldo 150.00;
BET de 140.00 → saldo 10.00. ROLLBACK daquele WIN precisaria debitar 50.00:
gera REJECTED / REVERSAL_INSUFFICIENT_FUNDS e mantém saldo 10.00.
Assim, distinguir aposta sem saldo de reversão sem saldo facilita a auditoria.

## 6. REFUND chega antes da BET

O provedor solicita REFUND de 10.00 referenciando `late-bet`, que ainda não existe.
Persistimos PENDING_REFERENCE, snapshot HTTP 202 e evento de pendência. Não há
movimento. Se chegou por SQS, o consumidor confirma a mensagem depois desse commit.
A pendência agora está no banco; não precisamos manter a fila bloqueada esperando.

`ReferenceWorker` busca até 100 candidatos por ciclo. Cada candidato passa por
`RetryPendingReference`, que bloqueia a carteira e relê estado e agenda. Dois
workers podem encontrar o mesmo candidato; o segundo revalida após obter o lock.

| Situação no retry | Ação |
| --- | --- |
| Já deixou PENDING_REFERENCE ou ainda não venceu a agenda | Ignora o candidato |
| Referência terminal, dentro do TTL | Reaplica as regras; processa ou rejeita |
| Referência com identidade incompatível, mesmo pendente | Reaplica para rejeitar REFERENCE_MISMATCH |
| Referência ausente/pendente, com prazo e tentativas disponíveis | Incrementa tentativas e persiste próxima execução |
| TTL expirado ou tentativas esgotadas sem resolução | Rejeita REFERENCE_NOT_FOUND e grava evento |

A política padrão é até 20 tentativas, TTL de 24 horas, atraso inicial de 1 segundo
e teto de 5 minutos. O limite de tentativas pode encerrar a espera antes do TTL.
As agendas sobrevivem ao reinício, pois estão no PostgreSQL.

Dentro do TTL, uma referência terminal encontrada na última tentativa ainda
pode ser resolvida. Depois de expirar o TTL, a operação é rejeitada mesmo se
a referência já estiver disponível naquele momento.

A agenda é limpa antes de gravar o estado terminal, porque o trigger do banco
impede atualizar uma operação terminal. Quando `late-bet` finalmente é processada,
o REFUND pode creditá-la em um ciclo posterior. O GET mostra PROCESSED, mas o
replay da key do REFUND continua reproduzindo seu aceite 202 original.

## 7. Mesmo processamento por SQS

O envelope tem `messageId`, `type: WagerTransactionRequested`, timestamp ISO UTC,
`data` com o contrato de negócio e key, e correlação opcional. O `messageId`
é declarado no corpo; não é o `MessageId` atribuído pelo broker. Já o
`ReceiptHandle` identifica a entrega atual e é usado para confirmar/remover.

`parseWagerMessage()` valida o envelope e usa o mesmo `parseWager()` do HTTP.
Calcula um hash do envelope inteiro para a inbox. Alterar timestamp ou correlação
com o mesmo messageId, portanto, pode gerar INBOX_CONFLICT, mesmo que o negócio
seja igual. `ProcessWager` calcula separadamente o hash só do negócio.

O consumidor recebe uma mensagem por vez, usa long polling de até 20 segundos
e visibilidade padrão de 30 segundos. Durante a visibilidade, a entrega fica
oculta; se não for removida, pode voltar a ser recebida.

1. Executa `ProcessWager` com os dados de inbox.
2. Grava operação, eventual movimento, eventos e inbox processada no mesmo commit.
3. Depois do retorno confirmado, envia `DeleteMessage` como ack.

Se o processo morrer entre 2 e 3, outro consumidor recebe novamente. A inbox
e a key persistidas permitem replay sem outro débito. Uma rejeição financeira
ou pendência validamente persistida também recebe ack.

Erros de domínio de contrato/conflito são permanentes. Códigos SQL começando
com 22, 23 ou 42 também são classificados como permanentes; os demais erros
seguem como temporários. O consumidor padrão limita a cinco recebimentos,
com atraso exponencial de visibilidade limitado a 60 segundos. Esses retries
são diferentes dos retries internos do SDK e da unidade de trabalho.

Mensagem inválida, falha permanente ou temporária esgotada vai à DLQ. A original
só recebe ack após o envio à DLQ ser confirmado. Se esse envio falhar, ela permanece
recuperável. Uma falha permanente de infraestrutura com entrada já validada tenta
auditar FAILED em uma nova transação; se a auditoria falhar por infraestrutura,
o consumidor não confirma a mensagem. Banco inacessível não garante auditoria.

Esgotar retries temporários não cria FAILED: permite reenvio da DLQ após recuperação.
Uma operação já terminal não é reescrita por uma falha posterior. `currentStatus`
é um campo interno usado pelo consumidor para reconhecer FAILED, mesmo quando
o snapshot de replay ainda contém PENDING_REFERENCE. HTTP retorna só `body`.

## 8. Publicação e recuperação da outbox

`OutboxPublisher.tick()` abre transação e busca um evento disponível com
`FOR UPDATE SKIP LOCKED`. Outro publisher ignora essa linha bloqueada e pode
pegar outra. O envio acontece mantendo o lock, com timeout de rede de 5 segundos.

Se o envio falha, persiste tentativa e agenda: atraso de 500 ms que dobra até
60 segundos. Se confirma, grava `published_at`. Não há descarte automático.

| Interrupção | Recuperação |
| --- | --- |
| Antes de enviar | Rollback deixa evento pendente para outro publisher |
| Depois de enviar, antes de commit da marca | Pode haver novo envio com o mesmo eventId |
| Depois de confirmar a marca | Evento não é selecionado novamente |

É uma publicação que admite repetição. A deduplicação FIFO do broker não substitui
a deduplicação persistente por `eventId` no consumidor externo. Nosso backend
publica esses eventos; não inclui um serviço externo completo para consumi-los.

`SKIP LOCKED` também permite que publishers concorrentes enviem versões de uma
carteira fora da ordem financeira. `walletVersion` informa a ordem dos movimentos;
uma projeção externa precisa definir como lidar com eventos atrasados e lacunas,
além de deduplicar. Não prometemos ordem global de publicação.

## 9. Consultar ledger e reconciliar

Ledger usa cursor base64url com versão do formato, carteira, última sequência
e limite superior. A primeira página fixa `through = wallet.version`; as
próximas mantêm esse limite. Novos movimentos não entram nessa navegação.
Uma leitura nova, sem cursor, passa a incluir os movimentos mais recentes.
O cursor é validado, mas não é um token de autorização nem é assinado.

Reconciliação lê saldo e soma dos créditos menos débitos em uma única instrução
SQL. Isso evita comparar snapshots de momentos diferentes. Calcula
`difference = storedBalance - calculatedBalance` com `Money`, inclusive sinal
negativo, e informa `consistent` e quantidade de lançamentos. Não altera dados.

## 10. O que o banco impede

| Migration | Garantias principais |
| --- | --- |
| 001 | Carteira única por jogador/moeda, saldo não negativo, versão coerente; ledger imutável, moeda vinculada, sequência única, equação local e soma do ledger igual ao saldo |
| 002 | Key e identidade externa únicas; vínculo ledger/operação/carteira/moeda; reversão única por referência/tipo; inbox/outbox; snapshot e estado terminal protegidos; quantidade/valor de ledger; role limitada |
| 003 | Identidade/referência/tipo/direção/valor dos movimentos processados; solicitação imutável; conteúdo e envelope da outbox protegidos |

Triggers `DEFERRABLE INITIALLY DEFERRED` conferem o conjunto no commit. Isso
permite inserir a operação antes do ledger na mesma transação. Não exige
que toda instrução intermediária já represente o estado financeiro final.
`CHECK`, índices únicos e triggers imediatas continuam sendo verificados antes.

A aplicação utiliza `DATABASE_URL` da role limitada; migrations utilizam
`MIGRATION_DATABASE_URL` do dono do schema. A role não pode alterar/apagar ledger.
As garantias SQL não substituem todos os controles operacionais futuros, como
retenção, autorização por usuário e proteção de acessos administrativos.
`migration:down` remove estruturas/dados conforme a migration revertida; não
é uma forma de estornar operações financeiras.

## 11. Encerrar processos e interpretar as evidências

SIGTERM/SIGINT pedem parada ao ciclo de vida dos workers. O consumidor cancela
long polling; operações em andamento terminam antes de fechar ORM e cliente SQS.
Os loops deixam de iniciar novas iterações. API tem shutdown hooks do NestJS.

Não há extensão periódica da visibilidade SQS nesta versão. Uma operação muito
longa pode receber entrega concorrente; lock e idempotência protegem os efeitos.
Métricas são locais ao processo e reiniciam com ele. Inbox e eventos publicados
não têm expurgo automático. Não houve deployment AWS. O experimento de carga
local está descrito em [LOAD_TESTING.md](LOAD_TESTING.md).

Os testes de unidade demonstram regras dos objetos. Integração demonstra SQL/SQS
locais. Concorrência e recuperação demonstram processos reais e falhas controladas.
Cada tipo de teste responde a uma pergunta diferente; os detalhes e as limitações
do ambiente Windows estão em [VALIDATION.md](VALIDATION.md).
