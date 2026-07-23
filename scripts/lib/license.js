// License normalization + per-source allow-lists.
// Every source reports licenses in a different shape (Commons: human-readable
// short names; GBIF: a URL or an enum-like code; iNaturalist: a short code).
// normalizeLicense() maps all of them to one small vocabulary so the rest of
// the pipeline only has to reason about a handful of codes.

const CODES = {
  CC0: 'cc0',
  PD: 'public-domain',
  BY: 'cc-by',
  BY_SA: 'cc-by-sa',
  BY_NC: 'cc-by-nc',
  BY_ND: 'cc-by-nd',
  BY_NC_SA: 'cc-by-nc-sa',
  BY_NC_ND: 'cc-by-nc-nd',
  OTHER: 'other',
  UNKNOWN: 'unknown',
};

// Per-source allow-lists, per the task spec:
// - Commons: public domain / CC0 / CC-BY / CC-BY-SA
// - GBIF: CC0 / CC-BY / CC-BY-NC only (explicitly excludes SA)
// - iNaturalist: treated the same as GBIF for consistency, since GBIF's fish
//   media is largely re-published iNaturalist content anyway — see scripts/README.md.
const ALLOWLISTS = {
  'wikimedia-commons': [CODES.CC0, CODES.PD, CODES.BY, CODES.BY_SA],
  gbif: [CODES.CC0, CODES.BY, CODES.BY_NC],
  inaturalist: [CODES.CC0, CODES.BY, CODES.BY_NC],
};

/**
 * @param {string} raw - the raw license string/URL from the source API
 * @returns {{code: string, label: string}}
 */
function normalizeLicense(raw) {
  if (!raw) return { code: CODES.UNKNOWN, label: '(no license field)' };
  const s = String(raw).trim();
  const lower = s.toLowerCase();

  // GBIF sometimes gives a full CC legalcode/deed URL.
  if (lower.includes('creativecommons.org') || lower.includes('/publicdomain/')) {
    if (lower.includes('/zero/')) return { code: CODES.CC0, label: 'CC0 1.0' };
    if (lower.includes('/publicdomain/mark')) return { code: CODES.PD, label: 'Public Domain Mark' };
    const version = (lower.match(/\/(\d(?:\.\d)?)\//) || [])[1] || '';
    if (/\/by-nc-sa\//.test(lower)) return { code: CODES.BY_NC_SA, label: `CC BY-NC-SA ${version}`.trim() };
    if (/\/by-nc-nd\//.test(lower)) return { code: CODES.BY_NC_ND, label: `CC BY-NC-ND ${version}`.trim() };
    if (/\/by-nc\//.test(lower)) return { code: CODES.BY_NC, label: `CC BY-NC ${version}`.trim() };
    if (/\/by-sa\//.test(lower)) return { code: CODES.BY_SA, label: `CC BY-SA ${version}`.trim() };
    if (/\/by-nd\//.test(lower)) return { code: CODES.BY_ND, label: `CC BY-ND ${version}`.trim() };
    if (/\/by\//.test(lower)) return { code: CODES.BY, label: `CC BY ${version}`.trim() };
    return { code: CODES.OTHER, label: s };
  }

  // GBIF enum-like strings, e.g. "CC0_1_0", "CC_BY_4_0", "CC_BY_NC_4_0", "UNSPECIFIED".
  // Guard: only treat this as GBIF's native underscore-delimited enum format
  // if the raw string already contains an underscore (e.g. "CC_BY_SA_4_0").
  // Without this guard, hyphenated forms like "CC BY-SA 4.0" (Commons) become
  // "cc_by-sa_4.0" after the whitespace->underscore replace, and the loose
  // "^cc_by" prefix check below would wrongly match "cc-by" instead of falling
  // through to the correct hyphen-aware checks further down.
  const enumMatch = lower.replace(/\s+/g, '_');
  if (lower.includes('_')) {
    if (/^cc0/.test(enumMatch)) return { code: CODES.CC0, label: 'CC0 1.0' };
    if (/^cc_by_nc_sa/.test(enumMatch)) return { code: CODES.BY_NC_SA, label: 'CC BY-NC-SA' };
    if (/^cc_by_nc_nd/.test(enumMatch)) return { code: CODES.BY_NC_ND, label: 'CC BY-NC-ND' };
    if (/^cc_by_nc/.test(enumMatch)) return { code: CODES.BY_NC, label: 'CC BY-NC' };
    if (/^cc_by_sa/.test(enumMatch)) return { code: CODES.BY_SA, label: 'CC BY-SA' };
    if (/^cc_by_nd/.test(enumMatch)) return { code: CODES.BY_ND, label: 'CC BY-ND' };
    if (/^cc_by/.test(enumMatch)) return { code: CODES.BY, label: 'CC BY' };
  }
  if (enumMatch === 'unspecified' || enumMatch === 'unsupported' || enumMatch === 'all_rights_reserved') {
    return { code: CODES.UNKNOWN, label: s };
  }

  // iNaturalist short codes, e.g. "cc-by-nc", "cc0".
  if (/^cc-by-nc-sa$/.test(lower)) return { code: CODES.BY_NC_SA, label: 'CC BY-NC-SA' };
  if (/^cc-by-nc-nd$/.test(lower)) return { code: CODES.BY_NC_ND, label: 'CC BY-NC-ND' };
  if (/^cc-by-nc$/.test(lower)) return { code: CODES.BY_NC, label: 'CC BY-NC' };
  if (/^cc-by-sa$/.test(lower)) return { code: CODES.BY_SA, label: 'CC BY-SA' };
  if (/^cc-by-nd$/.test(lower)) return { code: CODES.BY_ND, label: 'CC BY-ND' };
  if (/^cc-by$/.test(lower)) return { code: CODES.BY, label: 'CC BY' };
  if (lower === 'cc0') return { code: CODES.CC0, label: 'CC0' };

  // Wikimedia Commons human-readable short names, e.g. "CC BY-SA 4.0", "Public domain".
  if (/public domain|^pd[\s-]/.test(lower)) return { code: CODES.PD, label: s };
  if (/cc by-nc-sa/.test(lower)) return { code: CODES.BY_NC_SA, label: s };
  if (/cc by-nc-nd/.test(lower)) return { code: CODES.BY_NC_ND, label: s };
  if (/cc by-nc/.test(lower)) return { code: CODES.BY_NC, label: s };
  if (/cc by-sa/.test(lower)) return { code: CODES.BY_SA, label: s };
  if (/cc by-nd/.test(lower)) return { code: CODES.BY_ND, label: s };
  if (/cc by/.test(lower)) return { code: CODES.BY, label: s };
  if (/cc0/.test(lower)) return { code: CODES.CC0, label: s };

  return { code: CODES.OTHER, label: s };
}

/**
 * @param {string} source - 'wikimedia-commons' | 'gbif' | 'inaturalist'
 * @param {string} licenseCode - normalized code from normalizeLicense()
 */
function isLicenseAllowed(source, licenseCode) {
  const allowlist = ALLOWLISTS[source];
  if (!allowlist) throw new Error(`Unknown source for license check: ${source}`);
  return allowlist.includes(licenseCode);
}

module.exports = { normalizeLicense, isLicenseAllowed, LICENSE_CODES: CODES, ALLOWLISTS };
