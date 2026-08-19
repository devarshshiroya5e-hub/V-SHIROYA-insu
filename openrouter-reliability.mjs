// Reliability layer for bulk policy analysis.
// Keeps OpenRouter requests below the free-tier request rate, serializes bursts,
// and retries transient 429/5xx failures without changing the frontend contract.
const originalFetch = globalThis.fetch;
const MIN_INTERVAL_MS = Number(process.env.OPENROUTER_MIN_INTERVAL_MS || 3200);
const MAX_RETRIES = Number(process.env.OPENROUTER_MAX_RETRIES || 2);
const TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 180000);
let queue = Promise.resolve();
let lastStart = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isOpenRouter(input) {
  const url = typeof input === "string" ? input : input?.url || "";
  return url.includes("openrouter.ai/api/v1/chat/completions");
}

async function runOpenRouter(input, init) {
  let attempt = 0;
  while (true) {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastStart));
    if (wait) await sleep(wait);
    lastStart = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const requestInit = { ...(init || {}), signal: controller.signal };
    let response;
    try {
      response = await originalFetch(input, requestInit);
    } catch (error) {
      clearTimeout(timer);
      if (attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(1500 * attempt);
        continue;
      }
      throw error;
    }
    clearTimeout(timer);

    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt >= MAX_RETRIES) {
      return response;
    }

    const retryAfter = Number(response.headers.get("retry-after") || 0);
    attempt += 1;
    const backoff = retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt;
    console.warn(`OpenRouter ${response.status}; retrying attempt ${attempt}/${MAX_RETRIES} after ${backoff}ms`);
    await sleep(backoff);
  }
}

globalThis.fetch = (input, init) => {
  if (!isOpenRouter(input)) return originalFetch(input, init);
  const job = queue.then(() => runOpenRouter(input, init));
  queue = job.catch(() => undefined);
  return job;
};

console.log(`OpenRouter reliability layer loaded (interval=${MIN_INTERVAL_MS}ms, retries=${MAX_RETRIES})`);
