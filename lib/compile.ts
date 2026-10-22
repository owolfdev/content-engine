import { matchLibraryClip, readRequest, type Plan, type PlanClip } from "@/lib/plan";
import type { Script } from "@/lib/script";
import { searchPexels } from "@/lib/sources/pexels";

export async function compileScript(script: Script): Promise<Plan> {
  const beats = script.beats.filter((beat) => beat.picture.trim() && beat.seconds > 0);
  if (!beats.length) {
    throw new Error("Add a picture line to at least one beat.");
  }

  const notes = [script.notes.trim()].filter(Boolean);
  const clips: PlanClip[] = [];
  const used = new Set<string>();

  for (const beat of beats) {
    const seconds = Math.max(0.5, beat.seconds);
    if (script.source === "library") {
      const clip = matchLibraryClip(beat.picture, used);
      if (!clip) {
        notes.push(`No library clip for “${beat.picture.trim()}”.`);
        continue;
      }
      used.add(clip.id);
      const end = Math.min(seconds, clip.duration);
      clips.push({
        id: clip.id,
        title: clip.title,
        file: clip.file,
        tags: clip.tags,
        role: clip.tags.includes("walking") || clip.tags.includes("playing") || clip.tags.includes("eating") || clip.tags.includes("cooking")
          ? "action"
          : clip.tags.includes("spa") || clip.tags.includes("room")
            ? "detail"
            : "wide",
        viewpoint: clip.tags.includes("aerial") ? "aerial" : "ground",
        start: 0,
        end,
        author: clip.author,
        sourcePage: clip.source,
        license: clip.license,
      });
      if (end < seconds) notes.push(`${clip.title} is shorter than its beat.`);
      continue;
    }

    const reading = readRequest(beat.picture);
    const found = await searchPexels(
      { ...reading, phrase: beat.picture.trim(), shape: script.shape },
      1,
      used,
    );
    const shot = found[0];
    if (!shot) {
      notes.push(`Pexels returned nothing for “${beat.picture.trim()}”.`);
      continue;
    }
    used.add(shot.id);
    const end = Math.min(seconds, shot.duration);
    clips.push({
      id: shot.id,
      title: beat.picture.trim(),
      file: shot.file,
      tags: [],
      role: "wide",
      viewpoint: "ground",
      start: 0,
      end,
      author: shot.author,
      sourcePage: shot.sourcePage,
      license: shot.license,
    });
  }

  const duration = Math.round(clips.reduce((sum, clip) => sum + (clip.end - clip.start), 0) * 10) / 10;

  return {
    request: script.request,
    source: script.source,
    language: script.language,
    shape: script.shape,
    duration: duration || script.duration,
    title: script.title.trim(),
    spokenLine: script.spokenLine.trim(),
    musicId: script.musicId,
    clips,
    notes,
    needsModel: false,
    graphics: {
      wordmark: script.wordmark.trim() || "Palm Shore",
      accent: script.accent,
      titleColor: script.titleColor,
      background: script.background,
    },
  };
}
