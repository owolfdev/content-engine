"use client";

import { useState } from "react";
import { CutPreview } from "@/app/cut-preview";
import { LocalRender } from "@/app/local-render";
import { ScriptEditor } from "@/app/script-editor";
import { Storyboard } from "@/app/storyboard";
import type { Plan } from "@/lib/plan";
import { draftScript, type Script } from "@/lib/script";
import type { FootageSource } from "@/lib/plan";

const example = "a 20-second sunrise beach offer, vertical, in English";

export function PlanRequest({
  titleFont,
  bodyFont,
}: {
  titleFont: string;
  bodyFont: string;
}) {
  const [request, setRequest] = useState(example);
  const [source, setSource] = useState<FootageSource>("pexels");
  const [script, setScript] = useState<Script | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function createPlan() {
    setMessage(null);
    setPlan(null);
    setScript(draftScript(request, source));
  }

  async function buildPreview() {
    if (!script) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(script),
      });
      const data = (await response.json()) as Plan & { error?: string };
      if (!response.ok) {
        setPlan(null);
        setMessage(data.error ?? "The preview could not be built.");
        return;
      }
      setPlan(data);
    } catch {
      setMessage("The preview could not be built.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pt-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">Storyboard</p>
        <h2 className="text-2xl font-medium">Request a cut</h2>
      </header>
      <label className="flex max-w-xs flex-col gap-2 text-sm">
        Footage
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-2"
          value={source}
          onChange={(event) => setSource(event.target.value as FootageSource)}
        >
          <option value="pexels">Pexels search, for demos</option>
          <option value="library">Palm Shore library</option>
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm">
        Request
        <textarea
          className="min-h-24 rounded border border-zinc-300 px-3 py-2"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="w-fit rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
        disabled={request.trim().length === 0}
        onClick={createPlan}
      >
        {source === "pexels" ? "Create storyboard" : "Create plan"}
      </button>

      {script?.source === "pexels" ? (
        <Storyboard
          script={script}
          onChange={(update) => setScript((current) => (current ? update(current) : current))}
          onAssemble={(next) => {
            setMessage(null);
            setPlan(next);
          }}
        />
      ) : null}

      {script && script.source !== "pexels" ? (
        <>
          <ScriptEditor script={script} onChange={setScript} />
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-500">2. Preview</p>
            <button
              type="button"
              className="w-fit rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={buildPreview}
            >
              {busy ? "Building the preview…" : "Plan is done — build preview"}
            </button>
          </div>
        </>
      ) : null}

      {message ? <p className="text-sm text-red-700">{message}</p> : null}

      {plan ? (
        <div className="flex flex-col gap-3 text-sm">
          {plan.source === "pexels" ? <h3 className="text-xl font-medium">Assembled preview</h3> : null}
          {plan.clips.length ? (
            <ol className="flex flex-col gap-2">
              {plan.clips.map((clip, index) => (
                <li key={`${clip.id}-${index}`} className="rounded border border-zinc-200 px-3 py-2">
                  <p className="font-medium">
                    {index + 1}. {plan.source === "pexels" ? clip.author ?? clip.title : clip.title}
                  </p>
                  <p className="text-zinc-500">
                    {plan.source === "library" ? `${clip.role}, ${clip.viewpoint} · ` : ""}
                    {clip.end.toFixed(1)}s
                    {plan.source === "pexels" ? ` · ${clip.title}` : ""}
                    {plan.source === "library" && clip.tags.length ? ` · ${clip.tags.join(", ")}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p>No clips found for this script.</p>
          )}
          <ul className="flex flex-col gap-1 text-zinc-500">
            {plan.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {plan.clips.length ? <CutPreview plan={plan} titleFont={titleFont} bodyFont={bodyFont} /> : null}
          {plan.clips.length ? <LocalRender plan={plan} /> : null}
        </div>
      ) : null}
    </section>
  );
}
