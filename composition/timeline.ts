import type { Plan } from "@/lib/plan";

export const fps = 30;
const maxSeconds = 600;

export function compositionSeconds(plan: Plan, _voiceSeconds: number | null) {
  const seconds = Number(plan.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.min(maxSeconds, seconds);
}

export function playbackFps(seconds: number, count: number) {
  const clips = Math.max(1, count);
  const span = seconds > 0 ? seconds : 1;
  return Math.max(fps, Math.ceil(clips / span));
}

export function clipFrames(plan: Plan, seconds: number) {
  const count = plan.clips.length;
  if (!count) return [];
  const rate = playbackFps(seconds, count);
  const target = Math.max(count, Math.round(seconds * rate));
  const weights = plan.clips.map((clip) => Math.max(0.0001, clip.end - clip.start));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const frames = Array.from({ length: count }, () => 1);
  const leftover = target - count;
  const portions = weights.map((weight) => (weight / total) * leftover);
  portions.forEach((portion, index) => {
    frames[index] += Math.floor(portion);
  });
  let remain = target - frames.reduce((sum, frame) => sum + frame, 0);
  const order = portions
    .map((portion, index) => ({ index, fraction: portion - Math.floor(portion) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let extra = 0; extra < remain; extra += 1) frames[order[extra % count].index] += 1;
  return frames;
}
