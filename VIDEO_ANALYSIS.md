# Video analysis spec

Prepares footage so the content engine can cut it. The output is not a label dump. It is a set of timed ranges the planner can choose: long enough for a line of voiceover, safe to crop into 9:16 and 1:1, and fit to sit beside the next shot.

This is a local tool with one optional model call. It is the substitute for Google Video Intelligence described in the cost notes. It does not replace the content-engine trial. The planner in the trial reads catalog tags until these records exist. Build this when a library needs ranges, or when asked.

## What the editor needs

A request such as “a 20-second sunset dinner, vertical” has to become three or four pieces of picture. For each piece the planner must know:

- which seconds are worth using
- whether the shot is a wide, a detail, or a person doing something
- whether the camera is still, moving, or handheld, and whether the viewpoint is on the ground or in the air
- the light, so noon does not cut against night
- where the subject sits, so a vertical crop does not cut them in half
- where a face sits, so a title does not cover it
- whether burned-in words or a logo make the shot unsafe
- that the usable length covers the line it is cut under

The current catalog cannot answer those. `library/catalog.json` has one tag list per file, written by hand, and the Palm Shore masters are the first eight seconds of each source with the audio removed.

## What this tool does not do

- Identify a person. Face detection stores a box. It does not store an embedding or a name.
- Grade, stabilize, or re-encode the master.
- Decide the edit. The content-engine planner still chooses the shots. This tool only describes them.
- Transcribe silence. Whisper runs only when the audio looks like speech. Scenic plates with waves stay marked as ambience or silence. The Palm Shore files in `public/library` have no audio, so a first run on those files is picture only.

## Pipeline

One clip in, one analysis record out. Stages are separate so a later, better model can rerun without extracting frames again.

1. **Probe.** Width, height, duration, frame rate, and whether the picture was scaled up to fill 1920×1080. The seven soft Palm Shore ids are listed in `ROADMAP.md`.
2. **Stills.** One JPEG per second, long edge about 480 pixels, timecode in the filename. These are the frames the model sees and the frames a person can check. They are not a preview of the film.
3. **Sound.** Measure the audio. Classify it as `none`, `ambience`, `speech`, or `unusable`. Run Whisper only on `speech`, and keep word times. On `none`, skip Whisper. Do not trust a transcript that Whisper invented over wind.
4. **Camera motion.** Compare each still with the next using optical flow, locally. This sets `motion`. It does not set the viewpoint.
5. **Faces.** MediaPipe Face Detection on the stills. Store a box per face per second. The package is `mediapipe`, run locally. InsightFace stays out: its detection is bundled with recognition, and its shipped models are marked for non-commercial research.
6. **Read.** Send the small stills in time order, the measured `motion`, the sound class, and any transcript to a flash-class vision model. The vocabulary below is the only allowed tags. The model returns ranges and sets `viewpoint`. It must not overwrite `motion`.
7. **Words in picture.** The same pass flags burned-in text and quotes the words when it can read them. The swing clip `34103646` contains “Samurai Maldives” and is the example of a shot this must catch.

## Camera motion

`motion` and `viewpoint` are two fields. A drone can hover. That shot is `still` and `aerial`.

Optical flow between consecutive stills decides `motion`:

- The background barely shifts, even if a person walks through: `still`.
- The background shifts in one steady direction: `moving`.
- The background jitters with no single direction: `handheld`.

Judge the background, especially the edges of the frame. A walker in a locked shot is subject motion. Calling that shot `moving` is the mistake this rule is there to prevent.

The model decides `viewpoint`, `ground` or `aerial`, because that is a place to stand, not a measurement of movement. It sees the stills in order. A looking-down ground plane, roofs, or water moving as a sheet is `aerial`. A horizon at eye height is `ground`.

One still per second is enough for the slow moves in this library. The flow pass does not estimate speed, tell a zoom from a push-in, or see a whip pan that starts and ends between two stills. Do not add fields for those.

FFmpeg, Whisper, optical flow, and MediaPipe run on the machine. The model call is the only per-minute cost. At the assumptions already used — about 60 small frames, a short transcript, and a short tag list back, priced like a flash model at $0.30 per million tokens in and $2.50 per million out — that call is about $0.007 a minute. Google label detection is $0.10 a minute after 1,000 free minutes. Full-HD frames sent to a frontier model can erase the saving, so the call stays on the small stills.

## Record

One JSON file per clip, `library/analysis/{id}.json`. The catalog remains the list of files. The analysis record is what the planner reads. Coordinates are fractions of the frame, origin at the top left, so a crop works at any output size.

```json
{
  "clipId": "39465598",
  "analyzedAt": "2026-10-18T00:00:00Z",
  "duration": 8.01,
  "technical": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "soft": false
  },
  "audio": {
    "class": "none",
    "transcript": []
  },
  "ranges": [
    {
      "start": 0.5,
      "end": 7.5,
      "scene": ["beach"],
      "role": "action",
      "motion": "still",
      "viewpoint": "ground",
      "light": "day",
      "actions": ["walking"],
      "subject": { "x": 0.18, "y": 0.42, "w": 0.40, "h": 0.48 },
      "faces": [
        { "t": 2.0, "x": 0.22, "y": 0.44, "w": 0.06, "h": 0.09 }
      ],
      "burnedInText": false,
      "text": ""
    }
  ]
}
```

`role` is `wide`, `detail`, or `action`. `motion` is `still`, `moving`, or `handheld`, and it comes from optical flow. `viewpoint` is `ground` or `aerial`, and it comes from the model. `light` is `day`, `sunset`, or `night`. `scene` and `actions` use the catalog vocabulary: beach, villa, arrival, pool, dining, breakfast, room, spa, fishing, and walking, playing, eating, cooking. A range may carry several scene words. A new word is not allowed unless it is added here and in the prompt together.

A clip may have more than one range when the picture changes. The usable length of a range is `end - start`. The planner must not pick a range shorter than the line it has to cover.

## How a cut uses it

For a vertical sunset dinner, the planner:

1. Keeps ranges whose `light` is `sunset` and whose `scene` includes `dining` or whose `actions` include `eating`.
2. Drops ranges with `burnedInText` unless the crop can exclude the box that contains the words.
3. Orders a `wide`, then an `action` or `detail`, and does not place two `aerial` viewpoints in a row.
4. Crops 9:16 and 1:1 around `subject`, and keeps titles off every `faces` box in that interval.
5. Rejects a range whose length is shorter than the voice line assigned to it.

Until analysis records exist, the planner may fall back to the hand-written tags on the catalog. Those tags describe the file, not a time range, and they have no subject position.

## Build order

1. Probe and stills for one clip, files on disk, no model call.
2. Optical flow on those stills, writing `motion` only.
3. MediaPipe boxes on those stills.
4. Sound class, and Whisper only when the class is `speech`.
5. One model call that returns ranges in the schema above, including `viewpoint`, and leaves `motion` as measured. Reject a response that uses words outside the vocabulary or changes `motion`.
6. Check `34103646` and report the sign, and check `39465598` and report a walking range with a subject box.
7. Run the library. Then point the planner at `library/analysis` instead of the flat tag list.

Near-duplicate detection, a “usable waves versus wind” grade inside `ambience`, and color matching across shots come after a cut can already be chosen from ranges.

## Files

| Path | Role |
| --- | --- |
| `public/library/{id}.mp4` | Master the editor plays |
| `library/stills/{id}/{t}.jpg` | One small frame per second. Gitignore with the other scratch |
| `library/analysis/{id}.json` | The record above |
| `library/catalog.json` | File list and the hand tags used until analysis exists |
