import { app, BrowserWindow, ipcMain, Menu, nativeTheme, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const companionHost = process.env.ELECTRON_COMPANION_HOST ?? '127.0.0.1';
const companionPort = Number(process.env.ELECTRON_COMPANION_PORT ?? 3030);
const macOSTrafficLightPosition = { x: 16, y: 21 };

let companionProcess: UtilityProcess | null = null;
let isAppQuitting = false;

ipcMain.handle('bubble-town:set-native-theme-source', (_event, themeSource: unknown) => {
  if (themeSource !== 'light' && themeSource !== 'dark' && themeSource !== 'system') {
    return false;
  }

  nativeTheme.themeSource = themeSource;

  if (process.platform === 'darwin') {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.setVibrancy('sidebar', { animationDuration: 120 });
    });
  }

  return true;
});

function getCompanionUrl() {
  return `http://${companionHost}:${companionPort}`;
}

function resolveWebIndexPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web-dist', 'index.html');
  }

  return path.join(__dirname, '..', '..', 'web', 'dist', 'index.html');
}

function resolveCompanionEntryPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'companion', 'dist', 'server.js');
  }

  return path.join(__dirname, '..', '..', 'companion', 'dist', 'server.js');
}

async function isCompanionReachable() {
  try {
    const response = await fetch(`${getCompanionUrl()}/api/ping`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCompanionReady(retries = 40, intervalMs = 250) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (await isCompanionReachable()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

async function ensureCompanionServer() {
  const companionUrl = getCompanionUrl();
  process.env.ELECTRON_COMPANION_URL = companionUrl;

  if (await isCompanionReachable()) {
    return;
  }

  const entryPath = resolveCompanionEntryPath();
  if (!fs.existsSync(entryPath)) {
    console.warn(`[bubble-town] Companion bundle is missing: ${entryPath}`);
    return;
  }

  companionProcess = utilityProcess.fork(entryPath, [], {
    env: {
      ...process.env,
      COMPANION_HOST: companionHost,
      COMPANION_PORT: String(companionPort),
    },
  });

  companionProcess.on('exit', (code) => {
    if (!isAppQuitting) {
      console.warn(`[bubble-town] Companion exited with code ${code ?? 'unknown'}.`);
    }
  });

  if (!(await waitForCompanionReady())) {
    throw new Error(`Companion did not become ready at ${companionUrl}.`);
  }
}

function createWindow() {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const isMacOS = process.platform === 'darwin';
  const preloadPath = isDev
    ? path.join(__dirname, 'preload.cjs')
    : path.join(__dirname, '..', 'electron', 'preload.cjs');

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: isMacOS ? '#00000000' : '#09090b',
    ...(isMacOS
      ? {
          transparent: true,
          vibrancy: 'sidebar' as const,
          visualEffectState: 'followWindow' as const,
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    ...(isMacOS ? { trafficLightPosition: macOSTrafficLightPosition } : {}),
  });

  if (isMacOS) {
    mainWindow.setWindowButtonPosition(macOSTrafficLightPosition);
  }

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(resolveWebIndexPath());
  }
}

app.whenReady().then(async () => {
  try {
    await ensureCompanionServer();
  } catch (error) {
    console.error('[bubble-town] Failed to start companion service.', error);
  }

  const menu = Menu.buildFromTemplate([
    { label: 'Bubble Town', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ]);
  Menu.setApplicationMenu(menu);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isAppQuitting = true;
  companionProcess?.kill();
  companionProcess = null;
});
