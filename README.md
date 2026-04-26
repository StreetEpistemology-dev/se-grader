# SE Conversation Grader

A web app that grades a Street Epistemology conversation against the
[SE Conversation Rubric v2.1](https://docs.google.com/spreadsheets/d/1IT40pEfD_xHSBGH5mjw6q2X4eD0DoR-YiaO0zrJ1aUM/edit?gid=1439591124),
using the [Navigating Beliefs](https://www.navigatingbeliefs.com) course as the gold standard.

Paste a YouTube URL → the app fetches the captions → Claude scores all 37 criteria → you see a letter grade, the six "SE Essentials" pass/fail, a section breakdown, and per-criterion rationale with quote evidence. Reviewers can override any AI score; totals recompute live.

## Quick start

**To deploy this to a live URL:** see [DEPLOY.md](./DEPLOY.md). No terminal required.

**To preview the UI locally without deploying:** open `index.html` in your browser, click the "Try sample data" button. You'll see the full UI populated with example scores.

## Architecture

```
┌─────────────────┐   POST /api/analyze   ┌─────────────────────┐
│ index.html +    │ ────────────────────▶ │ api/analyze.js      │
│ app.js (in your │                       │ (Vercel Serverless) │
│ browser)        │ ◀──────────────────── │  • fetch transcript │
└─────────────────┘   scored JSON         │  • call Anthropic   │
                                          └─────────────────────┘
```

Both halves live in the same Vercel project on the same domain — no CORS configuration, no separate backend hosting.

## Files

| File | Purpose |
|------|---------|
| `index.html`, `styles.css`, `app.js` | The website (frontend) |
| `rubric.js`, `rubric.json` | The 37 criteria + 6 SE Essentials |
| `api/analyze.js` | The backend serverless function |
| `vercel.json` | Vercel function config (60s timeout) |
| `package.json` | Project metadata (no dependencies) |
| `DEPLOY.md` | Step-by-step click-through deploy guide |

## How scoring works

- 37 criteria across 5 sections (matching the source rubric — Section 2 is intentionally absent in the source, and #31 "Other:" is a write-in placeholder, not a real criterion).
- Each criterion is `green` (recommended practice used), `grey` (mixed or insufficient evidence), `red` (detrimental practice used), or `na`.
- Section score = (greens + 0.5 × greys) ÷ scored criteria.
- Overall score = same formula across all scored criteria.
- **SE Essentials pass/fail:** criteria #1, #17, #18, #19, #37, and #38 must *all* be green for the conversation to count as SE.
- The AI is instructed to be conservative on the Essentials: only green with clear positive evidence, otherwise grey.
- Reviewers can override any AI score by clicking the Green / Mixed / Red / N/A buttons on each criterion. Verdict and totals recompute instantly.

## Editing the rubric

The rubric lives in two places: `rubric.js` (used by the website at runtime) and `rubric.json` (a backup/reference copy with the same data). If the source sheet changes:

1. Edit the criteria text or scoring data inside `rubric.js`.
2. Optionally keep `rubric.json` in sync.
3. Commit the change in GitHub. Vercel auto-deploys within a minute.

The structure is straightforward: `title`, `essentialIds`, `sections[].criteria[].{id, recommended, detrimental}`.

## Known limitations

- YouTube transcript fetching depends on parsing the watch page; YouTube occasionally changes the format. If auto-fetch fails, paste a transcript directly under **Advanced**.
- The grader analyzes text only — it can't directly judge tone, body language, or pace from audio/video. Section 5 ("Building and Maintaining Rapport") scores from text cues alone; reviewers should override based on the video.
- No speaker diarization. The model has to infer who the SE practitioner is. Providing the practitioner's name in the form helps a lot.

## Roadmap ideas

- A "calibration set" of pre-graded conversations to benchmark the AI against human graders, plus inter-rater reliability stats.
- Save grades to a database (Vercel + Postgres or KV) with a public gallery.
- Whisper transcription for videos without captions.
- Direct integration with the SEI website (subdomain or `/grader` path).
- Multilingual support (the rubric is English-only today).

## Credits

- Rubric: Nathan Hartman, with Pierce Watkins, Sjoshuan, and Jamie.
- Gold standard: [Navigating Beliefs](https://www.navigatingbeliefs.com).
- Built for [Street Epistemology International](https://streetepistemologyinternational.org).
