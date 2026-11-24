import { selectionLimit } from "@/lib/chat-cut";
import type { SelectedClip } from "@/lib/chat";
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

function typicalLength(plan: Plan) {
  const lengths = plan.clips.map(shotLength).filter((span) => span > 0).sort((a, b) => a - b);
  if (!lengths.length) return 2;
  return lengths[Math.floor((lengths.length - 1) / 2)];
}

export function addShots(plan: Plan, clips: SelectedClip[]): { plan: Plan; added: number } | { error: string } {
  const room = selectionLimit - plan.clips.length;
  if (room <= 0) return { error: "The video already has 60 clips." };
  const fresh = clips.filter((clip) => clip.id && !plan.clips.some((shot) => shot.id === clip.id)).slice(0, room);
  if (!fresh.length) return { error: "Those clips are already in the video." };
  const usual = typicalLength(plan);
  const shots: PlanClip[] = fresh.map((clip) => {
    const source = Math.max(minShot, Number(clip.duration) || usual);
    const span = roundTime(Math.min(source, Math.max(minShot, usual)));
    return {
      id: clip.id,
      title: clip.author?.trim() || "Clip",
      file: `/library/pexels/${clip.id}.mp4`,
      tags: [],
      role: "wide",
      viewpoint: "ground",
      start: 0,
      end: span,
      author: clip.author,
      sourcePage: clip.sourcePage,
      license: "Pexels License",
      stream: clip.link,
      sourceDuration: source,
      image: clip.image,
    };
  });
  return { plan: settle({ ...plan, clips: [...plan.clips, ...shots] }), added: shots.length };
}

export function removeShot(plan: Plan, index: number): { plan: Plan } | { error: string } {
  if (!plan.clips[index]) return { error: "That clip is not in the video." };
  if (plan.clips.length < 2) return { error: "The video needs a clip." };
  const clips = plan.clips.filter((_, cursor) => cursor !== index);
  return { plan: settle({ ...plan, clips }) };
}
