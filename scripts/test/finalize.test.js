// Unit tests for the pure planning logic in scripts/lib/finalize.js, plus an
// integration test of applyPlan()'s actual file I/O — run entirely against
// fixtures and a throwaway OS temp directory. Never touches the real
// data/images.json, images/, or staging/.
//
// Run with: node --test scripts/test/finalize.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { planFinalize, applyPlan, pickWinner, creditLine, manifestToCsv } = require('../lib/finalize');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function loadPlanFixtures() {
  return {
    speciesList: loadFixture('finalize-species.json'),
    candidates: loadFixture('finalize-candidates.json'),
    decisions: loadFixture('finalize-decisions.json'),
  };
}

test('pickWinner prefers the reference illustration over other approved candidates', () => {
  const illustration = { id: 'a', isReferenceIllustration: true };
  const photo = { id: 'b', isReferenceIllustration: false };
  assert.equal(pickWinner([photo, illustration]).id, 'a');
  assert.equal(pickWinner([illustration, photo]).id, 'a');
  assert.equal(pickWinner([photo]).id, 'b');
  assert.equal(pickWinner([]), null);
});

test('planFinalize: illustration wins the adult slot, photo alternate is kept but unused', () => {
  const plan = planFinalize(loadPlanFixtures());

  assert.equal(plan.imagesJsonUpdates['brook-trout'].adult.status, 'verified');
  assert.match(plan.imagesJsonUpdates['brook-trout'].adult.localPath, /brook-trout\/adult\.png$/);
  assert.match(plan.imagesJsonUpdates['brook-trout'].adult.credit, /Duane Raver/);

  const adultRows = plan.manifestRows.filter((r) => r.speciesId === 'brook-trout' && r.stage === 'adult');
  assert.equal(adultRows.length, 2, 'both the illustration and the alternate photo should appear in the manifest');
  const used = adultRows.find((r) => r.used);
  const unused = adultRows.find((r) => !r.used);
  assert.equal(used.candidateId, 'wikimedia-commons-aaa1111111');
  assert.equal(unused.candidateId, 'wikimedia-commons-bbb2222222');
  assert.match(unused.reason, /alternate/);
});

test('planFinalize: sole approved candidate wins its slot by default', () => {
  const plan = planFinalize(loadPlanFixtures());
  assert.equal(plan.imagesJsonUpdates['brook-trout'].juvenile.status, 'verified');
  assert.match(plan.imagesJsonUpdates['brook-trout'].juvenile.localPath, /brook-trout\/juvenile\.jpg$/);
  assert.match(plan.imagesJsonUpdates['brook-trout'].juvenile.credit, /J\. Smith/);
});

test('planFinalize: approved-but-unassigned-stage candidates are excluded from images.json and flagged, never silently used', () => {
  const plan = planFinalize(loadPlanFixtures());
  assert.equal(plan.unassignedCount, 1);
  const row = plan.manifestRows.find((r) => r.candidateId === 'inaturalist-ddd4444444');
  assert.ok(row, 'unassigned candidate must still appear in the manifest for traceability');
  assert.equal(row.used, false);
  assert.match(row.reason, /no life stage assigned/);
  // and it must not have silently become e.g. the "adult" image for its species
  assert.notEqual(plan.imagesJsonUpdates['brook-trout'].adult.localPath, undefined);
  assert.doesNotMatch(plan.imagesJsonUpdates['brook-trout'].adult.credit, /Pat Fisher/);
});

test('planFinalize: rejected candidates never appear in the plan at all', () => {
  const plan = planFinalize(loadPlanFixtures());
  const found = plan.manifestRows.find((r) => r.candidateId === 'gbif-eee5555555');
  assert.equal(found, undefined);
  for (const ops of plan.copyOps) assert.notEqual(ops.from, 'staging/images/brook-trout/unknown/gbif-eee5555555.jpg');
});

test('planFinalize: gaps computed for stages with no winning candidate, across all tracked species', () => {
  const plan = planFinalize(loadPlanFixtures());
  const gapKeys = plan.gapsRemaining.map((g) => `${g.speciesId}/${g.stage}`);
  assert.ok(gapKeys.includes('brook-trout/fry'), 'fry has zero candidates at all -> gap');
  assert.ok(gapKeys.includes('rainbow-trout/adult'), 'species with no candidates at all -> gap');
  assert.ok(!gapKeys.includes('brook-trout/adult'), 'adult was resolved by the illustration -> not a gap');
  assert.ok(!gapKeys.includes('brook-trout/juvenile'), 'juvenile was resolved -> not a gap');
});

test('creditLine formats author + license + source', () => {
  const line = creditLine({ author: 'Jane Photographer', licenseLabel: 'CC BY-SA 4.0', source: 'wikimedia-commons' });
  assert.equal(line, 'Jane Photographer — CC BY-SA 4.0, via Wikimedia Commons');
});

test('manifestToCsv quotes fields containing commas and escapes embedded quotes', () => {
  const csv = manifestToCsv([{ candidateId: 'x', speciesId: 'brook-trout', reason: 'has, a comma and "quotes"' }]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"has, a comma and ""quotes"""/);
});

test('applyPlan: writes images.json, manifest json+csv, gaps log, and copies winning files — in a throwaway temp dir only', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fisher-finalize-test-'));
  try {
    // Minimal fixture staging tree + starting images.json, all inside tmpRoot.
    const stagingDir = path.join(tmpRoot, 'staging', 'images', 'brook-trout', 'adult');
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, 'wikimedia-commons-aaa1111111.png'), Buffer.from('fake-png-bytes'));

    fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
    const imagesJsonPath = path.join(tmpRoot, 'data', 'images.json');
    fs.writeFileSync(imagesJsonPath, JSON.stringify({ 'brook-trout': { adult: { status: 'placeholder' } } }));

    const manifestJsonPath = path.join(tmpRoot, 'data', 'image-attribution-manifest.json');
    const manifestCsvPath = path.join(tmpRoot, 'data', 'image-attribution-manifest.csv');
    const gapsLogPath = path.join(tmpRoot, 'data', 'image-sourcing-gaps.json');

    const plan = planFinalize({
      speciesList: [{ id: 'brook-trout', commonName: 'Brook Trout', scientificName: 'Salvelinus fontinalis', lifeStages: { adult: {} } }],
      candidates: [loadFixture('finalize-candidates.json')[0]], // just the illustration
      decisions: { 'wikimedia-commons-aaa1111111': { decision: 'approved' } },
    });

    applyPlan(plan, { copyBaseDir: tmpRoot, imagesJsonPath, manifestJsonPath, manifestCsvPath, gapsLogPath });

    const copiedAbs = path.join(tmpRoot, 'images', 'species', 'brook-trout', 'adult.png');
    assert.ok(fs.existsSync(copiedAbs), 'winning image should be copied to images/species/<id>/<stage>.<ext>');
    assert.equal(fs.readFileSync(copiedAbs, 'utf8'), 'fake-png-bytes');

    const updatedImages = JSON.parse(fs.readFileSync(imagesJsonPath, 'utf8'));
    assert.equal(updatedImages['brook-trout'].adult.status, 'verified');

    const manifest = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].used, true);

    const csv = fs.readFileSync(manifestCsvPath, 'utf8');
    assert.match(csv, /candidateId/); // header row present

    const gaps = JSON.parse(fs.readFileSync(gapsLogPath, 'utf8'));
    assert.deepEqual(gaps, []);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
