import { connection } from "next/server";
import type { SelectedClip } from "@/lib/chat";
import { parseDirect, runCommand, tools, type Gallery } from "@/lib/commands";
import { selectionLimit } from "@/lib/chat-cut";
import type { Plan, PlanClip } from "@/lib/plan";

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ModelMessage = {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

const instructions = `You are the Palm Shore editor helping a guest make a short video from the resort footage.

The guest normally writes in ordinary language. Read what they mean and call one command. The app runs only that command, with the arguments you pass. It does not turn their sentence into a search. After the command result, reply in one or two plain sentences.

If they ask which commands exist, how to type a command, or for help, call commands. The documentation in that result is the whole reply. Show it unchanged.

Otherwise interpret their intention:
- count_videos when they ask how many videos match a subject, or name a new subject. query is only the subject, a few words, such as crows. Then ask if they want to see them.
- show_videos when they ask to see footage, agree to look, or say the videos are not on screen. query is the subject. The gallery appears only because this command ran. Do not say the videos are on screen unless this command ran in this turn.
- make_cut when they ask to make a video from the clips already selected. seconds is the length they asked for, even when it is one second or less. Pass that number unchanged. The preview appears with that reply, so do not ask for permission again. If none are selected, ask them to select clips in the gallery already on screen. Do not open a new search.
- edit_cut when they want to edit the video already on screen, trim a shot, move a shot, or drop a shot. action is open when they only want the editor, such as "let's edit this". Shot numbers start at 1 from the left. For "a little shorter", trim the end by about half a second with mode by. For "hold it for three seconds", set edge length, mode to, and seconds 3. For "start it two seconds later", set edge start, mode by, and seconds 2. Do not make a new cut and do not search.
- project_settings when they ask to change the project, the brand, the logo, where the logo sits, the fonts, or the theme. The settings appear with that reply. Do not ask whether to open them, and do not turn that request into a footage search.
- clear_history when they ask to clear, reset, or delete the conversation. Do not search.

Do not mention commands, software, stock sites, servers, files, or how the app is built unless they asked to see the commands.
Do not offer to record a voiceover. The preview is silent.`;

function readMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const message = item as { role?: unknown; text?: unknown };
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string") return [];
    const text = message.text.trim().slice(0, 1000);
    if (!text) return [];
    return [{ role: message.role, content: text }];
  }).slice(-24);
}

function readSelection(value: unknown): SelectedClip[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const clip = item as { id?: unknown; link?: unknown; author?: unknown; sourcePage?: unknown; duration?: unknown; image?: unknown };
    if (typeof clip.id !== "string" || typeof clip.link !== "string") return [];
    return [{
      id: clip.id,
      link: clip.link,
      author: typeof clip.author === "string" ? clip.author : undefined,
      sourcePage: typeof clip.sourcePage === "string" ? clip.sourcePage : undefined,
      duration: Number(clip.duration) || 8,
      image: typeof clip.image === "string" && clip.image.startsWith("https://") ? clip.image.slice(0, 500) : undefined,
    }];
  }).slice(0, selectionLimit);
}

function argumentsOf(call: ToolCall) {
  try {
    const parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
    const args: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") args[key] = value.trim().slice(0, 80);
      else if (typeof value === "number" && Number.isFinite(value)) args[key] = value;
    }
    return args;
  } catch {
    return {};
  }
}

function readCut(value: unknown): Plan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Plan;
  if (!Array.isArray(plan.clips)) return null;
  const clips = plan.clips.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const clip = item as PlanClip;
    const start = Number(clip.start);
    const end = Number(clip.end);
    if (typeof clip.id !== "string" || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ ...clip, start, end }];
  });
  if (!clips.length) return null;
  return { ...plan, clips };
}

async function complete(key: string, model: string, messages: ModelMessage[]) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, temperature: 0.2 }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: { message?: ModelMessage }[];
  } | null;
  if (!response.ok) {
    throw new Error("The reply did not come back.");
  }
  const message = body?.choices?.[0]?.message;
  if (!message) throw new Error("The reply did not come back.");
  return message;
}

function guestMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return !timedOut && message && !/pexels|openai|api|key|env|server|model/i.test(message) ? message : "The reply did not come back.";
}

export async function POST(request: Request) {
  await connection();
  const key = process.env.OPENAI_API_KEY;

  let payload: { messages?: unknown; selection?: unknown; latestQuery?: unknown; cut?: unknown } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    payload = {};
  }
  const history = readMessages(payload.messages);
  if (!history.length || history.at(-1)?.role !== "user") {
    return Response.json({ error: "Write a message first." }, { status: 400 });
  }
  const selection = readSelection(payload.selection);
  const latestQuery = typeof payload.latestQuery === "string" ? payload.latestQuery.trim().slice(0, 80) : "";
  const cut = readCut(payload.cut);
  const context = [
    latestQuery
      ? `The browser on screen searched for "${latestQuery}". ${selection.length} clip${selection.length === 1 ? " is" : "s are"} selected.`
      : selection.length
        ? `${selection.length} clips are selected.`
        : "No browser is open and no clips are selected.",
    cut ? `A video is on screen with ${cut.clips.length} clips, lasting ${cut.duration} seconds.` : "No video is on screen yet.",
  ].join(" ");

  const commandContext = { selection, latestQuery, cut };
  const direct = parseDirect(history.at(-1)?.content ?? "");
  if (direct) {
    if ("error" in direct) return Response.json({ reply: direct.error, browser: null, preview: null });
    try {
      const effect = await runCommand(direct.name, direct.args, commandContext, "direct");
      return Response.json({ reply: effect.reply, browser: effect.browser, preview: effect.preview, settings: effect.settings, clear: effect.clear, editing: effect.editing, replace: effect.replace });
    } catch (error) {
      return Response.json({ error: guestMessage(error) }, { status: 502 });
    }
  }
  if (!key) {
    return Response.json({ error: "The assistant is unavailable right now." }, { status: 503 });
  }

  const messages: ModelMessage[] = [
    { role: "system", content: `${instructions}\n\n${context}` },
    ...history,
  ];
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  let browser: Gallery | null = null;
  let preview: Plan | null = null;
  let reply = "";
  let settings = false;
  let clear = false;
  let editing = false;
  let replace = false;

  try {
    for (let round = 0; round < 3; round += 1) {
      const message = await complete(key, model, messages);
      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        reply = message.content?.trim() || reply;
        break;
      }
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });
      let showGuide = false;
      let edited = false;
      for (const call of calls) {
        const effect = await runCommand(call.function.name, argumentsOf(call), commandContext, "model");
        if (effect.browser) browser = effect.browser;
        if (effect.preview) preview = effect.preview;
        if (effect.settings) {
          settings = true;
          reply = effect.reply;
        }
        if (effect.clear) {
          clear = true;
          reply = "";
        }
        if (effect.editing || effect.replace) {
          editing = effect.editing;
          replace = effect.replace;
          preview = effect.preview;
          reply = effect.reply;
          edited = true;
        }
        if (call.function.name === "commands") {
          reply = effect.reply;
          showGuide = true;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(effect.forModel) });
      }
      if (showGuide || settings || clear || edited) break;
    }
  } catch (error) {
    return Response.json({ error: guestMessage(error) }, { status: 502 });
  }

  return Response.json({
    reply: clear ? "" : reply || "Done.",
    browser,
    preview,
    settings,
    clear,
    editing,
    replace,
  });
}
