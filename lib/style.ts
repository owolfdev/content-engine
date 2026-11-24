import guide from "@/library/style.json";

export type StyleColors = {
  background: string;
  ink: string;
  accent: string;
  sand: string;
  title: string;
};

export type StylePreset = {
  id: string;
  label: string;
  musicId: string;
  colors: StyleColors;
};

export type StyleTrack = {
  id: string;
  title: string;
  artist: string;
  file: string;
  mood: string;
  license: string;
  attribution: string;
};

export type StyleGuide = {
  propertyId: string;
  name: string;
  fonts: { display: string; body: string };
  logo: string;
  margins: { top: number; right: number; bottom: number; left: number };
  requiredLines: string[];
  bannedLines: string[];
  presets: StylePreset[];
  music: StyleTrack[];
};

export const styleGuide = guide as StyleGuide;

export const logoPlaces = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

export type LogoPlace = (typeof logoPlaces)[number];

export type StyleSession = {
  presetId: string;
  accent: string | null;
  titleFont: "display" | "body";
  musicId: string | null;
  wordmark: string;
  logo: string | null;
  logoPlace: LogoPlace;
};

export const defaultSession = (guide: StyleGuide): StyleSession => ({
  presetId: guide.presets[0]?.id ?? "day",
  accent: null,
  titleFont: "display",
  musicId: null,
  wordmark: guide.name,
  logo: null,
  logoPlace: "top-left",
});
