"use client";

import { CutPreview } from "@/app/cut-preview";
import { LocalRender } from "@/app/local-render";
import type { Plan } from "@/lib/plan";

function stamp(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function ChatPreviewView({
  plan,
  titleFont,
  bodyFont,
}: {
  plan: Plan;
  titleFont: string;
  bodyFont: string;
}) {
  let cursor = 0;
  const rows = plan.clips.map((clip) => {
    const start = cursor;
    cursor += clip.end - clip.start;
    return { clip, start, end: cursor };
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3">
      <p className="text-sm text-zinc-700">
        {plan.title}. {rows.length} clip{rows.length === 1 ? "" : "s"}, {stamp(cursor)}.
      </p>
      <CutPreview plan={plan} titleFont={titleFont} bodyFont={bodyFont} quick />
      <ol className="flex flex-col gap-1 text-sm text-zinc-600">
        {rows.map((row) => (
          <li key={row.clip.id}>
            {stamp(row.start)}–{stamp(row.end)} {row.clip.author ? `· ${row.clip.author}` : ""}
          </li>
        ))}
      </ol>
      <LocalRender plan={plan} />
    </div>
  );
}
