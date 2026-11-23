import type { Plan } from "@/lib/plan";

export type ChatClip = {
  id: string;
  link: string;
  image?: string;
  author?: string;
  sourcePage?: string;
  duration: number;
};

export type SelectedClip = {
  id: string;
  link: string;
  author?: string;
  sourcePage?: string;
  duration: number;
};

export type ChatText = {
  id: string;
  role: "user" | "assistant";
  kind: "text";
  text: string;
};

export type ChatBrowser = {
  id: string;
  role: "assistant";
  kind: "browser";
  query: string;
  total: number;
  clips: ChatClip[];
  selected: string[];
  page?: number;
  perPage?: number;
  remembered?: ChatClip[];
};

export type ChatPreview = {
  id: string;
  role: "assistant";
  kind: "preview";
  plan: Plan;
};

export type ChatMessage = ChatText | ChatBrowser | ChatPreview;
