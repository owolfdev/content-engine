"use client";

import { clock, type Script } from "@/lib/script";
import { styleGuide } from "@/lib/style";

const field = "rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900";

export function ScriptEditor({
  script,
  onChange,
}: {
  script: Script;
  onChange: (script: Script) => void;
}) {
  const total = script.beats.reduce((sum, beat) => sum + beat.seconds, 0);

  function setDuration(value: number) {
    const next = Math.min(60, Math.max(8, value));
    const current = script.beats.reduce((sum, beat) => sum + beat.seconds, 0) || 1;
    const scale = next / current;
    onChange({
      ...script,
      duration: next,
      beats: script.beats.map((beat) => ({
        ...beat,
        seconds: Math.max(0.5, Math.round(beat.seconds * scale * 10) / 10),
      })),
    });
  }

  return (
    <article className="flex flex-col gap-6 rounded-md border border-zinc-200 p-4">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-zinc-500">Script</p>
        <h3 className="text-xl font-medium">{script.title || "Untitled cut"}</h3>
        <p className="text-sm text-zinc-500">
          {script.language === "en" ? "English" : "Language not available"} ·{" "}
          {script.source === "pexels" ? "Footage search" : "Palm Shore library"}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Shape
          <select
            className={field}
            value={script.shape}
            onChange={(event) => onChange({ ...script, shape: event.target.value as Script["shape"] })}
          >
            <option value="16:9">Landscape, 16:9</option>
            <option value="1:1">Square, 1:1</option>
            <option value="9:16">Vertical, 9:16</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Length, seconds
          <input
            className={field}
            type="number"
            min={8}
            max={60}
            value={script.duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Music
          <select
            className={field}
            value={script.musicId}
            onChange={(event) => onChange({ ...script, musicId: event.target.value })}
          >
            {styleGuide.music.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="flex flex-col gap-3">
        <h4 className="text-sm font-medium">Graphics</h4>
        <div className="flex items-center gap-3">
          <img src={styleGuide.logo} alt="" className="h-10 w-10" />
          <p className="text-sm" style={{ color: script.accent }}>
            {script.wordmark || "Wordmark"}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Wordmark
            <input
              className={field}
              value={script.wordmark}
              onChange={(event) => onChange({ ...script, wordmark: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Title
            <input
              className={field}
              value={script.title}
              onChange={(event) => onChange({ ...script, title: event.target.value })}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            Accent
            <input
              type="color"
              value={script.accent}
              aria-label="Accent colour"
              onChange={(event) => onChange({ ...script, accent: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            Title colour
            <input
              type="color"
              value={script.titleColor}
              aria-label="Title colour"
              onChange={(event) => onChange({ ...script, titleColor: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            Background
            <input
              type="color"
              value={script.background}
              aria-label="Background colour"
              onChange={(event) => onChange({ ...script, background: event.target.value })}
            />
          </label>
        </div>
      </section>

      <label className="flex flex-col gap-1 text-sm">
        Voiceover
        <textarea
          className={`${field} min-h-20`}
          value={script.spokenLine}
          onChange={(event) => onChange({ ...script, spokenLine: event.target.value })}
        />
      </label>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-sm font-medium">Timeline</h4>
          <p className="text-sm text-zinc-500">{total.toFixed(1)} seconds across the beats</p>
        </div>
        <ol className="flex flex-col gap-3">
          {script.beats.map((beat, index) => {
            const span = clock(script.beats, index);
            return (
              <li key={beat.id} className="grid gap-2 rounded border border-zinc-200 p-3 sm:grid-cols-[7rem_1fr]">
                <p className="text-sm text-zinc-500">
                  {span.start.toFixed(1)}–{span.end.toFixed(1)}s
                </p>
                <div className="flex flex-col gap-2">
                  <div className="grid gap-2 sm:grid-cols-[8rem_6rem_1fr]">
                    <input
                      className={field}
                      aria-label={`Beat ${index + 1} label`}
                      value={beat.label}
                      onChange={(event) =>
                        onChange({
                          ...script,
                          beats: script.beats.map((item) =>
                            item.id === beat.id ? { ...item, label: event.target.value } : item,
                          ),
                        })
                      }
                    />
                    <input
                      className={field}
                      type="number"
                      min={0.5}
                      step={0.1}
                      aria-label={`Beat ${index + 1} seconds`}
                      value={beat.seconds}
                      onChange={(event) => {
                        const seconds = Math.max(0.5, Number(event.target.value) || 0.5);
                        const beats = script.beats.map((item) => (item.id === beat.id ? { ...item, seconds } : item));
                        onChange({
                          ...script,
                          beats,
                          duration: Math.round(beats.reduce((sum, item) => sum + item.seconds, 0) * 10) / 10,
                        });
                      }}
                    />
                    <input
                      className={field}
                      aria-label={`Beat ${index + 1} picture`}
                      value={beat.picture}
                      onChange={(event) =>
                        onChange({
                          ...script,
                          beats: script.beats.map((item) =>
                            item.id === beat.id ? { ...item, picture: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </div>
                  {script.beats.length > 1 ? (
                    <button
                      type="button"
                      className="w-fit text-sm text-zinc-500"
                      onClick={() => {
                        const beats = script.beats.filter((item) => item.id !== beat.id);
                        onChange({
                          ...script,
                          beats,
                          duration: Math.round(beats.reduce((sum, item) => sum + item.seconds, 0) * 10) / 10,
                        });
                      }}
                    >
                      Remove beat
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className="w-fit rounded border border-zinc-300 px-3 py-2 text-sm"
          onClick={() => {
            const beats = [
              ...script.beats,
              {
                id: `beat-${Date.now()}`,
                label: "Beat",
                picture: script.beats[script.beats.length - 1]?.picture ?? "",
                seconds: 4,
              },
            ];
            onChange({
              ...script,
              beats,
              duration: Math.round(beats.reduce((sum, item) => sum + item.seconds, 0) * 10) / 10,
            });
          }}
        >
          Add a beat
        </button>
      </section>

      <label className="flex flex-col gap-1 text-sm">
        Notes
        <textarea
          className={`${field} min-h-24`}
          value={script.notes}
          onChange={(event) => onChange({ ...script, notes: event.target.value })}
        />
      </label>
    </article>
  );
}
