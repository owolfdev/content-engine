import { planFromShots, planRequest, readRequest, type FootageSource } from "@/lib/plan";
import { searchPexels } from "@/lib/sources/pexels";

function clipCount(duration: number) {
  if (duration < 16) return 2;
  if (duration < 28) return 3;
  return 4;
}

export async function POST(request: Request) {
  let sentence = "";
  let source: FootageSource = "library";
  try {
    const body = await request.json();
    sentence = typeof body.request === "string" ? body.request.trim() : "";
    source = body.source === "pexels" ? "pexels" : "library";
  } catch {
    sentence = "";
  }
  if (!sentence) {
    return Response.json({ error: "Type a request first." }, { status: 400 });
  }
  if (source === "library") {
    return Response.json(planRequest(sentence));
  }

  const reading = readRequest(sentence);
  if (!reading.phrase) {
    return Response.json({
      ...planFromShots(reading, [], [], "pexels"),
      title: "",
      spokenLine: "",
      needsModel: true,
      notes: ["This sentence has no picture to search for."],
    });
  }
  if (reading.language === null) {
    return Response.json({
      ...planFromShots(reading, [], ["That language is not available yet. English is the only one set up."], "pexels"),
      title: "",
      spokenLine: "",
    });
  }

  try {
    const shots = await searchPexels(reading, clipCount(reading.duration));
    const orientation = reading.shape === "9:16" ? "portrait" : reading.shape === "1:1" ? "square" : "landscape";
    const notes = [
      `Pexels search for “${reading.phrase}”, ${orientation}, ${reading.duration} seconds. The words are the ones in the request.`,
      "The player cover-crops the original file. It is cached here for this demo, not saved as a master.",
    ];
    if (!shots.length) {
      notes.push("Pexels returned no playable clips.");
    }
    const credited = shots
      .map((shot) => shot.author)
      .filter((author, index, all) => author && all.indexOf(author) === index);
    if (credited.length) notes.push(`Pexels License. ${credited.join(", ")}.`);
    return Response.json(planFromShots(reading, shots, notes, "pexels"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pexels search failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
