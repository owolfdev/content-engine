"use client";

import { useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { Cut, type CutProps } from "@/composition/Cut";
import { clipFrames, compositionSeconds, fps } from "@/composition/timeline";
import type { Plan, PlanShape } from "@/lib/plan";
import { styleGuide } from "@/lib/style";
import { savedVoice } from "@/app/voice-memory";

const shapes: { id: PlanShape; label: string }[] = [
  { id: "16:9", label: "16:9" },
  { id: "1:1", label: "1:1" },
  { id: "9:16", label: "9:16" },
];

function frameSize(shape: PlanShape) {
  if (shape === "9:16") return { width: 1080, height: 1920 };
  if (shape === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

export function CutPreview({
  plan,
  titleFont,
  bodyFont,
}: {
  plan: Plan;
  titleFont: string;
  bodyFont: string;
}) {
  const [shape, setShape] = useState<PlanShape>(plan.shape);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);
  const recording = savedVoice(plan.spokenLine);
  const clipFiles = plan.clips.map((clip) => clip.file).join("|");

  useEffect(() => {
    let active = true;
    setPreviewReady(false);
    setPreviewProblem(null);
    fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: clipFiles.split("|").filter(Boolean) }),
    })
      .then((response) => {
        if (!active) return;
        if (!response.ok) setPreviewProblem("The preview could not be prepared.");
        else setPreviewReady(true);
      })
      .catch(() => {
        if (active) setPreviewProblem("The preview could not be prepared.");
      });
    return () => {
      active = false;
    };
  }, [clipFiles]);

  useEffect(() => {
    setShape(plan.shape);
  }, [plan.request, plan.shape]);

  const size = frameSize(shape);
  const preset =
    styleGuide.presets.find((item) => item.id === (plan.musicId === "wallpaper" ? "evening" : "day")) ??
    styleGuide.presets[0];
  const music = styleGuide.music.find((item) => item.id === plan.musicId);
  const seconds = compositionSeconds(plan, recording?.seconds ?? null);
  const frames = useMemo(() => clipFrames(plan, seconds), [plan, seconds]);

  const inputProps: CutProps = useMemo(
    () => ({
      clips: plan.clips.map((clip, index) => ({
        src: clip.file,
        durationInFrames: frames[index] ?? 1,
      })),
      title: plan.title,
      spokenLine: plan.spokenLine,
      wordmark: plan.graphics?.wordmark || styleGuide.name,
      logo: styleGuide.logo,
      music: music?.file ?? null,
      voice: recording?.url ?? null,
      voiceFrames: recording ? Math.round(recording.seconds * fps) : 0,
      titleFont,
      bodyFont,
      titleColor: plan.graphics?.titleColor || preset.colors.title,
      accent: plan.graphics?.accent || preset.colors.accent,
      background: plan.graphics?.background || preset.colors.background,
      margins: styleGuide.margins,
      width: size.width,
      height: size.height,
    }),
    [bodyFont, frames, music?.file, plan.clips, plan.graphics, plan.spokenLine, plan.title, preset.colors.accent, preset.colors.background, preset.colors.title, recording, titleFont],
  );

  const displayWidth = shape === "9:16" ? 280 : shape === "1:1" ? 420 : 720;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {shapes.map((item) => (
          <button
            key={item.id}
            type="button"
            className="rounded border border-zinc-300 px-3 py-1"
            aria-pressed={shape === item.id}
            onClick={() => setShape(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {plan.spokenLine && !recording ? (
        <p className="text-zinc-500">This preview is silent.</p>
      ) : null}
      {previewProblem ? <p className="text-zinc-500">{previewProblem}</p> : null}
      {previewReady ? null : previewProblem ? null : <p className="text-zinc-500">Preparing the preview…</p>}
      {previewReady ? (
        <Player
          component={Cut}
          inputProps={inputProps}
          durationInFrames={Math.max(1, frames.reduce((sum, frame) => sum + frame, 0))}
          fps={fps}
          compositionWidth={size.width}
          compositionHeight={size.height}
          controls
          acknowledgeRemotionLicense
          style={{ width: displayWidth, maxWidth: "100%" }}
        />
      ) : null}
      <p className="text-zinc-500">
        {seconds.toFixed(0)} seconds. The picture fills the frame.
        {recording ? " The music dips while the voice speaks." : ""}
      </p>
    </div>
  );
}
