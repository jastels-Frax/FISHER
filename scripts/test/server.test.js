// End-to-end smoke test of the review server's HTTP API against small,
// locally-generated fixture data — proves buildState()/decide/finalize wiring
// actually works over real HTTP, not just as isolated functions.
//
// Safety: this test writes into the REAL staging/ directory (there's no way
// to point server.js/staging.js at an alternate root without a much larger
// refactor), but it snapshots whatever is already there first and restores
// it afterward in a `finally`, and only ever calls /api/finalize with
// dryRun:true — which performs zero writes to data/images.json, images/, or
// any other committed file. Nothing outside staging/ is touched.
//
// Run with: node --test scripts/test/server.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const staging = require('../lib/staging');

function requestJson(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: 'localhost', port, path: urlPath, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
          catch (e) { resolve({ status: res.statusCode, body: chunks }); }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function requestRaw(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('review server: /api/state, /api/decide, /staging-images/*, and dry-run /api/finalize work end-to-end', async (t) => {
  // --- snapshot whatever real staging state already exists ---
  const backup = {
    candidates: fs.existsSync(staging.CANDIDATES_PATH) ? fs.readFileSync(staging.CANDIDATES_PATH) : null,
    decisions: fs.existsSync(staging.DECISIONS_PATH) ? fs.readFileSync(staging.DECISIONS_PATH) : null,
    gaps: fs.existsSync(staging.GAPS_PATH) ? fs.readFileSync(staging.GAPS_PATH) : null,
  };
  const fixtureImageDir = path.join(staging.IMAGES_DIR, '__servertest-species__', 'adult');
  const fixtureImageExisted = fs.existsSync(fixtureImageDir);

  let server;
  try {
    // --- install tiny fixture state ---
    staging.ensureDir(fixtureImageDir);
    const fixtureImagePath = path.join(fixtureImageDir, 'wikimedia-commons-fixture.png');
    fs.writeFileSync(fixtureImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes, doesn't need to be a valid image for this test

    const candidate = {
      id: 'wikimedia-commons-fixture',
      source: 'wikimedia-commons',
      sourceType: 'illustration',
      title: 'File:Fixture.png',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.png',
      imageUrl: 'https://upload.wikimedia.org/fixture.png',
      mime: 'image/png',
      licenseCode: 'public-domain',
      licenseLabel: 'Public domain',
      author: 'Test Fixture Author',
      lifeStageGuess: 'adult',
      stage: 'adult',
      isReferenceIllustration: true,
      lifeStageConfidence: 'confirmed',
      speciesId: '__servertest-species__',
      commonName: 'Server Test Fixture Species',
      scientificName: 'Testus fixturus',
      retrievedAt: '2026-07-01T00:00:00.000Z',
      localPath: path.relative(staging.ROOT, fixtureImagePath).split(path.sep).join('/'),
      fileSizeBytes: 4,
    };
    staging.saveCandidates([candidate]);
    staging.saveDecisions({});
    staging.saveGaps([]);

    // NOTE: this species doesn't exist in the real data/species.json, so
    // buildState()'s species.map() naturally won't include it — /api/state
    // is grouped by data/species.json's species list, not by whatever
    // happens to be in candidates.json. That's fine: we only need /api/decide,
    // /staging-images/*, and /api/finalize (dry-run) to see it, which they do
    // since those read straight from staging/candidates.json.

    const { server: srv } = require('../review/server');
    server = srv;
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const state = await requestJson(port, 'GET', '/api/state');
    assert.equal(state.status, 200);
    assert.ok(Array.isArray(state.body.species));
    assert.ok(state.body.totalCandidates >= 1);

    const img = await requestRaw(port, '/staging-images/' + candidate.localPath.replace(/^staging\/images\//, ''));
    assert.equal(img.status, 200);
    assert.equal(img.body.length, 4);

    const traversal = await requestRaw(port, '/staging-images/' + encodeURIComponent('../../../../etc/passwd'));
    assert.notEqual(traversal.status, 200, 'path traversal outside staging/images must be rejected');

    const decide = await requestJson(port, 'POST', '/api/decide', { candidateId: candidate.id, decision: 'approved' });
    assert.equal(decide.status, 200);
    const decisionsOnDisk = staging.loadDecisions();
    assert.equal(decisionsOnDisk[candidate.id].decision, 'approved');

    const dryRun = await requestJson(port, 'POST', '/api/finalize', { dryRun: true });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.dryRun, true);
    assert.equal(typeof dryRun.body.gapsRemaining, 'number');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));

    // --- restore real staging state exactly as found ---
    fs.rmSync(path.join(staging.IMAGES_DIR, '__servertest-species__'), { recursive: true, force: true });
    if (!fixtureImageExisted) { /* already removed above */ }

    if (backup.candidates === null) fs.rmSync(staging.CANDIDATES_PATH, { force: true }); else fs.writeFileSync(staging.CANDIDATES_PATH, backup.candidates);
    if (backup.decisions === null) fs.rmSync(staging.DECISIONS_PATH, { force: true }); else fs.writeFileSync(staging.DECISIONS_PATH, backup.decisions);
    if (backup.gaps === null) fs.rmSync(staging.GAPS_PATH, { force: true }); else fs.writeFileSync(staging.GAPS_PATH, backup.gaps);
  }
});
