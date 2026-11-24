import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChatClip, SelectedClip } from "@/lib/chat";
import { cutFromSelection, maxCutSeconds, selectionLimit } from "@/lib/chat-cut";
import { moveShot, removeShot, shotLength, trimShot, type TrimEdge, type TrimMode } from "@/lib/edit-cut";
import type { Plan } from "@/lib/plan";
import { browsePexels, countPexels } from "@/lib/sources/pexels";

export type CommandContext = {
  selection: SelectedClip[];
  latestQuery: string;
  cut: Plan | null;
};

export type Gallery = {
  query: string;
  total: number;
  clips: ChatClip[];
};

export type CommandEffect = {
  forModel: unknown;
  reply: string;
  browser: Gallery | null;
  preview: Plan | null;
  settings: boolean;
  clear: boolean;
  editing: boolean;
  replace: boolean;
};

type CommandArgs = Record<string, string | number>;

const commandNames = ["count_videos", "show_videos", "make_cut", "edit_cut", "project_settings", "clear_history", "commands"] as const;

type CommandName = (typeof commandNames)[number];

export const tools = [
  {
    type: "function",
    function: {
      name: "count_videos",
      description: "Count videos for a subject. Pass only the subject, never the guest's sentence.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Subject only, a few words, such as crows or pool at sunset." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_videos",
      description: "Open the gallery for a subject. Do not use this when the guest wants a video made from clips they already selected.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Subject only, a few words, such as wolves. Never a request, a length, or a whole sentence." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_cut",
      description: "Make a preview from the clips already selected. Call this when the guest asks for that video or says they cannot see it. The app writes the guest reply, so do not describe the preview yourself.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          seconds: { type: "number", description: "Requested length in seconds. Pass the number they asked for, including a length under one second." },
          title: { type: "string", description: "Short title burned into the preview." },
        },
        required: ["seconds"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_cut",
      description: "Open the editor on the video already on screen, or trim, move, or remove one shot in it. Do not use this to make a new video or to search.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["open", "trim", "move", "remove"], description: "open shows the editor. trim changes one shot. move reorders a shot. remove drops a shot." },
          clip: { type: "number", description: "Shot number, starting at 1 from the left." },
          edge: { type: "string", enum: ["start", "end", "length"], description: "Which part of the shot to change. length is how long it stays." },
          seconds: { type: "number", description: "Seconds to add, or the length to set. Negative makes a shot shorter." },
          mode: { type: "string", enum: ["by", "to"], description: "by adds the seconds. to sets the start, the end, or the length." },
          to: { type: "number", description: "For move, the destination shot number, starting at 1." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_settings",
      description: "Open the project settings panel. Use this when the guest wants to change the project, brand, logo, logo placement, fonts, or theme.",
      parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_history",
      description: "Clear the conversation. Use this only when the guest asks to clear, reset, or delete the chat history.",
      parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "commands",
      description: "Return the command list. Use this when the guest asks which commands exist, how to type one, or for help.",
      parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    },
  },
];

export function commandGuide() {
  return readFileSync(path.join(process.cwd(), "COMMANDS.md"), "utf8").trim();
}

function isCommand(name: string): name is CommandName {
  return (commandNames as readonly string[]).includes(name);
}

function namedValue(rest: string, key: string) {
  const match = rest.match(new RegExp(`(?:^|\\s)${key}=(?:"([^"]*)"|(\\S+))`, "i"));
  return match ? (match[1] ?? match[2] ?? "") : null;
}

function subjectQuery(value: string) {
  const query = value.trim().replace(/\s+/g, " ");
  const words = query.split(" ").filter(Boolean);
  if (!query || words.length > 5) return "";
  if (/^(yes|yeah|yep|ok|okay|sure|please)$/i.test(query)) return "";
  if (/\b(make|made|assemble|selected|selection|second|seconds|minute|render|download|cut|wait|wanted|above)\b/i.test(query)) return "";
  if (!/^[a-z0-9][a-z0-9 '&-]*$/i.test(query)) return "";
  return query;
}

export function parseDirect(text: string): { error: string } | { name: CommandName; args: CommandArgs } | null {
  const match = text.trim().match(/^([a-zA-Z][a-zA-Z0-9_]*)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (!isCommand(name)) return null;
  const rest = (match[2] ?? "").trim();
  if (name === "commands" || name === "project_settings" || name === "clear_history") {
    return rest ? { error: `${name} is typed on its own.` } : { name, args: {} };
  }
  if (name === "edit_cut") return parseEdit(rest);
  if (name === "count_videos" || name === "show_videos") {
    const query = (namedValue(rest, "query") ?? rest).trim().replace(/\s+/g, " ").slice(0, 80);
    return query ? { name, args: { query } } : { error: `${name} needs a subject. For example: ${name} wolves` };
  }
  if (!rest) return { error: "make_cut needs a length in seconds. For example: make_cut 12" };
  const typed = namedValue(rest, "seconds");
  const seconds = Number(typed ?? (/^\d+(?:\.\d+)?$/.test(rest) ? rest : Number.NaN));
  if (!Number.isFinite(seconds) || seconds <= 0) return { error: "make_cut needs a length in seconds. For example: make_cut 1" };
  return { name, args: { seconds, title: (namedValue(rest, "title") ?? "").slice(0, 80) } };
}

export async function runCommand(name: string, args: CommandArgs, context: CommandContext, source: "model" | "direct"): Promise<CommandEffect> {
  if (name === "commands") {
    const reply = commandGuide();
    return { forModel: { documentation: reply }, reply, browser: null, preview: null, settings: false, clear: false, editing: false, replace: false };
  }
  if (name === "project_settings") {
    return { forModel: { opened: true }, reply: "Here are the project settings.", browser: null, preview: null, settings: true, clear: false, editing: false, replace: false };
  }
  if (name === "clear_history") {
    return { forModel: { cleared: true }, reply: "", browser: null, preview: null, settings: false, clear: true, editing: false, replace: false };
  }
  if (name === "count_videos" || name === "show_videos") {
    const raw = typeof args.query === "string" ? args.query : "";
    const query = source === "model" ? subjectQuery(raw) : raw.trim();
    if (!query) {
      return {
        forModel: { error: "query must be a short subject, such as wolves. If the guest asked to make a video from selected clips, call make_cut instead." },
        reply: "That needs a short subject, such as wolves.",
        browser: null,
        preview: null,
        settings: false,
        clear: false,
        editing: false,
        replace: false,
      };
    }
    if (name === "count_videos") {
      const total = await countPexels(query);
      return {
        forModel: { query, total },
        reply: `There are ${total.toLocaleString("en-US")} videos about ${query}. Would you like to see them?`,
        browser: null,
        preview: null,
        settings: false,
        clear: false,
        editing: false,
        replace: false,
      };
    }
    const found = await browsePexels(query);
    return {
      forModel: { query, total: found.total, showing: found.clips.length },
      reply: `Here are some ${query} videos. Select the clips you want to use.`,
      browser: { query, total: found.total, clips: found.clips },
      preview: null,
      settings: false,
      clear: false,
      editing: false,
      replace: false,
    };
  }
  if (name === "make_cut") {
    const asked = Number(args.seconds);
    if (!Number.isFinite(asked) || asked <= 0) {
      return { forModel: { made: false, error: "Pass the length in seconds." }, reply: "A length in seconds is needed.", browser: null, preview: null, settings: false, clear: false, editing: false, replace: false };
    }
    if (!context.selection.length) {
      return {
        forModel: { made: false, error: "No clips are selected. Ask the guest to select clips in the gallery already on screen. Do not search." },
        reply: "Select a few clips first.",
        browser: null,
        preview: null,
        settings: false,
        clear: false,
        editing: false,
        replace: false,
      };
    }
    const seconds = Math.min(maxCutSeconds, Math.round(asked * 100) / 100);
    const title = typeof args.title === "string" ? args.title : "";
    const preview = await cutFromSelection(context.selection, seconds, title, context.latestQuery);
    const length = Number.isInteger(preview.duration) ? String(preview.duration) : preview.duration.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    const trimmed = context.selection.length > selectionLimit ? ` The first ${selectionLimit} selected clips are in it.` : "";
    const capped = asked > maxCutSeconds ? " Ten minutes is the longest video, so this one is ten minutes." : "";
    const reply = `Here is a ${length} second video from the selected clips.${trimmed}${capped}`;
    return { forModel: { made: true, seconds: preview.duration, clips: preview.clips.length, title: preview.title }, reply, browser: null, preview, settings: false, clear: false, editing: false, replace: false };
  }
  if (name === "edit_cut") return editCut(args, context.cut);
  return { forModel: { error: "That action is not available." }, reply: "That action is not available.", browser: null, preview: null, settings: false, clear: false, editing: false, replace: false };
}

const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

function ordinal(index: number) {
  return ordinals[index] ?? `clip ${index + 1}`;
}

function idle(reply: string, extra: { error?: string; preview?: Plan | null; editing?: boolean } = {}): CommandEffect {
  return {
    forModel: extra.error ? { error: extra.error } : { opened: true },
    reply,
    browser: null,
    preview: extra.preview ?? null,
    settings: false,
    clear: false,
    editing: extra.editing ?? true,
    replace: true,
  };
}

function numberArg(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseEdit(rest: string): { error: string } | { name: "edit_cut"; args: CommandArgs } {
  if (!rest) return { name: "edit_cut", args: { action: "open" } };
  const action = (namedValue(rest, "action") ?? rest.split(/\s+/)[0] ?? "").toLowerCase();
  if (action === "open") return { name: "edit_cut", args: { action: "open" } };
  if (action === "remove") {
    const clip = numberArg(namedValue(rest, "clip") ?? rest.match(/\d+/)?.[0]);
    return Number.isFinite(clip) ? { name: "edit_cut", args: { action, clip } } : { error: "edit_cut remove needs a clip number. For example: edit_cut remove clip=2" };
  }
  if (action === "move") {
    const clip = numberArg(namedValue(rest, "from") ?? namedValue(rest, "clip"));
    const to = numberArg(namedValue(rest, "to"));
    if (!Number.isFinite(clip) || !Number.isFinite(to)) return { error: "edit_cut move needs two places. For example: edit_cut move from=3 to=1" };
    return { name: "edit_cut", args: { action, clip, to } };
  }
  if (action === "trim") {
    const clip = numberArg(namedValue(rest, "clip"));
    const edge = (namedValue(rest, "edge") ?? "end").toLowerCase();
    const mode = (namedValue(rest, "mode") ?? (namedValue(rest, "to") ? "to" : "by")).toLowerCase();
    const seconds = numberArg(namedValue(rest, "seconds") ?? namedValue(rest, "by") ?? namedValue(rest, "to"));
    if (!Number.isFinite(clip) || !Number.isFinite(seconds)) return { error: "edit_cut trim needs a clip and a length. For example: edit_cut trim clip=2 edge=end by=-0.5" };
    return { name: "edit_cut", args: { action, clip, edge, mode, seconds } };
  }
  return { error: "edit_cut can open, trim, move, or remove. For example: edit_cut" };
}

function editCut(args: CommandArgs, cut: Plan | null): CommandEffect {
  const action = String(args.action ?? "open");
  if (!cut) {
    return idle("Make a video first.", { error: "No video is on screen. If the guest wants a new video from selected clips, call make_cut. Do not search.", editing: true });
  }
  if (action === "open") return idle("Here is the editor.");
  const index = Math.round(numberArg(args.clip ?? args.from)) - 1;
  if (action === "remove") {
    const result = removeShot(cut, index);
    if ("error" in result) return idle(result.error, { error: result.error });
    return { ...idle(`The ${ordinal(index)} clip is out.`, { preview: result.plan }), forModel: { removed: index + 1, clips: result.plan.clips.length } };
  }
  if (action === "move") {
    const to = Math.round(numberArg(args.to)) - 1;
    const result = moveShot(cut, index, to);
    if ("error" in result) return idle(result.error, { error: result.error });
    return { ...idle(`The ${ordinal(index)} clip is now ${to === 0 ? "first" : ordinal(to)}.`, { preview: result.plan }), forModel: { moved: index + 1, to: to + 1 } };
  }
  if (action === "trim") {
    const edge = String(args.edge ?? "end") as TrimEdge;
    const mode = String(args.mode ?? "by") as TrimMode;
    if (edge !== "start" && edge !== "end" && edge !== "length") return idle("That edit needs a start, an end, or a length.", { error: "edge must be start, end, or length." });
    if (mode !== "by" && mode !== "to") return idle("That edit needs a change in seconds.", { error: "mode must be by or to." });
    const before = cut.clips[index];
    const result = trimShot(cut, index, edge, numberArg(args.seconds), mode);
    if ("error" in result) return idle(result.error, { error: result.error });
    const after = result.plan.clips[index];
    if (!before || !after) return idle("That clip is not in the video.", { error: "That clip is not in the video." });
    const name = `The ${ordinal(index)} clip`;
    let reply = `${name} is updated.`;
    if (edge === "length") reply = `${name} is ${shotLength(after).toFixed(1).replace(/\.0$/, "")} seconds.`;
    else if (after.start > before.start + 0.01) reply = `${name} starts later.`;
    else if (after.start < before.start - 0.01) reply = `${name} starts earlier.`;
    else if (shotLength(after) < shotLength(before) - 0.01) reply = `${name} is shorter.`;
    else if (shotLength(after) > shotLength(before) + 0.01) reply = `${name} is longer.`;
    return { ...idle(reply, { preview: result.plan }), forModel: { trimmed: index + 1, seconds: shotLength(after) } };
  }
  return idle("The editor can open, trim, move, or remove a clip.", { error: "action must be open, trim, move, or remove." });
}
