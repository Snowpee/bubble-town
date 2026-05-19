import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bubbleTownDesktop', {
  platform: process.platform,
  versions: process.versions,
  companionUrl: process.env.ELECTRON_COMPANION_URL ?? 'http://127.0.0.1:3030',
  titlebarReserve: '3rem',
  titlebarControlReserve: '5.5rem',
  setNativeThemeSource: (themeSource: 'light' | 'dark' | 'system') =>
    ipcRenderer.invoke('bubble-town:set-native-theme-source', themeSource),
});
