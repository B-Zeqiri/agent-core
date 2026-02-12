/**
 * Model Adapter Tests — OpenAI fallback gating
 *
 * Validates GPT4AllAdapter's OpenAI fallback is opt-in via ALLOW_OPENAI_FALLBACK.
 */

import { GPT4AllAdapter, OpenAIAdapter, ModelAdapter, ModelRouterAdapter } from "./modelAdapter";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function pass(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
  process.exit(1);
}

function test(name: string) {
  console.log(`\n${colors.blue}→ ${name}${colors.reset}`);
}

async function assert(condition: boolean, msg: string) {
  if (condition) {
    pass(msg);
  } else {
    fail(msg);
  }
}

async function run() {
  console.log(
    `\n${colors.yellow}=== MODEL ADAPTER TESTS (FALLBACK GATING) ===${colors.reset}\n`
  );

  const envBackup = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    ALLOW_OPENAI_FALLBACK: process.env.ALLOW_OPENAI_FALLBACK,
  };

  const originalOpenAICall = OpenAIAdapter.prototype.call;

  try {
    test("GPT4AllAdapter — fallback disabled by default");

    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    delete process.env.ALLOW_OPENAI_FALLBACK;

    const adapter = new GPT4AllAdapter({
      // Point to a port that should refuse quickly.
      baseURL: "http://127.0.0.1:1/v1",
      apiKey: "local-key",
      model: "gpt4all-local",
    });

    let gotDisabledMessage = false;
    try {
      await adapter.call("sys", "hello");
      fail("Expected GPT4AllAdapter.call to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      gotDisabledMessage = /fallback is disabled/i.test(message);
      await assert(
        gotDisabledMessage,
        "Throws helpful error when fallback disabled"
      );
    }

    test("GPT4AllAdapter — fallback enabled via ALLOW_OPENAI_FALLBACK=1");

    process.env.ALLOW_OPENAI_FALLBACK = "1";

    // Patch OpenAIAdapter to avoid real network calls.
    OpenAIAdapter.prototype.call = async () => {
      return {
        content: "stubbed-openai",
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        executionTimeMs: 1,
      };
    };

    const adapter2 = new GPT4AllAdapter({
      baseURL: "http://127.0.0.1:1/v1",
      apiKey: "local-key",
      model: "gpt4all-local",
    });

    const result = await adapter2.call("sys", "hello");
    await assert(result.content === "stubbed-openai", "Uses OpenAIAdapter stub");
    await assert(
      /\(fallback\)$/.test(result.model),
      "Annotates returned model with (fallback)"
    );

    test("ModelRouterAdapter — falls back on retryable errors");

    class StubAdapter extends ModelAdapter {
      public calls = 0;
      constructor(private behavior: { throwMessage?: string; result?: string }) {
        super();
      }
      async call(): Promise<any> {
        this.calls++;
        if (this.behavior.throwMessage) {
          throw new Error(this.behavior.throwMessage);
        }
        return { content: this.behavior.result || "ok", model: "stub", executionTimeMs: 1 };
      }
    }

    const a = new StubAdapter({ throwMessage: "fetch failed" });
    const b = new StubAdapter({ result: "from-b" });
    const router = new ModelRouterAdapter([
      { id: "local", adapter: a },
      { id: "cloud", adapter: b },
    ]);

    const r1 = await router.call("sys", "hello");
    await assert(r1.content === "from-b", "Uses next provider after failure");
    await assert(a.calls === 1 && b.calls === 1, "Calls providers in order");

    test("ModelRouterAdapter — does not fall back on non-retryable errors");
    const c = new StubAdapter({ throwMessage: "HTTP 400: Bad Request" });
    const d = new StubAdapter({ result: "should-not-run" });
    const router2 = new ModelRouterAdapter([
      { id: "a", adapter: c },
      { id: "b", adapter: d },
    ]);

    let got400 = false;
    try {
      await router2.call("sys", "hello");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      got400 = /400/.test(message);
    }
    await assert(got400, "Throws original non-retryable error");
    await assert(d.calls === 0, "Does not attempt fallback on 400/401");

    test("ModelRouterAdapter — supports explicit retry chain (local -> cloud -> local)");
    const e = new StubAdapter({ throwMessage: "connect ECONNREFUSED" });
    const f = new StubAdapter({ throwMessage: "HTTP 429: rate limited" });
    const g = new StubAdapter({ result: "from-local-retry" });
    const router3 = new ModelRouterAdapter([
      { id: "local", adapter: e },
      { id: "cloud", adapter: f },
      { id: "local", adapter: g },
    ]);
    const r3 = await router3.call("sys", "hello");
    await assert(r3.content === "from-local-retry", "Retries later chain entry after cloud failure");

    test("ModelRouterAdapter — abort stops attempts");
    const h = new StubAdapter({ result: "should-not-run" });
    const i = new StubAdapter({ result: "should-not-run" });
    const router4 = new ModelRouterAdapter([
      { id: "a", adapter: h },
      { id: "b", adapter: i },
    ]);
    const ac = new AbortController();
    ac.abort();
    let aborted = false;
    try {
      await router4.call("sys", "hello", { signal: ac.signal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      aborted = /aborted/i.test(message) || (err as any)?.name === "AbortError";
    }
    await assert(aborted, "Throws AbortError when cancelled");
    await assert(h.calls === 0 && i.calls === 0, "Does not call providers after abort");

    console.log(`\n${colors.green}✓ ModelAdapter fallback gating OK${colors.reset}`);
  } finally {
    // Restore env
    process.env.OPENAI_API_KEY = envBackup.OPENAI_API_KEY;
    process.env.OPENAI_MODEL = envBackup.OPENAI_MODEL;
    if (envBackup.ALLOW_OPENAI_FALLBACK == null) {
      delete process.env.ALLOW_OPENAI_FALLBACK;
    } else {
      process.env.ALLOW_OPENAI_FALLBACK = envBackup.ALLOW_OPENAI_FALLBACK;
    }

    // Restore prototype
    OpenAIAdapter.prototype.call = originalOpenAICall;
  }
}

run().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  fail(message);
});
