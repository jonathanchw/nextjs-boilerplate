import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeBackoffDelayMs,
  generateTextWithResilience,
  getHttpStatus,
  isTransientLlmError,
  LlmUserFacingError,
  parseResilienceConfig,
  sanitizeErrorDetail,
  withTransientRetries,
} from "./llmResilience.js";

describe("isTransientLlmError", () => {
  it("treats 503 and 429 as transient", () => {
    assert.equal(isTransientLlmError({ status: 503 }), true);
    assert.equal(isTransientLlmError({ status: 429 }), true);
  });

  it("does not retry 400 or auth errors", () => {
    assert.equal(isTransientLlmError({ status: 400 }), false);
    assert.equal(isTransientLlmError({ status: 401 }), false);
    assert.equal(isTransientLlmError({ message: "API key not valid" }), false);
  });
});

describe("getHttpStatus", () => {
  it("reads status from GoogleGenerativeAI-style errors", () => {
    assert.equal(getHttpStatus({ status: 503, statusText: "Service Unavailable" }), 503);
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

describe("generateTextWithResilience", () => {
  const baseConfig = {
    ...parseResilienceConfig({
      GEMINI_API_KEY: "test-key",
      GEMINI_MAX_RETRIES: "2",
      GEMINI_RETRY_BASE_MS: "1",
      GEMINI_RETRY_MAX_MS: "5",
      GEMINI_REQUEST_DEADLINE_MS: "10000",
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

  it("returns a user-facing error when all providers fail", async () => {
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
      (e) => e instanceof LlmUserFacingError && e.message.includes("saturado"),
    );
  });

  it("fails fast on non-transient Gemini errors", async () => {
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
});
