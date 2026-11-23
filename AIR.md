# Air agent

You are on the studio MacBook Air. This file is the context for that machine. The owner is Oliver Wolfson. A different computer, the work machine, is where the app was built. The Air is the machine that stays on and renders files.

Read this before changing anything. Do the tunnel task below. Do not start the later work at the end of this file unless the owner asks.

## Where things stand

On 24 November 2026 the owner confirmed the app is running on this Air. The repo is cloned, dependencies are installed, `.env.local` is present, and the site answers on this machine. Do not repeat that setup.

The work machine is on Node v22.20.0. This Air may be on a newer Node 22 patch. Leave that in place. If this Air is on Node 24 or newer, install Node 22 for this project and run the app with it. The render was proven on the Node 22 line.

Git remote: `https://github.com/owolfdev/content-engine.git`, branch `main`. The public site is deployed from that branch on Vercel. Vercel serves the conversation, the gallery, and the in-browser preview. Vercel does not render MP4 files. `POST /api/render` returns 503 when `VERCEL` is set.

The tunnel is the unfinished step. It is not installed yet.

## What this app is

A private demo of a video editor. A person writes a request. The app answers in a chat. When they agree to see footage, a gallery is inserted in the thread. They select clips. When they ask for a cut, a preview is inserted. A button on that preview writes an MP4 on the computer that is running the server.

The front page is `/` (`app/chat-screen.tsx`). The older storyboard builder is `/studio`.

Pexels is the stand-in footage library for a fictional resort, Palm Shore. Search stays a live keyword search. The chat does not record a voiceover. Previews are silent. The local MP4 button is labeled “Render MP4 (this computer only)”. Cuts are 8–30 seconds, 1920×1080, 30 fps.

## The task now

Put this running app on a Cloudflare Tunnel, with a login in front of it, and prove that the work machine can open it and render one short file.

Leave the app running. It is `npm run dev` on port 3000 unless the owner says otherwise. Point the tunnel at `http://localhost:3000`. Do not restart it, switch it to `next start`, or change ports unless it has already stopped.

### Before the tunnel

- The Air stays plugged in, with the lid open, on a desk. macOS sleeps a closed lid. Turn on the setting that prevents sleep while on power.
- Do not turn on Remote Login, Screen Sharing, or File Sharing.
- Do not forward a port on the home router. The tunnel makes an outbound connection.
- Ask the owner which hostname to use. The domain’s DNS must already be on Cloudflare. Do not invent a domain or a hostname.
- Ask which email addresses may sign in. Do not leave the hostname open to the public internet.

### Install and connect

1. Install `cloudflared`. Use Homebrew when it is present: `brew install cloudflared`. Otherwise use the macOS package from Cloudflare’s tunnel docs.
2. `cloudflared tunnel login`. The owner completes the browser approval on this Air.
3. `cloudflared tunnel create content-engine`.
4. Add a config file under `~/.cloudflared/config.yml`:

```yaml
tunnel: content-engine
credentials-file: /Users/<air-user>/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: <the hostname the owner chose>
    service: http://localhost:3000
  - service: http_status:404
```

Use the real credentials path that `tunnel create` printed. Do not commit this file or the credentials JSON.

5. `cloudflared tunnel route dns content-engine <hostname>`.
6. Create a Cloudflare Access application for that hostname before starting the tunnel for anyone else. In the Zero Trust dashboard: Access, Applications, self-hosted, the same hostname, Allow policy limited to the owner’s email addresses. Access is free for this test (under 50 people).
7. `cloudflared tunnel run content-engine`. Leave that process running.

### Prove it

From the work machine, not from the Air’s own browser:

1. Open the hostname.
2. Sign in through Access.
3. Ask for a short cut and render one file.
4. Confirm the MP4 downloads and plays.

A public Cloudflare hostname is not Cloudflare’s allowed way to distribute video on the free plan. The page and the render request are ordinary web traffic. The finished MP4 is the part their terms cover. If the download is blocked, stop and tell the owner. Do not look for a way around that rule.

## Rules for this machine

- Do not print `.env.local` or any key, voice id, or token. The names that exist are `PEXELS_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_LINE_CAP`, `ELEVENLABS_CHAR_CAP`, and `OPENAI_API_KEY`. `OPENAI_MODEL` is optional and unset, so the chat uses `gpt-4.1-mini`.
- Do not commit `.env.local`, footage, voice caches, or tunnel credentials. Do not commit or push unless the owner asks.
- Do not set `VERCEL` in the environment on this Air. That flag disables rendering.
- One render at a time. A second request gets 409.
- Do not use this Air for browsing or other work while a render is running. It has 8 GB of RAM and no fan. One 1080p render is the load it can take.

## How a render works

`app/api/render/route.ts` does not run Remotion inside the Next process. Chrome exits when it is launched as a child of the Next server. The route spawns a separate Node process:

`node --experimental-strip-types --import scripts/alias-hook.mjs scripts/render-file.ts <plan.json> <output.mp4>`

The child receives a stripped environment: `PATH`, `HOME`, `TMPDIR`, `USER`, `PWD`, `LANG`, `LC_ALL`, `NODE_ENV`, and the two ElevenLabs voice variables. It does not receive `NODE_OPTIONS`. The route copies Remotion’s Chrome into `~/Library/Caches/content-engine/chrome-headless-shell` once and passes that binary. The copy is skipped when the destination binary already exists. Delete that cache only when Remotion’s Chrome is upgraded.

The child writes `PROGRESS {json}` lines to stdout. The page polls `GET /api/render`. Output goes to the temp directory, is returned as `palm-shore.mp4`, and is deleted. Render settings: h264, crf 20, concurrency 1, 120 second timeout.

`scripts/alias-hook.mjs` must stay a resolve-only hook. A load hook on Node 22 makes `require.cache` undefined and webpack crashes inside `@remotion/bundler`. JSON imports of `@/` files are rewritten to generated modules in the temp directory.

The composition uses Remotion `OffthreadVideo`, not `Video` from `remotion`. `Video` seeks per frame and produced a stuttering file on this macOS version. Do not switch it back.

Do not add `export const runtime` or `maxDuration` on routes. `next.config.ts` enables cache components, and those exports fail the build. Dynamic routes that must not be cached call `await connection()` from `next/server`.

Clip paths in a render must start with `/library/` or `/brand/` and must not contain `..`.

## Chat behavior worth keeping

The model may call `count_videos`, `show_videos`, and `make_cut`. It does not draw the interface. A count stays as words. The gallery appears when the person wants to see footage. The preview appears when they ask for a cut from the selection.

The gallery search box starts with the model’s phrase. Editing it searches again and keeps the selection. Selected clips stay in the strip under the grid, including after a new search or another page. The prompt takes the cursor again after each reply.

Chat history in the browser is `localStorage` key `content-engine-chat`. Style overrides are `content-engine-style`. This Air’s browser storage is not the work machine’s storage.

## Leave these alone

Do not build a media-adapter layer, an invite gate, a deployed renderer, a provider allow-list, a Pexels collection import, Envato, a second language, or the video-analysis tool. `VIDEO_ANALYSIS.md` is a spec, not a task. `ROADMAP.md` is the older trial plan. This file wins where they disagree about the Air.

A 4 GB DigitalOcean droplet was considered and set aside. This Air is the render host for the current test.

## After the tunnel works

Stop. Tell the owner the hostname and that one file rendered from the work machine.

The following is later, and only if the owner asks: keep the conversation on Vercel, and change the render button so that site sends the cut to this Air with a shared secret. Until then, the button on Vercel still refuses to make a file, and the button on this Air makes the file.
