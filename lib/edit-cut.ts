import type { Plan, PlanClip } from "@/lib/plan";

export const minShot = 0.1;

export function shotLength(clip: PlanClip) {
  return Math.max(0, clip.end - clip.start);
}

export function footageLength(clip: PlanClip) {
  const known = Number(clip.sourceDuration);
  if (Number.isFinite(known) && known > 0) return Math.max(known, clip.end);
  return Math.max(clip.end, shotLength(clip));
}

export function clipLabel(clip: PlanClip, index: number) {
  const author = clip.author?.trim();
  return author || `Clip ${index + 1}`;
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function settle(plan: Plan): Plan {
  const duration = Math.round(plan.clips.reduce((sum, clip) => sum + shotLength(clip), 0) * 100) / 100;
  return { ...plan, duration };
}

function replaceClip(plan: Plan, index: number, clip: PlanClip): Plan {
  const clips = plan.clips.map((item, cursor) => (cursor === index ? clip : item));
  return settle({ ...plan, clips });
}

export type TrimEdge = "start" | "end" | "length";
export type TrimMode = "by" | "to";

export function trimShot(plan: Plan, index: number, edge: TrimEdge, seconds: number, mode: TrimMode): { plan: Plan } | { error: string } {
  const clip = plan.clips[index];
  if (!clip) return { error: "That clip is not in the video." };
  if (!Number.isFinite(seconds)) return { error: "A length is needed." };
  const limit = footageLength(clip);
  const floor = Math.min(minShot, Math.max(0.02, shotLength(clip)));
  let start = clip.start;
  let end = clip.end;
  if (edge === "length") {
    const span = mode === "to" ? seconds : shotLength(clip) + seconds;
    end = start + span;
  } else if (edge === "start") {
    start = mode === "to" ? seconds : start + seconds;
  } else {
    end = mode === "to" ? seconds : end + seconds;
  }
  if (end - start < floor) {
    if (edge === "start") start = end - floor;
    else end = start + floor;
  }
  start = Math.max(0, Math.min(start, limit - floor));
  end = Math.min(limit, Math.max(end, start + floor));
  const next = { ...clip, start: roundTime(start), end: roundTime(end) };
  if (Math.abs(next.start - clip.start) < 0.01 && Math.abs(next.end - clip.end) < 0.01) {
    const shortening = edge === "length" ? seconds < (mode === "to" ? shotLength(clip) : 0) : seconds < 0;
    if (edge === "start" && seconds < 0) return { error: "That clip already starts at the beginning." };
    if (edge === "start") return { error: "That clip cannot start any later." };
    if (shortening) return { error: "That clip cannot be any shorter." };
    return { error: "That clip is already at the end of its footage." };
  }
  return { plan: replaceClip(plan, index, next) };
}

export function moveShot(plan: Plan, from: number, to: number): { plan: Plan } | { error: string } {
  if (!plan.clips[from] || to < 0 || to >= plan.clips.length) return { error: "That clip is not in the video." };
  if (from === to) return { error: "That clip is already there." };
  const clips = [...plan.clips];
  const [shot] = clips.splice(from, 1);
  clips.splice(to, 0, shot);
  return { plan: settle({ ...plan, clips }) };
}

export function removeShot(plan: Plan, index: number): { plan: Plan } | { error: string } {
  if (!plan.clips[index]) return { error: "That clip is not in the video." };
  if (plan.clips.length < 2) return { error: "The video needs a clip." };
  const clips = plan.clips.filter((_, cursor) => cursor !== index);
  return { plan: settle({ ...plan, clips }) };
}
