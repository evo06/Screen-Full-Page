"use strict";

const fs = require("fs");
const path = require("path");

const MODIFIER_ALIASES = Object.freeze({
  commandorcontrol: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  command: "Command",
  cmd: "Command",
  control: "Control",
  ctrl: "Control",
  alt: "Alt",
  option: "Option",
  altgr: "AltGr",
  shift: "Shift",
  super: "Super",
  meta: "Super",
});

const KEY_ALIASES = Object.freeze({
  printscreen: "PrintScreen",
  space: "Space",
  tab: "Tab",
  enter: "Enter",
  return: "Return",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
  delete: "Delete",
  backspace: "Backspace",
  plus: "Plus",
  minus: "Minus",
});

const STANDALONE_KEYS = new Set(["PrintScreen"]);
const MAX_ACCELERATOR_LENGTH = 64;
const SETTINGS_FILENAME = "settings.json";
const MAX_DELAY_SECONDS = 30;
const MIN_GOST_OPACITY = 0.15;
const MAX_GOST_OPACITY = 0.85;

/**
 * Return platform-specific default global shortcuts for ScreenSnap actions.
 */
function getDefaultShortcuts(platform = process.platform) {
  if (platform === "darwin") {
    return {
      region: "CommandOrControl+Shift+S",
      screen: "CommandOrControl+Shift+1",
      window: "CommandOrControl+Shift+3",
    };
  }
  return {
    region: "PrintScreen",
    screen: "CommandOrControl+Shift+1",
    window: "CommandOrControl+Shift+3",
  };
}

const DEFAULT_SETTINGS = Object.freeze({
  delaySeconds: 0,
  minimizeToTray: true,
  launchAtLogin: true,
  tryWinShiftS: true,
  gostEnabled: true,
  gostIdleOpacity: 0.3,
  gostPosition: null,
  shortcuts: Object.freeze(getDefaultShortcuts()),
});

/**
 * Canonicalize a key token (A-Z, 0-9, F1-F24, or named special key), or return null.
 */
function canonicalizeKeyToken(token) {
  if (!token) {
    return null;
  }
  const lower = token.toLowerCase();
  if (/^[a-z]$/.test(lower)) {
    return lower.toUpperCase();
  }
  if (/^[0-9]$/.test(lower)) {
    return lower;
  }
  const fnMatch = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
  if (fnMatch) {
    return `F${fnMatch[1]}`;
  }
  return KEY_ALIASES[lower] || null;
}

/**
 * Validate and canonicalize an Electron globalShortcut accelerator string.
 * Accepts standalone PrintScreen / F1-F24 or Modifier(s)+Key within 64 chars.
 */
function sanitizeAccelerator(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ACCELERATOR_LENGTH) {
    return fallback;
  }

  const rawParts = trimmed.split("+").map((part) => part.trim());
  if (rawParts.some((part) => part.length === 0)) {
    return fallback;
  }

  if (rawParts.length === 1) {
    const singleKey = canonicalizeKeyToken(rawParts[0]);
    if (!singleKey) {
      return fallback;
    }
    if (STANDALONE_KEYS.has(singleKey) || /^F([1-9]|1[0-9]|2[0-4])$/.test(singleKey)) {
      return singleKey;
    }
    return fallback;
  }

  const rawKey = rawParts[rawParts.length - 1];
  const canonicalKey = canonicalizeKeyToken(rawKey);
  if (!canonicalKey) {
    return fallback;
  }

  const modifiers = [];
  const seenModifiers = new Set();
  for (let i = 0; i < rawParts.length - 1; i += 1) {
    const modCanonical = MODIFIER_ALIASES[rawParts[i].toLowerCase()];
    if (!modCanonical || seenModifiers.has(modCanonical)) {
      return fallback;
    }
    seenModifiers.add(modCanonical);
    modifiers.push(modCanonical);
  }

  if (modifiers.length === 0) {
    return fallback;
  }

  return `${modifiers.join("+")}+${canonicalKey}`;
}

/**
 * Lazily access Electron's app module so pure Node unit tests can import this module.
 */
function getElectronApp() {
  const electronMod = require("electron");
  if (!electronMod || typeof electronMod !== "object" || !electronMod.app) {
    throw new Error("Electron app API unavailable outside Electron main process.");
  }
  return electronMod.app;
}

/**
 * Resolve path to settings.json inside userData (or an explicit directory for tests).
 */
function getSettingsPath(userDataDir) {
  const baseDir = userDataDir || getElectronApp().getPath("userData");
  return path.join(baseDir, SETTINGS_FILENAME);
}

/**
 * Sanitize shortcut map against fallback shortcuts and platform defaults.
 */
function sanitizeShortcutsMap(rawShortcuts, fallbackShortcuts) {
  const defaults = getDefaultShortcuts();
  const base =
    fallbackShortcuts && typeof fallbackShortcuts === "object" && !Array.isArray(fallbackShortcuts)
      ? fallbackShortcuts
      : defaults;
  const source =
    rawShortcuts && typeof rawShortcuts === "object" && !Array.isArray(rawShortcuts)
      ? rawShortcuts
      : {};

  const result = {};
  for (const action of ["region", "screen", "window"]) {
    const baseVal = sanitizeAccelerator(base[action], defaults[action]);
    result[action] = Object.prototype.hasOwnProperty.call(source, action)
      ? sanitizeAccelerator(source[action], baseVal)
      : baseVal;
  }
  return result;
}

/**
 * Sanitize Gost idle opacity within [MIN_GOST_OPACITY, MAX_GOST_OPACITY] rounded to 2 decimals.
 */
function sanitizeGostOpacity(value, fallback) {
  if (value !== undefined && value !== null && value !== "" && typeof value !== "boolean") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const clamped = Math.max(MIN_GOST_OPACITY, Math.min(MAX_GOST_OPACITY, parsed));
      return Math.round(clamped * 100) / 100;
    }
  }
  return fallback;
}

/**
 * Sanitize Gost floating window position ({ x, y } or null).
 */
function sanitizeGostPosition(value, fallback) {
  if (value === null) {
    return null;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rawX = value.x;
    const rawY = value.y;
    if (
      rawX !== undefined &&
      rawX !== null &&
      rawX !== "" &&
      typeof rawX !== "boolean" &&
      rawY !== undefined &&
      rawY !== null &&
      rawY !== "" &&
      typeof rawY !== "boolean"
    ) {
      const x = Number(rawX);
      const y = Number(rawY);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return { x: Math.round(x), y: Math.round(y) };
      }
    }
  }
  return fallback ? { x: fallback.x, y: fallback.y } : null;
}

/**
 * Normalize and clamp settings values against defaults or current settings.
 */
function sanitizeSettings(raw, fallback = DEFAULT_SETTINGS) {
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_SETTINGS;
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  let delaySeconds = base.delaySeconds ?? DEFAULT_SETTINGS.delaySeconds;
  if (Object.prototype.hasOwnProperty.call(source, "delaySeconds")) {
    const parsed = Number(source.delaySeconds);
    if (Number.isFinite(parsed)) {
      delaySeconds = Math.max(0, Math.min(MAX_DELAY_SECONDS, Math.round(parsed)));
    } else {
      delaySeconds = DEFAULT_SETTINGS.delaySeconds;
    }
  }

  let minimizeToTray =
    typeof base.minimizeToTray === "boolean"
      ? base.minimizeToTray
      : DEFAULT_SETTINGS.minimizeToTray;
  if (typeof source.minimizeToTray === "boolean") {
    minimizeToTray = source.minimizeToTray;
  }

  let launchAtLogin =
    typeof base.launchAtLogin === "boolean"
      ? base.launchAtLogin
      : DEFAULT_SETTINGS.launchAtLogin;
  if (typeof source.launchAtLogin === "boolean") {
    launchAtLogin = source.launchAtLogin;
  }

  let tryWinShiftS =
    typeof base.tryWinShiftS === "boolean"
      ? base.tryWinShiftS
      : DEFAULT_SETTINGS.tryWinShiftS;
  if (typeof source.tryWinShiftS === "boolean") {
    tryWinShiftS = source.tryWinShiftS;
  }

  let gostEnabled =
    typeof base.gostEnabled === "boolean"
      ? base.gostEnabled
      : DEFAULT_SETTINGS.gostEnabled;
  if (typeof source.gostEnabled === "boolean") {
    gostEnabled = source.gostEnabled;
  }

  const baseOpacity = sanitizeGostOpacity(base.gostIdleOpacity, DEFAULT_SETTINGS.gostIdleOpacity);
  const gostIdleOpacity = Object.prototype.hasOwnProperty.call(source, "gostIdleOpacity")
    ? sanitizeGostOpacity(source.gostIdleOpacity, baseOpacity)
    : baseOpacity;

  const basePosition = sanitizeGostPosition(base.gostPosition, DEFAULT_SETTINGS.gostPosition);
  const gostPosition = Object.prototype.hasOwnProperty.call(source, "gostPosition")
    ? sanitizeGostPosition(source.gostPosition, basePosition)
    : basePosition;

  const shortcuts = sanitizeShortcutsMap(source.shortcuts, base.shortcuts);

  return {
    delaySeconds,
    minimizeToTray,
    launchAtLogin,
    tryWinShiftS,
    gostEnabled,
    gostIdleOpacity,
    gostPosition,
    shortcuts,
  };
}

/**
 * Load persisted settings from settings.json, returning defaults if missing or invalid.
 */
function loadSettings(userDataDir) {
  const settingsPath = getSettingsPath(userDataDir);
  try {
    if (!fs.existsSync(settingsPath)) {
      return sanitizeSettings(null, DEFAULT_SETTINGS);
    }
    const content = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(content);
    return sanitizeSettings(parsed, DEFAULT_SETTINGS);
  } catch {
    return sanitizeSettings(null, DEFAULT_SETTINGS);
  }
}

/**
 * Persist sanitized settings to settings.json, creating the target directory if needed.
 */
function saveSettings(settings, userDataDir) {
  const settingsPath = getSettingsPath(userDataDir);
  const sanitized = sanitizeSettings(settings, DEFAULT_SETTINGS);
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  return sanitized;
}

/**
 * Merge partial settings updates into persisted settings and save to disk.
 */
function updateSettings(partial, userDataDir) {
  const current = loadSettings(userDataDir);
  const merged = sanitizeSettings(partial, current);
  return saveSettings(merged, userDataDir);
}

/**
 * Return the default captures folder (<Pictures>/ScreenSnap) and ensure it exists.
 */
function getDefaultCapturesDir(picturesDir) {
  let basePicturesDir = picturesDir;
  if (!basePicturesDir) {
    const app = getElectronApp();
    try {
      basePicturesDir = app.getPath("pictures");
    } catch {
      basePicturesDir = path.join(app.getPath("home"), "Pictures");
    }
  }
  const capturesDir = path.join(basePicturesDir, "ScreenSnap");
  fs.mkdirSync(capturesDir, { recursive: true });
  return capturesDir;
}

module.exports = {
  DEFAULT_SETTINGS,
  MIN_GOST_OPACITY,
  MAX_GOST_OPACITY,
  getDefaultShortcuts,
  sanitizeAccelerator,
  getSettingsPath,
  sanitizeSettings,
  loadSettings,
  saveSettings,
  updateSettings,
  getDefaultCapturesDir,
};
