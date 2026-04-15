/**
 * dashboard.js — Full dashboard implementation
 * Pages: Overview, Log, Nodes, Senders, Receivers, Flows/Sources, Settings
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let config      = null;
let queryBase   = '';
let regBase     = '';
let currentPage = 'overview';
let refreshTimer    = null;
let uptimeInterval  = null;
let uptimeStart     = Date.now();

// Per-page filter state (persists across refreshes)
let sendersFilter   = 'all';
let receiversFilter = 'all';
let flowsTab        = 'flows';
let flowsFilter     = 'all';
let logFilter       = null;
let logEntries      = [];

const REFRESH_MS  = 5000;
const QUERY_PATH  = '/x-nmos/query/v1.3';

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  config = await window.api.loadConfig();
  if (!config) return;

  if (config.mode === 'local') {
    queryBase = `http://127.0.0.1:${config.query_port}`;
    regBase   = `http://127.0.0.1:${config.registration_port}`;
  } else {
    const base = config.remote_url.replace(/\/$/, '');
    queryBase  = base;
    regBase    = base;
  }

  document.getElementById('tb-url').textContent = queryBase;
  document.getElementById('btn-stop').textContent = config.mode === 'local' ? 'Stop RDS' : 'Disconnect';

  updateStatusBar();
  startUptimeClock();
  setupNav();
  setupStopButton();
  navigateTo('overview');
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function updateStatusBar() {
  const isLocal = config.mode === 'local';
  document.getElementById('sb-status').textContent =
    isLocal ? 'nmos-cpp-registry running' : `Connected: ${config.remote_url}`;
  document.getElementById('sb-mdns').textContent =
    `mDNS: _nmos-registration._tcp.${config.domain}`;
  document.getElementById('sb-priority').textContent = `Priority: ${config.priority}`;
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

function setupStopButton() {
  document.getElementById('btn-stop').addEventListener('click', async () => {
    clearInterval(uptimeInterval);
    stopRefresh();
    await window.api.stopRds();
  });
}

function navigateTo(page) {
  stopRefresh();
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page));
  renderPage(page);
}

function renderPage(page) {
  const main = document.getElementById('main-content');
  const pages = {
    overview:  renderOverview,
    log:       renderLog,
    nodes:     renderNodes,
    senders:   renderSenders,
    receivers: renderReceivers,
    flows:     renderFlows,
    settings:  renderSettings,
  };
  if (pages[page]) pages[page](main);
}

// ─── Refresh ──────────────────────────────────────────────────────────────────
function startRefresh(fn) {
  stopRefresh();
  refreshTimer = setInterval(fn, REFRESH_MS);
}
function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

// ─── API utilities ────────────────────────────────────────────────────────────
async function apiFetch(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function chip(label, color) {
  if (!label || label === '—') return '';
  const cls = color ? `chip chip-${color}` : 'chip';
  return `<span class="${cls}">${esc(label)}</span>`;
}

function formatLabel(format) {
  if (!format) return '—';
  if (format.includes('video')) return 'Video';
  if (format.includes('audio')) return 'Audio';
  if (format.includes('data'))  return 'ANC';
  if (format.includes('mux'))   return 'Mux';
  return format.split(':').pop() || '—';
}

function formatColor(format) {
  if (!format) return '';
  if (format.includes('video')) return 'blue';
  if (format.includes('audio')) return 'green';
  if (format.includes('data'))  return 'amber';
  return '';
}

function levelName(level) {
  if (typeof level !== 'number') return String(level || 'info');
  if (level <= -40) return 'fatal';
  if (level <= -30) return 'error';
  if (level < 0)    return 'warning';
  if (level >= 10)  return 'verbose';
  return 'info';
}

function pageHeader(title, sub) {
  return `<div class="page-header">
    <div class="page-title">${esc(title)}</div>
    ${sub ? `<div class="page-subtitle">${esc(sub)}</div>` : ''}
  </div>`;
}

function loadingHtml() {
  return `<div class="state-box"><span class="spinner"></span> Loading…</div>`;
}

function emptyHtml(msg) {
  return `<div class="state-box state-empty">${esc(msg)}</div>`;
}

function errorHtml(msg) {
  return `<div class="state-box state-error">${esc(msg)}</div>`;
}

function filterPills(id, options, active) {
  return `<div class="filter-pills" id="${id}">${
    options.map(([val, label]) =>
      `<button class="filter-pill${active === val ? ' active' : ''}" data-filter="${val}">${label}</button>`
    ).join('')
  }</div>`;
}

// ─── Overview ─────────────────────────────────────────────────────────────────
async function renderOverview(el) {
  el.innerHTML = pageHeader('Overview', 'Real-time RDS status') + loadingHtml();

  const [nodes, senders, receivers, flows] = await Promise.all([
    apiFetch(`${queryBase}${QUERY_PATH}/nodes`),
    apiFetch(`${queryBase}${QUERY_PATH}/senders`),
    apiFetch(`${queryBase}${QUERY_PATH}/receivers`),
    apiFetch(`${queryBase}${QUERY_PATH}/flows`),
  ]);

  const n = nodes?.length ?? '—';
  const s = senders?.length ?? '—';
  const r = receivers?.length ?? '—';
  const f = flows?.length ?? '—';

  const nodesRows = (nodes || []).map(nd => `
    <tr>
      <td>${esc(nd.label || nd.hostname || '—')}</td>
      <td><code>${esc(nd.hostname || '—')}</code></td>
      <td>${(nd.api?.versions || []).map(v => chip(v)).join(' ')}</td>
      <td><code class="id-small">${esc(nd.id)}</code></td>
    </tr>`).join('');

  el.innerHTML = pageHeader('Overview', 'Real-time RDS status') + `
    <div class="metric-grid">
      <div class="metric-card"><div class="metric-value">${n}</div><div class="metric-label">Nodes</div></div>
      <div class="metric-card"><div class="metric-value">${s}</div><div class="metric-label">Senders</div></div>
      <div class="metric-card"><div class="metric-value">${r}</div><div class="metric-label">Receivers</div></div>
      <div class="metric-card"><div class="metric-value">${f}</div><div class="metric-label">Flows</div></div>
    </div>
    <div class="section-title">Nodes</div>
    ${nodes && nodes.length ? `
    <table class="data-table">
      <thead><tr><th>Label</th><th>Hostname</th><th>API</th><th>ID</th></tr></thead>
      <tbody>${nodesRows}</tbody>
    </table>` : emptyHtml('No nodes registered')}
  `;

  startRefresh(() => renderOverview(el));
}

// ─── Log ──────────────────────────────────────────────────────────────────────
async function renderLog(el) {
  const isLocal = config.mode === 'local';

  el.innerHTML = pageHeader('Log', 'RDS event log') + `
    <div class="log-toolbar">
      ${filterPills('log-filter', [
        ['all','All'],['fatal','Fatal'],['error','Error'],
        ['warning','Warning'],['info','Info'],['verbose','Verbose']
      ], logFilter || 'all')}
      ${isLocal ? `<div class="log-level-ctrl">
        <span class="log-level-label">Log level:</span>
        <input type="range" id="log-level-slider" min="-40" max="40" step="10"
               value="${config.logging_level ?? 0}" style="width:100px">
        <span id="log-level-val">${config.logging_level ?? 0}</span>
      </div>` : ''}
    </div>
    <div class="log-viewer" id="log-viewer">${loadingHtml()}</div>
  `;

  el.querySelectorAll('#log-filter .filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      logFilter = btn.dataset.filter === 'all' ? null : btn.dataset.filter;
      el.querySelectorAll('#log-filter .filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderLogList();
    });
  });

  if (isLocal) {
    const slider = el.querySelector('#log-level-slider');
    const valEl  = el.querySelector('#log-level-val');
    slider?.addEventListener('change', async () => {
      const val = parseInt(slider.value);
      valEl.textContent = val;
      await fetch(`${regBase}/settings/all`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logging_level: val }),
      }).catch(() => {});
    });
  }

  await fetchLog();
  startRefresh(fetchLog);
}

async function fetchLog() {
  const data = await apiFetch(`${regBase}/log/events`);
  if (Array.isArray(data)) logEntries = data;
  renderLogList();
}

function renderLogList() {
  const viewer = document.getElementById('log-viewer');
  if (!viewer) return;

  let list = logEntries;
  if (logFilter && logFilter !== 'all') {
    list = list.filter(e => levelName(e.level) === logFilter);
  }

  if (!list.length) { viewer.innerHTML = emptyHtml('No log entries'); return; }

  viewer.innerHTML = [...list].reverse().slice(0, 300).map(e => {
    const lv = levelName(e.level);
    const cls = lv === 'error' || lv === 'fatal' ? 'log-error'
              : lv === 'warning' ? 'log-warn' : 'log-info';
    return `<div class="log-line ${cls}">
      <span class="log-ts">${esc(e.timestamp || '')}</span>
      <span class="log-lvl">${esc(lv)}</span>
      <span class="log-msg">${esc(e.message || '')}</span>
    </div>`;
  }).join('');
}

// ─── Nodes ────────────────────────────────────────────────────────────────────
async function renderNodes(el) {
  el.innerHTML = pageHeader('Nodes', 'Registered NMOS nodes') + loadingHtml();

  const [nodes, devices, senders, receivers] = await Promise.all([
    apiFetch(`${queryBase}${QUERY_PATH}/nodes`),
    apiFetch(`${queryBase}${QUERY_PATH}/devices`),
    apiFetch(`${queryBase}${QUERY_PATH}/senders`),
    apiFetch(`${queryBase}${QUERY_PATH}/receivers`),
  ]);

  if (!nodes) { el.innerHTML = pageHeader('Nodes', 'Registered NMOS nodes') + errorHtml('Failed to fetch nodes'); return; }
  if (!nodes.length) { el.innerHTML = pageHeader('Nodes', 'Registered NMOS nodes') + emptyHtml('No nodes registered'); return; }

  const devByNode  = groupBy(devices  || [], 'node_id');
  const sndByDev   = groupBy(senders  || [], 'device_id');
  const rcvByDev   = groupBy(receivers || [], 'device_id');

  el.innerHTML = pageHeader('Nodes', 'Registered NMOS nodes') + `
    <div class="accordion">${nodes.map(node => {
      const devs = devByNode[node.id] || [];
      return `<div class="accordion-item" data-id="${esc(node.id)}">
        <div class="accordion-header" onclick="toggleAcc('${esc(node.id)}')">
          <span class="acc-arrow">▶</span>
          <span class="acc-title">${esc(node.label || node.hostname || node.id)}</span>
          <span class="acc-meta">
            <code>${esc(node.hostname || '')}</code>
            ${chip(`${devs.length} device${devs.length !== 1 ? 's' : ''}`)}
          </span>
        </div>
        <div class="accordion-body" id="acc-${esc(node.id)}">
          <div class="detail-grid">
            <span class="dk">Description</span><span>${esc(node.description || '—')}</span>
            <span class="dk">API</span><span>${(node.api?.versions || []).map(v => chip(v)).join(' ') || '—'}</span>
            <span class="dk">ID</span><code>${esc(node.id)}</code>
          </div>
          ${devs.map(dev => {
            const snds = sndByDev[dev.id] || [];
            const rcvs = rcvByDev[dev.id] || [];
            return `<div class="device-block">
              <div class="device-title">
                ${esc(dev.label || dev.id)}
                ${chip(dev.type?.split(':').pop() || 'generic')}
                ${snds.length ? chip(`${snds.length} senders`, 'green') : ''}
                ${rcvs.length ? chip(`${rcvs.length} receivers`, 'purple') : ''}
              </div>
              ${snds.length ? `<div class="sub-list">${snds.map(s =>
                `<div class="sub-item">
                  <span class="arrow-out">→</span>
                  ${esc(s.label || s.id)}
                  ${chip(formatLabel(s.format), formatColor(s.format))}
                </div>`).join('')}</div>` : ''}
              ${rcvs.length ? `<div class="sub-list">${rcvs.map(r =>
                `<div class="sub-item">
                  <span class="arrow-in">←</span>
                  ${esc(r.label || r.id)}
                  ${chip(formatLabel(r.format), formatColor(r.format))}
                </div>`).join('')}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}</div>
  `;

  startRefresh(() => renderNodes(el));
}

function toggleAcc(id) {
  const body = document.getElementById(`acc-${id}`);
  const arr  = document.querySelector(`.accordion-item[data-id="${id}"] .acc-arrow`);
  if (!body) return;
  const open = body.classList.toggle('open');
  if (arr) arr.style.transform = open ? 'rotate(90deg)' : '';
}

function groupBy(arr, key) {
  return arr.reduce((m, item) => {
    const k = item[key];
    if (!m[k]) m[k] = [];
    m[k].push(item);
    return m;
  }, {});
}

// ─── Senders ──────────────────────────────────────────────────────────────────
async function renderSenders(el) {
  el.innerHTML = pageHeader('Senders', 'NMOS senders') + loadingHtml();

  const [senders, flows] = await Promise.all([
    apiFetch(`${queryBase}${QUERY_PATH}/senders`),
    apiFetch(`${queryBase}${QUERY_PATH}/flows`),
  ]);

  if (!senders) { el.innerHTML = pageHeader('Senders', 'NMOS senders') + errorHtml('Failed to fetch senders'); return; }

  const flowMap = {};
  (flows || []).forEach(f => flowMap[f.id] = f);

  const getFormat = s => flowMap[s.flow_id]?.format || s.format || '';

  function buildTable() {
    const filtered = senders.filter(s => {
      if (sendersFilter === 'all') return true;
      const fmt = getFormat(s);
      if (sendersFilter === 'video') return fmt.includes('video');
      if (sendersFilter === 'audio') return fmt.includes('audio');
      if (sendersFilter === 'anc')   return fmt.includes('data');
      return true;
    });

    return filtered.length ? `
      <table class="data-table">
        <thead><tr><th>Label</th><th>Format</th><th>Transport</th><th>Flow ID</th><th>SDP</th></tr></thead>
        <tbody>${filtered.map(s => {
          const fmt = getFormat(s);
          return `<tr>
            <td>${esc(s.label || '—')}</td>
            <td>${chip(formatLabel(fmt), formatColor(fmt))}</td>
            <td>${esc(s.transport?.split(':').pop() || '—')}</td>
            <td>${s.flow_id ? `<code class="id-small">${esc(s.flow_id)}</code>` : '—'}</td>
            <td>${s.manifest_href
              ? `<button class="btn-link" onclick="showSdp('${esc(s.manifest_href)}')">SDP</button>`
              : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : emptyHtml('No senders match filter');
  }

  el.innerHTML = pageHeader('Senders', 'NMOS senders') + `
    ${filterPills('senders-filter', [
      ['all','All'],['video','Video'],['audio','Audio'],['anc','ANC']
    ], sendersFilter)}
    <div id="senders-table">${buildTable()}</div>
    <div id="sdp-modal" class="sdp-modal" style="display:none">
      <div class="sdp-header">
        <span>SDP</span><button class="sdp-close" onclick="closeSdp()">✕</button>
      </div>
      <pre id="sdp-content" class="sdp-content"></pre>
    </div>
  `;

  el.querySelectorAll('#senders-filter .filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      sendersFilter = btn.dataset.filter;
      el.querySelectorAll('#senders-filter .filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('senders-table').innerHTML = buildTable();
    });
  });

  startRefresh(() => renderSenders(el));
}

async function showSdp(href) {
  const modal   = document.getElementById('sdp-modal');
  const content = document.getElementById('sdp-content');
  if (!modal || !content) return;
  content.textContent = 'Loading…';
  modal.style.display = 'flex';
  try {
    const res = await fetch(href);
    content.textContent = await res.text();
  } catch (e) {
    content.textContent = `Failed to load SDP: ${e.message}`;
  }
}

function closeSdp() {
  const m = document.getElementById('sdp-modal');
  if (m) m.style.display = 'none';
}

// ─── Receivers ────────────────────────────────────────────────────────────────
async function renderReceivers(el) {
  el.innerHTML = pageHeader('Receivers', 'NMOS receivers') + loadingHtml();

  const receivers = await apiFetch(`${queryBase}${QUERY_PATH}/receivers`);
  if (!receivers) { el.innerHTML = pageHeader('Receivers', 'NMOS receivers') + errorHtml('Failed to fetch receivers'); return; }

  function buildTable() {
    const filtered = receivers.filter(r => {
      if (receiversFilter === 'all')       return true;
      if (receiversFilter === 'connected') return r.subscription?.active;
      if (receiversFilter === 'idle')      return !r.subscription?.active;
      const fmt = r.format || '';
      if (receiversFilter === 'video') return fmt.includes('video');
      if (receiversFilter === 'audio') return fmt.includes('audio');
      if (receiversFilter === 'anc')   return fmt.includes('data');
      return true;
    });

    return filtered.length ? `
      <table class="data-table">
        <thead><tr><th>Label</th><th>Format</th><th>Transport</th><th>Status</th><th>Sender ID</th></tr></thead>
        <tbody>${filtered.map(r => {
          const active = r.subscription?.active;
          return `<tr>
            <td>${esc(r.label || '—')}</td>
            <td>${chip(formatLabel(r.format), formatColor(r.format))}</td>
            <td>${esc(r.transport?.split(':').pop() || '—')}</td>
            <td><span class="status-dot${active ? ' active' : ''}"></span>${active ? 'Connected' : 'Idle'}</td>
            <td>${r.subscription?.sender_id
              ? `<code class="id-small">${esc(r.subscription.sender_id)}</code>` : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : emptyHtml('No receivers match filter');
  }

  el.innerHTML = pageHeader('Receivers', 'NMOS receivers') + `
    ${filterPills('receivers-filter', [
      ['all','All'],['video','Video'],['audio','Audio'],['anc','ANC'],
      ['connected','Connected'],['idle','Idle']
    ], receiversFilter)}
    <div id="receivers-table">${buildTable()}</div>
  `;

  el.querySelectorAll('#receivers-filter .filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      receiversFilter = btn.dataset.filter;
      el.querySelectorAll('#receivers-filter .filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('receivers-table').innerHTML = buildTable();
    });
  });

  startRefresh(() => renderReceivers(el));
}

// ─── Flows / Sources ──────────────────────────────────────────────────────────
async function renderFlows(el) {
  el.innerHTML = pageHeader('Flows / Sources', 'Media flows and sources') + loadingHtml();

  const [flows, sources] = await Promise.all([
    apiFetch(`${queryBase}${QUERY_PATH}/flows`),
    apiFetch(`${queryBase}${QUERY_PATH}/sources`),
  ]);

  function buildContent() {
    const data   = flowsTab === 'flows' ? (flows || []) : (sources || []);
    const filtered = data.filter(item => {
      if (flowsFilter === 'all') return true;
      const fmt = item.format || '';
      if (flowsFilter === 'video') return fmt.includes('video');
      if (flowsFilter === 'audio') return fmt.includes('audio');
      if (flowsFilter === 'anc')   return fmt.includes('data');
      return true;
    });

    return filtered.length ? `
      <table class="data-table">
        <thead><tr><th>Label</th><th>Format</th><th>Description</th><th>ID</th></tr></thead>
        <tbody>${filtered.map(item => `<tr>
          <td>${esc(item.label || '—')}</td>
          <td>${chip(formatLabel(item.format), formatColor(item.format))}</td>
          <td>${esc(item.description || '—')}</td>
          <td><code class="id-small">${esc(item.id)}</code></td>
        </tr>`).join('')}</tbody>
      </table>` : emptyHtml(`No ${flowsTab} match filter`);
  }

  el.innerHTML = pageHeader('Flows / Sources', 'Media flows and sources') + `
    <div class="tab-filter-row">
      <div class="tabs" id="flows-tabs">
        <button class="tab${flowsTab==='flows'?' active':''}" data-tab="flows">Flows (${flows?.length??0})</button>
        <button class="tab${flowsTab==='sources'?' active':''}" data-tab="sources">Sources (${sources?.length??0})</button>
      </div>
      ${filterPills('flows-filter', [
        ['all','All'],['video','Video'],['audio','Audio'],['anc','ANC']
      ], flowsFilter)}
    </div>
    <div id="flows-content">${buildContent()}</div>
  `;

  el.querySelectorAll('#flows-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      flowsTab = btn.dataset.tab;
      el.querySelectorAll('#flows-tabs .tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('flows-content').innerHTML = buildContent();
    });
  });

  el.querySelectorAll('#flows-filter .filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      flowsFilter = btn.dataset.filter;
      el.querySelectorAll('#flows-filter .filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('flows-content').innerHTML = buildContent();
    });
  });

  startRefresh(() => renderFlows(el));
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function renderSettings(el) {
  const isLocal = config.mode === 'local';

  el.innerHTML = pageHeader('Settings',
    isLocal ? 'RDS configuration (editable)' : 'Connected RDS (read-only)') + `
    <div class="settings-form">
      <div class="settings-group">
        <div class="setting-row"><span class="sk">Mode</span>
          <span class="sv">${esc(config.mode)}</span></div>
        ${isLocal ? `
        <div class="setting-row"><span class="sk">Listen Address</span>
          <input id="s-host" class="s-input" value="${esc(config.host_address)}"></div>
        <div class="setting-row"><span class="sk">Registration Port</span>
          <input id="s-reg" class="s-input" type="number" value="${config.registration_port}"></div>
        <div class="setting-row"><span class="sk">Query Port</span>
          <input id="s-qry" class="s-input" type="number" value="${config.query_port}"></div>
        <div class="setting-row"><span class="sk">Domain</span>
          <input id="s-domain" class="s-input" value="${esc(config.domain)}"></div>
        <div class="setting-row"><span class="sk">Priority</span>
          <input id="s-priority" class="s-input" type="number" value="${config.priority}">
          ${config.priority < 100 ? `<span class="warn-text">⚠ Priority below 100</span>` : ''}</div>
        <div class="setting-row"><span class="sk">Logging Level</span>
          <input id="s-log" class="s-input" type="number" value="${config.logging_level}"></div>
        ` : `
        <div class="setting-row"><span class="sk">Remote URL</span>
          <code>${esc(config.remote_url)}</code></div>
        `}
      </div>
      <div class="settings-actions">
        ${isLocal ? `<button class="btn-primary" id="btn-save">Save &amp; Restart</button>` : ''}
        <button class="btn-danger" id="btn-stop-cfg">${isLocal ? 'Stop RDS' : 'Disconnect'}</button>
      </div>
    </div>
  `;

  if (isLocal) {
    el.querySelector('#btn-save')?.addEventListener('click', async () => {
      const newCfg = {
        ...config,
        host_address:      el.querySelector('#s-host')?.value     ?? config.host_address,
        registration_port: parseInt(el.querySelector('#s-reg')?.value)  || config.registration_port,
        query_port:        parseInt(el.querySelector('#s-qry')?.value)  || config.query_port,
        domain:            el.querySelector('#s-domain')?.value   ?? config.domain,
        priority:          parseInt(el.querySelector('#s-priority')?.value) ?? config.priority,
        logging_level:     parseInt(el.querySelector('#s-log')?.value)   ?? config.logging_level,
      };
      await window.api.saveConfig(newCfg);
      await window.api.stopRds();
    });
  }

  el.querySelector('#btn-stop-cfg')?.addEventListener('click', async () => {
    stopRefresh();
    clearInterval(uptimeInterval);
    await window.api.stopRds();
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
