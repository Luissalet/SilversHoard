import { installPortableAssets } from "../portable-assets.js";

export async function loadWebArt() {
  const art = new URL("../art/index.json", location.href);
  try {
    const response = await fetch(art);
    if (!response.ok) throw new Error("art");
    const data = await response.json();
    for (const [key, path] of Object.entries(data.files)) {
      const url = new URL(path, art).href;
      data.files[key] = url;
      data.urls[url] = key;
    }
    installPortableAssets(data);
    return true;
  } catch {
    installPortableAssets({ version: 1, files: {}, urls: {} });
    return false;
  }
}
