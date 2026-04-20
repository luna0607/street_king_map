'use strict';

const REVIEW_URL = '../data/merge_review.json';
const VIDEOS_URL = '../data/videos.json';
const API_REVIEW = '/api/merge_review';
const LS_KEY = 'merge_review_v2';

const T = {
  loading: '加载中…',
  loaded: (n) => `已加载 · ${n} 项`,
  loadFail: (m) => `加载失败：${m}`,
  saving: '保存中…',
  saved: (n) => `已保存 · ${n} 项`,
  savedLocal: '已保存到本地',
  downloaded: (n) => `已下载 · ${n} 项`,
  badge: {
    pending: '待审核',
    auto: (s) => `自动合并 · ≈ ${s.toFixed(2)}`,
    confirmed: '已确认',
    separate: 'YouTube 独有',
  },
  candidatesLabel: 'Top Bilibili 候选 — 点击合并',
  btn: {
    keepSeparate: '标为 YouTube 独有',
    confirm: '确认合并',
    sendBack: '送回待审核',
    reset: '重置',
  },
  sectionHead: {
    pending: '待审核',
    auto: '自动合并 — 请确认或送回审核',
    confirmed: '已确认',
  },
  empty: {
    merged: '暂无合并项',
    yt_only: '暂无 YouTube 独有视频',
    bili_only: '暂无 Bilibili 独有视频',
  },
  biliLink: {
    placeholder: '粘贴对应的 YouTube 链接或 ID（可选）',
    submit: '合并到 YouTube',
    errInvalid: '无法识别 YouTube 链接或 ID',
    errNotFound: '未在 yt_videos.json 中找到该 YouTube 视频',
    ok: (name) => `已合并到 ${name}`,
  },
  viewsSuffix: '次观看',
  untitled: '(无标题)',
  noThumb: '暂无封面',
};

const listEl = document.getElementById('review-list');
const saveStatus = document.getElementById('save-status');
const tabsEl = document.getElementById('tabs');

let review = [];
let biliVideos = [];
let saveTimer = null;
let dirty = false;
let apiAvailable = true;
let activeTab = 'merged';

function setStatus(msg, kind = '') {
  saveStatus.textContent = msg;
  saveStatus.dataset.kind = kind;
}

function thumbURL(src) {
  if (!src) return '';
  if (/^https?:/i.test(src)) return src;
  return 'https://' + src;
}

function simClass(s) {
  if (s >= 0.85) return 'hi';
  if (s >= 0.5) return 'mid';
  return 'lo';
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const FALLBACK_THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">` +
  `<rect width="160" height="90" fill="#222"/>` +
  `<text x="80" y="50" text-anchor="middle" fill="#666" font-family="sans-serif" font-size="11">${T.noThumb}</text>` +
  `</svg>`
);

function videoCard(v, site, opts = {}) {
  if (!v) return '';
  const link = v.link || '#';
  const id = site === 'youtube' ? (v.vid || '') : (v.bv || '');
  const metaBits = [
    v.post_date || '',
    v.length || '',
    v.visit_volume ? v.visit_volume + ' ' + T.viewsSuffix : '',
    id,
  ].filter(Boolean);
  const sim = opts.similarity != null
    ? `<span class="rv-sim ${simClass(opts.similarity)}">≈ ${opts.similarity.toFixed(2)}</span>`
    : '';
  return `
    <article class="vcard ${opts.extraClass || ''}" ${opts.dataset || ''}>
      <img src="${thumbURL(v.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer"
           onerror="this.onerror=null;this.src='${FALLBACK_THUMB}'">
      <div class="vcard-body">
        <a class="vcard-title" href="${link}" target="_blank" rel="noopener">${escapeHTML(v.name || T.untitled)}</a>
        <div class="vcard-meta">
          <span class="site-tag ${site}">${site}</span>
          ${metaBits.map(b => `<span>${escapeHTML(b)}</span>`).join('')}
        </div>
      </div>
      ${sim}
    </article>`;
}

function itemState(item) {
  const d = item.decision;
  if (!d) return 'pending';
  if (d.action === 'keep_separate') return 'separate';
  if (d.action === 'merge') {
    if (d.auto && !d.confirmed) return 'auto';
    return 'confirmed';
  }
  return 'pending';
}

function usedBvs() {
  const s = new Set();
  for (const r of review) {
    const d = r.decision;
    if (d?.action === 'merge' && d.bv) s.add(d.bv);
  }
  return s;
}

function updateTabCounts() {
  const counts = { merged: 0, yt_only: 0, bili_only: 0 };
  for (const r of review) {
    const st = itemState(r);
    if (st === 'separate') counts.yt_only++;
    else counts.merged++;  // pending + auto + confirmed all belong here
  }
  const used = usedBvs();
  counts.bili_only = biliVideos.filter(b => !used.has(b.bv)).length;

  for (const key of Object.keys(counts)) {
    const el = tabsEl.querySelector(`[data-count="${key}"]`);
    if (el) el.textContent = counts[key];
  }
}

function render() {
  updateTabCounts();

  if (activeTab === 'merged') return renderMerged();
  if (activeTab === 'yt_only') return renderYTOnly();
  if (activeTab === 'bili_only') return renderBiliOnly();
}

function renderMerged() {
  const groups = { pending: [], auto: [], confirmed: [] };
  review.forEach((item, idx) => {
    const st = itemState(item);
    if (st in groups) groups[st].push({ item, idx });
  });

  const sections = [
    section(T.sectionHead.pending, groups.pending, false),
    section(T.sectionHead.auto, groups.auto, false),
    section(T.sectionHead.confirmed, groups.confirmed, true),
  ].filter(Boolean);

  if (!sections.length) {
    listEl.innerHTML = `<div class="rv-empty">${T.empty.merged}</div>`;
    return;
  }
  listEl.innerHTML = sections.join('');
}

function section(title, entries, collapsed) {
  if (!entries.length) return '';
  const body = entries.map(({ item, idx }) => renderItem(item, idx)).join('');
  return `
    <details class="rv-section" ${collapsed ? '' : 'open'}>
      <summary class="rv-section-head">
        <span class="rv-section-title">${title}</span>
        <span class="rv-section-count">${entries.length}</span>
      </summary>
      <div class="rv-section-body">${body}</div>
    </details>`;
}

function renderYTOnly() {
  const entries = [];
  review.forEach((item, idx) => {
    if (itemState(item) === 'separate') entries.push({ item, idx });
  });
  if (!entries.length) {
    listEl.innerHTML = `<div class="rv-empty">${T.empty.yt_only}</div>`;
    return;
  }
  listEl.innerHTML = entries.map(({ item, idx }) => renderItem(item, idx)).join('');
}

function renderBiliOnly() {
  const used = usedBvs();
  const entries = biliVideos.filter(b => !used.has(b.bv));
  if (!entries.length) {
    listEl.innerHTML = `<div class="rv-empty">${T.empty.bili_only}</div>`;
    return;
  }
  listEl.innerHTML = entries.map(b => `
    <section class="rv-item rv-item-single">
      ${videoCard(b, 'bilibili')}
      <form class="rv-bili-link" data-bv="${escapeHTML(b.bv)}">
        <input type="text" placeholder="${T.biliLink.placeholder}" autocomplete="off" spellcheck="false">
        <button class="btn primary" type="submit">${T.biliLink.submit}</button>
        <span class="rv-link-msg"></span>
      </form>
    </section>`).join('');
}

function extractYTVid(s) {
  if (!s) return null;
  s = s.trim();
  let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/youtube\.com\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/^([A-Za-z0-9_-]{11})$/);
  if (m) return m[1];
  return null;
}

function linkBiliToYT(form) {
  const bv = form.dataset.bv;
  const input = form.querySelector('input');
  const msg = form.querySelector('.rv-link-msg');
  const setErr = (text) => {
    input.classList.add('err');
    msg.classList.remove('ok');
    msg.textContent = text;
  };
  input.classList.remove('err');
  msg.textContent = '';

  const vid = extractYTVid(input.value);
  if (!vid) return setErr(T.biliLink.errInvalid);
  const idx = review.findIndex(r => r.youtube?.vid === vid);
  if (idx === -1) return setErr(T.biliLink.errNotFound);
  const bili = biliVideos.find(b => b.bv === bv);
  if (!bili) return;

  decide(idx, {
    action: 'merge',
    bv: bili.bv,
    bilibili_name: bili.name,
    similarity: 1.0,
    manual: true,
    confirmed: true,
  });
  // After decide(), render re-runs and the card unmounts; no need to set "ok" msg.
}

function renderItem(item, idx) {
  const state = itemState(item);
  const d = item.decision;
  const selectedBv = d?.action === 'merge' ? d.bv : null;

  let header, candidates, actions;

  if (state === 'pending') {
    header = `<span class="rv-decision pending">${T.badge.pending}</span>`;
    candidates = `
      <div class="rv-candidates-label">${T.candidatesLabel}</div>
      ${(item.top_bilibili_candidates || []).map((c, cidx) =>
        videoCard(c.bilibili, 'bilibili', {
          similarity: c.similarity,
          extraClass: 'rv-candidate',
          dataset: `data-idx="${idx}" data-cand="${cidx}"`,
        })).join('')}`;
    actions = `
      <button class="btn ghost" data-action="keep_separate" data-idx="${idx}">${T.btn.keepSeparate}</button>`;
  } else if (state === 'auto') {
    const matched = (item.top_bilibili_candidates || []).find(c => c.bilibili?.bv === selectedBv);
    header = `<span class="rv-decision auto">${T.badge.auto(d.similarity ?? 1)}</span>`;
    candidates = matched
      ? videoCard(matched.bilibili, 'bilibili', { similarity: matched.similarity, extraClass: 'rv-candidate selected' })
      : '';
    actions = `
      <button class="btn ghost" data-action="send_to_review" data-idx="${idx}">${T.btn.sendBack}</button>
      <button class="btn primary" data-action="confirm" data-idx="${idx}">${T.btn.confirm}</button>`;
  } else if (state === 'confirmed') {
    const matched = (item.top_bilibili_candidates || []).find(c => c.bilibili?.bv === selectedBv);
    header = `<span class="rv-decision merge">${T.badge.confirmed}</span>`;
    candidates = matched
      ? videoCard(matched.bilibili, 'bilibili', { similarity: matched.similarity, extraClass: 'rv-candidate selected' })
      : '';
    actions = `
      <button class="btn ghost" data-action="send_to_review" data-idx="${idx}">${T.btn.sendBack}</button>`;
  } else {
    header = `<span class="rv-decision separate">${T.badge.separate}</span>`;
    candidates = '';
    actions = `<button class="btn ghost" data-action="reset" data-idx="${idx}">${T.btn.reset}</button>`;
  }

  return `
    <section class="rv-item decided-${state}" data-idx="${idx}">
      <div class="rv-head">
        <h2>#${idx + 1}</h2>
        ${header}
      </div>
      ${videoCard(item.youtube, 'youtube')}
      ${candidates}
      <div class="rv-actions">${actions}</div>
    </section>`;
}

function decide(idx, decision) {
  review[idx].decision = decision;
  dirty = true;
  render();
  scheduleSave();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  setStatus(T.saving, 'pending');
  saveTimer = setTimeout(save, 400);
}

async function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(review)); } catch {}

  if (!apiAvailable) {
    setStatus(T.savedLocal, 'pending');
    dirty = false;
    return;
  }

  try {
    const res = await fetch(API_REVIEW, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    });
    const text = await res.text();
    if (!res.ok || text.trim().startsWith('<')) {
      apiAvailable = false;
      setStatus(T.savedLocal, 'pending');
      dirty = false;
      return;
    }
    const body = JSON.parse(text);
    if (!body.ok) throw new Error(body.error || 'save rejected');
    dirty = false;
    setStatus(T.saved(body.items), 'ok');
  } catch {
    apiAvailable = false;
    setStatus(T.savedLocal, 'pending');
    dirty = false;
  }
}

async function probeAPI() {
  try {
    const res = await fetch(API_REVIEW, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const text = await res.text();
    if (text.trim().startsWith('{')) { apiAvailable = true; return; }
  } catch {}
  apiAvailable = false;
}

function downloadReview() {
  const blob = new Blob([JSON.stringify(review, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'merge_review.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(T.downloaded(review.length), 'ok');
}

listEl.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form.rv-bili-link');
  if (!form) return;
  ev.preventDefault();
  linkBiliToYT(form);
});

listEl.addEventListener('click', (ev) => {
  const candEl = ev.target.closest('.rv-candidate');
  const btn = ev.target.closest('button[data-action]');
  if (btn) {
    const idx = +btn.dataset.idx;
    const action = btn.dataset.action;
    if (action === 'reset') decide(idx, null);
    else if (action === 'keep_separate') decide(idx, { action: 'keep_separate' });
    else if (action === 'confirm') {
      const d = review[idx].decision;
      if (d?.action === 'merge') decide(idx, { ...d, confirmed: true, auto: false });
    } else if (action === 'send_to_review') {
      decide(idx, null);
    }
    return;
  }
  if (candEl) {
    if (ev.target.closest('a')) return;
    const idx = +candEl.dataset.idx;
    const cidx = candEl.dataset.cand;
    if (cidx === undefined) return;
    const cand = review[idx].top_bilibili_candidates[+cidx];
    if (cand?.bilibili?.bv) {
      decide(idx, {
        action: 'merge',
        bv: cand.bilibili.bv,
        bilibili_name: cand.bilibili.name,
        similarity: cand.similarity,
        confirmed: true,
      });
    }
  }
});

tabsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.rv-tab');
  if (!btn) return;
  activeTab = btn.dataset.tab;
  tabsEl.querySelectorAll('.rv-tab').forEach(t => t.classList.toggle('active', t === btn));
  render();
});

document.getElementById('reload').addEventListener('click', load);
document.getElementById('download-review').addEventListener('click', downloadReview);

async function load() {
  setStatus(T.loading);
  try {
    const [rRes, bRes] = await Promise.all([
      fetch(REVIEW_URL, { cache: 'no-store' }),
      fetch(VIDEOS_URL, { cache: 'no-store' }),
    ]);
    review = await rRes.json();
    biliVideos = await bRes.json();
    try {
      const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (Array.isArray(cached) && cached.length === review.length) {
        review.forEach((r, i) => { if (cached[i]?.decision !== undefined) r.decision = cached[i].decision; });
      }
    } catch {}
    dirty = false;
    await probeAPI();
    render();
    setStatus(apiAvailable ? T.loaded(review.length) : T.savedLocal, apiAvailable ? 'ok' : 'pending');
  } catch (err) {
    setStatus(T.loadFail(err.message), 'err');
  }
}

window.addEventListener('beforeunload', (ev) => {
  if (dirty) { ev.preventDefault(); ev.returnValue = ''; }
});

load();
