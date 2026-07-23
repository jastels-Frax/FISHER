// Small fetch wrapper: sets a descriptive User-Agent (required/expected by
// Commons, GBIF, and iNaturalist etiquette), retries on 429/5xx with backoff,
// and paces requests so this script doesn't hammer any of the three APIs.
// Uses Node's built-in global fetch (Node 18+) — no dependency needed.

const USER_AGENT = 'FisherSpeciesImageFetcher/1.0 (internal tool for Fraxinus Environmental & Geomatics; contact: see project README)';
const MIN_DELAY_MS = 350;
const MAX_DELAY_MS = 4000;
const MAX_RETRIES = 5;

// Adaptive pacing: starts at MIN_DELAY_MS between requests, but permanently
// backs off (up to MAX_DELAY_MS) for the rest of the run the first time a
// source starts returning 429s, rather than just retrying the one request
// that got rate-limited and immediately going back to hammering at the same
// rate. Wikimedia's file-download host in particular seems to rate-limit
// more aggressively than its API host once a run has made a lot of requests.
let lastRequestAt = 0;
let currentDelayMs = MIN_DELAY_MS;

async function pace() {
  const wait = lastRequestAt + currentDelayMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function bumpDelay() {
  currentDelayMs = Math.min(currentDelayMs * 1.5, MAX_DELAY_MS);
}

function shortLabel(url) {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

// Logs on every retry (not just the final failure) so a long run never goes
// silent while it's actually still working — a silent multi-second sleep
// looks indistinguishable from a hang when you're the one watching it run.
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
        if (res.status === 429) bumpDelay();
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const backoff = Math.min(Math.max(retryAfter * 1000, 500 * 2 ** attempt), MAX_DELAY_MS);
        if (attempt < MAX_RETRIES) {
          console.warn(`    ! HTTP ${res.status} from ${shortLabel(url)} — retrying in ${(backoff / 1000).toFixed(1)}s (attempt ${attempt + 2}/${MAX_RETRIES + 1})`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = Math.min(500 * 2 ** attempt, MAX_DELAY_MS);
        console.warn(`    ! network error from ${shortLabel(url)} (${err.message}) — retrying in ${(backoff / 1000).toFixed(1)}s (attempt ${attempt + 2}/${MAX_RETRIES + 1})`);
        await new Promise((r) => setTimeout(r, backoff));
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

// Test-only introspection/reset — currentDelayMs is otherwise process-lifetime
// state, which is exactly what we want in production (stay cautious for the
// rest of a run once rate-limited) but needs to be resettable between tests.
function _getCurrentDelayMs() { return currentDelayMs; }
function _resetPacingForTest() { currentDelayMs = MIN_DELAY_MS; lastRequestAt = 0; }

module.exports = {
  fetchJson, fetchBinary, extFromContentType, USER_AGENT,
  _getCurrentDelayMs, _resetPacingForTest,
};
