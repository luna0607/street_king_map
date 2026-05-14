const LIVE_MODE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname) && !new URLSearchParams(location.search).has("contrib");
const CONTRIB_KEY = "street_king_map.edits.v2";
const ISSUE_URL = "https://github.com/luna0607/street_king_map/issues/new";
const MAX_PREFILL_LEN = 6000; // GitHub issue form URL prefill cap (approx)

const NEED_MORE_PINS_BVS = new Set(["BV1HR1SBZEvu", "BV1e4421Z7HZ", "BV1txC4BaEqY", "BV1RwJPzKEZh", "BV1QtZwYyErj", "BV1VEsdevEbq", "BV1D9sSejEqy", "BV1XxMgz9Eu7", "BV1DMxkeZE8L", "BV1FbikYDEDH", "BV1LTvNz2Ezc", "BV1aH4y1w7b6", "BV1q94mexEnw", "BV1mH4y1F7sj", "BV1nwecz6Eqm", "BV1UuENz4E4J", "BV13VKweeEdr", "BV1pE4m1R7cZ", "BV1EGtHepEKt", "BV1zQ4LeqEjD", "BV1zXsoz6EF1", "BV1vS411w7bh", "BV15pAdejE8g", "BV1H6HZe7Emo", "BV1pS411w7H9", "BV17eSLYzEDH", "BV13iLxzUEGj", "BV1xx4y1s7Ej", "BV1Ky411v7K4", "BV1fiNizwEkt", "BV1BY5AztEx5", "BV16FfmYsE6n", "BV1GLWczvEsN", "BV1DT421a7TX", "BV1FixWeoEaV", "BV1kGyuB3Eqi", "BV11U411m7uS", "BV19E421w7Mj", "BV1KCWXzMEAy", "BV1DLn2znE2g", "BV1uW42197JH", "BV114421U78a", "BV1jNp4z5E8n", "BV1NdPLexEX7", "BV1UpwReYET5", "BV1Rfb4zZEH4", "BV1Rhn4zBEZJ", "BV1ii421h7cQ", "BV1Xy411e7EZ", "BV1QT421k7bn", "BV1Pf421i7bv", "BV1U2oVYMErk", "BV1k1GvzQE3E", "BV1QadZYaE3R", "BV1VygczBEhg", "BV1uSaGznE2s", "BV1AVHkzcEFE", "BV1sn4y1f7WN", "BV1LKtBehEoo", "BV1hY57zREQX", "BV12o9QYPEPv", "BV1u1USB1EeB", "BV1jmHnztE5x", "BV1QFC6Y7Efp", "BV1EgRiY5E5t", "BV1EpSCYDEi4", "BV1Fpxxz9EFg", "BV13xCRYoESp", "BV1LeHmerEaV", "BV1JfK3zPEEE", "BV1kWqUYGEZc", "BV1fgyxB2ENe", "BV1UfUoYzEgD", "BV1dJFUeWEYH", "BV1z1SFBxEtg"]);

const state = {
  videos: [],
  yt_videos: [],      // YouTube videos
  merge_review: [],   // Review decisions for pairing YT/Bili
  baseline: {},       // bv -> [loc] — from data/locations.json (immutable in contributor mode)
  contributions: {},  // bv -> [loc] — new pins the contributor has added
  updates: [],        // { bv, match_url, set: {...} } — baseline pins the contributor edited
  removals: [],       // { bv, match_url } — baseline pins the contributor wants removed
  new_videos: [],     // Bilibili videos added in contributor mode
  new_yt_videos: [],  // YouTube videos added in contributor mode
  filter: "",
  activeTab: "all",
};

const listEl = document.getElementById("list");
const statsEl = document.getElementById("stats");
const saveStatusEl = document.getElementById("save-status");
const filterEl = document.getElementById("filter");
const tabsEl = document.getElementById("tabs");
const tabDescEl = document.getElementById("tab-desc");
const hintEl = document.getElementById("hint");

const tabDescriptions = {
  all: "显示所有视频内容。",
  "no-pins": "筛选尚未在地图上标注任何点位的视频（访谈类、非美国内容等）。",
  "need-more": "筛选出可能包含多个地点但目前标注不足的视频列表。",
  "yt-only": "筛选尚未与 Bilibili 视频关联的 YouTube 视频。",
  "bili-only": "筛选尚未与 YouTube 视频关联的 Bilibili 视频。",
};

const exportBtn = document.getElementById("download");
const reloadBtn = document.getElementById("reload");
const submitBtn = document.getElementById("submit-gh");
const addVideoBtn = document.getElementById("add-video-btn");
const backToAllBtn = document.getElementById("back-to-all");

const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editTitle = document.getElementById("edit-title");
const editCoordHint = document.getElementById("edit-coord-hint");
const addVideoDialog = document.getElementById("add-video-dialog");
const addVideoForm = document.getElementById("add-video-form");
const submitDialog = document.getElementById("submit-dialog");
const submitSummaryEl = document.getElementById("submit-dialog-summary");

let editCtx = null;           // { kind: 'new'|'baseline', bv, idx, original }
let lastSubmitUrl = null;     // remembered for "Reopen issue form"

filterEl.addEventListener("input", () => {
  state.filter = filterEl.value.trim().toLowerCase();
  if (state.filter) {
    tabDescEl.textContent = "";
  } else if (state.activeTab) {
    tabDescEl.textContent = tabDescriptions[state.activeTab];
  }
  renderList();
  updateBackToAllVisibility();
});

backToAllBtn.addEventListener("click", () => {
  state.filter = "";
  filterEl.value = "";
  if (location.hash) history.pushState("", document.title, window.location.pathname + window.location.search);
  
  // Re-select 'All' tab
  state.activeTab = "all";
  tabsEl.querySelectorAll(".rv-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === "all"));
  tabDescEl.textContent = tabDescriptions["all"];

  renderList();
  updateBackToAllVisibility();
});

function updateBackToAllVisibility() {
  backToAllBtn.style.display = (state.filter || (location.hash && location.hash !== "#")) ? "inline-flex" : "none";
}

tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".rv-tab");
  if (!btn) return;
  state.activeTab = btn.dataset.tab;
  
  // Reset search filter when switching tabs to show 'normal' list for the tab
  state.filter = "";
  filterEl.value = "";
  updateBackToAllVisibility();

  tabsEl.querySelectorAll(".rv-tab").forEach(t => t.classList.toggle("active", t === btn));
  tabDescEl.textContent = tabDescriptions[state.activeTab];
  renderList();
});

exportBtn.addEventListener("click", download);
reloadBtn.addEventListener("click", reloadFromDisk);
submitBtn.addEventListener("click", submitOnGithub);
addVideoBtn.addEventListener("click", () => {
  addVideoForm.reset();
  addVideoDialog.showModal();
});

addVideoForm.addEventListener("submit", handleAddVideoSubmit);
editForm.addEventListener("submit", handleEditSubmit);
editForm.querySelector('input[name=google_maps_url]').addEventListener("input", () => {
  const c = parseCoords(editForm.google_maps_url.value);
  editCoordHint.textContent = c
    ? `→ ${c.lat}, ${c.lng}`
    : editForm.google_maps_url.value
      ? "(URL 中无坐标 — 将由脚本解析)"
      : "";
});
for (const b of editDialog.querySelectorAll("[data-close]")) b.addEventListener("click", () => editDialog.close());
for (const b of addVideoDialog.querySelectorAll("[data-close]")) b.addEventListener("click", () => addVideoDialog.close());
for (const b of submitDialog.querySelectorAll("[data-close]")) b.addEventListener("click", () => submitDialog.close());
document.getElementById("submit-reopen").addEventListener("click", () => {
  if (lastSubmitUrl) window.open(lastSubmitUrl, "_blank", "noopener");
});
document.getElementById("submit-export").addEventListener("click", () => downloadContributions());

document.body.classList.toggle("contributor-mode", !LIVE_MODE);
setupHint();
boot();

function setupHint() {
  if (LIVE_MODE) {
    hintEl.innerHTML = "";
    exportBtn.textContent = "导出";
    exportBtn.title = "下载当前 data/locations.json 的副本";
    submitBtn.hidden = true; // In Live Mode, you save to disk, no need for GH issue
    reloadBtn.textContent = "刷新";
    reloadBtn.hidden = false; // Show it anyway as requested
    addVideoBtn.hidden = false;
  } else {
    hintEl.innerHTML = `
      <strong>贡献者模式。</strong> 您可以在下方的任何视频中添加、编辑或删除点位 — 您的更改仅保存在此浏览器中。
      您也可以添加新视频。
      完成后，点击 <strong>提交到 GitHub</strong> 以打开预填好的 issue；机器人将开启一个 Pull Request（约 1–2 分钟）
      并标记您为贡献者。需要 <a href="https://github.com/signup" target="_blank" rel="noopener">GitHub 账号</a>。
      没有账号？请使用 <strong>导出</strong> 并将文件发送给维护者jtxxxbw@gmail.com。`;
    exportBtn.textContent = "导出";
    exportBtn.title = "将您的更改下载为 contributions.json";
    submitBtn.hidden = false;
    reloadBtn.textContent = "舍弃我的编辑";
    reloadBtn.hidden = false;
    addVideoBtn.hidden = false;
  }
}

async function boot() {
  const [videos, yt_videos, merge_review, baseline] = await Promise.all([
    fetch("data/videos.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/yt_videos.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/merge_review.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/locations.json", { cache: "no-store" }).then((r) => r.json()),
  ]);
  state.videos = videos;
  state.yt_videos = yt_videos || [];
  state.merge_review = merge_review || [];
  state.baseline = baseline || {};
  if (!LIVE_MODE) {
    const loaded = loadContributionsFromStorage();
    state.contributions = loaded.contributions || {};
    state.updates = loaded.updates || [];
    state.removals = loaded.removals || [];
    state.new_videos = loaded.new_videos || [];
    state.new_yt_videos = loaded.new_yt_videos || [];
    reconcileAgainstBaseline(); // drop items already present in baseline
  }
  await migrateLegacyDraft();

  // Handle direct link from map
  const hash = location.hash.replace("#", "");
  if (hash && (hash.startsWith("BV") || hash.length === 11)) {
    state.filter = hash.toLowerCase();
    filterEl.value = hash;
    // Clear tab highlight to show we are in search/filter mode
    tabsEl.querySelectorAll(".rv-tab").forEach(t => t.classList.remove("active"));
    state.activeTab = ""; // temporary empty state so 'all' logic in renderList still works for the single item
    tabDescEl.textContent = ""; // Hide "Show all videos" when focusing on one
  }

  renderList();
  updateBackToAllVisibility();

  if (hash && (hash.startsWith("BV") || hash.length === 11)) {
    const el = document.querySelector(`[data-bv="${hash}"]`) || document.querySelector(`[data-vid="${hash}"]`);
    if (el) {
      setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.boxShadow = "0 0 0 3px var(--accent)";
        setTimeout(() => { el.style.boxShadow = ""; }, 2000);
      }, 100);
    }
  }
}

function loadContributionsFromStorage() {
  try {
    const raw = localStorage.getItem(CONTRIB_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveContributionsToStorage() {
  localStorage.setItem(CONTRIB_KEY, JSON.stringify({
    contributions: state.contributions,
    updates: state.updates,
    removals: state.removals,
    new_videos: state.new_videos,
    new_yt_videos: state.new_yt_videos,
  }));
}

function reconcileAgainstBaseline() {
  // If any "new" pin is already in baseline, drop it (it was merged).
  for (const bv of Object.keys(state.contributions)) {
    const urls = new Set((state.baseline[bv] || []).map((l) => l.google_maps_url));
    state.contributions[bv] = (state.contributions[bv] || []).filter((l) => !urls.has(l.google_maps_url));
    if (!state.contributions[bv].length) delete state.contributions[bv];
  }
  // Drop updates/removals that no longer match any baseline pin.
  const baselineUrls = (bv) => new Set((state.baseline[bv] || []).map((l) => l.google_maps_url));
  state.updates = state.updates.filter((u) => baselineUrls(u.bv).has(u.match_url));
  state.removals = state.removals.filter((r) => baselineUrls(r.bv).has(r.match_url));
}

// One-time migration: import any pins left in the old "additions only" key.
async function migrateLegacyDraft() {
  const LEGACY_V1 = "street_king_map.contributions";
  const LEGACY_V0 = "street_king_map.locations_draft";
  for (const key of [LEGACY_V1, LEGACY_V0]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    let draft;
    try { draft = JSON.parse(raw); } catch { localStorage.removeItem(key); continue; }
    const source = key === LEGACY_V1 ? draft : draft; // both were flat bv -> [loc]
    if (!source || typeof source !== "object") { localStorage.removeItem(key); continue; }
    const target = LIVE_MODE ? state.baseline : state.contributions;
    let imported = 0;
    for (const [bv, locs] of Object.entries(source)) {
      if (!Array.isArray(locs) || !locs.length) continue;
      const seen = new Set([
        ...(state.baseline[bv] || []).map((l) => l.google_maps_url),
        ...(state.contributions[bv] || []).map((l) => l.google_maps_url),
      ]);
      for (const loc of locs) {
        if (seen.has(loc.google_maps_url)) continue;
        (target[bv] ??= []).push(loc);
        imported++;
      }
    }
    if (imported > 0) {
      if (LIVE_MODE) await persistLive();
      else saveContributionsToStorage();
      console.log(`migrated ${imported} pins from ${key}`);
    }
    localStorage.removeItem(key);
  }
}

async function reloadFromDisk() {
  if (!LIVE_MODE) {
    if (!confirm("舍弃您所有的本地编辑（新点位、编辑、删除）吗？")) return;
    localStorage.removeItem(CONTRIB_KEY);
    state.contributions = {};
    state.updates = [];
    state.removals = [];
    renderList();
    setSaveStatus("已舍弃", "ok");
    return;
  }
  await boot();
  setSaveStatus("已重新加载", "ok");
}

async function persistLive() {
  setSaveStatus("正在保存…", "pending");
  try {
    const resp = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.baseline),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    setSaveStatus("已保存 ✓", "ok");
  } catch (err) {
    console.error(err);
    setSaveStatus(`保存失败 (${err.message}) — 请启动 scripts/serve.py`, "err");
  }
  updateStats();
}

function persist() {
  if (LIVE_MODE) {
    persistLive();
  } else {
    saveContributionsToStorage();
    setSaveStatus("已保存到浏览器 ✓", "ok");
    updateStats();
  }
}

function setSaveStatus(text, kind) {
  saveStatusEl.textContent = text;
  saveStatusEl.dataset.kind = kind || "";
}

// ===== Export =====

function download() {
  if (LIVE_MODE) {
    downloadBlob("locations.json", stripEmpty(state.baseline));
    return;
  }
  downloadContributions();
}

function downloadContributions() {
  const payload = buildContributionPayload();
  if (!payloadHasOps(payload)) {
    alert("尚未有任何贡献。在导出前，请先添加、编辑或删除点位。");
    return;
  }
  downloadBlob("contributions.json", payload);
}

function downloadBlob(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildContributionPayload() {
  return {
    add: stripEmpty(state.contributions),
    update: state.updates.map((u) => ({ bv: u.bv, match_url: u.match_url, set: u.set })),
    remove: state.removals.map((r) => ({ bv: r.bv, match_url: r.match_url })),
    add_videos: state.new_videos,
    add_yt_videos: state.new_yt_videos,
  };
}

function payloadHasOps(p) {
  return (
    Object.keys(p.add || {}).length ||
    (p.update?.length || 0) ||
    (p.remove?.length || 0) ||
    (p.add_videos?.length || 0) ||
    (p.add_yt_videos?.length || 0)
  );
}

function payloadSummary(p) {
  const added = Object.values(p.add || {}).reduce((n, arr) => n + arr.length, 0);
  return {
    added,
    updated: p.update?.length || 0,
    removed: p.remove?.length || 0,
    added_videos: (p.add_videos?.length || 0) + (p.add_yt_videos?.length || 0),
  };
}

function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v && v.length) out[k] = v;
  return out;
}

// ===== Submit via GitHub =====

function submitOnGithub() {
  const payload = buildContributionPayload();
  if (!payloadHasOps(payload)) {
    alert("在提交前，请先添加、编辑或删除点位。");
    return;
  }
  const json = JSON.stringify(payload, null, 2);
  try { navigator.clipboard?.writeText(json); } catch {}
  const base = new URL(ISSUE_URL);
  base.searchParams.set("template", "contribution.yml");
  const withJson = new URL(base);
  withJson.searchParams.set("json", json);
  const target = withJson.toString().length > MAX_PREFILL_LEN ? base.toString() : withJson.toString();
  if (target === base.toString()) {
    alert(
      "您的贡献内容过大，无法通过 URL 预填 issue 表单。\n\n" +
      "JSON 已复制到您的剪贴板。请在表单打开后，将其粘贴到 'Contributions JSON' 字段中。"
    );
  }
  lastSubmitUrl = target;
  window.open(target, "_blank", "noopener");
  showSubmitDialog(payload);
}

function showSubmitDialog(payload) {
  const s = payloadSummary(payload);
  const parts = [];
  if (s.added) parts.push(`<strong>${s.added}</strong> 个新点位`);
  if (s.updated) parts.push(`<strong>${s.updated}</strong> 次编辑`);
  if (s.removed) parts.push(`<strong>${s.removed}</strong> 次删除`);
  if (s.added_videos) parts.push(`<strong>${s.added_videos}</strong> 个新视频`);
  submitSummaryEl.innerHTML = `您正在提交 ${parts.join(" + ")}。`;
  submitDialog.showModal();
}

// ===== Rendering =====

function renderList() {
  const q = state.filter;
  const tab = state.activeTab;

  // Build a de-duplicated list of unique videos using merge_review for pairing
  const videoMap = new Map(); // id (prefer bv) -> { ...video, bilibili, youtube }
  const ytToBv = new Map();   // vid -> bv

  state.merge_review.forEach((r) => {
    if (r.decision && r.decision.action === "merge" && r.decision.confirmed) {
      ytToBv.set(r.youtube.vid, r.decision.bv);
    }
  });

  // 1. Process Bilibili videos (main)
  [...state.videos, ...state.new_videos].forEach((v) => {
    videoMap.set(v.bv, { ...v, bilibili: v, youtube: null });
  });

  // 2. Process YouTube videos
  [...state.yt_videos, ...state.new_yt_videos].forEach((v) => {
    const bv = ytToBv.get(v.vid);
    if (bv && videoMap.has(bv)) {
      // It's a pair! Update existing bilibili entry
      videoMap.get(bv).youtube = v;
    } else if (!bv) {
      // Standalone YouTube video
      videoMap.set(v.vid, { ...v, bilibili: null, youtube: v });
    }
  });

  const allUniqueVideos = Array.from(videoMap.values());
  allUniqueVideos.sort((a, b) => (b.post_date || "").localeCompare(a.post_date || ""));

  // Calculate counts for each tab (ignoring text search filter)
  const tabCounts = { all: allUniqueVideos.length, "no-pins": 0, "need-more": 0, "yt-only": 0, "bili-only": 0 };
  allUniqueVideos.forEach((v) => {
    const id = v.bv || v.vid;
    const pairedId = v.bilibili && v.youtube ? (v.bv === id ? v.vid : v.bv) : null;
    const pinCount = (state.baseline[id] || []).length + (pairedId ? (state.baseline[pairedId] || []).length : 0);

    if (pinCount === 0) tabCounts["no-pins"]++;
    if (NEED_MORE_PINS_BVS.has(id) || (pairedId && NEED_MORE_PINS_BVS.has(pairedId))) tabCounts["need-more"]++;
    if (!v.bilibili && v.youtube) tabCounts["yt-only"]++;
    if (v.bilibili && !v.youtube) tabCounts["bili-only"]++;
  });

  // Update tab UI counts
  tabsEl.querySelectorAll(".rv-tab-count").forEach((span) => {
    const tab = span.dataset.count;
    if (tabCounts[tab] !== undefined) span.textContent = tabCounts[tab];
  });

  const filtered = allUniqueVideos.filter((v) => {
    const id = v.bv || v.vid;
    const pairedId = v.bilibili && v.youtube ? (v.bv === id ? v.vid : v.bv) : null;

    // 1. Text filter
    if (q) {
      const match = (
        v.name.toLowerCase().includes(q) ||
        (v.post_date || "").includes(q) ||
        (v.bv || "").toLowerCase().includes(q) ||
        (v.vid || "").toLowerCase().includes(q)
      );
      if (!match) return false;
    }

    // 2. Tab filter
    const pinCount = (state.baseline[id] || []).length + (pairedId ? (state.baseline[pairedId] || []).length : 0);
    if (tab === "no-pins") return pinCount === 0;
    if (tab === "need-more") return NEED_MORE_PINS_BVS.has(id) || (pairedId && NEED_MORE_PINS_BVS.has(pairedId));
    if (tab === "yt-only") return !v.bilibili && v.youtube;
    if (tab === "bili-only") return v.bilibili && !v.youtube;

    return true;
  });

  listEl.innerHTML = filtered.map(renderCard).join("");

  for (const card of listEl.querySelectorAll(".card")) {
    const id = card.dataset.bv || card.dataset.vid;
    card.querySelector(".add-form").addEventListener("submit", (e) => handleAdd(e, id));
    for (const btn of card.querySelectorAll("[data-action]")) {
      const act = btn.dataset.action;
      btn.addEventListener("click", () => {
        const kind = btn.dataset.kind; // 'new' | 'baseline'
        const idx = +btn.dataset.idx;
        if (act === "edit") openEdit(kind, id, idx);
        else if (act === "remove") doRemove(kind, id, idx);
        else if (act === "undo-remove") undoRemove(id, +btn.dataset.idx);
        else if (act === "revert-edit") revertEdit(id, btn.dataset.matchUrl);
      });
    }
    const urlInput = card.querySelector("input[name=google_maps_url]");
    urlInput.addEventListener("input", () => {
      const hint = card.querySelector(".coord-hint");
      const c = parseCoords(urlInput.value);
      hint.textContent = c
        ? `→ ${c.lat}, ${c.lng}`
        : urlInput.value
          ? "(URL 中无坐标 — 将由脚本解析)"
          : "";
    });
  }

  updateStats();
}

function renderCard(v) {
  const id = v.bv || v.vid;
  const pairedId = v.bv && v.vid && v.bv !== v.vid ? v.vid : null;

  // Aggregate pins from both possible IDs (though usually only one is used)
  const baselineLocs = [
    ...(state.baseline[id] || []),
    ...(pairedId ? (state.baseline[pairedId] || []) : []),
  ];
  // Contributions are usually keyed by BV if available
  const contribLocs = [
    ...(state.contributions[id] || []),
    ...(pairedId ? (state.contributions[pairedId] || []) : []),
  ];
  const updatesForId = [
    ...state.updates.filter((u) => u.bv === id),
    ...(pairedId ? state.updates.filter((u) => u.bv === pairedId) : []),
  ];
  const removalsForId = [
    ...state.removals.filter((r) => r.bv === id),
    ...(pairedId ? state.removals.filter((r) => r.bv === pairedId) : []),
  ];

  const updateByUrl = new Map(updatesForId.map((u) => [u.match_url, u]));
  const removalUrls = new Set(removalsForId.map((r) => r.match_url));

  const rows = [
    ...baselineLocs.map((loc, i) => renderLocRow(loc, i, "baseline", { update: updateByUrl.get(loc.google_maps_url), removed: removalUrls.has(loc.google_maps_url) })),
    ...contribLocs.map((loc, i) => renderLocRow(loc, i, "new", {})),
  ].join("");

  const dataAttr = v.bv ? `data-bv="${esc(v.bv)}"` : `data-vid="${esc(v.vid)}"`;

  // Prefer Bilibili link for display if both exist
  const displayLink = (v.bilibili || v).link;
  const displayThumb = (v.bilibili || v.youtube || v).thumbnail;
  const displayName = (v.bilibili || v.youtube || v).name;

  let platformBadges = "";
  if (v.bilibili && v.youtube) {
    platformBadges = '<span class="badge badge-platform">Bilibili + YouTube</span>';
  } else if (v.youtube) {
    platformBadges = '<span class="badge badge-platform">YouTube</span>';
  }

  return `
    <article class="card" ${dataAttr}>
      <a class="card-thumb" href="${esc(displayLink)}" target="_blank" rel="noopener">
        <img src="${ensureHttps(displayThumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      </a>
      <div class="card-body">
        <div class="card-head">
          <a class="card-title" href="${esc(displayLink)}" target="_blank" rel="noopener">${esc(displayName)}</a>
          <div class="card-meta">
            ${esc(v.post_date)} · ${esc(v.length)} · ${esc(id)}
            ${platformBadges}
          </div>
        </div>
        <ul class="locations">${rows || `<li class="muted">暂无点位</li>`}</ul>
        <form class="add-form">
          <input type="text" name="place_name" placeholder="地点名称（可选）">
          <input type="url" name="google_maps_url" placeholder="Google 地图 URL" required>
          <span class="coord-hint"></span>
          <input type="text" name="comment" placeholder="备注（可选）">
          <button class="btn primary" type="submit">添加点位</button>
        </form>
      </div>
    </article>`;
}

function renderLocRow(loc, idx, kind, flags) {
  const { update, removed } = flags || {};
  // When there's a pending edit, show the edited values (not the original).
  const effective = update ? { ...loc, ...update.set } : loc;
  const coords =
    Number.isFinite(effective.lat) && Number.isFinite(effective.lng)
      ? `${effective.lat.toFixed(5)}, ${effective.lng.toFixed(5)}`
      : `<span class="warn">未解析坐标</span>`;

  const badges = [];
  if (kind === "new") badges.push('<span class="badge badge-new">新增</span>');
  if (update) badges.push('<span class="badge badge-edit">已编辑</span>');
  if (removed) badges.push('<span class="badge badge-remove">将删除</span>');

  const canEdit = LIVE_MODE || kind === "new" || !removed;
  const canRemove = LIVE_MODE || kind === "new";
  const baselineRemovable = !LIVE_MODE && kind === "baseline" && !removed;

  const actions = [];
  if (canEdit) actions.push(`<button type="button" class="icon-btn" data-action="edit" data-kind="${kind}" data-idx="${idx}" title="编辑">✎</button>`);
  if (canRemove) actions.push(`<button type="button" class="icon-btn" data-action="remove" data-kind="${kind}" data-idx="${idx}" title="删除">×</button>`);
  if (baselineRemovable) actions.push(`<button type="button" class="icon-btn" data-action="remove" data-kind="baseline" data-idx="${idx}" title="标记为删除">×</button>`);
  if (removed) actions.push(`<button type="button" class="icon-btn" data-action="undo-remove" data-idx="${idx}" title="撤销删除">↺</button>`);
  if (update) actions.push(`<button type="button" class="icon-btn" data-action="revert-edit" data-match-url="${esc(update.match_url)}" title="还原编辑">↺</button>`);

  return `
    <li class="${kind === "new" ? "is-contrib" : ""} ${removed ? "is-removed" : ""} ${update ? "is-edited" : ""}">
      <div class="loc-row">
        ${badges.join("")}
        <span class="place">${esc(effective.place_name || "(未命名)")}</span>
        <span class="coords">${coords}</span>
        ${actions.join("")}
      </div>
      ${effective.google_maps_url ? `<a class="url" href="${esc(effective.google_maps_url)}" target="_blank" rel="noopener">${esc(effective.google_maps_url)}</a>` : ""}
      ${effective.comment ? `<div class="comment">${esc(effective.comment)}</div>` : ""}
    </li>`;
}

// ===== Mutations =====

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
  if (coords) { loc.lat = coords.lat; loc.lng = coords.lng; }
  const target = LIVE_MODE ? state.baseline : state.contributions;
  (target[bv] ??= []).push(loc);
  form.reset();
  renderList();
  persist();
}

function openEdit(kind, bv, idx) {
  let original;
  if (kind === "new") {
    original = state.contributions[bv]?.[idx];
  } else {
    original = state.baseline[bv]?.[idx];
  }
  if (!original) return;
  // When editing a baseline pin that already has a pending update, start from the edited values.
  const pendingUpdate = kind === "baseline"
    ? state.updates.find((u) => u.bv === bv && u.match_url === original.google_maps_url)
    : null;
  const current = pendingUpdate ? { ...original, ...pendingUpdate.set } : { ...original };
  editCtx = { kind, bv, idx, original, pendingUpdate };
  editTitle.textContent = kind === "new" ? "编辑新点位" : "建议对现有点位进行编辑";
  editForm.place_name.value = current.place_name || "";
  editForm.google_maps_url.value = current.google_maps_url || "";
  editForm.comment.value = current.comment || "";
  editCoordHint.textContent = Number.isFinite(current.lat) && Number.isFinite(current.lng)
    ? `→ ${current.lat}, ${current.lng}`
    : "";
  editDialog.showModal();
  requestAnimationFrame(() => editForm.place_name.focus());
}

function handleEditSubmit(e) {
  e.preventDefault();
  if (!editCtx) return editDialog.close();
  const data = new FormData(editForm);
  const patch = {
    place_name: String(data.get("place_name") || "").trim(),
    google_maps_url: String(data.get("google_maps_url") || "").trim(),
    comment: String(data.get("comment") || "").trim(),
  };
  const coords = parseCoords(patch.google_maps_url);
  if (coords) { patch.lat = coords.lat; patch.lng = coords.lng; }

  if (editCtx.kind === "new") {
    const arr = state.contributions[editCtx.bv] || [];
    arr[editCtx.idx] = { ...arr[editCtx.idx], ...patch };
  } else if (LIVE_MODE) {
    const arr = state.baseline[editCtx.bv] || [];
    arr[editCtx.idx] = { ...arr[editCtx.idx], ...patch };
  } else {
    // Contributor mode: record as an update op keyed by the ORIGINAL url.
    const origUrl = editCtx.original.google_maps_url;
    const existing = state.updates.find((u) => u.bv === editCtx.bv && u.match_url === origUrl);
    if (existing) existing.set = patch;
    else state.updates.push({ bv: editCtx.bv, match_url: origUrl, set: patch });
  }
  editCtx = null;
  editDialog.close();
  renderList();
  persist();
}

async function handleAddVideoSubmit(e) {
  e.preventDefault();
  const data = new FormData(addVideoForm);
  const platform = data.get("platform");
  const rawUrl = String(data.get("video_url") || "").trim();
  const name = String(data.get("name") || "").trim();
  const post_date = data.get("post_date");
  const thumbnail = String(data.get("thumbnail") || "").trim();
  const length = String(data.get("length") || "").trim();

  let id = rawUrl;
  let link = rawUrl;

  if (platform === "bilibili") {
    const bvMatch = rawUrl.match(/BV[a-zA-Z0-9]+/);
    if (!bvMatch) {
      alert("请输入有效的 Bilibili BV 号或链接");
      return;
    }
    id = bvMatch[0];
    link = `https://www.bilibili.com/video/${id}/`;
    const video = {
      link,
      name,
      thumbnail,
      length,
      post_date,
      bv: id
    };
    if (LIVE_MODE) {
      state.videos.unshift(video);
      await persistVideos("bilibili");
    } else {
      state.videos.unshift(video);
      state.new_videos.push(video);
      persist();
    }
  } else {
    // YouTube
    const ytMatch = rawUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    if (!ytMatch && rawUrl.length !== 11) {
      alert("请输入有效的 YouTube 视频 ID 或链接");
      return;
    }
    id = ytMatch ? ytMatch[1] : rawUrl;
    link = `https://www.youtube.com/watch?v=${id}`;
    const video = {
      link,
      name,
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      length,
      post_date,
      vid: id
    };
    if (LIVE_MODE) {
      state.yt_videos.unshift(video);
      await persistVideos("youtube");
    } else {
      state.yt_videos.unshift(video);
      state.new_yt_videos.push(video);
      persist();
    }
  }

  addVideoDialog.close();
  renderList();
}

async function persistVideos(platform) {
  if (!LIVE_MODE) return;
  setSaveStatus("正在保存视频列表…", "pending");
  const endpoint = platform === "bilibili" ? "/api/videos" : "/api/yt_videos";
  const payload = platform === "bilibili" ? state.videos : state.yt_videos;
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    setSaveStatus("视频列表已保存 ✓", "ok");
  } catch (err) {
    console.error(err);
    const suffix = LIVE_MODE ? " — 请启动 scripts/serve.py" : "";
    setSaveStatus(`视频保存失败 (${err.message})${suffix}`, "err");
  }
}

function doRemove(kind, bv, idx) {
  if (kind === "new") {
    const arr = state.contributions[bv] || [];
    arr.splice(idx, 1);
    if (!arr.length) delete state.contributions[bv];
  } else if (LIVE_MODE) {
    const arr = state.baseline[bv] || [];
    arr.splice(idx, 1);
    if (!arr.length) delete state.baseline[bv];
  } else {
    const loc = state.baseline[bv]?.[idx];
    if (!loc) return;
    if (!state.removals.some((r) => r.bv === bv && r.match_url === loc.google_maps_url)) {
      state.removals.push({ bv, match_url: loc.google_maps_url });
    }
    // Also drop any pending edit on the same pin — removal takes precedence.
    state.updates = state.updates.filter((u) => !(u.bv === bv && u.match_url === loc.google_maps_url));
  }
  renderList();
  persist();
}

function undoRemove(bv, idx) {
  const loc = state.baseline[bv]?.[idx];
  if (!loc) return;
  state.removals = state.removals.filter((r) => !(r.bv === bv && r.match_url === loc.google_maps_url));
  renderList();
  persist();
}

function revertEdit(bv, matchUrl) {
  state.updates = state.updates.filter((u) => !(u.bv === bv && u.match_url === matchUrl));
  renderList();
  persist();
}

// ===== Stats =====

function updateStats() {
  let baselinePins = 0;
  let baselineVideos = 0;
  for (const [, locs] of Object.entries(state.baseline)) {
    if (!locs || !locs.length) continue;
    baselineVideos++;
    baselinePins += locs.length;
  }

  // Calculate unique video count by de-duplicating Bilibili and YouTube entries
  const videoMap = new Map();
  const ytToBv = new Map();

  state.merge_review.forEach((r) => {
    // Treat as paired if confirmed OR if it's an exact similarity match
    if (r.decision && r.decision.action === "merge" && (r.decision.confirmed || r.decision.similarity === 1.0)) {
      ytToBv.set(r.youtube.vid, r.decision.bv);
    }
  });

  [...state.videos, ...state.new_videos].forEach((v) => {
    videoMap.set(v.bv, true);
  });
  [...state.yt_videos, ...state.new_yt_videos].forEach((v) => {
    const bv = ytToBv.get(v.vid);
    if (!bv || !videoMap.has(bv)) {
      videoMap.set(v.vid, true);
    }
  });
  const totalVideosCount = videoMap.size;

  if (LIVE_MODE) {
    statsEl.textContent = `${baselineVideos}/${totalVideosCount} 个视频 · ${baselinePins} 个点位`;
    return;
  }
  let newPins = 0;
  for (const locs of Object.values(state.contributions)) newPins += locs.length;
  const parts = [];
  if (newPins) parts.push(`${newPins} 个新增`);
  if (state.updates.length) parts.push(`${state.updates.length} 个编辑`);
  if (state.removals.length) parts.push(`${state.removals.length} 个删除`);
  statsEl.textContent = parts.length
    ? `${parts.join(" + ")} · 地图上有 ${baselinePins} 个点位`
    : `地图上有 ${baselinePins} 个点位 · 您尚未有任何更改`;
}

// ===== Helpers =====

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
