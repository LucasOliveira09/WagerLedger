import { telemetry } from '../../infrastructure/observability/telemetry.js';

export interface ScheduledWorker { tick(): Promise<boolean | number>; requestStop?(): void }
export class WorkerLifecycle {
  private stopping = false;
  constructor(private readonly workers: readonly ScheduledWorker[]) {}
  requestStop(): void {
    if (this.stopping) return;
    this.stopping = true;
    for (const worker of this.workers) worker.requestStop?.();
  }
  // Os papéis rodam em loops concorrentes. Parar impede a próxima iteração, mas aguarda
  // o tick em andamento; o consumidor interrompe o long polling pelo próprio AbortController.
  async run(): Promise<void> {
    await Promise.all(this.workers.map(async worker => {
      while (!this.stopping) {
        try { if (!await worker.tick() && !this.stopping) await Bun.sleep(100); }
        catch {
          telemetry.log('warn', 'worker_iteration_failed', { code: 'RETRY_NEXT_ITERATION' });
          telemetry.count('worker_retries_total');
          if (!this.stopping) await Bun.sleep(500);
        }
      }
    }));
  }
}
