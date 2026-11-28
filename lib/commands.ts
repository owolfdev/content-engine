import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChatClip, SelectedClip } from "@/lib/chat";
import { cutFromSelection, maxCutSeconds, selectionLimit } from "@/lib/chat-cut";
import { addShots, moveShot, removeShot, shotLength, trimShot, type TrimEdge, type TrimMode } from "@/lib/edit-cut";
import type { Plan } from "@/lib/plan";
import { browsePexels, countPexels } from "@/lib/sources/pexels";

export type CommandContext = {
  selection: SelectedClip[];
  clips: SelectedClip[];
  latestQuery: string;
  cut: Plan | null;
  request: string;
  priorRequest: string;
};

export type Gallery = {
  query: string;
  total: number;
  clips: ChatClip[];
  perPage?: number;
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
  picked?: string[];
};

type CommandArgs = Record<string, string | number>;

const commandNames = ["count_videos", "show_videos", "make_video", "make_cut", "edit_cut", "project_settings", "clear_history", "commands"] as const;

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
      name: "make_video",
      description: "Search a subject and preview four clips chosen from several pages when the guest asks for a video about that subject, such as \"make me a video about children on the beach\" or \"make me a 30 second clip about children on the beach\". Call this even when other clips are already selected. Also call this when they want only one maker's footage, or when they say they cannot see the video they just asked for about a subject. Do not use this when they want a video from the clips already selected and name no subject. The app writes the guest reply.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Subject only, a few words, such as children on the beach. Never the guest's whole sentence. When they only name a maker, pass the subject already on screen." },
          seconds: { type: "number", description: "Length of the whole video in seconds when they named one, including a word such as ten or thirty. Omit it when they did not name a length." },
          shot: { type: "number", description: "Maximum length of each shot in seconds, only when they set one, such as 2 for \"each shot should be only 2 seconds maximum\". This is not the length of the whole video. Omit it otherwise." },
          maker: { type: "string", description: "The maker's name, only when the guest wants the video limited to that person's footage. Omit it otherwise." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_cut",
      description: "Make a preview from the clips already selected, and only when the guest names no new subject. Do not use this when they say \"about\" a subject, such as children on the beach, even if clips are selected or they say they cannot see a video. Call make_video for that. Do not use this to keep only one maker. The app writes the guest reply, so do not describe the preview yourself.",
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
      description: "Open the editor on the video already on screen, or trim, move, remove, or add a shot. add puts selected clips that are not already in the video onto the end. Do not use this to make a new video or to search.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["open", "trim", "move", "remove", "add"], description: "open shows the editor. trim changes one shot. move reorders a shot. remove drops a shot. add appends selected clips that are not already in the video." },
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
  if (name === "make_video") return parseMakeVideo(rest);
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
        forModel: { error: "query must be a short subject, such as wolves. If the guest asked for a video about a subject, call make_video. If they asked for a video from selected clips, call make_cut." },
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
  if (name === "make_video") return makeVideo(args, source, context);
  if (name === "make_cut") {
    if (source === "model") {
      const subject = wantedSubject(context);
      if (subject) {
        const seconds = statedSeconds(context.request) ?? statedSeconds(context.priorRequest);
        const length = seconds ? ` and seconds ${seconds}` : "";
        return {
          forModel: { made: false, error: `The guest asked for a video about ${subject}. Call make_video with query "${subject}"${length}. Do not call make_cut.` },
          reply: `That should be a new video about ${subject}.`,
          browser: null, preview: null, settings: false, clear: false, editing: false, replace: false,
        };
      }
    }
    const asked = Number(args.seconds);
    if (!Number.isFinite(asked) || asked <= 0) {
      return { forModel: { made: false, error: "Pass the length in seconds." }, reply: "A length in seconds is needed.", browser: null, preview: null, settings: false, clear: false, editing: false, replace: false };
    }
    if (!context.selection.length) {
      return {
        forModel: { made: false, error: "No clips are selected. If the guest named a subject, call make_video with that subject. Otherwise ask them to select clips. Do not call count_videos." },
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
  if (name === "edit_cut") return editCut(args, context);
  return { forModel: { error: "That action is not available." }, reply: "That action is not available.", browser: null, preview: null, settings: false, clear: false, editing: false, replace: false };
}

const firstCutClips = 4;
const defaultCutSeconds = 15;
const searchPages = 4;
const searchPageSize = 12;

const numberWords: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};

const amountPattern = "(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)";

function amount(raw: string) {
  const value = numberWords[raw.toLowerCase()] ?? Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function statedSeconds(text: string) {
  const shot = statedShot(text);
  const pattern = new RegExp(`\\b${amountPattern}\\s*-?\\s*seconds?\\b`, "gi");
  for (const match of text.matchAll(pattern)) {
    const value = amount(match[1]);
    if (!value || (shot && Math.abs(value - shot) < 0.01)) continue;
    return value;
  }
  return null;
}

function statedShot(text: string) {
  const patterns = [
    new RegExp(`(?:each|every|per)\\s+(?:shot|clip)\\b[^.]{0,48}?${amountPattern}\\s*-?\\s*seconds?`, "i"),
    new RegExp(`${amountPattern}\\s*-?\\s*seconds?(?:\\s+maximum|\\s+max)?\\s+(?:per|each|a)\\s+(?:shot|clip)`, "i"),
    new RegExp(`(?:shot|clip)s?\\s+(?:of|at|under|to)\\s+${amountPattern}\\s*-?\\s*seconds?`, "i"),
    new RegExp(`no\\s+(?:shot|clip)\\s+(?:longer|more)\\s+than\\s+${amountPattern}`, "i"),
    new RegExp(`${amountPattern}\\s*-?\\s*second\\s+(?:shot|clip)s?\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match ? amount(match[1]) : null;
    if (value) return value;
  }
  return null;
}

export function subjectMention(text: string) {
  let found = "";
  for (const part of text.split(/\babout\s+/i).slice(1)) {
    const phrase = part
      .replace(/[?.!].*$/, "")
      .replace(/^(?:(?:a|an|the|my|some)\s+)+/i, "")
      .replace(/^(?:\d+(?:\.\d+)?\s*-?\s*seconds?\s+)?(?:clip|video|film|footage)\s+/i, "")
      .trim();
    const query = subjectQuery(phrase);
    if (query) found = query;
  }
  return found;
}

function missedVideo(text: string) {
  return /\b(?:do not|don't|dont|cannot|can't|cant|did not|didn't|didnt)\s+see\b|\bwhere is (?:it|that|the video)\b/i.test(text);
}

function wantedSubject(context: CommandContext) {
  const current = subjectMention(context.request);
  if (current) return current;
  if (missedVideo(context.request)) return subjectMention(context.priorRequest);
  return "";
}

function makerName(value: string) {
  const name = value.trim().replace(/\s+/g, " ").replace(/^["']|["']$/g, "");
  if (!name || name.length > 80 || name.split(" ").length > 6) return "";
  if (/\b(make|video|clip|clips|footage|only|just|using|from|about)\b/i.test(name)) return "";
  if (!/^[a-z0-9][a-z0-9 '&.,-]*$/i.test(name)) return "";
  return name;
}

function clipsByMaker(clips: SelectedClip[], maker: string) {
  const wanted = maker.trim().toLocaleLowerCase();
  const matches = clips.filter((clip) => {
    const author = clip.author?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";
    if (!author || wanted.length < 3) return false;
    return author === wanted || author.includes(wanted);
  });
  const exact = matches.filter((clip) => clip.author?.trim().toLocaleLowerCase() === wanted);
  return exact.length ? exact : matches;
}

function makerLabel(clips: SelectedClip[]) {
  const names = [...new Set(clips.map((clip) => clip.author?.trim()).filter((name): name is string => Boolean(name)))];
  if (names.length === 0) return "that maker";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function lengthLabel(seconds: number) {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function shotsNeeded(total: number, shot: number | null) {
  if (!shot) return firstCutClips;
  return Math.min(selectionLimit, Math.max(1, Math.ceil(total / shot)));
}

function chooseClips<T extends { duration: number }>(clips: T[], count: number, shot: number | null) {
  if (!shot) return pickRandom(clips, Math.min(count, clips.length));
  const long = clips.filter((clip) => clip.duration >= shot - 0.05);
  const short = clips.filter((clip) => clip.duration < shot - 0.05);
  const chosen = pickRandom(long, count);
  if (chosen.length < count) chosen.push(...pickRandom(short, count - chosen.length));
  return chosen;
}

function pickRandom<T>(items: T[], count: number) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const item = copy[index];
    copy[index] = copy[swap];
    copy[swap] = item;
  }
  return copy.slice(0, Math.max(0, count));
}

function parseMakeVideo(rest: string): { error: string } | { name: "make_video"; args: CommandArgs } {
  if (!rest) return { error: "make_video needs a subject. For example: make_video children on the beach" };
  const named = namedValue(rest, "query");
  const secondsNamed = namedValue(rest, "seconds");
  const makerNamed = namedValue(rest, "maker");
  const shotNamed = namedValue(rest, "shot");
  let query = named ?? rest;
  query = query.replace(/(?:^|\s)(?:maker|seconds|shot)=(?:"[^"]*"|\S+)/gi, " ");
  let seconds = secondsNamed ? Number(secondsNamed) : Number.NaN;
  if (!named && !secondsNamed) {
    const split = query.match(/^(.*\D)\s+(\d+(?:\.\d+)?)$/);
    if (split) {
      query = split[1];
      seconds = Number(split[2]);
    }
  }
  query = query.trim().replace(/\s+/g, " ").replace(/^["']|["']$/g, "").slice(0, 80);
  const maker = makerNamed?.trim().replace(/^["']|["']$/g, "").slice(0, 80) ?? "";
  const shot = shotNamed ? Number(shotNamed) : Number.NaN;
  if (!query && !maker) return { error: "make_video needs a subject. For example: make_video children on the beach" };
  const args: CommandArgs = {};
  if (query) args.query = query;
  if (maker) args.maker = maker;
  if (Number.isFinite(seconds) && seconds > 0) args.seconds = seconds;
  if (Number.isFinite(shot) && shot > 0) args.shot = shot;
  return { name: "make_video", args };
}

function shotNote(preview: Plan, shot: number | null) {
  if (!shot) return "";
  const spans = preview.clips.map((clip) => clip.end - clip.start);
  const longest = Math.max(...spans);
  if (longest > shot + 0.05) return "";
  const label = lengthLabel(shot);
  const even = spans.every((span) => Math.abs(span - shot) < 0.05);
  return even ? ` Each shot is ${label} seconds.` : ` No shot is longer than ${label} seconds.`;
}

function videoReply(preview: Plan, about: string, asked: number, extra: string) {
  const length = lengthLabel(preview.duration);
  const capped = asked > maxCutSeconds ? " Ten minutes is the longest video, so this one is ten minutes." : "";
  return `Here is a ${length} second video ${about}.${extra}${capped}`;
}

async function gatherFootage(query: string, needed: number, maker: string) {
  const clips: SelectedClip[] = [];
  const seen = new Set<string>();
  let total = 0;
  let fetchedPages = 0;
  const maxPages = 16;
  for (let page = 1; page <= maxPages; page += 4) {
    const count = Math.min(4, maxPages - page + 1);
    const batch = await Promise.all(
      Array.from({ length: count }, (_, index) => {
        const number = page + index;
        const request = browsePexels(query, "16:9", number, searchPageSize);
        return number === 1 ? request : request.catch(() => null);
      }),
    );
    let empty = false;
    for (const found of batch) {
      if (!found) continue;
      fetchedPages += 1;
      total = found.total || total;
      if (!found.clips.length) empty = true;
      for (const clip of found.clips) {
        if (seen.has(clip.id)) continue;
        seen.add(clip.id);
        clips.push({
          id: clip.id,
          link: clip.link,
          author: clip.author,
          sourcePage: clip.sourcePage,
          duration: clip.duration,
          image: clip.image,
        });
      }
    }
    const matched = maker ? clipsByMaker(clips, maker).length : clips.length;
    if ((fetchedPages >= searchPages && matched >= needed) || empty || (total > 0 && clips.length >= total)) break;
  }
  return {
    total,
    clips,
    perPage: Math.min(80, Math.max(searchPageSize, fetchedPages * searchPageSize)),
  };
}

async function makeVideo(args: CommandArgs, source: "model" | "direct", context: CommandContext): Promise<CommandEffect> {
  const raw = typeof args.query === "string" ? args.query : "";
  const query = source === "model" ? subjectQuery(raw) : raw.trim();
  const typedMaker = typeof args.maker === "string" ? args.maker : "";
  const maker = makerName(typedMaker);
  if (typedMaker.trim() && !maker) {
    return {
      forModel: { made: false, error: "maker must be a person's name, such as Kampus Production. Pass the subject separately as query." },
      reply: "Name the maker, such as Kampus Production.",
      browser: null, preview: null, settings: false, clear: false, editing: false, replace: false,
    };
  }
  const namedLength = args.seconds !== undefined;
  if (source === "model") {
    const stated = statedSeconds(context.request) ?? (missedVideo(context.request) ? statedSeconds(context.priorRequest) : null);
    if (stated && (!namedLength || Math.abs(Number(args.seconds) - stated) > 0.01)) {
      return {
        forModel: { made: false, error: `The guest asked for ${stated} seconds. Pass seconds: ${stated}.` },
        reply: "A length in seconds is needed.",
        browser: null, preview: null, settings: false, clear: false, editing: false, replace: false,
      };
    }
  }
  const namedShot = args.shot !== undefined;
  if (source === "model") {
    const stated = statedShot(context.request) ?? (missedVideo(context.request) ? statedShot(context.priorRequest) : null);
    if (stated && (!namedShot || Math.abs(Number(args.shot) - stated) > 0.01)) {
      return {
        forModel: { made: false, error: `The guest asked for shots of at most ${stated} seconds. Pass shot: ${stated}. Do not use that number as the video length.` },
        reply: "A length for each shot is needed.",
        browser: null, preview: null, settings: false, clear: false, editing: false, replace: false,
      };
    }
  }
  const shot = namedShot && Number(args.shot) > 0 ? Number(args.shot) : null;
  const sameSubject = !query || query.toLocaleLowerCase() === context.latestQuery.trim().toLocaleLowerCase();
  const asked = namedLength ? Number(args.seconds) : maker && sameSubject && context.cut ? context.cut.duration : defaultCutSeconds;
  if (!Number.isFinite(asked) || asked <= 0) {
    return { forModel: { made: false, error: "Pass the length in seconds, or omit it." }, reply: "A length in seconds is needed.", browser: null, preview: null, settings: false, clear: false, editing: false, replace: false };
  }
  if (!query && !maker) {
    return {
      forModel: { made: false, error: "query must be a short subject, such as children on the beach. If the guest asked for a video from selected clips, call make_cut." },
      reply: "That needs a short subject, such as children on the beach.",
      browser: null, preview: null, settings: false, clear: false, editing: false, replace: false,
    };
  }
  const needed = shotsNeeded(Math.min(asked, maxCutSeconds), shot);
  if (maker && sameSubject) {
    const pool = context.clips.length ? context.clips : context.selection;
    const matched = clipsByMaker(pool, maker);
    if (matched.length >= needed || !query) {
      if (!matched.length) {
        return {
          forModel: { made: false, maker, matches: 0 },
          reply: pool.length ? `None of these clips are from ${maker}.` : "Make a video first, then name the maker.",
          browser: null, preview: null, settings: false, clear: false, editing: false, replace: false,
        };
      }
      const chosen = chooseClips(matched, needed, shot);
      const preview = await cutFromSelection(chosen, asked, "", context.latestQuery || query, shot ?? 0);
      const label = makerLabel(chosen);
      const shortfall = matched.length < needed ? ` Only ${matched.length} of these clips ${matched.length === 1 ? "is" : "are"} theirs.` : "";
      return {
        forModel: { made: true, maker: label, seconds: preview.duration, clips: preview.clips.length, matches: matched.length, shot },
        reply: videoReply(preview, `from ${label}`, asked, `${shortfall}${shotNote(preview, shot)}`),
        browser: null,
        preview,
        settings: false,
        clear: false,
        editing: false,
        replace: false,
        picked: chosen.map((clip) => clip.id),
      };
    }
  }
  const found = await gatherFootage(query, needed, maker);
  if (!found.clips.length) {
    return {
      forModel: { made: false, query, total: found.total },
      reply: `Nothing came up for ${query}.`,
      browser: { query, total: found.total, clips: [], perPage: found.perPage },
      preview: null, settings: false, clear: false, editing: false, replace: false,
    };
  }
  const matched = maker ? clipsByMaker(found.clips, maker) : found.clips;
  if (maker && !matched.length) {
    return {
      forModel: { made: false, query, maker, matches: 0, total: found.total },
      reply: `Nothing from ${maker} came up for ${query}.`,
      browser: { query, total: found.total, clips: found.clips, perPage: found.perPage },
      preview: null, settings: false, clear: false, editing: false, replace: false,
    };
  }
  const chosen = chooseClips(matched, needed, shot);
  const preview = await cutFromSelection(chosen, asked, "", query, shot ?? 0);
  const about = maker ? `from ${makerLabel(chosen)}` : `about ${query}`;
  const shortfall = maker && matched.length < needed ? ` Only ${matched.length} of these clips ${matched.length === 1 ? "is" : "are"} theirs.` : "";
  return {
    forModel: { made: true, query, maker: maker || undefined, seconds: preview.duration, clips: preview.clips.length, shot, total: found.total, pool: found.clips.length },
    reply: videoReply(preview, about, asked, `${shortfall}${shotNote(preview, shot)}`),
    browser: { query, total: found.total, clips: found.clips, perPage: found.perPage },
    preview,
    settings: false,
    clear: false,
    editing: false,
    replace: false,
  };
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
  if (action === "add") return { name: "edit_cut", args: { action: "add" } };
  if (action === "trim") {
    const clip = numberArg(namedValue(rest, "clip"));
    const edge = (namedValue(rest, "edge") ?? "end").toLowerCase();
    const mode = (namedValue(rest, "mode") ?? (namedValue(rest, "to") ? "to" : "by")).toLowerCase();
    const seconds = numberArg(namedValue(rest, "seconds") ?? namedValue(rest, "by") ?? namedValue(rest, "to"));
    if (!Number.isFinite(clip) || !Number.isFinite(seconds)) return { error: "edit_cut trim needs a clip and a length. For example: edit_cut trim clip=2 edge=end by=-0.5" };
    return { name: "edit_cut", args: { action, clip, edge, mode, seconds } };
  }
  return { error: "edit_cut can open, trim, move, remove, or add. For example: edit_cut add" };
}

function editCut(args: CommandArgs, context: CommandContext): CommandEffect {
  const cut = context.cut;
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
  if (action === "add") {
    if (!context.selection.length) return idle("Select a few clips first.", { error: "No clips are selected. Ask the guest to select clips. Do not search." });
    const result = addShots(cut, context.selection);
    if ("error" in result) return idle(result.error, { error: result.error });
    const reply = result.added === 1 ? "Added 1 clip." : `Added ${result.added} clips.`;
    return { ...idle(reply, { preview: result.plan }), forModel: { added: result.added, clips: result.plan.clips.length, seconds: result.plan.duration } };
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
  return idle("The editor can open, trim, move, remove, or add a clip.", { error: "action must be open, trim, move, remove, or add." });
}
