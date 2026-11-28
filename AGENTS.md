<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Content engine

This is a private demo of a video editor. A guest writes in ordinary language. The app answers in a chat. Footage, a preview, the editor, and project settings appear in that thread when a command runs. The front page is `/`. The older storyboard is `/studio`.

The owner is Oliver Wolfson. The repo is `https://github.com/owolfdev/content-engine.git` on `main`. Vercel deploys that branch and serves the conversation, the gallery, and the in-browser preview. Vercel does not render MP4 files. `POST /api/render` returns 503 when `VERCEL` is set.

Two computers matter. The work machine is where the app is built. The studio MacBook Air stays on and renders files. `AIR.md` is the machine note for the Air: tunnel, Cloudflare, and what not to repeat there. This file is the product. Where they disagree about how the app behaves now, this file wins. Where they disagree about the Air, the tunnel, or Cloudflare, `AIR.md` wins.

`COMMANDS.md` is the guest-facing command list. The app shows it unchanged when someone asks which commands exist. `ROADMAP.md` is the older trial plan. `VIDEO_ANALYSIS.md` is a spec, not a task. Do not build either unless the owner asks.

## Leave these alone

Do not start an invite gate, a Vercel-to-Air render connection, a provider allow-list, a Pexels collection import, Envato, a second language, a media-adapter layer, or the video-analysis tool. A 4 GB DigitalOcean droplet was considered and set aside. The Air is the render host for this test.

Do not print `.env.local` or any key, voice id, or token. Do not commit `.env.local`, footage, voice caches, or Cloudflare credentials. Do not commit or push unless the owner asks.

Guest-facing copy does not name Vercel, Pexels, OpenAI, ElevenLabs, keys, `.env`, or servers. A failed render says "The video could not be made. Try again in a moment."

## How a request becomes a screen

The guest's sentence is not turned into a search by a server regex. The model reads it and calls one command. The app runs that command. If the guest types the command itself (`make_cut 12`, `show_videos wolves`, `edit_cut`, `project_settings`, `clear_history`, `commands`), it runs directly and the model does not choose a different one.

A search argument must be a short subject. When it is not, the tool returns an error and the model can retry, up to 3 rounds. Do not bring back a `wantsFootage` or `phraseFrom` fallback.

`make_cut` and `make_video` write their own sentence and stop. The guest sees "Here is a 6 second video from the selected clips." or "Here is a 15 second video about children on the beach." and the preview in that same reply. An empty selection says "Select a few clips first." If the model describes a preview without calling a command, that sentence is sent back once and it has to call the command. `edit_cut`, `project_settings`, `clear_history`, and `commands` also stop on the app's own reply.

Commands:

- `count_videos` counts a subject, then asks if the guest wants to see them. The gallery does not open on a count.
- `show_videos` opens the gallery. The gallery is on screen only because this command ran.
- `make_video` searches several pages and previews four clips chosen from that pool. The length is 15 seconds unless they named one, including a word such as ten. A shot limit, such as two seconds each, uses enough clips to fill that length and no shot runs longer. A maker name keeps only that person's clips. The search keeps reading pages until it has enough of that maker, or it runs out. It still cannot ask the library for one maker by name.
- `make_cut` builds a preview from the clips already selected. The length is the number they asked for, including under one second. It is not changed to 8 or 30. The cap is 10 minutes and 60 clips. It does not search and it does not narrow to one maker. A named subject, including "I don't see it" after that request, is `make_video` even when other clips are selected.
- `edit_cut` changes the video already on screen. `open` shows the editor. `trim`, `move`, and `remove` change one shot. `add` appends selected clips that are not already in that video. Shot numbers start at 1 from the left.
- `project_settings` inserts the settings panel. It is not pinned to the top of the page.
- `clear_history` wipes the conversation in this browser. A Clear button sits next to the prompt. Clearing does not reset the brand.
- `commands` returns `COMMANDS.md`.

There is no voiceover in the chat. Previews are silent. `/studio` can still record a line. That path is separate.

## Gallery

`app/chat-browser.tsx`. The search box starts with the model's phrase. Editing it searches again after about 450ms, or on Enter, and resets to page 1. Selection is kept. Selected clips stay in a strip under the grid. Click a selected tile to remove it. One clip plays at a time. Full screen is requested in the click handler, before `video.play()` is awaited.

Page size is 4–80. Sort reorders the current page only: search order, maker A to Z, maker Z to A, shortest, longest. The search does not offer a sort, a date, or a set. A maker is the name under the tile. The Selected strip stays in the order the clips were picked, because that order is the cut.

`POST /api/browse` searches Pexels videos. A reported total of 8000 is the API's ceiling for a broad search, not a fallback invented by the app. A failed count is an error or 0.

## Preview, editor, and download

A compiled preview plays at once from the remote file. The smallest rendition is then downloaded only so the preview can scrub. The 16:9, 1:1, and 9:16 buttons change the frame on screen, and Download video renders the file in that same frame. Do not auto-render when a preview appears.

The editor is the Edit button on the preview, or a sentence such as "let's edit this." The timeline uses one pixels-per-second scale, zoom, trim handles, reorder on the name bar, and remove. The last shot cannot be removed. One undo step. The same plan is used for a drag and for a sentence. Filmstrips of decoded frames are not used. New cuts store the gallery still on the clip.

Add to video appends selected clips that are not already in the latest timeline, or the open editor if one is open. Existing shots keep their lengths. A new shot comes in at about that length, and never longer than its footage. The editor opens. Undo restores the previous plan.

Chat history is `localStorage` key `content-engine-chat`. After a reply, the prompt takes focus again.

## Project settings

`localStorage` key `content-engine-style`, shared with `/studio`. The panel is inserted in the chat when `project_settings` runs.

Reset all clears the property name, removes the logo, sets the accent to white, and returns the theme, type, logo place, and music to their defaults. The default logo is no overlay. "Use the original logo" restores `/brand/palm-shore.svg`. The default music is no music. Changing the theme does not turn a track back on.

The browser tab is the property name. When the property is empty, the tab says Video. The downloaded file uses that name (`vanilla-beach.mp4`), or `video.mp4` when the property is empty. A fresh browser still starts from `library/style.json`, whose name is Palm Shore, until the guest renames it or resets.

The model is told the current property name with each message. It is not told that the brand is Palm Shore.

## Render

`app/api/render/route.ts` does not run Remotion inside the Next process. It spawns:

`node --experimental-strip-types --import scripts/alias-hook.mjs scripts/render-file.ts`

`scripts/alias-hook.mjs` must stay a resolve-only hook. A load hook on Node 22 makes `require.cache` undefined and the Remotion bundler crashes. Do not add `"type": "module"` to `package.json`. Keep Node 22.

The composition uses Remotion `OffthreadVideo`. Do not switch the file render back to `Video`. During a render, paths starting with `/` go through `staticFile()`. In the player, a Pexels master path is rewritten to its `-preview.mp4` proxy.

Do not export `runtime` or `maxDuration` on routes. `next.config.ts` enables cache components, and those exports fail the build. Dynamic routes that must not be cached call `await connection()` from `next/server`.

One render at a time. A second request gets 409. Clip paths must start with `/library/` or `/brand/` and must not contain `..`. Settings: h264, crf 20, concurrency 1, 120 second timeout. The child writes progress lines. The page polls `GET /api/render`. The file is written in the temp directory, returned, and deleted.

Chat length is the length the guest asked for, capped at 600 seconds. There is no 8–30 second floor. When many clips share a very short duration, the frame rate rises so each clip gets at least one frame. The older planner in `lib/plan.ts` still clamps storyboard requests. That is the studio path, not the chat rule.

## Where the code lives

- `app/chat-screen.tsx` is the thread. `app/chat-browser.tsx` is the gallery. `app/chat-preview.tsx` and `app/cut-preview.tsx` are the preview. `app/clip-editor.tsx` is the timeline. `app/project-settings.tsx` is the brand panel. `app/local-render.tsx` is Download video.
- `app/api/chat/route.ts` is the model loop. `lib/commands.ts` runs a command. `lib/edit-cut.ts` trims, moves, removes, and adds shots. `lib/chat-cut.ts` builds a plan from the selection.
- `lib/sources/pexels.ts` searches and downloads. The smallest file is the preview proxy. The largest file is the render master.
- `composition/Cut.tsx` is the rendered picture. `composition/timeline.ts` turns a plan into frames.
- `library/style.json` is the stand-in brand file. `library/catalog.json` is the older tagged library used by `/studio`.

Pexels is a stand-in for resort footage. The search stays a live keyword search. Do not invent a collection name or filter the library for faces or public-release rights. Still keep the source, the author, and the license on a clip.
