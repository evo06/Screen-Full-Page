"use strict";

/**
 * Lazily load Electron APIs so pure Node unit tests can import capture helpers safely.
 */
function getElectronModule() {
  const electronMod = require("electron");
  if (!electronMod || typeof electronMod !== "object") {
    throw new Error("Electron API unavailable outside Electron main process.");
  }
  return electronMod;
}

function createEmptyCaptureError(targetLabel) {
  if (process.platform === "darwin") {
    return new Error(
      `Não foi possível capturar ${targetLabel}. No macOS, verifique se a permissão de Gravação de Tela (Screen Recording) está habilitada em Ajustes do Sistema > Privacidade e Segurança.`
    );
  }
  return new Error(`Não foi possível capturar ${targetLabel}: nenhuma fonte de vídeo disponível.`);
}

/**
 * Map all connected displays into serializable metadata for the renderer.
 */
function listDisplaysInfo(electronScreen) {
  const screenApi = electronScreen || getElectronModule().screen;
  const primaryDisplay = screenApi.getPrimaryDisplay();
  const primaryId = primaryDisplay ? String(primaryDisplay.id) : null;

  return screenApi.getAllDisplays().map((display, index) => {
    const id = String(display.id);
    const primary = primaryId !== null ? id === primaryId : index === 0;
    const rawLabel = typeof display.label === "string" ? display.label.trim() : "";
    const label = rawLabel || (primary ? "Monitor principal" : `Monitor ${index + 1}`);
    const width = display.size?.width ?? display.bounds?.width ?? 0;
    const height = display.size?.height ?? display.bounds?.height ?? 0;
    const bounds = display.bounds
      ? {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        }
      : { x: 0, y: 0, width, height };

    return {
      id,
      label,
      primary,
      width,
      height,
      scaleFactor: Number(display.scaleFactor) || 1,
      bounds,
    };
  });
}

/**
 * Resolve a target display by ID, falling back to the cursor display or primary display.
 */
function resolveDisplay(displayId, electronScreen) {
  const screenApi = electronScreen || getElectronModule().screen;
  const displays = screenApi.getAllDisplays();

  if (displayId !== undefined && displayId !== null && String(displayId) !== "") {
    const matched = displays.find((d) => String(d.id) === String(displayId));
    if (matched) {
      return matched;
    }
  }

  try {
    const cursorPoint = screenApi.getCursorScreenPoint();
    const nearest = screenApi.getDisplayNearestPoint(cursorPoint);
    if (nearest) {
      return nearest;
    }
  } catch {
    // Fallback to primary display if cursor query is unavailable.
  }

  return screenApi.getPrimaryDisplay();
}

/**
 * Capture a full physical-resolution NativeImage of the specified display.
 */
async function captureDisplayImage(display, deps = {}) {
  const screenApi = deps.screen || getElectronModule().screen;
  const capturer = deps.desktopCapturer || getElectronModule().desktopCapturer;
  const targetDisplay = display || resolveDisplay(null, screenApi);

  const scaleFactor = Number(targetDisplay.scaleFactor) || 1;
  const logicalWidth = targetDisplay.size?.width ?? targetDisplay.bounds?.width ?? 1920;
  const logicalHeight = targetDisplay.size?.height ?? targetDisplay.bounds?.height ?? 1080;
  const physW = Math.max(1, Math.round(logicalWidth * scaleFactor));
  const physH = Math.max(1, Math.round(logicalHeight * scaleFactor));

  const sources = await capturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: physW, height: physH },
  });

  if (!Array.isArray(sources) || sources.length === 0) {
    throw createEmptyCaptureError("o monitor");
  }

  const targetId = String(targetDisplay.id);
  let source = sources.find((s) => s.display_id && String(s.display_id) === targetId);

  if (!source) {
    const displays = screenApi.getAllDisplays();
    const displayIndex = displays.findIndex((d) => String(d.id) === targetId);
    if (displayIndex >= 0 && sources[displayIndex]) {
      source = sources[displayIndex];
    }
  }

  if (!source) {
    source = sources[0];
  }

  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
    throw createEmptyCaptureError("o monitor");
  }

  return source.thumbnail;
}

/**
 * Scale and clamp a single axis crop range so start >= 0, size >= 1, and start + size <= maxDimension.
 */
function clampAxisCrop(offset, length, scale, maxDimension) {
  const rawStart = Math.round((Number(offset) || 0) * scale);
  const rawSize = Math.round((Number(length) || 0) * scale);
  const start = Math.max(0, Math.min(rawStart, maxDimension - 1));
  const end = Math.max(start + 1, Math.min(maxDimension, rawStart + Math.max(1, rawSize)));
  const size = Math.max(1, Math.min(maxDimension - start, end - start));
  return { start, size };
}

/**
 * Crop a NativeImage using logical viewport coordinates scaled to the image's pixel dimensions.
 */
function cropNativeImage(img, rect, viewportWidth, viewportHeight) {
  if (!img || typeof img.getSize !== "function" || typeof img.crop !== "function") {
    throw new Error("Imagem inválida para recorte.");
  }
  if (!rect || typeof rect !== "object") {
    throw new Error("Retângulo de recorte inválido.");
  }

  const imgSize = img.getSize();
  const imgW = Number(imgSize?.width) || 0;
  const imgH = Number(imgSize?.height) || 0;
  if (imgW < 1 || imgH < 1) {
    throw new Error("A imagem capturada possui dimensões inválidas.");
  }

  const vpW = Number(viewportWidth) > 0 ? Number(viewportWidth) : imgW;
  const vpH = Number(viewportHeight) > 0 ? Number(viewportHeight) : imgH;
  const scaleX = imgW / vpW;
  const scaleY = imgH / vpH;

  const horizontal = clampAxisCrop(rect.x, rect.width, scaleX, imgW);
  const vertical = clampAxisCrop(rect.y, rect.height, scaleY, imgH);

  return img.crop({
    x: horizontal.start,
    y: vertical.start,
    width: horizontal.size,
    height: vertical.size,
  });
}

/**
 * List capturable desktop windows with preview thumbnails and icons, excluding ScreenSnap windows.
 */
async function listWindowSources(electronDesktopCapturer) {
  const capturer = electronDesktopCapturer || getElectronModule().desktopCapturer;
  const sources = await capturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 380, height: 240 },
    fetchWindowIcons: true,
  });

  if (!Array.isArray(sources)) {
    return [];
  }

  return sources
    .filter((source) => {
      if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
        return false;
      }
      const name = typeof source.name === "string" ? source.name.trim() : "";
      if (/^ScreenSnap/i.test(name)) {
        return false;
      }
      return true;
    })
    .map((source) => ({
      id: source.id,
      name: source.name || "Janela sem título",
      thumbnailDataUrl: source.thumbnail.toDataURL(),
      appIconDataUrl:
        source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    }));
}

/**
 * Capture a high-resolution NativeImage for a specific window source ID.
 */
async function captureWindowSource(sourceId, electronDesktopCapturer) {
  if (!sourceId || typeof sourceId !== "string") {
    throw new Error("Nenhuma janela foi selecionada para captura.");
  }

  const capturer = electronDesktopCapturer || getElectronModule().desktopCapturer;
  const sources = await capturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 3840, height: 2160 },
  });

  if (!Array.isArray(sources) || sources.length === 0) {
    throw createEmptyCaptureError("a janela selecionada");
  }

  const source = sources.find((s) => s.id === sourceId);
  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
    if (process.platform === "darwin") {
      throw createEmptyCaptureError("a janela selecionada");
    }
    throw new Error(
      "Não foi possível capturar a janela selecionada. Verifique se ela não foi fechada ou minimizada."
    );
  }

  return source.thumbnail;
}

module.exports = {
  listDisplaysInfo,
  resolveDisplay,
  captureDisplayImage,
  cropNativeImage,
  listWindowSources,
  captureWindowSource,
};
