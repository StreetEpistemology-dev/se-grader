/**
 * SE Conversation Grader — Vercel Serverless Function
 *
 * Endpoint: POST /api/analyze
 * Body: { videoUrl?, practitioner?, transcript?, rubric }
 *
 * Environment variable (set in Vercel dashboard → Settings → Environment Variables):
 *   ANTHROPIC_API_KEY   — required
 *   ALLOWED_ORIGINS     — optional, comma-separated; defaults to "*"
 */

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TRANSCRIPT_CHARS = 60000;

export default async function handler(req, res) {
  // CORS
  const allowed = process.env.ALLOWED_ORIGINS || "*";
  const origin = req.headers.origin || "";
  let allowOrigin = "*";
  if (allowed !== "*") {
    const list = allowed.split(",").map((s) => s.trim()).filter(Boolean);
    allowOrigin = list.includes(origin) ? origin : list[0] || "*";
  }
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res
      .status(500)
      .json({ error: "Server misconfigured: ANTHROPIC_API_KEY environment variable not set." });
  }

  try {
    const body = await readJsonBody(req);
    const { videoUrl, practitioner, transcript, rubric } = body || {};
    if (!rubric || !rubric.sections) {
      return res.status(400).json({ error: "Missing rubric in request body." });
    }

    let transcriptText = (transcript || "").trim();
    let videoMeta = {};
    if (!transcriptText) {
      if (!videoUrl) {
        return res.status(400).json({ error: "Provide either videoUrl or transcript." });
      }
      const videoId = extractVideoId(videoUrl);
      if (!videoId) {
        return res.status(400).json({ error: "Couldn't parse a YouTube video ID from that URL." });
      }
      const fetched = await fetchYouTubeTranscript(videoId);
      transcriptText = fetched.text;
      videoMeta = { videoId, title: fetched.title, channel: fetched.channel };
    }

    if (!transcriptText) {
      return res.status(422).json({
        error:
          "No transcript available. The video may be private, lack captions, or YouTube changed their format. Paste a transcript directly under Advanced.",
      });
    }

    if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
      transcriptText =
        transcriptText.slice(0, MAX_TRANSCRIPT_CHARS) +
        "\n\n[transcript truncated for length]";
    }

    const scored = await scoreWithClaude({
      apiKey: process.env.ANTHROPIC_API_KEY,
      rubric,
      transcript: transcriptText,
      practitioner: practitioner || null,
    });

    return res.status(200).json({
      ...scored,
      videoMeta,
      transcriptPreview: transcriptText.slice(0, 600),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

// ----- helpers (port of the worker logic) -----

function readJsonBody(req) {
  // On Vercel Node runtime, req.body is auto-parsed if Content-Type is JSON.
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function fetchYouTubeTranscript(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const r = await fetch(watchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error("YouTube watch page returned HTTP " + r.status);
  const html = await r.text();

  const title =
    matchOnce(html, /<meta name="title" content="([^"]+)"/) ||
    (matchOnce(html, /<title>([^<]+)<\/title>/) || "").replace(/ - YouTube$/, "");
  const channel = matchOnce(html, /"author":"([^"]+)"/);

  const captionTracks = extractCaptionTracks(html);
  if (!captionTracks.length) {
    throw new Error("This video has no captions available.");
  }

  const pick =
    captionTracks.find((t) => /^en/i.test(t.languageCode) && t.kind !== "asr") ||
    captionTracks.find((t) => /^en/i.test(t.languageCode)) ||
    captionTracks[0];

  const trackUrl = pick.baseUrl + (pick.baseUrl.includes("?") ? "&" : "?") + "fmt=json3";
  const tr = await fetch(trackUrl);
  if (!tr.ok) throw new Error("Caption track fetch failed: HTTP " + tr.status);
  const tj = await tr.json();

  const lines = [];
  for (const evt of tj.events || []) {
    if (!evt.segs) continue;
    const text = evt.segs
      .map((s) => s.utf8 || "")
      .join("")
      .replace(/\n/g, " ")
      .trim();
    if (text) lines.push(text);
  }
  return { text: lines.join(" "), title, channel };
}

function extractCaptionTracks(html) {
  const m = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?})\s*;\s*var/);
  if (!m) return [];
  try {
    const obj = JSON.parse(m[1]);
    const tracks = obj?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) ? tracks : [];
  } catch (_) {
    return [];
  }
}

function extractVideoId(input) {
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
  try {
    const u = new URL(input);
    if (u.hostname === "youtu.be") return u.pathname.replace(/^\//, "").split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch (_) {}
  return null;
}

function matchOnce(s, re) {
  const m = s.match(re);
  return m ? m[1] : null;
}

async function scoreWithClaude({ apiKey, rubric, transcript, practitioner }) {
  const system = buildSystemPrompt();
  const user = buildUserPrompt({ rubric, transcript, practitioner });
  const tool = buildScoreTool(rubric);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "submit_scores" },
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error("Anthropic API error " + r.status + ": " + errText.slice(0, 500));
  }
  const data = await r.json();
  const block = (data.content || []).find(
    (c) => c.type === "tool_use" && c.name === "submit_scores"
  );
  if (!block || !block.input) throw new Error("Model did not return tool output.");

  const out = block.input;
  const scoresById = {};
  for (const s of out.scores || []) {
    scoresById[s.id] = {
      value: ["green", "grey", "red", "na"].includes(s.value) ? s.value : "na",
      rationale: s.rationale || "",
      quote: s.quote || "",
    };
  }
  return {
    scores: scoresById,
    narrative: out.narrative || "",
    practitionerIdentified: out.practitionerIdentified || practitioner || null,
  };
}

function buildSystemPrompt() {
  return [
    "You are an expert grader of Street Epistemology (SE) conversations.",
    "Your scoring contract is the SE Conversation Rubric the user provides.",
    "The gold standard for what constitutes good SE practice is defined by the Navigating Beliefs course (navigatingbeliefs.com).",
    "",
    "Definitions:",
    '- "green": the practitioner clearly used the recommended practice for this criterion.',
    '- "grey": evidence is mixed (some recommended, some detrimental) OR there is insufficient evidence either way.',
    '- "red":  the practitioner clearly used the inappropriate / detrimental practice.',
    '- "na":   the criterion does not apply to this conversation (use sparingly; prefer "grey" when uncertain).',
    "",
    "Scoring instructions:",
    "1. Identify which speaker is the SE practitioner (the one asking probing questions about beliefs, not the believer being explored).",
    "2. For every criterion in the rubric, judge ONLY the practitioner's behavior — not the interlocutor's.",
    "3. Quote a short verbatim excerpt from the transcript when possible (under 30 words). If no specific moment applies, leave quote empty and rely on rationale.",
    "4. Be conservative on the six SE Essentials (#1, #17, #18, #19, #37, #38). Only mark them green if you have clear positive evidence; otherwise grey.",
    "5. If the transcript is missing entire phases (e.g., no opening or closing), mark phase-specific criteria 'na', not 'red'.",
    "6. Provide a 3-5 sentence narrative summarizing strengths, weaknesses, and whether this counts as SE.",
    "",
    "Be calibrated. Do not be charitable to confrontational debate framed as SE. Do not penalize legitimate clarification questions as 'leading'.",
  ].join("\n");
}

function buildUserPrompt({ rubric, transcript, practitioner }) {
  const rubricText = rubric.sections
    .map((s) => {
      const lines = s.criteria
        .map(
          (c) =>
            `  #${c.id}${rubric.essentialIds.includes(c.id) ? " ★" : ""}: ` +
            `recommended = "${c.recommended}" | detrimental = "${c.detrimental}"`
        )
        .join("\n");
      return `Section ${s.id}: ${s.title}\n${lines}`;
    })
    .join("\n\n");

  return [
    `Rubric (★ = SE Essential — must be green for the conversation to count as SE):\n\n${rubricText}`,
    practitioner
      ? `\nThe SE practitioner is identified as: ${practitioner}.`
      : "\nThe SE practitioner is not identified — infer from the transcript.",
    `\nTranscript:\n"""\n${transcript}\n"""`,
    "\nNow score the conversation by calling submit_scores. Include every criterion ID listed in the rubric.",
  ].join("\n");
}

function buildScoreTool(rubric) {
  const allIds = rubric.sections.flatMap((s) => s.criteria.map((c) => c.id));
  return {
    name: "submit_scores",
    description: "Submit the rubric scores for this Street Epistemology conversation.",
    input_schema: {
      type: "object",
      required: ["scores", "narrative"],
      properties: {
        practitionerIdentified: {
          type: "string",
          description: "Name or short identifier of the SE practitioner you identified, if any.",
        },
        narrative: {
          type: "string",
          description:
            "3-5 sentence overall summary: strengths, weaknesses, and whether this counts as SE per the Essentials policy.",
        },
        scores: {
          type: "array",
          description: "One entry per rubric criterion. Include every ID in the rubric.",
          items: {
            type: "object",
            required: ["id", "value"],
            properties: {
              id: { type: "integer", enum: allIds },
              value: { type: "string", enum: ["green", "grey", "red", "na"] },
              rationale: { type: "string", description: "1-2 sentences justifying the score." },
              quote: {
                type: "string",
                description: "Short verbatim quote (≤30 words) supporting the score, if applicable.",
              },
            },
          },
        },
      },
    },
  };
}
