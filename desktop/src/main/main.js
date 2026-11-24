"use strict";

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require("electron");

const settingsStore = require("./settings");
const capture = require("./capture");

const ROOT_DIR = path.resolve(__dirname, "../..");
const PRELOAD_PATH = path.join(__dirname, "../preload/preload.js");
const LAUNCHER_HTML_PATH = path.join(__dirname, "../renderer/launcher/launcher.html");
const OVERLAY_HTML_PATH = path.join(__dirname, "../renderer/overlay/overlay.html");
const EDITOR_HTML_PATH = path.join(__dirname, "../renderer/editor/editor.html");
const GOST_HTML_PATH = path.join(ROOT_DIR, "src", "renderer", "gost", "gost.html");
const TRAY_ICON_PATH = path.join(__dirname, "../../assets/icon-32.png");
const APP_ICON_PATH = path.join(__dirname, "../../assets/icon-128.png");

const GOST_SIZE = 64;
const MAX_PENDING_CAPTURES = 10;
const HIDE_LAUNCHER_SETTLE_MS = 180;
const isSmokeTest = process.argv.includes("--smoke-test");
const isHiddenAutoStartArg = process.argv.includes("--hidden");

function isAutoStartSupported() {
  return process.platform === "win32" || process.platform === "darwin";
}

function syncLoginItemSetting(enabled) {
  if (isSmokeTest || !app.isPackaged || !isAutoStartSupported()) {
    return;
  }
  try {
    if (process.platform === "win32") {
      const launchExecPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        path: launchExecPath,
        args: ["--hidden"],
      });
    } else if (process.platform === "darwin") {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        openAsHidden: true,
      });
    }
  } catch {
    // Ignore OS policy restrictions on startup items
  }
}

const pendingCaptures = new Map();
const editorWindows = new Set();

let launcherWin = null;
let overlayWin = null;
let gostWin = null;
let gostDragAnchor = null;
let tray = null;
let isQuitting = false;
let smokeTestDone = false;
let captureInProgress = false;
let activeOverlaySession = null;
let currentSettings = settingsStore.sanitizeSettings(null, settingsStore.DEFAULT_SETTINGS);

const defaultShortcuts = settingsStore.getDefaultShortcuts();
const shortcutStatus = {
  region: { accelerator: defaultShortcuts.region, registered: false },
  screen: { accelerator: defaultShortcuts.screen, registered: false },
  window: { accelerator: defaultShortcuts.window, registered: false },
  winShiftS: {
    accelerator: "Super+Shift+S",
    registered: false,
    enabled: true,
  },
};

function getShortcutsPayload() {
  return {
    region: shortcutStatus.region.accelerator,
    screen: shortcutStatus.screen.accelerator,
    window: shortcutStatus.window.accelerator,
    status: {
      region: { ...shortcutStatus.region },
      screen: { ...shortcutStatus.screen },
      window: { ...shortcutStatus.window },
      winShiftS: { ...shortcutStatus.winShiftS },
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAppIconPath() {
  return fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined;
}

function createSecureWebPreferences() {
  return {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

function hardenWindowNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith("file://")) {
      event.preventDefault();
    }
  });
}

function toNodeBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }
  if (ArrayBuffer.isView(bytes)) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(bytes);
  }
  if (Array.isArray(bytes)) {
    return Buffer.from(bytes);
  }
  throw new Error("Dados binários inválidos.");
}

function storePendingCapture({ mode, title, dpr, nativeImg }) {
  const pngBuffer = nativeImg.toPNG();
  if (!pngBuffer || pngBuffer.length === 0) {
    throw new Error("A imagem capturada está vazia.");
  }

  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const entry = {
    id,
    mode,
    title: title || "Captura de tela",
    createdAt: Date.now(),
    dpr: Number(dpr) || 1,
    pngBuffer,
  };

  if (pendingCaptures.size >= MAX_PENDING_CAPTURES) {
    const oldestKey = pendingCaptures.keys().next().value;
    if (oldestKey !== undefined) {
      pendingCaptures.delete(oldestKey);
    }
  }
  pendingCaptures.set(id, entry);
  return entry;
}

function emitCountdown(remaining, mode) {
  if (launcherWin && !launcherWin.isDestroyed()) {
    launcherWin.webContents.send("capture:countdown", { remaining, mode });
  }
}

function emitCaptureError(message) {
  const errorMessage = message || "Ocorreu um erro inesperado na captura.";
  if (launcherWin && !launcherWin.isDestroyed()) {
    launcherWin.webContents.send("capture:error", { message: errorMessage });
    return true;
  }
  return false;
}

function reportCaptureError(err) {
  const message = err?.message || String(err) || "Erro desconhecido na captura.";
  const delivered = emitCaptureError(message);
  if (!delivered) {
    dialog.showErrorBox("ScreenSnap — Erro na captura", message);
  }
}

async function runCountdown(seconds, mode) {
  const total = Math.max(0, Math.min(30, Math.round(Number(seconds) || 0)));
  if (total <= 0) {
    return;
  }

  for (let remaining = total; remaining > 0; remaining -= 1) {
    if (isQuitting) {
      return;
    }
    emitCountdown(remaining, mode);
    await sleep(1000);
  }
  emitCountdown(0, mode);
}

async function hideAppWindowsForCapture() {
  const restoreLauncher = Boolean(
    launcherWin && !launcherWin.isDestroyed() && launcherWin.isVisible() && !launcherWin.isMinimized()
  );
  const gostWasVisible = Boolean(gostWin && !gostWin.isDestroyed() && gostWin.isVisible());

  if (restoreLauncher) {
    launcherWin.hide();
  }
  if (gostWasVisible) {
    gostWin.hide();
  }
  if (restoreLauncher || gostWasVisible) {
    await sleep(HIDE_LAUNCHER_SETTLE_MS);
  }
  return restoreLauncher;
}

function restoreLauncherIfNeeded(shouldRestore) {
  if (shouldRestore && launcherWin && !launcherWin.isDestroyed()) {
    if (launcherWin.isMinimized()) {
      launcherWin.restore();
    }
    launcherWin.show();
    launcherWin.focus();
  }
}

/**
 * Resolve bundled Windows shortcut helper directory and script paths.
 */
function resolveWinShiftScriptPaths() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, "scripts", "windows")
    : path.join(ROOT_DIR, "scripts", "windows");
  return {
    dir,
    batPath: path.join(dir, "Liberar-WinShiftS.bat"),
    ps1Path: path.join(dir, "toggle-win-shift-s.ps1"),
  };
}

function isOverlayActive() {
  return Boolean(activeOverlaySession || (overlayWin && !overlayWin.isDestroyed()));
}

function clampGostPositionToWorkArea(x, y) {
  const numX = Number(x);
  const numY = Number(y);
  const safeX = Number.isFinite(numX) ? numX : 0;
  const safeY = Number.isFinite(numY) ? numY : 0;
  const display =
    screen.getDisplayNearestPoint({
      x: Math.round(safeX + GOST_SIZE / 2),
      y: Math.round(safeY + GOST_SIZE / 2),
    }) || screen.getPrimaryDisplay();
  const workArea = display?.workArea || display?.bounds || { x: 0, y: 0, width: 1280, height: 720 };
  const minX = workArea.x;
  const maxX = Math.max(minX, workArea.x + workArea.width - GOST_SIZE);
  const minY = workArea.y;
  const maxY = Math.max(minY, workArea.y + workArea.height - GOST_SIZE);
  return {
    x: Math.max(minX, Math.min(maxX, Math.round(safeX))),
    y: Math.max(minY, Math.min(maxY, Math.round(safeY))),
  };
}

function getDefaultGostPosition() {
  const primary = screen.getPrimaryDisplay();
  const workArea = primary?.workArea || primary?.bounds || { x: 0, y: 0, width: 1280, height: 720 };
  return clampGostPositionToWorkArea(
    workArea.x + workArea.width - GOST_SIZE - 24,
    workArea.y + workArea.height - GOST_SIZE - 24
  );
}

function resolveGostPosition(settings = currentSettings) {
  if (
    settings?.gostPosition &&
    Number.isFinite(settings.gostPosition.x) &&
    Number.isFinite(settings.gostPosition.y)
  ) {
    return clampGostPositionToWorkArea(settings.gostPosition.x, settings.gostPosition.y);
  }
  return getDefaultGostPosition();
}

function getGostConfigPayload(settings = currentSettings) {
  return {
    enabled: Boolean(settings.gostEnabled),
    idleOpacity: settings.gostIdleOpacity,
  };
}

function broadcastSettingsChanged() {
  if (launcherWin && !launcherWin.isDestroyed()) {
    launcherWin.webContents.send("settings:changed", currentSettings);
  }
  if (gostWin && !gostWin.isDestroyed()) {
    gostWin.webContents.send("gost:config", getGostConfigPayload(currentSettings));
  }
}

function destroyGostWindow() {
  gostDragAnchor = null;
  if (gostWin && !gostWin.isDestroyed()) {
    gostWin.destroy();
  }
  gostWin = null;
}

function syncGostWindow() {
  currentSettings = settingsStore.loadSettings();

  if (!currentSettings.gostEnabled) {
    destroyGostWindow();
    return null;
  }

  if (isSmokeTest) {
    return null;
  }

  const targetPos = resolveGostPosition(currentSettings);

  if (gostWin && !gostWin.isDestroyed()) {
    gostWin.webContents.send("gost:config", getGostConfigPayload(currentSettings));
    if (!gostDragAnchor) {
      gostWin.setBounds({ x: targetPos.x, y: targetPos.y, width: GOST_SIZE, height: GOST_SIZE });
    }
    if (!captureInProgress && !isOverlayActive() && !isQuitting && !isSmokeTest) {
      gostWin.setAlwaysOnTop(true, "floating");
      gostWin.showInactive();
    }
    return gostWin;
  }

  const win = new BrowserWindow({
    x: targetPos.x,
    y: targetPos.y,
    width: GOST_SIZE,
    height: GOST_SIZE,
    title: "ScreenSnap Gost",
    icon: getAppIconPath(),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  gostWin = win;
  hardenWindowNavigation(win);
  win.setBounds({ x: targetPos.x, y: targetPos.y, width: GOST_SIZE, height: GOST_SIZE });
  win.setAlwaysOnTop(true, "floating");

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.webContents.send("gost:config", getGostConfigPayload(currentSettings));
      if (!captureInProgress && !isOverlayActive() && !isQuitting && !isSmokeTest) {
        const pos = resolveGostPosition(currentSettings);
        win.setBounds({ x: pos.x, y: pos.y, width: GOST_SIZE, height: GOST_SIZE });
        win.setAlwaysOnTop(true, "floating");
        win.showInactive();
      }
    }
  });

  win.on("closed", () => {
    if (gostWin === win) {
      gostWin = null;
      gostDragAnchor = null;
    }
  });

  win.loadFile(GOST_HTML_PATH);
  return win;
}

const ensureGostWindow = syncGostWindow;

function restoreGostIfEnabled() {
  if (
    !isSmokeTest &&
    !isQuitting &&
    !captureInProgress &&
    !isOverlayActive() &&
    currentSettings.gostEnabled
  ) {
    syncGostWindow();
  }
}

function quitIfNoMainWindowsRemain() {
  const launcherClosed = !launcherWin || launcherWin.isDestroyed();
  if (
    !isSmokeTest &&
    !isQuitting &&
    !currentSettings.minimizeToTray &&
    launcherClosed &&
    editorWindows.size === 0 &&
    !isOverlayActive()
  ) {
    isQuitting = true;
    app.quit();
  }
}

/**
 * Create or reveal the frameless ScreenSnap Launcher window.
 */
function createOrShowLauncher() {
  if (launcherWin && !launcherWin.isDestroyed()) {
    if (launcherWin.isMinimized()) {
      launcherWin.restore();
    }
    launcherWin.show();
    launcherWin.focus();
    return launcherWin;
  }

  const win = new BrowserWindow({
    width: 440,
    height: 650,
    minWidth: 400,
    minHeight: 540,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#151C08",
    icon: getAppIconPath(),
    show: false,
    webPreferences: createSecureWebPreferences(),
  });

  launcherWin = win;
  hardenWindowNavigation(win);

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });

  win.on("minimize", () => {
    if (!isQuitting && tray && !win.isDestroyed()) {
      win.hide();
    }
  });

  win.on("close", (event) => {
    currentSettings = settingsStore.loadSettings();
    if (!isQuitting && currentSettings.minimizeToTray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    if (launcherWin === win) {
      launcherWin = null;
    }
    quitIfNoMainWindowsRemain();
  });

  win.loadFile(LAUNCHER_HTML_PATH);
  return win;
}

/**
 * Open an editor window preloaded with a pending capture ID.
 */
function openEditorWindow(captureId, title) {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    title: title ? `ScreenSnap — ${title}` : "ScreenSnap — Editor",
    backgroundColor: "#151C08",
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    show: false,
    webPreferences: createSecureWebPreferences(),
  });

  editorWindows.add(win);
  hardenWindowNavigation(win);

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });

  win.on("closed", () => {
    editorWindows.delete(win);
    quitIfNoMainWindowsRemain();
  });

  win.loadFile(EDITOR_HTML_PATH, { query: { id: captureId } });
  return win;
}

function resolveDelaySeconds(opts) {
  if (opts && opts.delaySeconds !== undefined && opts.delaySeconds !== null) {
    const parsed = Number(opts.delaySeconds);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(30, Math.round(parsed))) : 0;
  }
  return settingsStore.loadSettings().delaySeconds;
}

async function startScreenCapture(opts = {}) {
  if (captureInProgress || isOverlayActive()) {
    return { ok: false, error: "Já existe uma captura em andamento." };
  }

  captureInProgress = true;
  let restoreLauncher = false;

  try {
    const delaySeconds = resolveDelaySeconds(opts);
    await runCountdown(delaySeconds, "screen");
    if (isQuitting) {
      return { ok: false, error: "Aplicativo em encerramento." };
    }

    const display = capture.resolveDisplay(opts?.displayId);
    restoreLauncher = await hideAppWindowsForCapture();

    const nativeImg = await capture.captureDisplayImage(display);
    const displays = capture.listDisplaysInfo();
    const displayMeta = displays.find((d) => d.id === String(display.id));
    const entry = storePendingCapture({
      mode: "screen",
      title: displayMeta?.label || "Tela inteira",
      dpr: display.scaleFactor || 1,
      nativeImg,
    });

    openEditorWindow(entry.id, entry.title);
    return { ok: true };
  } catch (err) {
    restoreLauncherIfNeeded(restoreLauncher);
    return { ok: false, error: err?.message || String(err) };
  } finally {
    captureInProgress = false;
    restoreGostIfEnabled();
  }
}

async function startRegionCapture(opts = {}) {
  if (captureInProgress || isOverlayActive()) {
    return { ok: false, error: "Já existe uma captura em andamento." };
  }

  captureInProgress = true;
  let restoreLauncher = false;

  try {
    const delaySeconds = resolveDelaySeconds(opts);
    await runCountdown(delaySeconds, "region");
    if (isQuitting) {
      return { ok: false, error: "Aplicativo em encerramento." };
    }

    const display = capture.resolveDisplay(opts?.displayId);
    restoreLauncher = await hideAppWindowsForCapture();

    const nativeImg = await capture.captureDisplayImage(display);
    activeOverlaySession = {
      nativeImage: nativeImg,
      display,
      restoreLauncher,
      imageDataUrl: nativeImg.toDataURL(),
    };

    const bounds = display.bounds;
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: "#151C08",
      show: false,
      webPreferences: createSecureWebPreferences(),
    });

    overlayWin = win;
    hardenWindowNavigation(win);
    win.setBounds(bounds);
    win.setAlwaysOnTop(true, "screen-saver");
    if (process.platform === "darwin") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) {
        win.setBounds(bounds);
        win.setAlwaysOnTop(true, "screen-saver");
        win.show();
        win.focus();
      }
    });

    win.on("closed", () => {
      if (overlayWin === win) {
        overlayWin = null;
      }
      if (activeOverlaySession) {
        const orphanSession = activeOverlaySession;
        activeOverlaySession = null;
        restoreLauncherIfNeeded(orphanSession.restoreLauncher);
      }
      restoreGostIfEnabled();
    });

    await win.loadFile(OVERLAY_HTML_PATH);
    return { ok: true };
  } catch (err) {
    activeOverlaySession = null;
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.destroy();
      overlayWin = null;
    }
    restoreLauncherIfNeeded(restoreLauncher);
    return { ok: false, error: err?.message || String(err) };
  } finally {
    captureInProgress = false;
    restoreGostIfEnabled();
  }
}

async function captureWindowById(opts = {}) {
  if (captureInProgress || isOverlayActive()) {
    return { ok: false, error: "Já existe uma captura em andamento." };
  }

  const sourceId = opts?.sourceId || opts?.id || opts?.windowId;
  if (!sourceId || typeof sourceId !== "string") {
    return { ok: false, error: "Nenhuma janela foi selecionada." };
  }

  captureInProgress = true;
  let restoreLauncher = false;

  try {
    const delaySeconds = resolveDelaySeconds(opts);
    await runCountdown(delaySeconds, "window");
    if (isQuitting) {
      return { ok: false, error: "Aplicativo em encerramento." };
    }

    restoreLauncher = await hideAppWindowsForCapture();
    const thumbnail = await capture.captureWindowSource(sourceId);
    const primaryDisplay = capture.resolveDisplay();
    const title = opts?.name || opts?.title || "Janela";
    const entry = storePendingCapture({
      mode: "window",
      title,
      dpr: primaryDisplay?.scaleFactor || 1,
      nativeImg: thumbnail,
    });

    openEditorWindow(entry.id, entry.title);
    return { ok: true };
  } catch (err) {
    restoreLauncherIfNeeded(restoreLauncher);
    return { ok: false, error: err?.message || String(err) };
  } finally {
    captureInProgress = false;
    restoreGostIfEnabled();
  }
}

function triggerWindowPickerFromShortcut() {
  const win = createOrShowLauncher();
  const notify = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("shortcut:open-window-picker");
    }
  };
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", notify);
  } else {
    notify();
  }
}

function buildTrayTemplate(includeAccelerators) {
  const accProp = (acc) => (includeAccelerators && acc ? { accelerator: acc } : {});
  return [
    {
      label: "Capturar tela (pedaço ou inteira)",
      ...accProp(shortcutStatus.region.accelerator),
      click: () => {
        startRegionCapture().then((res) => {
          if (!res.ok) reportCaptureError(res.error);
        });
      },
    },
    {
      label: "Capturar tela inteira (direto)",
      ...accProp(shortcutStatus.screen.accelerator),
      click: () => {
        startScreenCapture().then((res) => {
          if (!res.ok) reportCaptureError(res.error);
        });
      },
    },
    {
      label: "Capturar janela",
      ...accProp(shortcutStatus.window.accelerator),
      click: () => {
        triggerWindowPickerFromShortcut();
      },
    },
    { type: "separator" },
    {
      label: "Abrir ScreenSnap",
      click: () => {
        createOrShowLauncher();
      },
    },
    {
      label: "Abrir pasta de capturas",
      click: () => {
        const dir = settingsStore.getDefaultCapturesDir();
        shell.openPath(dir).catch(() => {});
      },
    },
    {
      label: "Modo Gost (ícone flutuante)",
      type: "checkbox",
      checked: Boolean(currentSettings.gostEnabled),
      click: (menuItem) => {
        currentSettings = settingsStore.updateSettings({ gostEnabled: Boolean(menuItem.checked) });
        syncGostWindow();
        updateTrayMenu();
        broadcastSettingsChanged();
      },
    },
    ...(isAutoStartSupported()
      ? [
          {
            label: process.platform === "darwin" ? "Iniciar com o macOS" : "Iniciar com o Windows",
            type: "checkbox",
            checked: Boolean(currentSettings.launchAtLogin),
            click: (menuItem) => {
              currentSettings = settingsStore.updateSettings({
                launchAtLogin: Boolean(menuItem.checked),
              });
              syncLoginItemSetting(currentSettings.launchAtLogin);
              updateTrayMenu();
              broadcastSettingsChanged();
            },
          },
        ]
      : []),
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  let contextMenu;
  try {
    contextMenu = Menu.buildFromTemplate(buildTrayTemplate(true));
  } catch {
    contextMenu = Menu.buildFromTemplate(buildTrayTemplate(false));
  }
  tray.setContextMenu(contextMenu);
}

function createTray() {
  if (tray) {
    return tray;
  }

  const trayImg = fs.existsSync(TRAY_ICON_PATH)
    ? nativeImage.createFromPath(TRAY_ICON_PATH)
    : nativeImage.createEmpty();

  try {
    tray = new Tray(trayImg);
  } catch {
    tray = null;
    return null;
  }

  tray.setToolTip("ScreenSnap");
  updateTrayMenu();

  tray.on("click", () => {
    if (launcherWin && !launcherWin.isDestroyed() && launcherWin.isVisible() && !launcherWin.isMinimized()) {
      launcherWin.hide();
    } else {
      createOrShowLauncher();
    }
  });

  return tray;
}

function refreshShortcutsAndTray() {
  globalShortcut.unregisterAll();

  const settings = settingsStore.loadSettings();
  const regionHandler = () => {
    startRegionCapture().then((res) => {
      if (!res.ok) reportCaptureError(res.error);
    });
  };
  const screenHandler = () => {
    startScreenCapture().then((res) => {
      if (!res.ok) reportCaptureError(res.error);
    });
  };
  const windowHandler = () => {
    triggerWindowPickerFromShortcut();
  };

  const entries = [
    { key: "region", accelerator: settings.shortcuts.region, handler: regionHandler },
    { key: "screen", accelerator: settings.shortcuts.screen, handler: screenHandler },
    { key: "window", accelerator: settings.shortcuts.window, handler: windowHandler },
  ];

  for (const item of entries) {
    let registered = false;
    try {
      registered = globalShortcut.register(item.accelerator, item.handler);
    } catch {
      registered = false;
    }
    shortcutStatus[item.key] = {
      accelerator: item.accelerator,
      registered: Boolean(registered),
    };
  }

  if (settings.tryWinShiftS && process.platform !== "darwin") {
    if (settings.shortcuts.region.toLowerCase() === "super+shift+s") {
      shortcutStatus.winShiftS = {
        accelerator: "Super+Shift+S",
        registered: shortcutStatus.region.registered,
        enabled: true,
      };
    } else {
      let winShiftSOk = false;
      try {
        winShiftSOk = globalShortcut.register("Super+Shift+S", regionHandler);
      } catch {
        winShiftSOk = false;
      }
      shortcutStatus.winShiftS = {
        accelerator: "Super+Shift+S",
        registered: Boolean(winShiftSOk),
        enabled: true,
      };
    }
  } else {
    shortcutStatus.winShiftS = {
      accelerator: "Super+Shift+S",
      registered: false,
      enabled: false,
    };
  }

  if (tray) {
    updateTrayMenu();
  }
}

function registerIpcHandlers() {
  ipcMain.handle("app:get-state", () => {
    currentSettings = settingsStore.loadSettings();
    return {
      version: app.getVersion(),
      platform: process.platform,
      settings: currentSettings,
      shortcuts: getShortcutsPayload(),
      displays: capture.listDisplaysInfo(),
      capturesDir: settingsStore.getDefaultCapturesDir(),
    };
  });

  ipcMain.handle("settings:update", (_event, partial) => {
    const updated = settingsStore.updateSettings(partial);
    currentSettings = updated;
    if (
      partial &&
      typeof partial === "object" &&
      ("tryWinShiftS" in partial || "shortcuts" in partial)
    ) {
      refreshShortcutsAndTray();
    }
    if (
      partial &&
      typeof partial === "object" &&
      ("gostEnabled" in partial || "gostIdleOpacity" in partial || "gostPosition" in partial)
    ) {
      syncGostWindow();
      updateTrayMenu();
    }
    if (partial && typeof partial === "object" && "launchAtLogin" in partial) {
      syncLoginItemSetting(updated.launchAtLogin);
      updateTrayMenu();
    }
    broadcastSettingsChanged();
    return updated;
  });

  ipcMain.handle("shortcuts:set", (_event, payload = {}) => {
    const action = payload?.action;
    if (!["region", "screen", "window"].includes(action)) {
      return {
        ok: false,
        error: "Ação de atalho inválida.",
        shortcuts: getShortcutsPayload(),
      };
    }

    const cleanAcc = settingsStore.sanitizeAccelerator(payload?.accelerator, null);
    if (!cleanAcc) {
      return {
        ok: false,
        error: "Combinação de teclas inválida.",
        shortcuts: getShortcutsPayload(),
      };
    }

    const current = settingsStore.loadSettings();
    const conflict = Object.entries(current.shortcuts).some(
      ([otherAction, otherAcc]) =>
        otherAction !== action &&
        typeof otherAcc === "string" &&
        otherAcc.toLowerCase() === cleanAcc.toLowerCase()
    );
    if (conflict) {
      return {
        ok: false,
        error: "Este atalho já está em uso em outra ação do ScreenSnap.",
        shortcuts: getShortcutsPayload(),
      };
    }

    globalShortcut.unregisterAll();
    let ok = false;
    try {
      ok = globalShortcut.register(cleanAcc, () => {});
    } catch {
      ok = false;
    }

    if (!ok) {
      refreshShortcutsAndTray();
      return {
        ok: false,
        error:
          cleanAcc.toLowerCase() === "super+shift+s"
            ? "Win+Shift+S está reservado pelo Windows (Ferramenta de Captura). Use PrtSc, Ctrl+Shift+S ou Alt+Shift+S — ou libere o atalho nativo do Windows."
            : "Atalho indisponível ou reservado pelo sistema operacional.",
        shortcuts: getShortcutsPayload(),
      };
    }

    currentSettings = settingsStore.updateSettings({
      shortcuts: {
        ...current.shortcuts,
        [action]: cleanAcc,
      },
    });
    refreshShortcutsAndTray();
    broadcastSettingsChanged();
    return {
      ok: true,
      shortcuts: getShortcutsPayload(),
    };
  });

  ipcMain.handle("shortcuts:reset", () => {
    currentSettings = settingsStore.updateSettings({
      shortcuts: settingsStore.getDefaultShortcuts(),
      tryWinShiftS: true,
    });
    refreshShortcutsAndTray();
    broadcastSettingsChanged();
    return {
      ok: true,
      shortcuts: getShortcutsPayload(),
    };
  });

  ipcMain.handle("shortcuts:run-win-shift-script", () => {
    if (process.platform !== "win32") {
      return { ok: false, error: "Script disponível apenas no Windows." };
    }

    const { dir, batPath, ps1Path } = resolveWinShiftScriptPaths();
    if (!fs.existsSync(batPath) || !fs.existsSync(ps1Path)) {
      return { ok: false, error: "Script auxiliar não encontrado na instalação." };
    }

    try {
      const comspec = process.env.ComSpec || "cmd.exe";
      const safeDir = dir.replace(/"/g, '""');
      const child = spawn(
        comspec,
        [
          "/d",
          "/c",
          `start "ScreenSnap - Atalho Win+Shift+S" /D "${safeDir}" cmd.exe /d /c Liberar-WinShiftS.bat`,
        ],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          windowsVerbatimArguments: true,
        }
      );
      child.unref();
      return { ok: true, scriptPath: batPath };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || "Não foi possível abrir o script auxiliar.",
      };
    }
  });

  ipcMain.handle("gost:get-config", () => {
    currentSettings = settingsStore.loadSettings();
    return getGostConfigPayload(currentSettings);
  });

  ipcMain.handle("gost:trigger-capture", async () => {
    return startRegionCapture();
  });

  ipcMain.handle("gost:show-menu", () => {
    currentSettings = settingsStore.loadSettings();
    const opacityOptions = [
      { label: "20%", value: 0.2 },
      { label: "30%", value: 0.3 },
      { label: "50%", value: 0.5 },
      { label: "75%", value: 0.75 },
    ];
    let closestOpacity = opacityOptions[0].value;
    let minDiff = Infinity;
    for (const opt of opacityOptions) {
      const diff = Math.abs(currentSettings.gostIdleOpacity - opt.value);
      if (diff < minDiff) {
        minDiff = diff;
        closestOpacity = opt.value;
      }
    }

    const menu = Menu.buildFromTemplate([
      {
        label: "Capturar agora (Pedaço / Tela)",
        click: () => {
          startRegionCapture().then((res) => {
            if (!res.ok) reportCaptureError(res.error);
          });
        },
      },
      {
        label: "Abrir ScreenSnap",
        click: () => {
          createOrShowLauncher();
        },
      },
      { type: "separator" },
      {
        label: "Transparência (parado)",
        submenu: opacityOptions.map((opt) => ({
          label: opt.label,
          type: "radio",
          checked: opt.value === closestOpacity,
          click: () => {
            currentSettings = settingsStore.updateSettings({ gostIdleOpacity: opt.value });
            broadcastSettingsChanged();
          },
        })),
      },
      {
        label: "Resetar posição",
        click: () => {
          currentSettings = settingsStore.updateSettings({ gostPosition: null });
          if (gostWin && !gostWin.isDestroyed()) {
            const pos = getDefaultGostPosition();
            gostWin.setBounds({ x: pos.x, y: pos.y, width: GOST_SIZE, height: GOST_SIZE });
          }
          broadcastSettingsChanged();
        },
      },
      { type: "separator" },
      {
        label: "Desativar Modo Gost",
        click: () => {
          currentSettings = settingsStore.updateSettings({ gostEnabled: false });
          syncGostWindow();
          updateTrayMenu();
          broadcastSettingsChanged();
        },
      },
    ]);

    menu.popup();
    return { ok: true };
  });

  ipcMain.on("gost:drag-start", () => {
    if (!gostWin || gostWin.isDestroyed()) {
      gostDragAnchor = null;
      return;
    }
    const bounds = gostWin.getBounds();
    gostDragAnchor = { x: bounds.x, y: bounds.y };
  });

  ipcMain.on("gost:drag-move", (_event, delta) => {
    if (!gostWin || gostWin.isDestroyed() || !gostDragAnchor) {
      return;
    }
    const dx = Number(delta?.dx);
    const dy = Number(delta?.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return;
    }
    const next = clampGostPositionToWorkArea(gostDragAnchor.x + dx, gostDragAnchor.y + dy);
    gostWin.setBounds({ x: next.x, y: next.y, width: GOST_SIZE, height: GOST_SIZE });
  });

  ipcMain.handle("gost:drag-end", () => {
    if (!gostWin || gostWin.isDestroyed()) {
      gostDragAnchor = null;
      return { ok: false, position: currentSettings.gostPosition || null };
    }
    const bounds = gostWin.getBounds();
    const position = clampGostPositionToWorkArea(bounds.x, bounds.y);
    gostWin.setBounds({ x: position.x, y: position.y, width: GOST_SIZE, height: GOST_SIZE });
    currentSettings = settingsStore.updateSettings({ gostPosition: position });
    gostDragAnchor = null;
    broadcastSettingsChanged();
    return { ok: true, position };
  });

  ipcMain.handle("capture:list-displays", () => {
    return capture.listDisplaysInfo();
  });

  ipcMain.handle("capture:list-windows", async () => {
    return capture.listWindowSources();
  });

  ipcMain.handle("capture:start-screen", async (_event, opts) => {
    return startScreenCapture(opts);
  });

  ipcMain.handle("capture:start-region", async (_event, opts) => {
    return startRegionCapture(opts);
  });

  ipcMain.handle("capture:window-by-id", async (_event, opts) => {
    return captureWindowById(opts);
  });

  ipcMain.handle("overlay:get-data", () => {
    if (!activeOverlaySession) {
      return null;
    }
    const { display, imageDataUrl } = activeOverlaySession;
    return {
      imageDataUrl,
      width: display.size?.width ?? display.bounds.width,
      height: display.size?.height ?? display.bounds.height,
      scaleFactor: display.scaleFactor || 1,
      displayId: String(display.id),
    };
  });

  ipcMain.handle("overlay:confirm-region", (_event, rect) => {
    if (!activeOverlaySession) {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.close();
      }
      return { ok: false, error: "Nenhuma sessão de seleção ativa." };
    }

    const session = activeOverlaySession;
    activeOverlaySession = null;

    try {
      const vpW =
        Number(rect?.viewportWidth) > 0
          ? Number(rect.viewportWidth)
          : session.display.size?.width ?? session.display.bounds.width;
      const vpH =
        Number(rect?.viewportHeight) > 0
          ? Number(rect.viewportHeight)
          : session.display.size?.height ?? session.display.bounds.height;

      const cropped = capture.cropNativeImage(session.nativeImage, rect, vpW, vpH);
      const cropW = Math.max(1, Math.round(Number(rect?.width) || 1));
      const cropH = Math.max(1, Math.round(Number(rect?.height) || 1));
      const entry = storePendingCapture({
        mode: "region",
        title: `Região (${cropW}×${cropH})`,
        dpr: session.display.scaleFactor || 1,
        nativeImg: cropped,
      });

      if (overlayWin && !overlayWin.isDestroyed()) {
        const winToClose = overlayWin;
        overlayWin = null;
        winToClose.close();
      }

      openEditorWindow(entry.id, entry.title);
      restoreGostIfEnabled();
      return { ok: true };
    } catch (err) {
      if (overlayWin && !overlayWin.isDestroyed()) {
        const winToClose = overlayWin;
        overlayWin = null;
        winToClose.close();
      }
      restoreLauncherIfNeeded(session.restoreLauncher);
      restoreGostIfEnabled();
      throw err;
    }
  });

  ipcMain.handle("overlay:confirm-fullscreen", () => {
    if (!activeOverlaySession) {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.close();
      }
      return { ok: false, error: "Nenhuma sessão de captura ativa." };
    }

    const session = activeOverlaySession;
    activeOverlaySession = null;

    try {
      const displays = capture.listDisplaysInfo();
      const displayMeta = displays.find((d) => d.id === String(session.display.id));
      const entry = storePendingCapture({
        mode: "screen",
        title: displayMeta?.label || "Tela inteira",
        dpr: session.display.scaleFactor || 1,
        nativeImg: session.nativeImage,
      });

      if (overlayWin && !overlayWin.isDestroyed()) {
        const winToClose = overlayWin;
        overlayWin = null;
        winToClose.close();
      }

      openEditorWindow(entry.id, entry.title);
      restoreGostIfEnabled();
      return { ok: true };
    } catch (err) {
      if (overlayWin && !overlayWin.isDestroyed()) {
        const winToClose = overlayWin;
        overlayWin = null;
        winToClose.close();
      }
      restoreLauncherIfNeeded(session.restoreLauncher);
      restoreGostIfEnabled();
      throw err;
    }
  });

  ipcMain.handle("overlay:cancel-region", () => {
    const session = activeOverlaySession;
    activeOverlaySession = null;

    if (overlayWin && !overlayWin.isDestroyed()) {
      const winToClose = overlayWin;
      overlayWin = null;
      winToClose.close();
    }
    restoreLauncherIfNeeded(Boolean(session?.restoreLauncher));
    restoreGostIfEnabled();
    return { ok: true };
  });

  ipcMain.handle("capture:get-pending", (_event, id) => {
    if (!id || !pendingCaptures.has(id)) {
      return null;
    }
    const entry = pendingCaptures.get(id);
    return {
      id: entry.id,
      mode: entry.mode,
      title: entry.title,
      createdAt: entry.createdAt,
      dpr: entry.dpr,
      pngBytes: new Uint8Array(entry.pngBuffer),
    };
  });

  ipcMain.handle("export:copy-clipboard", (_event, pngBytes) => {
    const buf = toNodeBuffer(pngBytes);
    if (!buf.length) {
      throw new Error("Imagem vazia para copiar para a área de transferência.");
    }
    const image = nativeImage.createFromBuffer(buf);
    if (image.isEmpty()) {
      throw new Error("Não foi possível decodificar o PNG para a área de transferência.");
    }
    clipboard.writeImage(image);
    return { ok: true };
  });

  ipcMain.handle("export:save-file", async (event, opts = {}) => {
    const buf = toNodeBuffer(opts.bytes);
    if (!buf.length) {
      throw new Error("Arquivo vazio para salvar.");
    }

    const capturesDir = settingsStore.getDefaultCapturesDir();
    const safeFilename = path.basename(String(opts.defaultFilename || "ScreenSnap.png"));
    const defaultPath = path.join(capturesDir, safeFilename);

    const safeFilters =
      Array.isArray(opts.filters) && opts.filters.length > 0
        ? opts.filters.map((f) => ({
            name: String(f?.name || "Arquivo"),
            extensions: Array.isArray(f?.extensions) ? f.extensions.map(String) : ["*"],
          }))
        : [
            { name: "PNG", extensions: ["png"] },
            { name: "JPEG", extensions: ["jpg", "jpeg"] },
            { name: "PDF", extensions: ["pdf"] },
          ];

    const parentWin = BrowserWindow.fromWebContents(event.sender) || undefined;
    const result = await dialog.showSaveDialog(parentWin, {
      title: "Salvar captura",
      defaultPath,
      filters: safeFilters,
    });

    if (result.canceled || !result.filePath) {
      return { ok: true, canceled: true };
    }

    fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
    await fs.promises.writeFile(result.filePath, buf);
    return { ok: true, canceled: false, filePath: result.filePath };
  });

  ipcMain.handle("shell:open-captures-folder", async () => {
    const dir = settingsStore.getDefaultCapturesDir();
    const openError = await shell.openPath(dir);
    if (openError) {
      throw new Error(openError);
    }
    return { ok: true, dir };
  });

  ipcMain.handle("shell:show-in-folder", (_event, filePath) => {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("Caminho de arquivo inválido.");
    }
    const resolved = path.resolve(filePath);
    shell.showItemInFolder(resolved);
    return { ok: true };
  });

  ipcMain.handle("window:open-launcher", () => {
    createOrShowLauncher();
    return { ok: true };
  });

  ipcMain.handle("window:minimize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      if (win === launcherWin && tray && !isQuitting) {
        win.hide();
      } else {
        win.minimize();
      }
    }
    return { ok: true };
  });

  ipcMain.handle("window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    return { ok: true };
  });
}

function getSmokeTestOutPath(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--smoke-test-out=")) {
      return arg.slice("--smoke-test-out=".length);
    }
    if (arg === "--smoke-test-out" && argv[i + 1]) {
      return argv[i + 1];
    }
  }
  return null;
}

async function verifySmokeWindow(label, htmlPath, checkScript, errors, windowOptions = {}) {
  let win = null;
  try {
    win = new BrowserWindow({
      width: 800,
      height: 600,
      ...windowOptions,
      show: false,
      webPreferences: {
        ...createSecureWebPreferences(),
        ...(windowOptions.webPreferences || {}),
      },
    });
    hardenWindowNavigation(win);

    win.webContents.on("console-message", (details, legacyLevel, legacyMessage) => {
      const isError = details?.level === "error" || legacyLevel === 3;
      if (isError) {
        const msg = details?.message || legacyMessage || "Unknown console error";
        errors.push(`${label} console error: ${msg}`);
      }
    });

    win.webContents.on("render-process-gone", (_event, details) => {
      errors.push(`${label} render-process-gone: ${details?.reason || "unknown"}`);
    });

    const loadPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out waiting for did-finish-load`));
      }, 10000);

      win.webContents.once("did-finish-load", () => {
        clearTimeout(timer);
        resolve();
      });

      win.webContents.once("did-fail-load", (_event, code, desc, validatedURL) => {
        clearTimeout(timer);
        reject(new Error(`${label} did-fail-load (${code}): ${desc} [${validatedURL}]`));
      });

      win.loadFile(htmlPath).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    await loadPromise;
    await sleep(150);

    const preloadOk = Boolean(await win.webContents.executeJavaScript(checkScript, true));
    if (!preloadOk) {
      errors.push(`${label} preload check failed: ${checkScript}`);
    }
    return preloadOk;
  } catch (err) {
    errors.push(`${label} error: ${err?.message || String(err)}`);
    return false;
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }
}

async function runSmokeTest() {
  const errors = [];
  let displaysCount = 0;
  let screenSourcesCount = 0;
  let launcherPreloadOk = false;
  let overlayPreloadOk = false;
  let editorPreloadOk = false;
  let gostPreloadOk = false;
  let winShiftScriptBundledOk = process.platform !== "win32";

  try {
    const displays = capture.listDisplaysInfo();
    displaysCount = displays.length;
    if (displaysCount === 0) {
      errors.push("No displays detected via listDisplaysInfo().");
    }
  } catch (err) {
    errors.push(`listDisplaysInfo error: ${err?.message || String(err)}`);
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 320, height: 180 },
    });
    screenSourcesCount = Array.isArray(sources) ? sources.length : 0;
    if (screenSourcesCount === 0) {
      errors.push("No screen sources returned by desktopCapturer.getSources().");
    }
  } catch (err) {
    errors.push(`desktopCapturer error: ${err?.message || String(err)}`);
  }

  launcherPreloadOk = await verifySmokeWindow(
    "launcher",
    LAUNCHER_HTML_PATH,
    'typeof window.screenSnap?.getAppState === "function" && typeof window.screenSnap?.setShortcut === "function" && typeof window.screenSnap?.resetShortcuts === "function" && typeof window.screenSnap?.runWinShiftScript === "function" && typeof window.screenSnap?.onSettingsChanged === "function"',
    errors
  );

  overlayPreloadOk = await verifySmokeWindow(
    "overlay",
    OVERLAY_HTML_PATH,
    'typeof window.screenSnap?.confirmRegion === "function" && typeof window.screenSnap?.confirmFullScreen === "function" && typeof window.screenSnap?.cancelRegion === "function"',
    errors
  );

  editorPreloadOk = await verifySmokeWindow(
    "editor",
    EDITOR_HTML_PATH,
    'typeof window.screenSnap?.saveFile === "function" && typeof window.screenSnap?.copyPngToClipboard === "function" && typeof window.screenSnap?.closeWindow === "function"',
    errors
  );

  gostPreloadOk = await verifySmokeWindow(
    "gost",
    GOST_HTML_PATH,
    'typeof window.screenSnap?.getGostConfig === "function" && typeof window.screenSnap?.gostTriggerCapture === "function" && typeof window.screenSnap?.gostShowMenu === "function" && typeof window.screenSnap?.gostDragStart === "function" && typeof window.screenSnap?.gostDragMove === "function" && typeof window.screenSnap?.gostDragEnd === "function" && typeof window.screenSnap?.onGostConfig === "function"',
    errors,
    {
      width: GOST_SIZE,
      height: GOST_SIZE,
      frame: false,
      transparent: true,
      focusable: false,
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
      },
    }
  );

  if (process.platform === "win32") {
    const { dir, batPath, ps1Path } = resolveWinShiftScriptPaths();
    const batOk = fs.existsSync(batPath);
    const ps1Ok = fs.existsSync(ps1Path);
    winShiftScriptBundledOk = batOk && ps1Ok;
    if (!winShiftScriptBundledOk) {
      errors.push(`Bundled Win+Shift+S script files missing in: ${dir}`);
    }
  }

  const ok =
    displaysCount > 0 &&
    screenSourcesCount > 0 &&
    launcherPreloadOk &&
    overlayPreloadOk &&
    editorPreloadOk &&
    gostPreloadOk &&
    winShiftScriptBundledOk &&
    errors.length === 0;

  const report = {
    ok,
    platform: process.platform,
    displaysCount,
    screenSourcesCount,
    launcherPreloadOk,
    overlayPreloadOk,
    editorPreloadOk,
    gostPreloadOk,
    winShiftScriptBundledOk,
    errors,
  };

  const outPath = getSmokeTestOutPath(process.argv);
  if (outPath) {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } catch (err) {
      errors.push(`Failed writing smoke-test output: ${err?.message || String(err)}`);
      report.ok = false;
    }
  }

  console.log(report.ok ? "SMOKE_TEST_OK" : "SMOKE_TEST_FAIL");
  if (!report.ok) {
    console.error(JSON.stringify(report, null, 2));
  }
  smokeTestDone = true;
  app.exit(report.ok ? 0 : 1);
}

let canStart = true;

if (!isSmokeTest) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    canStart = false;
    app.quit();
  } else {
    app.on("second-instance", () => {
      createOrShowLauncher();
    });
  }
}

if (canStart) {
  app.on("before-quit", () => {
    isQuitting = true;
    destroyGostWindow();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  app.on("window-all-closed", () => {
    if (isSmokeTest) {
      if (smokeTestDone) {
        app.quit();
      }
      return;
    }
    if (isQuitting || !tray) {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!isSmokeTest && app.isReady()) {
      createOrShowLauncher();
    }
  });

  app.whenReady().then(async () => {
    currentSettings = settingsStore.loadSettings();
    registerIpcHandlers();

    if (isSmokeTest) {
      await runSmokeTest();
      return;
    }

    createTray();
    refreshShortcutsAndTray();
    syncLoginItemSetting(currentSettings.launchAtLogin);

    const startHidden =
      isHiddenAutoStartArg ||
      (process.platform === "darwin" && Boolean(app.getLoginItemSettings().wasOpenedAsHidden));
    if (!startHidden || !tray) {
      createOrShowLauncher();
    }
    syncGostWindow();
  });
}
