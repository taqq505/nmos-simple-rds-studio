'use strict';

// ─── App State ────────────────────────────────────────────────────────────────
const appState = {
  config:      null,
  queryBase:   '',
  regBase:     '',
  currentPage: 'overview',
  navigateTo:  null,   // { page, resourceId, fromNode, fromDevice }
};

// ─── Per-page state ───────────────────────────────────────────────────────────
const sdpCache         = new Map();  // senderId -> sdpText | 'error'
let uptimeStart        = Date.now();
let uptimeInterval     = null;
let refreshTimer       = null;

// WebSocket state
let wsConnections    = [];
let wsWatchdog       = null;
let currentRefreshFn = null;
let wsUnsupported    = false;
const WS_WATCHDOG_MS = 60000;

// Filter / UI state (persists across refreshes)
let sendersFilter   = 'all';
let receiversFilter = 'all';
let flowsTab        = 'flows';
let flowsFilter     = 'all';
let logFilter          = 'all';
let logEntries         = [];
let logErrorCount      = 0;
let logWarnCount       = 0;
let logSearchQuery     = '';
let nodeSearch         = '';
let senderSearch       = '';
let localLogUnsubscribe = null;

const LOG_REFRESH_MS = 2000;
const QUERY_PATH     = '/x-nmos/query/v1.3';

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  appState.config = await window.api.loadConfig();
  if (!appState.config) return;
  const cfg = appState.config;

  if (cfg.mode === 'local') {
    appState.queryBase = `http://127.0.0.1:${cfg.query_port}`;
    appState.regBase   = `http://127.0.0.1:${cfg.registration_port}`;
  } else {
    appState.queryBase = (cfg.remote_url     || '').replace(/\/$/, '');
    appState.regBase   = (cfg.remote_reg_url || cfg.remote_url || '').replace(/\/$/, '');
  }

  document.getElementById('tb-url').textContent = appState.queryBase;
  document.getElementById('tb-badge').textContent =
    cfg.mode === 'local' ? 'RDS Running' : 'Connected';

  updateStatusBar();
  startUptimeClock();
  setupNav();
  setupSearch();

  if (cfg.update_mode === 'websocket') {
    initWebSocket();
  }

  watchNodes();
  navigateTo('overview');
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function updateStatusBar() {
  const cfg = appState.config;
  document.getElementById('sb-status').textContent =
    cfg.mode === 'local' ? 'nmos-cpp-registry running' : `Connected: ${cfg.remote_url}`;
  document.getElementById('sb-mdns').textContent =
    `mDNS: _nmos-registration._tcp.${cfg.domain}`;
  document.getElementById('sb-priority').textContent = `Priority: ${cfg.priority}`;
}

// ─── Uptime clock ─────────────────────────────────────────────────────────────
function startUptimeClock() {
  uptimeStart = Date.now();
  uptimeInterval = setInterval(() => {
    const s = Math.floor((Date.now() - uptimeStart) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    document.getElementById('sb-uptime').textContent = `Uptime: ${h}:${m}:${sec}`;
  }, 1000);
}


// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });
}

function navigateTo(page) {
  stopRefresh();
  if (localLogUnsubscribe) { localLogUnsubscribe(); localLogUnsubscribe = null; }
  appState.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page));
  renderPage(page);
}

function renderPage(page) {
  const main = document.getElementById('main-area');
  const pages = {
    overview:  renderOverview,
    map:       renderMap,
    log:       renderLog,
    nodes:     renderNodes,
    senders:   renderSenders,
    receivers: renderReceivers,
    flows:          renderFlows,
    'rds-settings': renderRdsSettings,
    'app-settings': renderAppSettings,
  };
  if (pages[page]) pages[page](main);
}

// ─── Refresh ──────────────────────────────────────────────────────────────────
function startRefresh(fn, ms) {
  stopRefresh();
  currentRefreshFn = fn;
  const cfg = appState.config;
  const pollMs = (cfg.poll_interval || 5) * 1000;
  // Explicit ms (e.g. log page) always uses interval regardless of mode
  if (!ms && cfg.update_mode === 'websocket' && !wsUnsupported) {
    resetWsWatchdog();
  } else {
    refreshTimer = setInterval(() => { fn(); markLastUpdated(); watchNodes(); }, ms || pollMs);
  }
}
function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  currentRefreshFn = null;
}

// ─── WebSocket subscriptions ──────────────────────────────────────────────────
async function initWebSocket() {
  wsUnsupported = false;
  const resources = ['/nodes', '/devices', '/senders', '/receivers', '/flows', '/sources'];
  for (const rp of resources) {
    try {
      const res = await window.api.fetch(`${appState.queryBase}${QUERY_PATH}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_update_rate_ms: 100, resource_path: rp, params: {}, persist: false }),
        readBody: true,
      });
      if (!res.ok) continue;
      const sub = JSON.parse(res.text);
      if (!sub.ws_href) continue;
      const ws = new WebSocket(sub.ws_href);
      ws.onmessage = onWsMessage;
      ws.onerror   = () => {};
      ws.onclose   = () => {};
      wsConnections.push(ws);
    } catch {}
  }
  if (wsConnections.length === 0) {
    wsUnsupported = true;
    // Fall back: restart current page refresh as interval
    if (currentRefreshFn) {
      const pollMs = (appState.config.poll_interval || 5) * 1000;
      refreshTimer = setInterval(currentRefreshFn, pollMs);
    }
  }
  resetWsWatchdog();
}

function stopWebSocket() {
  for (const ws of wsConnections) { try { ws.close(); } catch {} }
  wsConnections = [];
  if (wsWatchdog) { clearTimeout(wsWatchdog); wsWatchdog = null; }
  wsUnsupported = false;
}

function onWsMessage() {
  resetWsWatchdog();
  if (currentRefreshFn) currentRefreshFn();
  markLastUpdated();
  watchNodes();
  showToast('Updated', 'info', 1500);
}

function markLastUpdated() {
  const el = document.getElementById('sb-last-updated');
  if (!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  el.textContent = `Updated: ${hh}:${mm}:${ss}`;
}

function resetWsWatchdog() {
  if (wsWatchdog) clearTimeout(wsWatchdog);
  wsWatchdog = setTimeout(() => {
    if (currentRefreshFn) currentRefreshFn();
  }, WS_WATCHDOG_MS);
}

// ─── API utilities ────────────────────────────────────────────────────────────
async function apiFetch(url) {
  try {
    const res = await window.api.fetch(url, { readBody: true });
    if (!res.ok) return null;
    return JSON.parse(res.text);
  } catch { return null; }
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function mediaLabel(format) {
  if (!format) return null;
  if (format.includes('video/smpte291')) return 'ANC';
  if (format.includes('video')) return 'Video';
  if (format.includes('audio')) return 'Audio';
  if (format.includes('data'))  return 'ANC';
  return format.split(':').pop() || null;
}

function mediaBadge(format) {
  const label = mediaLabel(format);
  if (!label) return '';
  const cls = label === 'Video' ? 'badge-video' : label === 'Audio' ? 'badge-audio' : 'badge-anc';
  return `<span class="pill ${cls}" style="font-size:10px;padding:2px 8px;">${label}</span>`;
}

function loadingHtml() {
  return `<div style="display:flex;align-items:center;justify-content:center;flex:1;padding:32px;color:#bbb;gap:8px;"><div class="spinner"></div>Loading…</div>`;
}
function emptyHtml(msg) {
  return `<div class="state-box">${esc(msg)}</div>`;
}
function errorHtml(msg) {
  return `<div class="state-box state-error">${esc(msg)}</div>`;
}

function versionToStr(ver) {
  if (!ver) return '—';
  const [secs] = ver.split(':');
  const d = new Date((parseInt(secs) - 37) * 1000);
  if (isNaN(d)) return ver;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function versionBadge(r) {
  return r.version
    ? `<span style="font-size:10px;color:var(--text-tertiary);font-family:monospace;">Updated: ${versionToStr(r.version)}</span>`
    : '';
}

function nodeLabel(n) {
  return n.label?.trim() || n.hostname || n.id?.substring(0, 8) || '—';
}

function nodeApiBadges(n) {
  const serviceMap = {
    'urn:x-nmos:service:connection':     'IS-05',
    'urn:x-nmos:service:events':         'IS-07',
    'urn:x-nmos:service:channelmapping': 'IS-08',
  };
  return (n.services || [])
    .filter(s => serviceMap[s.type])
    .map(s => `<span class="pill pill-blue" style="font-size:9px">${serviceMap[s.type]}</span>`)
    .join('');
}

function resourceLabel(r) {
  return r.label?.trim() || r.id?.substring(0, 8) || '—';
}
function nodeIp(n) {
  return n.interfaces?.[0]?.ip || n.api?.endpoints?.[0]?.host || n.hostname || '—';
}

function toolbar(title, rightHtml = '') {
  return `<div class="page-toolbar"><span class="page-title">${esc(title)}</span>${rightHtml}</div>`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background =
    type === 'join'  ? 'var(--green-600,#3B6D11)' :
    type === 'leave' ? 'var(--red-600,#A32D2D)'   : '#333';
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), ms);
}

// ─── JSON Modal ───────────────────────────────────────────────────────────────
let _jsonModalData = null;
function showJsonModal(title, data) {
  _jsonModalData = data;
  document.getElementById('json-modal-title').textContent = title;
  document.getElementById('json-modal-body').textContent = JSON.stringify(data, null, 2);
  document.getElementById('json-modal').style.display = 'flex';
}
function closeJsonModal(e) {
  if (e && e.target !== document.getElementById('json-modal')) return;
  document.getElementById('json-modal').style.display = 'none';
}
function copyModalJson() {
  if (!_jsonModalData) return;
  navigator.clipboard.writeText(JSON.stringify(_jsonModalData, null, 2)).then(() => showToast('Copied!'));
}

// ─── Keyboard: close modal on Escape ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('json-modal').style.display = 'none';
});

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function renderOverview(el, isRefresh = false) {
  if (!isRefresh) {
    el.innerHTML = toolbar('Overview') +
      `<div class="page-content" id="overview-body">${loadingHtml()}</div>`;
  }

  const [nodes, senders, receivers, flows] = await Promise.all([
    apiFetch(`${appState.queryBase}${QUERY_PATH}/nodes`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/senders`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/receivers`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/flows`),
  ]);

  const body = document.getElementById('overview-body');
  if (!body) return;

  const devMap = {};
  let devices = [];
  if (nodes) {
    devices = await apiFetch(`${appState.queryBase}${QUERY_PATH}/devices`) || [];
    devices.forEach(d => { devMap[d.node_id] = (devMap[d.node_id] || 0) + 1; });
  }

  const recentLog = await apiFetch(`${appState.regBase}/log/events`);
  const recentLines = (recentLog || []).slice(-8).reverse();

  // Stats
  const connectedRcv = (receivers||[]).filter(r => r.subscription?.active && r.subscription?.sender_id).length;
  const totalRcv = (receivers||[]).length;
  const connPct = totalRcv ? Math.round(connectedRcv / totalRcv * 100) : 0;
  const connColor = connPct >= 80 ? 'var(--green-600)' : connPct >= 40 ? 'var(--amber-600)' : 'var(--red-600)';

  const fVideo = (flows||[]).filter(f => (f.format||'').includes('video') && !(f.media_type||'').includes('smpte291')).length;
  const fAudio = (flows||[]).filter(f => (f.format||'').includes('audio')).length;
  const fAnc   = (flows||[]).filter(f => (f.media_type||'').includes('smpte291') || (f.format||'').includes('data')).length;
  const fTotal = fVideo + fAudio + fAnc || 1;

  body.innerHTML = `
    <div class="metric-grid">
      ${[['nodes','Nodes'],['senders','Senders'],['receivers','Receivers'],['flows','Flows']].map(([k,l]) => `
        <div class="metric-card" style="position:relative;overflow:hidden;">
          <div class="metric-label">${l}</div>
          <div class="metric-value" id="mv-${k}">${(k==='nodes'?nodes:k==='senders'?senders:k==='receivers'?receivers:flows)?.length ?? '—'}</div>
          <div id="spark-${k}" style="position:absolute;bottom:0;right:0;left:0;height:30px;pointer-events:none;"></div>
        </div>
      `).join('')}
    </div>

    <div class="ov-row">
      <div class="ov-card">
        <div class="ov-card-title">RECEIVER CONNECTION RATE</div>
        <div class="gauge-pct" id="gauge-pct">${connPct}%</div>
        <div class="gauge-sub">${connectedRcv} / ${totalRcv} connected</div>
        <div class="gauge-bar-bg">
          <div class="gauge-bar-fill" id="gauge-fill" style="width:${connPct}%;background:${connColor};"></div>
        </div>
      </div>
      <div class="ov-card">
        <div class="ov-card-title">FLOW FORMAT DISTRIBUTION</div>
        <div class="fmt-bar">
          <div class="fmt-bar-seg" style="flex:${fVideo};background:#185FA5;" title="Video"></div>
          <div class="fmt-bar-seg" style="flex:${fAudio};background:#3B6D11;" title="Audio"></div>
          <div class="fmt-bar-seg" style="flex:${fAnc};background:#854F0B;" title="ANC"></div>
        </div>
        <div class="fmt-legend">
          <div class="fmt-legend-item"><div class="fmt-dot" style="background:#185FA5;"></div>Video ${fVideo}</div>
          <div class="fmt-legend-item"><div class="fmt-dot" style="background:#3B6D11;"></div>Audio ${fAudio}</div>
          <div class="fmt-legend-item"><div class="fmt-dot" style="background:#854F0B;"></div>ANC ${fAnc}</div>
        </div>
      </div>
    </div>

    <div class="ov-card" style="margin-bottom:10px;padding:10px 14px 6px;">
      <div class="ov-card-title">LIVE TIMELINE</div>
      <div style="position:relative;">
        <div class="tl-rail-row">
          <span title="NOW" style="display:flex;align-items:center;cursor:default;flex-shrink:0;margin-top:25px;">
            <span class="tl-live-dot" style="width:9px;height:9px;"></span>
          </span>
          <div style="flex:1;position:relative;">
            <div class="timeline-wrap" id="ov-timeline-wrap" style="position:relative;">
              <div class="tl-shimmer-wrap"><div class="tl-shimmer-glow"></div></div>
              <div class="timeline-rail" id="ov-timeline"></div>
            </div>
          </div>
          <span title="-${appState.config?.timeline_window || 10} min" style="display:flex;align-items:center;cursor:default;opacity:0.5;flex-shrink:0;color:var(--text-tertiary);margin-top:22px;">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2"/>
              <path d="M6 3v3l2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </span>
        </div>
      </div>
    </div>

    <div class="section-title">Registered nodes</div>
    ${nodes && nodes.length ? `
    <table class="data-table">
      <thead><tr><th></th><th>Node name</th><th>IP address</th><th>Devices</th></tr></thead>
      <tbody>${nodes.map(n => `<tr>
        <td style="width:16px;"><span class="led-dot"></span></td>
        <td>${esc(nodeLabel(n))}</td>
        <td><span style="font-family:monospace;font-size:12px;color:var(--text-mono)">${esc(nodeIp(n))}</span></td>
        <td>${devMap[n.id] || 0}</td>
      </tr>`).join('')}</tbody>
    </table>` : emptyHtml('No nodes registered')}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;">
      <div class="activity-box">
        <div class="activity-header"><span class="live-dot"></span>Node events</div>
        <div id="node-activity-feed" style="padding:4px 12px 8px;">
          <div style="color:var(--text-tertiary);font-size:11px;padding:6px 0;">No events yet</div>
        </div>
      </div>
      <div class="activity-box">
        <div class="activity-header"><span class="live-dot"></span>Recent activity</div>
        <div class="activity-body">
          ${recentLines.length ? recentLines.map(e => {
            const ts = (e.timestamp||'').substring(11,19);
            const lv = levelName(e.level);
            const cls = lv==='error'||lv==='fatal' ? 'act-error' : lv==='warning' ? 'act-warn' : 'act-info';
            return `<div class="activity-line ${cls}">[${esc(ts)}] ${esc(lv.toUpperCase().padEnd(4))} ${esc(e.message||'')}</div>`;
          }).join('') : '<div class="activity-line act-info" style="color:#bbb">No recent activity</div>'}
        </div>
      </div>
    </div>
  `;

  renderActivityFeed();
  renderTimeline(false);
  animateMetrics({ nodes: nodes?.length, senders: senders?.length, receivers: receivers?.length, flows: flows?.length });
  startRefresh(() => renderOverview(el, true));
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function renderLog(el) {
  const isLocal = appState.config.mode === 'local';

  const filterBtns = [
    ['all','All'], ['info','Info'], ['warning','Warning'], ['error','Error']
  ].map(([val, lbl]) => {
    const activeClass = logFilter === val ? ` active-${val}` : '';
    return `<button class="filter-btn${activeClass}" data-filter="${val}">${lbl}</button>`;
  }).join('');

  el.innerHTML = toolbar('Log') + `
    <div class="page-toolbar-sub">
      <div style="display:flex;gap:4px;" id="log-filter-btns">${filterBtns}</div>
    </div>
    ${isLocal ? `
    <div class="log-level-bar">
      <span>Log level</span>
      <input type="range" id="log-slider" min="-40" max="40" step="10" value="${appState.config.logging_level ?? 0}" style="width:120px;">
      <span id="log-level-val">${logLevelLabel(appState.config.logging_level ?? 0)}</span>
      <button class="btn-sm" id="btn-log-apply">Apply</button>
      <span id="log-apply-feedback" style="font-size:11px;"></span>
    </div>` : ''}
    <div class="log-table-wrap" id="log-table-wrap">${loadingHtml()}</div>
    <div class="log-footer">
      <span class="log-live"><span class="live-dot"></span>Live</span>
      <span id="lf-count">0 entries</span>
      <span id="lf-errors"></span>
      <span id="lf-warns"></span>
      <span class="sb-spacer"></span>
      <button class="btn-sm" id="btn-log-clear">Clear</button>
    </div>
  `;

  el.querySelectorAll('#log-filter-btns .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      logFilter = btn.dataset.filter;
      el.querySelectorAll('#log-filter-btns .filter-btn').forEach(b => {
        b.className = `filter-btn${b.dataset.filter === logFilter ? ' active-' + logFilter : ''}`;
      });
      renderLogTable();
    });
  });

  if (isLocal) {
    const slider = el.querySelector('#log-slider');
    const valEl  = el.querySelector('#log-level-val');
    slider?.addEventListener('input', () => valEl.textContent = logLevelLabel(parseInt(slider.value)));
    el.querySelector('#btn-log-apply')?.addEventListener('click', async () => {
      const fb = el.querySelector('#log-apply-feedback');
      try {
        const val = parseInt(slider.value);
        await window.api.fetch(`${appState.regBase}/settings/all`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ logging_level: val }),
        });
        fb.textContent = '✓ Applied'; fb.style.color = 'var(--green-600)';
        setTimeout(() => fb.textContent = '', 2000);
      } catch { fb.textContent = 'Failed'; fb.style.color = 'var(--red-600)'; }
    });
  }

  el.querySelector('#btn-log-clear')?.addEventListener('click', () => {
    logEntries = []; logErrorCount = 0; logWarnCount = 0;
    renderLogTable();
  });

  await fetchLogEntries();
  // ローカルはIPCプッシュで更新されるのでポーリング不要
  if (appState.config.mode !== 'local') {
    startRefresh(fetchLogEntries, LOG_REFRESH_MS);
  }
}

function logLevelLabel(v) {
  if (v <= -30) return `${v} – verbose`;
  if (v >= 30)  return `${v} – fatal only`;
  return `${v} – normal`;
}

async function fetchLogEntries() {
  if (appState.config.mode === 'local') {
    await initLocalLog();
    return;
  }
  // Remote: REST API (SSE未対応のため unavailable 表示)
  const w = document.getElementById('log-table-wrap');
  if (w && !w.querySelector('.state-info-box')) {
    w.innerHTML = `<div class="state-info-box" style="padding:40px">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style="color:#bbb;margin-bottom:8px">
        <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.5"/>
        <path d="M16 10v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="16" cy="21" r="1" fill="currentColor"/>
      </svg>
      <div class="state-info-title">Log not available for remote RDS</div>
      <div class="state-info-body">Log streaming is only available for locally running RDS.</div>
    </div>`;
  }
}

// nmos-cpp ログ行をパース
// フォーマット: "2026-04-16 07:24:37.992: info: 24cc: message"
function parseLocalLogLine(entry) {
  const text = entry.text;

  // タイムスタンプ: level: thread_id_hex: message
  const match = text.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+):\s+([^:]+):\s+[0-9a-f]+:\s+(.+)$/i);

  let timestamp, levelStr, message;
  if (match) {
    timestamp = match[1];
    levelStr  = match[2].trim();
    message   = match[3].trim();
  } else {
    timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    levelStr  = 'info';
    message   = text;
  }

  // nmos-cpp レベル → 数値マッピング
  const levelMap = {
    'fatal':         -40,
    'error':         -30,
    'warning':       -10,
    'info':            0,
    'more info':       5,
    'too much info':  10,
  };
  const level = levelMap[levelStr] ?? 0;

  return { timestamp, level, message };
}

async function initLocalLog() {
  // 既存バッファを取得して表示
  const buffer = await window.api.getLogBuffer();
  logEntries = buffer.map(parseLocalLogLine);
  logErrorCount = logEntries.filter(e => e.level <= -30).length;
  logWarnCount  = logEntries.filter(e => e.level < 0 && e.level > -30).length;
  renderLogTable();

  // 以降はライブストリームで追記
  if (localLogUnsubscribe) localLogUnsubscribe();
  localLogUnsubscribe = window.api.onLogLine((entry) => {
    const parsed = parseLocalLogLine(entry);
    logEntries.push(parsed);
    if (parsed.level <= -30) logErrorCount++;
    else if (parsed.level < 0) logWarnCount++;
    renderLogTable();
  });
}

function levelName(level) {
  if (typeof level !== 'number') return String(level || 'info');
  if (level <= -40) return 'fatal';
  if (level <= -30) return 'error';
  if (level <    0) return 'warning';
  if (level >=  10) return 'verbose';   // too much info
  if (level >=   5) return 'verbose';   // more info
  return 'info';
}

function renderLogTable() {
  const wrap = document.getElementById('log-table-wrap');
  if (!wrap) return;

  const errEl  = document.getElementById('lf-errors');
  const warnEl = document.getElementById('lf-warns');
  const cntEl  = document.getElementById('lf-count');
  if (errEl)  { errEl.textContent  = logErrorCount > 0 ? `${logErrorCount} errors` : ''; errEl.className = 'log-errors'; }
  if (warnEl) { warnEl.textContent = logWarnCount  > 0 ? `${logWarnCount} warnings` : ''; warnEl.className = 'log-warnings'; }

  let list = logEntries.filter(e => {
    if (logFilter === 'all') return true;
    return levelName(e.level) === logFilter;
  });
  if (cntEl) cntEl.textContent = `${list.length} entries`;

  if (!list.length) { wrap.innerHTML = emptyHtml('No log entries'); return; }

  const rows = [...list].reverse().slice(0, 400).map(e => {
    const lv = levelName(e.level);
    const lvCls = lv === 'error' || lv === 'fatal' ? 'pill-red'
                : lv === 'warning' ? 'pill-amber' : 'pill-blue';
    const msgCls = lv === 'error' || lv === 'fatal' ? 'color:var(--red-600)'
                 : lv === 'warning' ? 'color:var(--amber-600)' : 'color:var(--text-mono)';
    const ts = (e.timestamp || '').replace('T',' ').substring(0, 23);
    return `<tr>
      <td style="width:130px;font-family:monospace;font-size:11px;color:var(--text-tertiary);white-space:nowrap">${esc(ts)}</td>
      <td style="width:70px"><span class="pill ${lvCls}" style="font-size:10px">${esc(lv)}</span></td>
      <td style="font-family:monospace;font-size:11px;word-break:break-all;${msgCls}">${esc(e.message || '')}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="data-table"><thead><tr><th>Timestamp</th><th>Level</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NODES PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function renderNodes(el, isRefresh = false) {
  const openNodeIds = new Set([...document.querySelectorAll('.acc-body.open[data-node-body]')].map(b => b.dataset.nodeBody));
  const openDevIds  = new Set([...document.querySelectorAll('.dev-body.open[data-dev-body]')].map(b => b.dataset.devBody));

  if (!isRefresh) {
    el.innerHTML = toolbar('Nodes',
      `<span class="count-badge" id="nodes-count">—</span>
       <input class="page-search-input" id="node-search" placeholder="Search by name or IP..." value="${esc(nodeSearch)}">`) +
      `<div class="page-content"><div id="nodes-body">${loadingHtml()}</div></div>`;

    el.querySelector('#node-search')?.addEventListener('input', e => {
      nodeSearch = e.target.value.toLowerCase();
      rebuildNodeList();
    });
  }

  const [nodes, devices, senders, receivers] = await Promise.all([
    apiFetch(`${appState.queryBase}${QUERY_PATH}/nodes`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/devices`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/senders`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/receivers`),
  ]);

  const body = document.getElementById('nodes-body');
  if (!body) return;

  if (nodes) {
    const cnt = document.getElementById('nodes-count');
    if (cnt) cnt.textContent = `${nodes.length} nodes`;
  }

  // Store data globally for search re-render
  window._nodesData = { nodes: nodes || [], devices: devices || [], senders: senders || [], receivers: receivers || [] };
  window._openNodeIds = openNodeIds;
  window._openDevIds  = openDevIds;

  if (!nodes) { body.innerHTML = errorHtml('Failed to fetch nodes'); startRefresh(() => renderNodes(el, true)); return; }
  rebuildNodeList();
  startRefresh(() => renderNodes(el, true));
}

function rebuildNodeList() {
  const body = document.getElementById('nodes-body');
  if (!body) return;
  const { nodes, devices, senders, receivers } = window._nodesData || { nodes: [], devices: [], senders: [], receivers: [] };
  const openNodeIds = window._openNodeIds || new Set();
  const openDevIds  = window._openDevIds  || new Set();

  const filtered = nodeSearch
    ? nodes.filter(n => nodeLabel(n).toLowerCase().includes(nodeSearch) || nodeIp(n).toLowerCase().includes(nodeSearch))
    : nodes;

  if (!filtered.length) { body.innerHTML = emptyHtml(nodes.length ? 'No nodes match search' : 'No nodes registered'); return; }

  const devByNode = groupBy(devices, 'node_id');
  const sndByDev  = groupBy(senders, 'device_id');
  const rcvByDev  = groupBy(receivers, 'device_id');

  body.innerHTML = filtered.map(n => {
    const devs = devByNode[n.id] || [];
    const isOpen = openNodeIds.has(n.id);
    return `<div class="acc-card" data-node-id="${esc(n.id)}">
      <div class="acc-header" onclick="toggleNode('${esc(n.id)}')">
        <span class="acc-label">${esc(nodeLabel(n))}</span>
        <span class="acc-meta" style="font-family:monospace">${esc(nodeIp(n))}</span>
        <span class="count-badge" style="margin-left:4px">${devs.length} device${devs.length!==1?'s':''}</span>
        ${nodeApiBadges(n)}
        <span class="acc-chevron" id="chev-node-${esc(n.id)}" style="${isOpen?'transform:rotate(90deg)':''}">▶</span>
      </div>
      <div class="acc-body${isOpen?' open':''}" data-node-body="${esc(n.id)}" id="nbody-${esc(n.id)}">
        <div class="detail-grid">
          <span class="dg-key">ID</span><span class="dg-val">${esc(n.id)}</span>
          <span class="dg-key">API</span><span class="dg-val">${(n.api?.versions||[]).join(', ') || '—'}</span>
          <span class="dg-key">Hostname</span><span class="dg-val">${esc(n.hostname || '—')}</span>
          <span class="dg-key">Description</span><span class="dg-val">${esc(n.description || '—')}</span>
        </div>
        <div style="font-size:10px;color:var(--text-tertiary);letter-spacing:0.04em;margin:10px 0 6px">DEVICES</div>
        ${devs.map(dev => buildDeviceCard(dev, sndByDev[dev.id]||[], rcvByDev[dev.id]||[], openDevIds, n)).join('')}
        <div class="btn-row" style="margin-top:8px">
          <button class="btn-sm" onclick="showJsonModal('Node: ${esc(nodeLabel(n))}', window._nodesData.nodes.find(x=>x.id==='${esc(n.id)}'))">View raw JSON</button>
          <button class="btn-sm" onclick="window.api.openExternal('${appState.queryBase}/x-nmos/query/v1.3/nodes/${esc(n.id)}')">Open in browser</button>
          <span style="margin-left:auto">${versionBadge(n)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function buildDeviceCard(dev, snds, rcvs, openDevIds, parentNode) {
  const isOpen = openDevIds.has(dev.id);
  const senderChips = snds.map(s =>
    `<span class="resource-chip chip-sender" title="${esc(s.id)}" onclick="navToSender('${esc(s.id)}','${esc(nodeLabel(parentNode))}','${esc(resourceLabel(dev))}')">${esc(resourceLabel(s))}</span>`
  ).join('');
  const receiverChips = rcvs.map(r =>
    `<span class="resource-chip chip-receiver" title="${esc(r.id)}" onclick="navToReceiver('${esc(r.id)}','${esc(nodeLabel(parentNode))}','${esc(resourceLabel(dev))}')">${esc(resourceLabel(r))}</span>`
  ).join('');

  return `<div class="dev-card" data-dev-id="${esc(dev.id)}">
    <div class="dev-header" onclick="toggleDev('${esc(dev.id)}')">
      <div class="dev-icon">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="1" y="2" width="8" height="6" rx="1" stroke="#185FA5" stroke-width="1"/>
          <path d="M5 1v1M4 8.5h2" stroke="#185FA5" stroke-width="1" stroke-linecap="round"/>
        </svg>
      </div>
      <span class="dev-label">${esc(resourceLabel(dev))}</span>
      <span class="dev-id">${esc(dev.id.substring(0,16))}…</span>
      <span class="acc-chevron" id="chev-dev-${esc(dev.id)}" style="${isOpen?'transform:rotate(90deg)':''}">▶</span>
    </div>
    <div class="dev-body${isOpen?' open':''}" data-dev-body="${esc(dev.id)}" id="dbody-${esc(dev.id)}">
      ${snds.length ? `<div class="resource-row">
        <span class="resource-row-label">SENDERS</span>
        <div class="chips-wrap">${senderChips}</div>
      </div>` : ''}
      ${rcvs.length ? `<div class="resource-row">
        <span class="resource-row-label">RECEIVERS</span>
        <div class="chips-wrap">${receiverChips}</div>
      </div>` : ''}
      ${!snds.length && !rcvs.length ? '<div style="font-size:11px;color:#bbb">No senders or receivers</div>' : ''}
      <div class="chip-hint" style="margin-top:4px">Click a chip to view details →</div>
    </div>
  </div>`;
}

function toggleNode(id) {
  const body = document.getElementById(`nbody-${id}`);
  const chev = document.getElementById(`chev-node-${id}`);
  if (!body) return;
  const open = body.classList.toggle('open');
  body.setAttribute('data-node-body', id);
  if (chev) chev.style.transform = open ? 'rotate(90deg)' : '';
  if (open) {
    if (!window._openNodeIds) window._openNodeIds = new Set();
    window._openNodeIds.add(id);
  } else {
    window._openNodeIds?.delete(id);
  }
}

function toggleDev(id) {
  const body = document.getElementById(`dbody-${id}`);
  const chev = document.getElementById(`chev-dev-${id}`);
  if (!body) return;
  const open = body.classList.toggle('open');
  if (chev) chev.style.transform = open ? 'rotate(90deg)' : '';
  if (open) {
    if (!window._openDevIds) window._openDevIds = new Set();
    window._openDevIds.add(id);
  } else {
    window._openDevIds?.delete(id);
  }
}

function navToSender(resourceId, fromNode, fromDevice) {
  appState.navigateTo = { page: 'senders', resourceId, fromNode, fromDevice };
  navigateTo('senders');
}
function navToReceiver(resourceId, fromNode, fromDevice) {
  appState.navigateTo = { page: 'receivers', resourceId, fromNode, fromDevice };
  navigateTo('receivers');
}

function groupBy(arr, key) {
  return (arr || []).reduce((m, item) => {
    const k = item[key]; if (!m[k]) m[k] = []; m[k].push(item); return m;
  }, {});
}

// ─────────────────────────────────────────────────────────────────────────────
// SENDERS PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function renderSenders(el, isRefresh = false) {
  const openIds = new Set([...document.querySelectorAll('.acc-body.open[data-sender-body]')].map(b => b.dataset.senderBody));

  if (!isRefresh) {
    const filterBtns = [['all','All'],['video','Video'],['audio','Audio'],['anc','ANC']].map(([v,l]) => {
      const ac = sendersFilter === v ? ` active-${v}` : '';
      return `<button class="filter-btn${ac}" data-filter="${v}">${l}</button>`;
    }).join('');
    el.innerHTML = toolbar('Senders',
      `<span class="count-badge" id="senders-count">—</span>
       <div style="display:flex;gap:4px;" id="senders-filter">${filterBtns}</div>
       <input class="page-search-input" id="sender-search" placeholder="Search..." value="${esc(senderSearch)}">`) +
      `<div class="page-content"><div id="senders-body">${loadingHtml()}</div></div>`;

    el.querySelectorAll('#senders-filter .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sendersFilter = btn.dataset.filter;
        el.querySelectorAll('#senders-filter .filter-btn').forEach(b => b.className = `filter-btn${b.dataset.filter===sendersFilter?' active-'+sendersFilter:''}`);
        rebuildSenderList();
      });
    });
    el.querySelector('#sender-search')?.addEventListener('input', e => {
      senderSearch = e.target.value.toLowerCase();
      rebuildSenderList();
    });
  }

  const [senders, flows, devices, nodes] = await Promise.all([
    apiFetch(`${appState.queryBase}${QUERY_PATH}/senders`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/flows`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/devices`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/nodes`),
  ]);

  const body = document.getElementById('senders-body');
  if (!body) return;

  if (senders) {
    const cnt = document.getElementById('senders-count');
    if (cnt) cnt.textContent = `${senders.length} senders`;
  }

  const flowMap = {}; (flows||[]).forEach(f => flowMap[f.id] = f);
  const devMap  = {}; (devices||[]).forEach(d => devMap[d.id] = d);
  const nodeMap = {}; (nodes||[]).forEach(n => nodeMap[n.id] = n);

  window._sendersData = { senders: senders||[], flowMap, devMap, nodeMap };
  window._senderOpenIds = openIds;

  if (!senders) { body.innerHTML = errorHtml('Failed to fetch senders'); startRefresh(() => renderSenders(el, true)); return; }
  rebuildSenderList();

  // Handle cross-page navigation
  if (appState.navigateTo?.page === 'senders') {
    const target = appState.navigateTo;
    appState.navigateTo = null;
    setTimeout(() => highlightSender(target.resourceId, target.fromNode, target.fromDevice), 100);
  }

  startRefresh(() => renderSenders(el, true));
}

function rebuildSenderList() {
  const body = document.getElementById('senders-body');
  if (!body) return;
  const { senders, flowMap, devMap, nodeMap } = window._sendersData || { senders:[], flowMap:{}, devMap:{}, nodeMap:{} };
  const openIds = window._senderOpenIds || new Set();

  const getFormat = s => flowMap[s.flow_id]?.format || s.format || '';
  const getNodeName = s => {
    const dev = devMap[s.device_id];
    const node = dev ? nodeMap[dev.node_id] : null;
    return node ? nodeLabel(node) : '—';
  };

  let filtered = senders.filter(s => {
    const fmt = getFormat(s);
    if (sendersFilter === 'video') return fmt.includes('video') && !fmt.includes('smpte291m');
    if (sendersFilter === 'audio') return fmt.includes('audio');
    if (sendersFilter === 'anc')   return fmt.includes('smpte291m') || fmt.includes('data');
    return true;
  });
  if (senderSearch) filtered = filtered.filter(s => resourceLabel(s).toLowerCase().includes(senderSearch));

  if (!filtered.length) { body.innerHTML = emptyHtml(senders.length ? 'No senders match filter' : 'No senders registered'); return; }

  body.innerHTML = filtered.map(s => {
    const fmt    = getFormat(s);
    const isOpen = openIds.has(s.id);
    const active = s.subscription?.active;
    return `<div class="acc-card" data-sender-id="${esc(s.id)}">
      <div class="acc-header${isOpen?' highlighted':''}" onclick="toggleSender('${esc(s.id)}')">
        ${mediaBadge(fmt)}
        <span class="acc-label">${esc(resourceLabel(s))}</span>
        <span class="acc-meta">${esc(getNodeName(s))}</span>
        <span class="pill ${active ? 'pill-green' : 'pill-gray'}">${active ? 'active' : 'inactive'}</span>
        <span class="acc-chevron" id="chev-sender-${esc(s.id)}" style="${isOpen?'transform:rotate(90deg)':''}">▶</span>
      </div>
      <div class="acc-body${isOpen?' open':''}" data-sender-body="${esc(s.id)}" id="sbody-${esc(s.id)}">
        <div class="nav-hint" id="nav-hint-${esc(s.id)}"></div>
        <div class="detail-grid">
          <span class="dg-key">SENDER ID</span><span class="dg-val">${esc(s.id)}</span>
          <span class="dg-key">FLOW ID</span><span class="dg-val">${esc(s.flow_id || '—')}</span>
          <span class="dg-key">TRANSPORT</span><span class="dg-val">${esc(s.transport || '—')}</span>
          <span class="dg-key">INTERFACE</span><span class="dg-val">${esc(s.interface_bindings?.[0] || '—')}</span>
        </div>
        <div class="sdp-label">SDP</div>
        <div id="sdp-${esc(s.id)}">${s.manifest_href
          ? `<div class="sdp-loading"><div class="spinner spinner-sm"></div>Loading SDP…</div>`
          : emptyHtml('No manifest_href')}</div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn-sm" onclick="showJsonModal('Sender: ${esc(resourceLabel(s))}', window._sendersData.senders.find(x=>x.id==='${esc(s.id)}'))">View raw JSON</button>
          <button class="btn-sm" onclick="window.api.openExternal('${appState.queryBase}/x-nmos/query/v1.3/senders/${esc(s.id)}')">Open in browser</button>
          <span style="margin-left:auto">${versionBadge(s)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  // Load SDPs for already-open cards
  openIds.forEach(id => {
    const s = senders.find(x => x.id === id);
    if (s?.manifest_href) loadSdp(s);
  });
}

function toggleSender(id) {
  const body = document.getElementById(`sbody-${id}`);
  const chev = document.getElementById(`chev-sender-${id}`);
  const head = body?.previousElementSibling;
  if (!body) return;
  const open = body.classList.toggle('open');
  if (chev) chev.style.transform = open ? 'rotate(90deg)' : '';
  if (head) head.classList.toggle('highlighted', open);
  if (open) {
    if (!window._senderOpenIds) window._senderOpenIds = new Set();
    window._senderOpenIds.add(id);
    // Load SDP
    const s = (window._sendersData?.senders || []).find(x => x.id === id);
    if (s?.manifest_href) loadSdp(s);
  } else {
    window._senderOpenIds?.delete(id);
  }
}

async function loadSdp(sender) {
  const el = document.getElementById(`sdp-${sender.id}`);
  if (!el) return;

  if (sdpCache.has(sender.id)) {
    renderSdp(sender, sdpCache.get(sender.id));
    return;
  }

  el.innerHTML = `<div class="sdp-loading"><div class="spinner spinner-sm"></div>Loading SDP…</div>`;
  try {
    const res = await window.api.fetch(sender.manifest_href, { readBody: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sdpCache.set(sender.id, res.text);
    renderSdp(sender, res.text);
  } catch {
    sdpCache.set(sender.id, 'error');
    renderSdp(sender, 'error');
  }
}

function renderSdp(sender, sdpText) {
  const el = document.getElementById(`sdp-${sender.id}`);
  if (!el) return;
  if (sdpText === 'error') {
    el.innerHTML = `<div class="sdp-error">
      <div class="sdp-error-text">Could not retrieve SDP. The node may be unreachable from this host.</div>
      <div class="sdp-url-label">manifest_href:</div>
      <span class="sdp-url-value">${esc(sender.manifest_href)}</span>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn-sm amber" onclick="copySdpUrl('${esc(sender.manifest_href)}')">Copy URL</button>
        <button class="btn-sm" onclick="retrySdp('${esc(sender.id)}')">Retry</button>
      </div>
    </div>`;
  } else {
    el.innerHTML = `<div class="sdp-box">${esc(sdpText)}</div>
      <div class="btn-row">
        <button class="btn-sm" id="btn-copy-sdp-${esc(sender.id)}" onclick="copySdp('${esc(sender.id)}')">Copy SDP</button>
      </div>`;
    // Store SDP text in element for clipboard
    el.querySelector('.sdp-box')?.setAttribute('data-sdp', sdpText);
  }
}

function copySdp(senderId) {
  const el = document.getElementById(`sdp-${senderId}`);
  const text = el?.querySelector('.sdp-box')?.getAttribute('data-sdp') || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(`btn-copy-sdp-${senderId}`);
    if (btn) { btn.textContent = 'Copied!'; btn.style.color = 'var(--green-600)'; setTimeout(() => { btn.textContent = 'Copy SDP'; btn.style.color = ''; }, 1500); }
  });
}
function copySdpUrl(href) { navigator.clipboard.writeText(href).then(() => showToast('URL copied')); }
function retrySdp(senderId) {
  sdpCache.delete(senderId);
  const s = (window._sendersData?.senders || []).find(x => x.id === senderId);
  if (s) loadSdp(s);
}

function highlightSender(id, fromNode, fromDevice) {
  // Open the accordion
  const body = document.getElementById(`sbody-${id}`);
  const chev = document.getElementById(`chev-sender-${id}`);
  const card = document.querySelector(`.acc-card[data-sender-id="${id}"]`);
  if (!body) return;
  body.classList.add('open');
  if (chev) chev.style.transform = 'rotate(90deg)';
  body.previousElementSibling?.classList.add('highlighted');
  card?.classList.add('highlighted');
  // Show nav hint
  const hint = document.getElementById(`nav-hint-${id}`);
  if (hint) {
    hint.textContent = `Navigated from ${fromNode}${fromDevice ? ' / Device: ' + fromDevice : ''}`;
    hint.style.display = 'block';
    setTimeout(() => { hint.style.display = 'none'; }, 10000);
  }
  // Load SDP
  const s = (window._sendersData?.senders || []).find(x => x.id === id);
  if (s?.manifest_href) loadSdp(s);
  // Scroll
  setTimeout(() => card?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// RECEIVERS PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function renderReceivers(el, isRefresh = false) {
  const openIds = new Set([...document.querySelectorAll('.acc-body.open[data-recv-body]')].map(b => b.dataset.recvBody));

  if (!isRefresh) {
    const filterBtns = [['all','All'],['video','Video'],['audio','Audio'],['anc','ANC'],['connected','Connected'],['idle','Idle']].map(([v,l]) => {
      const ac = receiversFilter === v ? ` active-${v === 'connected' ? 'connected' : v === 'idle' ? 'idle' : v}` : '';
      return `<button class="filter-btn${ac}" data-filter="${v}">${l}</button>`;
    }).join('');
    el.innerHTML = toolbar('Receivers',
      `<span class="count-badge" id="receivers-count">—</span>
       <div style="display:flex;gap:4px;" id="receivers-filter">${filterBtns}</div>`) +
      `<div class="page-content"><div id="receivers-body">${loadingHtml()}</div></div>`;

    el.querySelectorAll('#receivers-filter .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        receiversFilter = btn.dataset.filter;
        const ac = receiversFilter === 'connected' ? 'active-connected' : receiversFilter === 'idle' ? 'active-idle' : `active-${receiversFilter}`;
        el.querySelectorAll('#receivers-filter .filter-btn').forEach(b => b.className = `filter-btn${b.dataset.filter===receiversFilter?' '+ac:''}`);
        rebuildReceiverList();
      });
    });
  }

  const [receivers, senders, devices, nodes] = await Promise.all([
    apiFetch(`${appState.queryBase}${QUERY_PATH}/receivers`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/senders`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/devices`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/nodes`),
  ]);

  const body = document.getElementById('receivers-body');
  if (!body) return;

  if (receivers) {
    const cnt = document.getElementById('receivers-count');
    if (cnt) cnt.textContent = `${receivers.length} receivers`;
  }

  const senderMap = {}; (senders||[]).forEach(s => senderMap[s.id] = s);
  const devMap    = {}; (devices||[]).forEach(d => devMap[d.id] = d);
  const nodeMap   = {}; (nodes||[]).forEach(n => nodeMap[n.id] = n);

  window._receiversData = { receivers: receivers||[], senderMap, devMap, nodeMap };
  window._recvOpenIds   = openIds;

  if (!receivers) { body.innerHTML = errorHtml('Failed to fetch receivers'); startRefresh(() => renderReceivers(el, true)); return; }
  rebuildReceiverList();

  if (appState.navigateTo?.page === 'receivers') {
    const target = appState.navigateTo;
    appState.navigateTo = null;
    setTimeout(() => highlightReceiver(target.resourceId, target.fromNode, target.fromDevice), 100);
  }

  startRefresh(() => renderReceivers(el, true));
}

function rebuildReceiverList() {
  const body = document.getElementById('receivers-body');
  if (!body) return;
  const { receivers, senderMap, devMap, nodeMap } = window._receiversData || { receivers:[], senderMap:{}, devMap:{}, nodeMap:{} };
  const openIds = window._recvOpenIds || new Set();

  const getNodeName = r => {
    const dev = devMap[r.device_id];
    const node = dev ? nodeMap[dev.node_id] : null;
    return node ? nodeLabel(node) : '—';
  };

  let filtered = receivers.filter(r => {
    if (receiversFilter === 'connected') return !!r.subscription?.sender_id;
    if (receiversFilter === 'idle')      return !r.subscription?.sender_id;
    const fmt = r.format || '';
    if (receiversFilter === 'video') return fmt.includes('video') && !fmt.includes('smpte291m');
    if (receiversFilter === 'audio') return fmt.includes('audio');
    if (receiversFilter === 'anc')   return fmt.includes('smpte291m') || fmt.includes('data');
    return true;
  });

  if (!filtered.length) { body.innerHTML = emptyHtml(receivers.length ? 'No receivers match filter' : 'No receivers registered'); return; }

  body.innerHTML = filtered.map(r => {
    const isOpen  = openIds.has(r.id);
    const connected = !!r.subscription?.sender_id;
    const connSender = senderMap[r.subscription?.sender_id];
    return `<div class="acc-card" data-recv-id="${esc(r.id)}">
      <div class="acc-header" onclick="toggleReceiver('${esc(r.id)}')">
        ${mediaBadge(r.format)}
        <span class="acc-label">${esc(resourceLabel(r))}</span>
        <span class="acc-meta">${esc(getNodeName(r))}</span>
        <span class="pill ${connected ? 'pill-green' : 'pill-gray'}">
          <span class="conn-dot" style="background:${connected?'#28C840':'#B4B2A9'}"></span>
          ${connected ? 'Connected' : 'Idle'}
        </span>
        <span class="acc-chevron" id="chev-recv-${esc(r.id)}" style="${isOpen?'transform:rotate(90deg)':''}">▶</span>
      </div>
      <div class="acc-body${isOpen?' open':''}" data-recv-body="${esc(r.id)}" id="rbody-${esc(r.id)}">
        <div class="nav-hint" id="nav-hint-recv-${esc(r.id)}"></div>
        <div class="detail-grid">
          <span class="dg-key">RECEIVER ID</span><span class="dg-val">${esc(r.id)}</span>
          <span class="dg-key">TRANSPORT</span><span class="dg-val">${esc(r.transport || '—')}</span>
          <span class="dg-key">INTERFACE</span><span class="dg-val">${esc(r.interface_bindings?.[0] || '—')}</span>
        </div>
        <div class="conn-box">
          <div class="conn-box-title">CURRENT CONNECTION</div>
          ${connected && connSender ? `
          <div class="conn-sender-row">
            <div class="conn-sender-icon">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M7 3l3 3-3 3" stroke="#3B6D11" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div style="flex:1">
              <div class="conn-sender-name">${esc(resourceLabel(connSender))}</div>
              <div class="conn-sender-detail">${esc(r.subscription.sender_id.substring(0,16))}…</div>
            </div>
            <span class="pill pill-green" style="font-size:10px">IS-05 active</span>
          </div>` : connected ? `
          <div class="conn-sender-row">
            <div style="flex:1"><div class="conn-sender-name">${esc(r.subscription.sender_id?.substring(0,16) || '—')}…</div><div class="conn-sender-detail">Sender not in registry</div></div>
            <span class="pill pill-amber" style="font-size:10px">sender missing</span>
          </div>` : `
          <div class="not-connected">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#bbb" stroke-width="1.2"/><path d="M5 7h4" stroke="#bbb" stroke-width="1.5" stroke-linecap="round"/></svg>
            Not connected to any sender
          </div>`}
        </div>
        <div class="btn-row" style="margin-top:8px">
          ${connected ? `<button class="btn-sm green" onclick="navToSenderFromReceiver('${esc(r.subscription.sender_id)}')">Go to Sender →</button>` : ''}
          <button class="btn-sm" onclick="showJsonModal('Receiver: ${esc(resourceLabel(r))}', window._receiversData.receivers.find(x=>x.id==='${esc(r.id)}'))">View raw JSON</button>
          <button class="btn-sm" onclick="window.api.openExternal('${appState.queryBase}/x-nmos/query/v1.3/receivers/${esc(r.id)}')">Open in browser</button>
          <span style="margin-left:auto">${versionBadge(r)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleReceiver(id) {
  const body = document.getElementById(`rbody-${id}`);
  const chev = document.getElementById(`chev-recv-${id}`);
  if (!body) return;
  const open = body.classList.toggle('open');
  if (chev) chev.style.transform = open ? 'rotate(90deg)' : '';
  if (open) { if (!window._recvOpenIds) window._recvOpenIds = new Set(); window._recvOpenIds.add(id); }
  else window._recvOpenIds?.delete(id);
}

function navToSenderFromReceiver(senderId) {
  const { senderMap } = window._receiversData || {};
  const sender = senderMap?.[senderId];
  appState.navigateTo = { page: 'senders', resourceId: senderId, fromNode: null, fromDevice: null };
  navigateTo('senders');
}

function highlightReceiver(id, fromNode, fromDevice) {
  const body = document.getElementById(`rbody-${id}`);
  const card = document.querySelector(`.acc-card[data-recv-id="${id}"]`);
  if (!body) return;
  body.classList.add('open');
  document.getElementById(`chev-recv-${id}`)?.style && (document.getElementById(`chev-recv-${id}`).style.transform = 'rotate(90deg)');
  card?.classList.add('highlighted');
  const hint = document.getElementById(`nav-hint-recv-${id}`);
  if (hint) { hint.textContent = `Navigated from ${fromNode || ''}${fromDevice ? ' / Device: ' + fromDevice : ''}`; hint.style.display = 'block'; setTimeout(() => hint.style.display = 'none', 10000); }
  setTimeout(() => card?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOWS / SOURCES PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function renderFlows(el, isRefresh = false) {
  if (!isRefresh) {
    const tabs = [['flows','Flows'],['sources','Sources']].map(([v,l]) =>
      `<button class="tab-btn${flowsTab===v?' active':''}" data-tab="${v}">${l}</button>`).join('');
    const filterBtns = [['all','All'],['video','Video'],['audio','Audio'],['anc','ANC']].map(([v,l]) => {
      const ac = flowsFilter === v ? ` active-${v}` : '';
      return `<button class="filter-btn${ac}" data-filter="${v}">${l}</button>`;
    }).join('');
    el.innerHTML = toolbar('Flows / Sources',
      `<div class="tab-group" id="flows-tabs">${tabs}</div>
       <span class="count-badge" id="flows-count">—</span>`) +
      `<div class="page-toolbar-sub">
         <span class="filter-label">Filter:</span>
         <div style="display:flex;gap:4px;" id="flows-filter-btns">${filterBtns}</div>
       </div>
       <div class="page-content"><div id="flows-body">${loadingHtml()}</div></div>`;

    el.querySelectorAll('#flows-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        flowsTab = btn.dataset.tab;
        el.querySelectorAll('#flows-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === flowsTab));
        rebuildFlowsList();
      });
    });
    el.querySelectorAll('#flows-filter-btns .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        flowsFilter = btn.dataset.filter;
        el.querySelectorAll('#flows-filter-btns .filter-btn').forEach(b => b.className = `filter-btn${b.dataset.filter===flowsFilter?' active-'+flowsFilter:''}`);
        rebuildFlowsList();
      });
    });
  }

  const [flows, sources] = await Promise.all([
    apiFetch(`${appState.queryBase}${QUERY_PATH}/flows`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/sources`),
  ]);

  const body = document.getElementById('flows-body');
  if (!body) return;

  window._flowsData = { flows: flows||[], sources: sources||[] };

  if (!flows && !sources) { body.innerHTML = errorHtml('Failed to fetch data'); startRefresh(() => renderFlows(el, true)); return; }
  rebuildFlowsList();
  startRefresh(() => renderFlows(el, true));
}

function formatSummary(item) {
  const mt = item.media_type || '';
  if (mt.includes('video') && !mt.includes('smpte291m')) {
    const w = item.frame_width || ''; const h = item.frame_height || '';
    const gr = item.grain_rate ? `${item.grain_rate.numerator}/${item.grain_rate.denominator}` : '';
    return `${mt} · ${w}×${h} ${gr}`.trim();
  }
  if (mt.includes('audio')) {
    const sr = item.sample_rate?.numerator ? item.sample_rate.numerator + 'Hz' : '';
    const ch = item.channels?.length ? item.channels.length + 'ch' : '';
    return `${mt} · ${sr} · ${ch}`.replace(/·\s*·/g, '·').trim();
  }
  return mt || '—';
}

function rebuildFlowsList() {
  const body = document.getElementById('flows-body');
  if (!body) return;
  const { flows, sources } = window._flowsData || { flows:[], sources:[] };
  const data = flowsTab === 'flows' ? flows : sources;

  const cnt = document.getElementById('flows-count');
  if (cnt) cnt.textContent = `${data.length} ${flowsTab}`;

  let filtered = data.filter(item => {
    const mt = item.media_type || item.format || '';
    if (flowsFilter === 'video') return mt.includes('video') && !mt.includes('smpte291');
    if (flowsFilter === 'audio') return mt.includes('audio');
    if (flowsFilter === 'anc')   return mt.includes('smpte291');
    return true;
  });

  if (!filtered.length) { body.innerHTML = emptyHtml(`No ${flowsTab} match filter`); return; }

  body.innerHTML = `<table class="data-table">
    <thead><tr><th>Label</th><th>Format</th><th>Summary</th><th>Updated</th><th>ID</th></tr></thead>
    <tbody>${filtered.map(item => {
      const mt = item.media_type || item.format || '';
      return `<tr>
        <td>${esc(resourceLabel(item))}</td>
        <td>${mediaBadge(mt)}</td>
        <td style="font-size:11px;font-family:monospace;color:var(--text-mono)">${esc(formatSummary(item))}</td>
        <td style="font-size:10px;font-family:monospace;color:var(--text-tertiary)">${versionToStr(item.version)}</td>
        <td style="font-size:10px;font-family:monospace;color:var(--text-tertiary)">${esc(item.id?.substring(0,16))}…</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION MAP PAGE
// ─────────────────────────────────────────────────────────────────────────────
let mapFilter = 'all';

async function renderMap(el, isRefresh = false) {
  if (!isRefresh) {
    mapFilter = 'all';
    el.innerHTML = toolbar('Connection Map', `
      <div class="filter-row" id="map-filter-btns">
        <button class="filter-btn active-all" data-filter="all">All</button>
        <button class="filter-btn" data-filter="connected">Connected only</button>
      </div>
    `) + `<div class="page-content" id="map-body" style="padding:0;overflow:auto;">${loadingHtml()}</div>`;

    el.querySelectorAll('#map-filter-btns .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        mapFilter = btn.dataset.filter;
        el.querySelectorAll('#map-filter-btns .filter-btn').forEach(b =>
          b.className = `filter-btn${b.dataset.filter === mapFilter ? ' active-' + mapFilter : ''}`
        );
        buildMap(senders, receivers, devMap, nodeMap);
      });
    });
  }

  const [senders, receivers, devices, nodes] = await Promise.all([
    apiFetch(`${appState.queryBase}${QUERY_PATH}/senders`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/receivers`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/devices`),
    apiFetch(`${appState.queryBase}${QUERY_PATH}/nodes`),
  ]);

  const body = document.getElementById('map-body');
  if (!body) return;

  if (!senders && !receivers) {
    body.innerHTML = errorHtml('Failed to fetch data');
    startRefresh(() => renderMap(el, true));
    return;
  }

  const devMap  = Object.fromEntries((devices  || []).map(d => [d.id, d]));
  const nodeMap = Object.fromEntries((nodes    || []).map(n => [n.id, n]));

  function nodeNameFor(deviceId) {
    const dev = devMap[deviceId];
    const node = dev ? nodeMap[dev.node_id] : null;
    return node ? (node.label || node.hostname || '') : '';
  }

  function buildMap(sndList, rcvList, devMap, nodeMap) {
    const connectedSIds = new Set(
      (rcvList || []).filter(r => r.subscription?.sender_id).map(r => r.subscription.sender_id)
    );
    const filtSenders   = mapFilter === 'connected'
      ? (sndList || []).filter(s => connectedSIds.has(s.id))
      : (sndList || []);
    const filtReceivers = mapFilter === 'connected'
      ? (rcvList || []).filter(r => r.subscription?.sender_id)
      : (rcvList || []);

    body.innerHTML = `
      <div class="map-wrap" id="map-wrap">
        <div class="map-col" id="map-senders-col">
          <div class="map-col-header">SENDERS (${filtSenders.length})</div>
          ${filtSenders.length ? filtSenders.map(s => `
            <div class="map-card ${connectedSIds.has(s.id) ? 'connected' : ''}"
                 data-sid="${esc(s.id)}"
                 onclick="navigateTo('senders')">
              <div class="map-card-label">${esc(s.label || s.id.slice(0,8))}</div>
              <div class="map-card-meta">${esc(nodeNameFor(s.device_id))}</div>
            </div>`).join('') : `<div style="font-size:11px;color:var(--text-tertiary);padding:8px 2px;">No senders</div>`}
        </div>
        <div class="map-mid" id="map-mid">
          <svg id="map-svg" class="map-svg"></svg>
        </div>
        <div class="map-col" id="map-receivers-col">
          <div class="map-col-header">RECEIVERS (${filtReceivers.length})</div>
          ${filtReceivers.length ? filtReceivers.map(r => `
            <div class="map-card ${r.subscription?.sender_id ? 'connected' : ''}"
                 data-rid="${esc(r.id)}"
                 onclick="navigateTo('receivers')">
              <div class="map-card-label">${esc(r.label || r.id.slice(0,8))}</div>
              <div class="map-card-meta">${esc(nodeNameFor(r.device_id))}</div>
            </div>`).join('') : `<div style="font-size:11px;color:var(--text-tertiary);padding:8px 2px;">No receivers</div>`}
        </div>
      </div>`;

    requestAnimationFrame(() => {
      initLines(rcvList || []);
      initHover(filtSenders, filtReceivers, rcvList || []);
    });
  }

  function makePath(wrap, mid, senderId, receiverId, color, width, opacity) {
    const sEl = wrap.querySelector(`[data-sid="${senderId}"]`);
    const rEl = wrap.querySelector(`[data-rid="${receiverId}"]`);
    if (!sEl || !rEl) return '';
    const midRect = mid.getBoundingClientRect();
    const sr = sEl.getBoundingClientRect();
    const rr = rEl.getBoundingClientRect();
    const x1 = 0, x2 = midRect.width, cx = midRect.width / 2;
    const y1 = sr.top + sr.height / 2 - midRect.top;
    const y2 = rr.top + rr.height / 2 - midRect.top;
    return `<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"
      stroke="${color}" stroke-width="${width}" fill="none" opacity="${opacity}"
      data-line="${senderId}:${receiverId}"/>`;
  }

  function setSvgSize(svg, wrap, mid) {
    const midRect  = mid.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    svg.setAttribute('width',  midRect.width);
    svg.setAttribute('height', Math.max(wrapRect.height, 100));
  }

  function initLines(rcvList) {
    const wrap = document.getElementById('map-wrap');
    const svg  = document.getElementById('map-svg');
    const mid  = document.getElementById('map-mid');
    if (!wrap || !svg || !mid) return;
    setSvgSize(svg, wrap, mid);
    svg.innerHTML = rcvList
      .filter(r => r.subscription?.sender_id)
      .map(r => makePath(wrap, mid, r.subscription.sender_id, r.id, '#ccc', 1.5, 1))
      .join('');
  }

  function initHover(filtSenders, filtReceivers, rcvList) {
    const wrap = document.getElementById('map-wrap');
    const svg  = document.getElementById('map-svg');
    const mid  = document.getElementById('map-mid');
    if (!wrap || !svg || !mid) return;

    // sender_id → [receiverId, ...]
    const senderToRcvs = {};
    rcvList.forEach(r => {
      if (!r.subscription?.sender_id) return;
      (senderToRcvs[r.subscription.sender_id] ||= []).push(r.id);
    });
    // receiverId → sender_id
    const rcvToSender = Object.fromEntries(
      rcvList.filter(r => r.subscription?.sender_id).map(r => [r.id, r.subscription.sender_id])
    );

    function clearHighlight() {
      wrap.querySelectorAll('.map-card').forEach(c => c.classList.remove('dim','focus-sender','focus-receiver','focus-related'));
      initLines(rcvList);
    }

    function highlightSender(senderId) {
      const relatedRcvs = senderToRcvs[senderId] || [];
      wrap.querySelectorAll('.map-card').forEach(c => {
        const sid = c.dataset.sid, rid = c.dataset.rid;
        if (sid === senderId) c.classList.add('focus-sender');
        else if (rid && relatedRcvs.includes(rid)) c.classList.add('focus-receiver');
        else c.classList.add('dim');
      });
      setSvgSize(svg, wrap, mid);
      svg.innerHTML = rcvList.filter(r => r.subscription?.sender_id).map(r => {
        const isActive = r.subscription.sender_id === senderId;
        return makePath(wrap, mid, r.subscription.sender_id, r.id,
          isActive ? '#185FA5' : '#e0e0e0', isActive ? 2 : 1, 1);
      }).join('');
    }

    function highlightReceiver(receiverId) {
      const senderId   = rcvToSender[receiverId];
      const siblings   = senderId ? (senderToRcvs[senderId] || []) : [];
      wrap.querySelectorAll('.map-card').forEach(c => {
        const sid = c.dataset.sid, rid = c.dataset.rid;
        if (rid === receiverId) c.classList.add('focus-receiver');
        else if (senderId && sid === senderId) c.classList.add('focus-sender');
        else if (rid && siblings.includes(rid)) c.classList.add('focus-related');
        else c.classList.add('dim');
      });
      setSvgSize(svg, wrap, mid);
      svg.innerHTML = rcvList.filter(r => r.subscription?.sender_id).map(r => {
        const isActive = r.id === receiverId || (senderId && r.subscription.sender_id === senderId && siblings.includes(r.id));
        return makePath(wrap, mid, r.subscription.sender_id, r.id,
          r.id === receiverId ? '#185FA5' : isActive ? '#9b94e8' : '#e0e0e0',
          r.id === receiverId ? 2 : 1, 1);
      }).join('');
    }

    wrap.querySelectorAll('[data-sid]').forEach(el => {
      el.addEventListener('mouseenter', () => highlightSender(el.dataset.sid));
      el.addEventListener('mouseleave', clearHighlight);
    });
    wrap.querySelectorAll('[data-rid]').forEach(el => {
      el.addEventListener('mouseenter', () => highlightReceiver(el.dataset.rid));
      el.addEventListener('mouseleave', clearHighlight);
    });
  }

  buildMap(senders, receivers, devMap, nodeMap);
  startRefresh(() => renderMap(el, true));
}

// ─────────────────────────────────────────────────────────────────────────────
// RDS SETTINGS PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function renderRdsSettings(el) {
  const cfg     = appState.config;
  const isLocal = cfg.mode === 'local';

  const nicList = isLocal ? await window.api.getNicList() : [];
  const nicOptions = nicList.map(n =>
    `<option value="${esc(n.value)}" ${n.value===cfg.host_address?'selected':''}>${esc(n.label)}</option>`
  ).join('');

  el.innerHTML = toolbar('RDS Settings') + `
    <div class="page-content">
      ${isLocal ? '' : `<div style="background:var(--blue-50);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--blue-800);margin-bottom:16px;">Connected to external RDS — settings are read-only.</div>`}

      <div class="settings-section-title">NETWORK</div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Listen NIC</div></div>
        <div class="setting-control">
          ${isLocal
            ? `<select class="s-select" id="s-nic" style="width:220px;font-family:monospace">${nicOptions}</select>`
            : `<span style="font-family:monospace;font-size:12px">${esc(cfg.host_address)}</span>`}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Registration port</div></div>
        <div class="setting-control">
          <input class="s-input" id="s-reg" type="number" value="${cfg.registration_port}" style="width:70px" ${isLocal?'':'readonly'}>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Query port</div></div>
        <div class="setting-control">
          <input class="s-input" id="s-qry" type="number" value="${cfg.query_port}" style="width:70px" ${isLocal?'':'readonly'}>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Domain</div><div class="setting-desc">mDNS domain suffix</div></div>
        <div class="setting-control">
          <input class="s-input" id="s-domain" value="${esc(cfg.domain)}" style="width:120px" ${isLocal?'':'readonly'}>
        </div>
      </div>

      <div class="settings-section-title" style="margin-top:16px">PRIORITY &amp; LOGGING</div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Priority</div><div class="setting-desc">Lower value = higher priority</div></div>
        <div class="setting-control">
          <input class="s-input" id="s-priority" type="number" value="${cfg.priority}" style="width:70px" min="0" max="255" ${isLocal?'':'readonly'}>
          ${cfg.priority < 100 ? `<div class="inline-warn">⚠ Values below 100 may conflict with other registries.</div>` : ''}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Log level</div></div>
        <div class="setting-control">
          <select class="s-select" id="s-loglevel" style="width:160px" ${isLocal?'':'disabled'}>
            <option value="40" ${cfg.logging_level>=30?'selected':''}>40 – fatal only</option>
            <option value="0"  ${cfg.logging_level===0?'selected':''}>0 – normal</option>
            <option value="-40" ${cfg.logging_level<=-30?'selected':''}>-40 – verbose</option>
          </select>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Error log file</div><div class="setting-desc">nmos-cpp error/event log</div></div>
        <div class="setting-control" style="display:flex;gap:6px;align-items:center;">
          <span id="s-errlog-path" style="font-size:11px;font-family:monospace;color:var(--text-secondary);max-width:260px;word-break:break-all;"></span>
          <button class="btn-sm" id="btn-save-errlog">Save as…</button>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Access log file</div><div class="setting-desc">HTTP access log in Common Log Format</div></div>
        <div class="setting-control" style="display:flex;gap:6px;align-items:center;">
          <span id="s-acclog-path" style="font-size:11px;font-family:monospace;color:var(--text-secondary);max-width:260px;word-break:break-all;"></span>
          <button class="btn-sm" id="btn-save-acclog">Save as…</button>
        </div>
      </div>

      ${isLocal ? `<div class="restart-notice" style="margin-top:16px">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#854F0B" stroke-width="1.2"/><path d="M7 4v3.5" stroke="#854F0B" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="10" r="0.7" fill="#854F0B"/></svg>
        Network and priority settings require a RDS restart to take effect.
      </div>` : ''}

      <div class="settings-buttons">
        <button class="btn-save-restart" id="btn-save-restart" ${isLocal?'':'disabled'}>Save &amp; Restart RDS</button>
        <button class="btn-save-only" id="btn-save-only" ${isLocal?'':'disabled'}>Save only</button>
        <button class="btn-stop-rds" id="btn-stop-rds">${isLocal ? 'Stop RDS' : 'Disconnect'}</button>
      </div>
      <div id="save-feedback" style="font-size:12px;color:var(--green-600);margin-top:8px;"></div>
    </div>
  `;

  function collectRdsCfg() {
    return {
      ...cfg,
      host_address:      isLocal ? (el.querySelector('#s-nic')?.value ?? cfg.host_address) : cfg.host_address,
      registration_port: parseInt(el.querySelector('#s-reg')?.value)  || cfg.registration_port,
      query_port:        parseInt(el.querySelector('#s-qry')?.value)  || cfg.query_port,
      domain:            el.querySelector('#s-domain')?.value         ?? cfg.domain,
      priority:          parseInt(el.querySelector('#s-priority')?.value) ?? cfg.priority,
      logging_level:     parseInt(el.querySelector('#s-loglevel')?.value) ?? cfg.logging_level,
    };
  }

  el.querySelector('#btn-save-restart')?.addEventListener('click', async () => {
    const ok = confirm('Save RDS settings and restart the RDS process?\nAll registered nodes will re-register automatically.');
    if (!ok) return;
    const newCfg = collectRdsCfg();
    appState.config = newCfg;
    await window.api.saveConfig(newCfg);
    await window.api.restart();
  });

  el.querySelector('#btn-save-only')?.addEventListener('click', async () => {
    const ok = confirm('Save RDS settings without restarting?\nNetwork/port changes will take effect on next restart.');
    if (!ok) return;
    const newCfg = collectRdsCfg();
    appState.config = newCfg;
    await window.api.saveConfig(newCfg);
    if (isLocal) {
      window.api.fetch(`${appState.regBase}/settings/all`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ logging_level: newCfg.logging_level }),
      }).catch(() => {});
    }
    const fb = el.querySelector('#save-feedback');
    if (fb) { fb.textContent = '✓ Settings saved'; setTimeout(() => fb.textContent = '', 2000); }
  });

  window.api.getLogPaths().then(({ error, access }) => {
    const errEl = el.querySelector('#s-errlog-path');
    const accEl = el.querySelector('#s-acclog-path');
    if (errEl) errEl.textContent = error;
    if (accEl) accEl.textContent = access;
  });

  el.querySelector('#btn-save-errlog')?.addEventListener('click', async () => {
    const { error } = await window.api.getLogPaths();
    await window.api.saveLogAs(error);
  });

  el.querySelector('#btn-save-acclog')?.addEventListener('click', async () => {
    const { access } = await window.api.getLogPaths();
    await window.api.saveLogAs(access);
  });

  el.querySelector('#btn-stop-rds')?.addEventListener('click', async () => {
    if (isLocal) {
      const ok = confirm('Stop the RDS? All registered nodes will be disconnected.');
      if (!ok) return;
    }
    stopRefresh();
    stopWebSocket();
    clearInterval(uptimeInterval);
    await window.api.restart();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// APP SETTINGS PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function renderAppSettings(el) {
  const cfg     = appState.config;
  const version = await window.api.getVersion().catch(() => '0.1.0');

  el.innerHTML = toolbar('App Settings') + `
    <div class="page-content">

      <div class="settings-section-title">UPDATE</div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Update mode</div></div>
        <div class="setting-control" style="display:flex;gap:16px;align-items:center;">
          <label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer">
            <input type="radio" name="s-update-mode" value="interval" ${(cfg.update_mode||'websocket')==='interval'?'checked':''}> Interval
          </label>
          <label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer">
            <input type="radio" name="s-update-mode" value="websocket" ${(cfg.update_mode||'websocket')==='websocket'?'checked':''}> WebSocket
          </label>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Poll interval</div><div class="setting-desc">Interval mode polling / WS fallback check</div></div>
        <div class="setting-control" style="display:flex;gap:6px;align-items:center;">
          <input class="s-input" id="s-poll-interval" type="number" value="${cfg.poll_interval||5}" style="width:60px" min="1" max="300"> <span style="font-size:12px;color:var(--text-secondary)">sec</span>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="setting-label">Timeline window</div><div class="setting-desc">History shown in Live Timeline</div></div>
        <div class="setting-control" style="display:flex;gap:6px;align-items:center;">
          <input class="s-input" id="s-timeline-window" type="number" value="${cfg.timeline_window||10}" style="width:60px" min="1" max="60"> <span style="font-size:12px;color:var(--text-secondary)">min</span>
        </div>
      </div>

      <div class="settings-buttons" style="margin-top:24px;">
        <button class="btn-save-only" id="btn-app-save">Save</button>
      </div>

      <div class="settings-section-title" style="margin-top:24px">ABOUT</div>
      <div class="settings-about">
        <strong>NMOS Simple RDS Studio</strong> &nbsp; v${esc(version)}<br>
        RDS engine: nmos-cpp (<a href="#" onclick="return false">sony/nmos-cpp</a>)<br>
        License: Apache License 2.0
      </div>
      <div id="app-save-feedback" style="font-size:12px;color:var(--green-600);margin-top:8px;"></div>
    </div>
  `;

  el.querySelector('#btn-app-save')?.addEventListener('click', async () => {
    const newCfg = {
      ...cfg,
      update_mode:   el.querySelector('input[name="s-update-mode"]:checked')?.value ?? (cfg.update_mode || 'websocket'),
      poll_interval:     parseInt(el.querySelector('#s-poll-interval')?.value)     || cfg.poll_interval     || 5,
      timeline_window:   parseInt(el.querySelector('#s-timeline-window')?.value)   || cfg.timeline_window   || 10,
    };
    appState.config = newCfg;
    await window.api.saveConfig(newCfg);

    const oldMode = cfg.update_mode;
    if (newCfg.update_mode === 'websocket' && oldMode !== 'websocket') {
      stopRefresh();
      stopWebSocket();
      initWebSocket();
    } else if (newCfg.update_mode !== 'websocket' && oldMode === 'websocket') {
      stopWebSocket();
    }

    const fb = el.querySelector('#app-save-feedback');
    if (fb) { fb.textContent = '✓ Saved'; setTimeout(() => fb.textContent = '', 2000); }
  });
}

// ─── Metric Counter Animation + Sparkline History ────────────────────────────
const prevMetrics = {};
const getTimelineWindowMs = () => ((appState.config?.timeline_window || 10) * 60 * 1000);
const metricsHistory = { nodes: [], senders: [], receivers: [], flows: [] };
const sparklineColors = {
  nodes:     '#185FA5',
  senders:   '#3B6D11',
  receivers: '#534AB7',
  flows:     '#854F0B',
};

function recordMetrics(metrics) {
  const now = Date.now();
  const cutoff = now - getTimelineWindowMs();
  for (const [key, val] of Object.entries(metrics)) {
    if (val == null || !(key in metricsHistory)) continue;
    metricsHistory[key].push({ t: now, v: val });
    // Trim old entries
    while (metricsHistory[key].length > 0 && metricsHistory[key][0].t < cutoff) {
      metricsHistory[key].shift();
    }
  }
}

function sparklineSvg(key, w = 80, h = 30) {
  const pts = metricsHistory[key];
  const color = sparklineColors[key] || '#185FA5';
  if (pts.length < 2) return '';
  const now = Date.now();
  const tMin = now - getTimelineWindowMs();
  const vMin = Math.min(...pts.map(p => p.v));
  const vMax = Math.max(...pts.map(p => p.v));
  const vRange = vMax - vMin || 1;
  const toX = t => ((t - tMin) / getTimelineWindowMs()) * w;
  const toY = v => h - 2 - ((v - vMin) / vRange) * (h - 4);
  const coords = pts.map(p => `${toX(p.t).toFixed(1)},${toY(p.v).toFixed(1)}`);
  const lineD = `M ${coords.join(' L ')}`;
  const areaD = `M ${toX(pts[0].t).toFixed(1)},${h} L ${coords.join(' L ')} L ${toX(pts[pts.length-1].t).toFixed(1)},${h} Z`;
  const uid = `sg-${key}`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
    style="position:absolute;bottom:0;right:0;opacity:0.18;pointer-events:none;">
    <defs>
      <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#${uid})"/>
    <path d="${lineD}" stroke="${color}" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
  </svg>`;
}

function animateMetrics(metrics) {
  recordMetrics(metrics);
  for (const [key, newVal] of Object.entries(metrics)) {
    if (newVal == null) continue;
    const el = document.getElementById(`mv-${key}`);
    if (!el) continue;
    const oldVal = prevMetrics[key] ?? newVal;
    prevMetrics[key] = newVal;
    if (oldVal === newVal) { el.textContent = newVal; continue; }
    const start = Date.now();
    const diff = newVal - oldVal;
    const step = () => {
      const p = Math.min((Date.now() - start) / 600, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(oldVal + diff * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // Re-render sparklines in-place without full re-render
  for (const key of Object.keys(metricsHistory)) {
    const card = document.getElementById(`spark-${key}`);
    if (card) card.innerHTML = sparklineSvg(key, card.offsetWidth || 80, 30);
  }
}

// ─── Activity Log & Node Watcher ─────────────────────────────────────────────
const activityLog = [];
const MAX_ACTIVITY = 100;
let previousNodeMap = null; // null = not initialized yet

function addActivity(type, label) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  activityLog.unshift({ type, label, time, ts: Date.now() });
  if (activityLog.length > MAX_ACTIVITY) activityLog.pop();
  const feed = document.getElementById('node-activity-feed');
  if (feed) renderActivityFeed();
  renderTimeline(true);
}

function renderActivityFeed() {
  const feed = document.getElementById('node-activity-feed');
  if (feed) {
    if (!activityLog.length) {
      feed.innerHTML = '<div style="color:var(--text-tertiary);font-size:11px;padding:6px 0;">No events yet</div>';
    } else {
      feed.innerHTML = activityLog.slice(0, 30).map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:0.5px solid var(--border-default);">
          <span style="font-size:13px;color:${a.type==='join'?'var(--green-600)':'var(--red-600)'};">${a.type==='join'?'REG':'UNREG'}</span>
          <span style="flex:1;font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.label)}</span>
          <span style="font-size:10px;font-family:monospace;color:var(--text-tertiary);flex-shrink:0;">${a.time}</span>
        </div>
      `).join('');
    }
  }
  renderTimeline();
}

let tlUpdateInterval = null;

function groupTimelineEvents(events, groupMs = 3000) {
  const inWindow = events.filter(a => a.ts && (Date.now() - a.ts) <= getTimelineWindowMs());
  const sorted = [...inWindow].sort((a, b) => b.ts - a.ts);
  const groups = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(e.ts - last.ts) <= groupMs) {
      last.events.push(e);
    } else {
      groups.push({ ts: e.ts, events: [e] });
    }
  }
  return groups;
}

function renderTimeline(isNew = false) {
  const wrap = document.getElementById('ov-timeline-wrap');
  const rail = document.getElementById('ov-timeline');
  if (!rail || !wrap) return;

  const groups = groupTimelineEvents(activityLog);
  const W = wrap.offsetWidth || 600;
  const now = Date.now();

  if (!groups.length) {
    rail.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary);position:absolute;top:32px;left:12px;">Waiting for events…</div>';
    return;
  }

  rail.innerHTML = '';

  // Remove old tooltip
  const oldTip = document.getElementById('tl-tooltip');
  if (oldTip) oldTip.remove();

  // Tooltip element
  const tip = document.createElement('div');
  tip.id = 'tl-tooltip';
  tip.style.cssText = 'position:absolute;z-index:100;background:#222;color:#fff;font-size:10px;border-radius:6px;padding:5px 8px;pointer-events:none;display:none;white-space:nowrap;line-height:1.6;transform:translateX(-50%);bottom:100%;margin-bottom:6px;';
  rail.appendChild(tip);

  groups.forEach((g, i) => {
    const age = now - g.ts;
    const xPct = (age / getTimelineWindowMs()) * 100;
    if (xPct < 0 || xPct > 100) return;

    const hasJoin  = g.events.some(e => e.type === 'join');
    const hasLeave = g.events.some(e => e.type === 'leave');
    const dotColor = hasJoin && hasLeave ? '#854F0B' : hasJoin ? 'var(--green-600)' : 'var(--red-600)';
    const typeLabel = hasJoin && hasLeave ? 'MIX' : hasJoin ? 'REG' : 'UNREG';
    const count = g.events.length;

    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:${xPct}%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;padding-top:2px;cursor:default;`;
    el.innerHTML = `
      <div style="font-size:9px;font-weight:600;color:${dotColor};height:14px;line-height:14px;">${typeLabel}</div>
      <div class="timeline-dot${i===0&&isNew?' new':''}" style="background:${dotColor};"></div>
      ${count > 1 ? `<div style="font-size:9px;font-weight:600;color:${dotColor};margin-top:3px;">×${count}</div>` : '<div style="height:14px;"></div>'}
    `;

    el.addEventListener('mouseenter', () => {
      const lines = g.events.map(e =>
        `${e.type==='join'?'REG':'UNREG'} ${e.label}  <span style="color:#aaa;font-family:monospace;">${e.time}</span>`
      ).join('<br>');
      tip.innerHTML = lines;
      tip.style.left = `${xPct}%`;
      tip.style.display = 'block';
    });
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

    rail.appendChild(el);
  });

  // Start periodic position update if not already running
  if (!tlUpdateInterval) {
    tlUpdateInterval = setInterval(() => {
      if (document.getElementById('ov-timeline')) renderTimeline(false);
      else { clearInterval(tlUpdateInterval); tlUpdateInterval = null; }
    }, 20000);
  }
}

async function watchNodes() {
  const res = await window.api.fetch(`${appState.queryBase}${QUERY_PATH}/nodes`, { readBody: true });
  if (!res.ok) return;
  let nodes;
  try { nodes = JSON.parse(res.text); } catch { return; }

  const newMap = new Map(nodes.map(n => [n.id, nodeLabel(n)]));

  if (previousNodeMap === null) {
    previousNodeMap = newMap;
    return;
  }

  for (const [id, label] of newMap) {
    if (!previousNodeMap.has(id)) {
      addActivity('join', label);
      showToast(`↑ ${label} REG`, 'join');
    }
  }
  for (const [id, label] of previousNodeMap) {
    if (!newMap.has(id)) {
      addActivity('leave', label);
      showToast(`↓ ${label} UNREG`, 'leave');
    }
  }

  previousNodeMap = newMap;
}

// ─── Global Search ────────────────────────────────────────────────────────────
let searchCache = null;

async function fetchSearchCache() {
  const base = appState.queryBase + QUERY_PATH;
  const [nodes, devices, senders, receivers, flows, sources] = await Promise.all([
    window.api.fetch(`${base}/nodes`,     { readBody: true }).then(r => r.ok ? JSON.parse(r.text) : []),
    window.api.fetch(`${base}/devices`,   { readBody: true }).then(r => r.ok ? JSON.parse(r.text) : []),
    window.api.fetch(`${base}/senders`,   { readBody: true }).then(r => r.ok ? JSON.parse(r.text) : []),
    window.api.fetch(`${base}/receivers`, { readBody: true }).then(r => r.ok ? JSON.parse(r.text) : []),
    window.api.fetch(`${base}/flows`,     { readBody: true }).then(r => r.ok ? JSON.parse(r.text) : []),
    window.api.fetch(`${base}/sources`,   { readBody: true }).then(r => r.ok ? JSON.parse(r.text) : []),
  ]);
  searchCache = { nodes, devices, senders, receivers, flows, sources };
}

function searchResources(query) {
  if (!searchCache || !query) return [];
  const q = query.toLowerCase();
  const match = (r) =>
    (r.label||'').toLowerCase().includes(q) ||
    (r.description||'').toLowerCase().includes(q) ||
    (r.hostname||'').toLowerCase().includes(q) ||
    (r.id||'').toLowerCase().startsWith(q) ||
    (r.api?.endpoints||[]).some(e => (e.host||'').includes(q)) ||
    (r.format||'').toLowerCase().includes(q) ||
    (r.transport||'').toLowerCase().includes(q);

  const results = [];
  const add = (type, page, icon, items) => {
    const matched = items.filter(match);
    if (matched.length) results.push({ type, page, icon, items: matched.slice(0, 5) });
  };
  add('Nodes',     'nodes',     '●', searchCache.nodes);
  add('Senders',   'senders',   '●', searchCache.senders);
  add('Receivers', 'receivers', '●', searchCache.receivers);
  add('Flows',     'flows',     '●', searchCache.flows);
  add('Sources',   'flows',     '●', searchCache.sources);
  return results;
}

function renderSearchResults(results, query) {
  const dd = document.getElementById('search-dropdown');
  if (!dd) return;
  if (!query) { dd.classList.remove('open'); return; }
  if (!results.length) {
    dd.innerHTML = `<div class="search-empty">No results for "${esc(query)}"</div>`;
    dd.classList.add('open');
    return;
  }
  const colors = { Nodes: '#185FA5', Senders: '#3B6D11', Receivers: '#534AB7', Flows: '#854F0B', Sources: '#854F0B' };
  dd.innerHTML = results.map(group => `
    <div class="search-group-label">${esc(group.type)}</div>
    ${group.items.map(r => `
      <div class="search-item" data-page="${esc(group.page)}" data-id="${esc(r.id)}">
        <span style="width:7px;height:7px;border-radius:50%;background:${colors[group.type]||'#999'};flex-shrink:0;display:inline-block;"></span>
        <span class="search-item-label">${esc(r.label?.trim() || r.hostname || r.id?.substring(0,16))}</span>
        <span class="search-item-sub">${esc(r.id?.substring(0,8))}…</span>
      </div>
    `).join('')}
  `).join('');
  dd.classList.add('open');

  dd.querySelectorAll('.search-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const page = el.dataset.page;
      const id   = el.dataset.id;
      document.getElementById('global-search').value = '';
      dd.classList.remove('open');
      navigateTo(page);
      // Highlight after render
      setTimeout(() => {
        const card = document.querySelector(`[data-sender-id="${id}"],[data-recv-id="${id}"],[data-node-id="${id}"]`);
        if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('highlighted'); }
      }, 300);
    });
  });
}

function setupSearch() {
  const input = document.getElementById('global-search');
  const dd    = document.getElementById('search-dropdown');
  if (!input) return;

  let debounce = null;
  input.addEventListener('focus', () => { searchCache = null; fetchSearchCache(); });
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      if (!searchCache) await fetchSearchCache();
      renderSearchResults(searchResources(input.value.trim()), input.value.trim());
    }, 200);
  });
  input.addEventListener('blur', () => setTimeout(() => dd?.classList.remove('open'), 150));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); input.focus(); input.select(); }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
