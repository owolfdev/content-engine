import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LooseShot, PlanShape, RequestReading } from "@/lib/plan";

type PexelsFile = {
  file_type?: string;
  link?: string;
  width?: number;
  height?: number;
  quality?: string;
};

type PexelsVideo = {
  id?: number;
  url?: string;
  duration?: number;
  user?: { name?: string; url?: string };
  video_files?: PexelsFile[];
};

const cacheDir = path.join(process.cwd(), "public", "library", "pexels");

function pickFile(video: PexelsVideo, shape: PlanShape) {
  const files = (video.video_files ?? []).filter(
    (file) => file.file_type === "video/mp4" && file.link && file.width && file.height,
  );
  const portrait = files.filter((file) => (file.height ?? 0) > (file.width ?? 0));
  const landscape = files.filter((file) => (file.width ?? 0) >= (file.height ?? 0));
  const pool = shape === "9:16" ? (portrait.length ? portrait : files) : shape === "1:1" ? files : landscape.length ? landscape : files;
  return [...pool].sort((a, b) => {
    if (shape === "1:1") {
      const ar = (a.width ?? 1) / (a.height ?? 1);
      const br = (b.width ?? 1) / (b.height ?? 1);
      return Math.abs(ar - 1) - Math.abs(br - 1);
    }
    const aw = a.width ?? 0;
    const bw = b.width ?? 0;
    return Math.abs(aw - 1920) - Math.abs(bw - 1920) || aw - bw;
  })[0];
}

async function cached(id: string) {
  const dest = path.join(cacheDir, `${id}.mp4`);
  try {
    const info = await stat(dest);
    if (info.size > 50_000) return dest;
  } catch {
    return null;
  }
  return null;
}

async function download(url: string, dest: string) {
  const response = await fetch(url, { headers: { "User-Agent": "content-engine" } });
  if (!response.ok) {
    throw new Error(`Pexels file download failed (${response.status}).`);
  }
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

const downloads = new Map<string, Promise<void>>();

async function ensureFile(id: string, link: string) {
  if (await cached(id)) return;
  const existing = downloads.get(id);
  if (existing) return existing;
  const task = (async () => {
    await mkdir(cacheDir, { recursive: true });
    if (await cached(id)) return;
    await download(link, path.join(cacheDir, `${id}.mp4`));
  })().finally(() => {
    downloads.delete(id);
  });
  downloads.set(id, task);
  return task;
}

export async function searchPexels(
  reading: RequestReading,
  count: number,
  exclude: Iterable<string> = [],
): Promise<LooseShot[]> {
  const skip = new Set(exclude);
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Pexels key is missing.");
  const query = reading.phrase;
  if (!query) return [];

  const orientation = reading.shape === "9:16" ? "portrait" : reading.shape === "1:1" ? "square" : "landscape";
  const endpoint = new URL("https://api.pexels.com/videos/search");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("per_page", "15");
  endpoint.searchParams.set("orientation", orientation);
  const response = await fetch(endpoint, {
    headers: { Authorization: key, "User-Agent": "content-engine" },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Pexels rejected the key.");
  }
  if (!response.ok) {
    throw new Error("Pexels search failed.");
  }
  const body = (await response.json()) as { videos?: PexelsVideo[] };
  const videos = body.videos ?? [];
  await mkdir(cacheDir, { recursive: true });

  const shots: LooseShot[] = [];
  for (const video of videos) {
    if (shots.length >= count) break;
    const id = String(video.id ?? "");
    const file = pickFile(video, reading.shape);
    if (!id || !file?.link || skip.has(id)) continue;
    try {
      await ensureFile(id, file.link);
    } catch {
      continue;
    }
    const duration = Math.max(1, Number(video.duration) || 8);
    shots.push({
      id,
      title: query.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
      file: `/library/pexels/${id}.mp4`,
      tags: [],
      duration,
      role: "wide",
      viewpoint: "ground",
      author: video.user?.name,
      sourcePage: video.url,
      license: "Pexels License",
    });
  }
  return shots;
}

export type PexelsPick = {
  id: string;
  file: string;
  author?: string;
  sourcePage?: string;
  index: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

type Candidate = {
  id: string;
  link: string;
  author?: string;
  sourcePage?: string;
};

type SearchEntry = {
  candidates: Candidate[];
  page: number;
  seen: number;
  total: number;
  done: boolean;
};

const searches = new Map<string, SearchEntry>();
const searchLocks = new Map<string, Promise<void>>();

function orientationFor(shape: PlanShape) {
  if (shape === "9:16") return "portrait";
  if (shape === "1:1") return "square";
  return "landscape";
}

async function readPage(phrase: string, shape: PlanShape, page: number) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Pexels key is missing.");
  const endpoint = new URL("https://api.pexels.com/videos/search");
  endpoint.searchParams.set("query", phrase);
  endpoint.searchParams.set("per_page", "15");
  endpoint.searchParams.set("orientation", orientationFor(shape));
  endpoint.searchParams.set("page", String(page));
  const response = await fetch(endpoint, {
    headers: { Authorization: key, "User-Agent": "content-engine" },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Pexels rejected the key.");
  }
  if (!response.ok) {
    throw new Error("Pexels search failed.");
  }
  return (await response.json()) as { videos?: PexelsVideo[]; total_results?: number };
}

async function fillEntry(entry: SearchEntry, phrase: string, shape: PlanShape, index: number) {
  while (!entry.done && entry.candidates.length <= index + 1 && entry.page <= 5) {
    const body = await readPage(phrase, shape, entry.page);
    const videos = body.videos ?? [];
    entry.total = body.total_results ?? entry.total;
    entry.seen += videos.length;
    for (const video of videos) {
      const id = String(video.id ?? "");
      const file = pickFile(video, shape);
      if (!id || !file?.link || entry.candidates.some((item) => item.id === id)) continue;
      entry.candidates.push({
        id,
        link: file.link,
        author: video.user?.name,
        sourcePage: video.url,
      });
    }
    entry.page += 1;
    if (videos.length < 15 || entry.seen >= entry.total) entry.done = true;
  }
  if (entry.page > 5) entry.done = true;
}

async function loadThrough(phrase: string, shape: PlanShape, index: number) {
  const cacheKey = `${shape}\n${phrase}`;
  let entry = searches.get(cacheKey);
  if (!entry) {
    if (searches.size > 40) {
      const oldest = searches.keys().next().value;
      if (oldest) searches.delete(oldest);
    }
    entry = { candidates: [], page: 1, seen: 0, total: Number.POSITIVE_INFINITY, done: false };
    searches.set(cacheKey, entry);
  }
  const currentEntry = entry;
  const previous = searchLocks.get(cacheKey) ?? Promise.resolve();
  const current = previous.then(
    () => fillEntry(currentEntry, phrase, shape, index),
    () => fillEntry(currentEntry, phrase, shape, index),
  );
  searchLocks.set(cacheKey, current);
  try {
    await current;
  } finally {
    if (searchLocks.get(cacheKey) === current) searchLocks.delete(cacheKey);
  }
  return currentEntry;
}

export async function pexelsAt(phrase: string, shape: PlanShape, index: number): Promise<PexelsPick | null> {
  const query = phrase.trim();
  if (!query) return null;
  const safeIndex = Math.max(0, Math.floor(index));
  const entry = await loadThrough(query, shape, safeIndex);
  const video = entry.candidates[safeIndex];
  if (!video) return null;
  await ensureFile(video.id, video.link);
  return {
    id: video.id,
    file: `/library/pexels/${video.id}.mp4`,
    author: video.author,
    sourcePage: video.sourcePage,
    index: safeIndex,
    hasPrevious: safeIndex > 0,
    hasNext: safeIndex + 1 < entry.candidates.length || !entry.done,
  };
}
