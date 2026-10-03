import { fileURLToPath } from 'node:url';

export interface Notice { event: string; pid: number; id?: string; metricsUrl?: string }
export async function eventually(check: () => Promise<boolean>, milliseconds = 15000): Promise<void> {
  const until = Date.now() + milliseconds;
  while (!await check()) {
    if (Date.now() >= until) throw new Error('Condição não atingida no prazo.');
    await Bun.sleep(25);
  }
}
export function deadline<T>(promise: Promise<T>, milliseconds = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Prazo do processo de teste excedido.')), milliseconds);
    promise.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
  });
}
export function spawnTestWorker(configuration: object) {
  const notices: Notice[] = []; const listeners = new Map<string, Array<(notice: Notice) => void>>();
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('./worker-process.ts', import.meta.url))], {
    env: { ...process.env, TEST_WORKER_CONFIG: JSON.stringify(configuration) }, stdout: 'pipe', stderr: 'pipe',
    ipc(value: unknown) {
      if (!value || typeof value !== 'object' || !('event' in value)) return;
      const notice = value as Notice; notices.push(notice);
      for (const listener of listeners.get(notice.event) ?? []) listener(notice);
      listeners.delete(notice.event);
    },
  });
  const output = new Response(child.stdout).text(); const errors = new Response(child.stderr).text();
  return {
    child, output, errors,
    waitFor(event: string) {
      const previous = notices.find(notice => notice.event === event);
      if (previous) return Promise.resolve(previous);
      return deadline(new Promise<Notice>((resolve, reject) => {
        listeners.set(event, [...(listeners.get(event) ?? []), resolve]);
        child.exited.then(async code => reject(new Error(`Processo encerrou (${code}) antes de ${event}: ${await errors}`)), reject);
      }));
    },
    send(command: string) { child.send({ command }); },
    async stop() { if (child.exitCode !== null) return child.exitCode; child.send({ command: 'stop' }); return deadline(child.exited); },
    async kill() { if (child.exitCode === null) child.kill('SIGKILL'); await deadline(child.exited); },
  };
}
