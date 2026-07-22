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
export.html         CSV/JSON export + clear-device view
manifest.json, sw.js, icons/   PWA shell + offline caching
css/styles.css      Shared high-contrast, one-handed mobile styling
js/                 db.js (IndexedDB), app.js (shared utils), species-list.js, key-engine.js,
                    identify-modal.js (in-context Identify overlay used from the catalogue form),
                    catalogue.js, export.js, species-page.js, key-page.js
data/species.json   Species reference data + citations (this file, see below)
data/key.json        Dichotomous key tree
data/images.json     Reference image manifest (see Image Sourcing — currently all placeholders)
```

The **Identify** button on the catalogue fish-entry form opens `identify-modal.js`, which
renders the same species list / key components used by the standalone pages as an overlay
`<div>` on top of the in-progress form — it never navigates away, so length/weight/notes
already entered are untouched. Confirming a species (or backing out via the uncertain path)
closes the modal and returns control to the form.

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

## Image sourcing — currently unfetched placeholders

`data/images.json` marks every species/life-stage entry as `"status": "placeholder"` with a
`candidateNote` suggesting where to look (Wikimedia Commons / GBIF media, filtered to
CC0/CC-BY/CC-BY-SA/public-domain licenses, searched by scientific name).

**No image files were actually sourced or downloaded in this build pass.** This build
environment's outbound network policy blocks HTTPS connections to essentially all external
hosts at the TLS CONNECT level (confirmed 403 responses for Wikimedia, FishBase, DFO, and
Wikipedia domains) — the research agents could retrieve *text* via the search tool (which
runs server-side, outside this sandbox), but neither `curl` nor the direct fetch tool could
retrieve *file bytes* from within this environment. Rather than guess at a license or hotlink
an unverified image, every entry was left as an honest, flagged placeholder per the original
requirement: *"Where no open-licensed image exists for a life stage, leave a placeholder and
flag it rather than substituting a copyrighted image."*

**To complete this:** from an environment with normal network access, for each species in
`data/species.json`:
1. Search Wikimedia Commons (or GBIF media records) for the scientific name.
2. Confirm the license is CC0, CC-BY, CC-BY-SA, or public domain — record the exact license,
   author/photographer, and source URL.
3. Download the image to `images/species/<species-id>/<stage>.jpg` (or `.png`).
4. Update the corresponding entry in `data/images.json` to
   `{"status": "verified", "localPath": "./images/species/<id>/<stage>.jpg", "credit": "<photographer/license/source>"}`.
5. The service worker (`sw.js`) will cache anything under `/images/` automatically on first
   load — no other code changes are needed.

## Known limitations / follow-ups

- **Species list**: curated core set (27 species), not exhaustive — see Species data sources
  above.
- **S-ranks**: mostly `"unknown"` — needs a direct ACCDC/NatureServe Explorer data pull from
  an unrestricted network.
- **Images**: no images sourced yet (network-restricted build environment) — see above.
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
