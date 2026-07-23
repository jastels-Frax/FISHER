# NS Fish Field ID & Catalogue

Offline-first PWA for Nova Scotia fish species identification and habitat-survey catch
logging. Vanilla HTML/CSS/JS, no build step, IndexedDB for offline persistence, service
worker for asset caching. Designed to sit alongside the other Fraxinus field tools
(Safety PWA, Crossing Assessor, wildlife survey app) on GitHub Pages.

Camera-based/ML photo identification is explicitly **out of scope** for this app. The ID
workflow is a filterable species reference list plus a stepwise dichotomous key only.

## App structure

```
index.html        Home / hub
species.html       Filterable species reference list + detail view
key.html            Standalone dichotomous key
catalogue.html      Survey/station metadata + nested fish catch records (single-page app)
export.html         Survey selection (checkboxes/select-all), CSV/JSON export, per-survey
                    PDF report, clear-device view
manifest.json, sw.js, icons/   PWA shell + offline caching
fonts/               Self-hosted Oswald woff2 files (see Brand styling below)
css/styles.css      Shared high-contrast, one-handed mobile styling
js/                 db.js (IndexedDB), app.js (shared utils), species-list.js, key-engine.js,
                    identify-modal.js (in-context Identify overlay used from the catalogue form),
                    catalogue.js, export.js, pdf-report.js (branded per-survey PDF report,
                    see PDF export below), settings.js (Settings panel, see below),
                    species-page.js, key-page.js
data/species.json   Species reference data + citations (this file, see below)
data/key.json        Dichotomous key tree
data/images.json     Reference image manifest (see Image Sourcing — currently all placeholders)
scripts/             Reference-image fetch/review/finalize pipeline — see scripts/README.md
```

## Brand styling

Typography, color palette, and the logo were pulled from the three existing Fraxinus field
PWAs (`jastels-Frax/Safety`, `jastels-Frax/Watercourse-Permitting-App`, `jastels-Frax/Fraxinus_JA`
— the wildlife survey app) rather than invented fresh, so this app reads as part of the same
suite. What was reused, and from where:

- **Font — Oswald.** Used app-wide — headings, labels, nav, buttons, inputs, and body copy —
  as a single consistent typeface (an earlier pass split body copy off onto the system font
  stack to mirror the Safety PWA's specific convention, but that read as two mismatched
  typefaces in practice, so this app now uses Oswald everywhere instead). Self-hosted via the
  `@fontsource/oswald` npm package — OFL-1.1 licensed, see `fonts/OFL-LICENSE.txt` — since a
  CDN font link fails offline. Only the 4 weights actually used are bundled: 400 (body), 500
  (labels, nav, chips), 600 (subheadings, table headers, emphasis), 700 (h1/h2/h3, buttons) —
  about 50 KB total as woff2.
- **Logo.** The green compass/ash-leaf mark is Fraxinus's master logo file
  (`FRAXINUS_LOGO_Compass_Color_transparent.png`, found in the Safety repo and reused verbatim,
  unmodified, as the source for every logo asset in this app: `icons/fraxinus-mark-header.png`
  (in-app header), `icons/fraxinus-mark-report.png` (higher-resolution version for the PDF
  report, print-quality), and the PWA manifest icons (`icons/icon-{192,512}[-maskable].png`,
  composited onto an opaque `#111111` square to match how the sibling apps export their own
  manifest icons, with extra safe-zone padding on the maskable variants). No new logo artwork
  was created.
- **Color palette.** The three sibling apps don't share one identical palette (Safety: light
  cream body + orange accent; Wildlife app: dark body + green accent; Watercourse app: dark
  navy/cyan, and doesn't use Oswald at all — likely an earlier, pre-brand-system build). This
  app follows Safety's light-theme token *structure* (CSS custom properties, card/shadow/radius
  system, status-color set) almost verbatim — it's the most complete and polished reference
  implementation — but swaps the primary accent from Safety's safety-specific orange
  (`#E8731A`) to the Wildlife survey app's green (`#2D6B2D`, matching the logo's actual leaf
  color), since this app's subject matter (species/habitat data) is closer to that sibling than
  to Safety's hazard-reporting domain. The header is always-black (`#111111`) in both light and
  dark mode, and the bottom nav is a light bar with a top accent indicator on the active tab —
  both exact conventions lifted from Safety's `style.css`. The status-color set (native/ok,
  warning/flag, danger) reuses Safety's "risk" colors unchanged. All tokens live as CSS custom
  properties at the top of `css/styles.css` (`:root`, with light/dark overrides) for easy
  auditing.
- **Icons.** Nav/tile/button icons were switched from emoji to small inline monochrome SVGs
  (currentColor strokes) to match the sibling apps' clean line-icon convention instead of
  colorful OS emoji glyphs, which don't respect the brand palette.

The **Identify** button on the catalogue fish-entry form opens `identify-modal.js`, which
renders the same species list / key components used by the standalone pages as an overlay
`<div>` on top of the in-progress form — it never navigates away, so length/weight/notes
already entered are untouched. Confirming a species (or backing out via the uncertain path)
closes the modal and returns control to the form.

## PDF export

`js/pdf-report.js` generates one branded PDF per survey/station, available from a "PDF"
button next to each survey on `export.html`. Sourcing and approach:

- **No PDF library, no network call.** `openSurveyPdfReport()` builds a self-contained HTML
  string and opens it via `window.open('', '_blank', ...)` + `document.write()`, then the user
  clicks a "Print / Save as PDF" button in that preview, which calls `window.print()`. This is
  the exact pattern already used by the Wildlife survey app's own report generators
  (`js/turtlePDF.js`, `moosePDF.js`, `nestPDF.js`, `bbsPDF.js` in `jastels-Frax/Fraxinus_JA`) —
  reused here rather than introducing a new dependency, and it keeps the export fully
  client-side and offline-capable (fonts and the logo are same-origin files already cached by
  the service worker; nothing is fetched from a server).
- **Report layout** mirrors that same sibling template: a branded cover header (logo, report
  title, generated timestamp) over a light-green metadata grid, green-accented section
  headings, a green-header data table, and a plain-text footer — using the identical CSS
  variable names and this app's own accent green (`--ca: #2D6B2D`), which turned out to already
  match the sibling template's own `--ca` value exactly.
- **One documented improvement over the sibling template:** the Wildlife app's reports only
  print an in-flow header/footer once (at the top/bottom of the whole flowed document), so
  multi-page reports lose their branding and page numbers past page 1 — its own UI tells users
  to manually disable the browser's print-dialog headers/footers rather than solving this. This
  app instead uses real CSS `@page` margin-box running headers/footers
  (`@top-left`/`@top-right`/`@bottom-left`/`@bottom-right` with `counter(page)`/`counter(pages)`),
  which were empirically verified (via `page.pdf()` + text extraction in this repo's own test
  pass) to render correctly in Chromium's print-to-PDF pipeline — so every physical page gets
  the report title, company name, generation date, and an accurate "Page X of Y", automatically.
- **Report sections**, in order: survey/station metadata (only non-empty fields shown);
  Habitat Characterization (the whole section, and each field within it, is omitted entirely
  when left blank — nothing renders as an empty label); the fish catalogue table (species, life
  stage, length, weight, health notes, capture method) with a follow-up flag banner if any
  record is unidentified.

## Settings

A gear icon in the header (every page — the same always-visible-icon convention used by the
Watercourse Permitting App's own "Metadata" drawer, `jastels-Frax/Watercourse-Permitting-App`)
opens a Settings panel (`js/settings.js`, stored in `localStorage`) with:

- **Survey defaults** — observer(s)/technician name(s), project ID, watershed, water body
  name, licence/permit number, crew size, gear type/effort, survey purpose, and default
  sky/wind — pre-fill the corresponding fields every time a **new** survey is started (an
  existing survey being edited is never touched). Air temperature is intentionally not
  presettable since it's a point-in-time reading, not something that stays constant.
- **Fish record default** — an optional default capture method, pre-selected on every new
  fish record (handy on a single-method day, e.g. electrofishing all day).
- **App preferences** — a Light/Dark/Auto theme override (applied via an inline script in
  each page's `<head>`, before first paint, to avoid a flash of the wrong theme), and an
  opt-in "auto-capture GPS on new survey" toggle (off by default — it triggers the location
  permission prompt immediately instead of waiting for a manual tap).
- **Data** — "Clear saved presets" resets everything on this screen to blank. This only
  touches the presets; logged surveys/fish records are managed from the Export page.

**Project ID** is also a first-class field on the survey record itself (not just a settings
convenience) — it appears on the catalogue form, the CSV export, and the PDF report's
metadata grid, alongside Station ID.

## Species data sources

The species list and diagnostic data were **not** taken from the two angling-guide
reference files originally supplied (an illustrated angler's handbook covering mostly game
species, copyrighted to illustrator Liz Bateman — none of its content or illustrations are
reproduced here). Instead, each of the 27 species entries in `data/species.json` was
independently researched against real, cited sources: FishBase, DFO species profiles and
stock assessment/research documents, GBIF-linked and peer-reviewed literature, ACCDC-context
sources where reachable, and Nova Scotia government publications (NS Invasive Species
Council, NS Fisheries and Aquaculture, NS Department of Natural Resources and Renewables).
Every species entry carries a `citations` array with the real source URL and a note on what
was verified there — check that array before relying on any specific figure.

**Species list scope (v1):** the 24 species explicitly requested (8 game species + 16
small-bodied bycatch/diadromous species) plus 3 additional species added after a source
cross-check found solid evidence they're commonly encountered in NS surveys but were missing
from the original list: **sea lamprey** (ammocoete bycatch is a well-documented NS
electrofishing surprise), **golden shiner** (native, documented in 264 of 744 NS lakes
surveyed), and **pumpkinseed** (documented present in NS, but its native-vs-introduced status
in this province specifically could not be confirmed — see its `dataFlags` entry). This is a
curated core list, not an exhaustive enumeration of every NS freshwater/diadromous fish —
species like white perch, additional lamprey species, or rarer marginal records may exist and
aren't yet included. Treat `data/species.json` as a living document.

**Fields marked `"unknown"`:** several species have `"sRank": "unknown"`. NatureServe/ACCDC
S-rank tables live behind dynamic pages that could not be directly fetched in this research
pass (see Known Limitations below) — `"unknown"` was used deliberately rather than guessing.
Striped bass (`S1`) was the one S-rank corroborated with reasonable confidence.

**Look-alike groups & regions** (`lookalikeGroup`, `regions` fields) are a pragmatic tagging
scheme built for this app's filters, not a formal taxonomic or biogeographic classification —
treat them as a starting point, not an authority.

## Dichotomous key

`data/key.json` is a from-scratch stepwise couplet tree (59 nodes) written by synthesizing the
diagnostic characters in `species.json` — it is not copied from, or structured after, the
uploaded angling guide. It starts with jawless vs. jawed body plan, then adipose fin presence
(splitting out salmonids/smelt/tomcod), then works through the remaining species by mouth
type, fin structure, spine counts, and pattern. Every terminal node includes a `lookalikeCheck`
list of commonly-confused species pairs (e.g. Atlantic salmon vs. brown trout vs. brook trout
parr; alewife vs. blueback herring; blacknose dace vs. common shiner vs. creek chub; ninespine
vs. threespine stickleback) and every couplet screen offers a "not sure — mark unidentified"
escape hatch rather than forcing an ID. See `key-engine.js` for the traversal logic.

## Survey/habitat form terminology sources

The survey metadata and habitat characterization fields in `catalogue.js` were built from a
targeted research pass against real Canadian/NS field protocols, principally:

- **NS Fish Habitat Suitability Assessment: A Field Methods Manual v2.1** (June 2018, NS
  Salmon Association / Adopt-A-Stream) — source of the 5-class substrate scheme
  (fines/gravel/cobble/boulder/bedrock-hardpan), cover-density criteria, and confirmation that
  benthic macroinvertebrates are part of the protocol's intended scope.
- **DFO Guide to Fish Passage for DFO Habitat staff** — source of the barrier-type vocabulary
  (complete / partial / temporal barrier) used in the habitat form instead of a generic
  culvert/dam/falls checklist.
- **BC RISC Fish Collection Methods and Standards v4.0 / Fish Collection Form Field Guide** —
  a directly analogous current provincial Canadian standard, source of the expanded capture
  method list (added fyke net, gillnet, dip net to the requested electrofishing/minnow
  trap/seine/angling set).
- **USGS Illustrated Field Guide for Assessing External and Internal Anomalies in Fish** /
  NAWQA protocols — source of the DELT(P) framework (Deformity, Eroded fin, Lesion, Tumor,
  Parasite) used for the condition-flag chips, since **no NS/DFO-specific official condition
  vocabulary could be found** in this research pass. "Disposition" (released alive / retained /
  mortality) was deliberately split out as a separate field from health/condition flags, since
  it describes fish handling outcome, not an observed biological condition.
- **ECCC CABIN Wadeable Streams Field Manual** — corroboration for wetted/bankfull width
  measurement convention.

Fields explicitly marked in the UI as "(convention)" or "(standard convention, not NS/DFO
verbatim)" — sky/wind categories, channel unit type (pool/riffle/run/glide), embeddedness
rating buckets, canopy cover vs. canopy closure terminology, flow regime wording — are
standard field-survey practice but could **not** be verified against a current NS/DFO document
in this pass. If your organization has a current internal field data sheet, cross-check these
against it and adjust the constants near the top of `js/catalogue.js`.

## Image sourcing

`data/images.json` maps each species/life-stage to either a `"status": "placeholder"` entry
(with a `candidateNote` on where to look) or a `"status": "verified"` entry with a real
`localPath` and `credit` once one's been sourced and approved.

There's now a three-step tool for populating this — see **[`scripts/README.md`](scripts/README.md)**
for full details:

1. `node scripts/fetch-images.js` — searches Wikimedia Commons (Duane Raver/USFWS illustrations
   + general photos), GBIF occurrence media, and iNaturalist by scientific name, filters to
   open licenses only (CC0/CC-BY/CC-BY-SA for Commons; CC0/CC-BY/CC-BY-NC for GBIF/iNaturalist),
   and stages candidates + full attribution metadata under `staging/`. **Requires normal
   internet access** — run it from a terminal that has it, not from a network-restricted
   sandbox.
2. `node scripts/review/server.js` — a local review UI (<http://localhost:5183>) to approve,
   reject, or reassign the life stage of each staged candidate.
3. `node scripts/finalize-images.js` (or the "Finalize Approved" button in the review UI) —
   copies approved images into `images/species/<species-id>/<stage>.<ext>`, updates
   `data/images.json` to `"status": "verified"`, and writes a full attribution manifest
   (`data/image-attribution-manifest.json`/`.csv`) plus a remaining-gaps log
   (`data/image-sourcing-gaps.json`) for whatever still needs manual sourcing.

The service worker (`sw.js`) caches anything under `/images/` automatically on first load — no
code changes are needed after finalizing. Per the original requirement — *"where no
open-licensed image exists for a life stage, leave a placeholder and flag it rather than
substituting a copyrighted image"* — an unconfirmed-life-stage candidate is never silently used
to fill a different stage's slot; it's flagged in the gaps log instead.

## Known limitations / follow-ups

- **Species list**: curated core set (27 species), not exhaustive — see Species data sources
  above.
- **S-ranks**: mostly `"unknown"` — needs a direct ACCDC/NatureServe Explorer data pull from
  an unrestricted network.
- **Images**: tooling to source, review, and finalize images now exists (see above), but it
  hasn't been run yet — `data/images.json` still has every entry as a placeholder until someone
  runs `scripts/fetch-images.js` from a machine with normal internet access and works through
  the review/finalize steps.
- **Survey GPS**: captured as decimal-degree lat/lon via the device Geolocation API per the
  original spec. Several source protocols (the NS Fish Habitat manual, EA registration
  documents) use UTM coordinates instead — this app does not currently convert to/from UTM.
- **Protocol terminology**: several habitat/weather/survey fields are standard convention,
  not verified verbatim against a current internal DFO/NS field sheet — see the survey/habitat
  section above and the inline "(convention)" flags in the catalogue form.
- **Pumpkinseed native status**: flagged as unresolved in `species.json` (`dataFlags`) —
  confirm against ACCDC/DFO before treating it as authoritative.
- Everything is stored per-device in IndexedDB until exported via `export.html` — there is no
  server sync in this version.
