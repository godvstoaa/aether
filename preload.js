const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Profiles
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  saveProfile: (p) => ipcRenderer.invoke('save-profile', p),
  saveProfiles: (profiles) => ipcRenderer.invoke('save-profiles', profiles),
  deleteProfile: (id) => ipcRenderer.invoke('delete-profile', id),

  // Launch / lifecycle
  launchProfile: (profile) => ipcRenderer.invoke('launch-profile', profile),
  stopProfile: (id) => ipcRenderer.invoke('stop-profile', id),
  getRunning: () => ipcRenderer.invoke('get-running'),
  onRunningChanged: (cb) => ipcRenderer.on('running-changed', (_e, list) => cb(list)),

  // Proxy
  testProxy: (str) => ipcRenderer.invoke('test-proxy', str),

  // Misc
  getChromePath: () => ipcRenderer.invoke('get-chrome-path'),
  getApiInfo: () => ipcRenderer.invoke('get-api-info'),
  openProfilesFolder: () => ipcRenderer.invoke('open-profiles-folder'),
  getResearchInfo: () => ipcRenderer.invoke('get-research-info'),

  // Sync / cloud
  getSyncConfig: () => ipcRenderer.invoke('get-sync-config'),
  saveSyncConfig: (cfg) => ipcRenderer.invoke('save-sync-config', cfg),
  syncLogin: (creds) => ipcRenderer.invoke('sync-login', creds),
  syncPull: () => ipcRenderer.invoke('sync-pull'),
  syncPushProfile: (p) => ipcRenderer.invoke('sync-push-profile', p),
  syncCheckout: (args) => ipcRenderer.invoke('sync-checkout', args),
  syncCheckin: (args) => ipcRenderer.invoke('sync-checkin', args),
  syncBackupCloudProfile: (profileId, masterPass) => ipcRenderer.invoke('sync-backup-cloud-profile', { profileId, masterPass }),
  syncRestoreCloudProfile: (profileId, masterPass) => ipcRenderer.invoke('sync-restore-cloud-profile', { profileId, masterPass })
};

contextBridge.exposeInMainWorld('Aether', api);
contextBridge.exposeInMainWorld('genlogin', api); // backward-compat alias
