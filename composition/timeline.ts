import type { Plan } from "@/lib/plan";

export const fps = 30;
const minSeconds = 8;
const maxSeconds = 30;

export function compositionSeconds(plan: Plan, _voiceSeconds: number | null) {
  return Math.min(maxSeconds, Math.max(minSeconds, plan.duration));
}

export function clipFrames(plan: Plan, seconds: number) {
  const weights = plan.clips.map((clip) => Math.max(0.1, clip.end - clip.start));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const target = Math.round(seconds * fps);
  const frames = weights.map((weight) => Math.max(1, Math.round((weight / total) * target)));
  const drift = target - frames.reduce((sum, frame) => sum + frame, 0);
  if (frames.length) frames[frames.length - 1] += drift;
  return frames;
}
