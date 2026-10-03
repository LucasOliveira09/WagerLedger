import { bootstrapWorkers } from '../../src/main-worker.js';
import type { WorkerOptions } from '../../src/main-worker.js';

const configuration = JSON.parse(process.env.TEST_WORKER_CONFIG!) as WorkerOptions & { mode?: 'commit-pause' | 'publish-pause' | 'before-publish' };
let release!: () => void;
const barrier = new Promise<void>(resolve => { release = resolve; });
process.on('message', (message: { command: string }) => {
  if (message.command === 'stop') process.emit('SIGTERM');
  if (message.command === 'release') release();
});
const notice = (event: string, id?: string) => process.send?.({ event, pid: process.pid, id });
const runtime = await bootstrapWorkers({ ...configuration,
  beforePublish: async message => { if (configuration.mode === 'before-publish') { notice('before-publish', message.id); await barrier; } },
  onCommitted: async message => { notice('committed', message.messageId); if (configuration.mode === 'commit-pause') await barrier; },
  onPublished: async message => { notice('published', message.id); if (configuration.mode === 'publish-pause') await barrier; },
});
notice('ready');
await runtime.finished;
notice('stopped');
process.disconnect?.();
