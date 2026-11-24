import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChatClip, SelectedClip } from "@/lib/chat";
import { cutFromSelection } from "@/lib/chat-cut";
import type { Plan } from "@/lib/plan";
import { browsePexels, countPexels } from "@/lib/sources/pexels";

export type CommandContext = {
  selection: SelectedClip[];
  latestQuery: string;
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
};

type CommandArgs = Record<string, string | number>;

const commandNames = ["count_videos", "show_videos", "make_cut", "commands"] as const;

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
      description: "Make a preview from the clips already selected. Use this when the guest asks for a video from that selection.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          seconds: { type: "number", description: "Requested length. The app keeps it between 8 and 30." },
          title: { type: "string", description: "Short title burned into the preview." },
        },
        required: ["seconds"],
      },
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
  if (name === "commands") {
    return rest ? { error: "commands is typed on its own." } : { name, args: {} };
  }
  if (name === "count_videos" || name === "show_videos") {
    const query = (namedValue(rest, "query") ?? rest).trim().replace(/\s+/g, " ").slice(0, 80);
    return query ? { name, args: { query } } : { error: `${name} needs a subject. For example: ${name} wolves` };
  }
  if (!rest) return { error: "make_cut needs a length from 8 to 30. For example: make_cut 12" };
  const typed = namedValue(rest, "seconds");
  const seconds = Number(typed ?? (/^\d+(?:\.\d+)?$/.test(rest) ? rest : Number.NaN));
  if (!Number.isFinite(seconds)) return { error: "make_cut needs a length from 8 to 30. For example: make_cut 12" };
  return { name, args: { seconds, title: (namedValue(rest, "title") ?? "").slice(0, 80) } };
}

export async function runCommand(name: string, args: CommandArgs, context: CommandContext, source: "model" | "direct"): Promise<CommandEffect> {
  if (name === "commands") {
    const reply = commandGuide();
    return { forModel: { documentation: reply }, reply, browser: null, preview: null };
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
      };
    }
    if (name === "count_videos") {
      const total = await countPexels(query);
      return {
        forModel: { query, total },
        reply: `There are ${total.toLocaleString("en-US")} videos about ${query}. Would you like to see them?`,
        browser: null,
        preview: null,
      };
    }
    const found = await browsePexels(query);
    return {
      forModel: { query, total: found.total, showing: found.clips.length },
      reply: `Here are some ${query} videos. Select the clips you want to use.`,
      browser: { query, total: found.total, clips: found.clips },
      preview: null,
    };
  }
  if (name === "make_cut") {
    const asked = Number(args.seconds);
    if (!Number.isFinite(asked)) {
      return { forModel: { made: false, error: "Pass the length in seconds." }, reply: "A length is needed, from 8 to 30 seconds.", browser: null, preview: null };
    }
    if (!context.selection.length) {
      return {
        forModel: { made: false, error: "No clips are selected. Ask the guest to select clips in the gallery already on screen. Do not search." },
        reply: "Select a few clips first.",
        browser: null,
        preview: null,
      };
    }
    const seconds = Math.min(30, Math.max(8, Math.round(asked)));
    const title = typeof args.title === "string" ? args.title : "";
    const preview = await cutFromSelection(context.selection, seconds, title, context.latestQuery);
    const note = asked < 8 ? "The shortest cut is 8 seconds, so this cut is 8 seconds." : asked > 30 ? "The request was longer than 30 seconds, so the cut is 30 seconds." : "";
    const reply = asked < 8
      ? "The shortest video is 8 seconds. Here it is, made from the selected clips."
      : asked > 30
        ? "The longest video is 30 seconds. Here it is, made from the selected clips."
        : `Here is a ${preview.duration} second video from the selected clips.`;
    return { forModel: { made: true, seconds: preview.duration, clips: preview.clips.length, title: preview.title, note }, reply, browser: null, preview };
  }
  return { forModel: { error: "That action is not available." }, reply: "That action is not available.", browser: null, preview: null };
}
