"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatBrowser, ChatClip } from "@/lib/chat";

const sorts = [
  { id: "search", label: "Search order" },
  { id: "maker", label: "Maker, A to Z" },
  { id: "maker-desc", label: "Maker, Z to A" },
  { id: "shortest", label: "Shortest" },
  { id: "longest", label: "Longest" },
] as const;

type GallerySort = (typeof sorts)[number]["id"];

function makerName(clip: ChatClip) {
  return clip.author?.trim().toLocaleLowerCase() || "";
}

function sortedClips(clips: ChatClip[], sort: GallerySort) {
  if (sort === "search") return clips;
  return clips.slice().sort((a, b) => {
    if (sort === "shortest" || sort === "longest") {
      const delta = a.duration - b.duration;
      return sort === "shortest" ? delta : -delta;
    }
    const left = makerName(a);
    const right = makerName(b);
    if (!left && right) return 1;
    if (left && !right) return -1;
    const delta = left.localeCompare(right);
    return sort === "maker" ? delta : -delta;
  });
}

function lengthLabel(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function ChatBrowserView({
  message,
  onToggle,
  onPage,
}: {
  message: ChatBrowser;
  onToggle: (clip: ChatClip) => void;
  onPage: (query: string, page: number, perPage: number, clips: ChatClip[], total: number) => void;
}) {
  const page = message.page ?? 1;
  const perPage = message.perPage ?? 12;
  const pages = Math.max(1, Math.ceil(message.total / perPage));
  const [phrase, setPhrase] = useState(message.query);
  const [size, setSize] = useState(String(perPage));
  const [sort, setSort] = useState<GallerySort>("search");
  const clips = sortedClips(message.clips, sort);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);

  useEffect(() => {
    setSize(String(perPage));
  }, [perPage]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const selectedClips = message.selected.flatMap((id) => {
    const clip = (message.remembered ?? []).find((item) => item.id === id) ?? message.clips.find((item) => item.id === id);
    return clip ? [clip] : [];
  });

  async function load(nextPage: number, nextPerPage: number, nextQuery = message.query) {
    const query = nextQuery.trim();
    if (!query) {
      setNote("Add a search phrase.");
      return;
    }
    const id = ++request.current;
    setLoading(true);
    setNote(null);
    setPlayingKey(null);
    try {
      const response = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ query, page: nextPage, perPage: nextPerPage }),
      });
      const data = (await response.json()) as { error?: string; clips?: ChatClip[]; total?: number; page?: number; perPage?: number };
      if (request.current !== id) return;
      if (!response.ok || !data.clips) {
        setNote(data.error || "That page did not load.");
        return;
      }
      onPage(query, data.page ?? nextPage, data.perPage ?? nextPerPage, data.clips, typeof data.total === "number" ? data.total : message.total);
    } catch {
      if (request.current === id) setNote("That page did not load.");
    } finally {
      if (request.current === id) setLoading(false);
    }
  }

  function scheduleSearch(value: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const next = value.trim();
    if (!next || next === message.query) return;
    searchTimer.current = setTimeout(() => {
      void load(1, perPage, next);
    }, 450);
  }

  function applySize() {
    const next = Math.min(48, Math.max(4, Math.round(Number(size)) || perPage));
    setSize(String(next));
    if (next !== perPage) void load(1, next);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3">
      <input
        value={phrase}
        onChange={(event) => {
          setPhrase(event.target.value);
          scheduleSearch(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (searchTimer.current) clearTimeout(searchTimer.current);
          const next = phrase.trim();
          if (!next || next === message.query) return;
          void load(1, perPage, next);
        }}
        aria-label="Search"
        className="w-full rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-zinc-700">
          {loading ? "Searching…" : `${message.total.toLocaleString()} videos. ${message.selected.length} selected.`}
        </p>
        <label className="ml-auto flex items-center gap-2 text-sm text-zinc-600">
          Sort
          <select
            aria-label="Sort"
            className="rounded border border-zinc-300 bg-white px-2 py-1"
            value={sort}
            onChange={(event) => setSort(event.target.value as GallerySort)}
          >
            {sorts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {clips.map((clip) => (
          <ClipTile
            key={clip.id}
            clip={clip}
            selected={message.selected.includes(clip.id)}
            playing={playingKey === `grid:${clip.id}`}
            onToggle={() => onToggle(clip)}
            onPlay={() => setPlayingKey(`grid:${clip.id}`)}
            onStop={() => setPlayingKey((current) => (current === `grid:${clip.id}` ? null : current))}
          />
        ))}
      </ul>
      {message.clips.length === 0 ? <p className="text-sm text-zinc-500">No videos on this page.</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <button
          type="button"
          className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40"
          disabled={loading || page <= 1}
          onClick={() => void load(page - 1, perPage)}
        >
          Previous
        </button>
        <span>
          Page {page} of {pages.toLocaleString()}
        </span>
        <button
          type="button"
          className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40"
          disabled={loading || page >= pages}
          onClick={() => void load(page + 1, perPage)}
        >
          Next
        </button>
        <label className="ml-auto flex items-center gap-2">
          <input
            type="number"
            min={4}
            max={48}
            value={size}
            onChange={(event) => setSize(event.target.value)}
            onBlur={applySize}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applySize();
              }
            }}
            aria-label="Videos on each page"
            className="w-14 rounded border border-zinc-300 px-2 py-1"
          />
          on each page
        </label>
      </div>
      {selectedClips.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3">
          <p className="text-sm text-zinc-700">Selected</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {selectedClips.map((clip) => (
              <ClipTile
                key={clip.id}
                clip={clip}
                selected
                playing={playingKey === `picked:${clip.id}`}
                onToggle={() => onToggle(clip)}
                onPlay={() => setPlayingKey(`picked:${clip.id}`)}
                onStop={() => setPlayingKey((current) => (current === `picked:${clip.id}` ? null : current))}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {note ? <p className="text-sm text-zinc-500">{note}</p> : null}
    </div>
  );
}

function ClipTile({
  clip,
  selected,
  playing,
  onToggle,
  onPlay,
  onStop,
}: {
  clip: ChatClip;
  selected: boolean;
  playing: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onStop: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!playing) videoRef.current?.pause();
  }, [playing]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      onStop();
      return;
    }
    onPlay();
    try {
      await video.play();
    } catch {
      onStop();
    }
  }

  function toggleFullScreen() {
    const frame = frameRef.current;
    const video = videoRef.current;
    if (!frame || !video) return;
    if (document.fullscreenElement === frame) {
      void document.exitFullscreen();
      return;
    }
    if (!playing) {
      onPlay();
      void video.play().catch(() => onStop());
    }
    void frame.requestFullscreen();
  }

  return (
    <li className={`overflow-hidden rounded border ${selected ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200"}`}>
      <div ref={frameRef} className={full ? "relative flex h-full w-full items-center justify-center bg-black" : "relative"}>
        <button type="button" aria-pressed={selected} onClick={onToggle} className="block w-full">
          <video
            ref={videoRef}
            src={clip.link}
            poster={clip.image}
            preload="none"
            playsInline
            onEnded={onStop}
            className={playing ? (full ? "max-h-full max-w-full" : "aspect-video w-full object-cover") : "hidden"}
          />
          {playing ? null : clip.image ? (
            <img src={clip.image} alt="" className="aspect-video w-full object-cover" />
          ) : (
            <span className="block aspect-video w-full bg-zinc-100" />
          )}
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => void togglePlay()}
          className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-zinc-900"
        >
          {playing ? (
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-3 w-0.5 bg-zinc-900" />
              <span className="h-3 w-0.5 bg-zinc-900" />
            </span>
          ) : (
            <span className="ml-0.5 border-y-[5px] border-l-[8px] border-y-transparent border-l-zinc-900" aria-hidden />
          )}
        </button>
        <button
          type="button"
          aria-label={full ? "Leave full screen" : "Full screen"}
          onClick={() => void toggleFullScreen()}
          className="absolute right-2 bottom-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-zinc-900"
        >
          <span className="relative h-3 w-3" aria-hidden>
            <span className="absolute top-0 left-0 h-1.5 w-1.5 border-t border-l border-zinc-900" />
            <span className="absolute top-0 right-0 h-1.5 w-1.5 border-t border-r border-zinc-900" />
            <span className="absolute bottom-0 left-0 h-1.5 w-1.5 border-b border-l border-zinc-900" />
            <span className="absolute right-0 bottom-0 h-1.5 w-1.5 border-r border-b border-zinc-900" />
          </span>
        </button>
      </div>
      <p className="truncate px-2 py-1 text-xs text-zinc-600">
        {clip.author || "Contributor"} · {lengthLabel(clip.duration)}
      </p>
    </li>
  );
}
