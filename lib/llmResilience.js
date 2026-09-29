import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

/** User-safe error; message is safe to log in CI and must not contain secrets or raw API bodies. */
export class LlmUserFacingError extends Error {
  /**
   * @param {string} message
   * @param {{ isConfigError?: boolean }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "LlmUserFacingError";
    this.isConfigError = Boolean(options.isConfigError);
  }
}

/** All providers unavailable (overload/outage). Caller should soft-fail (exit 0). */
export class LlmSoftUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "LlmSoftUnavailableError";
  }
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504, 524]);
const PROVIDER_SKIP_HTTP_STATUSES = new Set([403, 404]);

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * @param {string | undefined} value
 * @param {string} defaultValue
 */
export function envString(value, defaultValue) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || defaultValue;
}

/**
 * @param {string | undefined} value
 * @param {number} defaultValue
 * @param {{ min?: number }} [options]
 */
export function envInt(value, defaultValue, options = {}) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const parsed = parseInt(trimmed.length > 0 ? trimmed : String(defaultValue), 10);
  const n = Number.isFinite(parsed) ? parsed : defaultValue;
  const min = options.min ?? Number.NEGATIVE_INFINITY;
  return Math.max(min, n);
}

/**
 * @param {unknown} error
 * @returns {number | undefined}
 */
export function getHttpStatus(error) {
  if (!error || typeof error !== "object") return undefined;
  const e = error;
  if (typeof e.status === "number") return e.status;
  if (typeof e.statusCode === "number") return e.statusCode;
  if (typeof e.code === "number") return e.code;
  const response = e.response;
  if (response && typeof response === "object" && typeof response.status === "number") {
    return response.status;
  }
  return undefined;
}

/**
 * @param {unknown} error
 */
export function isConfigLlmError(error) {
  const status = getHttpStatus(error);
  return status === 401;
}

/**
 * Request-level failures (bad prompt / safety) — do not try other models.
 * @param {unknown} error
 */
export function isRequestLevelFatalError(error) {
  const status = getHttpStatus(error);
  if (status === 400) return true;
  if (error && typeof error === "object") {
    const details = error.errorDetails;
    if (Array.isArray(details)) {
      return details.some((d) => d && typeof d === "object" && d.reason === "SAFETY");
    }
  }
  return false;
}

/**
 * Model- or provider-specific issue — try the next provider in the chain.
 * @param {unknown} error
 */
export function shouldTryNextProvider(error) {
  const status = getHttpStatus(error);
  if (status !== undefined && PROVIDER_SKIP_HTTP_STATUSES.has(status)) return true;
  if (isTransientLlmError(error)) return true;
  if (!isRequestLevelFatalError(error) && !isConfigLlmError(error) && status !== undefined) {
    return true;
  }
  return false;
}

/**
 * @param {unknown} error
 */
export function isTransientLlmError(error) {
  const status = getHttpStatus(error);
  if (status !== undefined) {
    if (isRequestLevelFatalError(error) || isConfigLlmError(error)) return false;
    if (PROVIDER_SKIP_HTTP_STATUSES.has(status)) return false;
    if (TRANSIENT_HTTP_STATUSES.has(status)) return true;
    if (status >= 500) return true;
    return false;
  }

  if (error && typeof error === "object") {
    const code = error.code;
    if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;
    const name = error.name;
    if (name === "AbortError" || name === "TimeoutError") return true;
  }

  const message = String(error?.message ?? error ?? "").toLowerCase();
  if (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("overloaded") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("resource exhausted")
  ) {
    return true;
  }

  return false;
}

/**
 * @param {number} attempt Zero-based attempt index for the upcoming retry wait.
 * @param {{ baseDelayMs: number; maxDelayMs: number; jitter?: () => number }} options
 */
export function computeBackoffDelayMs(attempt, { baseDelayMs, maxDelayMs, jitter = Math.random }) {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const jitterFactor = 0.5 + jitter() * 0.5;
  return Math.floor(exp * jitterFactor);
}

/**
 * Strip likely secrets and truncate noisy upstream payloads.
 * @param {string} raw
 */
export function sanitizeErrorDetail(raw) {
  let text = String(raw);
  text = text.replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[redacted]");
  text = text.replace(/AIza[a-zA-Z0-9_-]{10,}/g, "[redacted]");
  text = text.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [redacted]");
  if (text.length > 200) text = `${text.slice(0, 200)}…`;
  return text;
}

/**
 * @param {unknown} error
 */
export function toUserFacingLlmMessage(error) {
  const status = getHttpStatus(error);
  if (status === 401 || status === 403) {
    return "No se pudo autenticar con el proveedor de IA. Revisa la configuración de claves API.";
  }
  if (status === 400) {
    return "La solicitud al proveedor de IA fue rechazada. Revisa el contenido o la configuración del modelo.";
  }
  if (status === 429) {
    return "El proveedor de IA está limitando solicitudes. Se reintentó automáticamente sin éxito; vuelve a intentarlo más tarde.";
  }
  if (status === 503 || status === 502 || status === 504) {
    return "El proveedor de IA está saturado o no disponible temporalmente. Se reintentó automáticamente sin éxito; vuelve a intentarlo más tarde.";
  }
  if (isTransientLlmError(error)) {
    return "No se pudo generar el artículo: el servicio de IA no respondió a tiempo tras varios reintentos. Inténtalo de nuevo más tarde.";
  }
  const detail = sanitizeErrorDetail(error?.message ?? "Error desconocido");
  return `No se pudo generar el artículo: ${detail}`;
}

/**
 * @param {number} deadlineAt
 * @param {number} perAttemptCapMs
 */
export function getAttemptTimeoutMs(deadlineAt, perAttemptCapMs) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return 0;
  return Math.min(perAttemptCapMs, remaining);
}

/**
 * @param {() => Promise<T>} fn
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 * @template T
 */
export async function withAttemptTimeout(fn, timeoutMs) {
  if (timeoutMs <= 0) {
    const err = new Error("Attempt timed out");
    err.name = "TimeoutError";
    throw err;
  }
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error("Attempt timed out");
          err.name = "TimeoutError";
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function parseResilienceConfig(env = process.env) {
  const geminiApiKeyRaw = typeof env.GEMINI_API_KEY === "string" ? env.GEMINI_API_KEY.trim() : "";
  const openaiApiKeyRaw = typeof env.OPENAI_API_KEY === "string" ? env.OPENAI_API_KEY.trim() : "";
  return {
    geminiApiKey: geminiApiKeyRaw || undefined,
    primaryModel: envString(env.GEMINI_MODEL, "gemini-2.5-flash"),
    fallbackModel: envString(env.GEMINI_FALLBACK_MODEL, "gemini-2.0-flash"),
    maxRetries: envInt(env.GEMINI_MAX_RETRIES, 4, { min: 0 }),
    baseDelayMs: envInt(env.GEMINI_RETRY_BASE_MS, 1000, { min: 100 }),
    maxDelayMs: envInt(env.GEMINI_RETRY_MAX_MS, 30000, { min: 1000 }),
    deadlineMs: envInt(env.GEMINI_REQUEST_DEADLINE_MS, 120000, { min: 5000 }),
    perAttemptTimeoutMs: envInt(env.GEMINI_PER_ATTEMPT_TIMEOUT_MS, 60000, { min: 1000 }),
    openaiApiKey: openaiApiKeyRaw || undefined,
    openaiModel: envString(env.OPENAI_MODEL, "gpt-4o-mini"),
  };
}

function assertWithinDeadline(deadlineAt, label) {
  if (Date.now() >= deadlineAt) {
    const err = new Error(`Deadline exceeded (${label})`);
    err.name = "TimeoutError";
    throw err;
  }
}

/**
 * @param {(attemptTimeoutMs: number) => Promise<string>} attemptFn
 * @param {{ maxRetries: number; baseDelayMs: number; maxDelayMs: number; deadlineAt: number; perAttemptTimeoutMs: number; sleep: (ms: number) => Promise<void>; jitter: () => number; label: string }} ctx
 */
export async function withTransientRetries(attemptFn, ctx) {
  let attempt = 0;
  let lastError;
  while (attempt <= ctx.maxRetries) {
    assertWithinDeadline(ctx.deadlineAt, ctx.label);
    const attemptTimeoutMs = getAttemptTimeoutMs(ctx.deadlineAt, ctx.perAttemptTimeoutMs);
    try {
      return await attemptFn(attemptTimeoutMs);
    } catch (error) {
      lastError = error;
      if (!isTransientLlmError(error) || attempt >= ctx.maxRetries) {
        throw error;
      }
      const delay = computeBackoffDelayMs(attempt, {
        baseDelayMs: ctx.baseDelayMs,
        maxDelayMs: ctx.maxDelayMs,
        jitter: ctx.jitter,
      });
      const remaining = ctx.deadlineAt - Date.now();
      if (remaining <= 0 || delay > remaining) {
        throw error;
      }
      await ctx.sleep(Math.min(delay, remaining));
      attempt += 1;
    }
  }
  throw lastError;
}

/**
 * @param {string} prompt
 * @param {{
 *   config?: ReturnType<typeof parseResilienceConfig>;
 *   sleep?: (ms: number) => Promise<void>;
 *   jitter?: () => number;
 *   generateGemini?: (model: string, prompt: string, attemptTimeoutMs: number) => Promise<string>;
 *   generateOpenAI?: (model: string, prompt: string, attemptTimeoutMs: number) => Promise<string>;
 * }} [options]
 */
export async function generateTextWithResilience(prompt, options = {}) {
  const config = options.config ?? parseResilienceConfig();
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const jitter = options.jitter ?? Math.random;
  const deadlineAt = Date.now() + config.deadlineMs;

  if (!config.geminiApiKey) {
    throw new LlmUserFacingError(
      "No se configuró GEMINI_API_KEY. Añade la clave en los secretos del repositorio o en tu archivo .env local.",
      { isConfigError: true },
    );
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const defaultGemini = async (model, p) => {
    const m = genAI.getGenerativeModel({ model });
    const result = await m.generateContent(p);
    return result.response.text();
  };
  const generateGemini = options.generateGemini ?? defaultGemini;

  const defaultOpenAI = async (model, p, attemptTimeoutMs) => {
    if (!config.openaiApiKey) {
      throw new Error("OpenAI not configured");
    }
    const client = new OpenAI({
      apiKey: config.openaiApiKey,
      maxRetries: 0,
      timeout: attemptTimeoutMs,
    });
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: p }],
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error("OpenAI devolvió una respuesta vacía.");
    return text;
  };
  const generateOpenAI = options.generateOpenAI ?? defaultOpenAI;

  const retryCtx = {
    maxRetries: config.maxRetries,
    baseDelayMs: config.baseDelayMs,
    maxDelayMs: config.maxDelayMs,
    deadlineAt,
    perAttemptTimeoutMs: config.perAttemptTimeoutMs,
    sleep,
    jitter,
  };

  const runTimed = (attemptTimeoutMs, fn) =>
    withAttemptTimeout(() => fn(attemptTimeoutMs), attemptTimeoutMs);

  const providers = [
    {
      label: `Gemini (${config.primaryModel})`,
      run: (attemptTimeoutMs) =>
        runTimed(attemptTimeoutMs, (ms) => generateGemini(config.primaryModel, prompt, ms)),
    },
    {
      label: `Gemini respaldo (${config.fallbackModel})`,
      run: (attemptTimeoutMs) =>
        runTimed(attemptTimeoutMs, (ms) => generateGemini(config.fallbackModel, prompt, ms)),
    },
  ];

  if (config.openaiApiKey) {
    providers.push({
      label: `OpenAI (${config.openaiModel})`,
      run: (attemptTimeoutMs) =>
        runTimed(attemptTimeoutMs, (ms) => generateOpenAI(config.openaiModel, prompt, ms)),
    });
  }

  const errors = [];
  for (const provider of providers) {
    try {
      return await withTransientRetries(provider.run, { ...retryCtx, label: provider.label });
    } catch (error) {
      errors.push({ provider: provider.label, error });
      if (isConfigLlmError(error)) {
        throw new LlmUserFacingError(toUserFacingLlmMessage(error), { isConfigError: true });
      }
      if (isRequestLevelFatalError(error)) {
        throw new LlmUserFacingError(toUserFacingLlmMessage(error));
      }
      if (!shouldTryNextProvider(error)) {
        throw new LlmUserFacingError(toUserFacingLlmMessage(error));
      }
    }
  }

  const last = errors[errors.length - 1]?.error;
  throw new LlmSoftUnavailableError(toUserFacingLlmMessage(last));
}
