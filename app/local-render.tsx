"use client";

import { useEffect, useRef, useState } from "react";
import type { Plan } from "@/lib/plan";
import { videoFileName } from "@/lib/style";

type RenderProgress = {
  running: boolean;
  progress: number;
  label: string;
  detail: string;
};

export function LocalRender({ plan }: { plan: Plan }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const fileRef = useRef<Blob | null>(null);
  const signature = plan.clips.map((clip) => `${clip.id}:${clip.start}:${clip.end}`).join("|");

  useEffect(() => {
    fileRef.current = null;
    setMessage(null);
  }, [signature]);

  useEffect(() => {
    if (!busy) {
      setProgress(null);
      return;
    }
    let active = true;
    const tick = async () => {
      try {
        const response = await fetch("/api/render", { cache: "no-store" });
        if (!active || !response.ok) return;
        const data = (await response.json()) as RenderProgress;
        if (data.running && data.label) setProgress(data);
      } catch {
        // Keep the last reading if one poll fails.
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 400);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [busy]);

  const fileName = videoFileName(plan.graphics?.wordmark ?? "");

  function saveBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function renderFile() {
    if (fileRef.current) {
      saveBlob(fileRef.current);
      setMessage(`Downloaded ${fileName}.`);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });
      if (!response.ok) {
        const raw = await response.text();
        let error = "The video could not be made.";
        try {
          const data = JSON.parse(raw) as { error?: string };
          if (data.error) error = data.error;
        } catch {
          if (raw && !raw.trim().startsWith("<")) error = raw.slice(0, 400);
        }
        setMessage(error);
        return;
      }
      const blob = await response.blob();
      fileRef.current = blob;
      saveBlob(blob);
      const voice = response.headers.get("x-render-voice");
      setMessage(voice === "saved-take" ? `Downloaded ${fileName}, with the saved voice take.` : `Downloaded ${fileName}.`);
    } catch {
      setMessage("The video could not be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="w-fit rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
        disabled={busy || plan.clips.length === 0}
        onClick={() => void renderFile()}
      >
        {busy ? "Making the video…" : "Download video"}
      </button>
      {busy ? <RenderBar progress={progress} /> : null}
      {message ? <p className="text-sm text-zinc-700">{message}</p> : null}
    </div>
  );
}

function RenderBar({ progress }: { progress: RenderProgress | null }) {
  const shown = progress ?? { running: true, progress: 0.02, label: "Starting", detail: "0:00 elapsed" };
  const percent = Math.max(0, Math.min(100, Math.round(shown.progress * 100)));
  const status = `${shown.label} · ${percent}%${shown.detail ? ` · ${shown.detail}` : ""}`;
  return (
    <div className="flex w-full max-w-md flex-col gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={status}>
      <div className="h-1.5 overflow-hidden rounded bg-zinc-200">
        <div className="h-full bg-zinc-800 transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm text-zinc-500">{status}</p>
    </div>
  );
}
