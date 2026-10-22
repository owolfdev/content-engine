import { readRequest, type FootageSource, type Plan, type PlanShape } from "@/lib/plan";
import { styleGuide } from "@/lib/style";

export type ScriptBeat = {
  id: string;
  label: string;
  picture: string;
  seconds: number;
};

export type Script = {
  request: string;
  source: FootageSource;
  shape: PlanShape;
  duration: number;
  language: "en" | null;
  title: string;
  spokenLine: string;
  wordmark: string;
  musicId: string;
  accent: string;
  titleColor: string;
  background: string;
  notes: string;
  beats: ScriptBeat[];
};

const labels = ["Wide", "Closer", "Detail", "Closing"];

function beatCount(duration: number) {
  if (duration < 16) return 2;
  if (duration < 28) return 3;
  return 4;
}

function splitSeconds(duration: number, count: number) {
  const base = Math.floor((duration / count) * 10) / 10;
  const used = base * (count - 1);
  const last = Math.round((duration - used) * 10) / 10;
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? last : base));
}

function phraseTitle(phrase: string) {
  return phrase.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function draftScript(request: string, source: FootageSource): Script {
  const reading = readRequest(request);
  const picture = reading.phrase;
  const count = beatCount(reading.duration);
  const lengths = splitSeconds(reading.duration, count);
  const preset =
    styleGuide.presets.find((item) => item.id === (reading.musicId === "wallpaper" ? "evening" : "day")) ??
    styleGuide.presets[0];
  const title =
    reading.language === "en"
      ? source === "pexels"
        ? phraseTitle(picture)
        : reading.scene.length
          ? reading.title
          : phraseTitle(picture)
      : "";
  const spokenLine =
    reading.language !== "en" || !title
      ? ""
      : reading.offer
        ? `${styleGuide.name} invites you. ${title}.`
        : `${styleGuide.name}. ${title}.`;
  const footage =
    source === "pexels"
      ? "Each beat is searched on Pexels with its picture line. The search uses those words."
      : "Each picture line is matched to the tagged Palm Shore library.";
  const languageNote =
    reading.language === "en" ? "" : " English is the only language set up, so the voiceover is blank.";
  const banned = styleGuide.bannedLines.length ? ` Banned lines: ${styleGuide.bannedLines.join(", ")}.` : "";

  return {
    request,
    source,
    shape: reading.shape,
    duration: reading.duration,
    language: reading.language,
    title,
    spokenLine,
    wordmark: styleGuide.name,
    musicId: reading.musicId,
    accent: preset.colors.accent,
    titleColor: preset.colors.title,
    background: preset.colors.background,
    notes: `${footage}${languageNote}${banned}`,
    beats: lengths.map((seconds, index) => ({
      id: `beat-${index + 1}`,
      label: labels[index] ?? `Beat ${index + 1}`,
      picture,
      seconds,
    })),
  };
}

export type ChosenShot = {
  id: string;
  file: string;
  author?: string;
  sourcePage?: string;
  seconds: number;
  picture: string;
};

export function assembleStoryboard(script: Script, shots: ChosenShot[]): Plan {
  const clips = shots.filter((shot) => shot.file && shot.seconds > 0);
  const duration = Math.round(clips.reduce((sum, shot) => sum + shot.seconds, 0) * 10) / 10;
  const missing = script.beats.length - clips.length;
  const notes = ["Assembled from the storyboard. Each shot uses the video and duration on that row."];
  if (missing > 0) notes.push(`${missing} shot${missing === 1 ? "" : "s"} had no video, so ${missing === 1 ? "it was" : "they were"} left out.`);
  return {
    request: script.request,
    source: "pexels",
    language: script.language,
    shape: script.shape,
    duration,
    title: script.title,
    spokenLine: script.spokenLine,
    musicId: script.musicId,
    clips: clips.map((shot) => ({
      id: shot.id,
      title: shot.picture,
      file: shot.file,
      tags: [],
      role: "wide",
      viewpoint: "ground",
      start: 0,
      end: shot.seconds,
      author: shot.author,
      sourcePage: shot.sourcePage,
      license: "Pexels License",
    })),
    notes,
    needsModel: false,
    graphics: {
      wordmark: script.wordmark,
      accent: script.accent,
      titleColor: script.titleColor,
      background: script.background,
    },
  };
}

export function clock(beats: ScriptBeat[], index: number) {
  const start = beats.slice(0, index).reduce((sum, beat) => sum + beat.seconds, 0);
  return { start, end: start + beats[index].seconds };
}
