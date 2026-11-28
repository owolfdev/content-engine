"use client";

import { useEffect, useState } from "react";
import { ClipStrip } from "@/app/clip-editor";
import { CutPreview } from "@/app/cut-preview";
import { LocalRender } from "@/app/local-render";
import type { Plan, PlanShape } from "@/lib/plan";
import { sessionTrack, styleGuide, type StyleSession } from "@/lib/style";

function stamp(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds * 10) / 10);
  const minutes = Math.floor(rounded / 60);
  const remain = Math.round((rounded - minutes * 60) * 10) / 10;
  const text = Number.isInteger(remain) ? String(remain).padStart(2, "0") : remain.toFixed(1).padStart(4, "0");
  return `${minutes}:${text}`;
}

export function ChatPreviewView({
  plan,
  editing = false,
  canUndo = false,
  titleFont,
  bodyFont,
  session,
  onEdit,
  onUndo,
  onChange,
}: {
  plan: Plan;
  editing?: boolean;
  canUndo?: boolean;
  titleFont: string;
  bodyFont: string;
  session: StyleSession;
  onEdit: (editing: boolean) => void;
  onUndo: () => void;
  onChange: (next: Plan, remember: boolean) => void;
}) {
  let cursor = 0;
  const rows = plan.clips.map((clip) => {
    const start = cursor;
    cursor += clip.end - clip.start;
    return { clip, start, end: cursor };
  });

  const [active, setActive] = useState(0);
  const [played, setPlayed] = useState(0);
  const [cue, setCue] = useState<{ at: number; id: number } | null>(null);
  const [shape, setShape] = useState<PlanShape>(plan.shape);
  useEffect(() => {
    setShape(plan.shape);
  }, [plan.request, plan.shape]);
  const preset = styleGuide.presets.find((item) => item.id === session.presetId) ?? styleGuide.presets[0];
  const branded = {
    ...plan,
    musicId: sessionTrack(session.musicId)?.id ?? "none",
    graphics: {
      wordmark: session.wordmark,
      accent: session.accent ?? preset.colors.accent,
      titleColor: preset.colors.title,
      background: preset.colors.background,
      logo: session.logo ?? "",
      logoPlace: session.logoPlace,
      titleFont: session.titleFont,
    },
    shape,
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3">
      <p className="text-sm text-zinc-700">
        {plan.title}. {rows.length} clip{rows.length === 1 ? "" : "s"}, {stamp(cursor)}.
      </p>
      <CutPreview plan={branded} titleFont={titleFont} bodyFont={bodyFont} quick jump={cue} onClip={setActive} onPlayhead={setPlayed} onShape={setShape} />
      <div className="flex items-center gap-2">
        <button type="button" className="rounded border border-zinc-300 px-3 py-1 text-sm" onClick={() => onEdit(!editing)}>
          {editing ? "Done" : "Edit"}
        </button>
        {editing ? (
          <button type="button" className="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-50" disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
        ) : null}
      </div>
      {editing ? (
        <ClipStrip
          plan={plan}
          active={Math.min(active, Math.max(0, plan.clips.length - 1))}
          played={played}
          onSeek={(at) => setCue({ at, id: Date.now() })}
          onChange={onChange}
        />
      ) : null}
      <ol className="flex flex-col gap-1 text-sm text-zinc-600">
        {rows.map((row) => (
          <li key={row.clip.id}>
            {stamp(row.start)}–{stamp(row.end)} {row.clip.author ? `· ${row.clip.author}` : ""}
          </li>
        ))}
      </ol>
      <LocalRender plan={branded} />
    </div>
  );
}
