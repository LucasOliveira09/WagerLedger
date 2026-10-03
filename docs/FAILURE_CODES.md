# Códigos de rejeição e falha

A taxonomia implementada está em `src/domain/failure-code.ts`. Os códigos são
identificadores estáveis para integração: o provedor deve decidir pelo código,
não por mensagens em português. O Swagger enumera os mesmos valores.

## Rejeições financeiras persistidas

Uma submissão rejeitada retorna HTTP 422 com `status: REJECTED`, `failureCode`,
ID da operação e saldo observado. Persiste a decisão e seu evento, sem alterar
saldo, versão ou ledger. O GET da operação permite consultar essa decisão depois.

| Código | Condição atual | Orientação ao provedor |
| --- | --- | --- |
| `INSUFFICIENT_FUNDS` | Débito de BET excederia o saldo disponível | Tratar a aposta como rejeitada. Uma tentativa posterior depende de saldo suficiente e de uma nova operação |
| `REVERSAL_INSUFFICIENT_FUNDS` | Débito de ROLLBACK de WIN/REFUND excederia o saldo | Tratar a reversão como rejeitada e investigar o saldo disponível; não assumir que o valor foi retirado |
| `CURRENCY_MISMATCH` | Moeda da operação difere da carteira | Conferir carteira e moeda; não converter o valor implicitamente |
| `WALLET_IDENTITY_MISMATCH` | Jogador declarado não é o proprietário da carteira | Corrigir a associação jogador/carteira antes de solicitar outra operação |
| `REFERENCE_MISMATCH` | Referência pertence a outro provedor, jogador, carteira, moeda ou rodada | Conferir o vínculo da referência; não aguardar como se fosse uma dependência compatível |
| `REFERENCE_KIND_INVALID` | Tipo da referência é proibido para a operação | REFUND deve usar BET; ROLLBACK pode usar BET, WIN ou REFUND; WIN referenciado deve usar BET |
| `REFERENCE_NOT_PROCESSED` | Referência encontrada está terminal, mas não foi PROCESSED | Consultar a referência e encerrar/corrigir o fluxo; repetir não transformará seu resultado terminal em sucesso |
| `REFERENCE_NOT_FOUND` | Worker esgotou a espera sem resolver uma referência válida processável | Investigar ausência ou pendência da referência e encerrar a espera desta operação; não esperar recuperação automática do resultado terminal |
| `REVERSAL_ALREADY_APPLIED` | Já existe reversão PROCESSED do mesmo tipo para a referência | Consultar a reversão existente e não emitir outra do mesmo tipo |
| `AMOUNT_MISMATCH` | REFUND/ROLLBACK tem valor diferente da referência | Conferir o valor integral; reversão parcial não é suportada |
| `AMOUNT_OUT_OF_RANGE` | Uma movimentação ultrapassaria o limite monetário | Conferir valor e saldo acumulado; não dividir operações automaticamente para contornar o limite |

A busca da referência é restrita a `(providerId, referenceExternalTransactionId)`.
Se o identificador existir apenas em outro provedor, este fluxo o considera
ausente: começa em PENDING_REFERENCE e pode terminar em REFERENCE_NOT_FOUND.
REFERENCE_MISMATCH descreve a incompatibilidade de uma referência encontrada;
a regra de domínio também verifica o provedor como defesa adicional.

`REFERENCE_NOT_FOUND` identifica o fim da política de espera. Não prova que a
referência nunca existirá: uma referência ainda pendente também pode levar ao
esgotamento. A política padrão é 20 tentativas ou TTL de 24 horas, com atraso
exponencial inicial de 1 segundo e teto de 5 minutos. O limite de tentativas
pode encerrar antes do TTL; o TTL também limita uma retomada após indisponibilidade.

## Falha permanente de infraestrutura

`INFRASTRUCTURE_PERMANENT_FAILURE` é usado com `status: FAILED`, não REJECTED.
O consumidor SQS tenta auditá-lo em uma transação nova após rollback de uma
falha permanente de infraestrutura com entrada já validada. Não gera movimento.
Um resultado terminal anterior é preservado.

O provedor deve investigar a causa operacional. Reenviar uma operação FAILED
não reabre esse resultado terminal. Quando essa é a primeira resposta gravada,
o replay HTTP retorna 503 com FAILED. Se já havia um snapshot PENDING_REFERENCE,
o replay conserva aquele aceite original; o GET revela FAILED. A auditoria
depende de o banco aceitar a gravação: banco inacessível pode impedir o registro.

## Reenvio, correção e idempotência

- Mesma key e mesmo negócio reproduzem a primeira resposta, inclusive uma rejeição.
- Mesma key com negócio diferente gera conflito; não corrige a operação existente.
- Nova key com o mesmo `(providerId, externalTransactionId)` também gera conflito.
- Uma nova tentativa financeira autorizada exige novos identificadores de operação
  e key; não deve ser criada apenas porque houve timeout ou dúvida sobre o resultado.
- Em timeout ou resposta incerta, repetir a mesma operação/key e consultar o GET
  permite descobrir o resultado sem criar outro efeito financeiro.

Uma referência ausente inicialmente recebe HTTP 202 / PENDING_REFERENCE, sem
`failureCode`: a espera ainda não é uma rejeição. O worker resolve ou rejeita depois.
Consultar o GET mostra o estado atual; repetir a submissão conserva o 202 original.

## Erros de entrada e transporte

Payload inválido, referência obrigatória omitida ou conflito de idempotência
normalmente são respostas HTTP 400/409 com `error.code`, sem uma nova operação
REJECTED persistida. Assim, `error.code` e `failureCode` têm papéis distintos.
Carteira inexistente retorna 404. Indisponibilidade não auditada retorna 503.

Na DLQ, os atributos `PERMANENT_MESSAGE`, `RETRY_EXHAUSTED` e `AUDITED_FAILURE`
descrevem o motivo do encaminhamento da mensagem. Não substituem o estado e o
`failureCode` da operação. Retries temporários esgotados podem ir à DLQ sem
criar FAILED; após recuperação, podem ser reenviados preservando sua identidade.

Consulte os [fluxos financeiros](FLUXOS_FINANCEIROS.md) para os caminhos de
processamento e [TESTING.md](TESTING.md) para testar as respostas.
