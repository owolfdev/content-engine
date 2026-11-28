"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { Cut, type CutProps } from "@/composition/Cut";
import { clipFrames, compositionSeconds, playbackFps } from "@/composition/timeline";
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
  jump = null,
  onClip,
  onPlayhead,
  onShape,
}: {
  plan: Plan;
  titleFont: string;
  bodyFont: string;
  quick?: boolean;
  jump?: { at: number; id: number } | null;
  onClip?: (index: number) => void;
  onPlayhead?: (seconds: number) => void;
  onShape?: (shape: PlanShape) => void;
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
  const rate = playbackFps(seconds, plan.clips.length);
  const frames = useMemo(() => clipFrames(plan, seconds), [plan, seconds]);

  const inputProps: CutProps = useMemo(
    () => ({
      clips: plan.clips.map((clip, index) => ({
        src: clip.file,
        durationInFrames: frames[index] ?? 1,
        trimBefore: Math.max(0, Math.round((clip.start || 0) * rate)),
      })),
      title: plan.title,
      spokenLine: plan.spokenLine,
      wordmark: plan.graphics?.wordmark ?? styleGuide.name,
      logo: plan.graphics?.logo ?? styleGuide.logo,
      logoPlace: plan.graphics?.logoPlace || "top-left",
      music: music?.file ?? null,
      voice: recording?.url ?? null,
      voiceFrames: recording ? Math.round(recording.seconds * rate) : 0,
      fps: rate,
      titleFont: plan.graphics?.titleFont === "body" ? "body" : "display",
      bodyFont,
      titleColor: plan.graphics?.titleColor || preset.colors.title,
      accent: plan.graphics?.accent || preset.colors.accent,
      background: plan.graphics?.background || preset.colors.background,
      margins: styleGuide.margins,
      width: size.width,
      height: size.height,
    }),
    [bodyFont, frames, music?.file, plan.clips, plan.graphics, plan.spokenLine, plan.title, preset.colors.accent, preset.colors.background, preset.colors.title, rate, recording, titleFont],
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
            onClick={() => {
              setShape(item.id);
              onShape?.(item.id);
            }}
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
          wordmark={plan.graphics?.wordmark ?? styleGuide.name}
          logo={plan.graphics?.logo ?? styleGuide.logo}
          logoPlace={plan.graphics?.logoPlace || "top-left"}
          jump={jump}
          onClip={onClip}
          onPlayhead={onPlayhead}
        />
      ) : null}
      {!quick && previewReady ? (
        <Player
          component={Cut}
          inputProps={inputProps}
          durationInFrames={Math.max(1, frames.reduce((sum, frame) => sum + frame, 0))}
          fps={rate}
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
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remain = safe - minutes * 60;
  return `${minutes}:${remain.toFixed(1).padStart(4, "0")}`;
}

function InstantCut({
  clips,
  music,
  shape,
  width,
  wordmark,
  logo,
  logoPlace,
  jump = null,
  onClip,
  onPlayhead,
}: {
  clips: PlanClip[];
  music: string | null;
  shape: PlanShape;
  width: number;
  wordmark: string;
  logo: string;
  logoPlace: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  jump?: { at: number; id: number } | null;
  onClip?: (index: number) => void;
  onPlayhead?: (seconds: number) => void;
}) {
  const spans = clips.map((clip) => Math.max(0.001, clip.end - clip.start));
  const total = spans.reduce((sum, span) => sum + span, 0);
  const brief = spans.some((span) => span < 0.25);
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [proxies, setProxies] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekRef = useRef<number | null>(null);
  const playingRef = useRef(true);
  const playhead = useRef(0);
  const spansRef = useRef(spans);
  spansRef.current = spans;
  const offsetRef = useRef(0);
  offsetRef.current = offset;
  const placeRef = useRef<(at: number) => void>(() => undefined);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;
  const onPlayheadRef = useRef(onPlayhead);
  onPlayheadRef.current = onPlayhead;
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
          seekRef.current = offsetRef.current;
          setProxies(next);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [ids]);

  useEffect(() => {
    if (!brief || !playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const pieces = spansRef.current;
      const at = Math.min(total, playhead.current + dt);
      playhead.current = at;
      let left = at;
      let next = 0;
      for (let cursor = 0; cursor < pieces.length; cursor += 1) {
        if (left <= pieces[cursor] || cursor === pieces.length - 1) {
          next = cursor;
          break;
        }
        left -= pieces[cursor];
      }
      setOffset(left);
      setIndex((current) => {
        if (current === next) return current;
        seekRef.current = 0;
        return next;
      });
      if (audioRef.current && Math.abs(audioRef.current.currentTime - at) > 0.3) audioRef.current.currentTime = at;
      if (at >= total) {
        playingRef.current = false;
        setPlaying(false);
        videoRef.current?.pause();
        audioRef.current?.pause();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [brief, playing, total]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const target = (clip?.start ?? 0) + (seekRef.current ?? 0);
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
  }, [clip?.start, index, src]);

  function place(global: number) {
    const at = Math.max(0, Math.min(total, global));
    let left = at;
    let next = 0;
    for (let cursor = 0; cursor < spans.length; cursor += 1) {
      if (left < spans[cursor] || cursor === spans.length - 1) {
        next = cursor;
        break;
      }
      left -= spans[cursor];
    }
    seekRef.current = brief ? 0 : left;
    playhead.current = at;
    if (audioRef.current) audioRef.current.currentTime = at;
    const origin = clips[next]?.start ?? 0;
    if (next === index && videoRef.current) {
      videoRef.current.currentTime = origin + (brief ? 0 : left);
      setOffset(brief ? 0 : left);
      return;
    }
    setIndex(next);
    setOffset(brief ? 0 : left);
  }
  placeRef.current = place;

  useEffect(() => {
    if (index < clips.length) return;
    seekRef.current = 0;
    setOffset(0);
    setIndex(Math.max(0, clips.length - 1));
  }, [clips.length, index]);

  useEffect(() => {
    onClipRef.current?.(index);
  }, [index]);

  useEffect(() => {
    onPlayheadRef.current?.(played);
  }, [played]);

  useEffect(() => {
    if (!jump) return;
    placeRef.current(jump.at);
  }, [jump]);

  function onTime() {
    const video = videoRef.current;
    if (!video || brief || !clip) return;
    const origin = clip.start || 0;
    setOffset(Math.max(0, video.currentTime - origin));
    if (video.currentTime < clip.end - 0.02) return;
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
    if (index === clips.length - 1 && video.currentTime >= (clip?.end ?? spans[index]) - 0.05) place(0);
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
        {logo ? (
          <img
            src={logo}
            alt=""
            className={`pointer-events-none absolute h-8 w-8 ${logoPlace === "top-right" ? "top-3 right-3" : logoPlace === "bottom-left" ? "bottom-3 left-3" : logoPlace === "bottom-right" ? "bottom-3 right-3" : "top-3 left-3"}`}
          />
        ) : null}
        <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 text-xs text-white">
          {clip.author?.trim() || `Clip ${index + 1}`} · {clock(played)} / {clock(total)}
        </p>
        {wordmark ? <p className="pointer-events-none absolute bottom-3 left-3 text-sm text-white">{wordmark}</p> : null}
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
          step={Math.min(0.1, total / Math.max(1, spans.length))}
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
