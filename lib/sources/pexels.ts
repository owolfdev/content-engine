import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/ffmpeg";
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
  video_pictures?: { picture?: string }[];
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
  const response = await fetch(url, { headers: { "User-Agent": "content-engine" }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) {
    throw new Error(`Pexels file download failed (${response.status}).`);
  }
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

const downloads = new Map<string, Promise<void>>();

async function previewReady(id: string) {
  try {
    const info = await stat(path.join(cacheDir, `${id}-preview.mp4`));
    return info.size > 20_000;
  } catch {
    return false;
  }
}

async function ensurePreview(id: string) {
  if (await previewReady(id)) return;
  const source = path.join(cacheDir, `${id}.mp4`);
  const dest = path.join(cacheDir, `${id}-preview.mp4`);
  const partial = `${dest}.part.mp4`;
  try {
    await runFfmpeg([
      "-y",
      "-i",
      source,
      "-t",
      "30",
      "-an",
      "-vf",
      "scale=w='min(640,iw)':h=-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-threads",
      "2",
      "-crf",
      "30",
      "-movflags",
      "+faststart",
      partial,
    ]);
    await rename(partial, dest);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
}

async function ensureFile(id: string, link: string) {
  const existing = downloads.get(id);
  if (existing) return existing;
  const task = (async () => {
    await mkdir(cacheDir, { recursive: true });
    if (!(await cached(id))) await download(link, path.join(cacheDir, `${id}.mp4`));
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
    signal: AbortSignal.timeout(20_000),
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

async function readPage(phrase: string, shape: PlanShape, page: number, perPage = 15) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Pexels key is missing.");
  const endpoint = new URL("https://api.pexels.com/videos/search");
  endpoint.searchParams.set("query", phrase);
  endpoint.searchParams.set("per_page", String(perPage));
  endpoint.searchParams.set("orientation", orientationFor(shape));
  endpoint.searchParams.set("page", String(page));
  const response = await fetch(endpoint, {
    headers: { Authorization: key, "User-Agent": "content-engine" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
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

export type BrowseClip = {
  id: string;
  link: string;
  image?: string;
  author?: string;
  sourcePage?: string;
  duration: number;
};

function pexelsFileLink(link: string) {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.hostname.endsWith("pexels.com");
  } catch {
    return false;
  }
}

export async function countPexels(phrase: string, shape: PlanShape = "16:9") {
  const query = phrase.trim();
  if (!query) return 0;
  const body = await readPage(query, shape, 1, 1);
  return body.total_results ?? 0;
}

export async function browsePexels(phrase: string, shape: PlanShape = "16:9", page = 1, perPage = 12) {
  const query = phrase.trim();
  const safePage = Math.min(500, Math.max(1, Math.floor(page) || 1));
  const safePerPage = Math.min(80, Math.max(4, Math.floor(perPage) || 12));
  if (!query) return { total: 0, page: safePage, perPage: safePerPage, clips: [] as BrowseClip[] };
  const body = await readPage(query, shape, safePage, safePerPage);
  const clips: BrowseClip[] = [];
  for (const video of body.videos ?? []) {
    const id = String(video.id ?? "");
    const file = pickFile(video, shape);
    if (!id || !file?.link) continue;
    clips.push({
      id,
      link: file.link,
      image: video.video_pictures?.find((picture) => picture.picture)?.picture,
      author: video.user?.name,
      sourcePage: video.url,
      duration: Math.max(1, Number(video.duration) || 8),
    });
  }
  return { total: body.total_results ?? clips.length, page: safePage, perPage: safePerPage, clips };
}

export async function browsePexelsSpread(phrase: string, pages = 4, perPage = 12, shape: PlanShape = "16:9") {
  const query = phrase.trim();
  const pageCount = Math.min(8, Math.max(1, Math.floor(pages) || 1));
  const safePerPage = Math.min(48, Math.max(4, Math.floor(perPage) || 12));
  if (!query) return { total: 0, page: 1, perPage: safePerPage, clips: [] as BrowseClip[] };
  const first = await browsePexels(query, shape, 1, safePerPage);
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      browsePexels(query, shape, index + 2, safePerPage).catch(() => null),
    ),
  );
  const clips: BrowseClip[] = [];
  const seen = new Set<string>();
  for (const found of [first, ...rest]) {
    if (!found) continue;
    for (const clip of found.clips) {
      if (seen.has(clip.id)) continue;
      seen.add(clip.id);
      clips.push(clip);
    }
  }
  return { total: first.total, page: 1, perPage: Math.min(48, pageCount * safePerPage), clips };
}

async function videoFiles(id: string) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Footage is unavailable right now.");
  const response = await fetch(`https://api.pexels.com/videos/videos/${id}`, {
    headers: { Authorization: key, "User-Agent": "content-engine" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("The preview could not be prepared.");
  const body = (await response.json()) as PexelsVideo;
  return (body.video_files ?? []).filter((file) => file.file_type === "video/mp4" && file.link && file.width && file.height);
}

function byArea(files: PexelsFile[], largest: boolean) {
  return [...files].sort((a, b) => {
    const area = ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0));
    return largest ? area : -area;
  })[0];
}

const proxyJobs = new Map<string, Promise<string>>();

export async function saveSmallProxy(id: string) {
  if (!/^\d+$/.test(id)) throw new Error("One of the clips could not be used.");
  const running = proxyJobs.get(id);
  if (running) return running;
  const task = (async () => {
    if (await previewReady(id)) return `/library/pexels/${id}-preview.mp4`;
    const file = byArea(await videoFiles(id), false);
    if (!file?.link || !pexelsFileLink(file.link)) throw new Error("The preview could not be prepared.");
    await mkdir(cacheDir, { recursive: true });
    const dest = path.join(cacheDir, `${id}-preview.mp4`);
    const partial = `${dest}.part.mp4`;
    try {
      await download(file.link, partial);
      await rename(partial, dest);
    } catch (error) {
      await unlink(partial).catch(() => undefined);
      throw error;
    }
    return `/library/pexels/${id}-preview.mp4`;
  })().finally(() => {
    proxyJobs.delete(id);
  });
  proxyJobs.set(id, task);
  return task;
}

export async function saveMaster(id: string) {
  if (!/^\d+$/.test(id)) throw new Error("One of the clips could not be used.");
  if (await cached(id)) return `/library/pexels/${id}.mp4`;
  const file = byArea(await videoFiles(id), true);
  if (!file?.link) throw new Error("One of the clips could not be used.");
  await ensureFile(id, file.link);
  return `/library/pexels/${id}.mp4`;
}

export async function preparePreview(file: string) {
  const id = /^\/library\/pexels\/(\d+)\.mp4$/.exec(file)?.[1];
  if (!id || !(await cached(id))) return;
  await ensurePreview(id);
}

export async function savePexelsClip(id: string, link: string) {
  if (!/^\d+$/.test(id) || !pexelsFileLink(link)) {
    throw new Error("A selected clip is not a Pexels file.");
  }
  await ensureFile(id, link);
  return `/library/pexels/${id}.mp4`;
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
