import type { SelectedClip } from "@/lib/chat";
import type { Plan } from "@/lib/plan";
import { assembleStoryboard, draftScript, type ChosenShot } from "@/lib/script";

function lengths(total: number, count: number) {
  const base = Math.floor((total / count) * 10) / 10;
  const shares = Array.from({ length: count }, () => base);
  shares[count - 1] = Math.round((total - base * (count - 1)) * 10) / 10;
  return shares;
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export async function cutFromSelection(selection: SelectedClip[], seconds: number, title: string, query: string): Promise<Plan> {
  const chosen = selection.slice(0, 6);
  if (!chosen.length) throw new Error("Select a few clips first.");
  const duration = Math.min(30, Math.max(8, Math.round(Number(seconds)) || 12));
  const shares = lengths(duration, chosen.length);
  const shots: ChosenShot[] = chosen.map((clip, index) => ({
    id: clip.id,
    file: `/library/pexels/${clip.id}.mp4`,
    author: clip.author,
    sourcePage: clip.sourcePage,
    seconds: shares[index] ?? 8,
    picture: title.trim() || query,
  }));
  const script = draftScript(`${duration} second ${query || title || "beach"}`, "pexels");
  script.duration = duration;
  script.title = title.trim() || titleCase(query) || script.title || "Palm Shore";
  script.spokenLine = "";
  script.beats = shots.map((shot, index) => ({
    id: `beat-${index + 1}`,
    label: "Shot",
    picture: script.title,
    seconds: shot.seconds,
  }));
  const plan = assembleStoryboard(script, shots);
  plan.clips = plan.clips.map((clip, index) => ({ ...clip, stream: chosen[index]?.link }));
  plan.notes = [`Made from ${shots.length} selected clips.`, `${duration} seconds. A preview stays between 8 and 30 seconds.`];
  return plan;
}
