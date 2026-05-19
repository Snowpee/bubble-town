import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const companionHost = process.env.ELECTRON_COMPANION_HOST ?? '127.0.0.1';
const companionPort = Number(process.env.ELECTRON_COMPANION_PORT ?? 3030);
const macOSTrafficLightPosition = { x: 16, y: 21 };

let companionProcess: ChildProcess | null = null;
let isAppQuitting = false;

function getDesktopLogPath() {
  try {
    return path.join(app.getPath('logs'), 'main.log');
  } catch {
    return path.join(getHermesRoot(), 'logs', 'bubble-town-desktop-main.log');
  }
}

function formatLogPayload(payload: unknown) {
  if (payload === undefined) {
    return '';
  }

  if (payload instanceof Error) {
    return ` ${JSON.stringify({ message: payload.message, stack: payload.stack })}`;
  }

  if (typeof payload === 'string') {
    return ` ${payload}`;
  }

  try {
    return ` ${JSON.stringify(payload)}`;
  } catch {
    return ` ${String(payload)}`;
  }
}

function writeMainLog(level: 'info' | 'warn' | 'error', message: string, payload?: unknown) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${formatLogPayload(payload)}\n`;

  try {
    const logPath = getDesktopLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {
    // File logging is diagnostic only; never block app startup on it.
  }

  const consoleMessage = `${message}${formatLogPayload(payload)}`;
  if (level === 'error') {
    console.error(consoleMessage);
  } else if (level === 'warn') {
    console.warn(consoleMessage);
  } else {
    console.log(consoleMessage);
  }
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  return error;
}

process.on('uncaughtException', (error) => {
  writeMainLog('error', '[bubble-town] Uncaught exception.', describeError(error));
});

process.on('unhandledRejection', (reason) => {
  writeMainLog('error', '[bubble-town] Unhandled rejection.', describeError(reason));
});

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

function getHermesRoot() {
  return process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
}

function getCompanionLockPath() {
  return path.join(getHermesRoot(), 'bubble-town-companion.lock.json');
}

function clearUnreachableCompanionLock() {
  const lockPath = getCompanionLockPath();
  if (!fs.existsSync(lockPath)) {
    writeMainLog('info', '[bubble-town] No companion lock found.', { lockPath });
    return;
  }

  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
      host?: string;
      port?: number;
      pid?: number;
    };
    if (lock.host === companionHost && lock.port === companionPort) {
      fs.unlinkSync(lockPath);
      writeMainLog('warn', '[bubble-town] Removed unreachable companion lock.', {
        lockPath,
        pid: lock.pid,
        host: lock.host,
        port: lock.port,
      });
    } else {
      writeMainLog('info', '[bubble-town] Companion lock points elsewhere; keeping it.', {
        lockPath,
        lock,
        expectedHost: companionHost,
        expectedPort: companionPort,
      });
    }
  } catch (error) {
    writeMainLog('warn', '[bubble-town] Failed to inspect companion lock.', describeError(error));
  }
}

function resolveWebIndexPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web-dist', 'index.html');
  }

  return path.join(__dirname, '..', '..', 'web', 'dist', 'index.html');
}

function resolveCompanionEntryPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'companion', 'dist', 'server.cjs');
  }

  return path.join(__dirname, '..', '..', 'companion', 'dist', 'server.cjs');
}

async function isCompanionReachable() {
  try {
    const response = await fetch(`${getCompanionUrl()}/api/ping`);
    writeMainLog('info', '[bubble-town] Companion ping completed.', {
      url: `${getCompanionUrl()}/api/ping`,
      ok: response.ok,
      status: response.status,
    });
    return response.ok;
  } catch (error) {
    writeMainLog('warn', '[bubble-town] Companion ping failed.', {
      url: `${getCompanionUrl()}/api/ping`,
      error: describeError(error),
    });
    return false;
  }
}

async function waitForCompanionReady(retries = 40, intervalMs = 250) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    writeMainLog('info', '[bubble-town] Waiting for companion readiness.', {
      attempt: attempt + 1,
      retries,
      companionUrl: getCompanionUrl(),
    });

    if (await isCompanionReachable()) {
      writeMainLog('info', '[bubble-town] Companion is ready.', {
        attempt: attempt + 1,
        companionUrl: getCompanionUrl(),
      });
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

async function ensureCompanionServer() {
  const companionUrl = getCompanionUrl();
  process.env.ELECTRON_COMPANION_URL = companionUrl;

  writeMainLog('info', '[bubble-town] Ensuring companion server.', {
    companionUrl,
    appIsPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    electronExecPath: process.execPath,
    appPath: app.getAppPath(),
    hermesRoot: getHermesRoot(),
    logPath: getDesktopLogPath(),
  });

  if (await isCompanionReachable()) {
    writeMainLog('info', '[bubble-town] Existing companion is reachable; reusing it.', { companionUrl });
    return;
  }

  clearUnreachableCompanionLock();

  const entryPath = resolveCompanionEntryPath();
  if (!fs.existsSync(entryPath)) {
    writeMainLog('warn', '[bubble-town] Companion bundle is missing.', { entryPath });
    return;
  }

  writeMainLog('info', '[bubble-town] Spawning companion.', {
    execPath: process.execPath,
    entryPath,
    host: companionHost,
    port: companionPort,
  });

  const child = spawn(process.execPath, [entryPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      COMPANION_HOST: companionHost,
      COMPANION_PORT: String(companionPort),
    },
  });
  companionProcess = child;

  child.stdout?.on('data', (chunk: Buffer) => {
    writeMainLog('info', '[bubble-town companion stdout]', chunk.toString().trimEnd());
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    writeMainLog('error', '[bubble-town companion stderr]', chunk.toString().trimEnd());
  });
  child.on('spawn', () => {
    writeMainLog('info', '[bubble-town] Companion spawned.', { pid: child.pid });
  });
  child.on('error', (error) => {
    writeMainLog('error', '[bubble-town] Companion process error.', describeError(error));
  });
  child.on('exit', (code, signal) => {
    if (!isAppQuitting) {
      writeMainLog('warn', '[bubble-town] Companion exited.', { code, signal });
    }
  });

  if (!(await waitForCompanionReady())) {
    writeMainLog('error', '[bubble-town] Companion did not become ready.', {
      companionUrl,
      childPid: child.pid,
      childExitCode: child.exitCode,
      childKilled: child.killed,
    });
    throw new Error(`Companion did not become ready at ${companionUrl}.`);
  }
}

function createWindow() {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const isMacOS = process.platform === 'darwin';
  const preloadPath = isDev
    ? path.join(__dirname, 'preload.cjs')
    : path.join(__dirname, '..', 'electron', 'preload.cjs');
  const webIndexPath = resolveWebIndexPath();

  writeMainLog('info', '[bubble-town] Creating browser window.', {
    isDev,
    isMacOS,
    preloadPath,
    webIndexPath,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  });

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
    void mainWindow.loadFile(webIndexPath);
  }
}

app.whenReady().then(async () => {
  writeMainLog('info', '[bubble-town] App ready.', {
    version: app.getVersion(),
    name: app.getName(),
    isPackaged: app.isPackaged,
    userData: app.getPath('userData'),
    logs: app.getPath('logs'),
  });

  try {
    await ensureCompanionServer();
  } catch (error) {
    writeMainLog('error', '[bubble-town] Failed to start companion service.', describeError(error));
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
  writeMainLog('info', '[bubble-town] App before-quit; stopping companion.', {
    companionPid: companionProcess?.pid,
  });
  companionProcess?.kill();
  companionProcess = null;
});
