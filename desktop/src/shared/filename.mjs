/**
 * Build a filesystem-safe export filename from a desktop capture source label and timestamp.
 * Format: ScreenSnap_<sanitized-label>_YYYY-MM-DD_HH-mm-ss.<ext>
 *
 * @param {string | null | undefined} sourceLabel
 * @param {string} extension
 * @param {Date} [now]
 * @returns {string}
 */
export function buildScreenshotFilename(sourceLabel, extension, now = new Date()) {
  const safeLabel = sanitizeLabel(sourceLabel) || "captura";
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();

  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;

  const cleanExt = sanitizeExtension(extension) || "png";
  return `ScreenSnap_${safeLabel}_${stamp}.${cleanExt}`;
}

function sanitizeLabel(text) {
  if (text === null || text === undefined) {
    return "";
  }
  const normalized = String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");

  return normalized.slice(0, 48).replace(/[-_.]+$/g, "");
}

function sanitizeExtension(extension) {
  if (extension === null || extension === undefined) {
    return "";
  }
  return String(extension)
    .trim()
    .replace(/^\.+/, "")
    .replace(/[<>:"/\\|?*\x00-\x1f\s]+/g, "");
}
