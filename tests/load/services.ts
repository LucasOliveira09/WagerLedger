import { fileURLToPath } from 'node:url';
import { deadline } from '../support/process-harness.js';

export interface LoadServiceConfig {
  role: 'api' | 'publisher';
  databaseUrl: string;
  queueUrls?: { wagers: string; dlq: string; events: string };
}

interface ReadyNotice {
  event: 'ready';
  pid: number;
  url: string;
}

export async function startLoadService(configuration: LoadServiceConfig) {
  let ready!: (notice: ReadyNotice) => void;
  let failed!: (error: Error) => void;
  const started = new Promise<ReadyNotice>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL('./service-process.ts', import.meta.url))],
    {
      env: { ...process.env, LOAD_SERVICE_CONFIG: JSON.stringify(configuration) },
      stdout: 'ignore',
      stderr: 'inherit',
      ipc(value: unknown) {
        if (value && typeof value === 'object' && 'event' in value && value.event === 'ready') {
          ready(value as ReadyNotice);
        }
      },
    },
  );
  child.exited.then((code) =>
    failed(new Error(`Serviço de carga encerrou (${code}) antes de ficar pronto.`)),
  );
  let notice: ReadyNotice;

  try {
    notice = await deadline(started);
  } catch (error) {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    await deadline(child.exited);
    throw error;
  }

  let stopping: Promise<void> | undefined;

  return {
    pid: notice.pid,
    url: notice.url,
    stop(): Promise<void> {
      return (stopping ??= (async () => {
        try {
          if (child.exitCode === null) {
            child.send({ command: 'stop' });
          }

          const code = await deadline(child.exited, 30000);

          if (code !== 0) {
            throw new Error(`Serviço de carga encerrou com código ${code}.`);
          }
        } finally {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }

          await deadline(child.exited);
        }
      })());
    },
  };
}
