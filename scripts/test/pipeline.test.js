// Unit tests for the pure parsing/filtering logic used by fetch-images.js.
// These run entirely offline against saved fixture JSON — no live API calls —
// so they work in any environment, including one with no network access.
//
// Run with: node --test scripts/test/pipeline.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { normalizeLicense, isLicenseAllowed } = require('../lib/license');
const { toCandidate } = require('../lib/commons');
const { candidatesFromOccurrence, guessStage } = require('../lib/gbif');
const { candidatesFromObservation } = require('../lib/inaturalist');
const { dedupeKey } = require('../lib/staging');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

test('normalizeLicense handles Commons human-readable labels', () => {
  assert.equal(normalizeLicense('Public domain').code, 'public-domain');
  assert.equal(normalizeLicense('CC BY-SA 4.0').code, 'cc-by-sa');
  assert.equal(normalizeLicense('CC BY 4.0').code, 'cc-by');
  assert.equal(normalizeLicense('CC0').code, 'cc0');
  assert.equal(normalizeLicense('Copyrighted, non-commercial use only').code, 'other');
});

test('normalizeLicense handles GBIF CC legalcode URLs', () => {
  assert.equal(normalizeLicense('http://creativecommons.org/licenses/by/4.0/').code, 'cc-by');
  assert.equal(normalizeLicense('http://creativecommons.org/licenses/by-sa/4.0/').code, 'cc-by-sa');
  assert.equal(normalizeLicense('http://creativecommons.org/licenses/by-nc/4.0/').code, 'cc-by-nc');
  assert.equal(normalizeLicense('http://creativecommons.org/publicdomain/zero/1.0/legalcode').code, 'cc0');
});

test('normalizeLicense handles GBIF enum-like strings', () => {
  assert.equal(normalizeLicense('CC0_1_0').code, 'cc0');
  assert.equal(normalizeLicense('CC_BY_NC_4_0').code, 'cc-by-nc');
  assert.equal(normalizeLicense('CC_BY_SA_4_0').code, 'cc-by-sa');
  assert.equal(normalizeLicense('UNSPECIFIED').code, 'unknown');
});

test('normalizeLicense handles iNaturalist short codes and missing license', () => {
  assert.equal(normalizeLicense('cc-by-nc').code, 'cc-by-nc');
  assert.equal(normalizeLicense('cc-by-sa').code, 'cc-by-sa');
  assert.equal(normalizeLicense('cc0').code, 'cc0');
  assert.equal(normalizeLicense(null).code, 'unknown');
  assert.equal(normalizeLicense(undefined).code, 'unknown');
});

test('isLicenseAllowed: Commons allows CC-BY-SA and public domain, GBIF/iNat do not', () => {
  assert.equal(isLicenseAllowed('wikimedia-commons', 'public-domain'), true);
  assert.equal(isLicenseAllowed('wikimedia-commons', 'cc-by-sa'), true);
  assert.equal(isLicenseAllowed('wikimedia-commons', 'other'), false);
  assert.equal(isLicenseAllowed('wikimedia-commons', 'unknown'), false);

  assert.equal(isLicenseAllowed('gbif', 'cc-by-nc'), true);
  assert.equal(isLicenseAllowed('gbif', 'cc-by-sa'), false, 'GBIF spec explicitly excludes CC-BY-SA');
  assert.equal(isLicenseAllowed('gbif', 'unknown'), false);

  assert.equal(isLicenseAllowed('inaturalist', 'cc0'), true);
  assert.equal(isLicenseAllowed('inaturalist', 'cc-by-sa'), false);
});

test('commons.toCandidate extracts license/author from extmetadata, strips HTML from Artist', () => {
  const { raverIllustration, ccBySaPhoto, allRightsReservedPhoto } = loadFixture('commons-imageinfo.json');

  const illus = toCandidate({ title: raverIllustration.title, info: raverIllustration.info, sourceType: 'illustration', lifeStageGuess: 'adult' });
  assert.equal(illus.licenseCode, 'public-domain');
  assert.match(illus.author, /Duane Raver/);
  assert.equal(/<a /.test(illus.author), false, 'author credit should have HTML tags stripped');
  assert.equal(illus.imageUrl, raverIllustration.info.thumburl);

  const photo = toCandidate({ title: ccBySaPhoto.title, info: ccBySaPhoto.info, sourceType: 'photo', lifeStageGuess: 'unknown' });
  assert.equal(photo.licenseCode, 'cc-by-sa');

  const rejected = toCandidate({ title: allRightsReservedPhoto.title, info: allRightsReservedPhoto.info, sourceType: 'photo', lifeStageGuess: 'unknown' });
  assert.equal(rejected.licenseCode, 'other');
  assert.equal(isLicenseAllowed('wikimedia-commons', rejected.licenseCode), false);
});

test('gbif.guessStage maps Darwin Core lifeStage free text to app vocabulary', () => {
  assert.equal(guessStage('juvenile'), 'juvenile');
  assert.equal(guessStage('adult male, spawning colours'), 'adult');
  assert.equal(guessStage('egg'), 'egg');
  assert.equal(guessStage(null), 'unknown');
  assert.equal(guessStage('some unrelated free text'), 'unknown');
});

test('gbif.candidatesFromOccurrence: one candidate per StillImage media, non-image media skipped', () => {
  const occurrences = loadFixture('gbif-occurrences.json');
  const [juvenile, untaggedTwoPhotos, adultSpawning, eggUnspecified, soundOnly] = occurrences;

  const c1 = candidatesFromOccurrence(juvenile);
  assert.equal(c1.length, 1);
  assert.equal(c1[0].lifeStageGuess, 'juvenile');
  assert.equal(c1[0].lifeStageConfidence, 'confirmed');
  assert.equal(c1[0].licenseCode, 'cc-by');

  const c2 = candidatesFromOccurrence(untaggedTwoPhotos);
  assert.equal(c2.length, 2, 'occurrence with 2 StillImage media should yield 2 candidates');
  assert.ok(c2.every((c) => c.lifeStageConfidence === 'assumed'), 'no lifeStage field -> assumed, not confirmed');

  const c3 = candidatesFromOccurrence(adultSpawning);
  assert.equal(c3[0].lifeStageGuess, 'adult');
  assert.equal(c3[0].licenseCode, 'cc0');

  const c4 = candidatesFromOccurrence(eggUnspecified);
  assert.equal(c4[0].lifeStageGuess, 'egg');
  assert.equal(c4[0].licenseCode, 'unknown', 'UNSPECIFIED license should normalize to unknown, not be guessed as open');

  const c5 = candidatesFromOccurrence(soundOnly);
  assert.equal(c5.length, 0, 'Sound media must never produce an image candidate');
});

test('inaturalist.candidatesFromObservation: one candidate per photo, license read per-photo not per-observation', () => {
  const observations = loadFixture('inaturalist-observations.json');
  const [twoPhotos, unlicensed, cc0Obs] = observations;

  const c1 = candidatesFromObservation(twoPhotos);
  assert.equal(c1.length, 2);
  assert.equal(c1[0].licenseCode, 'cc-by-nc');
  assert.equal(c1[1].licenseCode, 'cc-by-sa');
  assert.equal(isLicenseAllowed('inaturalist', c1[1].licenseCode), false);

  const c2 = candidatesFromObservation(unlicensed);
  assert.equal(c2[0].licenseCode, 'unknown');
  assert.equal(isLicenseAllowed('inaturalist', c2[0].licenseCode), false);

  const c3 = candidatesFromObservation(cc0Obs);
  assert.equal(c3[0].licenseCode, 'cc0');
  assert.equal(isLicenseAllowed('inaturalist', c3[0].licenseCode), true);
});

test('staging.dedupeKey is stable for identical candidates and differs for different ones', () => {
  const a = { sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', imageUrl: 'https://upload.wikimedia.org/x.jpg' };
  const aAgain = { sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', imageUrl: 'https://upload.wikimedia.org/x.jpg' };
  const b = { sourceUrl: 'https://commons.wikimedia.org/wiki/File:Y.jpg', imageUrl: 'https://upload.wikimedia.org/y.jpg' };

  assert.equal(dedupeKey(a), dedupeKey(aAgain), 're-running on the same candidate must produce the same key');
  assert.notEqual(dedupeKey(a), dedupeKey(b));
});
