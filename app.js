// SE Conversation Grader — frontend
//
// Loads the rubric from rubric.json, posts the YouTube URL (or pasted
// transcript) to the configured Cloudflare Worker, and renders the results.

// Default to a same-origin Vercel API route. Users on a different host (or
// running the page from disk) can override this in the Advanced section.
const DEFAULT_BACKEND = "/api";

const els = {
  form: document.getElementById("grade-form"),
  videoUrl: document.getElementById("video-url"),
  practitioner: document.getElementById("practitioner"),
  transcript: document.getElementById("transcript"),
  backendUrl: document.getElementById("backend-url"),
  submit: document.getElementById("submit-btn"),
  statusCard: document.getElementById("status-card"),
  statusText: document.getElementById("status-text"),
  errorCard: document.getElementById("error-card"),
  errorMessage: document.getElementById("error-message"),
  results: document.getElementById("results"),
  verdict: document.getElementById("verdict"),
  gradeLetter: document.getElementById("grade-letter"),
  gradePct: document.getElementById("grade-pct"),
  gradeDetail: document.getElementById("grade-detail"),
  meta: document.getElementById("meta"),
  essentials: document.getElementById("essentials-list"),
  sections: document.getElementById("sections"),
  notes: document.getElementById("ai-notes"),
  copyJson: document.getElementById("copy-json"),
  newGrade: document.getElementById("new-grade"),
  steps: {
    fetch: document.getElementById("step-fetch"),
    analyze: document.getElementById("step-analyze"),
    render: document.getElementById("step-render"),
  },
};

let RUBRIC = null;
let LAST_RESULT = null; // { scores: { [id]: {value, rationale, quote} }, narrative, transcriptPreview, videoMeta }

// ----- bootstrap -----
init().catch((err) => {
  console.error(err);
  showError("Couldn't load the rubric. " + err.message);
});

async function init() {
  // Prefer the inlined rubric (works from file:// AND http://). Fall back to
  // fetching rubric.json if needed.
  if (window.SE_RUBRIC) {
    RUBRIC = window.SE_RUBRIC;
  } else {
    try {
      const r = await fetch("./rubric.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("rubric.json missing (HTTP " + r.status + ")");
      RUBRIC = await r.json();
    } catch (err) {
      throw new Error(
        "Couldn't load the rubric. If you opened index.html directly from disk, " +
        "use a local server (e.g. `python3 -m http.server 8000`) — or make sure " +
        "rubric.js is in the same folder as index.html. Underlying error: " + err.message
      );
    }
  }

  // Restore stored backend URL
  const saved = localStorage.getItem("se_grader_backend") || DEFAULT_BACKEND;
  if (saved) els.backendUrl.value = saved;

  els.form.addEventListener("submit", onSubmit);
  els.copyJson.addEventListener("click", copyJson);
  els.newGrade.addEventListener("click", reset);
}

// ----- submit handler -----
async function onSubmit(e) {
  e.preventDefault();
  hideError();

  // Validate inputs up front with clear user-visible errors, since the
  // browser's native `required` validation tooltip is easy to miss.
  const videoUrl = (els.videoUrl.value || "").trim();
  const transcript = (els.transcript.value || "").trim();
  if (!videoUrl && !transcript) {
    showError("Paste a YouTube link in the field above before clicking Grade.");
    els.videoUrl.focus();
    return;
  }
  if (videoUrl && !/^https?:\/\//i.test(videoUrl)) {
    showError("That doesn't look like a URL. Try a YouTube link starting with https://");
    els.videoUrl.focus();
    return;
  }

  els.results.classList.add("hidden");
  els.statusCard.classList.remove("hidden");
  els.submit.disabled = true;

  const backend = (els.backendUrl.value || "").trim();
  if (!backend) {
    els.submit.disabled = false;
    els.statusCard.classList.add("hidden");
    showError(
      "Backend URL not set. Open the Advanced section and paste your deployed Cloudflare Worker URL."
    );
    return;
  }
  localStorage.setItem("se_grader_backend", backend);

  setStep("fetch", "active");
  els.statusText.textContent = "Fetching transcript…";

  try {
    const res = await fetch(backend.replace(/\/$/, "") + "/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoUrl: els.videoUrl.value.trim(),
        practitioner: els.practitioner.value.trim() || null,
        transcript: els.transcript.value.trim() || null,
        rubric: RUBRIC,
      }),
    });

    if (!res.ok) {
      let msg = "Backend returned HTTP " + res.status;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }

    setStep("fetch", "done");
    setStep("analyze", "active");
    els.statusText.textContent = "Scoring against rubric…";

    const data = await res.json();
    setStep("analyze", "done");
    setStep("render", "active");
    els.statusText.textContent = "Preparing results…";

    LAST_RESULT = data;
    render(data);
    setStep("render", "done");
    els.statusCard.classList.add("hidden");
  } catch (err) {
    console.error(err);
    els.statusCard.classList.add("hidden");
    showError(err.message || String(err));
  } finally {
    els.submit.disabled = false;
  }
}

function setStep(name, state) {
  const el = els.steps[name];
  if (!el) return;
  el.classList.remove("active", "done");
  if (state) el.classList.add(state);
}

// ----- rendering -----
function render(data) {
  els.results.classList.remove("hidden");
  renderEssentials(data);
  renderSections(data);
  renderSummary(data);
  els.notes.textContent = data.narrative || "(no narrative provided)";
  if (data.videoMeta && data.videoMeta.title) {
    els.meta.textContent = `Video: ${data.videoMeta.title}` +
      (data.videoMeta.channel ? ` — ${data.videoMeta.channel}` : "");
  } else {
    els.meta.textContent = "";
  }
}

function getScore(id) {
  const s = LAST_RESULT.scores && LAST_RESULT.scores[id];
  if (!s) return { value: "na" };
  return s;
}

function setScore(id, value) {
  if (!LAST_RESULT.scores) LAST_RESULT.scores = {};
  LAST_RESULT.scores[id] = { ...(LAST_RESULT.scores[id] || {}), value };
  // Re-render bits that depend on values
  renderEssentials(LAST_RESULT);
  renderSummary(LAST_RESULT);
  // Update controls visual state for this row
  document.querySelectorAll(`.criterion[data-id="${id}"] .controls button`).forEach((b) => {
    b.classList.toggle("active", b.dataset.value === value);
  });
  const pip = document.querySelector(`.criterion[data-id="${id}"] .pip`);
  if (pip) {
    pip.className = "pip " + value;
    pip.textContent = pipLabel(value);
  }
}

function renderEssentials(data) {
  const ids = RUBRIC.essentialIds;
  const flat = flattenCriteria();
  els.essentials.innerHTML = "";
  for (const id of ids) {
    const c = flat.find((x) => x.id === id);
    if (!c) continue;
    const s = getScore(id);
    const li = document.createElement("li");
    const pip = document.createElement("span");
    pip.className = "pip " + (s.value || "na");
    pip.textContent = pipLabel(s.value);
    const text = document.createElement("div");
    text.className = "ess-text";
    text.innerHTML = `<span class="num">#${c.id}</span><strong>${escapeHtml(c.recommended)}</strong>`;
    li.appendChild(pip);
    li.appendChild(text);
    els.essentials.appendChild(li);
  }
}

function renderSections(data) {
  els.sections.innerHTML = "";
  for (const section of RUBRIC.sections) {
    const wrap = document.createElement("div");
    wrap.className = "section";
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `<h3>Section ${section.id}: ${escapeHtml(section.title)}</h3><span class="section-score" data-section="${section.id}"></span>`;
    wrap.appendChild(head);
    for (const c of section.criteria) {
      wrap.appendChild(renderCriterion(c));
    }
    els.sections.appendChild(wrap);
  }
  updateSectionScores();
}

function renderCriterion(c) {
  const isEssential = RUBRIC.essentialIds.includes(c.id);
  const s = getScore(c.id);
  const div = document.createElement("div");
  div.className = "criterion" + (isEssential ? " essential" : "");
  div.dataset.id = c.id;
  div.innerHTML = `
    <div class="num">#${c.id}</div>
    <div class="pip ${s.value || "na"}">${pipLabel(s.value)}</div>
    <div class="body">
      <div class="recommended">${escapeHtml(c.recommended)}</div>
      <div class="detrimental">vs. ${escapeHtml(c.detrimental)}</div>
      ${s.rationale ? `<div class="rationale">${escapeHtml(s.rationale)}</div>` : ""}
      ${s.quote ? `<div class="quote">${escapeHtml(s.quote)}</div>` : ""}
      ${s.visualCue ? `<div class="visual-cue">👁 ${escapeHtml(s.visualCue)}</div>` : ""}
      <div class="controls">
        <button type="button" data-value="green" class="${s.value === "green" ? "active green" : "green"}">Green</button>
        <button type="button" data-value="grey"  class="${s.value === "grey"  ? "active grey"  : "grey"}">Mixed / NE</button>
        <button type="button" data-value="red"   class="${s.value === "red"   ? "active red"   : "red"}">Red</button>
        <button type="button" data-value="na"    class="${s.value === "na"    ? "active"       : ""}">N/A</button>
      </div>
    </div>
  `;
  div.querySelectorAll(".controls button").forEach((btn) => {
    btn.addEventListener("click", () => {
      setScore(c.id, btn.dataset.value);
      updateSectionScores();
    });
  });
  return div;
}

function renderSummary(data) {
  const tally = computeTally();
  els.gradePct.textContent = tally.pct.toFixed(0) + "%";
  els.gradeDetail.textContent =
    `${tally.scored} of ${tally.total} criteria scored — ` +
    `${tally.green} green, ${tally.grey} grey, ${tally.red} red` +
    (tally.na ? `, ${tally.na} N/A` : "");
  els.gradeLetter.textContent = letterGrade(tally.pct);

  const allEssentialsGreen = RUBRIC.essentialIds.every(
    (id) => (getScore(id).value) === "green"
  );
  els.verdict.className = "verdict " + (allEssentialsGreen ? "pass" : "fail");
  els.verdict.textContent = allEssentialsGreen
    ? "Counts as Street Epistemology"
    : "Does not count as Street Epistemology (one or more Essentials not green)";
}

function updateSectionScores() {
  for (const section of RUBRIC.sections) {
    const ids = section.criteria.map((c) => c.id);
    let earned = 0, denom = 0;
    for (const id of ids) {
      const v = getScore(id).value;
      if (v === "na" || v == null) continue;
      denom += 1;
      if (v === "green") earned += 1;
      else if (v === "grey") earned += 0.5;
    }
    const pct = denom ? Math.round((earned / denom) * 100) : null;
    const span = document.querySelector(`.section-score[data-section="${section.id}"]`);
    if (span) span.textContent = pct == null ? "—" : `${pct}% (${earned} of ${denom})`;
  }
}

function computeTally() {
  let green = 0, grey = 0, red = 0, na = 0, total = 0, earned = 0, denom = 0;
  for (const section of RUBRIC.sections) {
    for (const c of section.criteria) {
      total += 1;
      const v = (LAST_RESULT.scores[c.id] || {}).value;
      if (v === "green") { green += 1; earned += 1; denom += 1; }
      else if (v === "grey") { grey += 1; earned += 0.5; denom += 1; }
      else if (v === "red") { red += 1; denom += 1; }
      else if (v === "na") { na += 1; }
      else { na += 1; }
    }
  }
  const pct = denom ? (earned / denom) * 100 : 0;
  return { green, grey, red, na, total, scored: denom, pct };
}

function letterGrade(pct) {
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  return "F";
}

function flattenCriteria() {
  return RUBRIC.sections.flatMap((s) => s.criteria);
}

function pipLabel(v) {
  if (v === "green") return "✓";
  if (v === "grey") return "~";
  if (v === "red") return "✕";
  return "–";
}

// ----- utils -----
function showError(msg) {
  els.errorMessage.textContent = msg;
  els.errorCard.classList.remove("hidden");
}
function hideError() { els.errorCard.classList.add("hidden"); }

function reset() {
  els.results.classList.add("hidden");
  els.form.reset();
  // Keep the saved backend URL
  const saved = localStorage.getItem("se_grader_backend") || "";
  els.backendUrl.value = saved;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function copyJson() {
  if (!LAST_RESULT) return;
  const txt = JSON.stringify(LAST_RESULT, null, 2);
  navigator.clipboard.writeText(txt).then(() => {
    els.copyJson.textContent = "Copied!";
    setTimeout(() => (els.copyJson.textContent = "Copy raw JSON"), 1500);
  });
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
