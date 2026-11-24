import type { SelectedClip } from "@/lib/chat";
import type { Plan } from "@/lib/plan";
import { assembleStoryboard, draftScript, type ChosenShot } from "@/lib/script";

export const selectionLimit = 60;
export const maxCutSeconds = 600;

function lengths(total: number, count: number) {
  const base = total / count;
  const shares = Array.from({ length: count }, () => base);
  shares[count - 1] = total - base * (count - 1);
  return shares;
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export async function cutFromSelection(selection: SelectedClip[], seconds: number, title: string, query: string): Promise<Plan> {
  const chosen = selection.slice(0, selectionLimit);
  if (!chosen.length) throw new Error("Select a few clips first.");
  const duration = Math.min(maxCutSeconds, Math.max(0.05, Number(seconds) || 12));
  const shares = lengths(duration, chosen.length);
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
  script.title = title.trim() || titleCase(query) || script.title || "Palm Shore";
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
  plan.notes = [`Made from ${shots.length} selected clips.`, `${duration} seconds.`];
  return plan;
}
