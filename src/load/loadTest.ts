type LoadTestOptions = {
  url: string;
  durationSec: number;
  ratePerMin: number;
  maxInFlight: number;
  input: string;
};

function resolveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function parseArgs(): Partial<LoadTestOptions> {
  const args = process.argv.slice(2);
  const options: Partial<LoadTestOptions> = {};

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

async function runLoadTest(options: LoadTestOptions): Promise<void> {
  const intervalMs = options.ratePerMin > 0 ? Math.floor(60000 / options.ratePerMin) : 0;
  const startTime = Date.now();
  const endTime = startTime + options.durationSec * 1000;

  let inFlight = 0;
  let sent = 0;
  let completed = 0;
  let failed = 0;
  const latencies: number[] = [];

  console.log(`[load] Starting load test: ${options.ratePerMin} req/min for ${options.durationSec}s.`);

  const tick = async () => {
    if (Date.now() >= endTime) return;
    if (inFlight >= options.maxInFlight) return;

    inFlight += 1;
    sent += 1;
    const startedAt = Date.now();

    try {
      const res = await fetch(`${options.url}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: options.input, agent: "web-dev-agent" }),
      });

      const latency = Date.now() - startedAt;
      latencies.push(latency);

      if (!res.ok) {
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

  await new Promise<void>((resolve) => {
    const checker = setInterval(() => {
      if (Date.now() >= endTime && inFlight === 0) {
        clearInterval(checker);
        if (interval) clearInterval(interval);
        resolve();
      }
    }, 200);
  });

  const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
  const throughput = Math.round((completed / elapsedSec) * 60);
  const stats = summarizeLatencies(latencies);

  console.log("[load] Test complete.");
  console.log(`[load] Sent: ${sent}, Completed: ${completed}, Failed: ${failed}`);
  console.log(`[load] Throughput: ${throughput} req/min`);
  console.log(`[load] Latency ms: min=${stats.min}, p50=${stats.p50}, p95=${stats.p95}, avg=${stats.avg}, max=${stats.max}`);
}

const argOptions = parseArgs();
const options: LoadTestOptions = {
  url: argOptions.url || process.env.LOADTEST_URL || "http://localhost:3000",
  durationSec: argOptions.durationSec || resolveNumberEnv("LOADTEST_DURATION_SEC", 120),
  ratePerMin: argOptions.ratePerMin || resolveNumberEnv("LOADTEST_RATE_PER_MIN", 5),
  maxInFlight: argOptions.maxInFlight || resolveNumberEnv("LOADTEST_MAX_IN_FLIGHT", 2),
  input: argOptions.input || process.env.LOADTEST_INPUT || "Smoke test task",
};

runLoadTest(options).catch((error) => {
  console.error(`[load] Test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
