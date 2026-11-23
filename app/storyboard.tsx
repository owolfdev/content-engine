"use client";

import { useEffect, useRef, useState } from "react";
import { assembleStoryboard, type ChosenShot, type Script } from "@/lib/script";
import type { Plan } from "@/lib/plan";
import { loadVoice, savedVoice } from "@/app/voice-memory";

type ShotResult = {
  id: string;
  file: string;
  author?: string;
  sourcePage?: string;
  index: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

const field = "rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900";

function frameClass(shape: Script["shape"]) {
  if (shape === "9:16") return "aspect-[9/16] w-56";
  if (shape === "1:1") return "aspect-square w-80";
  return "aspect-video w-full max-w-xl";
}

function Shot({
  beatId,
  picture,
  seconds,
  shape,
  canRemove,
  onPicture,
  onSeconds,
  onRemove,
  onStatus,
}: {
  beatId: string;
  picture: string;
  seconds: number;
  shape: Script["shape"];
  canRemove: boolean;
  onPicture: (value: string) => void;
  onSeconds: (value: number) => void;
  onRemove: () => void;
  onStatus: (beatId: string, shot: ShotResult | null, busy: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [shot, setShot] = useState<ShotResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(() => picture.trim().length > 0);
  const ticket = useRef(0);
  const status = useRef(onStatus);
  status.current = onStatus;

  useEffect(() => {
    status.current(beatId, shot, busy);
  }, [beatId, shot, busy]);

  useEffect(() => {
    const phrase = picture.trim();
    const current = ++ticket.current;
    if (!phrase) {
      setShot(null);
      setMessage(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      setMessage(null);
      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phrase, shape, index }),
        });
        const data = (await response.json()) as ShotResult & { error?: string };
        if (ticket.current !== current) return;
        if (!response.ok) {
          setShot(null);
          setMessage(data.error ?? "No result for this phrase.");
          return;
        }
        setShot(data);
      } catch {
        if (ticket.current !== current) return;
        setShot(null);
        setMessage("The search could not be run.");
      } finally {
        if (ticket.current === current) setBusy(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [picture, shape, index]);

  const frame = frameClass(shape);

  return (
    <li className="flex flex-col gap-2">
      {shot ? (
        <video
          key={shot.file}
          className={`${frame} bg-black object-cover`}
          src={shot.file}
          controls
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <div className={`${frame} grid place-items-center bg-zinc-100 px-3 text-center text-sm text-zinc-500`}>
          {busy ? "Searching…" : message ?? "Add a search phrase."}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40"
          disabled={busy || index === 0}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
        >
          Previous
        </button>
        <button
          type="button"
          className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40"
          disabled={busy || !shot?.hasNext}
          onClick={() => setIndex((value) => value + 1)}
        >
          Next
        </button>
        <p className="text-zinc-500">
          {busy ? "Searching…" : shot ? `Result ${shot.index + 1}${shot.author ? ` · ${shot.author}` : ""}` : message}
        </p>
      </div>
      <div className="flex gap-2">
        <input
          className={`${field} min-w-0 flex-1`}
          aria-label="Search phrase"
          placeholder="Search phrase"
          value={picture}
          onChange={(event) => {
            setIndex(0);
            onPicture(event.target.value);
          }}
        />
        <input
          className={`${field} w-24`}
          type="number"
          min={0.5}
          step={0.1}
          aria-label="Duration, seconds"
          value={seconds}
          onChange={(event) => onSeconds(Math.max(0.5, Number(event.target.value) || 0.5))}
        />
      </div>
      {canRemove ? (
        <button type="button" className="w-fit text-sm text-zinc-500" onClick={onRemove}>
          Remove shot
        </button>
      ) : null}
    </li>
  );
}

export function Storyboard({
  script,
  onChange,
  onAssemble,
}: {
  script: Script;
  onChange: (update: (script: Script) => Script) => void;
  onAssemble: (plan: Plan) => void;
}) {
  const [selections, setSelections] = useState<Record<string, { shot: ShotResult | null; busy: boolean }>>({});

  function onStatus(beatId: string, shot: ShotResult | null, busy: boolean) {
    setSelections((current) => {
      const previous = current[beatId];
      if (
        previous &&
        previous.busy === busy &&
        previous.shot?.id === shot?.id &&
        previous.shot?.index === shot?.index &&
        previous.shot?.file === shot?.file
      ) {
        return current;
      }
      return { ...current, [beatId]: { shot, busy } };
    });
  }

  const searching = script.beats.some((beat) => selections[beat.id]?.busy);
  const ready = script.beats.some((beat) => selections[beat.id]?.shot);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTick, setVoiceTick] = useState(0);
  const voiceAudio = useRef<HTMLAudioElement>(null);
  const playWhenReady = useRef(false);
  const recording = savedVoice(script.spokenLine);

  useEffect(() => {
    if (!playWhenReady.current || !recording) return;
    playWhenReady.current = false;
    const audio = voiceAudio.current;
    if (!audio) return;
    audio.src = recording.url;
    void audio.play().catch(() => undefined);
  }, [recording, voiceTick]);

  async function previewVoice() {
    const line = script.spokenLine.trim();
    if (!line || voiceBusy) return;
    setVoiceError(null);
    const existing = savedVoice(line);
    if (existing) {
      playWhenReady.current = true;
      setVoiceTick((value) => value + 1);
      return;
    }
    setVoiceBusy(true);
    try {
      await loadVoice(line);
      playWhenReady.current = true;
      setVoiceTick((value) => value + 1);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Voice is unavailable.");
    } finally {
      setVoiceBusy(false);
    }
  }
  function update(recipe: (beats: Script["beats"]) => Script["beats"]) {
    onChange((current) => {
      const beats = recipe(current.beats);
      return {
        ...current,
        beats,
        duration: Math.round(beats.reduce((sum, beat) => sum + beat.seconds, 0) * 10) / 10,
      };
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-xl font-medium">Storyboard</h3>
        <label className="flex items-center gap-2 text-sm">
          Shape
          <select
            className={field}
            value={script.shape}
            onChange={(event) =>
              onChange((current) => ({ ...current, shape: event.target.value as Script["shape"] }))
            }
          >
            <option value="16:9">Landscape, 16:9</option>
            <option value="1:1">Square, 1:1</option>
            <option value="9:16">Vertical, 9:16</option>
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Voiceover
          <textarea
            className={`${field} min-h-20`}
            aria-label="Voiceover"
            value={script.spokenLine}
            onChange={(event) => onChange((current) => ({ ...current, spokenLine: event.target.value }))}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="w-fit rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={voiceBusy || script.spokenLine.trim().length === 0}
            onClick={() => void previewVoice()}
          >
            {voiceBusy ? "Recording…" : recording ? "Play voice" : "Preview voice"}
          </button>
          {recording ? <audio ref={voiceAudio} src={recording.url} controls preload="metadata" /> : <audio ref={voiceAudio} className="hidden" />}
        </div>
        {voiceError ? <p className="text-sm text-red-700">{voiceError}</p> : null}
        <p className="text-sm text-zinc-500">
          {recording
            ? "This voice is saved. Building the preview uses it again."
            : "Play the line once to hear it. Changing the words does not record it again."}
        </p>
      </div>
      <ol className="flex flex-col gap-8">
        {script.beats.map((beat) => (
          <Shot
            key={`${beat.id}-${script.shape}`}
            beatId={beat.id}
            picture={beat.picture}
            seconds={beat.seconds}
            shape={script.shape}
            canRemove={script.beats.length > 1}
            onStatus={onStatus}
            onPicture={(picture) =>
              update((beats) => beats.map((item) => (item.id === beat.id ? { ...item, picture } : item)))
            }
            onSeconds={(seconds) =>
              update((beats) => beats.map((item) => (item.id === beat.id ? { ...item, seconds } : item)))
            }
            onRemove={() => update((beats) => beats.filter((item) => item.id !== beat.id))}
          />
        ))}
      </ol>
      <button
        type="button"
        className="w-fit rounded border border-zinc-300 px-3 py-2 text-sm"
        onClick={() =>
          update((beats) => [
            ...beats,
            {
              id: `beat-${Date.now()}`,
              label: "Shot",
              picture: beats[beats.length - 1]?.picture ?? "",
              seconds: 4,
            },
          ])
        }
      >
        Add a shot
      </button>
      <button
        type="button"
        className="w-fit rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
        disabled={!ready || searching}
        onClick={() => {
          const shots: ChosenShot[] = script.beats.flatMap((beat) => {
            const shot = selections[beat.id]?.shot;
            if (!shot) return [];
            return [
              {
                id: shot.id,
                file: shot.file,
                author: shot.author,
                sourcePage: shot.sourcePage,
                seconds: beat.seconds,
                picture: beat.picture,
              },
            ];
          });
          onAssemble(assembleStoryboard(script, shots));
        }}
      >
        {searching ? "Waiting for search…" : "Assemble preview"}
      </button>
    </section>
  );
}
