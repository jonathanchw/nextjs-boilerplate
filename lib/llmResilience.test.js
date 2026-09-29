import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeBackoffDelayMs,
  envString,
  generateTextWithResilience,
  getHttpStatus,
  isTransientLlmError,
  LlmSoftUnavailableError,
  LlmUserFacingError,
  parseResilienceConfig,
  sanitizeErrorDetail,
  withAttemptTimeout,
  withTransientRetries,
} from "./llmResilience.js";

describe("parseResilienceConfig", () => {
  it("treats empty GitHub Actions vars as unset and applies defaults", () => {
    const config = parseResilienceConfig({
      GEMINI_API_KEY: "key",
      GEMINI_MODEL: "",
      GEMINI_FALLBACK_MODEL: "   ",
      OPENAI_MODEL: "",
      GEMINI_MAX_RETRIES: "",
    });
    assert.equal(config.primaryModel, "gemini-2.5-flash");
    assert.equal(config.fallbackModel, "gemini-2.0-flash");
    assert.equal(config.openaiModel, "gpt-4o-mini");
    assert.equal(config.maxRetries, 4);
  });
});

describe("envString", () => {
  it("trims and falls back", () => {
    assert.equal(envString("  ", "default"), "default");
    assert.equal(envString(" model ", "default"), "model");
  });
});

describe("isTransientLlmError", () => {
  it("treats 503 and 429 as transient", () => {
    assert.equal(isTransientLlmError({ status: 503 }), true);
    assert.equal(isTransientLlmError({ status: 429 }), true);
  });

  it("does not retry 400", () => {
    assert.equal(isTransientLlmError({ status: 400 }), false);
    assert.equal(isTransientLlmError({ status: 401 }), false);
  });

  it("does not treat 404 as transient (skip provider instead)", () => {
    assert.equal(isTransientLlmError({ status: 404 }), false);
  });
});

describe("getHttpStatus", () => {
  it("reads status from GoogleGenerativeAI-style errors", () => {
    assert.equal(getHttpStatus({ status: 503, statusText: "Service Unavailable" }), 503);
  });

  it("does not parse status from free-form messages", () => {
    assert.equal(getHttpStatus({ message: "Error 503 from somewhere" }), undefined);
  });
});

describe("computeBackoffDelayMs", () => {
  it("applies exponential backoff with jitter bounds", () => {
    const delay = computeBackoffDelayMs(2, {
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      jitter: () => 0,
    });
    assert.equal(delay, 2000);
    const jittered = computeBackoffDelayMs(0, {
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      jitter: () => 1,
    });
    assert.equal(jittered, 1000);
  });
});

describe("sanitizeErrorDetail", () => {
  it("redacts API key patterns", () => {
    const out = sanitizeErrorDetail("failed with AIzaSyBadKey1234567890abcdef");
    assert.match(out, /\[redacted\]/);
    assert.doesNotMatch(out, /AIzaSy/);
  });
});

describe("withTransientRetries", () => {
  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const result = await withTransientRetries(
      async () => {
        calls += 1;
        if (calls < 3) {
          const err = new Error("overloaded");
          err.status = 503;
          throw err;
        }
        return "ok";
      },
      {
        maxRetries: 5,
        baseDelayMs: 1,
        maxDelayMs: 10,
        deadlineAt: Date.now() + 5000,
        perAttemptTimeoutMs: 5000,
        sleep: async () => {},
        jitter: () => 0,
        label: "test",
      },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
  });

  it("does not retry non-transient failures", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withTransientRetries(
          async () => {
            calls += 1;
            const err = new Error("bad request");
            err.status = 400;
            throw err;
          },
          {
            maxRetries: 5,
            baseDelayMs: 1,
            maxDelayMs: 10,
            deadlineAt: Date.now() + 5000,
            perAttemptTimeoutMs: 5000,
            sleep: async () => {},
            jitter: () => 0,
            label: "test",
          },
        ),
      (e) => e.status === 400,
    );
    assert.equal(calls, 1);
  });
});

describe("withAttemptTimeout", () => {
  it("rejects when the attempt exceeds the timeout", async () => {
    await assert.rejects(
      () =>
        withAttemptTimeout(
          () => new Promise((resolve) => setTimeout(() => resolve("late"), 200)),
          20,
        ),
      (e) => e.name === "TimeoutError",
    );
  });
});

describe("generateTextWithResilience", () => {
  const baseConfig = {
    ...parseResilienceConfig({
      GEMINI_API_KEY: "test-key",
      GEMINI_MAX_RETRIES: "2",
      GEMINI_RETRY_BASE_MS: "1",
      GEMINI_RETRY_MAX_MS: "5",
      GEMINI_REQUEST_DEADLINE_MS: "500",
      GEMINI_PER_ATTEMPT_TIMEOUT_MS: "200",
      GEMINI_MODEL: "primary",
      GEMINI_FALLBACK_MODEL: "fallback",
    }),
  };

  it("falls back to secondary Gemini model after primary exhausts retries", async () => {
    const calls = [];
    const text = await generateTextWithResilience("prompt", {
      config: baseConfig,
      sleep: async () => {},
      jitter: () => 0,
      generateGemini: async (model) => {
        calls.push(model);
        if (model === "primary") {
          const err = new Error("503");
          err.status = 503;
          throw err;
        }
        return "from-fallback";
      },
    });
    assert.equal(text, "from-fallback");
    assert.ok(calls.filter((m) => m === "primary").length >= 2);
    assert.ok(calls.includes("fallback"));
  });

  it("skips retired primary model (404) and uses fallback", async () => {
    const text = await generateTextWithResilience("prompt", {
      config: baseConfig,
      sleep: async () => {},
      generateGemini: async (model) => {
        if (model === "primary") {
          const err = new Error("not found");
          err.status = 404;
          throw err;
        }
        return "from-fallback";
      },
    });
    assert.equal(text, "from-fallback");
  });

  it("uses OpenAI when configured and Gemini paths fail", async () => {
    const text = await generateTextWithResilience("prompt", {
      config: { ...baseConfig, openaiApiKey: "sk-test" },
      sleep: async () => {},
      jitter: () => 0,
      generateGemini: async () => {
        const err = new Error("unavailable");
        err.status = 503;
        throw err;
      },
      generateOpenAI: async () => "from-openai",
    });
    assert.equal(text, "from-openai");
  });

  it("does not call OpenAI when no API key is configured", async () => {
    let openaiCalls = 0;
    await assert.rejects(
      () =>
        generateTextWithResilience("prompt", {
          config: baseConfig,
          sleep: async () => {},
          jitter: () => 0,
          generateGemini: async () => {
            const err = new Error("unavailable");
            err.status = 503;
            throw err;
          },
          generateOpenAI: async () => {
            openaiCalls += 1;
            return "from-openai";
          },
        }),
      (e) => e instanceof LlmSoftUnavailableError,
    );
    assert.equal(openaiCalls, 0);
  });

  it("soft-fails when all providers are unavailable", async () => {
    await assert.rejects(
      () =>
        generateTextWithResilience("prompt", {
          config: baseConfig,
          sleep: async () => {},
          jitter: () => 0,
          generateGemini: async () => {
            const err = new Error("high demand");
            err.status = 503;
            throw err;
          },
        }),
      (e) => e instanceof LlmSoftUnavailableError && e.message.includes("saturado"),
    );
  });

  it("fails fast on request-level 400 errors", async () => {
    await assert.rejects(
      () =>
        generateTextWithResilience("prompt", {
          config: baseConfig,
          sleep: async () => {},
          generateGemini: async () => {
            const err = new Error("invalid");
            err.status = 400;
            throw err;
          },
        }),
      (e) => e instanceof LlmUserFacingError && e.message.includes("rechazada"),
    );
  });

  it("finishes by deadline when a provider hangs", async () => {
    const start = Date.now();
    await assert.rejects(
      () =>
        generateTextWithResilience("prompt", {
          config: {
            ...baseConfig,
            maxRetries: 5,
            deadlineMs: 120,
            perAttemptTimeoutMs: 80,
          },
          sleep: async () => {},
          jitter: () => 0,
          generateGemini: async (_model, _prompt, attemptTimeoutMs) =>
            new Promise((resolve) => setTimeout(() => resolve("never"), attemptTimeoutMs + 500)),
        }),
      (e) => e instanceof LlmSoftUnavailableError,
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 800, `expected deadline-bound finish, took ${elapsed}ms`);
  });

  it("does not retry the same provider after a timeout (moves to fallback)", async () => {
    const calls = [];
    const text = await generateTextWithResilience("prompt", {
      config: { ...baseConfig, maxRetries: 5 },
      sleep: async () => {},
      jitter: () => 0,
      generateGemini: async (model, _prompt, attemptTimeoutMs) => {
        calls.push(model);
        if (model === "primary") {
          return new Promise((resolve) => setTimeout(() => resolve("late"), attemptTimeoutMs + 500));
        }
        return "from-fallback";
      },
    });
    assert.equal(text, "from-fallback");
    assert.equal(calls.filter((m) => m === "primary").length, 1);
  });

  it("hard-fails when every provider returns 403", async () => {
    await assert.rejects(
      () =>
        generateTextWithResilience("prompt", {
          config: baseConfig,
          sleep: async () => {},
          generateGemini: async () => {
            const err = new Error("forbidden");
            err.status = 403;
            throw err;
          },
        }),
      (e) => e instanceof LlmUserFacingError && !(e instanceof LlmSoftUnavailableError),
    );
  });

  it("hard-fails when every provider returns 404", async () => {
    await assert.rejects(
      () =>
        generateTextWithResilience("prompt", {
          config: baseConfig,
          sleep: async () => {},
          generateGemini: async () => {
            const err = new Error("not found");
            err.status = 404;
            throw err;
          },
        }),
      (e) => e instanceof LlmUserFacingError && !(e instanceof LlmSoftUnavailableError),
    );
  });
});
