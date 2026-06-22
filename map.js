const US_CENTER = [39.5, -98.35];
const US_ZOOM = 4;
const FOCUS_ZOOM = 8;

const map = L.map("map", { zoomControl: false }).setView(US_CENTER, US_ZOOM);
map.createPane('activeSecondaryPane');
map.getPane('activeSecondaryPane').style.zIndex = 610;
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
const secondaryIcon = L.divIcon({
  className: "marker marker-secondary",
  html: primaryIcon.options.html,
  iconSize: [18, 23],
  iconAnchor: [9, 23],
});

const globalSecondaryLayer = L.layerGroup().addTo(map);
const primaryLayer = L.layerGroup().addTo(map);
const secondaryLayer = L.layerGroup().addTo(map);
const primaryMarkers = new Map(); // bv -> marker

const statusEl = document.getElementById("status");
const panelEl = document.getElementById("panel");
const panelBody = document.getElementById("panel-body");
const panelClose = document.getElementById("panel-close");
const mapFullscreenBtn = document.getElementById("map-fullscreen");

let videoByBv = new Map();
let locationsByBv = {};
let selectedBv = null;
let selectedLocIdx = 0;

function extractPlaceNameFromGmapsUrl(url) {
  if (!url) return null;
  try {
    const decodedUrl = decodeURIComponent(url);
    // Handle /place/Name/
    let match = decodedUrl.match(/\/maps\/place\/([^/@?]+)/);
    if (match) return match[1].replace(/\+/g, " ");
    // Handle /search/Name/
    match = decodedUrl.match(/\/maps\/search\/([^/@?]+)/);
    if (match) return match[1].replace(/\+/g, " ");
    // Handle q=Name
    const urlObj = new URL(url);
    const q = urlObj.searchParams.get("q");
    if (q) return q;
  } catch (e) {}
  return null;
}

function getProviderUrl(provider, loc) {
  const { lat, lng, google_maps_url, place_name } = loc;
  const extractedName = extractPlaceNameFromGmapsUrl(google_maps_url) || place_name;
  const nameQuery = extractedName ? encodeURIComponent(extractedName) : "";
  switch (provider) {
    case "bing":
      return `https://www.bing.com/maps?q=${nameQuery}&cp=${lat}~${lng}&lvl=15`;
    case "apple":
      return `https://maps.apple.com/?q=${nameQuery}&ll=${lat},${lng}&t=m`;
    default:
      return google_maps_url || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
}

function getEmbedUrl(loc) {
  const { lat, lng } = loc;
  // Always use Google Maps for the iframe preview as it's the most reliable across all regions.
  return `https://maps.google.com/maps?q=${lat},${lng}&z=14&output=embed`;
}

const NEED_MORE_PINS_BVS = new Set(["BV1HR1SBZEvu", "BV1e4421Z7HZ", "BV1txC4BaEqY", "BV1RwJPzKEZh", "BV1QtZwYyErj", "BV1VEsdevEbq", "BV1D9sSejEqy", "BV1XxMgz9Eu7", "BV1DMxkeZE8L", "BV1FbikYDEDH", "BV1LTvNz2Ezc", "BV1aH4y1w7b6", "BV1q94mexEnw", "BV1mH4y1F7sj", "BV1nwecz6Eqm", "BV1UuENz4E4J", "BV13VKweeEdr", "BV1pE4m1R7cZ", "BV1EGtHepEKt", "BV1zQ4LeqEjD", "BV1zXsoz6EF1", "BV1vS411w7bh", "BV15pAdejE8g", "BV1H6HZe7Emo", "BV1pS411w7H9", "BV17eSLYzEDH", "BV13iLxzUEGj", "BV1xx4y1s7Ej", "BV1Ky411v7K4", "BV1fiNizwEkt", "BV1BY5AztEx5", "BV16FfmYsE6n", "BV1GLWczvEsN", "BV1DT421a7TX", "BV1FixWeoEaV", "BV1kGyuB3Eqi", "BV11U411m7uS", "BV19E421w7Mj", "BV1KCWXzMEAy", "BV1DLn2znE2g", "BV1uW42197JH", "BV114421U78a", "BV1jNp4z5E8n", "BV1NdPLexEX7", "BV1UpwReYET5", "BV1Rfb4zZEH4", "BV1Rhn4zBEZJ", "BV1ii421h7cQ", "BV1Xy411e7EZ", "BV1QT421k7bn", "BV1Pf421i7bv", "BV1U2oVYMErk", "BV1k1GvzQE3E", "BV1QadZYaE3R", "BV1VygczBEhg", "BV1uSaGznE2s", "BV1AVHkzcEFE", "BV1sn4y1f7WN", "BV1LKtBehEoo", "BV1hY57zREQX", "BV12o9QYPEPv", "BV1u1USB1EeB", "BV1jmHnztE5x", "BV1QFC6Y7Efp", "BV1EgRiY5E5t", "BV1EpSCYDEi4", "BV1Fpxxz9EFg", "BV13xCRYoESp", "BV1LeHmerEaV", "BV1JfK3zPEEE", "BV1kWqUYGEZc", "BV1fgyxB2ENe", "BV1UfUoYzEgD", "BV1dJFUeWEYH", "BV1z1SFBxEtg"]);

panelClose.addEventListener("click", closePanel);
mapFullscreenBtn.addEventListener("click", () => { closePanel(); window.scrollTo({ top: 0, behavior: "smooth" }); });
map.on("click", closePanel); // clicking empty map area closes panel
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

load();

async function load() {
  try {
    const [videosLegacy, ytVideosLegacy, mergeReview, locations] = await Promise.all([
      fetch("data/videos.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("data/yt_videos.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("data/merge_review.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("data/locations.json", { cache: "no-store" }).then((r) => r.json()),
    ]);

    const videoMap = new Map(); // id (prefer bv) -> { ...video, bilibili, youtube }
    const ytToBv = new Map();   // vid -> bv

    mergeReview.forEach((r) => {
      // Treat as paired if confirmed OR if it's an exact similarity match
      if (r.decision && r.decision.action === "merge" && (r.decision.confirmed || r.decision.similarity === 1.0)) {
        ytToBv.set(r.youtube.vid, r.decision.bv);
      }
    });

    // 1. Process Bilibili videos (main)
    videosLegacy.forEach((v) => {
      videoMap.set(v.bv, { ...v, bilibili: v, youtube: null });
    });

    // 2. Process YouTube videos
    ytVideosLegacy.forEach((v) => {
      const bv = ytToBv.get(v.vid);
      if (bv && videoMap.has(bv)) {
        // It's a pair! Update existing bilibili entry
        videoMap.get(bv).youtube = v;
      } else if (!bv) {
        // Standalone YouTube video
        videoMap.set(v.vid, { ...v, bilibili: null, youtube: v });
      }
    });

    const videos = Array.from(videoMap.values());
    videoByBv = videoMap; 
    locationsByBv = locations || {};
    render(videos);
    // If a panel was open, keep it in sync with refreshed data.
    if (selectedBv && videoByBv.has(selectedBv)) renderPanel();
  } catch (err) {
    statusEl.textContent = "加载数据失败";
    console.error(err);
  }
}

function render(videos) {
  primaryLayer.clearLayers();
  globalSecondaryLayer.clearLayers();
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
    const primaryIdx = locs.findIndex((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
    if (primaryIdx === -1) continue;
    const primary = locs[primaryIdx];
    const marker = L.marker([primary.lat, primary.lng], { icon: primaryIcon, riseOnHover: true });
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      selectVideo(bv, primaryIdx);
    });
    marker.addTo(primaryLayer);
    primaryMarkers.set(bv, marker);
    videoCount++;

    // Add other resolved locations as small grey pins
    locs.forEach((loc, idx) => {
      if (idx === primaryIdx) return;
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
      const secMarker = L.marker([loc.lat, loc.lng], { icon: secondaryIcon, riseOnHover: true });
      secMarker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectVideo(bv, idx);
      });
      secMarker.addTo(globalSecondaryLayer);
    });
  }

  const pieces = [`${videoCount} 个视频`, `${pinCount} 个点位`];
  if (unresolved) pieces.push(`${unresolved} 个未解析点位`);
  pieces.push(`共 ${videos.length} 个视频`);
  statusEl.textContent = pieces.join(" · ");
}

function selectVideo(bv, locIdx = 0) {
  const prev = selectedBv;
  if (prev === bv) {
    if (selectedLocIdx !== locIdx) {
      focusLocation(locIdx);
    } else {
      renderPanel();
    }
    return;
  }
  if (prev && primaryMarkers.has(prev)) {
    primaryMarkers.get(prev).setIcon(primaryIcon);
    primaryMarkers.get(prev).setZIndexOffset(0);
  }
  selectedBv = bv;
  selectedLocIdx = locIdx;
  if (primaryMarkers.has(bv)) {
    primaryMarkers.get(bv).setIcon(primaryIconActive);
    primaryMarkers.get(bv).setZIndexOffset(1000);
  }
  renderSecondaryMarkers();
  flyToLocation(locIdx);
  openPanel();

  // Update FAB button link and text to point to this specific video in admin
  const fab = document.querySelector(".fab-btn");
  if (fab) {
    fab.href = `admin.html#${bv}`;
    fab.textContent = "不准确？请帮忙修改本视频相关地点～";
  }
}

function flyToLocation(idx) {
  const locs = (locationsByBv[selectedBv] || []).filter(
    (l) => Number.isFinite(l.lat) && Number.isFinite(l.lng),
  );
  const loc = locs[idx];
  if (!loc) return;
  map.flyTo([loc.lat, loc.lng], map.getZoom(), { duration: 0.75 });
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
      fillColor: "#fb7299",
      fillOpacity: 1,
      pane: "activeSecondaryPane",
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
  panelEl.style.transition = '';
  panelEl.style.transform = '';
  mapFullscreenBtn.hidden = false;
  document.body.classList.add("panel-open");
  renderPanel();
  // Let Leaflet recompute size now that the map container shrank.
  requestAnimationFrame(() => map.invalidateSize());
}

function closePanel() {
  if (!selectedBv) return;
  if (primaryMarkers.has(selectedBv)) {
    primaryMarkers.get(selectedBv).setIcon(primaryIcon);
    primaryMarkers.get(selectedBv).setZIndexOffset(0);
  }
  selectedBv = null;
  panelEl.hidden = true;
  mapFullscreenBtn.hidden = true;
  document.body.classList.remove("panel-open");
  secondaryLayer.clearLayers();

  // Reset FAB button link and text
  const fab = document.querySelector(".fab-btn");
  if (fab) {
    fab.href = "admin.html";
    fab.textContent = "一起来完善地图吧！";
  }

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
    <div class="panel-links">
      <span class="links-cta">一键直达原视频 →</span>
      <a class="video-btn bilibili" href="${esc(video.link)}" target="_blank" rel="noopener">Bilibili</a>
      ${video.youtube && video.youtube.link ? `<a class="video-btn youtube" href="${esc(video.youtube.link)}" target="_blank" rel="noopener">YouTube</a>` : ""}
    </div>
    <div class="panel-meta">
      <span>${esc(video.post_date)}</span>
      <span>·</span><span>${esc(video.length)}</span>
      <span>·</span><span>▶ ${esc(video.visit_volume)}</span>
      <span>·</span><span>💬 ${esc(video.danmu_volume)}</span>
    </div>
    ${NEED_MORE_PINS_BVS.has(selectedBv) ? `<div class="panel-hint warn">💡 本视频可能包含更多地点，欢迎提供补充。</div>` : ""}
    ${locs.length > 1 ? `<div class="panel-hint">${locs.length} 个地点 — 蓝色为主要地点，其余在地图上显示为粉色</div>` : ""}
    <ol class="panel-locs">${locs.map((loc, i) => renderLocCard(loc, i)).join("")}</ol>
  `;

  for (const card of panelBody.querySelectorAll("[data-loc-idx]")) {
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, iframe")) return; // don't hijack links/iframes
      focusLocation(+card.dataset.locIdx);
    });
  }
}

function getPreviewFilename(lat, lng) {
  const coordStr = `${lat.toFixed(6)}_${lng.toFixed(6)}`;
  // Simple JS implementation of md5 isn't native, so we'll use a placeholder logic 
  // and I will provide the actual JS md5 if needed, OR we can just use the coordinates 
  // if I update the script. Let's use the coordinates-based filename for simplicity 
  // since I have control over both.
  // Wait, I already used MD5 in the script. I should probably use a simple hash in JS 
  // or just use the same MD5 logic. Since I don't have a library, I'll use a simple 
  // fetch check or just trust the coordinate string if I update the script.
  // Actually, I'll just use a small md5 function.
  return null; // placeholder
}

// MD5 implementation for JS
function md5(string) {
  function k(a, b) {
    a[b >> 2] |= 128 << ((b % 4) << 3);
    a[(((b + 64) >>> 9) << 4) + 14] = b << 3;
    var c = 1732584193, d = -271733879, e = -1732584194, f = 271733878, g, h, i, j = 0;
    for (; j < a.length; j += 16) {
      g = c; h = d; i = e; k = f;
      c = l(c, d, e, f, a[j + 0], 7, -680876936); f = l(f, c, d, e, a[j + 1], 12, -389564586);
      e = l(e, f, c, d, a[j + 2], 17, 606105819); d = l(d, e, f, c, a[j + 3], 22, -1044525330);
      c = l(c, d, e, f, a[j + 4], 7, -176418897); f = l(f, c, d, e, a[j + 5], 12, 1200080426);
      e = l(e, f, c, d, a[j + 6], 17, -1473231341); d = l(d, e, f, c, a[j + 7], 22, -45705983);
      c = l(c, d, e, f, a[j + 8], 7, 1770035416); f = l(f, c, d, e, a[j + 9], 12, -1958414417);
      e = l(e, f, c, d, a[j + 10], 17, -42063); d = l(d, e, f, c, a[j + 11], 22, -1990404162);
      c = l(c, d, e, f, a[j + 12], 7, 1804603682); f = l(f, c, d, e, a[j + 13], 12, -40341101);
      e = l(e, f, c, d, a[j + 14], 17, -1502002290); d = l(d, e, f, c, a[j + 15], 22, 1236535329);
      c = m(c, d, e, f, a[j + 1], 5, -165796510); f = m(f, c, d, e, a[j + 6], 9, -1069501632);
      e = m(e, f, c, d, a[j + 11], 14, 643717713); d = m(d, e, f, c, a[j + 0], 20, -373897302);
      c = m(c, d, e, f, a[j + 5], 5, -701558691); f = m(f, c, d, e, a[j + 10], 9, 38016083);
      e = m(e, f, c, d, a[j + 15], 14, -660478335); d = m(d, e, f, c, a[j + 4], 20, -405537848);
      c = m(c, d, e, f, a[j + 9], 5, 568446438); f = m(f, c, d, e, a[j + 14], 9, -1019803690);
      e = m(e, f, c, d, a[j + 3], 14, -187363961); d = m(d, e, f, c, a[j + 8], 20, 1163531501);
      c = m(c, d, e, f, a[j + 13], 5, -1444681467); f = m(f, c, d, e, a[j + 2], 9, -51403784);
      e = m(e, f, c, d, a[j + 7], 14, 1735328473); d = m(d, e, f, c, a[j + 12], 20, -1926607734);
      c = n(c, d, e, f, a[j + 5], 4, -378558); f = n(f, c, d, e, a[j + 8], 11, -2022574463);
      e = n(e, f, c, d, a[j + 11], 16, 1839030562); d = n(d, e, f, c, a[j + 14], 23, -35309556);
      c = n(c, d, e, f, a[j + 1], 4, -1530992060); f = n(f, c, d, e, a[j + 4], 11, 1272893353);
      e = n(e, f, c, d, a[j + 7], 16, -155497632); d = n(d, e, f, c, a[j + 10], 23, -1094730640);
      c = n(c, d, e, f, a[j + 13], 4, 681279174); f = n(f, c, d, e, a[j + 0], 11, -358537222);
      e = n(e, f, c, d, a[j + 3], 16, -722521979); d = n(d, e, f, c, a[j + 6], 23, 76029189);
      c = n(c, d, e, f, a[j + 9], 4, -640364487); f = n(f, c, d, e, a[j + 12], 11, -421815835);
      e = n(e, f, c, d, a[j + 15], 16, 530742520); d = n(d, e, f, c, a[j + 2], 23, -995338651);
      c = o(c, d, e, f, a[j + 0], 6, -198630844); f = o(f, c, d, e, a[j + 7], 10, 1126891415);
      e = o(e, f, c, d, a[j + 14], 15, -1416354905); d = o(d, e, f, c, a[j + 5], 21, -57434055);
      c = o(c, d, e, f, a[j + 12], 6, 1700485571); f = o(f, c, d, e, a[j + 3], 10, -1894986606);
      e = o(e, f, c, d, a[j + 10], 15, -1051523); d = o(d, e, f, c, a[j + 1], 21, -2054922799);
      c = o(c, d, e, f, a[j + 8], 6, 1873313359); f = o(f, c, d, e, a[j + 15], 10, -30611744);
      e = o(e, f, c, d, a[j + 6], 15, -1560198380); d = o(d, e, f, c, a[j + 13], 21, 1309151649);
      c = o(c, d, e, f, a[j + 4], 6, -145523070); f = o(f, c, d, e, a[j + 11], 10, -1120210379);
      e = o(e, f, c, d, a[j + 2], 15, 718787280); d = o(d, e, f, c, a[j + 9], 21, -343485551);
      c = p(c, g); d = p(d, h); e = p(e, i); f = p(f, k);
    }
    return [c, d, e, f];
  }
  function q(a) { var b = "", c = 0; for (; c < a.length * 32; c += 8) b += String.fromCharCode((a[c >> 5] >>> (c % 32)) & 255); return b; }
  function r(a) { var b = []; for (var c = 0; c < a.length * 8; c += 8) b[c >> 5] |= (a.charCodeAt(c / 8) & 255) << (c % 32); return b; }
  function s(a) { var b = "0123456789abcdef", c = "", d = 0; for (; d < a.length; d++) { var e = a.charCodeAt(d); c += b.charAt((e >>> 4) & 15) + b.charAt(e & 15); } return c; }
  function p(a, b) { var c = (a & 65535) + (b & 65535), d = (a >> 16) + (b >> 16) + (c >> 16); return (d << 16) | (c & 65535); }
  function t(a, b, c, d, e, f) { return p(u(p(p(b, a), p(d, f)), e), c); }
  function l(a, b, c, d, e, f, g) { return t((b & c) | (~b & d), a, b, e, f, g); }
  function m(a, b, c, d, e, f, g) { return t((b & d) | (c & ~d), a, b, e, f, g); }
  function n(a, b, c, d, e, f, g) { return t(b ^ c ^ d, a, b, e, f, g); }
  function o(a, b, c, d, e, f, g) { return t(c ^ (b | ~d), a, b, e, f, g); }
  function u(a, b) { return (a << b) | (a >>> (32 - b)); }
  return s(q(k(r(string), string.length)));
}

function getLocalPreviewPath(lat, lng) {
  const coordStr = `${lat.toFixed(6)}_${lng.toFixed(6)}`;
  const hash = md5(coordStr);
  return `data/previews/${hash}.png`;
}

function renderLocCard(loc, idx) {
  const active = idx === selectedLocIdx;
  const embed = getEmbedUrl(loc);
  const localPreview = getLocalPreviewPath(loc.lat, loc.lng);
  const badgeColor = idx === 0 ? "var(--accent-blue)" : "var(--accent-pink)";
  
  const gLink = getProviderUrl("google", loc);
  const bLink = getProviderUrl("bing", loc);
  const aLink = getProviderUrl("apple", loc);

  return `
    <li class="loc-card ${active ? "active" : ""}" data-loc-idx="${idx}">
      <div class="loc-head">
        <span class="loc-num" style="background:${badgeColor}">${idx + 1}</span>
        <span class="loc-place">${esc(loc.place_name || "(未命名)")}</span>
      </div>
      ${loc.comment ? `<p class="loc-comment">${esc(loc.comment)}</p>` : ""}
      <div style="position:relative" class="loc-preview-wrapper">
        <img class="loc-preview-img" src="${localPreview}" alt="地图预览" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <iframe class="loc-embed" src="${embed}" style="display:none" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
        <div class="preview-disclaimer">预览使用离线数据，外部打开可选择：</div>
      </div>
      <div class="loc-links">
        <a class="loc-link-item" href="${esc(gLink)}" target="_blank" rel="noopener">谷歌地图</a>
        <a class="loc-link-item" href="${esc(bLink)}" target="_blank" rel="noopener">必应地图</a>
        <a class="loc-link-item" href="${esc(aLink)}" target="_blank" rel="noopener">苹果地图</a>
      </div>
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

// Mobile drag-to-close panel logic
let dragStartY = 0;
let isDraggingPanel = false;

panelEl.addEventListener('touchstart', (e) => {
  if (window.innerWidth > 720) return;
  // Only initiate drag if panel is scrolled to the very top
  if (panelEl.scrollTop <= 0) {
    dragStartY = e.touches[0].clientY;
    isDraggingPanel = true;
    panelEl.style.transition = 'none';
  }
}, { passive: true });

panelEl.addEventListener('touchmove', (e) => {
  if (!isDraggingPanel || window.innerWidth > 720) return;
  const dy = e.touches[0].clientY - dragStartY;
  
  if (dy > 0) {
    // Prevent default scroll behavior while dragging down
    if (e.cancelable) e.preventDefault();
    panelEl.style.transform = `translateY(${dy}px)`;
  } else {
    // Dragging up, let it scroll normally
    panelEl.style.transform = '';
  }
}, { passive: false });

panelEl.addEventListener('touchend', (e) => {
  if (!isDraggingPanel || window.innerWidth > 720) return;
  const dy = e.changedTouches[0].clientY - dragStartY;
  
  if (dy > 80) { // threshold to close
    panelEl.style.transition = 'transform 0.2s ease-out';
    panelEl.style.transform = 'translateY(100%)'; // slide all the way down
    
    // wait for animation to finish before actually closing
    setTimeout(() => {
      closePanel();
      panelEl.style.transition = '';
      panelEl.style.transform = '';
    }, 200);
  } else {
    // snap back
    panelEl.style.transition = 'transform 0.2s ease-out';
    panelEl.style.transform = '';
    setTimeout(() => {
      panelEl.style.transition = '';
    }, 200);
  }
  isDraggingPanel = false;
});
