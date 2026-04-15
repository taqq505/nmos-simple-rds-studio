/**
 * dashboard.js — Dashboard renderer (placeholder)
 * Full page implementations will be added per-page in subsequent steps.
 */

'use strict';

let config = null;
let uptimeStart = Date.now();
let uptimeInterval = null;

async function init() {
  config = await window.api.loadConfig();
  if (!config) return;

  updateStatusBar();
  startUptimeClock();
  setupNav();
  setupStopButton();
  navigateTo('overview');
}

function updateStatusBar() {
  const isLocal = config.mode === 'local';
  const url = isLocal
    ? `http://127.0.0.1:${config.registration_port}`
    : config.remote_url;

  document.getElementById('tb-url').textContent = url;
  document.getElementById('sb-status').textContent = isLocal ? 'nmos-cpp-registry running' : `Connected: ${config.remote_url}`;
  document.getElementById('sb-mdns').textContent = `mDNS: _nmos-registration._tcp.${config.domain}`;
  document.getElementById('sb-priority').textContent = `priority: ${config.priority}`;
  document.getElementById('btn-stop').textContent = isLocal ? 'Stop RDS' : 'Disconnect';
}

function startUptimeClock() {
  uptimeStart = Date.now();
  uptimeInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - uptimeStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('sb-uptime').textContent = `Uptime: ${h}:${m}:${s}`;
  }, 1000);
}

function setupNav() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
    });
  });
}

function setupStopButton() {
  document.getElementById('btn-stop').addEventListener('click', async () => {
    clearInterval(uptimeInterval);
    await window.api.stopRds();
    // Return to splash — main process will handle window management
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });
  renderPage(page);
}

function renderPage(page) {
  const main = document.getElementById('main-content');

  // Placeholder — each page will be implemented in subsequent steps
  const pages = {
    overview:  renderOverview,
    log:       renderLog,
    nodes:     renderNodes,
    senders:   renderSenders,
    receivers: renderReceivers,
    flows:     renderFlows,
    settings:  renderSettings,
  };

  const render = pages[page];
  if (render) {
    render(main);
  } else {
    main.innerHTML = `<div style="color:#bbb;">Page not found: ${page}</div>`;
  }
}

// ── Page stubs (to be implemented per-page) ───────────────────────────────────

function renderOverview(el) {
  el.innerHTML = `
    <div style="font-size:20px; font-weight:500; color:#111; margin-bottom:4px;">Overview</div>
    <div style="font-size:12px; color:#888; margin-bottom:24px;">Real-time RDS status</div>
    <div style="color:#bbb; font-size:13px; padding:40px; text-align:center; border:0.5px dashed #e0e0e0; border-radius:12px;">
      Overview page — coming soon
    </div>
  `;
}

function renderLog(el) {
  el.innerHTML = `
    <div style="font-size:20px; font-weight:500; color:#111; margin-bottom:24px;">Log</div>
    <div style="color:#bbb; font-size:13px; padding:40px; text-align:center; border:0.5px dashed #e0e0e0; border-radius:12px;">
      Log page — coming soon
    </div>
  `;
}

function renderNodes(el) {
  el.innerHTML = `
    <div style="font-size:20px; font-weight:500; color:#111; margin-bottom:24px;">Nodes</div>
    <div style="color:#bbb; font-size:13px; padding:40px; text-align:center; border:0.5px dashed #e0e0e0; border-radius:12px;">
      Nodes page — coming soon
    </div>
  `;
}

function renderSenders(el) {
  el.innerHTML = `
    <div style="font-size:20px; font-weight:500; color:#111; margin-bottom:24px;">Senders</div>
    <div style="color:#bbb; font-size:13px; padding:40px; text-align:center; border:0.5px dashed #e0e0e0; border-radius:12px;">
      Senders page — coming soon
    </div>
  `;
}

function renderReceivers(el) {
  el.innerHTML = `
    <div style="font-size:20px; font-weight:500; color:#111; margin-bottom:24px;">Receivers</div>
    <div style="color:#bbb; font-size:13px; padding:40px; text-align:center; border:0.5px dashed #e0e0e0; border-radius:12px;">
      Receivers page — coming soon
    </div>
  `;
}

function renderFlows(el) {
  el.innerHTML = `
    <div style="font-size:20px; font-weight:500; color:#111; margin-bottom:24px;">Flows / Sources</div>
    <div style="color:#bbb; font-size:13px; padding:40px; text-align:center; border:0.5px dashed #e0e0e0; border-radius:12px;">
      Flows / Sources page — coming soon
    </div>
  `;
}

function renderSettings(el) {
  el.innerHTML = `
    <div style="font-size:20px; font-weight:500; color:#111; margin-bottom:24px;">Settings</div>
    <div style="color:#bbb; font-size:13px; padding:40px; text-align:center; border:0.5px dashed #e0e0e0; border-radius:12px;">
      Settings page — coming soon
    </div>
  `;
}

// ─── Start ────────────────────────────────────────────────────────────────────

init();
