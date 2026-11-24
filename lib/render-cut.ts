import type { CutProps } from "@/composition/Cut";
import { clipFrames, compositionSeconds, playbackFps } from "@/composition/timeline";
import type { Plan } from "@/lib/plan";
import { styleGuide } from "@/lib/style";

export function frameSize(shape: Plan["shape"]) {
  if (shape === "9:16") return { width: 1080, height: 1920 };
  if (shape === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

export function renderCutProps(plan: Plan, voice: { src: string; seconds: number } | null): CutProps {
  const size = frameSize(plan.shape);
  const seconds = compositionSeconds(plan, voice?.seconds ?? null);
  const rate = playbackFps(seconds, plan.clips.length);
  const frames = clipFrames(plan, seconds);
  const preset =
    styleGuide.presets.find((item) => item.id === (plan.musicId === "wallpaper" ? "evening" : "day")) ??
    styleGuide.presets[0];
  const music = styleGuide.music.find((item) => item.id === plan.musicId);
  return {
    clips: plan.clips.map((clip, index) => ({
      src: clip.file,
      durationInFrames: frames[index] ?? 1,
      trimBefore: Math.max(0, Math.round((clip.start || 0) * rate)),
    })),
    title: plan.title,
    spokenLine: plan.spokenLine,
    wordmark: plan.graphics?.wordmark || styleGuide.name,
    logo: plan.graphics?.logo ?? styleGuide.logo,
    logoPlace: plan.graphics?.logoPlace || "top-left",
    music: music?.file ?? null,
    voice: voice?.src ?? null,
    voiceFrames: voice ? Math.max(1, Math.round(voice.seconds * rate)) : 0,
    fps: rate,
    titleFont: plan.graphics?.titleFont === "body" ? "body" : "display",
    bodyFont: styleGuide.fonts.body,
    titleColor: plan.graphics?.titleColor || preset.colors.title,
    accent: plan.graphics?.accent || preset.colors.accent,
    background: plan.graphics?.background || preset.colors.background,
    margins: styleGuide.margins,
    width: size.width,
    height: size.height,
  };
}
