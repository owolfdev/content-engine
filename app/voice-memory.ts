const saved = new Map<string, { url: string; seconds: number }>();
const pending = new Map<string, Promise<{ url: string; seconds: number }>>();

export function savedVoice(text: string) {
  return saved.get(text.trim()) ?? null;
}

function measure(url: string) {
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.src = url;
  return new Promise<number>((resolve, reject) => {
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => reject(new Error("The voice recording could not be read."));
  });
}

export function loadVoice(text: string) {
  const line = text.trim();
  const existing = saved.get(line);
  if (existing) return Promise.resolve(existing);
  const inflight = pending.get(line);
  if (inflight) return inflight;
  const task = (async () => {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: line }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "Voice is unavailable.");
    }
    const url = URL.createObjectURL(await response.blob());
    const record = { url, seconds: await measure(url) };
    saved.set(line, record);
    return record;
  })().finally(() => {
    pending.delete(line);
  });
  pending.set(line, task);
  return task;
}
