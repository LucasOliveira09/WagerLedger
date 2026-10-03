import { bootstrap } from '../../src/main.js';
import { bootstrapWorkers } from '../../src/main-worker.js';
import type { LoadServiceConfig } from './services.js';

const configuration = JSON.parse(process.env.LOAD_SERVICE_CONFIG!) as LoadServiceConfig;
let stop!: () => void;
let finished: Promise<void>;
let url: string;

if (configuration.role === 'api') {
  const app = await bootstrap({
    databaseUrl: configuration.databaseUrl,
    host: '127.0.0.1',
    port: 0,
    quiet: true,
  });
  url = await app.getUrl();
  let complete!: () => void;
  let fail!: (error: unknown) => void;
  finished = new Promise<void>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  let stopping = false;
  stop = () => {
    if (!stopping) {
      stopping = true;
      void app.close().then(complete, fail);
    }
  };
} else if (configuration.role === 'publisher' && configuration.queueUrls) {
  const runtime = await bootstrapWorkers({
    databaseUrl: configuration.databaseUrl,
    queueUrls: configuration.queueUrls,
    roles: ['publisher'],
    metricsPort: 0,
  });
  url = runtime.metricsUrl!.replace('0.0.0.0', '127.0.0.1');
  finished = runtime.finished;
  stop = runtime.stop;
} else {
  throw new Error('Configuração interna do serviço de carga inválida.');
}

process.on('message', (message: { command?: string }) => {
  if (message.command === 'stop') {
    stop();
  }
});

process.send?.({ event: 'ready', pid: process.pid, url: url.replace(/\/$/, '') });

await finished;

process.disconnect?.();
