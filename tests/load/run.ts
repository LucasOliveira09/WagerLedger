import { mkdir } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { runScenario } from './scenario.js';

function gitValue(args: string[]): string | null {
  const result = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'ignore' });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}
async function environmentInfo() {
  const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json() as { version: string; dependencies: Record<string, string> };
  const compose = await Bun.file(new URL('../../compose.yaml', import.meta.url)).text();
  const docker = Bun.spawnSync(['docker', 'info', '--format', '{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}},"version":{{json .ServerVersion}}}'],
    { stdout: 'pipe', stderr: 'ignore', timeout: 5000 });
  const engine = docker.exitCode === 0 ? JSON.parse(docker.stdout.toString()) as { cpus: number; memoryBytes: number; version: string } : null;
  const dirty = gitValue(['status', '--porcelain']);
  return { bun: Bun.version, platform: platform(), release: release(), architecture: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, hostMemoryBytes: totalmem(),
    projectVersion: pkg.version, dependencies: pkg.dependencies, dockerEngine: engine,
    composeImages: [...compose.matchAll(/^\s+image:\s*(\S+)/gm)].map(match => match[1]),
    gitCommit: gitValue(['rev-parse', 'HEAD']), workingTreeDirty: dirty === null ? null : dirty !== '',
    generator: 'Bun fetch; closed model; requests measured through complete response body' };
}
async function main() {
  const config = loadConfig(); const environment = await environmentInfo();
  const startedAt = new Date().toISOString(); const controller = new AbortController();
  const interrupted = () => controller.abort(new Error('Carga interrompida.'));
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
  const scenarios: Awaited<ReturnType<typeof runScenario>>[] = [];
  let failure: { code: string; name: string } | undefined;
  try {
    for (const name of ['hot-wallet', 'independent-wallets'] as const) {
      controller.signal.throwIfAborted();
      const report = await runScenario(name, config, controller.signal); scenarios.push(report);
      console.log(`[load] ${name}: ${report.workload.successfulRps.toFixed(2)} sucessos/s; p95 ${report.workload.latency.p95Ms?.toFixed(2)}ms; erros ${report.workload.errors}; consistente ${report.financial.consistent}.`);
    }
  } catch (error) {
    failure = { code: controller.signal.aborted ? 'LOAD_INTERRUPTED' : 'LOAD_SETUP_OR_RUN_FAILURE', name: error instanceof Error ? error.name : 'UnknownError' };
    console.error(`[load] ${failure.code}. Confira a infraestrutura e a configuração; recursos próprios serão encerrados.`);
  } finally { process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted); }
  const passed = !failure && scenarios.length === 2 && scenarios.every(scenario => scenario.passed);
  const report = { version: 1, startedAt, finishedAt: new Date().toISOString(), passed, config, environment, scenarios, ...(failure ? { failure } : {}) };
  const directory = join(process.cwd(), 'artifacts', 'load'); await mkdir(directory, { recursive: true });
  const filename = `${startedAt.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.json`;
  const serialized = JSON.stringify(report, null, 2) + '\n';
  await Bun.write(join(directory, filename), serialized); await Bun.write(join(directory, 'latest.json'), serialized);
  console.log(`[load] Relatório: artifacts/load/${filename}`);
  console.log(`[load] Resultado: ${passed ? 'aprovado' : 'falhou'}. Sem meta arbitrária de RPS; sucesso exige respostas válidas e invariantes preservadas.`);
  process.exitCode = controller.signal.aborted ? 130 : passed ? 0 : 1;
}
if (import.meta.main) {
  await main().catch(error => { console.error(error instanceof RangeError ? error.message : 'Não foi possível concluir o teste de carga.'); process.exitCode = 1; });
}
