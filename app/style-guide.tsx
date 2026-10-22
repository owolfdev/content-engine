"use client";

import { useEffect, useState } from "react";
import {
  defaultSession,
  type StyleGuide,
  type StyleSession,
} from "@/lib/style";

const storageKey = "content-engine-style";

export function StyleGuidePreview({
  guide,
  displayFont,
  bodyFont,
}: {
  guide: StyleGuide;
  displayFont: string;
  bodyFont: string;
}) {
  const [session, setSession] = useState<StyleSession>(() => defaultSession(guide));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        setSession({ ...defaultSession(guide), ...JSON.parse(saved) });
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }
    setReady(true);
  }, [guide]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(storageKey, JSON.stringify(session));
  }, [ready, session]);

  const preset =
    guide.presets.find((item) => item.id === session.presetId) ?? guide.presets[0];
  const colors = {
    ...preset.colors,
    accent: session.accent ?? preset.colors.accent,
  };
  const track =
    guide.music.find((item) => item.id === (session.musicId ?? preset.musicId)) ??
    guide.music[0];
  const titleFamily = session.titleFont === "display" ? displayFont : bodyFont;

  const frameStyle = {
    background: colors.background,
    color: colors.ink,
    paddingTop: `${guide.margins.top * 100}%`,
    paddingRight: `${guide.margins.right * 100}%`,
    paddingBottom: `${guide.margins.bottom * 100}%`,
    paddingLeft: `${guide.margins.left * 100}%`,
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">Style guide</p>
        <h1 className="text-2xl font-medium text-zinc-900">{guide.name}</h1>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600">
          Defaults live in the brand file. Changes here last for this browser
          only, so a client can try their own colour and type without a redeploy.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <form className="flex flex-col gap-4 text-sm" onSubmit={(event) => event.preventDefault()}>
          <label className="flex flex-col gap-1">
            Preset
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-2"
              value={session.presetId}
              onChange={(event) =>
                setSession((current) => ({
                  ...current,
                  presetId: event.target.value,
                  accent: null,
                  musicId: null,
                }))
              }
            >
              {guide.presets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            Accent
            <input
              type="color"
              aria-label="Accent colour"
              value={colors.accent}
              onChange={(event) =>
                setSession((current) => ({ ...current, accent: event.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            Title type
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-2"
              value={session.titleFont}
              onChange={(event) =>
                setSession((current) => ({
                  ...current,
                  titleFont: event.target.value as StyleSession["titleFont"],
                }))
              }
            >
              <option value="display">{guide.fonts.display}</option>
              <option value="body">{guide.fonts.body}</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            Wordmark
            <input
              className="rounded border border-zinc-300 px-2 py-2"
              value={session.wordmark}
              onChange={(event) =>
                setSession((current) => ({ ...current, wordmark: event.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            Music
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-2"
              value={track.id}
              onChange={(event) =>
                setSession((current) => ({ ...current, musicId: event.target.value }))
              }
            >
              {guide.music.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="rounded border border-zinc-300 px-3 py-2 text-left"
            onClick={() => {
              window.localStorage.removeItem(storageKey);
              setSession(defaultSession(guide));
            }}
          >
            Reset this browser
          </button>
        </form>

        <section className="flex min-w-0 flex-col gap-4" aria-label="Brand preview">
          <div className="aspect-video overflow-hidden rounded-md" style={frameStyle}>
            <div className="flex h-full min-w-0 flex-col justify-between">
              <img src={guide.logo} alt="" className="h-10 w-10" />
              <div className="min-w-0">
                <p className="text-sm tracking-wide" style={{ color: colors.accent, fontFamily: bodyFont }}>
                  {session.wordmark}
                </p>
                <h2 className="mt-1 text-3xl leading-tight sm:text-4xl" style={{ color: colors.ink, fontFamily: titleFamily }}>
                  The shore, in the evening light.
                </h2>
              </div>
            </div>
          </div>

          <audio key={track.id} controls src={track.file} className="w-full" />
          <p className="text-xs leading-5 text-zinc-500">{track.attribution} Files in the app are 45-second previews.</p>

          <div className="text-sm text-zinc-600">
            <p>Banned lines: {guide.bannedLines.length ? guide.bannedLines.join(", ") : "none"}</p>
            <p>Required lines: {guide.requiredLines.length ? guide.requiredLines.join(", ") : "none yet"}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
