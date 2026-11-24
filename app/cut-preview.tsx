"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { Cut, type CutProps } from "@/composition/Cut";
import { clipFrames, compositionSeconds, fps } from "@/composition/timeline";
import type { Plan, PlanClip, PlanShape } from "@/lib/plan";
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
  quick = false,
}: {
  plan: Plan;
  titleFont: string;
  bodyFont: string;
  quick?: boolean;
}) {
  const [shape, setShape] = useState<PlanShape>(plan.shape);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);
  const recording = savedVoice(plan.spokenLine);
  const clipFiles = plan.clips.map((clip) => `${clip.file}@${clip.start}-${clip.end}`).join("|");

  useEffect(() => {
    if (quick) return;
    let active = true;
    setPreviewReady(false);
    setPreviewProblem(null);
    fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: plan.clips.map((clip) => clip.file) }),
    })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setPreviewProblem("The preview could not be prepared.");
          return;
        }
        setPreviewReady(true);
      })
      .catch(() => {
        if (active) setPreviewProblem("The preview could not be prepared.");
      });
    return () => {
      active = false;
    };
  }, [clipFiles, plan.clips, quick]);

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
      {!quick && !previewReady && !previewProblem ? <p className="text-zinc-500">Preparing the preview…</p> : null}
      {quick ? <InstantCut clips={plan.clips} music={music?.file ?? null} shape={shape} width={displayWidth} /> : null}
      {!quick && previewReady ? (
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
        {quick ? " This plays now. The finished video, with the title and logo, is made in the background." : ""}
        {recording ? " The music dips while the voice speaks." : ""}
      </p>
    </div>
  );
}

function InstantCut({
  clips,
  music,
  shape,
  width,
}: {
  clips: PlanClip[];
  music: string | null;
  shape: PlanShape;
  width: number;
}) {
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clip = clips[index];
  const src = clip?.stream || clip?.file || "";
  const limit = Math.max(0.4, (clip?.end ?? 1) - (clip?.start ?? 0));
  const ratio = shape === "9:16" ? "9 / 16" : shape === "1:1" ? "1 / 1" : "16 / 9";

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
    if (index === 0) void audioRef.current?.play().catch(() => undefined);
  }, [index, src]);

  function onTime() {
    const video = videoRef.current;
    if (!video || video.currentTime < limit) return;
    if (index + 1 < clips.length) setIndex(index + 1);
    else {
      video.pause();
      audioRef.current?.pause();
    }
  }

  if (!clip) return null;
  return (
    <div>
      <video
        ref={videoRef}
        key={`${src}-${index}`}
        src={src}
        muted
        playsInline
        autoPlay
        onTimeUpdate={onTime}
        className="bg-black object-cover"
        style={{ width, maxWidth: "100%", aspectRatio: ratio }}
      />
      {music ? <audio ref={audioRef} src={music} autoPlay /> : null}
    </div>
  );
}
