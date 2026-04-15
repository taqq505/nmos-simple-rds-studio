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

  // ─── RDS process ────────────────────────────────────────────────────────────
  /** Start nmos-cpp-registry with given config */
  startRds: (config) => ipcRenderer.invoke('rds:start', config),

  /** Stop nmos-cpp-registry process */
  stopRds: () => ipcRenderer.invoke('rds:stop'),

  /** Notify main process that RDS checks passed — triggers dashboard open */
  rdsReady: () => ipcRenderer.invoke('rds:ready'),

  /** Navigate to dashboard (remote mode) */
  openDashboard: () => ipcRenderer.invoke('app:openDashboard'),

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
});
