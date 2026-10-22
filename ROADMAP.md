# Content engine roadmap

Private trial of the video creation path. A potential client opens an invite link, types a request, and reviews a branded cut in the browser. This is the creation slice of the proposal: find footage, apply a style, add voice, and show the result in the requested shape and language.

## Start here

Last session ended Tuesday 20 October 2026. The library, style guide, voice, planner, and composition are done. The planner can also search Pexels live for a demo. Start at **step 6, the trial shell**. Do not invent a second language, and do not build `VIDEO_ANALYSIS.md` unless asked.

The video analysis tool is specified in `VIDEO_ANALYSIS.md`. It describes timed ranges, crops, and faces for the planner. Do not build it unless asked.

Nothing beyond the Create Next App commit is in git. The roadmap, catalog, style guide, fetch script, and brand files are local only. The owner has not asked for a commit. The MP4 masters are gitignored and live only on this disk. The music previews in `public/brand/music/` are small enough to commit later.

### Done

- Next.js 16 app in this folder (App Router, TypeScript, Tailwind). `npm run dev` opens the Palm Shore style guide at `/`.
- Pexels key in `.env.local` as `PEXELS_API_KEY`. ElevenLabs key, voice id, and model id are in the same file. It is gitignored. Do not print any of them.
- Voice: `POST /api/voice` and the Speak box on the home page. A line plays back. Limits are 400 characters a line and 2,000 characters in a browser. Banned lines are refused.
- Planner: `POST /api/plan` and the request box at the top of the home page. Footage is either the Palm Shore library (catalog tags) or a live Pexels search. Pexels is the demo source: the same sentence becomes a search phrase, the files are cached under `public/library/pexels/`, and the player cover-crops them. Those files are gitignored. “a 20-second sunrise beach offer, vertical, in English” on the library returns a vertical frame, English copy, Carefree, and three beach clips. Beach swing is left out because of the sign.
- Composition: `composition/Cut.tsx`, played by `@remotion/player` under the plan. Same template for 16:9, 1:1, and 9:16, center-cropped from the masters. Logo, title, spoken line, music, and the ElevenLabs voice. Music ducks while the voice plays. A file render is not wired up.
- 44 silent masters, 1920×1080, about 8 seconds, for one stand-in resort named Palm Shore. Files: `public/library/{id}.mp4`. Catalog: `library/catalog.json`. Later additions cover volleyball, swimming, walking, massage, aerials, cooking, and fishing.
- Rebuild with `python3 scripts/fetch_proxies.py`. It skips a file that is already 1920×1080. Vertical Pexels sources are center-cropped to 16:9.

### Library facts the next session needs

Masters are 16:9 HD. Output shapes (9:16, 1:1, 16:9) come later, cropped from these masters. Do not re-encode the library back to vertical.

Tags in the catalog: beach, villa, arrival, pool, dining, breakfast, room, spa, fishing, aerial, day, sunset, night, guests, walking, playing, eating, cooking. One `propertyId`: `palm-shore`.

Eleven masters are native HD or were scaled down from 4K. These seven were upscaled from a 1080-wide vertical file and are softer: `6145259`, `14695740`, `10165855`, `31387465`, `36775848`, `5190093`, `6423986`. Leave them unless asked to replace them.

`34103646` (Beach swing) has a readable sign, “Samurai Maldives,” inside the swing. Known, left in place.

Search scratch is gitignored: `library/thumbs/`, `library/frames/`, `library/candidates.json`.

The trial is private. The owner asked not to filter the library for faces or public-release rights. Still keep source, author, and `license: Pexels License` on each catalog record.

### Not decided

- The second language. English is fixed. Do not invent the other one.
- A real Palm Shore mark. The preview uses a placeholder at `public/brand/palm-shore.svg`.

The app is Next.js 16 (App Router, TypeScript, Tailwind) in this folder. It deploys to Vercel. Remotion Player is added when the composition work starts.

## What the client sees

1. A private link, with a password or a per-client invite. The app is not indexed and has no public signup.
2. A request in plain language: a property, a moment, a language, and a shape.
3. A preview that plays in their browser: chosen clips, title, logo, music, and an ElevenLabs voiceover.

Vercel serves the app and runs the short planning and voice requests. The visitor’s browser plays the composition. Vercel does not render frames.

## Decisions already made

- One stand-in resort in the library. Logo, fonts, colours, and music change per client through the style guide. Clip tags leave room for a second property later.
- The library is 44 Pexels masters at 1920×1080 in `public/library`, described in `library/catalog.json`. See “Start here.”
- For a Vercel deploy, those files need a host the browser can load (Vercel Blob or similar). They are on disk only today. Hotlinked Pexels URLs are not reliable inside the player.
- The catalog and the brand defaults are JSON files in the repo. A session’s style tweaks stay in the browser. SQLite is out for this trial because writes on Vercel’s filesystem do not persist.
- Version one has one template and two languages: English and one other.
- Shapes are 9:16, 1:1, and 16:9, from the same plan.
- ElevenLabs runs through a server route. The API key stays in the environment. Each invite has a usage cap.
- The MacBook Air (8 GB) is the machine used while building, including a local MP4 render when a file is needed on the desk.
- A 4 GB droplet is added only when a client must download an MP4 while the studio machine is off. Until then, the trial is the in-browser preview.
- Same stock library for every client. Client footage is not uploaded into a link that goes to more than one company.

## Build order

### 1. Library — done

44 Palm Shore masters, 1920×1080, catalogued with tags, duration, file path, source page, author, and license. The set includes people in motion, massage, aerials, cooking, and fishing. Rebuild script: `scripts/fetch_proxies.py`.

### 2. Style guide — done

`library/style.json` holds Palm Shore fonts, day and evening colours, margins, banned lines, and three Kevin MacLeod tracks (CC BY 4.0, attribution required). The files are 45-second previews in `public/brand/music/`. The home page reads that file. Preset, accent, title type, wordmark, and music can be overridden in the browser; Reset clears it. The logo is a placeholder until a real mark is supplied.

### 3. Voice — done

`POST /api/voice` sends one line to ElevenLabs and returns audio. The home page Speak box plays it. The owner confirmed this on 19 October 2026. A missing key, a rejected key, a banned line, a line over 400 characters, or a browser over its 2,000-character budget each return a plain error.

### 4. Planner — done

`POST /api/plan` turns a sentence into the object the composition will render: clips, title, spoken line, language, shape, and music. It uses catalog tags. A sentence with no known scene or action returns no clips. A language other than English is refused. The home page shows the plan.

Checked: “a 20-second sunrise beach offer, vertical, in English” selects three beach clips, a 9:16 frame, English copy, and Carefree.

The request box can switch footage. Create plan writes an editable script: timeline, picture lines, voiceover, notes, graphics, and colours. Build preview is the second step. It searches then, and only then. `library` matches each beat to the tagged clips. `pexels` searches each beat’s picture line, caches the mp4, and plays that file. Pexels is for demos. A client library remains the real source.

### 5. Composition — done

`composition/Cut.tsx` is the template the player uses, and the same component a later file render should use. It sequences the planned clips, center-crops the 16:9 masters, and places the logo, title, and spoken line. The home page fetches the spoken line once and ducks the music under it. The cut keeps the planned length, between 8 and 30 seconds. Checked in the browser: the sunrise beach plan played through all three clips, and the frame switched among 16:9, 1:1, and 9:16.

### 6. Trial shell — start here

The request box, the player, and the shape control are already on the home page. Still to add: a private invite gate, no indexing, a voice cap per invite, and empty and error states for no matching clips, voice unavailable, and an unknown language.

Done when an invited person can request a cut and watch it without help.

### 7. File export, when a trial needs it

A local render script that writes an MP4 on the Air, one shape at a time. The droplet worker comes after a client needs that file produced unattended.

## Outside this trial

Client-owned cloud accounts, Mux analytics, approval roles, a 17-property rollout, twelve languages, the learning loop, and the film-festival module. Those stay in the proposal. They are not part of the link you send.
