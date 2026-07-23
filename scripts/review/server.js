#!/usr/bin/env node
// Local review server for staged candidate images (no npm dependencies).
//
// Run: node scripts/review/server.js [--port=5183]
// Then open http://localhost:5183 in a browser.
//
// Reads/writes only local files under staging/ (and, on Finalize, images/ +
// data/images.json + data/image-attribution-manifest.*). Makes no network
// calls of its own — safe to run in any environment once staging/ has been
// populated by `node scripts/fetch-images.js` on a machine with internet access.

const http = require('http');
const fs = require('fs');
const path = require('path');
const staging = require('../lib/staging');
const { runFinalize } = require('../lib/finalize');

const ROOT = staging.ROOT;
const SPECIES_PATH = path.join(ROOT, 'data', 'species.json');
const PUBLIC_DIR = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendFile(res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) { sendJson(res, 404, { error: 'not found' }); return; }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; if (chunks.length > 5_000_000) req.destroy(); });
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}

function decorate(candidate, decisions) {
  const d = decisions[candidate.id];
  return {
    ...candidate,
    decision: d ? d.decision : null,
    stageOverride: d && d.stage ? d.stage : null,
    decidedAt: d ? d.decidedAt : null,
  };
}

function buildState() {
  const speciesList = JSON.parse(fs.readFileSync(SPECIES_PATH, 'utf8')).species;
  const candidates = staging.loadCandidates();
  const decisions = staging.loadDecisions();
  const gaps = staging.loadGaps();
  const gapsBySpecies = new Map(gaps.map((g) => [g.speciesId, g]));

  const species = speciesList.map((s) => {
    const trackedStages = Object.keys(s.lifeStages || {});
    const own = candidates.filter((c) => c.speciesId === s.id).map((c) => decorate(c, decisions));
    const stageKeys = Array.from(new Set([...trackedStages, 'unknown']));
    const stages = {};
    for (const stage of stageKeys) {
      stages[stage] = own.filter((c) => (c.stageOverride || c.stage) === stage);
    }
    const gap = gapsBySpecies.get(s.id);
    return {
      id: s.id,
      commonName: s.commonName,
      scientificName: s.scientificName,
      trackedStages,
      stages,
      candidateCount: own.length,
      searchGaps: gap ? gap.stagesWithoutConfirmedImage : [],
    };
  });

  return { species, totalCandidates: candidates.length };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    } else if (req.method === 'GET' && (url.pathname === '/app.js' || url.pathname === '/style.css')) {
      sendFile(res, path.join(PUBLIC_DIR, url.pathname));
    } else if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, buildState());
    } else if (req.method === 'GET' && url.pathname.startsWith('/staging-images/')) {
      // Path-traversal guard: resolve and confirm it's still under staging/images/.
      const rel = decodeURIComponent(url.pathname.slice('/staging-images/'.length));
      const abs = path.join(staging.IMAGES_DIR, rel);
      if (!abs.startsWith(staging.IMAGES_DIR + path.sep)) { sendJson(res, 400, { error: 'invalid path' }); return; }
      sendFile(res, abs);
    } else if (req.method === 'POST' && url.pathname === '/api/decide') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const { candidateId, decision, stage } = body;
      if (!candidateId || !['approved', 'rejected', 'needs-different', null].includes(decision)) {
        sendJson(res, 400, { error: 'candidateId and a valid decision are required' });
        return;
      }
      const decisions = staging.loadDecisions();
      if (decision === null) {
        delete decisions[candidateId];
      } else {
        decisions[candidateId] = { decision, stage: stage || null, decidedAt: new Date().toISOString() };
      }
      staging.saveDecisions(decisions);
      sendJson(res, 200, { ok: true });
    } else if (req.method === 'POST' && url.pathname === '/api/finalize') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const plan = runFinalize({ dryRun: !!body.dryRun });
      sendJson(res, 200, {
        ok: true,
        dryRun: !!body.dryRun,
        imagesUpdated: Object.entries(plan.imagesJsonUpdates).reduce((n, [, stages]) => n + Object.keys(stages).length, 0),
        manifestRows: plan.manifestRows.length,
        gapsRemaining: plan.gapsRemaining.length,
        unassignedCount: plan.unassignedCount,
        plan,
      });
    } else {
      sendJson(res, 404, { error: 'not found' });
    }
  } catch (err) {
    console.error('Request error:', err);
    sendJson(res, 500, { error: err.message });
  }
});

function parsePort(argv) {
  const arg = argv.find((a) => a.startsWith('--port='));
  return arg ? Number(arg.slice('--port='.length)) : 5183;
}

if (require.main === module) {
  const port = parsePort(process.argv.slice(2));
  server.listen(port, () => {
    console.log(`Review server running at http://localhost:${port}`);
    console.log(`Serving candidates from: ${staging.CANDIDATES_PATH}`);
    console.log('Press Ctrl+C to stop.\n');
  });
}

module.exports = { server, buildState };
