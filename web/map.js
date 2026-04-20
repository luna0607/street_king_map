const US_CENTER = [39.5, -98.35];
const US_ZOOM = 4;

const map = L.map("map").setView(US_CENTER, US_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

const status = document.getElementById("status");

Promise.all([
  fetch("../data/videos.json").then((r) => r.json()),
  fetch("../data/locations.json").then((r) => r.json()),
])
  .then(([videos, locations]) => render(videos, locations))
  .catch((err) => {
    status.textContent = "Failed to load data";
    console.error(err);
  });

function render(videos, locations) {
  const videoByBv = new Map(videos.map((v) => [v.bv, v]));
  const markers = [];
  let missingCoords = 0;

  for (const [bv, locs] of Object.entries(locations)) {
    const video = videoByBv.get(bv);
    if (!video) continue;
    for (const loc of locs) {
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
        missingCoords++;
        continue;
      }
      const marker = L.marker([loc.lat, loc.lng]).addTo(map);
      marker.bindPopup(popupHtml(video, loc), { maxWidth: 360, minWidth: 280 });
      markers.push(marker);
    }
  }

  const pieces = [`${markers.length} pin${markers.length === 1 ? "" : "s"}`];
  pieces.push(`${videos.length} videos`);
  if (missingCoords) pieces.push(`${missingCoords} unresolved`);
  status.textContent = pieces.join(" · ");
}

function popupHtml(video, loc) {
  const embed = `https://maps.google.com/maps?q=${loc.lat},${loc.lng}&z=14&output=embed`;
  return `
    <div class="popup">
      <a class="popup-title" href="${esc(video.link)}" target="_blank" rel="noopener">${esc(video.name)}</a>
      <img class="popup-thumb" src="${ensureHttps(video.thumbnail)}" alt="" loading="lazy">
      <div class="popup-meta">
        <span>${esc(video.post_date)}</span>
        <span>·</span>
        <span>${esc(video.length)}</span>
        <span>·</span>
        <span>▶ ${esc(video.visit_volume)}</span>
        <span>·</span>
        <span>💬 ${esc(video.danmu_volume)}</span>
      </div>
      ${loc.place_name ? `<div class="popup-place">📍 ${esc(loc.place_name)}</div>` : ""}
      ${loc.comment ? `<div class="popup-comment">${esc(loc.comment)}</div>` : ""}
      <iframe class="popup-embed" src="${embed}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      ${loc.google_maps_url ? `<a class="popup-gmaps" href="${esc(loc.google_maps_url)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>` : ""}
    </div>
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
