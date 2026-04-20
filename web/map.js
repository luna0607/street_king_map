const US_CENTER = [39.5, -98.35];
const US_ZOOM = 4;
const FOCUS_ZOOM = 8;

const map = L.map("map", { zoomControl: false }).setView(US_CENTER, US_ZOOM);
L.control.zoom({ position: "bottomright" }).addTo(map);
// Carto Voyager — cleaner, higher-DPI tiles than default OSM.
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20,
}).addTo(map);

const primaryIcon = L.divIcon({
  className: "marker marker-primary",
  html: `<svg viewBox="0 0 28 36" width="28" height="36"><path d="M14 0C6.3 0 0 6.3 0 14c0 10 14 22 14 22s14-12 14-22C28 6.3 21.7 0 14 0z" fill="currentColor"/><circle cx="14" cy="14" r="5.5" fill="#fff"/></svg>`,
  iconSize: [28, 36],
  iconAnchor: [14, 36],
});
const primaryIconActive = L.divIcon({
  className: "marker marker-primary active",
  html: primaryIcon.options.html,
  iconSize: [34, 44],
  iconAnchor: [17, 44],
});

const primaryLayer = L.layerGroup().addTo(map);
const secondaryLayer = L.layerGroup().addTo(map);
const primaryMarkers = new Map(); // bv -> marker

const statusEl = document.getElementById("status");
const panelEl = document.getElementById("panel");
const panelBody = document.getElementById("panel-body");
const panelClose = document.getElementById("panel-close");

let videoByBv = new Map();
let locationsByBv = {};
let selectedBv = null;
let selectedLocIdx = 0;

panelClose.addEventListener("click", closePanel);
map.on("click", closePanel); // clicking empty map area closes panel
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

load();

async function load() {
  try {
    const [videos, locations] = await Promise.all([
      fetch("../data/videos.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("../data/locations.json", { cache: "no-store" }).then((r) => r.json()),
    ]);
    videoByBv = new Map(videos.map((v) => [v.bv, v]));
    locationsByBv = locations || {};
    render(videos);
    // If a panel was open, keep it in sync with refreshed data.
    if (selectedBv && videoByBv.has(selectedBv)) renderPanel();
  } catch (err) {
    statusEl.textContent = "Failed to load data";
    console.error(err);
  }
}

function render(videos) {
  primaryLayer.clearLayers();
  secondaryLayer.clearLayers();
  primaryMarkers.clear();
  let videoCount = 0;
  let pinCount = 0;
  let unresolved = 0;

  for (const [bv, locs] of Object.entries(locationsByBv)) {
    const video = videoByBv.get(bv);
    if (!video || !Array.isArray(locs) || !locs.length) continue;
    for (const loc of locs) {
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) unresolved++;
      else pinCount++;
    }
    const primary = locs.find((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
    if (!primary) continue;
    const marker = L.marker([primary.lat, primary.lng], { icon: primaryIcon, riseOnHover: true });
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      selectVideo(bv);
    });
    marker.addTo(primaryLayer);
    primaryMarkers.set(bv, marker);
    videoCount++;
  }

  const pieces = [`${videoCount} videos`, `${pinCount} pin${pinCount === 1 ? "" : "s"}`];
  if (unresolved) pieces.push(`${unresolved} unresolved`);
  pieces.push(`${videos.length} total`);
  statusEl.textContent = pieces.join(" · ");
}

function selectVideo(bv) {
  const prev = selectedBv;
  if (prev === bv) {
    renderPanel();
    return;
  }
  if (prev && primaryMarkers.has(prev)) {
    primaryMarkers.get(prev).setIcon(primaryIcon);
  }
  selectedBv = bv;
  selectedLocIdx = 0;
  if (primaryMarkers.has(bv)) primaryMarkers.get(bv).setIcon(primaryIconActive);
  renderSecondaryMarkers();
  flyToLocation(0);
  openPanel();
}

function flyToLocation(idx) {
  const locs = (locationsByBv[selectedBv] || []).filter(
    (l) => Number.isFinite(l.lat) && Number.isFinite(l.lng),
  );
  const loc = locs[idx];
  if (!loc) return;
  map.flyTo([loc.lat, loc.lng], FOCUS_ZOOM, { duration: 0.75 });
}

function renderSecondaryMarkers() {
  secondaryLayer.clearLayers();
  const locs = locationsByBv[selectedBv] || [];
  let primarySeen = false;
  locs.forEach((loc, i) => {
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
    if (!primarySeen) { primarySeen = true; return; } // skip the first resolved loc (primary)
    const m = L.circleMarker([loc.lat, loc.lng], {
      radius: 8,
      color: "#fff",
      weight: 2,
      fillColor: "#f0a75b",
      fillOpacity: 1,
    });
    m.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      focusLocation(i);
    });
    m.addTo(secondaryLayer);
  });
}

function focusLocation(idx) {
  selectedLocIdx = idx;
  renderPanel();
  flyToLocation(idx);
  const card = panelBody.querySelector(`[data-loc-idx="${idx}"]`);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openPanel() {
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  renderPanel();
  // Let Leaflet recompute size now that the map container shrank.
  requestAnimationFrame(() => map.invalidateSize());
}

function closePanel() {
  if (!selectedBv) return;
  if (primaryMarkers.has(selectedBv)) primaryMarkers.get(selectedBv).setIcon(primaryIcon);
  selectedBv = null;
  panelEl.hidden = true;
  document.body.classList.remove("panel-open");
  secondaryLayer.clearLayers();
  requestAnimationFrame(() => map.invalidateSize());
}

function renderPanel() {
  if (!selectedBv) return;
  const video = videoByBv.get(selectedBv);
  if (!video) return;
  const locs = (locationsByBv[selectedBv] || []).filter(
    (l) => Number.isFinite(l.lat) && Number.isFinite(l.lng),
  );

  panelBody.innerHTML = `
    <a class="panel-thumb-link" href="${esc(video.link)}" target="_blank" rel="noopener">
      <img class="panel-thumb" src="${ensureHttps(video.thumbnail)}" alt="" referrerpolicy="no-referrer">
    </a>
    <h2 class="panel-title">
      <a href="${esc(video.link)}" target="_blank" rel="noopener">${esc(video.name)}</a>
    </h2>
    <div class="panel-meta">
      <span>${esc(video.post_date)}</span>
      <span>·</span><span>${esc(video.length)}</span>
      <span>·</span><span>▶ ${esc(video.visit_volume)}</span>
      <span>·</span><span>💬 ${esc(video.danmu_volume)}</span>
    </div>
    ${locs.length > 1 ? `<div class="panel-hint">${locs.length} locations — primary in blue, others in orange on the map</div>` : ""}
    <ol class="panel-locs">${locs.map((loc, i) => renderLocCard(loc, i)).join("")}</ol>
  `;

  for (const card of panelBody.querySelectorAll("[data-loc-idx]")) {
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, iframe")) return; // don't hijack links/iframes
      focusLocation(+card.dataset.locIdx);
    });
  }
}

function renderLocCard(loc, idx) {
  const active = idx === selectedLocIdx;
  const embed = `https://maps.google.com/maps?q=${loc.lat},${loc.lng}&z=14&output=embed`;
  const badgeColor = idx === 0 ? "var(--accent-blue)" : "var(--accent-orange)";
  return `
    <li class="loc-card ${active ? "active" : ""}" data-loc-idx="${idx}">
      <div class="loc-head">
        <span class="loc-num" style="background:${badgeColor}">${idx + 1}</span>
        <span class="loc-place">${esc(loc.place_name || "(unnamed)")}</span>
      </div>
      ${loc.comment ? `<p class="loc-comment">${esc(loc.comment)}</p>` : ""}
      <iframe class="loc-embed" src="${embed}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      ${loc.google_maps_url ? `<a class="loc-gmaps" href="${esc(loc.google_maps_url)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>` : ""}
    </li>
  `;
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
