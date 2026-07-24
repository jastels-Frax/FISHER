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

const { planFinalize, applyPlan, orderForCarousel, creditLine, manifestToCsv } = require('../lib/finalize');

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

test('orderForCarousel puts the reference illustration first, keeps the rest in order', () => {
  const illustration = { id: 'a', isReferenceIllustration: true };
  const photo1 = { id: 'b', isReferenceIllustration: false };
  const photo2 = { id: 'c', isReferenceIllustration: false };
  assert.deepEqual(orderForCarousel([photo1, illustration, photo2]).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(orderForCarousel([photo1, photo2]).map((c) => c.id), ['b', 'c']);
  assert.deepEqual(orderForCarousel([]), []);
});

test('planFinalize: all approved candidates for a slot become carousel images, illustration first', () => {
  const plan = planFinalize(loadPlanFixtures());

  const adult = plan.imagesJsonUpdates['brook-trout'].adult;
  assert.equal(adult.status, 'verified');
  assert.equal(adult.images.length, 2, 'both the illustration and the approved photo should be in the carousel');
  assert.equal(adult.images[0].isReferenceIllustration, true, 'illustration should lead the carousel');
  assert.match(adult.images[0].localPath, /brook-trout\/adult-1\.png$/);
  assert.match(adult.images[0].credit, /Duane Raver/);
  assert.equal(adult.images[1].isReferenceIllustration, false);
  assert.match(adult.images[1].localPath, /brook-trout\/adult-2\.jpg$/);
  assert.match(adult.images[1].credit, /Jane Photographer/);

  const adultRows = plan.manifestRows.filter((r) => r.speciesId === 'brook-trout' && r.stage === 'adult');
  assert.equal(adultRows.length, 2, 'both should appear in the manifest, both marked used');
  assert.ok(adultRows.every((r) => r.used === true));
});

test('planFinalize: sole approved candidate becomes a single-image carousel', () => {
  const plan = planFinalize(loadPlanFixtures());
  const juvenile = plan.imagesJsonUpdates['brook-trout'].juvenile;
  assert.equal(juvenile.status, 'verified');
  assert.equal(juvenile.images.length, 1);
  assert.match(juvenile.images[0].localPath, /brook-trout\/juvenile-1\.jpg$/);
  assert.match(juvenile.images[0].credit, /J\. Smith/);
});

test('planFinalize: approved-but-unassigned-stage candidates are excluded from images.json and flagged, never silently used', () => {
  const plan = planFinalize(loadPlanFixtures());
  assert.equal(plan.unassignedCount, 1);
  const row = plan.manifestRows.find((r) => r.candidateId === 'inaturalist-ddd4444444');
  assert.ok(row, 'unassigned candidate must still appear in the manifest for traceability');
  assert.equal(row.used, false);
  assert.match(row.reason, /no life stage assigned/);
  // and it must not have silently become part of e.g. the "adult" carousel for its species
  const adultCredits = plan.imagesJsonUpdates['brook-trout'].adult.images.map((img) => img.credit);
  assert.ok(!adultCredits.some((c) => /Pat Fisher/.test(c)));
});

test('planFinalize: rejected candidates never appear in the plan at all', () => {
  const plan = planFinalize(loadPlanFixtures());
  const found = plan.manifestRows.find((r) => r.candidateId === 'gbif-eee5555555');
  assert.equal(found, undefined);
  for (const ops of plan.copyOps) assert.notEqual(ops.from, 'staging/images/brook-trout/unknown/gbif-eee5555555.jpg');
});

test('planFinalize: gaps computed for stages with no approved candidate, across all tracked species', () => {
  const plan = planFinalize(loadPlanFixtures());
  const gapKeys = plan.gapsRemaining.map((g) => `${g.speciesId}/${g.stage}`);
  assert.ok(gapKeys.includes('brook-trout/fry'), 'fry has zero candidates at all -> gap');
  assert.ok(gapKeys.includes('rainbow-trout/adult'), 'species with no candidates at all -> gap');
  assert.ok(!gapKeys.includes('brook-trout/adult'), 'adult was resolved -> not a gap');
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

test('applyPlan: writes images.json with a full image carousel, manifest json+csv, gaps log, and copies every approved file — in a throwaway temp dir only', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fisher-finalize-test-'));
  try {
    const stagingDir = path.join(tmpRoot, 'staging', 'images', 'brook-trout', 'adult');
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, 'wikimedia-commons-aaa1111111.png'), Buffer.from('fake-png-bytes'));
    fs.writeFileSync(path.join(stagingDir, 'wikimedia-commons-bbb2222222.jpg'), Buffer.from('fake-jpg-bytes'));

    fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
    const imagesJsonPath = path.join(tmpRoot, 'data', 'images.json');
    fs.writeFileSync(imagesJsonPath, JSON.stringify({ 'brook-trout': { adult: { status: 'placeholder' } } }));

    const manifestJsonPath = path.join(tmpRoot, 'data', 'image-attribution-manifest.json');
    const manifestCsvPath = path.join(tmpRoot, 'data', 'image-attribution-manifest.csv');
    const gapsLogPath = path.join(tmpRoot, 'data', 'image-sourcing-gaps.json');

    const [illustration, photo] = loadFixture('finalize-candidates.json');
    const speciesList = [{ id: 'brook-trout', commonName: 'Brook Trout', scientificName: 'Salvelinus fontinalis', lifeStages: { adult: {} } }];
    const paths = { copyBaseDir: tmpRoot, imagesJsonPath, manifestJsonPath, manifestCsvPath, gapsLogPath };

    const plan1 = planFinalize({
      speciesList,
      candidates: [illustration, photo],
      decisions: {
        'wikimedia-commons-aaa1111111': { decision: 'approved' },
        'wikimedia-commons-bbb2222222': { decision: 'approved' },
      },
    });
    applyPlan(plan1, paths);

    const dir = path.join(tmpRoot, 'images', 'species', 'brook-trout');
    assert.ok(fs.existsSync(path.join(dir, 'adult-1.png')), 'illustration should be copied as adult-1');
    assert.ok(fs.existsSync(path.join(dir, 'adult-2.jpg')), 'photo should be copied as adult-2');

    let updatedImages = JSON.parse(fs.readFileSync(imagesJsonPath, 'utf8'));
    assert.equal(updatedImages['brook-trout'].adult.status, 'verified');
    assert.equal(updatedImages['brook-trout'].adult.images.length, 2);

    let manifest = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));
    assert.equal(manifest.length, 2);

    const csv = fs.readFileSync(manifestCsvPath, 'utf8');
    assert.match(csv, /candidateId/);

    let gaps = JSON.parse(fs.readFileSync(gapsLogPath, 'utf8'));
    assert.deepEqual(gaps, []);

    // Now reject the second photo and re-finalize — the stale adult-2.jpg
    // file must be cleaned up, not left behind unreferenced.
    const plan2 = planFinalize({
      speciesList,
      candidates: [illustration, photo],
      decisions: {
        'wikimedia-commons-aaa1111111': { decision: 'approved' },
        'wikimedia-commons-bbb2222222': { decision: 'rejected' },
      },
    });
    applyPlan(plan2, paths);

    assert.ok(fs.existsSync(path.join(dir, 'adult-1.png')), 'remaining approved image should still exist');
    assert.ok(!fs.existsSync(path.join(dir, 'adult-2.jpg')), 'no-longer-approved image file should be cleaned up');

    updatedImages = JSON.parse(fs.readFileSync(imagesJsonPath, 'utf8'));
    assert.equal(updatedImages['brook-trout'].adult.images.length, 1);

    manifest = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));
    assert.equal(manifest.length, 1, 'manifest reflects only the current finalize run, not accumulated history');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
