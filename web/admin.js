const LIVE_MODE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
const CONTRIB_KEY = "street_king_map.contributions";

const state = {
  videos: [],
  baseline: {},      // bv -> [loc]  — from data/locations.json (read-only for contributors)
  contributions: {}, // bv -> [loc]  — additions made in this browser (contributor mode only)
  filter: "",
};

const listEl = document.getElementById("list");
const statsEl = document.getElementById("stats");
const saveStatusEl = document.getElementById("save-status");
const filterEl = document.getElementById("filter");
const hintEl = document.getElementById("hint");
const exportBtn = document.getElementById("download");
const reloadBtn = document.getElementById("reload");

filterEl.addEventListener("input", () => {
  state.filter = filterEl.value.trim().toLowerCase();
  renderList();
});

exportBtn.addEventListener("click", download);
reloadBtn.addEventListener("click", reloadFromDisk);

document.body.classList.toggle("contributor-mode", !LIVE_MODE);
setupHint();
boot();

function setupHint() {
  if (LIVE_MODE) {
    hintEl.innerHTML = `
      Run <code>python3 scripts/serve.py</code> and every <strong>Add pin</strong> / remove writes directly to
      <code>data/locations.json</code>. Paste a Google Maps URL — coords are extracted client-side when the URL
      contains them (<code>@lat,lng</code>, <code>!3d…!4d…</code>, <code>q=/ll=</code>).
      For short URLs (<code>maps.app.goo.gl</code>) run <code>python3 scripts/resolve_locations.py</code> once after adding.`;
    exportBtn.textContent = "Export";
    exportBtn.title = "Download a copy of the current data/locations.json";
  } else {
    hintEl.innerHTML = `
      <strong>Contributor mode.</strong> You can add pins to any video below — they live in this browser only.
      When done, click <strong>Export contributions</strong> to download a small JSON file of your additions,
      then send it to the repo owner
      (<a href="https://github.com/luna0607/street_king_map/issues/new?title=Location+contributions&body=Attach+contributions.json" target="_blank" rel="noopener">open a GitHub issue</a>
      or email) so they can merge it.`;
    exportBtn.textContent = "Export contributions";
    exportBtn.title = "Download only your additions";
    exportBtn.classList.add("primary");
    reloadBtn.textContent = "Discard my edits";
  }
}

async function boot() {
  const [videos, baseline] = await Promise.all([
    fetch("../data/videos.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("../data/locations.json", { cache: "no-store" }).then((r) => r.json()),
  ]);
  state.videos = videos;
  state.baseline = baseline || {};
  if (!LIVE_MODE) state.contributions = loadContributions();
  await migrateLegacyDraft();
  renderList();
}

function loadContributions() {
  try {
    const raw = localStorage.getItem(CONTRIB_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveContributions() {
  localStorage.setItem(CONTRIB_KEY, JSON.stringify(state.contributions));
}

// One-time migration: import any pins left in the old localStorage draft.
async function migrateLegacyDraft() {
  const LEGACY_KEY = "street_king_map.locations_draft";
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  let draft;
  try { draft = JSON.parse(raw); } catch { localStorage.removeItem(LEGACY_KEY); return; }
  let imported = 0;
  const target = LIVE_MODE ? state.baseline : state.contributions;
  for (const [bv, locs] of Object.entries(draft || {})) {
    if (!Array.isArray(locs) || !locs.length) continue;
    const existingBaseline = new Set((state.baseline[bv] || []).map((l) => l.google_maps_url));
    const existingContrib = new Set((state.contributions[bv] || []).map((l) => l.google_maps_url));
    for (const loc of locs) {
      if (existingBaseline.has(loc.google_maps_url) || existingContrib.has(loc.google_maps_url)) continue;
      (target[bv] ??= []).push(loc);
      imported++;
    }
  }
  if (imported > 0) {
    if (LIVE_MODE) await persistLive();
    else saveContributions();
    console.log(`migrated ${imported} pins from old localStorage draft`);
  }
  localStorage.removeItem(LEGACY_KEY);
}

async function reloadFromDisk() {
  if (!LIVE_MODE) {
    if (!confirm("Discard all your local contributions?")) return;
    localStorage.removeItem(CONTRIB_KEY);
    state.contributions = {};
    renderList();
    setSaveStatus("discarded", "ok");
    return;
  }
  await boot();
  setSaveStatus("reloaded", "ok");
}

async function persistLive() {
  setSaveStatus("saving…", "pending");
  try {
    const resp = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.baseline),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    setSaveStatus("saved ✓", "ok");
  } catch (err) {
    console.error(err);
    setSaveStatus(`save failed (${err.message}) — start scripts/serve.py`, "err");
  }
  updateStats();
}

function persist() {
  if (LIVE_MODE) {
    persistLive();
  } else {
    saveContributions();
    setSaveStatus("saved to browser ✓", "ok");
    updateStats();
  }
}

function setSaveStatus(text, kind) {
  saveStatusEl.textContent = text;
  saveStatusEl.dataset.kind = kind || "";
}

function download() {
  let payload;
  let filename;
  if (LIVE_MODE) {
    payload = stripEmpty(state.baseline);
    filename = "locations.json";
  } else {
    payload = stripEmpty(state.contributions);
    filename = "contributions.json";
    if (!Object.keys(payload).length) {
      alert("No contributions yet. Add at least one pin before exporting.");
      return;
    }
  }
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v && v.length) out[k] = v;
  return out;
}

function renderList() {
  const q = state.filter;
  const videos = state.videos.filter((v) => {
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) ||
      v.post_date.includes(q) ||
      (v.bv || "").toLowerCase().includes(q)
    );
  });

  listEl.innerHTML = videos.map(renderCard).join("");

  for (const card of listEl.querySelectorAll(".card")) {
    const bv = card.dataset.bv;
    card.querySelector(".add-form").addEventListener("submit", (e) => handleAdd(e, bv));
    for (const del of card.querySelectorAll("[data-action=remove]")) {
      del.addEventListener("click", () =>
        removeLocation(bv, +del.dataset.idx, del.dataset.src),
      );
    }
    const urlInput = card.querySelector("input[name=google_maps_url]");
    urlInput.addEventListener("input", () => {
      const hint = card.querySelector(".coord-hint");
      const c = parseCoords(urlInput.value);
      hint.textContent = c
        ? `→ ${c.lat}, ${c.lng}`
        : urlInput.value
          ? "(no coords in URL — will be resolved by script)"
          : "";
    });
  }

  updateStats();
}

function renderCard(v) {
  const baselineLocs = state.baseline[v.bv] || [];
  const contribLocs = state.contributions[v.bv] || [];
  const rows = [
    ...baselineLocs.map((loc, i) => renderLocRow(loc, i, "baseline")),
    ...contribLocs.map((loc, i) => renderLocRow(loc, i, "contrib")),
  ].join("");

  return `
    <article class="card" data-bv="${esc(v.bv)}">
      <a class="card-thumb" href="${esc(v.link)}" target="_blank" rel="noopener">
        <img src="${ensureHttps(v.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      </a>
      <div class="card-body">
        <div class="card-head">
          <a class="card-title" href="${esc(v.link)}" target="_blank" rel="noopener">${esc(v.name)}</a>
          <div class="card-meta">${esc(v.post_date)} · ${esc(v.length)} · ${esc(v.bv)}</div>
        </div>
        <ul class="locations">${rows || `<li class="muted">No locations yet</li>`}</ul>
        <form class="add-form">
          <input type="text" name="place_name" placeholder="Place name (optional)">
          <input type="url" name="google_maps_url" placeholder="Google Maps URL" required>
          <span class="coord-hint"></span>
          <input type="text" name="comment" placeholder="Comment (optional)">
          <button class="btn primary" type="submit">Add pin</button>
        </form>
      </div>
    </article>`;
}

function renderLocRow(loc, idx, src) {
  const coords =
    Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
      ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`
      : `<span class="warn">unresolved</span>`;
  const isBaseline = src === "baseline";
  const canRemove = LIVE_MODE || !isBaseline;
  const tag = !LIVE_MODE && !isBaseline
    ? `<span class="badge badge-new">new</span>`
    : "";
  return `
    <li class="${!isBaseline ? "is-contrib" : ""}">
      <div class="loc-row">
        ${tag}
        <span class="place">${esc(loc.place_name || "(unnamed)")}</span>
        <span class="coords">${coords}</span>
        ${canRemove ? `<button type="button" class="icon-btn" data-action="remove" data-idx="${idx}" data-src="${src}" title="Remove">×</button>` : ""}
      </div>
      ${loc.google_maps_url ? `<a class="url" href="${esc(loc.google_maps_url)}" target="_blank" rel="noopener">${esc(loc.google_maps_url)}</a>` : ""}
      ${loc.comment ? `<div class="comment">${esc(loc.comment)}</div>` : ""}
    </li>`;
}

function handleAdd(e, bv) {
  e.preventDefault();
  const form = e.currentTarget;
  const data = new FormData(form);
  const url = String(data.get("google_maps_url") || "").trim();
  if (!url) return;
  const coords = parseCoords(url);
  const loc = {
    place_name: String(data.get("place_name") || "").trim(),
    google_maps_url: url,
    comment: String(data.get("comment") || "").trim(),
  };
  if (coords) {
    loc.lat = coords.lat;
    loc.lng = coords.lng;
  }
  const target = LIVE_MODE ? state.baseline : state.contributions;
  (target[bv] ??= []).push(loc);
  renderList();
  persist();
}

function removeLocation(bv, idx, src) {
  const target = src === "baseline" ? state.baseline : state.contributions;
  if (!LIVE_MODE && src === "baseline") return; // guarded in UI too
  const list = target[bv];
  if (!list) return;
  list.splice(idx, 1);
  if (!list.length) delete target[bv];
  renderList();
  persist();
}

function updateStats() {
  let contribPins = 0;
  let contribVideos = 0;
  for (const [, locs] of Object.entries(state.contributions)) {
    if (!locs || !locs.length) continue;
    contribVideos++;
    contribPins += locs.length;
  }
  let baselinePins = 0;
  let baselineVideos = 0;
  for (const [, locs] of Object.entries(state.baseline)) {
    if (!locs || !locs.length) continue;
    baselineVideos++;
    baselinePins += locs.length;
  }
  if (LIVE_MODE) {
    statsEl.textContent = `${baselineVideos}/${state.videos.length} videos · ${baselinePins} pins`;
  } else {
    statsEl.textContent = contribPins
      ? `${contribPins} contribution${contribPins === 1 ? "" : "s"} across ${contribVideos} video${contribVideos === 1 ? "" : "s"} · ${baselinePins} on map`
      : `${baselinePins} pins on map · none of yours yet`;
  }
}

function parseCoords(url) {
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|center|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return { lat: +m[1], lng: +m[2] };
  }
  return null;
}

function ensureHttps(url) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  return "https://" + url.replace(/^\/+/, "");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
