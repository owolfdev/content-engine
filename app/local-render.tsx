"use client";

import { useState } from "react";
import type { Plan } from "@/lib/plan";

export function LocalRender({ plan }: { plan: Plan }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function renderFile() {
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
        let error = "The file could not be rendered.";
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
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "palm-shore.mp4";
      link.click();
      URL.revokeObjectURL(url);
      const voice = response.headers.get("x-render-voice");
      setMessage(
        voice === "saved-take"
          ? "Saved palm-shore.mp4 on this computer, with the saved voice take."
          : "Saved palm-shore.mp4 on this computer. Preview the voice line first if the file should speak.",
      );
    } catch {
      setMessage("The file could not be rendered.");
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
        {busy ? "Rendering on this computer…" : "Render MP4 (this computer only)"}
      </button>
      <p className="text-sm text-zinc-500">
        This render runs on the local server. Once the app is deployed, this button will not work. A deployed site needs a different way to make the file.
      </p>
      {message ? <p className="text-sm text-zinc-700">{message}</p> : null}
    </div>
  );
}
