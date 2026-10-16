// The Pokéathlon page. The events, the canvas runtime and the course rules load only when the page is opened.
import React, { Suspense, lazy } from "react";
import { Spinner } from "../components/ui.jsx";

const Hub = lazy(() => import("../pokeathlon/Hub.jsx"));

export default function Pokeathlon(props) {
  return (
    <Suspense fallback={<div className="flex items-center gap-2"><Spinner /></div>}>
      <Hub {...props} />
    </Suspense>
  );
}
