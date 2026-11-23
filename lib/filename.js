/**
 * Build a filesystem-safe download filename from tab metadata and timestamp.
 * @param {string} pageUrl
 * @param {string} pageTitle
 * @param {string} extension
 * @param {Date} [now]
 * @returns {string}
 */
export function buildScreenshotFilename(pageUrl, pageTitle, extension, now = new Date()) {
  let host = "pagina";
  try {
    if (pageUrl) {
      const parsed = new URL(pageUrl);
      host = parsed.hostname.replace(/^www\./i, "") || "pagina";
    }
  } catch {
    host = "pagina";
  }

  const cleanTitle = sanitizeSegment(pageTitle || host).slice(0, 48);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const base = cleanTitle ? `ScreenSnap_${cleanTitle}_${stamp}` : `ScreenSnap_${stamp}`;
  return `${base}.${extension.replace(/^\./, "")}`;
}

function sanitizeSegment(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
}
