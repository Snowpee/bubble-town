const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('bubbleTownDesktop', {
  platform: process.platform,
  versions: process.versions,
  companionUrl: process.env.ELECTRON_COMPANION_URL ?? 'http://127.0.0.1:3030',
  titlebarReserve: '3rem',
});
