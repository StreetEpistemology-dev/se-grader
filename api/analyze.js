/**
 * SE Conversation Grader — Vercel Serverless Function (Gemini-powered)
 *
 * Endpoint: POST /api/analyze
 * Body: { videoUrl?, practitioner?, transcript?, rubric }
 *
 * Environment variables:
 *   GEMINI_API_KEY      — required. Create at https://ai.google.dev
 *   ALLOWED_ORIGINS     — optional, comma-separated; defaults to "*"
 *
 * Why Gemini: critical reflection in SE shows up as visible pauses, eye
 * direction changes, and contemplative body language — invisible in a
 * transcript. Gemini 2.5 Flash analyzes the actual video, including audio,
 * directly from a YouTube URL. Claude (transcript-only) was the v1 backend
 * but missed the SE-essential visual signals.
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
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

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: GEMINI_API_KEY environment variable not set." });
  }

  try {
    const body = await readJsonBody(req);
    const { videoUrl, practitioner, transcript, rubric } = body || {};
    if (!rubric || !rubric.sections) {
      return res.status(400).json({ error: "Missing rubric in request body." });
    }
    if (!videoUrl && !transcript) {
      return res.status(400).json({ error: "Provide either videoUrl or transcript." });
    }

    let videoMeta = {};
    let transcriptText = (transcript || "").trim();
    if (videoUrl) {
      const videoId = extractVideoId(videoUrl);
      if (!videoId) {
        return res.status(400).json({ error: "Couldn't parse a YouTube video ID from that URL." });
      }
      videoMeta = { videoId };
    }
    if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
      transcriptText = transcriptText.slice(0, MAX_TRANSCRIPT_CHARS) + "\n\n[transcript truncated]";
    }

    const scored = await scoreWithGemini({
      apiKey: process.env.GEMINI_API_KEY,
      rubric,
      videoUrl: videoUrl || null,
      transcript: transcriptText || null,
      practitioner: practitioner || null,
    });

    return res.status(200).json({
      ...scored,
      videoMeta,
      transcriptPreview: transcriptText ? transcriptText.slice(0, 600) : "",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

// ----- Gemini scoring -----

async function scoreWithGemini({ apiKey, rubric, videoUrl, transcript, practitioner }) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ rubric, transcript, practitioner, hasVideo: !!videoUrl });
  const responseSchema = buildResponseSchema(rubric);

  const userParts = [];
  if (videoUrl) {
    // Gemini's video analysis options live in fileData / videoMetadata. Use
    // camelCase — newer config keys aren't aliased to snake_case and silently
    // get ignored if you write them wrong.
    userParts.push({
      fileData: { fileUri: videoUrl, mimeType: "video/youtube" },
      videoMetadata: { fps: 1 }, // sample 1 frame/sec instead of default — still catches SE pauses
    });
  }
  userParts.push({ text: userPrompt });

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      maxOutputTokens: 8000,
      temperature: 0.2,
      // Lower video resolution → fewer tokens per frame → faster processing.
      // The SE-relevant cues (pauses, eye direction, body language) survive
      // at low res; we don't need fine pixel detail.
      mediaResolution: "MEDIA_RESOLUTION_LOW",
      // Cap thinking time so we fit in Vercel Hobby's 60s function budget.
      thinkingConfig: { thinkingBudget: 1024 },
    },
  };

  const r = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("Gemini API error " + r.status + ": " + t.slice(0, 800));
  }
  const data = await r.json();

  // Extract the JSON response. Gemini returns it as a text part with mimeType application/json.
  const candidate = (data.candidates || [])[0];
  if (!candidate) throw new Error("Gemini returned no candidates: " + JSON.stringify(data).slice(0, 400));
  const finishReason = candidate.finishReason || "";
  const partText = (candidate.content?.parts || []).map((p) => p.text || "").join("");
  if (!partText) {
    throw new Error("Gemini returned no text content. Finish reason: " + finishReason);
  }

  let parsed;
  try {
    parsed = JSON.parse(partText);
  } catch (e) {
    throw new Error("Gemini response was not valid JSON: " + partText.slice(0, 300));
  }

  const scoresById = {};
  for (const s of parsed.scores || []) {
    scoresById[s.id] = {
      value: ["green", "grey", "red", "na"].includes(s.value) ? s.value : "na",
      rationale: s.rationale || "",
      quote: s.quote || "",
      visualCue: s.visualCue || "",
    };
  }
  return {
    scores: scoresById,
    narrative: parsed.narrative || "",
    practitionerIdentified: parsed.practitionerIdentified || practitioner || null,
  };
}

function buildSystemPrompt() {
  return [
    "You are an expert grader of Street Epistemology (SE) conversations.",
    "Your scoring contract is the SE Conversation Rubric the user provides.",
    "The gold standard for SE practice is defined by the Navigating Beliefs course (navigatingbeliefs.com).",
    "",
    "You will be given either:",
    "  (a) a YouTube video, which you should watch in full (audio + visuals), OR",
    "  (b) a transcript-only paste, which you should grade text-only.",
    "",
    "When you have video, the visual layer is critical for SE. Watch for:",
    "  - PAUSES + UPWARD/DISTANT GAZE: the practitioner asks a probing question, the interlocutor pauses 2+ seconds with eyes drifting up/away. This is critical reflection — the SE-essential signal.",
    "  - Body-language shifts (leaning in, slowing down, going quiet) that indicate genuine engagement.",
    "  - Tone changes — a softening or thoughtful slowdown vs. defensive escalation.",
    "  - Facial cues — surprise, contemplation, dawning realization vs. dismissal or annoyance.",
    "  - Pace — does the practitioner give space for thinking, or rush past it?",
    "",
    "Score definitions:",
    '  - "green": clear positive evidence the practitioner used the recommended practice.',
    '  - "grey": mixed evidence OR insufficient evidence either way.',
    '  - "red":  clear evidence of the inappropriate / detrimental practice.',
    '  - "na":   the criterion does not apply to this conversation. Use sparingly; prefer "grey" when uncertain.',
    "",
    "Scoring rules:",
    "1. Identify which speaker is the SE practitioner (the one asking probing questions about beliefs, not the believer).",
    "2. For every criterion, judge ONLY the practitioner's behavior — not the interlocutor's.",
    "3. For each score, provide:",
    "   - rationale (1–2 sentences),",
    "   - quote (a short verbatim line from the conversation, ≤30 words, when applicable; otherwise empty),",
    "   - visualCue (a short observation about visible behavior — e.g. 'interlocutor pauses ~5s, eyes up-left, then says...'; empty when text-only or no relevant visual moment).",
    "4. Be conservative on the six SE Essentials (#1, #17, #18, #19, #37, #38). Mark them green only with clear positive evidence; otherwise grey.",
    "5. CRITICAL REFLECTION (#19): only green when you observe specific moments where the practitioner's question successfully prompted the interlocutor into visible deep thinking — pause, look-up, slowed speech, hedging language like 'hmm I never thought of that.' Without those moments, max grey.",
    "6. If a phase is absent (e.g., no closing), mark phase-specific criteria 'na', not 'red'.",
    "7. Provide a 3–5 sentence narrative summarizing strengths, weaknesses, and whether this counts as SE.",
    "",
    "Be calibrated. Don't be charitable to confrontational debate framed as SE. Don't penalize legitimate clarification questions as 'leading'.",
    "Return ONLY the JSON specified by the response schema. Include every criterion ID listed in the rubric.",
  ].join("\n");
}

function buildUserPrompt({ rubric, transcript, practitioner, hasVideo }) {
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

  const lines = [
    `Rubric (★ = SE Essential — must be green for the conversation to count as SE):`,
    "",
    rubricText,
    "",
    practitioner
      ? `The SE practitioner is identified as: ${practitioner}.`
      : "The SE practitioner is not identified — infer from the conversation.",
  ];

  if (hasVideo) {
    lines.push("", "Watch the video above (audio + visuals) and score it. Pay particular attention to visible pauses, looking-up gestures, and body-language shifts that indicate critical reflection.");
  } else if (transcript) {
    lines.push("", `Transcript:\n"""\n${transcript}\n"""`, "", "Score this conversation from the transcript. You won't have visual cues — leave visualCue empty for each criterion and rely on the text.");
  }
  lines.push("", "Return JSON matching the response schema. Include every criterion ID in scores.");
  return lines.join("\n");
}

function buildResponseSchema(rubric) {
  // Gemini's response_schema uses a subset of OpenAPI 3.0 schemas.
  const allIds = rubric.sections.flatMap((s) => s.criteria.map((c) => c.id));
  return {
    type: "object",
    properties: {
      practitionerIdentified: {
        type: "string",
        description: "Name or short identifier of the SE practitioner.",
      },
      narrative: {
        type: "string",
        description: "3–5 sentence overall summary: strengths, weaknesses, and whether this counts as SE.",
      },
      scores: {
        type: "array",
        description: "One entry per rubric criterion. Include every ID.",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            value: { type: "string", enum: ["green", "grey", "red", "na"] },
            rationale: { type: "string", description: "1–2 sentences justifying the score." },
            quote: { type: "string", description: "Short verbatim quote (≤30 words) or empty." },
            visualCue: { type: "string", description: "Visible behavior supporting the score, or empty if text-only or none observed." },
          },
          required: ["id", "value", "rationale"],
        },
      },
    },
    required: ["scores", "narrative"],
    propertyOrdering: ["practitionerIdentified", "narrative", "scores"],
  };
}

// ----- helpers -----

function readJsonBody(req) {
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
