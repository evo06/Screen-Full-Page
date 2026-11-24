"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Subscribe to a main-to-renderer IPC channel without exposing the raw IpcRendererEvent.
 */
function subscribe(channel, callback) {
  if (typeof callback !== "function") {
    return () => {};
  }
  const listener = (_event, payload) => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const screenSnapApi = Object.freeze({
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  updateSettings: (partial) => ipcRenderer.invoke("settings:update", partial),
  setShortcut: (action, accelerator) =>
    ipcRenderer.invoke("shortcuts:set", { action, accelerator }),
  resetShortcuts: () => ipcRenderer.invoke("shortcuts:reset"),
  runWinShiftScript: () => ipcRenderer.invoke("shortcuts:run-win-shift-script"),

  listDisplays: () => ipcRenderer.invoke("capture:list-displays"),
  listWindows: () => ipcRenderer.invoke("capture:list-windows"),
  captureScreen: (opts = {}) => ipcRenderer.invoke("capture:start-screen", opts),
  captureRegion: (opts = {}) => ipcRenderer.invoke("capture:start-region", opts),
  captureWindow: (opts = {}) => ipcRenderer.invoke("capture:window-by-id", opts),

  getOverlayData: () => ipcRenderer.invoke("overlay:get-data"),
  confirmRegion: (rect) => ipcRenderer.invoke("overlay:confirm-region", rect),
  confirmFullScreen: () => ipcRenderer.invoke("overlay:confirm-fullscreen"),
  cancelRegion: () => ipcRenderer.invoke("overlay:cancel-region"),

  getPendingCapture: (id) => ipcRenderer.invoke("capture:get-pending", id),
  copyPngToClipboard: (pngBytes) => ipcRenderer.invoke("export:copy-clipboard", pngBytes),
  saveFile: (opts) => ipcRenderer.invoke("export:save-file", opts),

  openCapturesFolder: () => ipcRenderer.invoke("shell:open-captures-folder"),
  showItemInFolder: (filePath) => ipcRenderer.invoke("shell:show-in-folder", filePath),

  openLauncher: () => ipcRenderer.invoke("window:open-launcher"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),

  getGostConfig: () => ipcRenderer.invoke("gost:get-config"),
  gostTriggerCapture: () => ipcRenderer.invoke("gost:trigger-capture"),
  gostShowMenu: () => ipcRenderer.invoke("gost:show-menu"),
  gostDragStart: () => ipcRenderer.send("gost:drag-start"),
  gostDragMove: (delta) => ipcRenderer.send("gost:drag-move", delta),
  gostDragEnd: () => ipcRenderer.invoke("gost:drag-end"),

  onCountdown: (cb) => subscribe("capture:countdown", cb),
  onCaptureError: (cb) => subscribe("capture:error", cb),
  onOpenWindowPicker: (cb) => subscribe("shortcut:open-window-picker", cb),
  onGostConfig: (cb) => subscribe("gost:config", cb),
  onSettingsChanged: (cb) => subscribe("settings:changed", cb),
});

contextBridge.exposeInMainWorld("screenSnap", screenSnapApi);
