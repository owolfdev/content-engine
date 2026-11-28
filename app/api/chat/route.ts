import { connection } from "next/server";
import type { SelectedClip } from "@/lib/chat";
import { parseDirect, runCommand, subjectMention, tools, type Gallery } from "@/lib/commands";
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

const instructions = `You are the editor helping a guest make a short video from the footage.

The guest normally writes in ordinary language. Read what they mean and call one command. The app runs only that command, with the arguments you pass. It does not turn their sentence into a search. After the command result, reply in one or two plain sentences.

If they ask which commands exist, how to type a command, or for help, call commands. The documentation in that result is the whole reply. Show it unchanged.

Otherwise interpret their intention:
- count_videos when they ask how many videos match a subject. query is only the subject, a few words, such as crows. Then ask if they want to see them. Do not use this when they asked you to make a video.
- show_videos when they ask to see footage, agree to look, or say the videos are not on screen. query is the subject. The gallery appears only because this command ran. Do not say the videos are on screen unless this command ran in this turn.
- make_video when they ask for a video about a subject, even if other clips are already selected. "make me a 30 second clip about children on the beach" is make_video, not make_cut. query is only the subject. Pass seconds whenever they named a length, including a word such as ten or thirty. Pass shot when they limit each shot, such as "each shot should be only 2 seconds maximum": shot is 2, and it is not the length of the whole video. The app searches and chooses enough clips for that shot length. Also call make_video when they want only one maker's footage, such as "use footage from Kindel Media only". Then pass maker as that name. If they say they cannot see a video they asked for about a subject, call make_video again with that subject, length, and shot limit. Do not call count_videos, show_videos, or make_cut for that. Do not ask permission.
- make_cut when they ask for a video from the clips already selected and do not name a new subject. seconds is the length they asked for, even when it is one second or less. Pass that number unchanged. The app writes the reply and shows the preview. Do not describe the preview yourself, and do not ask for permission. Do not open a new search. Do not use make_cut to keep only one maker, and do not use it when they said "about" a subject.
- edit_cut when they want to edit the video already on screen, trim a shot, move a shot, drop a shot, or add selected clips to that video. action is open when they only want the editor, such as "let's edit this". action is add when they want the selected clips on the current video. Shot numbers start at 1 from the left. For "a little shorter", trim the end by about half a second with mode by. For "hold it for three seconds", set edge length, mode to, and seconds 3. For "start it two seconds later", set edge start, mode by, and seconds 2. Do not make a new cut and do not search.
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

function makerSummary(clips: SelectedClip[]) {
  const counts = new Map<string, number>();
  for (const clip of clips) {
    const name = clip.author?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 24)
    .map(([name, count]) => `${name} (${count})`)
    .join(", ");
}

function readSelection(value: unknown, limit = selectionLimit): SelectedClip[] {
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
  }).slice(0, limit);
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

function narratesCut(text: string) {
  return /preview is ready|preview it now|made a |made the |i made |now ready|video is ready|ready for you to watch|ready for preview|here is a .+ video/i.test(text);
}

function guestMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return !timedOut && message && !/pexels|openai|api|key|env|server|model/i.test(message) ? message : "The reply did not come back.";
}

export async function POST(request: Request) {
  await connection();
  const key = process.env.OPENAI_API_KEY;

  let payload: { messages?: unknown; selection?: unknown; clips?: unknown; latestQuery?: unknown; cut?: unknown; wordmark?: unknown } = {};
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
  const clips = readSelection(payload.clips, 80);
  const latestQuery = typeof payload.latestQuery === "string" ? payload.latestQuery.trim().slice(0, 80) : "";
  const cut = readCut(payload.cut);
  const wordmark = typeof payload.wordmark === "string" ? payload.wordmark.trim().slice(0, 80) : "";
  const makers = makerSummary(clips.length ? clips : selection);
  const context = [
    wordmark ? `The property is called "${wordmark}". Use that name.` : "No property name is set. Do not invent one.",
    latestQuery
      ? `The browser on screen searched for "${latestQuery}". ${selection.length} clip${selection.length === 1 ? " is" : "s are"} selected.`
      : selection.length
        ? `${selection.length} clips are selected.`
        : "No browser is open and no clips are selected.",
    makers ? `Makers on screen: ${makers}.` : "",
    cut ? `A video is on screen with ${cut.clips.length} clips, lasting ${cut.duration} seconds.` : "No video is on screen yet.",
  ].filter(Boolean).join(" ");

  const userTurns = history.filter((message) => message.role === "user");
  const commandContext = {
    selection,
    clips,
    latestQuery,
    cut,
    request: userTurns.at(-1)?.content ?? "",
    priorRequest: userTurns.at(-2)?.content ?? "",
  };
  const direct = parseDirect(history.at(-1)?.content ?? "");
  if (direct) {
    if ("error" in direct) return Response.json({ reply: direct.error, browser: null, preview: null });
    try {
      const effect = await runCommand(direct.name, direct.args, commandContext, "direct");
      return Response.json({ reply: effect.reply, browser: effect.browser, preview: effect.preview, settings: effect.settings, clear: effect.clear, editing: effect.editing, replace: effect.replace, picked: effect.picked ?? null });
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
  let picked: string[] | null = null;

  try {
    let acted = false;
    for (let round = 0; round < 3; round += 1) {
      const message = await complete(key, model, messages);
      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        const text = message.content?.trim() ?? "";
        if (!acted && narratesCut(text) && round < 1) {
          const subject = subjectMention(commandContext.request) || subjectMention(commandContext.priorRequest);
          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "system",
            content: subject
              ? `No video was made. Call make_video with query "${subject}". Pass the length they named. Do not call make_cut, and do not describe the video.`
              : selection.length
                ? `${selection.length} clips are selected. Call make_cut with the length they asked for. The app writes the reply and shows the preview.`
                : "No clips are selected. If they asked for a video about a subject, call make_video with that subject. If they meant selected clips, there are none. Do not say a preview is ready.",
          });
          continue;
        }
        reply = text || reply;
        break;
      }
      acted = true;
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });
      let showGuide = false;
      let edited = false;
      let made = false;
      for (const call of calls) {
        const effect = await runCommand(call.function.name, argumentsOf(call), commandContext, "model");
        if (effect.browser) browser = effect.browser;
        if (effect.preview) preview = effect.preview;
        if (effect.picked) picked = effect.picked;
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
        if (call.function.name === "make_cut" || call.function.name === "make_video") {
          const outcome = effect.forModel as { made?: boolean; error?: string };
          const needsLength = call.function.name === "make_cut" && outcome.made === false && outcome.error === "Pass the length in seconds.";
          const needsVideo = call.function.name === "make_cut" && outcome.made === false && typeof outcome.error === "string" && outcome.error.startsWith("The guest asked for a video about");
          const needsSubject = outcome.made === false && Boolean(outcome.error);
          if (!needsLength && !needsVideo && !(call.function.name === "make_video" && needsSubject)) {
            reply = effect.reply;
            preview = effect.preview;
            made = true;
          }
        }
        if (call.function.name === "commands") {
          reply = effect.reply;
          showGuide = true;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(effect.forModel) });
      }
      if (showGuide || settings || clear || edited || made) break;
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
    picked,
  });
}
