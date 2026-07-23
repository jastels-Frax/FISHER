// Unit tests for the adaptive rate-limit backoff in scripts/lib/http.js.
// Mocks global.fetch so these run instantly and offline — no real HTTP.
//
// Run with: node --test scripts/test/http.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const http = require('../lib/http');

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
  };
}

test('fetchJson retries once on 429 and succeeds, and permanently slows future pacing', async () => {
  http._resetPacingForTest();
  const before = http._getCurrentDelayMs();

  let calls = 0;
  global.fetch = async () => {
    calls++;
    return calls === 1 ? jsonResponse(429, {}, {}) : jsonResponse(200, { ok: true });
  };

  const result = await http.fetchJson('https://example.test/api');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2, 'should have retried exactly once');
  assert.ok(http._getCurrentDelayMs() > before, '429 should bump the pacing delay for the rest of the run');
});

test('fetchJson retries on 5xx without bumping pacing delay (only 429 does)', async () => {
  http._resetPacingForTest();
  const before = http._getCurrentDelayMs();

  let calls = 0;
  global.fetch = async () => {
    calls++;
    return calls <= 2 ? jsonResponse(503, {}) : jsonResponse(200, { ok: true });
  };

  const result = await http.fetchJson('https://example.test/api');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
  assert.equal(http._getCurrentDelayMs(), before, '5xx should back off this request but not permanently slow the run');
});

test('fetchJson honors a Retry-After header instead of the default backoff', async () => {
  http._resetPacingForTest();
  let calls = 0;
  const start = Date.now();
  global.fetch = async () => {
    calls++;
    return calls === 1 ? jsonResponse(429, {}, { 'retry-after': '0' }) : jsonResponse(200, { ok: true });
  };

  await http.fetchJson('https://example.test/api');
  assert.equal(calls, 2);
  assert.ok(Date.now() - start < 2000, 'a Retry-After of 0 should not force the full default backoff');
});

test('fetchJson throws a descriptive error on a non-retryable 404', async () => {
  http._resetPacingForTest();
  global.fetch = async () => jsonResponse(404, {});
  await assert.rejects(() => http.fetchJson('https://example.test/missing'), /HTTP 404/);
});

test('extFromContentType maps common image content-types, defaults to jpg', () => {
  assert.equal(http.extFromContentType('image/png'), 'png');
  assert.equal(http.extFromContentType('image/jpeg'), 'jpg');
  assert.equal(http.extFromContentType('image/webp'), 'webp');
  assert.equal(http.extFromContentType('application/octet-stream'), 'jpg');
});
