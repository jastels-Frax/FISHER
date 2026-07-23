// Small fetch wrapper: sets a descriptive User-Agent (required/expected by
// Commons, GBIF, and iNaturalist etiquette), retries on 429/5xx with backoff,
// and paces requests so this script doesn't hammer any of the three APIs.
// Uses Node's built-in global fetch (Node 18+) — no dependency needed.

const USER_AGENT = 'FisherSpeciesImageFetcher/1.0 (internal tool for Fraxinus Environmental & Geomatics; contact: see project README)';
const MIN_DELAY_MS = 350;
const MAX_RETRIES = 3;

let lastRequestAt = 0;
async function pace() {
  const wait = lastRequestAt + MIN_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function fetchWithRetry(url, opts = {}) {
  await pace();
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(opts.headers || {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const backoff = Math.max(retryAfter * 1000, 500 * 2 ** attempt);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
    }
  }
  throw lastErr || new Error(`Failed to fetch ${url}`);
}

async function fetchJson(url, opts) {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

/**
 * @returns {{buffer: Buffer, contentType: string}}
 */
async function fetchBinary(url) {
  const res = await fetchWithRetry(url, { headers: { Accept: '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image ${url}`);
  const contentType = res.headers.get('content-type') || '';
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

function extFromContentType(contentType) {
  if (/jpeg|jpg/i.test(contentType)) return 'jpg';
  if (/png/i.test(contentType)) return 'png';
  if (/gif/i.test(contentType)) return 'gif';
  if (/webp/i.test(contentType)) return 'webp';
  return 'jpg';
}

module.exports = { fetchJson, fetchBinary, extFromContentType, USER_AGENT };
