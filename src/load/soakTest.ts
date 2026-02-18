type SoakTarget = "/task" | "queue";

type SoakTestOptions = {
  url: string;
  durationSec: number;
  ratePerMin: number;
  maxInFlight: number;
  input: string;
  target: SoakTarget;
  statsIntervalSec: number;
};

function resolveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function resolveTargetEnv(raw: string | undefined): SoakTarget {
  return raw === "queue" ? "queue" : "/task";
}

function parseArgs(): Partial<SoakTestOptions> {
  const args = process.argv.slice(2);
  const options: Partial<SoakTestOptions> = {};

  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [key, rawValue] = arg.slice(2).split("=");
    if (!key) continue;
    const value = rawValue ?? "";

    if (key === "url") options.url = value;
    if (key === "durationSec") options.durationSec = Number(value);
    if (key === "ratePerMin") options.ratePerMin = Number(value);
    if (key === "maxInFlight") options.maxInFlight = Number(value);
    if (key === "input") options.input = value;
    if (key === "target") options.target = resolveTargetEnv(value);
    if (key === "statsIntervalSec") options.statsIntervalSec = Number(value);
  }

  return options;
}

function summarizeLatencies(latencies: number[]) {
  if (latencies.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = Math.round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { min, max, avg, p50, p95 };
}

async function postTask(url: string, input: string): Promise<boolean> {
  const res = await fetch(`${url}/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, agent: "web-dev-agent" }),
  });
  return res.ok;
}

async function runSoakTest(options: SoakTestOptions): Promise<void> {
  const intervalMs = options.ratePerMin > 0 ? Math.floor(60000 / options.ratePerMin) : 0;
  const startTime = Date.now();
  const endTime = startTime + options.durationSec * 1000;

  let inFlight = 0;
  let sent = 0;
  let completed = 0;
  let failed = 0;
  const latencies: number[] = [];

  console.log(
    `[soak] Starting soak test: ${options.ratePerMin} req/min for ${options.durationSec}s target=${options.target}.`
  );

  const tick = async () => {
    if (Date.now() >= endTime) return;
    if (inFlight >= options.maxInFlight) return;

    inFlight += 1;
    sent += 1;
    const startedAt = Date.now();

    try {
      let ok = false;
      if (options.target === "/task") {
        ok = await postTask(options.url, options.input);
      } else {
        ok = await postTask(options.url, options.input);
      }

      const latency = Date.now() - startedAt;
      latencies.push(latency);

      if (!ok) {
        failed += 1;
      } else {
        completed += 1;
      }
    } catch {
      failed += 1;
    } finally {
      inFlight -= 1;
    }
  };

  let interval: NodeJS.Timeout | null = null;
  if (intervalMs > 0) {
    interval = setInterval(() => {
      void tick();
    }, intervalMs);
  } else {
    interval = setInterval(() => {
      void tick();
    }, 1000);
  }

  const statsIntervalMs = Math.max(5, options.statsIntervalSec) * 1000;
  const statsTimer = setInterval(async () => {
    try {
      const res = await fetch(`${options.url}/api/queue/status`);
      if (res.ok) {
        const payload = await res.json();
        const stats = payload?.stats;
        if (stats) {
          console.log(
            `[soak] queue=${stats.queueName} waiting=${stats.waiting} active=${stats.active} failed=${stats.failed} dlq=${stats.deadLetter}`
          );
        }
      }
    } catch {
      // ignore stats polling errors
    }
  }, statsIntervalMs);

  await new Promise<void>((resolve) => {
    const checker = setInterval(() => {
      if (Date.now() >= endTime && inFlight === 0) {
        clearInterval(checker);
        if (interval) clearInterval(interval);
        clearInterval(statsTimer);
        resolve();
      }
    }, 500);
  });

  const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
  const throughput = Math.round((completed / elapsedSec) * 60);
  const stats = summarizeLatencies(latencies);

  console.log("[soak] Test complete.");
  console.log(`[soak] Sent: ${sent}, Completed: ${completed}, Failed: ${failed}`);
  console.log(`[soak] Throughput: ${throughput} req/min`);
  console.log(
    `[soak] Latency ms: min=${stats.min}, p50=${stats.p50}, p95=${stats.p95}, avg=${stats.avg}, max=${stats.max}`
  );
}

const argOptions = parseArgs();
const options: SoakTestOptions = {
  url: argOptions.url || process.env.SOAK_URL || "http://localhost:3000",
  durationSec: argOptions.durationSec || resolveNumberEnv("SOAK_DURATION_SEC", 7200),
  ratePerMin: argOptions.ratePerMin || resolveNumberEnv("SOAK_RATE_PER_MIN", 10),
  maxInFlight: argOptions.maxInFlight || resolveNumberEnv("SOAK_MAX_IN_FLIGHT", 5),
  input: argOptions.input || process.env.SOAK_INPUT || "Soak test task",
  target: argOptions.target || resolveTargetEnv(process.env.SOAK_TARGET),
  statsIntervalSec: argOptions.statsIntervalSec || resolveNumberEnv("SOAK_STATS_INTERVAL_SEC", 60),
};

runSoakTest(options).catch((error) => {
  console.error(`[soak] Test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
