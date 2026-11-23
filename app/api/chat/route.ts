import { connection } from "next/server";
import type { ChatClip, SelectedClip } from "@/lib/chat";
import { cutFromSelection } from "@/lib/chat-cut";
import type { Plan } from "@/lib/plan";
import { browsePexels, countPexels } from "@/lib/sources/pexels";

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

const instructions = `You are the editor for a private resort video tool called Palm Shore. The searchable footage is Pexels stock, used as the stand-in library.

Call a tool before you state a count, show footage, or assemble a cut. Then reply in one or two plain sentences. Do not mention tools, JSON, or components.

Rules:
- count_videos before you say how many videos match. Repeat the subject in that reply, and ask if they want to see them.
- show_videos only after they agree to look, or if they asked to see the footage in the same message. The browser appears with that reply, so do not ask whether to show it.
- make_cut uses the clips already selected in the browser. If none are selected, ask them to select some. Do not invent a selection. The preview appears with that reply, so do not ask whether to preview it.
- A cut is 8 to 30 seconds. If they ask for longer, say so and make 30 seconds.
- Do not offer to record a voiceover. The preview is silent.
- Use the latest search phrase when they say yes, sure, or show me.`;

const tools = [
  {
    type: "function",
    function: {
      name: "count_videos",
      description: "Count videos that match a short search phrase.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Search phrase, such as beach or pool at sunset." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_videos",
      description: "Show a browser of videos for a search phrase.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_cut",
      description: "Assemble a short preview from the clips the user selected.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          seconds: { type: "number", description: "Length from 8 to 30 seconds." },
          title: { type: "string", description: "Short title burned into the preview." },
        },
        required: ["seconds"],
      },
    },
  },
];

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
  });
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: { message?: ModelMessage }[];
  } | null;
  if (!response.ok) {
    throw new Error(body?.error?.message || "The model could not reply.");
  }
  const message = body?.choices?.[0]?.message;
  if (!message) throw new Error("The model could not reply.");
  return message;
}

export async function POST(request: Request) {
  await connection();
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json({ error: "Add OPENAI_API_KEY to .env.local and restart the dev server." }, { status: 503 });
  }

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

  const messages: ModelMessage[] = [
    { role: "system", content: `${instructions}\n\n${context}` },
    ...history,
  ];
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  let browser: { query: string; total: number; clips: ChatClip[] } | null = null;
  let preview: Plan | null = null;
  let reply = "";

  try {
    for (let round = 0; round < 3; round += 1) {
      const message = await complete(key, model, messages);
      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        reply = message.content?.trim() || reply;
        break;
      }
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });
      for (const call of calls) {
        const args = argumentsOf(call);
        let forModel: unknown = { error: "That action is not available." };
        if (call.function.name === "count_videos") {
          const total = args.query ? await countPexels(args.query) : 0;
          forModel = args.query ? { query: args.query, total } : { error: "A search phrase is required." };
        } else if (call.function.name === "show_videos") {
          if (!args.query) {
            forModel = { error: "A search phrase is required." };
          } else {
            const found = await browsePexels(args.query);
            browser = { query: args.query, total: found.total, clips: found.clips };
            forModel = { query: args.query, total: found.total, showing: found.clips.length };
          }
        } else if (call.function.name === "make_cut") {
          if (!selection.length) {
            forModel = { made: false, error: "No clips are selected." };
          } else {
            const seconds = Math.min(30, Math.max(8, Math.round(args.seconds) || 12));
            preview = await cutFromSelection(selection, seconds, args.title, latestQuery);
            const shortened = Number.isFinite(args.seconds) && args.seconds > 30;
            forModel = {
              made: true,
              seconds: preview.duration,
              clips: preview.clips.length,
              title: preview.title,
              note: shortened ? "The request was longer than 30 seconds, so the cut is 30 seconds." : "",
            };
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(forModel) });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model could not reply.";
    return Response.json({ error: message }, { status: 502 });
  }

  return Response.json({
    reply: reply || "Done.",
    browser,
    preview,
  });
}
