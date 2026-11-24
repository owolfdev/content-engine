"use client";

import { defaultSession, logoPlaces, styleGuide, type StyleSession } from "@/lib/style";

const storageKey = "content-engine-style";

export function loadSession(): StyleSession {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return defaultSession(styleGuide);
    const session = { ...defaultSession(styleGuide), ...JSON.parse(saved) } as StyleSession;
    if (!logoPlaces.includes(session.logoPlace)) session.logoPlace = "top-left";
    return session;
  } catch {
    return defaultSession(styleGuide);
  }
}

export function saveSession(session: StyleSession) {
  localStorage.setItem(storageKey, JSON.stringify(session));
}

export function brandLogo(session: StyleSession) {
  return session.logo || "";
}

export function brandName(session: StyleSession) {
  return session.wordmark.trim();
}
