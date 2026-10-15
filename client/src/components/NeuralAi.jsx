// Settings for the neural AI level: the Python environment that runs the policy on the GPU, its model and GPU, and its server's state.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Field, Section, useBusy, useLoad } from "./ui.jsx";
import { usePoll } from "./hooks.js";

const S = {
  title: ["IA neuronal (GPU)", "Neural AI (GPU)"],
  help: ["El nivel «Neuronal» usa una política de aprendizaje por refuerzo entrenada con millones de combates reales (metamon). Juega combates individuales de las generaciones 1-4 y 9 viendo solo lo que ve su lado; en el resto, o si su servidor no está en marcha, juega como la experta. Funciona desde su propio entorno de Python con PyTorch para tu GPU.",
    "The «Neural» level uses a reinforcement-learning policy trained on millions of real battles (metamon). It plays singles of generations 1-4 and 9 seeing only what its side sees; elsewhere, or while its server is not running, it plays as the expert. It runs from its own Python environment with PyTorch for your GPU."],
  python: ["Python del entorno", "Environment's Python"],
  python_help: ["La ruta al python.exe de un entorno con PyTorch y metamon instalados. Vacío: el nivel queda apagado.", "The path to the python.exe of an environment with PyTorch and metamon. Empty: the level is off."],
  model: ["Modelo", "Model"],
  gpu: ["GPU", "GPU"],
  gpu_help: ["Su número en nvidia-smi (0, 1…); vacío = la primera.", "Its number in nvidia-smi (0, 1…); empty = the first."],
  cache: ["Carpeta de los pesos del modelo", "Model weights folder"],
  cache_help: ["Dónde se descargan y se leen los pesos (unos 600 MB). Vacío: data/cache/neural dentro de Silver.", "Where the weights are downloaded and read from (about 600 MB). Empty: data/cache/neural inside Silver."],
  off: ["Apagada: falta el Python del entorno.", "Off: the environment's Python is missing."],
  running: ["En marcha en {device} con {model} · {n} combates en memoria", "Running on {device} with {model} · {n} battles in memory"],
  starting: ["Arrancando (la primera vez descarga el modelo, unos 600 MB)…", "Starting (the first time it downloads the model, about 600 MB)…"],
  stopped: ["Parada: arranca sola cuando empieza un combate con este nivel.", "Stopped: it starts by itself when a battle with this level begins."],
  missing: ["No existe ese Python.", "That Python does not exist."],
  start: ["Arrancar", "Start"],
  stop: ["Parar", "Stop"],
  save_first: ["Guarda los ajustes para usar la ruta nueva.", "Save the settings to use the new path."],
};

export default function NeuralAi({ f, set }) {
  const { lang } = useApp();
  const s = (k, v = {}) => String(S[k][lang === "en" ? 1 : 0]).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? "");
  const st = useLoad(() => api.call("neural_ai", { action: "status" }), []);
  const [busy, run] = useBusy();
  const [poll, setPoll] = useState(false);
  usePoll(async () => {
    const r = await api.call("neural_ai", { action: "status" });
    st.setData(r);
    if (!r.starting) setPoll(false);
  }, 2000, poll);
  const d = st.data;
  const act = (action) => run(action, async () => {
    const r = await api.call("neural_ai", { action });
    st.setData(r);
    setPoll(action === "start");
  });
  const saved = d && (d.python || "") === (f.neural_ai_python || "");
  return (
    <Section title={s("title")}>
      <div className="panel space-y-3">
        <p className="help">{s("help")}</p>
        <Field label={s("python")} hint={s("python_help")}>
          <input className="field" value={f.neural_ai_python || ""} onChange={(e) => set("neural_ai_python", e.target.value)} placeholder="D:\\…\\venv\\Scripts\\python.exe" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={s("model")}><input className="field" value={f.neural_ai_model || ""} onChange={(e) => set("neural_ai_model", e.target.value)} placeholder="Kakuna" /></Field>
          <Field label={s("gpu")} hint={s("gpu_help")}><input className="field" value={f.neural_ai_gpu || ""} onChange={(e) => set("neural_ai_gpu", e.target.value)} placeholder="0" /></Field>
        </div>
        <Field label={s("cache")} hint={s("cache_help")}>
          <input className="field" value={f.neural_ai_cache || ""} onChange={(e) => set("neural_ai_cache", e.target.value)} placeholder={d?.cache || "data\\cache\\neural"} />
        </Field>
        {d && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip ${d.running ? "chip-ok" : d.starting ? "chip-amber" : ""}`}>
              {d.running ? s("running", { device: d.device, model: d.model, n: d.battles || 0 }) : d.starting ? s("starting")
                : !d.enabled ? s("off") : !d.python_found ? s("missing") : s("stopped")}
            </span>
            {d.enabled && d.python_found && !d.running && !d.starting && <Busy busy={busy.start} className="btn btn-sm" onClick={() => act("start")}>{s("start")}</Busy>}
            {(d.running || d.starting) && <Busy busy={busy.stop} className="btn btn-sm" onClick={() => act("stop")}>{s("stop")}</Busy>}
            {!saved && <span className="help">{s("save_first")}</span>}
          </div>
        )}
        {d?.last_lines?.length > 0 && !d.running && <pre className="help scroll-x" style={{ maxHeight: 160 }}>{d.last_lines.join("\n")}</pre>}
        {d?.hint && d.enabled && !d.python_found && <p className="help">{d.hint}</p>}
      </div>
    </Section>
  );
}
