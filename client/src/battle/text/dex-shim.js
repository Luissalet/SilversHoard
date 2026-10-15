// The little of the battle client's Dex that its text parser (text-parser.gen.js) asks for: the language, the newest generation, an
// id function and species names (the log keeps the names the battle protocol gives).
export const toID = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export const Dex = {
  gen: 9,
  text: {
    language: "en",
    getLanguage() { return this.language; },
    get(entry) { return { name: entry && entry.name ? entry.name : "" }; },
  },
  species: { get: (name) => ({ name: String(name || "").trim() }) },
  loadTextData() {},
};
