"use client";

import { useEffect, useRef, useState } from "react";
import { loadSession, saveSession } from "@/app/brand-session";
import { ChatBrowserView } from "@/app/chat-browser";
import { ChatPreviewView } from "@/app/chat-preview";
import { ProjectSettings } from "@/app/project-settings";
import type { ChatClip, ChatMessage, SelectedClip } from "@/lib/chat";
import { addShots } from "@/lib/edit-cut";
import type { Plan } from "@/lib/plan";
import { defaultSession, styleGuide, type StyleSession } from "@/lib/style";

const storageKey = "content-engine-chat";

function keepKnownSelection(message: ChatMessage): ChatMessage {
  if (message.kind !== "browser") return message;
  const known = new Set([...(message.remembered ?? []).map((clip) => clip.id), ...message.clips.map((clip) => clip.id)]);
  return { ...message, selected: message.selected.filter((id) => known.has(id)) };
}

function nextStep(messages: ChatMessage[]) {
  if (!messages.length) return "Ask what footage you have.";
  let browserSelected = 0;
  let sawBrowser = false;
  let previewAfterBrowser = false;
  for (const message of messages) {
    if (message.kind === "browser") {
      sawBrowser = true;
      browserSelected = message.selected.length;
      previewAfterBrowser = false;
    } else if (message.kind === "preview") {
      previewAfterBrowser = true;
    }
  }
  if (previewAfterBrowser) return "Ask for a change, edit the video, or download it.";
  if (sawBrowser && browserSelected > 0) return "Ask for a short cut from the selected clips.";
  if (sawBrowser) return "Select clips, or ask for another search.";
  return "Say yes to see the videos.";
}

export function ChatScreen({ titleFont, bodyFont }: { titleFont: string; bodyFont: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StyleSession | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasBusy = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed.map(keepKnownSelection));
      }
    } catch {
      setMessages([]);
    }
    setSession(loadSession());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, ready]);

  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastId, busy]);

  useEffect(() => {
    if (wasBusy.current && !busy) inputRef.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    document.title = session?.wordmark.trim() || "Video";
  }, [session]);

  function addToVideo(clips: SelectedClip[]) {
    const openCut = [...messages].reverse().find((message) => message.kind === "preview" && message.editing);
    const latestCut = [...messages].reverse().find((message) => message.kind === "preview");
    const cutMessage = openCut ?? latestCut;
    if (!cutMessage || cutMessage.kind !== "preview") return "Make a video first.";
    const result = addShots(cutMessage.plan, clips);
    if ("error" in result) return result.error;
    setMessages((current) =>
      current.map((message) => {
        if (message.kind !== "preview" || message.id !== cutMessage.id) return message;
        return { ...message, plan: result.plan, prior: message.plan, editing: true };
      }),
    );
    return result.added === 1 ? "Added 1 clip." : `Added ${result.added} clips.`;
  }

  function updateSession(next: StyleSession) {
    setSession(next);
    saveSession(next);
  }

  function clearHistory() {
    setMessages([]);
    setDraft("");
  }

  function toggleClip(messageId: string, clip: ChatClip) {
    setMessages((current) =>
      current.map((message) => {
        if (message.kind !== "browser" || message.id !== messageId) return message;
        const has = message.selected.includes(clip.id);
        const selected = has ? message.selected.filter((id) => id !== clip.id) : [...message.selected, clip.id];
        const remembered = (message.remembered ?? []).filter((item) => item.id !== clip.id);
        if (!has) remembered.push(clip);
        return { ...message, selected, remembered };
      }),
    );
  }

  function setEditing(messageId: string, editing: boolean) {
    setMessages((current) =>
      current.map((message) => (message.kind === "preview" && message.id === messageId ? { ...message, editing } : message)),
    );
  }

  function undoCut(messageId: string) {
    setMessages((current) =>
      current.map((message) => {
        if (message.kind !== "preview" || message.id !== messageId || !message.prior) return message;
        return { ...message, plan: message.prior, prior: undefined };
      }),
    );
  }

  function changeCut(messageId: string, next: Plan, remember: boolean) {
    setMessages((current) =>
      current.map((message) => {
        if (message.kind !== "preview" || message.id !== messageId) return message;
        return { ...message, plan: next, prior: remember ? message.plan : message.prior, editing: true };
      }),
    );
  }

  function showPage(messageId: string, query: string, page: number, perPage: number, clips: ChatClip[], total: number) {
    setMessages((current) =>
      current.map((message) => {
        if (message.kind !== "browser" || message.id !== messageId) return message;
        const remembered = [...(message.remembered ?? [])];
        for (const clip of message.clips) {
          if (message.selected.includes(clip.id) && !remembered.some((item) => item.id === clip.id)) remembered.push(clip);
        }
        return { ...message, query, page, perPage, clips, total, remembered };
      }),
    );
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const history = [...messages, { id: crypto.randomUUID(), role: "user" as const, kind: "text" as const, text }];
    setMessages(history);
    setDraft("");
    setBusy(true);
    const browser = [...history].reverse().find((message) => message.kind === "browser");
    const openCut = [...history].reverse().find((message) => message.kind === "preview" && message.editing);
    const latestCut = [...history].reverse().find((message) => message.kind === "preview");
    const cutMessage = openCut ?? latestCut;
    const cut = cutMessage?.kind === "preview" ? cutMessage.plan : null;
    const cutId = cutMessage?.id ?? "";
    const selection: SelectedClip[] = browser
      ? browser.selected.flatMap((id) => {
          const clip = (browser.remembered ?? []).find((item) => item.id === id) ?? browser.clips.find((item) => item.id === id);
          return clip ? [{ id: clip.id, link: clip.link, author: clip.author, sourcePage: clip.sourcePage, duration: clip.duration, image: clip.image }] : [];
        })
      : [];
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          messages: history.filter((message) => message.kind === "text").map((message) => ({ role: message.role, text: message.text })),
          selection,
          latestQuery: browser?.query ?? "",
          cut,
          wordmark: session?.wordmark ?? "",
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        reply?: string;
        browser?: { query: string; total: number; clips: ChatClip[] };
        preview?: Plan;
        settings?: boolean;
        clear?: boolean;
        editing?: boolean;
        replace?: boolean;
      };
      if (response.ok && data.clear) {
        clearHistory();
        return;
      }
      const reply = data.reply || data.error || "The reply did not come back.";
      const added: ChatMessage[] = [{ id: crypto.randomUUID(), role: "assistant", kind: "text", text: reply }];
      if (response.ok && data.browser) {
        const previous = [...history].reverse().find((message) => message.kind === "browser");
        added.push({
          id: crypto.randomUUID(),
          role: "assistant",
          kind: "browser",
          query: data.browser.query,
          total: data.browser.total,
          clips: data.browser.clips,
          selected: previous?.selected ?? [],
          remembered: previous?.remembered ?? [],
          page: 1,
          perPage: 12,
        });
      }
      if (response.ok && data.settings) {
        added.push({ id: crypto.randomUUID(), role: "assistant", kind: "settings" });
      }
      if (response.ok && data.preview && !data.replace) {
        added.push({ id: crypto.randomUUID(), role: "assistant", kind: "preview", plan: data.preview });
      }
      setMessages((current) => {
        const revised = data.replace
          ? current.map((message) => {
              if (message.kind !== "preview" || message.id !== cutId) return message;
              if (!data.preview) return { ...message, editing: true };
              return { ...message, editing: data.editing ?? true, prior: message.plan, plan: data.preview };
            })
          : current;
        return [...revised, ...added];
      });
    } catch {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", kind: "text", text: "The reply did not come back." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const openCut = [...messages].reverse().find((message) => message.kind === "preview" && message.editing);
  const latestCut = [...messages].reverse().find((message) => message.kind === "preview");
  const currentCut = openCut ?? latestCut;
  const videoIds = currentCut?.kind === "preview" ? currentCut.plan.clips.map((clip) => clip.id) : [];
  const brand = session ?? defaultSession(styleGuide);

  return (
    <div className="flex min-h-dvh flex-col bg-white text-zinc-900">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
          {messages.map((message) => {
            if (message.kind === "text") {
              return (
                <p key={message.id} className={`max-w-[40rem] whitespace-pre-wrap text-sm leading-6 ${message.role === "user" ? "self-end text-zinc-900" : "self-start text-zinc-700"}`}>
                  {message.text}
                </p>
              );
            }
            if (message.kind === "browser") {
              return (
                <ChatBrowserView
                  key={message.id}
                  message={message}
                  onToggle={(clip) => toggleClip(message.id, clip)}
                  onPage={(query, page, perPage, clips, total) => showPage(message.id, query, page, perPage, clips, total)}
                  hasVideo={currentCut?.kind === "preview"}
                  videoIds={videoIds}
                  onAdd={addToVideo}
                />
              );
            }
            if (message.kind === "settings") {
              return session ? <ProjectSettings key={message.id} session={session} onChange={updateSession} /> : null;
            }
            return (
              <ChatPreviewView
                key={message.id}
                plan={message.plan}
                editing={message.editing}
                canUndo={Boolean(message.prior)}
                titleFont={titleFont}
                bodyFont={bodyFont}
                session={brand}
                onEdit={(editing) => setEditing(message.id, editing)}
                onUndo={() => undoCut(message.id)}
                onChange={(next, remember) => changeCut(message.id, next, remember)}
              />
            );
          })}
          {busy ? <p className="text-sm text-zinc-500">Working…</p> : null}
          <div ref={endRef} />
        </div>
      </div>
      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-2 bg-white px-4 pt-3 pb-12"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy || !ready}
            placeholder="Ask about the footage"
            className="min-w-0 flex-1 rounded-full border border-zinc-300 px-4 py-3 text-sm outline-none"
          />
          <button
            type="button"
            className="shrink-0 rounded-full border border-zinc-300 px-4 py-3 text-sm disabled:opacity-50"
            disabled={busy || messages.length === 0}
            onClick={clearHistory}
          >
            Clear
          </button>
        </div>
        <p className="text-xs text-zinc-400">{nextStep(messages)}</p>
      </form>
    </div>
  );
}
