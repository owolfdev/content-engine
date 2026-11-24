"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { clipLabel, moveShot, removeShot, shotLength, trimShot } from "@/lib/edit-cut";
import type { Plan } from "@/lib/plan";

const minScale = 28;
const maxScale = 520;

function stamp(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remain = safe - minutes * 60;
  return `${minutes}:${remain.toFixed(1).padStart(4, "0")}`;
}

export function ClipStrip({
  plan,
  active,
  played,
  onSeek,
  onChange,
}: {
  plan: Plan;
  active: number;
  played: number;
  onSeek: (at: number) => void;
  onChange: (next: Plan, remember: boolean) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const planRef = useRef(plan);
  const fitted = useRef(false);
  planRef.current = plan;
  const [scale, setScale] = useState(80);
  const total = plan.clips.reduce((sum, clip) => sum + shotLength(clip), 0);
  const starts: number[] = [];
  let cursor = 0;
  for (const clip of plan.clips) {
    starts.push(cursor);
    cursor += shotLength(clip);
  }

  useEffect(() => {
    if (fitted.current) return;
    const width = scrollerRef.current?.clientWidth ?? 0;
    if (width < 40 || total <= 0) return;
    fitted.current = true;
    setScale(Math.min(180, Math.max(minScale, (width - 8) / total)));
  }, [total]);

  function zoomBy(factor: number) {
    setScale((current) => {
      const next = Math.min(maxScale, Math.max(minScale, current * factor));
      const node = scrollerRef.current;
      if (node && current > 0) {
        const midpoint = node.scrollLeft + node.clientWidth / 2;
        const time = midpoint / current;
        requestAnimationFrame(() => {
          node.scrollLeft = Math.max(0, time * next - node.clientWidth / 2);
        });
      }
      return next;
    });
  }

  function timeFromPointer(clientX: number) {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || scale <= 0) return 0;
    return Math.max(0, Math.min(total, (clientX - box.left) / scale));
  }

  function beginScrub(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    let moved = false;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // A click still moves the playhead.
    }
    const move = (pointer: PointerEvent) => {
      if (Math.abs(pointer.clientX - startX) < 4) return;
      moved = true;
      onSeek(timeFromPointer(pointer.clientX));
    };
    const end = (pointer: PointerEvent) => {
      if (handle.hasPointerCapture(pointer.pointerId)) handle.releasePointerCapture(pointer.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      if (!moved) onSeek(timeFromPointer(pointer.clientX));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
  }

  function beginReorder(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    let dragged = false;
    let over = index;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // The shot stays put if the drag cannot start.
    }
    const move = (pointer: PointerEvent) => {
      if (Math.abs(pointer.clientX - startX) < 18) return;
      dragged = true;
      const time = timeFromPointer(pointer.clientX);
      const current = planRef.current;
      let next = current.clips.length - 1;
      let at = 0;
      for (let cursorIndex = 0; cursorIndex < current.clips.length; cursorIndex += 1) {
        const span = shotLength(current.clips[cursorIndex]);
        if (time < at + span / 2) {
          next = cursorIndex;
          break;
        }
        at += span;
      }
      over = next;
    };
    const end = (pointer: PointerEvent) => {
      if (handle.hasPointerCapture(pointer.pointerId)) handle.releasePointerCapture(pointer.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      if (!dragged || over === index) return;
      const result = moveShot(planRef.current, index, over);
      if ("plan" in result) onChange(result.plan, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
  }

  function beginTrim(event: ReactPointerEvent<HTMLButtonElement>, index: number, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const originX = event.clientX;
    const snapshot = planRef.current;
    const px = scale;
    let remember = true;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // The edge still follows the pointer.
    }
    const move = (pointer: PointerEvent) => {
      const delta = (pointer.clientX - originX) / px;
      const result = trimShot(snapshot, index, edge, delta, "by");
      if ("plan" in result) {
        onChange(result.plan, remember);
        remember = false;
      }
    };
    const end = (pointer: PointerEvent) => {
      if (handle.hasPointerCapture(pointer.pointerId)) handle.releasePointerCapture(pointer.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-50" disabled={scale <= minScale + 0.5} onClick={() => zoomBy(0.5)}>
          Zoom out
        </button>
        <button type="button" className="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-50" disabled={scale >= maxScale - 0.5} onClick={() => zoomBy(2)}>
          Zoom in
        </button>
      </div>
      <div ref={scrollerRef} className="overflow-x-auto rounded border border-zinc-200">
        <div ref={trackRef} className="relative h-20" style={{ width: Math.max(1, total * scale) }}>
          {plan.clips.map((clip, index) => {
            const name = clipLabel(clip, index);
            const span = shotLength(clip);
            const picture = clip.image?.startsWith("https://") ? clip.image : "";
            return (
              <div
                key={`${clip.id}-${index}`}
                className={`absolute top-1 bottom-1 overflow-hidden rounded border ${index === active ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-300"}`}
                style={{ left: starts[index] * scale, width: Math.max(1, span * scale) }}
              >
                {picture ? <img src={picture} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-zinc-100" />}
                <button
                  type="button"
                  aria-label={`Start of ${name}`}
                  className="absolute top-0 bottom-0 left-0 z-10 w-2 cursor-ew-resize bg-white/80"
                  onPointerDown={(event) => beginTrim(event, index, "start")}
                />
                <button
                  type="button"
                  aria-label={name}
                  className="absolute top-0 right-2 bottom-5 left-2 z-10"
                  onPointerDown={beginScrub}
                />
                <button
                  type="button"
                  className="absolute right-2 bottom-0 left-2 z-10 h-5 cursor-grab truncate bg-black/55 px-1 text-left text-xs text-white active:cursor-grabbing"
                  onPointerDown={(event) => beginReorder(event, index)}
                >
                  {name} {stamp(span)}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  className="absolute top-0 right-3 z-20 px-1 text-sm text-white"
                  onClick={() => {
                    const result = removeShot(plan, index);
                    if ("plan" in result) onChange(result.plan, true);
                  }}
                >
                  ×
                </button>
                <button
                  type="button"
                  aria-label={`End of ${name}`}
                  className="absolute top-0 right-0 bottom-0 z-10 w-2 cursor-ew-resize bg-white/80"
                  onPointerDown={(event) => beginTrim(event, index, "end")}
                />
              </div>
            );
          })}
          <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-zinc-900" style={{ left: Math.max(0, Math.min(total, played)) * scale }} />
        </div>
      </div>
    </div>
  );
}
