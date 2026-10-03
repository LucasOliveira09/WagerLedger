interface RequestOptions {
  body?: unknown;
  key?: string;
  description: string;
  pre?: string[];
  checks?: string[];
}

function request(
  name: string,
  method: 'GET' | 'POST',
  path: string,
  status: number,
  options: RequestOptions,
) {
  return {
    name,
    request: {
      method,
      header: [
        { key: 'X-Correlation-Id', value: '{{runId}}' },
        ...(options.body === undefined ? [] : [{ key: 'Content-Type', value: 'application/json' }]),
        ...(options.key === undefined ? [] : [{ key: 'Idempotency-Key', value: options.key }]),
      ],
      url: `{{baseUrl}}${path}`,
      description: options.description,
      ...(options.body === undefined
        ? {}
        : {
            body: {
              mode: 'raw',
              raw: JSON.stringify(options.body, null, 2),
              options: { raw: { language: 'json' } },
            },
          }),
    },
    event: [
      ...(options.pre
        ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: options.pre } }]
        : []),
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            `pm.test("HTTP ${status}", function () { pm.response.to.have.status(${status}); });`,
            `if (pm.response.code !== ${status}) { pm.execution.setNextRequest(null); } else {`,
            ...(options.checks ?? []),
            '}',
          ],
        },
      },
    ],
  };
}

const balanceChecks = (balance: string, status = 'PROCESSED', savedId?: string) => [
  'const data = pm.response.json();',
  `pm.test("Estado ${status} e saldo ${balance} BRL", function () { pm.expect(data.status).to.eql("${status}"); pm.expect(data.balance).to.eql({ amount: "${balance}", currency: "BRL" }); });`,
  ...(savedId ? [`pm.collectionVariables.set("${savedId}", data.transactionId);`] : []),
];
const errorChecks = (code: string) => [
  `pm.test("Código ${code}", function () { pm.expect(pm.response.json().error.code).to.eql("${code}"); });`,
];
const failureChecks = (code: string, balance: string) => [
  ...balanceChecks(balance, 'REJECTED'),
  `pm.test("Rejeição ${code}", function () { pm.expect(data.failureCode).to.eql("${code}"); });`,
];
const wagerInput = (
  kind: string,
  externalId: string,
  amount: string | number,
  reference?: string,
) => ({
  providerId: '{{providerId}}',
  externalTransactionId: `${externalId}-{{runId}}`,
  walletId: '{{walletId}}',
  playerId: '{{playerId}}',
  roundId: 'round-{{runId}}',
  gameId: 'game-demo',
  kind,
  money: { amount, currency: 'BRL' },
  ...(reference ? { referenceExternalTransactionId: `${reference}-{{runId}}` } : {}),
});

function wager(
  name: string,
  kind: string,
  externalId: string,
  amount: string,
  balance: string,
  reference?: string,
) {
  return request(name, 'POST', '/wagering/transactions', 200, {
    description: `${kind}: ${amount} BRL. Saldo esperado: ${balance} BRL. ${reference ? `Referência externa: ${reference} desta execução.` : ''}`,
    body: wagerInput(kind, externalId, amount, reference),
    key: `postman:{{runId}}:${externalId}`,
    checks: balanceChecks(balance),
  });
}

const reconcile = (name: string, entries: number) =>
  request(name, 'POST', '/wallets/{{walletId}}/reconciliation', 200, {
    description: `Confere saldo 100.00 BRL, difference 0.00 e ${entries} lançamentos, incluindo abertura. Não modifica a carteira.`,
    checks: [
      'const data = pm.response.json();',
      `pm.test("Saldo reconciliado e ${entries} lançamentos", function () { pm.expect(data.consistent).to.eql(true); pm.expect(data.storedBalance.amount).to.eql("100.00"); pm.expect(data.calculatedBalance.amount).to.eql("100.00"); pm.expect(data.difference.amount).to.eql("0.00"); pm.expect(data.checkedEntries).to.eql(${entries}); });`,
    ],
  });
const pollPending = [
  'const deadline = Date.now() + 20000;',
  'function check(response) {',
  '  const data = response.json();',
  '  if (data.status === "PENDING_REFERENCE" && Date.now() < deadline) {',
  '    setTimeout(function () {',
  '      const url = pm.variables.replaceIn("{{baseUrl}}/wagering/transactions/{{pendingTransactionId}}");',
  '      pm.sendRequest({ url: url, method: "GET" }, function (error, next) {',
  '        if (error || next.code !== 200) { pm.test("Consulta da referência disponível", function () { pm.expect(error).to.eql(null); pm.expect(next && next.code).to.eql(200); }); pm.execution.setNextRequest(null); return; }',
  '        check(next);',
  '      });',
  '    }, 250);',
  '    return;',
  '  }',
  '  pm.test("Worker resolveu a referência em até 20 segundos", function () { pm.expect(data.status).to.eql("PROCESSED"); });',
  '  if (data.status !== "PROCESSED") pm.execution.setNextRequest(null);',
  '}',
  'check(pm.response);',
];

export function createPostmanCollection() {
  return {
    info: {
      _postman_id: 'd0e0f46e-4c78-437d-96d0-7d378ecf3e82',
      name: 'WagerLedger — testes financeiros',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description:
        'Execute API, PostgreSQL e MiniStack; para a pasta de referências fora de ordem, execute também o worker. Importe o ambiente WagerLedger — local e rode a collection na ordem. A criação inicial gera UUIDs e salva walletId automaticamente; cada execução cria um histórico novo. A collection inclui rejeições esperadas: 400/404/409/422 aprovam quando o código é o previsto. O saldo final é 100.00 BRL e a reconciliação possui sete lançamentos. Consulte docs/TESTING.md. Sem autenticação/IdP nesta entrega. Esta collection usa HTTP; SQS é demonstrado por bun run demo.',
    },
    auth: { type: 'noauth' },
    variable: [
      { key: 'baseUrl', value: 'http://127.0.0.1:3000', type: 'string' },
      { key: 'providerId', value: 'postman-demo', type: 'string' },
      ...[
        'runId',
        'playerId',
        'walletId',
        'transactionId',
        'pendingTransactionId',
        'ledgerCursor',
      ].map((key) => ({ key, value: '', type: 'string' })),
    ],
    item: [
      {
        name: '00 — Disponibilidade',
        item: [
          request('01 — Liveness', 'GET', '/health/live', 200, {
            description: 'O processo responde, sem consultar dependências.',
            checks: [
              'pm.test("Processo vivo", function () { pm.expect(pm.response.json().status).to.eql("alive"); });',
            ],
          }),
          request('02 — Readiness', 'GET', '/health/ready', 200, {
            description:
              'PostgreSQL e três filas SQS disponíveis. Se falhar, confira Docker/migrations/queues:init.',
            checks: [
              'pm.test("Dependências prontas", function () { pm.expect(pm.response.json()).to.eql({ status: "ready", postgres: true, sqs: true }); });',
            ],
          }),
          request('03 — Métricas', 'GET', '/metrics', 200, {
            description:
              'Texto Prometheus deste processo. Pode estar vazio antes do primeiro processamento.',
            checks: [
              'pm.test("Formato de texto", function () { pm.expect(pm.response.headers.get("Content-Type")).to.include("text/plain"); });',
            ],
          }),
        ],
      },
      {
        name: '01 — Carteira, idempotência e operações',
        item: [
          request('01 — Criar carteira com 100.00 BRL', 'POST', '/wallets', 201, {
            description:
              'Comece aqui para testes financeiros. Gera jogador e execução novos; salva walletId/IDs automaticamente. Reexecutar cria outra carteira, preservando o histórico anterior.',
            pre: [
              'pm.collectionVariables.set("runId", pm.variables.replaceIn("{{$guid}}"));',
              'pm.collectionVariables.set("playerId", pm.variables.replaceIn("{{$guid}}"));',
              'for (const key of ["walletId", "transactionId", "pendingTransactionId", "ledgerCursor"]) pm.collectionVariables.unset(key);',
            ],
            body: {
              playerId: '{{playerId}}',
              initialBalance: { amount: '100.00', currency: 'BRL' },
            },
            checks: [
              'const data = pm.response.json();',
              'pm.test("Abertura 100.00 e versão 1", function () { pm.expect(data.balance.amount).to.eql("100.00"); pm.expect(data.version).to.eql(1); });',
              'pm.collectionVariables.set("walletId", data.id);',
            ],
          }),
          request('02 — Consultar carteira', 'GET', '/wallets/{{walletId}}', 200, {
            description: 'Retorna saldo atual após a abertura.',
            checks: [
              'pm.test("Saldo inicial", function () { pm.expect(pm.response.json().balance.amount).to.eql("100.00"); });',
            ],
          }),
          request('03 — BET 80.00 → saldo 20.00', 'POST', '/wagering/transactions', 200, {
            description:
              'Um único débito auditável. Salva transactionId para consultas posteriores.',
            body: wagerInput('BET', 'bet', '80.00'),
            key: 'postman:{{runId}}:bet',
            checks: balanceChecks('20.00', 'PROCESSED', 'transactionId'),
          }),
          request(
            '04 — Replay da BET → nenhum novo débito',
            'POST',
            '/wagering/transactions',
            200,
            {
              description:
                'Mesmo payload/key reproduz transactionId e saldo original. Saldo continua 20.00.',
              body: wagerInput('BET', 'bet', '80.00'),
              key: 'postman:{{runId}}:bet',
              checks: [
                ...balanceChecks('20.00'),
                'pm.test("Replay da mesma transação", function () { pm.expect(data.idempotentReplay).to.eql(true); pm.expect(data.transactionId).to.eql(pm.collectionVariables.get("transactionId")); });',
              ],
            },
          ),
          request(
            '05 — Mesma key com valor diferente → 409',
            'POST',
            '/wagering/transactions',
            409,
            {
              description: 'Mudar 80.00 para 81.00 com a key original viola idempotência.',
              body: wagerInput('BET', 'bet', '81.00'),
              key: 'postman:{{runId}}:bet',
              checks: errorChecks('IDEMPOTENCY_CONFLICT'),
            },
          ),
          request(
            '06 — Mesmo ID externo com nova key → 409',
            'POST',
            '/wagering/transactions',
            409,
            {
              description: 'Uma nova key não permite repetir o ID externo já utilizado.',
              body: wagerInput('BET', 'bet', '80.00'),
              key: 'postman:{{runId}}:new-key',
              checks: errorChecks('EXTERNAL_TRANSACTION_CONFLICT'),
            },
          ),
          request('07 — BET sem saldo → 422 auditado', 'POST', '/wagering/transactions', 422, {
            description:
              'Saldo 20.00 não permite débito 80.00. A rejeição fica persistida sem ledger.',
            body: wagerInput('BET', 'insufficient', '80.00'),
            key: 'postman:{{runId}}:insufficient',
            checks: failureChecks('INSUFFICIENT_FUNDS', '20.00'),
          }),
          request(
            '08 — Consultar BET por ID interno',
            'GET',
            '/wagering/transactions/{{transactionId}}',
            200,
            {
              description: 'O GET mostra o estado atual, não o snapshot original do POST.',
              checks: [
                'pm.test("BET processada", function () { pm.expect(pm.response.json().status).to.eql("PROCESSED"); });',
              ],
            },
          ),
          request(
            '09 — Consultar BET pelo provedor/ID externo',
            'GET',
            '/providers/{{providerId}}/wagering/transactions/bet-{{runId}}',
            200,
            {
              description: 'Deve apontar para a mesma transação da consulta interna.',
              checks: [
                'pm.test("Mesma identidade interna", function () { pm.expect(pm.response.json().id).to.eql(pm.collectionVariables.get("transactionId")); });',
              ],
            },
          ),
          wager('10 — WIN 20.00 → saldo 40.00', 'WIN', 'win', '20.00', '40.00', 'bet'),
          wager('11 — LOSS zero → saldo 40.00', 'LOSS', 'loss', '0.00', '40.00'),
          wager(
            '12 — REFUND integral → saldo 120.00',
            'REFUND',
            'refund',
            '80.00',
            '120.00',
            'bet',
          ),
          request('13 — Segundo REFUND da mesma BET → 422', 'POST', '/wagering/transactions', 422, {
            description:
              'Identidade nova com a mesma referência não permite um segundo refund processado.',
            body: wagerInput('REFUND', 'second-refund', '80.00', 'bet'),
            key: 'postman:{{runId}}:second-refund',
            checks: failureChecks('REVERSAL_ALREADY_APPLIED', '120.00'),
          }),
          wager(
            '14 — ROLLBACK do WIN → saldo 100.00',
            'ROLLBACK',
            'rollback-win',
            '20.00',
            '100.00',
            'win',
          ),
          request(
            '15 — Ledger: primeira página',
            'GET',
            '/wallets/{{walletId}}/ledger?limit=2',
            200,
            {
              description: 'Abertura e BET. Salva o cursor da próxima página.',
              checks: [
                'const data = pm.response.json();',
                'pm.test("Duas entradas e cursor", function () { pm.expect(data.entries).to.have.lengthOf(2); pm.expect(data.nextCursor).to.be.a("string"); });',
                'pm.collectionVariables.set("ledgerCursor", data.nextCursor);',
              ],
            },
          ),
          request(
            '16 — Ledger: próxima página',
            'GET',
            '/wallets/{{walletId}}/ledger?limit=2&cursor={{ledgerCursor}}',
            200,
            {
              description:
                'Continua a navegação usando o cursor salvo, sem repetir a página anterior.',
              checks: [
                'const data = pm.response.json();',
                'pm.test("Sequências seguintes", function () { pm.expect(data.entries.map(function (entry) { return entry.sequence; })).to.eql([3, 4]); });',
              ],
            },
          ),
          reconcile('17 — Reconciliação após reversões', 5),
        ],
      },
      {
        name: '02 — Referência fora de ordem (requer worker)',
        item: [
          request('01 — REFUND antes da BET → 202', 'POST', '/wagering/transactions', 202, {
            description:
              'Referencia late-bet ainda ausente. Não gera dinheiro. Salva pendingTransactionId.',
            body: wagerInput('REFUND', 'early-refund', '10.00', 'late-bet'),
            key: 'postman:{{runId}}:early-refund',
            checks: balanceChecks('100.00', 'PENDING_REFERENCE', 'pendingTransactionId'),
          }),
          wager('02 — BET referenciada chega → saldo 90.00', 'BET', 'late-bet', '10.00', '90.00'),
          request(
            '03 — Aguardar resolução da referência',
            'GET',
            '/wagering/transactions/{{pendingTransactionId}}',
            200,
            {
              description:
                'Consulta repetidamente, a cada 250ms, por até 20s. O worker de referências deve estar ativo. Ao resolver, saldo retorna a 100.00.',
              checks: pollPending,
            },
          ),
          request('04 — Replay mantém aceite original 202', 'POST', '/wagering/transactions', 202, {
            description:
              'Mesmo após processada, a submissão original continua retornando seu snapshot 202. O estado atual é obtido no GET.',
            body: wagerInput('REFUND', 'early-refund', '10.00', 'late-bet'),
            key: 'postman:{{runId}}:early-refund',
            checks: [
              ...balanceChecks('100.00', 'PENDING_REFERENCE'),
              'pm.test("Replay do aceite original", function () { pm.expect(data.idempotentReplay).to.eql(true); });',
            ],
          }),
          reconcile('05 — Reconciliação final: sete lançamentos', 7),
        ],
      },
      {
        name: '03 — Validações e erros esperados',
        item: [
          request(
            '01 — Header Idempotency-Key ausente → 400',
            'POST',
            '/wagering/transactions',
            400,
            {
              description: 'Contrato válido sem o header obrigatório.',
              body: wagerInput('LOSS', 'missing-key', '0.00'),
              checks: errorChecks('INVALID_PAYLOAD'),
            },
          ),
          request('02 — Money numérico → 400', 'POST', '/wagering/transactions', 400, {
            description: 'amount deve ser string; um número JSON não é aceito.',
            body: wagerInput('BET', 'numeric-money', 20),
            key: 'postman:{{runId}}:numeric',
            checks: errorChecks('INVALID_PAYLOAD'),
          }),
          request('03 — Tipo OPENING público → 400', 'POST', '/wagering/transactions', 400, {
            description: 'Abertura é exclusiva do caso de uso interno de criação da carteira.',
            body: wagerInput('OPENING', 'opening', '10.00'),
            key: 'postman:{{runId}}:opening',
            checks: errorChecks('INVALID_KIND'),
          }),
          request('04 — REFUND parcial → 422', 'POST', '/wagering/transactions', 422, {
            description: 'A referência BET tem 80.00; 10.00 não corresponde ao valor integral.',
            body: wagerInput('REFUND', 'partial-refund', '10.00', 'bet'),
            key: 'postman:{{runId}}:partial',
            checks: failureChecks('AMOUNT_MISMATCH', '100.00'),
          }),
          request('05 — UUID inválido → 400', 'GET', '/wallets/invalid-uuid', 400, {
            description: 'Validação de fronteira antes da consulta financeira.',
            checks: errorChecks('INVALID_PAYLOAD'),
          }),
          request(
            '06 — Carteira inexistente → 404',
            'GET',
            '/wallets/00000000-0000-4000-8000-000000000099',
            404,
            {
              description: 'UUID válido sem carteira correspondente no ambiente de demonstração.',
              checks: errorChecks('WALLET_NOT_FOUND'),
            },
          ),
          request(
            '07 — Cursor inválido → 400',
            'GET',
            '/wallets/{{walletId}}/ledger?cursor=invalid',
            400,
            {
              description: 'O cursor deve ser o valor retornado pela API para esta carteira.',
              checks: errorChecks('INVALID_CURSOR'),
            },
          ),
          request(
            '08 — Limit acima de 100 → 400',
            'GET',
            '/wallets/{{walletId}}/ledger?limit=101',
            400,
            {
              description: 'Página deve possuir entre 1 e 100 entradas.',
              checks: errorChecks('INVALID_LIMIT'),
            },
          ),
          request('09 — Carteira duplicada → 409', 'POST', '/wallets', 409, {
            description: 'Repete jogador e moeda desta execução, sem gerar novos IDs.',
            body: {
              playerId: '{{playerId}}',
              initialBalance: { amount: '100.00', currency: 'BRL' },
            },
            checks: errorChecks('RESOURCE_CONFLICT'),
          }),
          reconcile('10 — Erros preservaram dinheiro e ledger', 7),
        ],
      },
    ],
  };
}

export function createPostmanEnvironment() {
  return {
    id: '87a8b97b-4bce-4ac5-ae91-d7b1f506a688',
    name: 'WagerLedger — local',
    values: [{ key: 'baseUrl', value: 'http://127.0.0.1:3000', type: 'default', enabled: true }],
    _postman_variable_scope: 'environment',
  };
}
