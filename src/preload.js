const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose a safe, typed API to the renderer process via window.api
 * All communication goes through IPC — nodeIntegration is off.
 */
contextBridge.exposeInMainWorld('api', {
  // ─── Config ─────────────────────────────────────────────────────────────────
  /** @returns {Promise<object|null>} Saved config, or null if not found */
  loadConfig: () => ipcRenderer.invoke('config:load'),

  /** @param {object} config */
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),

  // ─── System ─────────────────────────────────────────────────────────────────
  /** @returns {Promise<Array<{label: string, value: string}>>} */
  getNicList: () => ipcRenderer.invoke('app:getNicList'),

  /** @returns {Promise<string>} App version string */
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  /** @returns {Promise<boolean>} true if Bonjour service is running */
  checkBonjour: () => ipcRenderer.invoke('app:checkBonjour'),

  /** Start mDNS browse for _nmos-registration._tcp */
  startMdnsBrowse: () => ipcRenderer.invoke('mdns:startBrowse'),
  /** Stop mDNS browse */
  stopMdnsBrowse: () => ipcRenderer.invoke('mdns:stopBrowse'),

  // ─── RDS process ────────────────────────────────────────────────────────────
  /** Start nmos-cpp-registry with given config */
  startRds: (config) => ipcRenderer.invoke('rds:start', config),

  /** Stop nmos-cpp-registry process */
  stopRds: () => ipcRenderer.invoke('rds:stop'),

  /** Stop RDS and return to splash screen */
  restart: () => ipcRenderer.invoke('app:restart'),

  /** Notify main process that RDS checks passed — triggers dashboard open */
  rdsReady: () => ipcRenderer.invoke('rds:ready'),

  /** Navigate to dashboard (remote mode) */
  openDashboard: () => ipcRenderer.invoke('app:openDashboard'),

  /** Open URL in the system default browser */
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  /**
   * HTTP request via main process (bypasses renderer CORS restrictions).
   * @param {string} url
   * @param {{ method?: string, headers?: object, body?: string, readBody?: boolean }} [opts]
   * @returns {Promise<{ok: boolean, status: number, text: string}>}
   */
  fetch: (url, opts) => ipcRenderer.invoke('app:fetch', url, opts),

  // ─── Events from main process ────────────────────────────────────────────────
  /**
   * Subscribe to RDS launch progress events.
   * @param {function({type: string, message: string}): void} callback
   * @returns {function} Unsubscribe function
   */
  onRdsProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('rds:progress', handler);
    return () => ipcRenderer.removeListener('rds:progress', handler);
  },

  /**
   * Subscribe to mDNS discovered RDS events.
   * @param {function({name: string, host: string, port: number}): void} callback
   * @returns {function} Unsubscribe function
   */
  onRdsDiscovered: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mdns:discovered', handler);
    return () => ipcRenderer.removeListener('mdns:discovered', handler);
  },

  // ─── Local RDS log stream ────────────────────────────────────────────────────
  /** Get current buffered log lines from RDS process stdout/stderr */
  getLogBuffer: () => ipcRenderer.invoke('log:getBuffer'),

/** Get full paths of error/access log files */
  getLogPaths: () => ipcRenderer.invoke('log:getLogPaths'),

  /** Open Save As dialog and copy log file to chosen location */
  saveLogAs: (srcPath) => ipcRenderer.invoke('log:saveAs', srcPath),

  /**
   * Subscribe to live log lines from the RDS process.
   * @param {function({ts: number, source: string, text: string}): void} callback
   * @returns {function} Unsubscribe function
   */
  onLogLine: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('log:line', handler);
    return () => ipcRenderer.removeListener('log:line', handler);
  },
});
