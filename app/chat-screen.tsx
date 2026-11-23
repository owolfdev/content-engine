"use client";

import { useEffect, useRef, useState } from "react";
import { ChatBrowserView } from "@/app/chat-browser";
import { ChatPreviewView } from "@/app/chat-preview";
import type { ChatClip, ChatMessage, SelectedClip } from "@/lib/chat";
import type { Plan } from "@/lib/plan";

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
  if (previewAfterBrowser) return "Ask for a change, or render the file.";
  if (sawBrowser && browserSelected > 0) return "Ask for a short cut from the selected clips.";
  if (sawBrowser) return "Select clips, or ask for another search.";
  return "Say yes to see the videos.";
}

export function ChatScreen({ titleFont, bodyFont }: { titleFont: string; bodyFont: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
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
    const selection: SelectedClip[] = browser
      ? browser.selected.flatMap((id) => {
          const clip = (browser.remembered ?? []).find((item) => item.id === id) ?? browser.clips.find((item) => item.id === id);
          return clip ? [{ id: clip.id, link: clip.link, author: clip.author, sourcePage: clip.sourcePage, duration: clip.duration }] : [];
        })
      : [];
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          messages: history.filter((message) => message.kind === "text").map((message) => ({ role: message.role, text: message.text })),
          selection,
          latestQuery: browser?.query ?? "",
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        reply?: string;
        browser?: { query: string; total: number; clips: ChatClip[] };
        preview?: Plan;
      };
      const reply = data.reply || data.error || "The reply did not come back.";
      const added: ChatMessage[] = [{ id: crypto.randomUUID(), role: "assistant", kind: "text", text: reply }];
      if (response.ok && data.browser) {
        added.push({
          id: crypto.randomUUID(),
          role: "assistant",
          kind: "browser",
          query: data.browser.query,
          total: data.browser.total,
          clips: data.browser.clips,
          selected: [],
          page: 1,
          perPage: 12,
        });
      }
      if (response.ok && data.preview) {
        added.push({ id: crypto.randomUUID(), role: "assistant", kind: "preview", plan: data.preview });
      }
      setMessages((current) => [...current, ...added]);
    } catch {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", kind: "text", text: "The reply did not come back." },
      ]);
    } finally {
      setBusy(false);
    }
  }

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
                />
              );
            }
            return <ChatPreviewView key={message.id} plan={message.plan} titleFont={titleFont} bodyFont={bodyFont} />;
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
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy || !ready}
          placeholder="Ask about the footage"
          className="w-full rounded-full border border-zinc-300 px-4 py-3 text-sm outline-none"
        />
        <p className="text-xs text-zinc-400">{nextStep(messages)}</p>
      </form>
    </div>
  );
}
