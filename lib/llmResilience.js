import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

/** User-safe error; message is safe to log in CI and must not contain secrets or raw API bodies. */
export class LlmUserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = "LlmUserFacingError";
  }
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504, 524]);
const NON_TRANSIENT_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

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
  const match = String(e.message ?? "").match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

/**
 * @param {unknown} error
 */
export function isTransientLlmError(error) {
  const status = getHttpStatus(error);
  if (status !== undefined) {
    if (NON_TRANSIENT_HTTP_STATUSES.has(status)) return false;
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

  if (
    message.includes("api key") ||
    message.includes("permission_denied") ||
    message.includes("invalid_argument") ||
    message.includes("safety") ||
    message.includes("blocked")
  ) {
    return false;
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
 * @param {Record<string, string | undefined>} [env]
 */
export function parseResilienceConfig(env = process.env) {
  const maxRetries = Math.max(0, parseInt(env.GEMINI_MAX_RETRIES ?? "4", 10) || 0);
  return {
    geminiApiKey: env.GEMINI_API_KEY,
    primaryModel: env.GEMINI_MODEL ?? "gemini-2.5-flash",
    fallbackModel: env.GEMINI_FALLBACK_MODEL ?? "gemini-2.0-flash",
    maxRetries,
    baseDelayMs: Math.max(100, parseInt(env.GEMINI_RETRY_BASE_MS ?? "1000", 10) || 1000),
    maxDelayMs: Math.max(1000, parseInt(env.GEMINI_RETRY_MAX_MS ?? "30000", 10) || 30000),
    deadlineMs: Math.max(5000, parseInt(env.GEMINI_REQUEST_DEADLINE_MS ?? "120000", 10) || 120000),
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL ?? "gpt-4o-mini",
  };
}

function assertWithinDeadline(deadlineAt, label) {
  if (Date.now() >= deadlineAt) {
    throw new LlmUserFacingError(
      `No se pudo generar el artículo: se agotó el tiempo de espera (${label}) tras varios reintentos. Inténtalo de nuevo más tarde.`,
    );
  }
}

/**
 * @param {() => Promise<string>} fn
 * @param {{ maxRetries: number; baseDelayMs: number; maxDelayMs: number; deadlineAt: number; sleep: (ms: number) => Promise<void>; jitter: () => number; label: string }} ctx
 */
export async function withTransientRetries(fn, ctx) {
  let attempt = 0;
  let lastError;
  while (attempt <= ctx.maxRetries) {
    assertWithinDeadline(ctx.deadlineAt, ctx.label);
    try {
      return await fn();
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
 *   generateGemini?: (model: string, prompt: string) => Promise<string>;
 *   generateOpenAI?: (model: string, prompt: string) => Promise<string>;
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
    );
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const defaultGemini = async (model, p) => {
    const m = genAI.getGenerativeModel({ model });
    const result = await m.generateContent(p);
    return result.response.text();
  };
  const generateGemini = options.generateGemini ?? defaultGemini;

  const defaultOpenAI = async (model, p) => {
    if (!config.openaiApiKey) {
      throw new LlmUserFacingError("OpenAI no está configurado.");
    }
    const client = new OpenAI({ apiKey: config.openaiApiKey });
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
    sleep,
    jitter,
  };

  const providers = [
    { label: `Gemini (${config.primaryModel})`, run: () => generateGemini(config.primaryModel, prompt) },
    { label: `Gemini respaldo (${config.fallbackModel})`, run: () => generateGemini(config.fallbackModel, prompt) },
  ];

  if (config.openaiApiKey) {
    providers.push({
      label: `OpenAI (${config.openaiModel})`,
      run: () => generateOpenAI(config.openaiModel, prompt),
    });
  }

  const errors = [];
  for (const provider of providers) {
    try {
      return await withTransientRetries(provider.run, { ...retryCtx, label: provider.label });
    } catch (error) {
      errors.push({ provider: provider.label, error });
      if (!isTransientLlmError(error)) {
        throw new LlmUserFacingError(toUserFacingLlmMessage(error));
      }
    }
  }

  const last = errors[errors.length - 1]?.error;
  throw new LlmUserFacingError(toUserFacingLlmMessage(last));
}
