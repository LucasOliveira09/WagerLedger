import { counterDelta, metricTotal, parseMetrics } from './metrics.js';

async function snapshot(apiUrl: string, publisherUrl: string) {
  const fetchMetrics = async (url: string) => {
    const response = await fetch(url + '/metrics', { signal: AbortSignal.timeout(2000) });

    if (!response.ok) {
      throw new Error('Métricas indisponíveis durante a carga.');
    }

    return parseMetrics(await response.text());
  };
  const [api, publisher] = await Promise.all([fetchMetrics(apiUrl), fetchMetrics(publisherUrl)]);

  return { api, publisher };
}

export async function startMonitor(apiUrl: string, publisherUrl: string) {
  let before = await snapshot(apiUrl, publisherUrl);
  const deadline = performance.now() + 5000;

  // O publisher atualiza o gauge antes de publicar: a outbox drenada pode ainda mostrar lag do aquecimento.
  while (metricTotal(before.publisher, 'outbox_lag_seconds') > 0) {
    if (performance.now() >= deadline) {
      throw new Error('Lag da preparação não zerou antes da medição.');
    }

    await Bun.sleep(100);
    before = await snapshot(apiUrl, publisherUrl);
  }

  const started = performance.now();
  const lagSamples: Array<{ elapsedMs: number; seconds: number }> = [];
  let stopped = false;
  let failures = 0;
  let last = before;
  const record = () =>
    lagSamples.push({
      elapsedMs: performance.now() - started,
      seconds: metricTotal(last.publisher, 'outbox_lag_seconds'),
    });
  record();
  const running = (async () => {
    while (!stopped) {
      await Bun.sleep(250);

      if (stopped) {
        break;
      }
      try {
        last = await snapshot(apiUrl, publisherUrl);
        record();
      } catch {
        failures++;
      }
    }
  })();
  let stopping: Promise<ReturnType<typeof report>> | undefined;
  const report = () => ({
    api: {
      processed: counterDelta(before.api, last.api, 'transactions_total{status="PROCESSED"}'),
      rejected: counterDelta(before.api, last.api, 'transactions_total{status="REJECTED"}'),
      failed: counterDelta(before.api, last.api, 'transactions_total{status="FAILED"}'),
      duplicates: counterDelta(before.api, last.api, 'duplicates_total'),
      lockConflicts: counterDelta(before.api, last.api, 'lock_conflicts_total'),
      databaseRetries: counterDelta(before.api, last.api, 'database_retries_total'),
      processingCount: counterDelta(before.api, last.api, 'processing_seconds_count'),
      lockWaitCount: counterDelta(before.api, last.api, 'wallet_lock_wait_seconds_count'),
      lockWaitSeconds: counterDelta(before.api, last.api, 'wallet_lock_wait_seconds_sum'),
    },
    publisher: {
      retries: counterDelta(before.publisher, last.publisher, 'outbox_publish_retries_total'),
    },
    samplingFailures: failures,
    samplingIntervalMs: 250,
    maxOutboxLagSeconds: Math.max(...lagSamples.map((sample) => sample.seconds)),
    lagSamples,
  });

  return {
    stop() {
      return (stopping ??= (async () => {
        stopped = true;
        await running;
        last = await snapshot(apiUrl, publisherUrl);
        record();
        return report();
      })());
    },
  };
}
