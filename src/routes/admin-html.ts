/**
 * Embedded admin panel — single HTML page, no build step, no external assets.
 * Design follows the apple-design skill: platform system font with
 * size-specific tracking, translucent chrome (backdrop blur) with material
 * weight encoding hierarchy, tabular numerals for data, 200ms cross-fade
 * section transitions with full reduced-motion support, instant press
 * feedback on every control.
 */

export function adminPanelHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wkbdy2api Console</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f5f5f7;
  --bg-raised: rgba(255, 255, 255, 0.72);
  --bg-sidebar: rgba(240, 240, 243, 0.82);
  --chrome-border: rgba(0, 0, 0, 0.08);
  --card-border: rgba(0, 0, 0, 0.06);
  --text: #1d1d1f;
  --text-secondary: #6e6e73;
  --text-tertiary: #8e8e93;
  --accent: #0071e3;
  --accent-pressed: #0060c9;
  --ok: #34c759;
  --warn: #ff9f0a;
  --error: #ff3b30;
  --row-hover: rgba(0, 0, 0, 0.03);
  --divider: rgba(0, 0, 0, 0.07);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1c1c1e;
    --bg-raised: rgba(44, 44, 46, 0.72);
    --bg-sidebar: rgba(28, 28, 30, 0.86);
    --chrome-border: rgba(255, 255, 255, 0.08);
    --card-border: rgba(255, 255, 255, 0.09);
    --text: #f5f5f7;
    --text-secondary: #98989d;
    --text-tertiary: #77777c;
    --accent: #0a84ff;
    --accent-pressed: #409cff;
    --ok: #30d158;
    --warn: #ff9f0a;
    --error: #ff453a;
    --row-hover: rgba(255, 255, 255, 0.04);
    --divider: rgba(255, 255, 255, 0.08);
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font: 100%/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro SC",
        "PingFang SC", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  font-optical-sizing: auto;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

/* ---- layout: settings-style sidebar + content ---- */
.shell {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  width: 220px;
  flex-shrink: 0;
  padding: 20px 12px;
  background: var(--bg-sidebar);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border-right: 1px solid var(--chrome-border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.main {
  flex: 1;
  min-width: 0;
  padding: 32px clamp(20px, 4vw, 48px) 64px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 8px 12px;
}
.brand-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent);
  flex-shrink: 0;
}
.brand-dot.down { background: var(--error); box-shadow: 0 0 0 3px color-mix(in srgb, var(--error) 20%, transparent); }
.brand h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.brand small { display: block; font-size: 11px; color: var(--text-tertiary); font-weight: 400; letter-spacing: 0; }

.nav { display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 130ms ease-out;
}
.nav-item:active { background: var(--row-hover); transform: scale(0.985); }
.nav-item[aria-current="true"] { background: var(--accent); color: #fff; }
.nav-item svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.85; }

.sidebar-footer {
  margin-top: auto;
  padding: 10px 8px 0;
  border-top: 1px solid var(--divider);
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}

/* ---- content ---- */
.section { animation: fadeIn 200ms ease-out; max-width: 920px; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .section { animation: none; }
  * { transition: none !important; }
}
.section[hidden] { display: none; }

h2 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.page-sub { margin: 0 0 24px; color: var(--text-secondary); font-size: 13px; }

/* ---- stat tiles ---- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.stat {
  background: var(--bg-raised);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 14px 16px;
}
.stat-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
  line-height: 1.1;
}
.stat-value.ok { color: var(--ok); }
.stat-value.bad { color: var(--error); }
.stat-value small { font-size: 14px; font-weight: 500; color: var(--text-secondary); }

/* ---- cards (grouped lists, settings style) ---- */
.card {
  background: var(--bg-raised);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 24px;
}
.card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px 10px;
}
.card-title { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; margin: 0; }
.card-note { font-size: 12px; color: var(--text-tertiary); }

.rows { display: flex; flex-direction: column; }
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 18px;
  border-top: 1px solid var(--divider);
  min-height: 44px;
}
.row:first-child { border-top: none; }
.row:hover { background: var(--row-hover); }
.row-main { flex: 1; min-width: 0; }
.row-title { font-size: 13px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-size: 12px; color: var(--text-secondary); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-value { font-size: 13px; color: var(--text-secondary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.context-picker { display: inline-flex; align-items: center; gap: 7px; margin-top: 8px; font-size: 11px; font-weight: 600; letter-spacing: .01em; color: var(--text-tertiary); }
.context-select { appearance: none; border: 1px solid var(--card-border); border-radius: 8px; background: var(--bg-raised); color: var(--text-primary); padding: 6px 28px 6px 10px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: transform 120ms ease-out, border-color 160ms ease, background 160ms ease; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 13px) 10px, calc(100% - 9px) 10px; background-size: 4px 4px, 4px 4px; background-repeat: no-repeat; }
.context-select:hover { border-color: var(--accent); background-color: var(--row-hover); }
.context-select:active { transform: scale(.97); }
.context-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .context-select { transition: none; } }

/* ---- pills / badges ---- */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 99px;
  flex-shrink: 0;
  letter-spacing: 0.01em;
}
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.pill.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
.pill.error { color: var(--error); background: color-mix(in srgb, var(--error) 12%, transparent); }
.pill.neutral { color: var(--text-secondary); background: var(--row-hover); }
.pill.neutral::before { display: none; }

/* ---- request log table ---- */
.log-scroll { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 10px 18px;
  border-bottom: 1px solid var(--divider);
  white-space: nowrap;
}
td { padding: 9px 18px; border-top: 1px solid var(--divider); white-space: nowrap; }
td.path { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 11.5px; }
td .muted { color: var(--text-tertiary); }

/* ---- controls ---- */
.controls { display: flex; gap: 10px; align-items: center; }
.btn {
  appearance: none;
  border: none;
  border-radius: 8px;
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  background: var(--accent);
  transition: background 130ms ease-out, transform 80ms ease-out;
}
.btn:active { background: var(--accent-pressed); transform: scale(0.97); }
.btn.secondary {
  color: var(--text);
  background: var(--row-hover);
  border: 1px solid var(--card-border);
}
.btn.secondary:active { background: var(--divider); }

/* ---- segmented control (strategy switch) ---- */
.seg {
  display: inline-flex;
  background: var(--row-hover);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}
.seg-btn {
  appearance: none;
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: background 130ms ease-out, color 130ms ease-out;
}
.seg-btn:active { transform: scale(0.96); }
.seg-btn.active { background: var(--accent); color: #fff; }

/* ---- login form ---- */
.login-form { padding: 4px 18px 16px; display: flex; flex-direction: column; gap: 10px; }
.form-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.login-form .key-input { font-size: 12.5px; }
.form-hint {
  margin: 10px 0 2px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.55;
}
.form-hint code {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 11px;
  background: var(--row-hover);
  padding: 1px 5px;
  border-radius: 4px;
}
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--divider);
}
.footer-note { font-size: 12px; color: var(--text-secondary); }

/* ---- unlock view ---- */
.unlock {
  max-width: 420px;
  margin: 18vh auto 0;
  background: var(--bg-raised);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.08);
  animation: fadeIn 200ms ease-out;
}
.unlock h2 { font-size: 18px; }
.unlock p { font-size: 13px; color: var(--text-secondary); margin: 4px 0 18px; }
.key-input {
  width: 100%;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  outline: none;
  transition: border-color 130ms ease-out;
}
.key-input:focus { border-color: var(--accent); }
.key-error { color: var(--error); font-size: 12px; min-height: 16px; margin: 8px 0 2px; }

/* ---- model bars (per-model usage) ---- */
.bar-track {
  height: 4px;
  border-radius: 2px;
  background: var(--divider);
  overflow: hidden;
  min-width: 80px;
}
.bar-fill { height: 100%; border-radius: 2px; background: var(--accent); }

/* responsive: sidebar collapses to top bar */
@media (max-width: 720px) {
  .shell { flex-direction: column; }
  .sidebar {
    position: static;
    height: auto;
    width: 100%;
    flex-direction: row;
    align-items: center;
    padding: 10px 16px;
    border-right: none;
    border-bottom: 1px solid var(--chrome-border);
    gap: 10px;
  }
  .brand { padding: 0; }
  .brand h1 { font-size: 14px; }
  .brand small { display: none; }
  .nav { flex-direction: row; overflow-x: auto; flex: 1; }
  .nav-item { width: auto; white-space: nowrap; }
  .nav-item span { display: none; }
  .sidebar-footer { display: none; }
  .main { padding: 20px 16px 48px; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
</style>
</head>
<body>

<div id="app"></div>

<script>
(function () {
  'use strict';

  var KEY_STORAGE = 'wkb2api-admin-key';
  var CONTEXT_STORAGE = 'wkb2api-model-context';
  var state = {
    key: null,
    overview: null,
    view: 'overview',
    timer: null,
    unlockError: null,
    oauth: null,
    oauthTimer: null,
    oauthBusy: false,
    oauthMessage: '',
    oauthUrl: '',
    overviewPending: false,
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  // ---------- icons (inline, 16px, stroke-based) ----------
  var icons = {
    overview: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6v3.6l2.3 1.4"/></svg>',
    models: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.2" y="2.7" width="11.6" height="4" rx="1.2"/><rect x="2.2" y="9.3" width="11.6" height="4" rx="1.2"/><path d="M4.4 4.7h.01M4.4 11.3h.01"/></svg>',
    requests: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.2h11M2.5 8h11M2.5 11.8h7"/></svg>',
    upstream: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 6.4a5.2 5.2 0 1 0-1.6 5.1"/><path d="M13.4 2.9v3.6h-3.6"/></svg>',
  };

  function navLabel(v) {
    return { overview: '概览', models: '模型', requests: '请求记录', upstream: '上游与凭据' }[v];
  }

  // ---------- data ----------
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + state.key });
    return fetch('/admin/api/' + path, Object.assign({}, opts, { headers: headers, credentials: 'same-origin' })).then(function (res) {
      return res.json().then(function (body) {
        if (res.status === 401 && body.error && body.error.code === 'invalid_api_key') {
          try { localStorage.removeItem(KEY_STORAGE); } catch (e) {}
          state.key = null;
          state.overview = null;
          state.unlockError = 'Key 无效，请检查后重试。';
          clearTimeout(state.oauthTimer);
          state.oauth = null;
          state.oauthUrl = '';
          stopTimer();
          render();
        }
        if (!res.ok) {
          var error = new Error(body.error && body.error.message || '请求失败（HTTP ' + res.status + '）');
          error.code = body.error && body.error.code;
          throw error;
        }
        return body;
      });
    });
  }

  function refreshOverview() {
    if (state.overviewPending) return Promise.resolve();
    state.overviewPending = true;
    return api('overview').then(function (d) {
      state.overview = d;
      if (!$('#main')) return;
      if (!$('#main').firstElementChild) renderMain();
      else if (state.view === 'overview') patchOverview(d);
      else if (state.view === 'upstream') patchAccountPool(d);
    }).finally(function () { state.overviewPending = false; });
  }

  /** In-place update of overview numbers/bars — never rebuilds the section. */
  function patchOverview(d) {
    if (!$('#stat-total') || !$('#stat-errors')) { renderMain(); return; } // not built yet → full render
    var s = d.stats;
    function set(id, text, cls) {
      var el = $('#' + id);
      if (!el) return;
      el.textContent = text;
      el.className = 'stat-value' + (cls ? ' ' + cls : '');
    }
    set('stat-total', fmtInt(s.total_requests));
    set('stat-errors', fmtPct(s.error_rate), s.error_rate > 0.05 ? 'bad' : 'ok');
    set('stat-p95', fmtMs(s.p95_ms));
    set('stat-tokens', fmtInt(s.tokens.prompt + s.tokens.completion));

    var rows = document.querySelectorAll('[data-mkey]');
    if (rows.length !== s.per_model.length) { renderMain(); return; } // shape changed → rebuild once
    var max = 0;
    s.per_model.forEach(function (m) { if (m.count > max) max = m.count; });
    s.per_model.forEach(function (m) {
      var row = document.querySelector('[data-mkey="' + m.model + '"]');
      if (!row) return;
      var fill = row.querySelector('.bar-fill');
      var val = row.querySelector('.row-value');
      if (fill) fill.style.width = (max ? Math.round(m.count / max * 100) : 0) + '%';
      if (val) val.textContent = fmtInt(m.count) + ' 次 · ' + fmtInt(m.tokens) + ' tok';
    });
  }

  function startTimer() {
    stopTimer();
    state.timer = setInterval(function () { refreshOverview().catch(function () {}); }, 5000);
  }
  function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  // ---------- formatting ----------
  function fmtInt(n) { return (n || 0).toLocaleString(); }
  function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }
  function fmtMs(n) { return n == null ? '—' : (n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms'); }
  function fmtContextLength(n) {
    return n >= 1000000 ? (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M' : Math.round(n / 1000) + 'K';
  }
  function getContextPreferences() {
    try { return JSON.parse(localStorage.getItem(CONTEXT_STORAGE) || '{}'); } catch (e) { return {}; }
  }
  function saveContextPreference(model, value) {
    try {
      var prefs = getContextPreferences();
      prefs[model] = value;
      localStorage.setItem(CONTEXT_STORAGE, JSON.stringify(prefs));
    } catch (e) {}
  }
  function setGlobalContext(value) {
    fetch('/admin/api/context-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.key },
      credentials: 'same-origin',
      body: JSON.stringify({ context_window: value }),
    }).then(function () {
      if (state.overview && state.overview.pool) state.overview.pool.context_window = value;
      document.querySelectorAll('.context-select').forEach(function (other) {
        var model = state.overview.models.find(function (m) { return m.id === other.getAttribute('data-context-model'); });
        var lengths = model && model.x_workbuddy && model.x_workbuddy.context_window && model.x_workbuddy.context_window.supportedLengths || [];
        if (lengths.indexOf(value) >= 0) other.value = String(value);
      });
    }).catch(function () {});
  }

  function wireContextSelectors() {
    document.querySelectorAll('.context-select').forEach(function (select) {
      select.addEventListener('change', function () {
        var model = select.getAttribute('data-context-model');
        var value = Number(select.value);
        saveContextPreference(model, value);
        setGlobalContext(value);
      });
    });
  }

  function fmtUptime(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + ' 小时 ' + m + ' 分' : m + ' 分 ' + (s % 60) + ' 秒';
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- views ----------
  function render() {
    var app = $('#app');
    if (!state.key) { app.innerHTML = unlockView(); wireUnlock(); return; }
    app.innerHTML = shellView();
    wireNav();
    renderMain();
  }

  function unlockView() {
    return '<div class="unlock">' +
      '<h2>Wkbdy2api 控制台</h2>' +
      '<p>输入网关的本地 API Key（与调用 /v1 接口使用的 Bearer Key 相同）。Key 只保存在此浏览器。</p>' +
      '<input class="key-input" id="key-input" type="password" placeholder="wkb2api-local-key…" autocomplete="off">' +
      '<div class="key-error" id="key-error">' + (state.unlockError || '') + '</div>' +
      '<button class="btn" id="key-submit" style="width:100%">解锁</button>' +
      '</div>';
  }

  function wireUnlock() {
    var input = $('#key-input'), btn = $('#key-submit'), err = $('#key-error');
    function submit() {
      var v = input.value.trim();
      if (!v) { err.textContent = '请输入 Key。'; return; }
      if (btn.disabled) return;
      state.key = v;
      state.overview = null;
      state.unlockError = null;
      btn.disabled = true;
      btn.textContent = '正在验证…';
      refreshOverview().then(function () {
        try { localStorage.setItem(KEY_STORAGE, v); } catch (e) {}
        render();
        startTimer();
      }).catch(function () {
        state.key = null;
        state.overview = null;
        state.unlockError = state.unlockError || '无法连接网关，请重试。';
        render();
      });
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  function shellView() {
    var items = ['overview', 'models', 'requests', 'upstream'].map(function (v) {
      return '<button class="nav-item" data-view="' + v + '"' +
        (state.view === v ? ' aria-current="true"' : '') + '>' + icons[v] + '<span>' + navLabel(v) + '</span></button>';
    }).join('');
    return '<div class="shell">' +
      '<aside class="sidebar">' +
      '<div class="brand"><span class="brand-dot" id="health-dot"></span><div><h1>Wkbdy2api</h1><small>WorkBuddy → OpenAI 网关</small></div></div>' +
      '<nav class="nav">' + items + '</nav>' +
      '<div class="sidebar-footer">v' + escapeHtml(state.overview ? state.overview.version : '') + ' · 本地运行</div>' +
      '</aside><main class="main" id="main"></main></div>';
  }

  function renderMain() {
    var main = $('#main');
    if (!main || !state.overview) return;
    var d = state.overview;
    var dot = $('#health-dot');
    if (dot) dot.classList.toggle('down', d.credential.ok === false && !(d.pool && d.pool.accounts.some(function (a) { return a.ok; })));

    if (state.view === 'overview') main.innerHTML = viewOverview(d);
    else if (state.view === 'models') { main.innerHTML = viewModels(d); wireContextSelectors(); }
    else if (state.view === 'requests') { main.innerHTML = viewRequestsShell(); loadRequests(); }
    else if (state.view === 'upstream') {
      main.innerHTML = viewUpstream(d);
      wireLoginForm();
      updateOAuthView();
    }
  }

  function statTile(label, value, cls, id) {
    var idAttr = id ? ' id="' + id + '"' : '';
    return '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value ' + (cls || '') + '"' + idAttr + '>' + value + '</div></div>';
  }

  function viewOverview(d) {
    var s = d.stats;
    var maxCount = 0;
    s.per_model.forEach(function (m) { if (m.count > maxCount) maxCount = m.count; });
    var modelRows = s.per_model.length === 0
      ? '<div class="row"><div class="row-main"><div class="row-title muted" style="color:var(--text-tertiary)">尚无请求</div></div></div>'
      : s.per_model.map(function (m) {
        return '<div class="row" data-mkey="' + escapeHtml(m.model) + '">' +
          '<div class="row-main"><div class="row-title">' + escapeHtml(m.model) + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + (maxCount ? Math.round(m.count / maxCount * 100) : 0) + '%"></div></div></div>' +
          '<div class="row-value">' + fmtInt(m.count) + ' 次 · ' + fmtInt(m.tokens) + ' tok</div></div>';
      }).join('');

    return '<section class="section"><h2>概览</h2>' +
      '<p class="page-sub">网关运行 ' + fmtUptime(s.uptime_ms) + '，数据每 5 秒自动刷新。</p>' +
      '<div class="stat-grid">' +
      statTile('总请求', fmtInt(s.total_requests), '', 'stat-total') +
      statTile('错误率', fmtPct(s.error_rate), s.error_rate > 0.05 ? 'bad' : 'ok', 'stat-errors') +
      statTile('P95 延迟', fmtMs(s.p95_ms), '', 'stat-p95') +
      statTile('Token 用量', fmtInt(s.tokens.prompt + s.tokens.completion), '', 'stat-tokens') +
      '</div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">模型调用量</h3><span class="card-note">累计请求 · 最近 200 条窗口</span></div>' +
      '<div class="rows">' + modelRows + '</div></div>' +
      '</section>';
  }

  function viewModels(d) {
    var rows = d.models.map(function (m) {
      var x = m.x_workbuddy || {};
      var tags = [];
      if (x.is_default) tags.push('<span class="pill neutral">默认</span>');
      if (x.supports_tool_call) tags.push('tool');
      if (x.supports_images) tags.push('vision');
      var maxIn = x.max_input_tokens ? (x.max_input_tokens >= 1000000 ? (x.max_input_tokens / 1000000) + 'M' : Math.round(x.max_input_tokens / 1000) + 'K') : '—';
      var maxOut = x.max_output_tokens ? (x.max_output_tokens >= 1000 ? Math.round(x.max_output_tokens / 1000) + 'K' : x.max_output_tokens) : '—';
      var contextWindow = x.context_window || {};
      var contextLengths = Array.isArray(contextWindow.supportedLengths)
        ? contextWindow.supportedLengths.filter(function (length) { return Number.isInteger(length) && length > 0; }).sort(function (a, b) { return a - b; })
        : [];
      var selectedContext = contextLengths.indexOf(d.pool && d.pool.context_window) >= 0
        ? d.pool.context_window
        : contextWindow.defaultLength;
      if (contextLengths.indexOf(selectedContext) < 0) selectedContext = contextLengths[contextLengths.length - 1];
      var contextTiers = contextLengths.length > 1
        ? '<label class="context-picker">上下文<select class="context-select" data-context-model="' + escapeHtml(m.id) + '">'
          + contextLengths.map(function (length) {
            var selected = length === selectedContext ? ' selected' : '';
            return '<option value="' + length + '"' + selected + '>' + fmtContextLength(length) + (length === contextWindow.defaultLength ? '（默认）' : '') + '</option>';
          }).join('') + '</select></label>'
        : '';
      var price = x.credits ? '<span class="pill ' + (x.credits === 'x0.00' ? 'ok' : 'neutral') + '">Credits ' + escapeHtml(x.credits) + '</span>' : '<span class="pill neutral">Credits 未提供</span>';
      return '<div class="row">' +
        '<div class="row-main"><div class="row-title" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">' + escapeHtml(m.id) + '</div>' +
        '<div class="row-sub">' + escapeHtml(x.name || '') + (tags.length ? ' · ' + tags.join(' · ') : '') + '</div>' + contextTiers + '</div>' +
        '<div class="row-value">入 ' + maxIn + ' / 出 ' + maxOut + '</div>' +
        price + '</div>';
    }).join('');
    return '<section class="section"><h2>模型</h2>' +
      '<p class="page-sub">' + d.models.length + ' 个可用模型，由 CLI agent 白名单与配置交集生成。</p>' +
      '<div class="card"><div class="rows">' + rows + '</div></div></section>';
  }

  function viewRequestsShell() {
    return '<section class="section"><h2>请求记录</h2>' +
      '<p class="page-sub">最近 ' + 200 + ' 条请求（重启后清零）。</p>' +
      '<div class="card log-scroll" id="req-card"><div id="req-body" class="muted" style="color:var(--text-tertiary);padding:16px 18px;font-size:13px">加载中…</div></div></section>';
  }

  function loadRequests() {
    api('requests').then(function (d) {
      var body = $('#req-body');
      if (!body) return;
      if (!d.recent || d.recent.length === 0) {
        body.innerHTML = '尚无请求记录。';
        return;
      }
      var trs = d.recent.map(function (r) {
        var st = '<span class="muted">' + r.status + '</span>';
        if (r.status >= 500) st = '<span style="color:var(--error);font-weight:600">' + r.status + '</span>';
        else if (r.status >= 400) st = '<span style="color:var(--warn);font-weight:600">' + r.status + '</span>';
        else if (r.status < 300) st = '<span style="color:var(--ok);font-weight:600">' + r.status + '</span>';
        var tok = (r.prompt_tokens || r.completion_tokens) ? (r.prompt_tokens || 0) + ' / ' + (r.completion_tokens || 0) : '<span class="muted">—</span>';
        return '<tr><td>' + fmtTime(r.time) + '</td><td class="path">' + escapeHtml(r.method + ' ' + r.path) +
          (r.model ? ' <span class="muted">· ' + escapeHtml(r.model) + (r.stream ? ' · stream' : '') + '</span>' : '') + '</td>' +
          '<td>' + st + '</td><td>' + tok + '</td><td>' + fmtMs(r.duration_ms) + '</td></tr>';
      }).join('');
      $('#req-card').innerHTML = '<table><thead><tr><th>时间</th><th>请求</th><th>状态</th><th>tok 入/出</th><th>耗时</th></tr></thead><tbody>' + trs + '</tbody></table>';
    }).catch(function () {});
  }

  function viewUpstream(d) {
    var c = d.credential;
    var u = d.upstream;
    var pool = d.pool || { size: 0, strategy: 'round-robin', accounts: [] };
    var stratName = pool.strategy === 'random' ? '随机' : '轮询';

    var acctRows = pool.accounts.map(function (a) {
      return '<div class="row">' +
        '<div class="row-main"><div class="row-title">' + escapeHtml(a.label) + (a.note ? ' · ' + escapeHtml(a.note) : '') + '</div>' +
        '<div class="row-sub">' + escapeHtml(a.detail) + '</div></div>' +
        '<span class="pill ' + (a.ok ? 'ok' : 'warn') + '">' + (a.ok ? '可用' : '冷却中') + '</span>' +
        '<button class="btn secondary acct-remove" data-label="' + escapeHtml(a.label) + '" style="padding:4px 10px;font-size:12px">移除</button>' +
        '</div>';
    }).join('');
    if (pool.size === 0) {
      acctRows = '<div class="row"><div class="row-main"><div class="row-title" style="color:var(--text-tertiary)">账号池为空 — 使用本机凭据文件的单账号</div></div></div>';
    }

    var isRR = pool.strategy === 'round-robin';
    return '<section class="section"><h2>上游与凭据</h2>' +
      '<p class="page-sub">账号池内的凭据按请求轮流使用；池为空时回落到本机凭据文件。凭据值永不显示、不落盘。</p>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">账号池</h3>' +
      '<div class="controls">' +
      '<div class="seg" role="tablist"><button class="seg-btn' + (isRR ? ' active' : '') + '" data-strategy="round-robin" role="tab" aria-selected="' + isRR + '">轮询</button>' +
      '<button class="seg-btn' + (!isRR ? ' active' : '') + '" data-strategy="random" role="tab" aria-selected="' + !isRR + '">随机</button></div>' +
      '</div></div>' +
      '<div class="rows" id="acct-rows">' + acctRows + '</div>' +
      (pool.size === 0
        ? ''
        : '<div class="card-footer"><div class="footer-note">' + pool.size + ' 个账号 · ' + stratName + '调度 · 401 的账号自动冷却后重试</div></div>') +
      '</div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">添加账号</h3><span class="card-note">官方网页登录</span></div>' +
      '<div class="login-form">' +
      '<p class="form-hint">点击后在 WorkBuddy 官方网页完成登录，网关会自动将账号加入池中。不需要安装桌面客户端，也不用复制 Token。密码和验证码只在官方页面输入。</p>' +
      '<label class="form-label" for="oauth-note">账号备注（可选）</label><input class="key-input" id="oauth-note" maxlength="64" placeholder="例如：工作账号">' +
      '<div class="controls"><button class="btn" id="oauth-start">登录 WorkBuddy</button><button class="btn secondary" id="oauth-cancel" hidden>取消登录</button></div>' +
      '<p class="form-hint" id="oauth-status" role="status" aria-live="polite">登录结果会自动显示，无需刷新。</p>' +
      '<a id="oauth-link" class="form-hint" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" hidden>打开官方登录页面</a>' +
      '<p class="form-hint">账号会加密保存；重启网关后自动恢复，无需重新登录。</p>' +
      '</div></div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">账号池状态</h3><span class="pill ' + (c.ok ? 'ok' : 'error') + '">' + (c.ok ? '可用' : '不可用') + '</span></div>' +
      '<div class="rows">' +
      '<div class="row"><div class="row-main"><div class="row-title">来源</div></div><div class="row-value">' + escapeHtml(c.source) + '</div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">凭据状态</div><div class="row-sub">' + escapeHtml(c.ok ? c.detail : '账号池为空，请登录 WorkBuddy') + '</div></div></div>' +
      '</div></div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">上游端点</h3></div><div class="rows">' +
      '<div class="row"><div class="row-main"><div class="row-title">URL</div></div><div class="row-value" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">' + escapeHtml(u.url) + '</div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">User-Agent</div></div><div class="row-value" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">' + escapeHtml(u.user_agent) + '</div></div>' +
      '</div></div>' +
      '<div class="controls"><button class="btn" id="refresh-now">立即刷新</button></div>' +
      '</section>';
  }

  // ---------- nav wiring ----------
  function wireNav() {
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.view = btn.getAttribute('data-view');
        document.querySelectorAll('.nav-item').forEach(function (b) {
          b.setAttribute('aria-current', b === btn ? 'true' : 'false');
        });
        renderMain();
      });
    });
    var rf = $('#refresh-now');
    if (rf) rf.addEventListener('click', function () { refreshOverview().catch(function () {}); });
  }

  function patchAccountPool(d) {
    var rows = $('#acct-rows');
    if (!rows) return;
    var accounts = d.pool.accounts;
    var html = accounts.map(function (a) {
      return '<div class="row"><div class="row-main"><div class="row-title">' + escapeHtml(a.label) + (a.note ? ' · ' + escapeHtml(a.note) : '') + '</div><div class="row-sub">' + escapeHtml(a.detail) + '</div></div><span class="pill ' + (a.ok ? 'ok' : 'warn') + '">' + (a.ok ? '可用' : '等待恢复') + '</span><button class="btn secondary acct-remove" data-label="' + escapeHtml(a.label) + '">移除</button></div>';
    }).join('') || '<div class="row"><div class="row-title">账号池为空，点击下方按钮登录账号。</div></div>';
    if (rows.dataset.snapshot !== html) { rows.innerHTML = html; rows.dataset.snapshot = html; }
    document.querySelectorAll('[data-strategy]').forEach(function (button) {
      var selected = button.dataset.strategy === d.pool.strategy;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  function updateOAuthView() {
    var start = $('#oauth-start'), cancel = $('#oauth-cancel'), status = $('#oauth-status'), link = $('#oauth-link');
    if (!start) return;
    start.disabled = state.oauthBusy || !!state.oauth;
    start.textContent = state.oauthBusy ? '正在准备登录…' : '登录 WorkBuddy';
    cancel.hidden = !state.oauth;
    status.textContent = state.oauthMessage || '登录结果会自动显示，无需刷新。';
    link.hidden = !state.oauthUrl;
    if (state.oauthUrl) link.href = state.oauthUrl;
    else link.removeAttribute('href');
  }

  function pollOAuth() {
    if (!state.oauth) return;
    var id = state.oauth;
    api('oauth/' + id + '/status').then(function (result) {
      if (state.oauth !== id) return;
      if (result.status === 'completed') {
        state.oauth = null;
        state.oauthUrl = '';
        state.oauthMessage = '登录成功，' + result.account_label + ' 已加入账号池。';
        updateOAuthView();
        return refreshOverview();
      }
      if (['failed', 'expired', 'cancelled'].indexOf(result.status) >= 0) {
        state.oauth = null;
        state.oauthUrl = '';
        state.oauthMessage = result.status === 'expired' ? '登录已超时，请重新开始。' : result.status === 'cancelled' ? '已取消登录。' : '登录失败：' + (result.error || '请重试');
      } else {
        state.oauthMessage = result.status === 'pending' ? '等待你在官方网页完成登录…' : '授权已完成，正在确认账号…';
        state.oauthTimer = setTimeout(pollOAuth, 1500);
      }
      updateOAuthView();
    }).catch(function (error) {
      if (state.oauth !== id) return;
      state.oauth = null;
      state.oauthUrl = '';
      state.oauthMessage = error.message;
      updateOAuthView();
    });
  }

  function wireLoginForm() {
    var start = $('#oauth-start');
    if (!start) return;
    start.addEventListener('click', function () {
      if (state.oauthBusy || state.oauth) return;
      var popup = window.open('about:blank', '_blank');
      if (popup) {
        popup.opener = null;
        popup.document.title = '正在打开官方登录页';
        popup.document.body.textContent = '正在准备 WorkBuddy 登录，请稍候。';
        var meta = popup.document.createElement('meta');
        meta.name = 'referrer'; meta.content = 'no-referrer'; popup.document.head.appendChild(meta);
      }
      state.oauthBusy = true;
      state.oauthMessage = '正在申请官方登录链接…';
      updateOAuthView();
      var note = $('#oauth-note').value.trim();
      api('oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note || undefined }) }).then(function (result) {
        state.oauth = result.id;
        state.oauthUrl = result.authorization_url;
        state.oauthMessage = '请在新打开的官方网页完成登录；未弹出时点击下方链接。';
        if (popup && !popup.closed) popup.location.replace(result.authorization_url);
        clearTimeout(state.oauthTimer);
        state.oauthTimer = setTimeout(pollOAuth, 1500);
      }).catch(function (error) {
        if (popup && !popup.closed) popup.close();
        state.oauthMessage = error.code === 'oauth_already_pending' ? '此浏览器已有登录正在进行，请完成它或等待过期。' : error.message;
      }).finally(function () { state.oauthBusy = false; updateOAuthView(); });
    });
    $('#oauth-cancel').addEventListener('click', function () {
      var id = state.oauth;
      if (!id) return;
      api('oauth/' + id + '/cancel', { method: 'POST' }).then(function (result) {
        if (state.oauth !== id) return;
        clearTimeout(state.oauthTimer);
        state.oauth = null; state.oauthUrl = '';
        state.oauthMessage = result.status === 'completed' ? '账号已登录并加入池中。' : '已取消登录。';
        updateOAuthView();
        return refreshOverview();
      }).catch(function (error) { state.oauthMessage = error.message; updateOAuthView(); });
    });
    $('#acct-rows').addEventListener('click', function (event) {
      var button = event.target.closest('.acct-remove');
      if (!button) return;
      api('accounts/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: button.dataset.label }) })
        .then(refreshOverview).catch(function (error) { state.oauthMessage = error.message; updateOAuthView(); });
    });
    document.querySelectorAll('.seg-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        api('strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy: button.dataset.strategy }) })
          .then(refreshOverview).catch(function (error) { state.oauthMessage = error.message; updateOAuthView(); });
      });
    });
    $('#refresh-now').addEventListener('click', function () { refreshOverview().catch(function () {}); });
  }

  // ---------- boot ----------
  var saved = null;
  try { saved = localStorage.getItem(KEY_STORAGE); } catch (e) {}
  if (saved) {
    state.key = saved;
    refreshOverview().then(function () { if (state.overview) startTimer(); }).catch(function () {});
  }
  render();
})();
</script>
</body>
</html>`;
}
