// Small Gemini client. The API key is read from the GEMINI_API_KEY environment variable only.
export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// Estimated price in USD per 1 million tokens. Free-tier calls really cost $0;
// this is what the same tokens WOULD cost on the paid tier. Override with env vars.
const PRICE_IN = Number(process.env.PRICE_INPUT_PER_M ?? 0.1);
const PRICE_OUT = Number(process.env.PRICE_OUTPUT_PER_M ?? 0.4);

export function estimateCostUsd(inputTokens, outputTokens) {
  return (inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1_000_000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_API_RETRIES = 3;
const RETRY_STATUS = new Set([429, 503]);

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Ask Gemini for text. On 429/503 wait and try again, up to 3 times.
 * Returns { text, inputTokens, outputTokens, apiRetries }.
 */
export async function callGemini({ system, prompt }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ApiError('GEMINI_API_KEY is not set on the server.', 500);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 16000 },
  };

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw new ApiError(`Could not reach the Gemini API: ${e.message}`, 0);
    }

    if (res.ok) {
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
      const u = data.usageMetadata || {};
      return {
        text,
        inputTokens: u.promptTokenCount || 0,
        // thinking tokens are billed as output tokens
        outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
        apiRetries: attempt,
      };
    }

    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* ignore */ }

    if (RETRY_STATUS.has(res.status) && attempt < MAX_API_RETRIES) {
      const wait = 2000 * 2 ** attempt; // 2s, 4s, 8s
      console.log(`  Gemini returned ${res.status}; waiting ${wait / 1000}s (retry ${attempt + 1}/${MAX_API_RETRIES})`);
      await sleep(wait);
      continue;
    }
    const hint = res.status === 429 ? ' (rate limit reached, please try again in a minute)' : '';
    throw new ApiError(`Gemini API error ${res.status}${hint}: ${detail.slice(0, 200)}`, res.status);
  }
}
