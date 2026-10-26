// Standalone pages carry the installed PMD library and cached presentation files. App/live rooms keep their routes.
let bundle = null;
let chunkReader = null;
const chunks = new Map(), objectUrls = new Map();
export const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function installPortableAssets(value, { readChunk = null } = {}) {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  chunks.clear(); objectUrls.clear();
  bundle = value; chunkReader = readChunk;
}

function fileUrl(key) {
  const file = bundle?.files?.[key];
  if (typeof file === "string") return file;
  if (!file || !chunkReader) return "";
  if (!objectUrls.has(key)) {
    if (!chunks.has(file.pmd)) {
      const raw = atob(chunkReader(file.pmd) || ""), bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      chunks.set(file.pmd, new Blob([bytes], {type:'application/octet-stream'}));
    }
    objectUrls.set(key, URL.createObjectURL(chunks.get(file.pmd).slice(file.offset, file.offset + file.size, file.mime)));
  }
  return objectUrls.get(key);
}

// undefined means the app owns the route; null means a standalone page has no matching sheet.
export function portablePmd(num, { form = "", shiny = false } = {}) {
  if (bundle === null) return undefined;
  const pmd = bundle.pmd;
  const dex = String(num).padStart(4, "0");
  const formId = String(form).toLowerCase().replace(/[^a-z0-9]/g, "");
  const prepared = pmd?.entries?.[`${num}|${formId}|${shiny ? 1 : 0}`];
  if (prepared && pmd.metas?.[prepared]) return {...pmd.metas[prepared], form_exact:true};
  const sub = pmd?.forms?.[String(num)]?.[formId] || "0000";
  for (const folder of [...new Set([sub, "0000"])]) {
    const key = dex + (folder !== "0000" || shiny ? `-${folder}` : "") + (shiny ? "-0001" : "");
    const meta = pmd?.metas?.[key] || pmd?.metas?.[`${key}-recolor1`];
    if (meta) return meta;
  }
  return null;
}

export function portablePmdPreview(species, {back = false, shiny = false} = {}) {
  const id = String(species).toLowerCase().replace(/[^a-z0-9]/g, "");
  const mon = bundle?.pmd?.species?.[id];
  const meta = mon && portablePmd(mon.num,{form:mon.form,shiny});
  const name = back ? "PreviewBack" : "PreviewFront";
  return meta?.previews?.[name] ? fileUrl(meta.previews[name]) : "";
}

/** An exact form/colour portrait; undefined retains the app's existing route. */
export function portablePortrait(species, emotion = 'Normal', {shiny = false} = {}) {
  if (bundle === null) return undefined;
  const id = String(species).toLowerCase().replace(/[^a-z0-9]/g, '');
  const entry = bundle.portraits?.entries?.[`${id}|${shiny ? 1 : 0}`];
  const choices = [emotion, ...(bundle.portraits?.fallbacks?.[emotion] || []), 'Normal'];
  const file = choices.map(e => entry?.[e]).find(Boolean);
  return file ? fileUrl(file) : '';
}

function placeholder(label) {
  const letters = String(label || "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="35" fill="#30272a" stroke="#b49b81" stroke-width="3"/><text x="48" y="58" text-anchor="middle" fill="#f0e6d8" font-family="sans-serif" font-size="28" font-weight="bold">${letters}</text></svg>`);
}

/** Resolve before assigning an image/audio/fetch URL: a missing file never starts a remote request. */
export function portableAsset(url, { fallback = "", label = "", missing = EMPTY_IMAGE } = {}) {
  if (bundle === null || (!url && !fallback) || /^(data:|blob:)/.test(url)) return url;
  for (const candidate of [url, fallback]) {
    if (/^(data:|blob:)/.test(candidate)) return candidate;
    const file = bundle.urls?.[candidate];
    const resolved = file && fileUrl(file);
    if (resolved) return resolved;
  }
  return label ? placeholder(label) : missing;
}
