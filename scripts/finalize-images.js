#!/usr/bin/env node
// CLI entry point for the finalize step — copies every approved candidate
// image into images/species/, updates data/images.json, and writes the
// attribution manifest + gap log. Same logic the review UI's Finalize
// button calls (scripts/lib/finalize.js); this just gives a scriptable path
// that doesn't require the browser.
//
// Usage:
//   node scripts/finalize-images.js            finalize for real
//   node scripts/finalize-images.js --dry-run  preview only, writes nothing

const { runFinalize } = require('./lib/finalize');

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const plan = runFinalize({ dryRun });

  const imagesUpdated = Object.entries(plan.imagesJsonUpdates)
    .reduce((n, [, stages]) => n + Object.keys(stages).length, 0);

  console.log(dryRun ? 'PREVIEW (nothing written):' : 'Finalize complete:');
  console.log(`  Images set/updated in data/images.json: ${imagesUpdated}`);
  console.log(`  Manifest rows: ${plan.manifestRows.length}`);
  console.log(`  Species/stage gaps still remaining: ${plan.gapsRemaining.length}`);
  if (plan.unassignedCount) {
    console.log(`  Approved candidates with no stage assigned yet: ${plan.unassignedCount} (open the review UI, set a stage, re-run)`);
  }
  if (!dryRun) {
    console.log('\nWrote: data/images.json, data/image-attribution-manifest.json, data/image-attribution-manifest.csv, data/image-sourcing-gaps.json');
  }
}

main();
