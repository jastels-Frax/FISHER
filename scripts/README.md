# Reference image sourcing pipeline

Three steps, run in order, that together replace the placeholder entries in
`data/images.json` with real, license-checked reference images: one search
step (needs internet), one review step (offline), one finalize step (offline).

This is an internal tool for populating the app's own asset bundle — not
part of the shipped PWA itself. Nothing under `scripts/` is loaded by
`index.html`/`catalogue.html`/etc.

## Why this is split into three steps

The search step (`fetch-images.js`) is the only one that makes network
calls. It's designed to be run by a person, from a terminal with normal
internet access, watching the console output — not automated, and not run
from a network-restricted environment (some sandboxes only allow outbound
requests to a small host allowlist; Wikimedia/GBIF/iNaturalist won't be
reachable from those). The review and finalize steps only ever touch local
files, so they can run anywhere once `staging/` has been populated.

## 1. Fetch candidates

```
node scripts/fetch-images.js
```

No `npm install` needed — it only uses Node's built-in `fetch` (Node 18+).

For each species in `data/species.json`, this searches:

- **Wikimedia Commons** — a Duane Raver / USFWS illustration search (for the
  one reference illustration per species) plus a general photo search.
  Allowed licenses: public domain, CC0, CC-BY, CC-BY-SA.
- **GBIF** occurrence media (mostly re-published iNaturalist photos).
  Allowed licenses: CC0, CC-BY, CC-BY-NC (GBIF's license field is
  free text set by the data provider — anything untagged or ambiguous is
  skipped, never assumed usable).
- **iNaturalist** directly, as a supplement. Same allowed-license set as
  GBIF, for consistency (GBIF's fish media is largely republished
  iNaturalist content anyway).

FishBase is deliberately not scripted against — its image licensing is
inconsistent enough that it needs a case-by-case human look, not an API.

Every candidate that passes the license check is downloaded into
`staging/images/<speciesId>/<stage>/` and recorded in
`staging/candidates.json` with its full metadata (source, license, author,
source URL, retrieval date). Species/stage combinations where nothing with a
*confirmed* life stage was found are recorded in `staging/gaps.json` — a
photo with an unconfirmed/guessed stage does not count as filling the gap,
per "flag clearly rather than substitute a photo silently."

Re-running is safe and additive: existing candidates are matched by a stable
hash of their source URL + image URL and skipped, not re-downloaded or
duplicated.

Useful options:

```
node scripts/fetch-images.js --species=brook-trout,atlantic-salmon   # just these species
node scripts/fetch-images.js --stage=juvenile,parr                   # just these life stages
node scripts/fetch-images.js --max-per-stage=5                        # fewer candidates per stage
node scripts/fetch-images.js --dry-run                                # search + log only, no downloads
node scripts/fetch-images.js --help
```

If you reject every candidate for a species/stage in the review step below,
just re-run with adjusted terms for that species — there's no need to start
over.

**Note:** the Wikimedia Commons category names for the Duane Raver / USFWS
illustration set couldn't be verified from the environment this pipeline was
written in (no live Commons access), so `scripts/lib/commons.js` searches by
free-text query instead of an exact category. If you find the real category
titles differ from what turns up, it's easy to adjust the query strings in
`searchIllustrations()`.

## 2. Review candidates

```
node scripts/review/server.js
```

Open <http://localhost:5183>. Species are listed with their candidates
grouped by life stage. For each candidate you can see its image, license,
author, and a link back to the source, and:

- **Approve** — a green outline; this candidate becomes eligible to be used.
- **Needs different** — flags the slot as still needing a better candidate,
  without fully rejecting this one.
- **Reject** — greys it out; it will never be finalized.
- **Stage** dropdown — candidates whose life stage couldn't be confirmed
  from source metadata land in "Unassigned / unknown stage"; use this to
  move one into a real stage once you've looked at it. An approved candidate
  left unassigned is skipped at finalize time (see below) rather than
  guessed into a slot.

Decisions are saved immediately to `staging/decisions.json` as you click —
there's no separate save step. "Preview Finalize" shows what finalizing
would do without writing anything; "Finalize Approved" actually applies it
(see step 3).

If more than one candidate ends up approved for the same species+stage, the
reference illustration wins automatically when there is one (per the
original brief: prefer Duane Raver/USFWS for the "one clean reference
illustration"); otherwise the earliest-approved one wins. The rest stay
recorded as alternates in the attribution manifest, not deleted — reject them
if you don't want them lingering, or leave them as a documented backup
option.

## 3. Finalize

Either click **Finalize Approved** in the review UI, or run the same logic
from a terminal:

```
node scripts/finalize-images.js            # writes for real
node scripts/finalize-images.js --dry-run  # preview only
```

This:

1. Copies each winning approved image into
   `images/species/<speciesId>/<stage>.<ext>` (the app's real asset folder —
   already cached by the service worker automatically, no code changes
   needed).
2. Updates `data/images.json`, replacing placeholder entries with
   `{"status": "verified", "localPath": "...", "credit": "..."}`.
3. Writes `data/image-attribution-manifest.json` and `.csv` — one row per
   *approved* candidate (used or not), with full source/license/author
   traceability. This is kept separate from `data/images.json` because the
   attribution detail isn't shown in the app UI, but the app is internal-use
   only, so the bar is "reasonable internal use with attribution tracked,"
   not "cleared for redistribution" — the manifest is what makes that
   traceable later if licensing is ever questioned.
4. Writes `data/image-sourcing-gaps.json` — every species/stage still
   without a finalized image (no approved candidate at all, or the only
   approved candidate for that slot is still unassigned to a stage), so it's
   obvious what still needs manual sourcing or a field photo.

Finalize is safe to re-run after further review — it always recomputes from
the current `staging/candidates.json` + `staging/decisions.json`, and only
overwrites the specific species/stage entries it has a decision for; other
entries in `data/images.json` are left as-is.

## What's committed vs. what's not

`staging/` is gitignored — it's regenerable scratch state (re-run step 1 to
rebuild it, and step 2's decisions are a one-time curation pass, not meant to
be portable across machines). The pipeline's actual output —
`images/species/**`, `data/images.json`,
`data/image-attribution-manifest.{json,csv}`, and
`data/image-sourcing-gaps.json` — is committed, since that's what the app and
future contributors actually need.

## Tests

```
node --test scripts/test/*.test.js
```

All tests run offline against fixture JSON (no live network calls) —
`pipeline.test.js` covers license normalization and the three sources' pure
parsing/filtering logic, `finalize.test.js` covers the finalize planning
logic plus a real (temp-directory-only) file-write integration test, and
`server.test.js` is an end-to-end smoke test of the review server's HTTP API.
