/**
 * 预加载脚本：只暴露最小必要能力，不暴露 Node API
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studymate', {
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
});
