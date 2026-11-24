import { connection } from "next/server";
import type { SelectedClip } from "@/lib/chat";
import { parseDirect, runCommand, tools, type Gallery } from "@/lib/commands";
import type { Plan } from "@/lib/plan";

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
- make_cut when they ask to make a video from the clips already selected. seconds is the length they asked for. If they ask for fewer than 8 seconds, pass 8 and say the shortest cut is 8 seconds. If they ask for more than 30, pass 30 and say so. The preview appears with that reply, so do not ask for permission again. If none are selected, ask them to select clips in the gallery already on screen. Do not open a new search.
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
    const clip = item as { id?: unknown; link?: unknown; author?: unknown; sourcePage?: unknown; duration?: unknown };
    if (typeof clip.id !== "string" || typeof clip.link !== "string") return [];
    return [{
      id: clip.id,
      link: clip.link,
      author: typeof clip.author === "string" ? clip.author : undefined,
      sourcePage: typeof clip.sourcePage === "string" ? clip.sourcePage : undefined,
      duration: Number(clip.duration) || 8,
    }];
  }).slice(0, 6);
}

function argumentsOf(call: ToolCall) {
  try {
    const parsed = JSON.parse(call.function.arguments) as { query?: unknown; seconds?: unknown; title?: unknown };
    return {
      query: typeof parsed.query === "string" ? parsed.query.trim().slice(0, 80) : "",
      seconds: Number(parsed.seconds),
      title: typeof parsed.title === "string" ? parsed.title.trim().slice(0, 80) : "",
    };
  } catch {
    return { query: "", seconds: Number.NaN, title: "" };
  }
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

  let payload: { messages?: unknown; selection?: unknown; latestQuery?: unknown } = {};
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
  const context = latestQuery
    ? `The browser on screen searched for "${latestQuery}". ${selection.length} clip${selection.length === 1 ? " is" : "s are"} selected.`
    : selection.length
      ? `${selection.length} clips are selected.`
      : "No browser is open and no clips are selected.";

  const commandContext = { selection, latestQuery };
  const direct = parseDirect(history.at(-1)?.content ?? "");
  if (direct) {
    if ("error" in direct) return Response.json({ reply: direct.error, browser: null, preview: null });
    try {
      const effect = await runCommand(direct.name, direct.args, commandContext, "direct");
      return Response.json({ reply: effect.reply, browser: effect.browser, preview: effect.preview, settings: effect.settings, clear: effect.clear });
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
      for (const call of calls) {
        const args = argumentsOf(call);
        const effect = await runCommand(call.function.name, { query: args.query, seconds: args.seconds, title: args.title }, commandContext, "model");
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
        if (call.function.name === "commands") {
          reply = effect.reply;
          showGuide = true;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(effect.forModel) });
      }
      if (showGuide || settings || clear) break;
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
  });
}
