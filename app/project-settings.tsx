"use client";

import { useState } from "react";
import { defaultSession, logoPlaces, noMusic, sessionTrack, styleGuide, type LogoPlace, type StyleSession } from "@/lib/style";

const placeLabel: Record<LogoPlace, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

export function ProjectSettings({
  session,
  onChange,
}: {
  session: StyleSession;
  onChange: (next: StyleSession) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const preset = styleGuide.presets.find((item) => item.id === session.presetId) ?? styleGuide.presets[0];
  const accent = session.accent ?? preset.colors.accent;
  const musicId = sessionTrack(session.musicId)?.id ?? noMusic;

  function chooseLogo(file: File) {
    if (file.size > 1_500_000) {
      setNote("Choose a smaller logo.");
      return;
    }
    setNote(null);
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (value.startsWith("data:image/")) onChange({ ...session, logo: value });
    };
    reader.readAsDataURL(file);
  }

  return (
    <form className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-3 text-sm" onSubmit={(event) => event.preventDefault()}>
      <p className="text-zinc-700">Project settings</p>
      <label className="flex flex-col gap-1">
        Property
        <input
          className="rounded border border-zinc-300 px-2 py-2"
          value={session.wordmark}
          onChange={(event) => onChange({ ...session, wordmark: event.target.value })}
        />
      </label>
      <div className="flex items-center gap-3">
        {session.logo ? <img src={session.logo} alt="" className="h-10 w-10" /> : <span className="h-10 w-10 rounded border border-zinc-200" />}
        <label className="rounded border border-zinc-300 px-3 py-2">
          Logo
          <input
            type="file"
            accept="image/svg+xml,image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) chooseLogo(file);
            }}
          />
        </label>
        {session.logo !== styleGuide.logo ? (
          <button type="button" className="text-zinc-500" onClick={() => onChange({ ...session, logo: styleGuide.logo })}>
            Use the original logo
          </button>
        ) : null}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend>Logo place</legend>
        <div className="flex flex-wrap gap-2">
          {logoPlaces.map((place) => (
            <button
              key={place}
              type="button"
              className="rounded border border-zinc-300 px-3 py-1"
              aria-pressed={session.logoPlace === place}
              onClick={() => onChange({ ...session, logoPlace: place })}
            >
              {placeLabel[place]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        Type
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-2"
          value={session.titleFont}
          onChange={(event) => onChange({ ...session, titleFont: event.target.value as StyleSession["titleFont"] })}
        >
          <option value="display">{styleGuide.fonts.display}</option>
          <option value="body">{styleGuide.fonts.body}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Theme
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-2"
          value={session.presetId}
          onChange={(event) => onChange({ ...session, presetId: event.target.value, accent: null })}
        >
          {styleGuide.presets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Accent
        <input type="color" aria-label="Accent colour" value={accent} onChange={(event) => onChange({ ...session, accent: event.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        Music
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-2"
          value={musicId}
          onChange={(event) => onChange({ ...session, musicId: event.target.value })}
        >
          <option value={noMusic}>No music</option>
          {styleGuide.music.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="w-fit rounded border border-zinc-300 px-3 py-2"
        onClick={() => {
          setNote(null);
          onChange({ ...defaultSession(styleGuide), wordmark: "", accent: "#ffffff" });
        }}
      >
        Reset all
      </button>
      {note ? <p className="text-zinc-500">{note}</p> : null}
    </form>
  );
}
