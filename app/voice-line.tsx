"use client";

import { useEffect, useState } from "react";

export function VoiceLine() {
  const [text, setText] = useState("The shore, in the evening light.");
  const [message, setMessage] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function speak() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const remain = response.headers.get("x-voice-chars-left");
      if (remain !== null && remain !== "") setLeft(Number(remain));
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessage(data?.error ?? "Voice failed.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
    } catch {
      setMessage("Voice failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">Voice</p>
        <h2 className="text-2xl font-medium">Speak a line</h2>
      </header>
      <label className="flex flex-col gap-2 text-sm">
        Line
        <textarea
          className="min-h-24 rounded border border-zinc-300 px-3 py-2"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
          disabled={busy || text.trim().length === 0}
          onClick={speak}
        >
          {busy ? "Speaking…" : "Speak"}
        </button>
        <p className="text-sm text-zinc-500">
          {text.trim().length} characters
          {left === null ? "" : ` · ${left} left in this browser`}
        </p>
      </div>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      {audioUrl ? <audio controls src={audioUrl} className="w-full" /> : null}
    </section>
  );
}
