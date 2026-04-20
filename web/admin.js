const STORAGE_KEY = "street_king_map.locations_draft";

const state = {
  videos: [],
  locations: {}, // bv -> [ { place_name, google_maps_url, lat, lng, comment } ]
  filter: "",
};

const listEl = document.getElementById("list");
const statsEl = document.getElementById("stats");
const filterEl = document.getElementById("filter");

filterEl.addEventListener("input", () => {
  state.filter = filterEl.value.trim().toLowerCase();
  renderList();
});

document.getElementById("download").addEventListener("click", download);
document.getElementById("reload").addEventListener("click", reloadFromDisk);

boot();

async function boot() {
  const [videos, baseLocations] = await Promise.all([
    fetch("../data/videos.json").then((r) => r.json()),
    fetch("../data/locations.json").then((r) => r.json()),
  ]);
  state.videos = videos;
  const draft = loadDraft();
  state.locations = draft ?? baseLocations ?? {};
  renderList();
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.locations));
  updateStats();
}

async function reloadFromDisk() {
  if (!confirm("Discard local edits and reload data/locations.json from disk?")) return;
  localStorage.removeItem(STORAGE_KEY);
  await boot();
}

function download() {
  const cleaned = {};
  for (const [bv, locs] of Object.entries(state.locations)) {
    if (locs && locs.length) cleaned[bv] = locs;
  }
  const blob = new Blob([JSON.stringify(cleaned, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "locations.json";
  a.click();
  URL.revokeObjectURL(url);
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

  // Wire up forms per card.
  for (const card of listEl.querySelectorAll(".card")) {
    const bv = card.dataset.bv;
    card.querySelector(".add-form").addEventListener("submit", (e) => handleAdd(e, bv));
    for (const del of card.querySelectorAll("[data-action=remove]")) {
      del.addEventListener("click", () => removeLocation(bv, +del.dataset.idx));
    }
    const urlInput = card.querySelector("input[name=google_maps_url]");
    urlInput.addEventListener("input", () => {
      const hint = card.querySelector(".coord-hint");
      const c = parseCoords(urlInput.value);
      hint.textContent = c ? `→ ${c.lat}, ${c.lng}` : urlInput.value ? "(no coords in URL — will be resolved by script)" : "";
    });
  }

  updateStats();
}

function renderCard(v) {
  const locs = state.locations[v.bv] || [];
  const locRows = locs
    .map((loc, i) => {
      const coords =
        Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
          ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`
          : `<span class="warn">unresolved</span>`;
      return `
        <li>
          <div class="loc-row">
            <span class="place">${esc(loc.place_name || "(unnamed)")}</span>
            <span class="coords">${coords}</span>
            <button type="button" class="icon-btn" data-action="remove" data-idx="${i}" title="Remove">×</button>
          </div>
          ${loc.google_maps_url ? `<a class="url" href="${esc(loc.google_maps_url)}" target="_blank" rel="noopener">${esc(loc.google_maps_url)}</a>` : ""}
          ${loc.comment ? `<div class="comment">${esc(loc.comment)}</div>` : ""}
        </li>`;
    })
    .join("");

  return `
    <article class="card" data-bv="${esc(v.bv)}">
      <a class="card-thumb" href="${esc(v.link)}" target="_blank" rel="noopener">
        <img src="${ensureHttps(v.thumbnail)}" alt="" loading="lazy">
      </a>
      <div class="card-body">
        <div class="card-head">
          <a class="card-title" href="${esc(v.link)}" target="_blank" rel="noopener">${esc(v.name)}</a>
          <div class="card-meta">${esc(v.post_date)} · ${esc(v.length)} · ${esc(v.bv)}</div>
        </div>
        <ul class="locations">${locRows || `<li class="muted">No locations yet</li>`}</ul>
        <form class="add-form">
          <input type="text" name="place_name" placeholder="Place name (optional)">
          <input type="url" name="google_maps_url" placeholder="Google Maps URL" required>
          <span class="coord-hint"></span>
          <input type="text" name="comment" placeholder="Comment (optional)">
          <button class="btn" type="submit">Add pin</button>
        </form>
      </div>
    </article>`;
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
  (state.locations[bv] ??= []).push(loc);
  saveDraft();
  renderList();
}

function removeLocation(bv, idx) {
  const list = state.locations[bv];
  if (!list) return;
  list.splice(idx, 1);
  if (!list.length) delete state.locations[bv];
  saveDraft();
  renderList();
}

function updateStats() {
  let pinned = 0;
  let unresolved = 0;
  let videosWith = 0;
  for (const [, locs] of Object.entries(state.locations)) {
    if (!locs || !locs.length) continue;
    videosWith++;
    for (const loc of locs) {
      pinned++;
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) unresolved++;
    }
  }
  statsEl.textContent = `${videosWith}/${state.videos.length} videos · ${pinned} pins${unresolved ? ` (${unresolved} unresolved)` : ""}`;
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
