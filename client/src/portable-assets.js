// A standalone page carries its cached presentation files. The regular app and live rooms keep their own routes.
let bundle = null;
export const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function installPortableAssets(value) { bundle = value; }

// undefined means the app owns the route; null means a standalone page has no matching sheet.
export function portablePmd(num, { form = "", shiny = false } = {}) {
  if (bundle === null) return undefined;
  const pmd = bundle.pmd;
  const dex = String(num).padStart(4, "0");
  const formId = String(form).toLowerCase().replace(/[^a-z0-9]/g, "");
  const sub = pmd?.forms?.[String(num)]?.[formId] || "0000";
  for (const folder of [...new Set([sub, "0000"])]) {
    const key = dex + (folder !== "0000" || shiny ? `-${folder}` : "") + (shiny ? "-0001" : "");
    const meta = pmd?.metas?.[key] || pmd?.metas?.[`${key}-recolor1`];
    if (meta) return meta;
  }
  return null;
}

function placeholder(label) {
  const letters = String(label || "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="35" fill="#30272a" stroke="#b49b81" stroke-width="3"/><text x="48" y="58" text-anchor="middle" fill="#f0e6d8" font-family="sans-serif" font-size="28" font-weight="bold">${letters}</text></svg>`);
}

/** Resolve before assigning an image/audio/fetch URL: a missing file never starts a remote request. */
export function portableAsset(url, { fallback = "", label = "", missing = EMPTY_IMAGE } = {}) {
  if (bundle === null || !url || /^(data:|blob:)/.test(url)) return url;
  for (const candidate of [url, fallback]) {
    const file = bundle.urls?.[candidate];
    if (file && bundle.files?.[file]) return bundle.files[file];
  }
  return label ? placeholder(label) : missing;
}
