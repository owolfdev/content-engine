import { catalog, type CatalogClip } from "@/lib/catalog";
import { styleGuide } from "@/lib/style";

const scenes = ["beach", "villa", "arrival", "pool", "dining", "breakfast", "room", "spa", "fishing"] as const;
const actions = ["walking", "playing", "eating", "cooking"] as const;

const sceneWords: Record<(typeof scenes)[number], string[]> = {
  beach: ["beach", "shore", "shallows", "waves", "sand"],
  villa: ["villa", "villas"],
  arrival: ["arrival", "arrive", "arriving", "pier", "dock"],
  pool: ["pool"],
  dining: ["dining", "dinner", "restaurant"],
  breakfast: ["breakfast"],
  room: ["room", "suite"],
  spa: ["spa", "massage"],
  fishing: ["fishing", "fish"],
};

const actionWords: Record<(typeof actions)[number], string[]> = {
  walking: ["walking", "walk", "walks"],
  playing: ["playing", "play", "volleyball", "swimming", "swim"],
  eating: ["eating", "eat"],
  cooking: ["cooking", "cook", "chef", "pizza", "kitchen"],
};

const unsupportedLanguages = [
  "spanish", "french", "german", "italian", "portuguese", "thai", "chinese",
  "mandarin", "japanese", "arabic", "korean", "vietnamese", "hindi", "russian",
  "dutch", "swedish", "indonesian", "malay",
];

const burnedInText = new Set(["34103646"]);

export type PlanRole = "wide" | "action" | "detail";
export type PlanShape = "9:16" | "1:1" | "16:9";

export type FootageSource = "library" | "pexels";

export type PlanClip = {
  id: string;
  title: string;
  file: string;
  tags: string[];
  role: PlanRole;
  viewpoint: "ground" | "aerial";
  start: number;
  end: number;
  author?: string;
  sourcePage?: string;
  license?: string;
  stream?: string;
};

export type PlanGraphics = {
  wordmark: string;
  accent: string;
  titleColor: string;
  background: string;
};

export type Plan = {
  request: string;
  source: FootageSource;
  language: "en" | null;
  shape: PlanShape;
  duration: number;
  title: string;
  spokenLine: string;
  musicId: string;
  clips: PlanClip[];
  notes: string[];
  needsModel: boolean;
  graphics?: PlanGraphics;
};

export type RequestReading = {
  request: string;
  tokens: string[];
  scene: string[];
  action: string[];
  light: { tag: "day" | "sunset" | "night"; label: string } | null;
  language: "en" | null;
  shape: PlanShape;
  duration: number;
  wantsAerial: boolean;
  guests: boolean;
  offer: boolean;
  title: string;
  spokenLine: string;
  musicId: string;
  phrase: string;
  needsModel: boolean;
};

type Light = { tag: "day" | "sunset" | "night"; label: string };

function tokensOf(request: string) {
  return request.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function mentioned(tokens: string[], words: string[]) {
  return words.some((word) => tokens.includes(word));
}

function roleOf(clip: CatalogClip): PlanRole {
  if (clip.tags.some((tag) => (actions as readonly string[]).includes(tag))) return "action";
  if (clip.tags.includes("spa") || clip.tags.includes("room")) return "detail";
  return "wide";
}

function aerial(clip: CatalogClip) {
  return clip.tags.includes("aerial");
}

function lightOf(tokens: string[]): Light | null {
  if (mentioned(tokens, ["sunrise", "dawn"])) return { tag: "day", label: "Sunrise" };
  if (mentioned(tokens, ["sunset", "dusk"])) return { tag: "sunset", label: "Sunset" };
  if (mentioned(tokens, ["evening"])) return { tag: "sunset", label: "Evening" };
  if (mentioned(tokens, ["night", "nighttime"])) return { tag: "night", label: "Night" };
  if (mentioned(tokens, ["morning"])) return { tag: "day", label: "Morning" };
  if (mentioned(tokens, ["day", "noon", "midday", "sunny"])) return { tag: "day", label: "Day" };
  return null;
}

function shapeOf(request: string): PlanShape {
  const raw = request.toLowerCase();
  const found = [
    { shape: "9:16" as const, at: raw.search(/9\s*[:x×]\s*16|vertical|portrait|\breel\b|\bstory\b/) },
    { shape: "1:1" as const, at: raw.search(/1\s*[:x×]\s*1|\bsquare\b/) },
    { shape: "16:9" as const, at: raw.search(/16\s*[:x×]\s*9|horizontal|landscape|widescreen/) },
  ].filter((item) => item.at >= 0);
  found.sort((a, b) => a.at - b.at);
  return found[0]?.shape ?? "16:9";
}

function durationOf(request: string) {
  const match = request.toLowerCase().match(/(\d+)\s*-?\s*seconds?|\b(\d+)\s*s\b/);
  const value = Number(match?.[1] ?? match?.[2]);
  if (!Number.isFinite(value)) return 20;
  return Math.min(60, Math.max(8, value));
}

function languageOf(tokens: string[]): "en" | null {
  if (tokens.some((token) => unsupportedLanguages.includes(token))) return null;
  return "en";
}

function clipCount(duration: number) {
  if (duration < 16) return 2;
  if (duration < 28) return 3;
  return 4;
}

function score(clip: CatalogClip, scene: string[], action: string[], light: Light | null, guests: boolean) {
  const sceneHits = scene.filter((tag) => clip.tags.includes(tag)).length;
  const actionHits = action.filter((tag) => clip.tags.includes(tag)).length;
  const extraScenes = clip.tags.filter(
    (tag) => (scenes as readonly string[]).includes(tag) && !scene.includes(tag),
  ).length;
  let value = sceneHits * 5 + actionHits * 3 - extraScenes;
  if (light && clip.tags.includes(light.tag)) value += 4;
  if (guests && clip.tags.includes("guests")) value += 1;
  return value;
}

function take(list: CatalogClip[], used: Set<string>, previousAerial: boolean) {
  return list.find((clip) => !used.has(clip.id) && !(previousAerial && aerial(clip)));
}

function choose(candidates: CatalogClip[], count: number, wantsAerial: boolean) {
  const byRole = (role: PlanRole, fromAir: boolean) =>
    candidates.filter((clip) => roleOf(clip) === role && aerial(clip) === fromAir);
  const pools = wantsAerial
    ? [
        byRole("wide", true),
        byRole("wide", false),
        byRole("action", false),
        byRole("action", true),
        byRole("detail", false),
      ]
    : [
        byRole("wide", false),
        byRole("wide", true),
        byRole("action", false),
        byRole("action", true),
        byRole("detail", false),
      ];
  const chosen: CatalogClip[] = [];
  const used = new Set<string>();
  const pull = (preferAction: boolean) => {
    const order = preferAction ? [2, 3, 4, 0, 1] : [0, 1, 2, 3, 4];
    for (const index of order) {
      const clip = take(pools[index], used, chosen.length > 0 && aerial(chosen[chosen.length - 1]));
      if (!clip) continue;
      used.add(clip.id);
      chosen.push(clip);
      return;
    }
  };
  pull(false);
  while (chosen.length < count) {
    const before = chosen.length;
    pull(chosen.length === 1);
    if (chosen.length === before) break;
  }
  return chosen;
}

function scenePhrase(scene: string) {
  const phrases: Record<string, string> = {
    beach: "the beach",
    villa: "the villas",
    arrival: "arrival",
    pool: "the pool",
    dining: "dinner",
    breakfast: "breakfast",
    room: "the suite",
    spa: "the spa",
    fishing: "the water",
  };
  return phrases[scene] ?? scene;
}

function titleFor(light: Light | null, scene: string | null) {
  const place = scene ? scenePhrase(scene) : styleGuide.name;
  if (light?.label === "Sunrise" && scene === "beach") return "Sunrise on the beach";
  if (light?.label === "Sunset" && scene === "dining") return "Sunset at dinner";
  if (light?.label === "Evening" && scene === "dining") return "Evening at dinner";
  if (light) return `${light.label} at ${place}`;
  if (scene) return place.charAt(0).toUpperCase() + place.slice(1);
  return styleGuide.name;
}

function musicFor(light: Light | null, action: string[]) {
  if (light && (light.tag === "sunset" || light.tag === "night" || light.label === "Evening")) {
    return "wallpaper";
  }
  if (action.includes("playing")) return "easy-lemon";
  return "carefree";
}

function slotEnd(duration: number, count: number, index: number, clipDuration: number) {
  const base = Math.floor((duration / count) * 10) / 10;
  const used = base * (count - 1);
  const last = Math.round((duration - used) * 10) / 10;
  const slot = index === count - 1 ? last : base;
  return Math.min(clipDuration, slot);
}

const formatWords = new Set([
  "a", "an", "the", "in", "on", "of", "for", "and", "with", "to", "from", "at", "by",
  "second", "seconds", "offer", "vertical", "portrait", "square", "horizontal",
  "landscape", "widescreen", "english", "story", "reel", "please", "make", "show",
]);

function searchPhrase(tokens: string[]) {
  return tokens
    .filter((token) => !formatWords.has(token) && !/^\d+$/.test(token))
    .join(" ");
}

export function readRequest(request: string): RequestReading {
  const tokens = tokensOf(request);
  const scene = scenes.filter((name) => mentioned(tokens, sceneWords[name]));
  const action = actions.filter((name) => mentioned(tokens, actionWords[name]));
  const light = lightOf(tokens);
  const language = languageOf(tokens);
  const shape = shapeOf(request);
  const duration = durationOf(request);
  const wantsAerial = mentioned(tokens, ["aerial", "drone"]);
  const guests = mentioned(tokens, ["guest", "guests", "people", "couple", "friends"]);
  const offer = tokens.includes("offer");
  const title = titleFor(light, scene[0] ?? null);
  const spokenLine =
    language === "en"
      ? offer
        ? `${styleGuide.name} invites you. ${title}.`
        : `${styleGuide.name}. ${title}.`
      : "";
  const phrase = searchPhrase(tokens);
  return {
    request,
    tokens,
    scene,
    action,
    light,
    language,
    shape,
    duration,
    wantsAerial,
    guests,
    offer,
    title,
    spokenLine,
    musicId: musicFor(light, action),
    phrase,
    needsModel: scene.length === 0 && action.length === 0,
  };
}

export type LooseShot = {
  id: string;
  title: string;
  file: string;
  tags: string[];
  duration: number;
  role: PlanRole;
  viewpoint: "ground" | "aerial";
  author?: string;
  sourcePage?: string;
  license?: string;
};

export function planFromShots(reading: RequestReading, shots: LooseShot[], notes: string[], source: FootageSource): Plan {
  const phraseTitle = reading.phrase.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  const title =
    reading.language === "en"
      ? source === "pexels"
        ? phraseTitle
        : reading.scene.length
          ? reading.title
          : phraseTitle
      : "";
  const spokenLine =
    reading.language !== "en" || !title
      ? ""
      : reading.offer
        ? `${styleGuide.name} invites you. ${title}.`
        : `${styleGuide.name}. ${title}.`;
  return {
    request: reading.request,
    source,
    language: reading.language,
    shape: reading.shape,
    duration: reading.duration,
    title,
    spokenLine,
    musicId: reading.musicId,
    clips: shots.map((shot, index) => ({
      id: shot.id,
      title: shot.title,
      file: shot.file,
      tags: shot.tags,
      role: shot.role,
      viewpoint: shot.viewpoint,
      start: 0,
      end: slotEnd(reading.duration, shots.length, index, shot.duration),
      author: shot.author,
      sourcePage: shot.sourcePage,
      license: shot.license,
    })),
    notes,
    needsModel: false,
  };
}

export function planRequest(request: string): Plan {
  const reading = readRequest(request);
  const notes = [
    "Chosen from catalog tags. Timed ranges are not in the library yet, so each clip starts at the first frame.",
  ];
  const { scene, action, light, language, shape, duration, wantsAerial, guests, title, spokenLine } = reading;

  if (scene.length === 0 && action.length === 0) {
    const openNotes = [
      "This sentence does not name a scene or an action in the library.",
      "No model key is set, so no clips were chosen.",
    ];
    if (language === null) {
      openNotes.push("That language is not available yet. English is the only one set up.");
    }
    return {
      request,
      source: "library",
      language,
      shape,
      duration,
      title: "",
      spokenLine: "",
      musicId: musicFor(light, action),
      clips: [],
      notes: openNotes,
      needsModel: true,
    };
  }

  if (language === null) {
    notes.push("That language is not available yet. English is the only one set up.");
  }

  const ranked = catalog.clips
    .filter((clip) => !burnedInText.has(clip.id))
    .filter((clip) => {
      const sceneOk = scene.length === 0 || scene.some((tag) => clip.tags.includes(tag));
      const actionOk = action.length === 0 || action.some((tag) => clip.tags.includes(tag));
      return sceneOk && actionOk;
    })
    .map((clip, index) => ({ clip, index, value: score(clip, scene, action, light, guests) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map((item) => item.clip);

  const leftOut = catalog.clips.filter(
    (clip) =>
      burnedInText.has(clip.id) &&
      (scene.length === 0 || scene.some((tag) => clip.tags.includes(tag))),
  );
  if (leftOut.length) {
    notes.push(`${leftOut.map((clip) => clip.title).join(", ")} was left out because of a sign in the picture.`);
  }

  const count = Math.min(clipCount(duration), ranked.length);
  const chosen = choose(ranked, count, wantsAerial);
  if (chosen.length < clipCount(duration)) {
    notes.push(`The library had ${chosen.length} matching ${chosen.length === 1 ? "clip" : "clips"}.`);
  }

  return {
    request,
    source: "library",
    language,
    shape,
    duration,
    title: language === "en" ? title : "",
    spokenLine,
    musicId: musicFor(light, action),
    clips: chosen.map((clip, index) => ({
      id: clip.id,
      title: clip.title,
      file: clip.file,
      tags: clip.tags,
      role: roleOf(clip),
      viewpoint: aerial(clip) ? "aerial" : "ground",
      start: 0,
      end: slotEnd(duration, chosen.length, index, clip.duration),
      author: clip.author,
      sourcePage: clip.source,
      license: clip.license,
    })),
    notes,
    needsModel: false,
  };
}

export function matchLibraryClip(picture: string, used: Iterable<string>) {
  const skip = new Set(used);
  const reading = readRequest(picture);
  const tokens = reading.tokens.filter((token) => token.length > 2);
  const ranked = catalog.clips
    .filter((clip) => !burnedInText.has(clip.id) && !skip.has(clip.id))
    .filter((clip) => {
      if (reading.needsModel) {
        const hay = `${clip.title} ${clip.tags.join(" ")}`.toLowerCase();
        return tokens.some((token) => hay.includes(token));
      }
      const sceneOk = reading.scene.length === 0 || reading.scene.some((tag) => clip.tags.includes(tag));
      const actionOk = reading.action.length === 0 || reading.action.some((tag) => clip.tags.includes(tag));
      return sceneOk && actionOk;
    })
    .map((clip, index) => ({
      clip,
      index,
      value: score(clip, reading.scene, reading.action, reading.light, reading.guests),
    }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  return ranked[0]?.clip ?? null;
}
