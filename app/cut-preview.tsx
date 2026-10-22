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
  const recording = savedVoice(plan.spokenLine);

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
        <p className="text-zinc-500">This cut has no voice yet. Preview the line on the storyboard. Assembling does not record a new one.</p>
      ) : null}
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
      <p className="text-zinc-500">
        {seconds.toFixed(0)} seconds. The picture is center-cropped to the frame.
        {recording ? " Music drops while the voice speaks." : ""}
      </p>
    </div>
  );
}
