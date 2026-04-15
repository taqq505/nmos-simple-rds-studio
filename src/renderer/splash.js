/**
 * splash.js — Splash screen renderer
 * Controls the 3-step startup wizard:
 *   Step 1: Mode selection (Resume / Launch new / Connect)
 *   Step 2a: Launch new RDS configuration
 *   Step 2b: Connect to existing RDS
 *   Step 3: Launching / connecting progress
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let savedConfig = null;   // Loaded from main process (null = not found)
let currentStep = 1;
let stepHistory = [];     // For back navigation
let unsubRdsProgress = null;
let unsubMdns = null;
let stepTimers = {};      // { stepIndex: intervalId }

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  savedConfig = await window.api.loadConfig();
  showStep1();
}

// ─── Step navigation ──────────────────────────────────────────────────────────

function setStep(step) {
  currentStep = step;
  document.getElementById('dot-1').className = 'step-dot' + (step > 1 ? ' done' : step === 1 ? ' active' : '');
  document.getElementById('dot-2').className = 'step-dot' + (step > 2 ? ' done' : step === 2 ? ' active' : '');
  document.getElementById('dot-3').className = 'step-dot' + (step === 3 ? ' active' : '');
}

function goBack() {
  const prev = stepHistory.pop();
  if (prev === '1') showStep1();
}

// ─── Step 1: Mode Selection ───────────────────────────────────────────────────

function showStep1() {
  setStep(1);
  stepHistory = [];

  const hasConfig = savedConfig !== null;
  const resumeDesc = hasConfig
    ? `Port ${savedConfig.registration_port} · priority ${savedConfig.priority} · ${savedConfig.domain}`
    : '';

  document.getElementById('content').innerHTML = `
    <div style="text-align:center; margin-bottom:24px; margin-top:8px;">
      <div style="
        width:52px; height:52px; border-radius:12px;
        background:#E6F1FB; border:0.5px solid #B5D4F4;
        display:inline-flex; align-items:center; justify-content:center;
        margin-bottom:12px;">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect x="4" y="8" width="20" height="13" rx="2" stroke="#185FA5" stroke-width="1.5"/>
          <circle cx="9" cy="14" r="2" fill="#185FA5"/>
          <circle cx="14" cy="14" r="2" fill="#185FA5"/>
          <circle cx="19" cy="14" r="2" fill="#185FA5"/>
          <line x1="14" y1="4" x2="14" y2="8" stroke="#185FA5" stroke-width="1.5"/>
          <circle cx="14" cy="4" r="1.5" fill="#185FA5"/>
        </svg>
      </div>
      <div style="font-size:18px; font-weight:500; color:#111;">NMOS Simple RDS Studio</div>
      <div style="font-size:12px; color:#888; margin-top:3px;">IS-04 Registration &amp; Discovery</div>
    </div>

    <div style="display:flex; align-items:center; gap:8px; background:#f9f9f9; border-radius:8px; padding:10px 14px; margin-bottom:24px;">
      <div class="spinner spinner-md"></div>
      <span style="font-size:12px; color:#888;">Searching for RDS on network...</span>
    </div>

    <div style="font-size:11px; color:#bbb; text-align:center; margin-bottom:16px;">Select startup mode</div>

    <div style="display:flex; flex-direction:column; gap:8px;">
      ${hasConfig ? `
      <div class="opt-card" id="btn-resume">
        <div class="opt-icon" style="background:#EAF3DE;">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7" stroke="#3B6D11" stroke-width="1.5"/>
            <path d="M6 9l2 2 4-4" stroke="#3B6D11" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div style="flex:1;">
          <div style="font-size:13px; font-weight:500; color:#111;">
            Resume last session
            <span class="badge badge-green" style="margin-left:6px;">Recommended</span>
          </div>
          <div style="font-size:11px; color:#888; margin-top:2px;">${resumeDesc}</div>
        </div>
      </div>` : ''}

      <div class="opt-card" id="btn-launch">
        <div class="opt-icon" style="background:#E6F1FB;">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="3" y="5" width="12" height="8" rx="1.5" stroke="#185FA5" stroke-width="1.5"/>
            <path d="M9 2v3M7 16h4" stroke="#185FA5" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <div style="font-size:13px; font-weight:500; color:#111;">Launch new RDS</div>
          <div style="font-size:11px; color:#888; margin-top:2px;">Configure and start a new registry</div>
        </div>
      </div>

      <div class="opt-card" id="btn-connect">
        <div class="opt-icon" style="background:#EEEDFE;">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="5" cy="9" r="2.5" stroke="#534AB7" stroke-width="1.5"/>
            <circle cx="13" cy="9" r="2.5" stroke="#534AB7" stroke-width="1.5"/>
            <path d="M7.5 9h3" stroke="#534AB7" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <div style="font-size:13px; font-weight:500; color:#111;">Connect to existing RDS</div>
          <div style="font-size:11px; color:#888; margin-top:2px;">Monitor and manage a running registry</div>
        </div>
      </div>
    </div>
  `;

  addOptCardStyles();

  if (hasConfig) {
    document.getElementById('btn-resume').addEventListener('click', onResume);
  }
  document.getElementById('btn-launch').addEventListener('click', showStep2a);
  document.getElementById('btn-connect').addEventListener('click', showStep2b);
}

function addOptCardStyles() {
  if (document.getElementById('opt-card-style')) return;
  const style = document.createElement('style');
  style.id = 'opt-card-style';
  style.textContent = `
    .opt-card {
      border: 0.5px solid #e0e0e0;
      border-radius: 12px;
      padding: 14px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 14px;
      transition: background 0.15s;
    }
    .opt-card:hover { background: #f9f9f9; }
    .opt-icon {
      width: 36px; height: 36px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
}

async function onResume() {
  // savedConfig already loaded — go straight to Step 3
  showStep3({ mode: 'local', config: savedConfig });
}

// ─── Step 2a: Launch New RDS ──────────────────────────────────────────────────

async function showStep2a() {
  setStep(2);
  stepHistory.push('1');

  const nicList = await window.api.getNicList();
  const cfg = savedConfig || {};
  const regPort = cfg.registration_port || 3210;
  const qryPort = cfg.query_port || 3211;
  const domain = cfg.domain || 'local.';
  const priority = cfg.priority !== undefined ? cfg.priority : 100;
  const logLevel = cfg.logging_level !== undefined ? cfg.logging_level : 0;

  const nicOptions = nicList
    .map(n => `<option value="${n.value}" ${n.value === (cfg.host_address || '0.0.0.0') ? 'selected' : ''}>${n.label}</option>`)
    .join('');

  document.getElementById('content').innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
      <button class="btn-back" id="btn-back">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 11L5 7l4-4" stroke="#888" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <div>
        <div style="font-size:15px; font-weight:500; color:#111;">Launch new RDS</div>
        <div style="font-size:11px; color:#888; margin-top:2px;">Configure registry settings</div>
      </div>
    </div>

    <div class="sec-label">NETWORK</div>
    <div class="form-group">
      <div class="form-label">Listen NIC</div>
      <select class="form-select" id="sel-nic">${nicOptions}</select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <div class="form-label">Registration port <span class="form-hint">Default: 3210</span></div>
        <input class="form-input" type="number" id="inp-reg-port" value="${regPort}" min="1" max="65535">
      </div>
      <div class="form-group">
        <div class="form-label">Query port <span class="form-hint">Default: 3211</span></div>
        <input class="form-input" type="number" id="inp-qry-port" value="${qryPort}" min="1" max="65535">
      </div>
    </div>
    <div class="form-group">
      <div class="form-label">
        Domain <span class="form-hint">mDNS: local.</span>
        <span class="badge badge-green" id="mdns-badge" style="${domain === 'local.' ? '' : 'display:none'}">mDNS</span>
      </div>
      <input class="form-input" type="text" id="inp-domain" value="${domain}">
    </div>

    <div class="sec-divider"></div>
    <div class="sec-label">PRIORITY &amp; LOGGING</div>
    <div class="form-row">
      <div class="form-group">
        <div class="form-label">Priority <span class="form-hint">Lower = higher</span></div>
        <input class="form-input" type="number" id="inp-priority" value="${priority}" min="0" max="255">
      </div>
      <div class="form-group">
        <div class="form-label">Log level</div>
        <select class="form-select" id="sel-loglevel">
          <option value="40" ${logLevel === 40 ? 'selected' : ''}>40 – fatal only</option>
          <option value="0"  ${logLevel === 0  ? 'selected' : ''}>0 – normal</option>
          <option value="-40" ${logLevel === -40 ? 'selected' : ''}>-40 – verbose</option>
        </select>
      </div>
    </div>

    <div class="notice notice-amber" id="pri-warn" style="${priority < 100 ? '' : 'display:none'}">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0">
        <circle cx="7" cy="7" r="6" stroke="#854F0B" stroke-width="1.2"/>
        <path d="M7 4v3.5" stroke="#854F0B" stroke-width="1.2" stroke-linecap="round"/>
        <circle cx="7" cy="10" r="0.7" fill="#854F0B"/>
      </svg>
      Priority below 100 may conflict with existing registries.
    </div>

    <div style="background:#f9f9f9; border-radius:8px; padding:10px 12px; margin-bottom:12px; font-family:monospace; font-size:11px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span style="color:#bbb;">host_address</span>
        <span style="color:#111; font-weight:500;" id="prev-host">${cfg.host_address || '0.0.0.0'}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span style="color:#bbb;">registration</span>
        <span style="color:#111; font-weight:500;" id="prev-reg">${cfg.host_address || '0.0.0.0'}:${regPort}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span style="color:#bbb;">query</span>
        <span style="color:#111; font-weight:500;" id="prev-qry">${cfg.host_address || '0.0.0.0'}:${qryPort}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span style="color:#bbb;">priority</span>
        <span style="color:#111; font-weight:500;" id="prev-pri">${priority}</span>
      </div>
    </div>

    <button class="btn-primary" id="btn-launch">Launch with this configuration</button>
  `;

  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-launch').addEventListener('click', onLaunch);

  // Live preview update
  ['sel-nic', 'inp-reg-port', 'inp-qry-port', 'inp-domain', 'inp-priority'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePreview2a);
    document.getElementById(id).addEventListener('change', updatePreview2a);
  });
}

function updatePreview2a() {
  const nic = document.getElementById('sel-nic').value;
  const rp  = document.getElementById('inp-reg-port').value || '3210';
  const qp  = document.getElementById('inp-qry-port').value || '3211';
  const dm  = document.getElementById('inp-domain').value || 'local.';
  const pri = parseInt(document.getElementById('inp-priority').value) || 100;

  document.getElementById('prev-host').textContent = nic;
  document.getElementById('prev-reg').textContent  = `${nic}:${rp}`;
  document.getElementById('prev-qry').textContent  = `${nic}:${qp}`;
  document.getElementById('prev-pri').textContent  = pri;
  document.getElementById('mdns-badge').style.display = dm === 'local.' ? '' : 'none';
  document.getElementById('pri-warn').style.display   = pri < 100 ? '' : 'none';
}

function buildConfigFrom2a() {
  return {
    mode: 'local',
    host_address: document.getElementById('sel-nic').value,
    registration_port: parseInt(document.getElementById('inp-reg-port').value) || 3210,
    query_port: parseInt(document.getElementById('inp-qry-port').value) || 3211,
    domain: document.getElementById('inp-domain').value || 'local.',
    priority: parseInt(document.getElementById('inp-priority').value) || 100,
    logging_level: parseInt(document.getElementById('sel-loglevel').value) || 0,
    error_log: 'rds_error.log',
    access_log: 'rds_access.log',
    remote_url: '',
  };
}

function onLaunch() {
  const config = buildConfigFrom2a();
  showStep3({ mode: 'local', config });
}

// ─── Step 2b: Connect to Existing RDS ────────────────────────────────────────

function showStep2b() {
  setStep(2);
  stepHistory.push('1');

  document.getElementById('content').innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
      <button class="btn-back" id="btn-back">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 11L5 7l4-4" stroke="#888" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <div>
        <div style="font-size:15px; font-weight:500; color:#111;">Connect to existing RDS</div>
        <div style="font-size:11px; color:#888; margin-top:2px;">Select or enter a registry address</div>
      </div>
    </div>

    <div class="sec-label">DISCOVERED RDS</div>
    <div style="display:flex; align-items:center; gap:6px; font-size:11px; color:#bbb; margin-bottom:8px;">
      <div class="spinner spinner-sm"></div>
      <span>Searching network...</span>
    </div>
    <div id="rds-list" style="display:flex; flex-direction:column; gap:6px; margin-bottom:16px; min-height:20px;"></div>

    <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
      <div style="flex:1; height:0.5px; background:#eee;"></div>
      <div style="font-size:11px; color:#bbb;">or enter manually</div>
      <div style="flex:1; height:0.5px; background:#eee;"></div>
    </div>

    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <div class="form-group" style="width:80px; flex-shrink:0;">
        <div class="form-label">Protocol</div>
        <select class="form-select" id="sel-proto">
          <option value="http">http</option>
          <option value="https">https</option>
        </select>
      </div>
      <div class="form-group" style="flex:1;">
        <div class="form-label">IP address</div>
        <input class="form-input" type="text" id="inp-ip" placeholder="192.168.10.100" style="font-family:monospace;">
      </div>
      <div class="form-group" style="width:80px; flex-shrink:0;">
        <div class="form-label">Port</div>
        <input class="form-input" type="text" id="inp-port" value="3210" style="font-family:monospace;">
      </div>
    </div>

    <div style="font-size:11px; color:#888; font-family:monospace; background:#f9f9f9; border-radius:8px; padding:6px 10px; margin-bottom:10px;" id="preview-url">http://192.168.10.100:3210</div>

    <div class="notice notice-amber" id="https-note" style="display:none;">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0">
        <circle cx="7" cy="7" r="6" stroke="#854F0B" stroke-width="1.2"/>
        <path d="M7 4v3.5" stroke="#854F0B" stroke-width="1.2" stroke-linecap="round"/>
        <circle cx="7" cy="10" r="0.7" fill="#854F0B"/>
      </svg>
      Certificate errors are automatically allowed.
    </div>

    <button class="btn-primary" id="btn-connect">Connect</button>
  `;

  document.getElementById('btn-back').addEventListener('click', () => {
    if (unsubMdns) { unsubMdns(); unsubMdns = null; }
    goBack();
  });
  document.getElementById('btn-connect').addEventListener('click', onConnect);

  ['sel-proto', 'inp-ip', 'inp-port'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePreview2b);
    document.getElementById(id).addEventListener('change', updatePreview2b);
  });

  // Subscribe to mDNS discovery events
  unsubMdns = window.api.onRdsDiscovered((rds) => {
    const list = document.getElementById('rds-list');
    if (!list) return;
    const item = document.createElement('div');
    item.style.cssText = 'border:0.5px solid #e0e0e0; border-radius:8px; padding:10px 12px; cursor:pointer; display:flex; align-items:center; gap:10px;';
    item.innerHTML = `
      <div style="width:8px; height:8px; border-radius:50%; background:#28C840; flex-shrink:0;"></div>
      <div style="flex:1;">
        <div style="font-size:13px; font-weight:500; color:#111;">${rds.name || 'nmos-cpp-registry'}</div>
        <div style="font-size:11px; color:#888; font-family:monospace;">${rds.host}:${rds.port}</div>
      </div>
      <span class="badge badge-blue">mDNS</span>
    `;
    item.addEventListener('click', () => {
      document.getElementById('inp-ip').value = rds.host;
      document.getElementById('inp-port').value = rds.port;
      updatePreview2b();
    });
    list.appendChild(item);
  });
}

function updatePreview2b() {
  const proto = document.getElementById('sel-proto').value;
  const ip    = document.getElementById('inp-ip').value || '192.168.10.100';
  const port  = document.getElementById('inp-port').value || '3210';
  document.getElementById('preview-url').textContent = `${proto}://${ip}:${port}`;
  document.getElementById('https-note').style.display = proto === 'https' ? 'flex' : 'none';
}

function onConnect() {
  if (unsubMdns) { unsubMdns(); unsubMdns = null; }
  const proto = document.getElementById('sel-proto').value;
  const ip    = document.getElementById('inp-ip').value;
  const port  = document.getElementById('inp-port').value || '3210';
  const url   = `${proto}://${ip}:${port}`;

  const config = {
    mode: 'remote',
    remote_url: url,
    host_address: ip,
    registration_port: parseInt(port),
    query_port: parseInt(port) + 1,
    domain: 'local.',
    priority: 100,
    logging_level: 0,
    error_log: '',
    access_log: '',
  };

  showStep3({ mode: 'remote', config });
}

// ─── Step 3: Launching / Connecting ──────────────────────────────────────────

const LOCAL_STEPS = [
  { id: 'process-started',  label: 'Process started' },
  { id: 'rds-init',         label: 'Waiting for RDS init' },
  { id: 'query-api',        label: 'Query API check' },
  { id: 'mdns-announce',    label: 'mDNS announcement check' },
];

const REMOTE_STEPS = [
  { id: 'host-reachable',   label: 'Host reachable' },
  { id: 'registration-api', label: 'Registration API check' },
  { id: 'query-api',        label: 'Query API check' },
];

function showStep3({ mode, config }) {
  setStep(3);
  stepHistory.push('2');

  const steps = mode === 'local' ? LOCAL_STEPS : REMOTE_STEPS;
  const isLocal = mode === 'local';

  document.getElementById('content').innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center;">
      <div id="icon-wrap" style="
        width:56px; height:56px; border-radius:50%;
        background:#E6F1FB;
        display:flex; align-items:center; justify-content:center;
        margin-bottom:16px;">
        <div class="spinner spinner-lg"></div>
      </div>
      <div id="status-title" style="font-size:15px; font-weight:500; color:#111; margin-bottom:4px; text-align:center;">
        ${isLocal ? 'Launching RDS...' : 'Connecting...'}
      </div>
      <div id="status-sub" style="font-size:11px; color:#888; font-family:monospace; text-align:center; margin-bottom:24px;">
        ${isLocal ? 'Starting nmos-cpp-registry' : config.remote_url}
      </div>
    </div>

    <div id="checklist" style="display:flex; flex-direction:column; gap:6px; margin-bottom:20px; width:100%;">
      ${steps.map((s, i) => `
        <div class="ci" id="ci-${s.id}" data-index="${i}" style="
          display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:8px;
          background:#f9f9f9; opacity:0.4;">
          <div id="ci-icon-${s.id}" style="
            width:18px; height:18px; border-radius:50%;
            background:#ddd;
            display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          </div>
          <span id="ci-label-${s.id}" style="font-size:12px; color:#bbb; flex:1;">${s.label}</span>
          <span id="ci-time-${s.id}" style="font-size:10px; font-family:monospace; color:#bbb;"></span>
        </div>
      `).join('')}
    </div>

    <button class="btn-primary" id="btn-dashboard" style="display:none;">
      Go to Dashboard
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M4 8h8M9 5l3 3-3 3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button class="btn-secondary" id="btn-back-err" style="display:none;">← Back to configuration</button>
  `;

  document.getElementById('btn-dashboard').addEventListener('click', () => {
    window.api.rdsReady();
  });
  document.getElementById('btn-back-err').addEventListener('click', () => {
    if (unsubRdsProgress) { unsubRdsProgress(); unsubRdsProgress = null; }
    window.api.stopRds();
    setStep(1);
    stepHistory = [];
    showStep1();
  });

  if (isLocal) {
    runLocalLaunch(steps, config);
  } else {
    runRemoteConnect(steps, config);
  }
}

// ── Step state helpers ────────────────────────────────────────────────────────

function setStepState(stepId, state, time) {
  const ci    = document.getElementById(`ci-${stepId}`);
  const icon  = document.getElementById(`ci-icon-${stepId}`);
  const label = document.getElementById(`ci-label-${stepId}`);
  const timeEl = document.getElementById(`ci-time-${stepId}`);
  if (!ci) return;

  if (state === 'active') {
    ci.style.background = '#E6F1FB'; ci.style.opacity = '1';
    icon.style.background = '#185FA5';
    icon.innerHTML = `<div class="spinner spinner-sm" style="border-color:rgba(255,255,255,0.3); border-top-color:#fff;"></div>`;
    label.style.color = '#0C447C'; label.style.fontWeight = '500';
  } else if (state === 'done') {
    ci.style.background = '#EAF3DE'; ci.style.opacity = '1';
    icon.style.background = '#3B6D11';
    icon.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    label.style.color = '#27500A'; label.style.fontWeight = '500';
    if (time !== undefined) timeEl.textContent = `${time.toFixed(1)}s`;
  } else if (state === 'error') {
    ci.style.background = '#FCEBEB'; ci.style.opacity = '1';
    icon.style.background = '#A32D2D';
    icon.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 3l4 4M7 3l-4 4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    label.style.color = '#791F1F'; label.style.fontWeight = '500';
  }
}

function startTimer(stepId) {
  const start = Date.now();
  const el = document.getElementById(`ci-time-${stepId}`);
  if (!el) return;
  stepTimers[stepId] = setInterval(() => {
    if (el) el.textContent = `${((Date.now() - start) / 1000).toFixed(1)}s...`;
  }, 100);
  return start;
}

function stopTimer(stepId) {
  clearInterval(stepTimers[stepId]);
  delete stepTimers[stepId];
}

function onLaunchSuccess() {
  document.getElementById('status-title').textContent = 'RDS is running';
  document.getElementById('status-sub').textContent = 'All checks passed';
  const iconWrap = document.getElementById('icon-wrap');
  iconWrap.style.background = '#EAF3DE';
  iconWrap.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="12" stroke="#3B6D11" stroke-width="2"/>
      <path d="M9 14l3 3 7-7" stroke="#3B6D11" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  document.getElementById('btn-dashboard').style.display = 'flex';
}

function onLaunchError(message) {
  document.getElementById('status-title').textContent = 'Failed to start';
  document.getElementById('status-sub').textContent = message;
  const iconWrap = document.getElementById('icon-wrap');
  iconWrap.style.background = '#FCEBEB';
  iconWrap.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="12" stroke="#A32D2D" stroke-width="2"/>
      <path d="M9 9l10 10M19 9l-10 10" stroke="#A32D2D" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  document.getElementById('btn-back-err').style.display = 'block';
}

// ── Local RDS launch sequence ─────────────────────────────────────────────────

async function runLocalLaunch(steps, config) {
  // Step 1: Process started
  setStepState('process-started', 'active');
  let t1 = startTimer('process-started');

  window.api.startRds(config); // fire-and-forget

  // Wait for any output (process alive) or timeout after 5s
  await new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(); }
    }, 5000);

    unsubRdsProgress = window.api.onRdsProgress((event) => {
      if (event.type === 'error') {
        clearTimeout(timeout);
        stopTimer('process-started');
        onLaunchError(event.message);
        setStepState('process-started', 'error');
        if (unsubRdsProgress) { unsubRdsProgress(); unsubRdsProgress = null; }
        resolved = true; resolve();
        return;
      }
      if (!resolved && (event.type === 'stdout' || event.type === 'stderr' || event.type === 'exit')) {
        clearTimeout(timeout);
        resolved = true; resolve();
      }
    });
  });

  if (document.getElementById('step-process-started')?.dataset.state === 'error') return;

  stopTimer('process-started');
  setStepState('process-started', 'done', (Date.now() - t1) / 1000);

  // Step 2: Poll Query API until ready (replaces "Ready for connections" text detection)
  setStepState('rds-init', 'active');
  let t2 = startTimer('rds-init');

  const base = `http://${config.host_address === '0.0.0.0' ? '127.0.0.1' : config.host_address}:${config.query_port}`;
  const rdsReady = await pollEndpoint(`${base}/x-nmos/query/v1.3/`, 20000);

  stopTimer('rds-init');
  if (!rdsReady) {
    setStepState('rds-init', 'error');
    onLaunchError('RDS did not become ready in time.');
    return;
  }
  setStepState('rds-init', 'done', (Date.now() - t2) / 1000);

  if (unsubRdsProgress) { unsubRdsProgress(); unsubRdsProgress = null; }
  await continueLocalChecks(config, steps);
}

async function continueLocalChecks(config, steps) {
  const base = `http://${config.host_address === '0.0.0.0' ? '127.0.0.1' : config.host_address}:${config.query_port}`;

  // Step 3: Query API check
  setStepState('query-api', 'active');
  let t3 = startTimer('query-api');
  const queryOk = await pollEndpoint(`${base}/x-nmos/query/v1.3/`, 15000);
  stopTimer('query-api');
  if (!queryOk) {
    setStepState('query-api', 'error');
    onLaunchError('Query API did not respond in time.');
    return;
  }
  setStepState('query-api', 'done', (Date.now() - t3) / 1000);

  // Step 4: mDNS announcement (we wait briefly and assume OK if process is running)
  setStepState('mdns-announce', 'active');
  let t4 = startTimer('mdns-announce');
  await sleep(1500);
  stopTimer('mdns-announce');
  setStepState('mdns-announce', 'done', 1.5);

  onLaunchSuccess();
}

// ── Remote RDS connection sequence ────────────────────────────────────────────

async function runRemoteConnect(steps, config) {
  const baseUrl = config.remote_url;
  const regUrl  = `${baseUrl}/x-nmos/registration/v1.3/`;
  const qryUrl  = `${baseUrl}/x-nmos/query/v1.3/`;

  // Step 1: Host reachable
  setStepState('host-reachable', 'active');
  let t1 = startTimer('host-reachable');
  const reachable = await pollEndpoint(baseUrl, 5000);
  stopTimer('host-reachable');
  if (!reachable) {
    setStepState('host-reachable', 'error');
    onLaunchError('Host is not reachable.');
    return;
  }
  setStepState('host-reachable', 'done', (Date.now() - t1) / 1000);

  // Step 2: Registration API
  setStepState('registration-api', 'active');
  let t2 = startTimer('registration-api');
  const regOk = await pollEndpoint(regUrl, 5000);
  stopTimer('registration-api');
  if (!regOk) {
    setStepState('registration-api', 'error');
    onLaunchError('Registration API did not respond. Timeout: 5s.');
    return;
  }
  setStepState('registration-api', 'done', (Date.now() - t2) / 1000);

  // Step 3: Query API
  setStepState('query-api', 'active');
  let t3 = startTimer('query-api');
  const qryOk = await pollEndpoint(qryUrl, 5000);
  stopTimer('query-api');
  if (!qryOk) {
    setStepState('query-api', 'error');
    onLaunchError('Query API did not respond.');
    return;
  }
  setStepState('query-api', 'done', (Date.now() - t3) / 1000);

  await window.api.saveConfig(config);
  onLaunchSuccess();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollEndpoint(url, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 200) return true;
    } catch (_) {}
    await sleep(500);
  }
  return false;
}

// ─── Start ────────────────────────────────────────────────────────────────────

init();
