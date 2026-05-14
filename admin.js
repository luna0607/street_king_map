const LIVE_MODE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
const CONTRIB_KEY = "street_king_map.edits.v2";
const ISSUE_URL = "https://github.com/luna0607/street_king_map/issues/new";
const MAX_PREFILL_LEN = 6000; // GitHub issue form URL prefill cap (approx)

const state = {
  videos: [],
  baseline: {},       // bv -> [loc] — from data/locations.json (immutable in contributor mode)
  contributions: {},  // bv -> [loc] — new pins the contributor has added
  updates: [],        // { bv, match_url, set: {...} } — baseline pins the contributor edited
  removals: [],       // { bv, match_url } — baseline pins the contributor wants removed
  filter: "",
};

const listEl = document.getElementById("list");
const statsEl = document.getElementById("stats");
const saveStatusEl = document.getElementById("save-status");
const filterEl = document.getElementById("filter");
const hintEl = document.getElementById("hint");
const exportBtn = document.getElementById("download");
const reloadBtn = document.getElementById("reload");
const submitBtn = document.getElementById("submit-gh");

const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editTitle = document.getElementById("edit-title");
const editCoordHint = document.getElementById("edit-coord-hint");
const submitDialog = document.getElementById("submit-dialog");
const submitSummaryEl = document.getElementById("submit-dialog-summary");

let editCtx = null;           // { kind: 'new'|'baseline', bv, idx, original }
let lastSubmitUrl = null;     // remembered for "Reopen issue form"

filterEl.addEventListener("input", () => {
  state.filter = filterEl.value.trim().toLowerCase();
  renderList();
});

exportBtn.addEventListener("click", download);
reloadBtn.addEventListener("click", reloadFromDisk);
submitBtn.addEventListener("click", submitOnGithub);

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
  } else {
    hintEl.innerHTML = `
      <strong>贡献者模式。</strong> 您可以在下方的任何视频中添加、编辑或删除点位 — 您的更改仅保存在此浏览器中。
      完成后，点击 <strong>提交到 GitHub</strong> 以打开预填好的 issue；机器人将开启一个 Pull Request（约 1–2 分钟）
      并标记您为贡献者。需要 <a href="https://github.com/signup" target="_blank" rel="noopener">GitHub 账号</a>。
      没有账号？请使用 <strong>导出</strong> 并将文件发送给维护者。`;
    exportBtn.textContent = "导出";
    exportBtn.title = "将您的更改下载为 contributions.json";
    submitBtn.hidden = false;
    reloadBtn.textContent = "舍弃我的编辑";
  }
}

async function boot() {
  const [videos, baseline] = await Promise.all([
    fetch("data/videos.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/locations.json", { cache: "no-store" }).then((r) => r.json()),
  ]);
  state.videos = videos;
  state.baseline = baseline || {};
  if (!LIVE_MODE) {
    const loaded = loadContributionsFromStorage();
    state.contributions = loaded.contributions || {};
    state.updates = loaded.updates || [];
    state.removals = loaded.removals || [];
    reconcileAgainstBaseline(); // drop items already present in baseline
  }
  await migrateLegacyDraft();
  renderList();
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
  };
}

function payloadHasOps(p) {
  return Object.keys(p.add || {}).length || (p.update?.length || 0) || (p.remove?.length || 0);
}

function payloadSummary(p) {
  const added = Object.values(p.add || {}).reduce((n, arr) => n + arr.length, 0);
  return { added, updated: p.update?.length || 0, removed: p.remove?.length || 0 };
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
  submitSummaryEl.innerHTML = `您正在提交 ${parts.join(" + ")}。`;
  submitDialog.showModal();
}

// ===== Rendering =====

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
    for (const btn of card.querySelectorAll("[data-action]")) {
      const act = btn.dataset.action;
      btn.addEventListener("click", () => {
        const kind = btn.dataset.kind; // 'new' | 'baseline'
        const idx = +btn.dataset.idx;
        if (act === "edit") openEdit(kind, bv, idx);
        else if (act === "remove") doRemove(kind, bv, idx);
        else if (act === "undo-remove") undoRemove(bv, +btn.dataset.idx);
        else if (act === "revert-edit") revertEdit(bv, btn.dataset.matchUrl);
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
  const baselineLocs = state.baseline[v.bv] || [];
  const contribLocs = state.contributions[v.bv] || [];
  const updatesForBv = state.updates.filter((u) => u.bv === v.bv);
  const removalsForBv = state.removals.filter((r) => r.bv === v.bv);
  const updateByUrl = new Map(updatesForBv.map((u) => [u.match_url, u]));
  const removalUrls = new Set(removalsForBv.map((r) => r.match_url));

  const rows = [
    ...baselineLocs.map((loc, i) => renderLocRow(loc, i, "baseline", { update: updateByUrl.get(loc.google_maps_url), removed: removalUrls.has(loc.google_maps_url) })),
    ...contribLocs.map((loc, i) => renderLocRow(loc, i, "new", {})),
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
  if (LIVE_MODE) {
    statsEl.textContent = `${baselineVideos}/${state.videos.length} 个视频 · ${baselinePins} 个点位`;
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
