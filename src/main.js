const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { Bonjour } = require('bonjour-service');

// ─── Config ───────────────────────────────────────────────────────────────────

// Computed lazily after app is ready (app.getPath requires app to be initialized)
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

const DEFAULT_CONFIG = {
  mode: 'local',
  remote_url: '',
  host_address: '0.0.0.0',
  registration_port: 3210,
  query_port: 3211,
  domain: 'local.',
  priority: 100,
  logging_level: 0,
  error_log: 'rds_error.log',
  access_log: 'rds_access.log',
  update_mode: 'websocket',
  poll_interval: 5,
};

function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Failed to load config.json:', e);
  }
  return null;
}

function saveConfig(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

// ─── nmos-cpp-registry binary path ───────────────────────────────────────────

function getBinaryPath() {
  const platform = process.platform; // 'win32', 'darwin', 'linux'
  const arch = process.arch;         // 'x64', 'arm64'

  const osDir = platform === 'win32' ? 'win'
              : platform === 'darwin' ? 'mac'
              : 'linux';

  const binaryName = platform === 'win32' ? 'nmos-cpp-registry.exe' : 'nmos-cpp-registry';

  // In production (packaged), extraResources are placed in process.resourcesPath/bin/
  // In development, use bin/{os}/{arch}/
  const isDev = !app.isPackaged;
  const basePath = isDev
    ? path.join(__dirname, '..', 'bin', osDir, arch)
    : path.join(process.resourcesPath, 'bin');

  return path.join(basePath, binaryName);
}

// ─── Quit confirmation ────────────────────────────────────────────────────────

async function confirmQuit(win) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Quit',
    message: 'Are you sure you want to quit?',
    detail: rdsProcess ? 'The RDS process will also be stopped.' : '',
  });

  if (response === 0) {
    stopRds();
    win.destroy();
    app.quit();
  }
}

// ─── RDS Log File Tail ────────────────────────────────────────────────────────

const rdsLogBuffer = [];
const MAX_LOG_LINES = 2000;
let logFileTailer  = null;
let errorLogPath   = null;

function getErrorLogPath() {
  return path.join(app.getPath('userData'), 'rds_error.log');
}

function startLogFileTail() {
  if (logFileTailer) { clearInterval(logFileTailer); logFileTailer = null; }
  let fileOffset = 0;

  // ファイルが作られるまで少し待ってから開始
  logFileTailer = setInterval(() => {
    try {
      const stat = fs.statSync(errorLogPath);
      if (stat.size <= fileOffset) return;
      const fd  = fs.openSync(errorLogPath, 'r');
      const buf = Buffer.alloc(stat.size - fileOffset);
      fs.readSync(fd, buf, 0, buf.length, fileOffset);
      fs.closeSync(fd);
      fileOffset = stat.size;

      const lines = buf.toString('utf-8').split(/\r?\n/).filter(l => l.trim());
      for (const line of lines) {
        const entry = { text: line };
        rdsLogBuffer.push(entry);
        if (rdsLogBuffer.length > MAX_LOG_LINES) rdsLogBuffer.shift();
        if (dashboardWindow) {
          dashboardWindow.webContents.send('log:line', entry);
        }
      }
    } catch { /* ファイル未作成は無視 */ }
  }, 500);
}

function stopLogFileTail() {
  if (logFileTailer) { clearInterval(logFileTailer); logFileTailer = null; }
}

// ─── mDNS Browse ─────────────────────────────────────────────────────────────

let mdnsBrowser = null;
let bonjour = null;

function startMdnsBrowse() {
  stopMdnsBrowse();
  bonjour = new Bonjour();
  mdnsBrowser = bonjour.find({ type: 'nmos-registration' }, (service) => {
    if (splashWindow) {
      splashWindow.webContents.send('mdns:discovered', {
        name: service.name,
        host: service.referer?.address || service.host,
        port: service.port,
      });
    }
  });
}

function stopMdnsBrowse() {
  if (mdnsBrowser) { mdnsBrowser.stop(); mdnsBrowser = null; }
  if (bonjour) { bonjour.destroy(); bonjour = null; }
}

// ─── Windows ──────────────────────────────────────────────────────────────────

let splashWindow = null;
let dashboardWindow = null;
let rdsProcess = null;

const ICON_PATH = path.join(__dirname, 'assets',
  process.platform === 'win32' ? 'icon.ico' :
  process.platform === 'darwin' ? 'icon.icns' : 'icon.png'
);

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    title: 'NMOS Simple RDS Studio',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'renderer', 'splash.html'));

  splashWindow.on('close', (e) => {
    e.preventDefault();
    confirmQuit(splashWindow);
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createDashboardWindow() {
  dashboardWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'NMOS Simple RDS Studio',
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dashboardWindow.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));

  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow.show();
    if (splashWindow) {
      // スプラッシュはcloseイベントをキャンセルするので、destroyで強制終了
      splashWindow.destroy();
    }
  });

  dashboardWindow.on('close', (e) => {
    e.preventDefault();
    confirmQuit(dashboardWindow);
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
}

// ─── RDS process management ───────────────────────────────────────────────────

function startRds(config, onProgress) {
  const binaryPath = getBinaryPath();

  if (!fs.existsSync(binaryPath)) {
    onProgress({ type: 'error', message: `Binary not found: ${binaryPath}` });
    return;
  }

  // 新しい起動のたびにバッファとログファイルをリセット
  rdsLogBuffer.length = 0;
  errorLogPath = getErrorLogPath();
  try { fs.unlinkSync(errorLogPath); } catch { /* 存在しなければ無視 */ }

  const args = buildRdsArgs(config);
  console.log('[RDS] binary:', binaryPath);
  console.log('[RDS] args:', args);
  rdsProcess = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('[RDS] spawned pid:', rdsProcess.pid);

  // stdout/stderr はスプラッシュ画面の起動確認にのみ使用
  rdsProcess.stdout.on('data', (data) => {
    onProgress({ type: 'stdout', message: data.toString() });
  });
  rdsProcess.stderr.on('data', (data) => {
    onProgress({ type: 'stderr', message: data.toString() });
  });

  // ダッシュボード用ログはファイルtailで取得
  startLogFileTail();

  rdsProcess.on('error', (err) => {
    console.log('[RDS error]', err.message);
    onProgress({ type: 'error', message: err.message });
  });

  rdsProcess.on('exit', (code) => {
    console.log('[RDS exit]', code);
    onProgress({ type: 'exit', code });
    rdsProcess = null;
  });
}

function stopRds() {
  stopLogFileTail();
  if (rdsProcess) {
    rdsProcess.kill();
    rdsProcess = null;
  }
}

function buildRdsArgs(config) {
  // nmos-cpp-registry accepts a JSON settings file or command-line args.
  // We write a temporary settings JSON and pass it as an argument.
  const settings = {
    host_address: config.host_address,
    registration_port: config.registration_port,
    query_port: config.query_port,
    domain: config.domain,
    priority: config.priority,
    logging_level: config.logging_level,
  };

  // ログファイルは必ず userData 以下の絶対パスに書き込む
  settings.error_log  = getErrorLogPath();
  settings.access_log = path.join(app.getPath('userData'), 'rds_access.log');

  const tmpSettingsPath = path.join(app.getPath('temp'), 'nmos-rds-settings.json');
  fs.writeFileSync(tmpSettingsPath, JSON.stringify(settings, null, 2));

  return [tmpSettingsPath];
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('config:load', () => loadConfig());
ipcMain.handle('config:save', (_e, config) => {
  saveConfig(config);
  return true;
});

ipcMain.handle('app:getNicList', () => {
  const interfaces = os.networkInterfaces();
  const result = [{ label: 'All interfaces', value: '0.0.0.0' }];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ label: `${name} (${addr.address})`, value: addr.address });
      }
    }
  }
  return result;
});

ipcMain.handle('rds:start', (_e, config) => {
  saveConfig(config);
  startRds(config, (event) => {
    const win = splashWindow || dashboardWindow;
    if (win) {
      win.webContents.send('rds:progress', event);
    }
  });
  return { success: true };
});

ipcMain.handle('rds:stop', () => {
  stopRds();
  return true;
});

ipcMain.handle('rds:ready', () => {
  // Called by renderer when Step 3 checks pass — open dashboard
  createDashboardWindow();
  return true;
});

ipcMain.handle('app:openDashboard', () => {
  createDashboardWindow();
  return true;
});

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('mdns:startBrowse', () => { startMdnsBrowse(); return true; });
ipcMain.handle('mdns:stopBrowse',  () => { stopMdnsBrowse();  return true; });

ipcMain.handle('app:checkBonjour', () => {
  if (process.platform !== 'win32') return true;
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('sc query "Bonjour Service"', (err, stdout) => {
      resolve(!err && stdout.includes('RUNNING'));
    });
  });
});
ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));


ipcMain.handle('log:getBuffer', () => [...rdsLogBuffer]);
ipcMain.handle('log:getLogPaths', () => ({
  error:  path.join(app.getPath('userData'), 'rds_error.log'),
  access: path.join(app.getPath('userData'), 'rds_access.log'),
}));
ipcMain.handle('log:saveAs', async (_e, srcPath) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: path.basename(srcPath),
    filters: [{ name: 'Log files', extensions: ['log', 'txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.copyFileSync(srcPath, filePath);
  return { ok: true };
});

/**
 * Proxy HTTP request via Node.js to bypass renderer CORS restrictions.
 * @param {string} url
 * @param {object} [opts] - { method, headers, body, readBody }
 * @returns {{ ok: boolean, status: number, text: string }}
 */
ipcMain.handle('app:fetch', (_e, url, opts = {}) => {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const { method = 'GET', headers = {}, body = null, readBody = false } = opts;

    const bodyBuf = body ? Buffer.from(body, 'utf-8') : null;
    const reqHeaders = { ...headers };
    if (bodyBuf) {
      reqHeaders['Content-Length'] = bodyBuf.length;
    }

    const parsedUrl = new URL(url);
    const reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: reqHeaders,
      timeout: 4000,
      rejectUnauthorized: false,
    };

    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = readBody ? Buffer.concat(chunks).toString('utf-8') : '';
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, text });
      });
    });

    req.on('error', () => resolve({ ok: false, status: 0, text: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, text: '' }); });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
});

ipcMain.handle('app:restart', () => {
  stopRds();
  createSplashWindow();
  if (dashboardWindow) {
    dashboardWindow.destroy();
  }
  return true;
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createSplashWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopRds();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
