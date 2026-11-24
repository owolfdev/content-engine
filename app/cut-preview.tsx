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
      logo: plan.graphics?.logo || styleGuide.logo,
      logoPlace: plan.graphics?.logoPlace || "top-left",
      music: music?.file ?? null,
      voice: recording?.url ?? null,
      voiceFrames: recording ? Math.round(recording.seconds * fps) : 0,
      titleFont: plan.graphics?.titleFont === "body" ? "body" : "display",
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
      {quick ? (
        <InstantCut
          clips={plan.clips}
          music={music?.file ?? null}
          shape={shape}
          width={displayWidth}
          wordmark={plan.graphics?.wordmark || styleGuide.name}
          logo={plan.graphics?.logo || styleGuide.logo}
          logoPlace={plan.graphics?.logoPlace || "top-left"}
        />
      ) : null}
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
        {quick ? " This plays now. Download video makes the full-size file." : ""}
        {recording ? " The music dips while the voice speaks." : ""}
      </p>
    </div>
  );
}

function clock(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function InstantCut({
  clips,
  music,
  shape,
  width,
  wordmark,
  logo,
  logoPlace,
}: {
  clips: PlanClip[];
  music: string | null;
  shape: PlanShape;
  width: number;
  wordmark: string;
  logo: string;
  logoPlace: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}) {
  const spans = clips.map((clip) => Math.max(0.4, clip.end - clip.start));
  const total = spans.reduce((sum, span) => sum + span, 0);
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [proxies, setProxies] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekRef = useRef<number | null>(null);
  const playingRef = useRef(true);
  const clip = clips[index];
  const src = (clip && proxies[clip.id]) || clip?.stream || clip?.file || "";
  const ratio = shape === "9:16" ? "9 / 16" : shape === "1:1" ? "1 / 1" : "16 / 9";
  const played = spans.slice(0, index).reduce((sum, span) => sum + span, 0) + offset;
  const ids = clips.map((item) => item.id).join(",");

  useEffect(() => {
    const idList = ids.split(",").filter((id) => /^\d+$/.test(id));
    if (!idList.length) return;
    let active = true;
    fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: idList }),
    })
      .then(async (response) => {
        if (!active || !response.ok) return;
        const data = (await response.json()) as { proxies?: { id: string; url: string }[] };
        const next: Record<string, string> = {};
        for (const item of data.proxies ?? []) next[item.id] = item.url;
        if (Object.keys(next).length) {
          seekRef.current = videoRef.current?.currentTime ?? 0;
          setProxies(next);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [ids]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const target = seekRef.current ?? 0;
    seekRef.current = null;
    const apply = () => {
      video.currentTime = target;
    };
    video.addEventListener("loadeddata", apply, { once: true });
    if (playingRef.current) {
      void video.play().catch(() => setPlaying(false));
      void audioRef.current?.play().catch(() => undefined);
    }
    return () => video.removeEventListener("loadeddata", apply);
  }, [index, src]);

  function place(global: number) {
    const at = Math.max(0, Math.min(total, global));
    let left = at;
    let next = 0;
    for (let cursor = 0; cursor < spans.length; cursor += 1) {
      if (left <= spans[cursor] || cursor === spans.length - 1) {
        next = cursor;
        break;
      }
      left -= spans[cursor];
    }
    seekRef.current = left;
    if (audioRef.current) audioRef.current.currentTime = at;
    if (next === index && videoRef.current) {
      videoRef.current.currentTime = left;
      setOffset(left);
      return;
    }
    setIndex(next);
    setOffset(left);
  }

  function onTime() {
    const video = videoRef.current;
    if (!video) return;
    setOffset(video.currentTime);
    if (video.currentTime < spans[index]) return;
    if (index + 1 < clips.length) {
      seekRef.current = 0;
      setOffset(0);
      setIndex(index + 1);
      return;
    }
    video.pause();
    audioRef.current?.pause();
    setPlaying(false);
  }

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      audioRef.current?.pause();
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    playingRef.current = true;
    if (index === clips.length - 1 && video.currentTime >= spans[index] - 0.05) place(0);
    setPlaying(true);
    void video.play().catch(() => setPlaying(false));
    void audioRef.current?.play().catch(() => undefined);
  }

  if (!clip) return null;
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <div className="relative">
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          autoPlay
          onTimeUpdate={onTime}
          className="w-full bg-black object-cover"
          style={{ aspectRatio: ratio }}
        />
        <img
          src={logo}
          alt=""
          className={`pointer-events-none absolute h-8 w-8 ${logoPlace === "top-right" ? "top-3 right-3" : logoPlace === "bottom-left" ? "bottom-3 left-3" : logoPlace === "bottom-right" ? "bottom-3 right-3" : "top-3 left-3"}`}
        />
        <p className="pointer-events-none absolute bottom-3 left-3 text-sm text-white">{wordmark}</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="rounded border border-zinc-300 px-3 py-1 text-sm" onClick={toggle}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          aria-label="Preview position"
          min={0}
          max={total}
          step={0.1}
          value={Math.min(total, played)}
          onChange={(event) => place(Number(event.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="text-xs text-zinc-500">{clock(played)} / {clock(total)}</span>
      </div>
      {music ? <audio ref={audioRef} src={music} /> : null}
    </div>
  );
}
