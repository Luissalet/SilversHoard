import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../hoard-theme.css";
import "../index.css";
import "../play/play.css";
import "../arcade.css";
import "./friends.css";
import emblem from "../../public/icon-192.png?url";
import { friendsText, initialWebLang } from "./strings.js";

function Home() {
  const [lang, setLang] = useState(initialWebLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const t = (key) => friendsText(lang, key);
  return <main className="p-wrap friends friends-lobby silver-web-home">
    <header className="friends-head">
      <div className="silver-web-brand">
        <img src={emblem} width="64" height="64" alt="" />
        <h1>Silver's Hoard</h1>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setLang(lang === "es" ? "en" : "es")}>
        {lang === "es" ? "English" : "Español"}
      </button>
    </header>
    <nav className="silver-web-menu" aria-label={t("playMenu")}>
      <a className="panel silver-web-option" href={`./combate/?lang=${lang}`}>
        <strong>{t("practice")}</strong><span>{t("practiceHelp")}</span>
      </a>
      <a className="panel silver-web-option" href={`./amigos/?lang=${lang}`}>
        <strong>{t("title")}</strong><span>{t("friendsHelp")}</span>
      </a>
    </nav>
    <footer className="silver-web-footer">
      <a className="help" href="https://github.com/Luissalet/SilversHoard">{t("desktop")}</a>
      <a className="help" href="./art/CREDITS.md">{t("credits")}</a>
    </footer>
  </main>;
}

if (location.hash.startsWith("#SILVERDUEL1-")) {
  const next = new URL("./amigos/", location.href);
  next.search = location.search;
  next.hash = location.hash;
  location.replace(next);
} else {
  createRoot(document.getElementById("root")).render(<Home />);
}
