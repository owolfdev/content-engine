import type { SelectedClip } from "@/lib/chat";
import type { Plan } from "@/lib/plan";
import { assembleStoryboard, draftScript, type ChosenShot } from "@/lib/script";

export const selectionLimit = 60;
export const maxCutSeconds = 600;

function fitLengths(total: number, available: number[]) {
  const room = available.map((value) => Math.max(0.05, value));
  const target = Math.min(total, room.reduce((sum, value) => sum + value, 0));
  const shares = room.map(() => 0);
  let left = target;
  let open = room.map((_, index) => index);
  while (open.length && left > 0.0001) {
    const share = left / open.length;
    const capped: number[] = [];
    const rest: number[] = [];
    for (const index of open) {
      if (room[index] <= share) capped.push(index);
      else rest.push(index);
    }
    if (!capped.length) {
      for (const index of rest) shares[index] = share;
      const last = rest[rest.length - 1];
      shares[last] = Math.min(room[last], shares[last] + target - shares.reduce((sum, value) => sum + value, 0));
      break;
    }
    for (const index of capped) {
      shares[index] = room[index];
      left -= room[index];
    }
    open = rest;
  }
  return shares;
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export async function cutFromSelection(selection: SelectedClip[], seconds: number, title: string, query: string, maxShot = 0): Promise<Plan> {
  const chosen = selection.slice(0, selectionLimit);
  if (!chosen.length) throw new Error("Select a few clips first.");
  const duration = Math.min(maxCutSeconds, Math.max(0.05, Number(seconds) || 12));
  const cap = Number.isFinite(maxShot) && maxShot > 0 ? maxShot : 0;
  const shares = fitLengths(duration, chosen.map((clip) => {
    const source = clip.duration || duration;
    return cap ? Math.min(source, cap) : source;
  }));
  const shots: ChosenShot[] = chosen.map((clip, index) => {
    const available = Math.max(0.05, clip.duration || shares[index] || 0.05);
    return {
      id: clip.id,
      file: `/library/pexels/${clip.id}.mp4`,
      author: clip.author,
      sourcePage: clip.sourcePage,
      seconds: Math.min(shares[index] ?? available, available),
      picture: title.trim() || query,
    };
  });
  const script = draftScript(`${duration} second ${query || title || "beach"}`, "pexels");
  script.duration = duration;
  script.title = title.trim() || titleCase(query) || script.title || "Video";
  script.spokenLine = "";
  script.beats = shots.map((shot, index) => ({
    id: `beat-${index + 1}`,
    label: "Shot",
    picture: script.title,
    seconds: shot.seconds,
  }));
  const plan = assembleStoryboard(script, shots);
  plan.clips = plan.clips.map((clip, index) => ({
    ...clip,
    stream: chosen[index]?.link,
    sourceDuration: Math.max(clip.end, chosen[index]?.duration || clip.end),
    image: chosen[index]?.image,
  }));
  plan.duration = Math.round(plan.clips.reduce((sum, clip) => sum + (clip.end - clip.start), 0) * 100) / 100;
  const shown = Number.isInteger(plan.duration) ? String(plan.duration) : plan.duration.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  plan.notes = [`Made from ${shots.length} selected clips.`, `${shown} seconds.`];
  return plan;
}
