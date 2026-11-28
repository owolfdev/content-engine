# Content engine

A private demo of a video editor. A guest writes a request, browses footage, and previews a cut in the browser. Download video makes the MP4 on the computer that is running the app. The hosted site on Vercel does not render files.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Node 22. Dependencies are installed with `npm install`. Keys live in `.env.local` and are not committed.

Another agent should read `AGENTS.md` before changing the app. `COMMANDS.md` is the list a guest can ask for. `AIR.md` is the note for the studio machine that stays on and renders. `ROADMAP.md` and `VIDEO_ANALYSIS.md` are older plans, not current work.
