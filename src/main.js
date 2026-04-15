const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

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

  const args = buildRdsArgs(config);
  rdsProcess = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  rdsProcess.stdout.on('data', (data) => {
    const text = data.toString();
    onProgress({ type: 'stdout', message: text });
  });

  rdsProcess.stderr.on('data', (data) => {
    const text = data.toString();
    onProgress({ type: 'stderr', message: text });
  });

  rdsProcess.on('error', (err) => {
    onProgress({ type: 'error', message: err.message });
  });

  rdsProcess.on('exit', (code) => {
    onProgress({ type: 'exit', code });
    rdsProcess = null;
  });
}

function stopRds() {
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

  if (config.error_log) settings.error_log = config.error_log;
  if (config.access_log) settings.access_log = config.access_log;

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

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
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
