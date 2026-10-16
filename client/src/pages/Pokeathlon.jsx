// The Pokéathlon page. The events, the canvas runtime and the course rules load only when the page is opened.
import React, { Suspense } from "react";
import { Spinner } from "../components/ui.jsx";
import { lazyChunk } from "../lazy.js";

const Hub = lazyChunk(() => import("../pokeathlon/Hub.jsx"));

export default function Pokeathlon(props) {
  return (
    <Suspense fallback={<div className="flex items-center gap-2"><Spinner /></div>}>
      <Hub {...props} />
    </Suspense>
  );
}
