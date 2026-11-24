import { buildScreenshotFilename } from "../../shared/filename.mjs";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  MAX_PDF_PAGE_PT,
  buildPdfFromJpegs,
} from "../../shared/pdf-builder.mjs";

const infoLabel = document.getElementById("infoLabel");
const warningPill = document.getElementById("warningPill");
const btnNewCapture = document.getElementById("btnNewCapture");
const btnEmptyNewCapture = document.getElementById("btnEmptyNewCapture");
const emptyState = document.getElementById("emptyState");
const stageWrap = document.getElementById("stageWrap");
const canvasShell = document.getElementById("canvasShell");
const stageCanvas = document.getElementById("stageCanvas");
const stageCtx = stageCanvas.getContext("2d");
const floatingTextInput = document.getElementById("floatingTextInput");
const cropBar = document.getElementById("cropBar");
const cropInfo = document.getElementById("cropInfo");
const btnApplyCrop = document.getElementById("btnApplyCrop");
const btnCancelCrop = document.getElementById("btnCancelCrop");
const strokeSelect = document.getElementById("strokeSelect");
const colorPicker = document.getElementById("colorPicker");
const btnUndo = document.getElementById("btnUndo");
const btnRedo = document.getElementById("btnRedo");
const btnZoomOut = document.getElementById("btnZoomOut");
const btnZoomFit = document.getElementById("btnZoomFit");
const btnZoomIn = document.getElementById("btnZoomIn");
const btnCopy = document.getElementById("btnCopy");
const btnPng = document.getElementById("btnPng");
const btnJpeg = document.getElementById("btnJpeg");
const btnPdfMenu = document.getElementById("btnPdfMenu");
const pdfMenu = document.getElementById("pdfMenu");
const btnPdfSingle = document.getElementById("btnPdfSingle");
const btnPdfA4 = document.getElementById("btnPdfA4");
const toastEl = document.getElementById("toast");

const toolButtons = Array.from(document.querySelectorAll(".tool-btn"));
const swatches = Array.from(document.querySelectorAll(".swatch"));

const baseCanvas = document.createElement("canvas");
const baseCtx = baseCanvas.getContext("2d");

let captureMeta = { mode: "", title: "", dpr: 1, createdAt: Date.now() };
let hasCapture = false;
let currentTool = "pan";
let currentColor = "#ef4444";
let currentStroke = 4;
let zoom = 1;

let annotations = [];
let undoStack = [];
let redoStack = [];
let draftShape = null;
let cropRect = null;
let panState = null;
let pendingTextPos = null;
let toastTimer = null;
let toastDuration = 2400;
const AUTO_CLOSE_DELAY_MS = 350;
let autoCloseTimer = null;
let closingAfterExport = false;

function scheduleCloseAfterExport() {
  if (closingAfterExport) return;
  closingAfterExport = true;
  setExportEnabled(false);
  autoCloseTimer = setTimeout(() => {
    autoCloseTimer = null;
    if (window.screenSnap?.closeWindow) {
      window.screenSnap.closeWindow().catch(() => window.close());
    } else {
      window.close();
    }
  }, AUTO_CLOSE_DELAY_MS);
}

function scheduleToastHide(delayMs) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), delayMs);
}

function showToast(msg, action = null) {
  toastEl.replaceChildren();
  const textSpan = document.createElement("span");
  textSpan.textContent = msg;
  toastEl.appendChild(textSpan);

  if (action && action.label && typeof action.onClick === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
    });
    toastEl.appendChild(btn);
  }

  toastDuration = action ? 5500 : 2400;
  toastEl.classList.remove("hidden");
  scheduleToastHide(toastDuration);
}

toastEl.addEventListener("mouseenter", () => {
  clearTimeout(toastTimer);
});

toastEl.addEventListener("mouseleave", () => {
  if (!toastEl.classList.contains("hidden")) {
    scheduleToastHide(toastDuration);
  }
});

function setExportEnabled(enabled) {
  btnCopy.disabled = !enabled;
  btnPng.disabled = !enabled;
  btnJpeg.disabled = !enabled;
  btnPdfMenu.disabled = !enabled;
  btnZoomOut.disabled = !enabled;
  btnZoomFit.disabled = !enabled;
  btnZoomIn.disabled = !enabled;
}

function updateDimensionsUI() {
  if (!hasCapture) {
    btnUndo.disabled = true;
    btnRedo.disabled = true;
    return;
  }
  infoLabel.textContent = `${baseCanvas.width} × ${baseCanvas.height} px`;
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
}

function applyZoom(newZoom) {
  if (!hasCapture) return;
  zoom = Math.max(0.1, Math.min(3, newZoom));
  stageCanvas.style.width = `${Math.round(baseCanvas.width * zoom)}px`;
  stageCanvas.style.height = `${Math.round(baseCanvas.height * zoom)}px`;
  btnZoomFit.textContent = `${Math.round(zoom * 100)}%`;
}

function fitToViewport() {
  if (!hasCapture || !baseCanvas.width || !baseCanvas.height) return;
  const availW = Math.max(200, stageWrap.clientWidth - 48);
  const availH = Math.max(200, stageWrap.clientHeight - 48);
  const fitScale =
    baseCanvas.height > baseCanvas.width * 1.6
      ? Math.min(1, availW / baseCanvas.width)
      : Math.min(1, availW / baseCanvas.width, availH / baseCanvas.height);
  applyZoom(fitScale);
}

function setTool(tool) {
  commitPendingText();
  currentTool = tool;
  for (const btn of toolButtons) {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  }
  if (tool !== "crop") {
    cropRect = null;
    cropBar.classList.add("hidden");
    renderStage();
  } else {
    cropBar.classList.remove("hidden");
    cropInfo.textContent = "Arraste sobre a imagem para definir o recorte";
    btnApplyCrop.disabled = true;
  }

  stageCanvas.style.cursor =
    tool === "pan" ? "grab" : tool === "text" ? "text" : "crosshair";
}

function setColor(hex) {
  currentColor = hex;
  colorPicker.value = hex;
  for (const sw of swatches) {
    sw.classList.toggle("active", sw.dataset.color.toLowerCase() === hex.toLowerCase());
  }
}

function canvasCoords(e) {
  const r = stageCanvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) * stageCanvas.width) / r.width;
  const y = ((e.clientY - r.top) * stageCanvas.height) / r.height;
  return {
    x: Math.max(0, Math.min(stageCanvas.width, x)),
    y: Math.max(0, Math.min(stageCanvas.height, y)),
  };
}

function drawAnnotation(ctx, item) {
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (item.type === "rect") {
    const x = Math.min(item.x1, item.x2);
    const y = Math.min(item.y1, item.y2);
    const w = Math.abs(item.x2 - item.x1);
    const h = Math.abs(item.y2 - item.y1);
    ctx.strokeRect(x, y, w, h);
  } else if (item.type === "arrow") {
    const dx = item.x2 - item.x1;
    const dy = item.y2 - item.y1;
    const len = Math.hypot(dx, dy);
    if (len > 2) {
      const angle = Math.atan2(dy, dx);
      const headLen = Math.max(12, item.lineWidth * 4);
      const shaftEndX = item.x2 - Math.cos(angle) * headLen * 0.65;
      const shaftEndY = item.y2 - Math.sin(angle) * headLen * 0.65;

      ctx.beginPath();
      ctx.moveTo(item.x1, item.y1);
      ctx.lineTo(shaftEndX, shaftEndY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(item.x2, item.y2);
      ctx.lineTo(
        item.x2 - headLen * Math.cos(angle - Math.PI / 6),
        item.y2 - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        item.x2 - headLen * Math.cos(angle + Math.PI / 6),
        item.y2 - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }
  } else if (item.type === "pen" && item.points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(item.points[0].x, item.points[0].y);
    for (let i = 1; i < item.points.length; i++) {
      ctx.lineTo(item.points[i].x, item.points[i].y);
    }
    ctx.stroke();
  } else if (item.type === "text" && item.text) {
    const fontSize = item.fontSize || 20;
    ctx.font = `700 ${fontSize}px "Helvetica Neue", Helvetica, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = "top";
    ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.16));
    ctx.strokeStyle =
      item.color.toLowerCase() === "#ffffff" ? "rgba(21,28,8,0.88)" : "rgba(255,255,255,0.9)";
    ctx.strokeText(item.text, item.x, item.y);
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, item.x, item.y);
  }
  ctx.restore();
}

function renderStage() {
  if (!hasCapture || !baseCanvas.width || !baseCanvas.height) return;
  if (stageCanvas.width !== baseCanvas.width || stageCanvas.height !== baseCanvas.height) {
    stageCanvas.width = baseCanvas.width;
    stageCanvas.height = baseCanvas.height;
  }

  stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  stageCtx.drawImage(baseCanvas, 0, 0);

  for (const item of annotations) {
    drawAnnotation(stageCtx, item);
  }

  if (draftShape) {
    if (draftShape.type === "blur" || draftShape.type === "crop") {
      const r = normalizeRect(draftShape.x1, draftShape.y1, draftShape.x2, draftShape.y2);
      drawOverlaySelection(r, draftShape.type === "crop");
    } else {
      drawAnnotation(stageCtx, draftShape);
    }
  } else if (currentTool === "crop" && cropRect) {
    drawOverlaySelection(cropRect, true);
  }
}

function drawOverlaySelection(r, dimOutside) {
  stageCtx.save();
  if (dimOutside) {
    stageCtx.fillStyle = "rgba(21, 28, 8, 0.54)";
    stageCtx.fillRect(0, 0, stageCanvas.width, r.y);
    stageCtx.fillRect(0, r.y + r.h, stageCanvas.width, stageCanvas.height - (r.y + r.h));
    stageCtx.fillRect(0, r.y, r.x, r.h);
    stageCtx.fillRect(r.x + r.w, r.y, stageCanvas.width - (r.x + r.w), r.h);
  }
  stageCtx.strokeStyle = "#A4C639";
  stageCtx.lineWidth = Math.max(2, (captureMeta.dpr || 1) * 1.5);
  stageCtx.setLineDash([8, 5]);
  stageCtx.strokeRect(r.x, r.y, r.w, r.h);
  stageCtx.restore();
}

function normalizeRect(x1, y1, x2, y2) {
  const x = Math.round(Math.min(x1, x2));
  const y = Math.round(Math.min(y1, y2));
  const w = Math.round(Math.abs(x2 - x1));
  const h = Math.round(Math.abs(y2 - y1));
  return { x, y, w, h };
}

function applyPixelateBlur(rect) {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const w = Math.min(baseCanvas.width - x, rect.w);
  const h = Math.min(baseCanvas.height - y, rect.h);
  if (w < 4 || h < 4) return;

  const before = baseCtx.getImageData(x, y, w, h);
  const after = new ImageData(new Uint8ClampedArray(before.data), w, h);
  const block = Math.max(10, Math.round(12 * (captureMeta.dpr || 1)));
  const data = after.data;

  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const bw = Math.min(block, w - bx);
      const bh = Math.min(block, h - by);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const count = bw * bh;
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const idx = ((by + py) * w + (bx + px)) * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          a += data[idx + 3];
        }
      }
      const mr = Math.round(r / count);
      const mg = Math.round(g / count);
      const mb = Math.round(b / count);
      const ma = Math.round(a / count);
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const idx = ((by + py) * w + (bx + px)) * 4;
          data[idx] = mr;
          data[idx + 1] = mg;
          data[idx + 2] = mb;
          data[idx + 3] = ma;
        }
      }
    }
  }

  baseCtx.putImageData(after, x, y);
  undoStack.push({ kind: "patch", x, y, before, after });
  redoStack = [];
  updateDimensionsUI();
  renderStage();
}

async function applyCrop() {
  if (!hasCapture || !cropRect || cropRect.w < 4 || cropRect.h < 4) return;
  const x = Math.max(0, cropRect.x);
  const y = Math.max(0, cropRect.y);
  const w = Math.min(baseCanvas.width - x, cropRect.w);
  const h = Math.min(baseCanvas.height - y, cropRect.h);
  if (w < 4 || h < 4) return;

  const beforeBlob = await canvasToBlob(baseCanvas, "image/png");
  const beforeAnnotations = structuredClone(annotations);

  const composed = composeFinalCanvas();
  baseCanvas.width = w;
  baseCanvas.height = h;
  baseCtx.clearRect(0, 0, w, h);
  baseCtx.drawImage(composed, x, y, w, h, 0, 0, w, h);
  annotations = [];
  cropRect = null;

  const afterBlob = await canvasToBlob(baseCanvas, "image/png");
  undoStack.push({
    kind: "crop",
    beforeBlob,
    beforeAnnotations,
    afterBlob,
  });
  redoStack = [];

  setTool("pan");
  fitToViewport();
  updateDimensionsUI();
  renderStage();
  showToast("Recorte aplicado");
}

async function undo() {
  const action = undoStack.pop();
  if (!action) return;

  if (action.kind === "annotation") {
    annotations.pop();
    redoStack.push(action);
  } else if (action.kind === "patch") {
    baseCtx.putImageData(action.before, action.x, action.y);
    redoStack.push(action);
  } else if (action.kind === "crop") {
    const bmp = await createImageBitmap(action.beforeBlob);
    baseCanvas.width = bmp.width;
    baseCanvas.height = bmp.height;
    baseCtx.clearRect(0, 0, bmp.width, bmp.height);
    baseCtx.drawImage(bmp, 0, 0);
    bmp.close();
    annotations = structuredClone(action.beforeAnnotations);
    redoStack.push(action);
    fitToViewport();
  }

  updateDimensionsUI();
  renderStage();
}

async function redo() {
  const action = redoStack.pop();
  if (!action) return;

  if (action.kind === "annotation") {
    annotations.push(action.item);
    undoStack.push(action);
  } else if (action.kind === "patch") {
    baseCtx.putImageData(action.after, action.x, action.y);
    undoStack.push(action);
  } else if (action.kind === "crop") {
    const bmp = await createImageBitmap(action.afterBlob);
    baseCanvas.width = bmp.width;
    baseCanvas.height = bmp.height;
    baseCtx.clearRect(0, 0, bmp.width, bmp.height);
    baseCtx.drawImage(bmp, 0, 0);
    bmp.close();
    annotations = [];
    undoStack.push(action);
    fitToViewport();
  }

  updateDimensionsUI();
  renderStage();
}

function openTextAt(pos, clientX, clientY) {
  commitPendingText();
  const fontSize = Math.max(16, Math.round((currentStroke * 4 + 8) * (captureMeta.dpr || 1)));
  pendingTextPos = { x: pos.x, y: pos.y, fontSize, color: currentColor };

  const shellRect = stageCanvas.getBoundingClientRect();
  floatingTextInput.style.left = `${Math.max(4, clientX - shellRect.left)}px`;
  floatingTextInput.style.top = `${Math.max(4, clientY - shellRect.top)}px`;
  floatingTextInput.style.fontSize = `${Math.max(13, Math.round(fontSize * zoom))}px`;
  floatingTextInput.style.color = currentColor;
  floatingTextInput.value = "";
  floatingTextInput.classList.remove("hidden");
  floatingTextInput.focus();
}

function commitPendingText() {
  if (!pendingTextPos) return;
  const text = floatingTextInput.value.trim();
  const pos = pendingTextPos;
  pendingTextPos = null;
  floatingTextInput.classList.add("hidden");
  floatingTextInput.value = "";

  if (!text) return;
  const item = {
    type: "text",
    x: pos.x,
    y: pos.y,
    text,
    color: pos.color,
    fontSize: pos.fontSize,
  };
  annotations.push(item);
  undoStack.push({ kind: "annotation", item });
  redoStack = [];
  updateDimensionsUI();
  renderStage();
}

function composeFinalCanvas() {
  const out = document.createElement("canvas");
  out.width = baseCanvas.width;
  out.height = baseCanvas.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(baseCanvas, 0, 0);
  for (const item of annotations) {
    drawAnnotation(ctx, item);
  }
  return out;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao codificar imagem."))),
      type,
      quality
    );
  });
}

function makeFilename(extension) {
  const ext = String(extension).replace(/^\./, "");
  const label = captureMeta.title || captureMeta.mode || "captura";
  const stampDate = captureMeta.createdAt ? new Date(captureMeta.createdAt) : new Date();

  const tryTwoArg = () => buildScreenshotFilename(label, ext, stampDate);
  const tryThreeArg = () => buildScreenshotFilename(captureMeta.mode || "", label, ext, stampDate);

  const attempts =
    buildScreenshotFilename.length >= 3 ? [tryThreeArg, tryTwoArg] : [tryTwoArg, tryThreeArg];

  for (const fn of attempts) {
    try {
      const candidate = fn();
      if (typeof candidate === "string" && candidate.toLowerCase().endsWith(`.${ext}`)) {
        return candidate;
      }
    } catch {
      // Try next signature variant
    }
  }

  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${stampDate.getFullYear()}-${pad(stampDate.getMonth() + 1)}-${pad(stampDate.getDate())}_` +
    `${pad(stampDate.getHours())}-${pad(stampDate.getMinutes())}-${pad(stampDate.getSeconds())}`;
  return `ScreenSnap_${stamp}.${ext}`;
}

async function copyImage() {
  if (!hasCapture || closingAfterExport) return;
  const composed = composeFinalCanvas();
  const blob = await canvasToBlob(composed, "image/png");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const res = await window.screenSnap.copyPngToClipboard(bytes);
  if (res && res.ok === false) {
    throw new Error(res.error || "Falha ao copiar imagem.");
  }
  showToast("Imagem copiada para a área de transferência");
  scheduleCloseAfterExport();
}

async function saveBytesWithDialog(bytes, extension, filters) {
  const defaultFilename = makeFilename(extension);
  const res = await window.screenSnap.saveFile({
    bytes,
    defaultFilename,
    filters,
  });

  if (!res || res.canceled) {
    return;
  }
  if (res.ok === false) {
    throw new Error(res.error || "Não foi possível salvar o arquivo.");
  }

  const savedName = res.filePath ? res.filePath.split(/[\\/]/).pop() || defaultFilename : defaultFilename;
  showToast(`Salvo: ${savedName}`);
  scheduleCloseAfterExport();
}

async function exportPng() {
  if (!hasCapture || closingAfterExport) return;
  const composed = composeFinalCanvas();
  const blob = await canvasToBlob(composed, "image/png");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await saveBytesWithDialog(bytes, "png", [{ name: "Imagem PNG", extensions: ["png"] }]);
}

async function exportJpeg() {
  if (!hasCapture || closingAfterExport) return;
  const composed = composeFinalCanvas();
  const opaque = document.createElement("canvas");
  opaque.width = composed.width;
  opaque.height = composed.height;
  const ctx = opaque.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, opaque.width, opaque.height);
  ctx.drawImage(composed, 0, 0);
  const blob = await canvasToBlob(opaque, "image/jpeg", 0.92);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await saveBytesWithDialog(bytes, "jpg", [{ name: "Imagem JPEG", extensions: ["jpg", "jpeg"] }]);
}

async function exportPdf(layoutMode) {
  pdfMenu.classList.add("hidden");
  btnPdfMenu.setAttribute("aria-expanded", "false");
  if (!hasCapture || closingAfterExport) return;

  showToast("Gerando PDF...");
  const composed = composeFinalCanvas();
  const w = composed.width;
  const h = composed.height;

  const pages = [];
  if (layoutMode === "single") {
    const opaque = document.createElement("canvas");
    opaque.width = w;
    opaque.height = h;
    const ctx = opaque.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(composed, 0, 0);

    const jpegBlob = await canvasToBlob(opaque, "image/jpeg", 0.92);
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());

    let pageW = w * 0.75;
    let pageH = h * 0.75;
    const maxDim = Math.max(pageW, pageH);
    if (maxDim > MAX_PDF_PAGE_PT) {
      const ratio = MAX_PDF_PAGE_PT / maxDim;
      pageW *= ratio;
      pageH *= ratio;
    }

    pages.push({
      jpegBytes,
      pxWidth: w,
      pxHeight: h,
      pageWidthPt: pageW,
      pageHeightPt: pageH,
      drawXPt: 0,
      drawYPt: 0,
      drawWidthPt: pageW,
      drawHeightPt: pageH,
    });
  } else {
    const marginPt = 24;
    const usableW = A4_WIDTH_PT - marginPt * 2;
    const usableH = A4_HEIGHT_PT - marginPt * 2;
    const ptPerPx = usableW / w;
    const sliceMaxPxH = Math.max(1, Math.floor(usableH / ptPerPx));

    const sliceCanvas = document.createElement("canvas");
    const sliceCtx = sliceCanvas.getContext("2d");

    for (let sy = 0; sy < h; sy += sliceMaxPxH) {
      const sh = Math.min(sliceMaxPxH, h - sy);
      sliceCanvas.width = w;
      sliceCanvas.height = sh;
      sliceCtx.fillStyle = "#ffffff";
      sliceCtx.fillRect(0, 0, w, sh);
      sliceCtx.drawImage(composed, 0, sy, w, sh, 0, 0, w, sh);

      const jpegBlob = await canvasToBlob(sliceCanvas, "image/jpeg", 0.92);
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const drawH = sh * ptPerPx;

      pages.push({
        jpegBytes,
        pxWidth: w,
        pxHeight: sh,
        pageWidthPt: A4_WIDTH_PT,
        pageHeightPt: A4_HEIGHT_PT,
        drawXPt: marginPt,
        drawYPt: A4_HEIGHT_PT - marginPt - drawH,
        drawWidthPt: usableW,
        drawHeightPt: drawH,
      });
    }
  }

  const pdfBytes = buildPdfFromJpegs(pages);
  await saveBytesWithDialog(pdfBytes, "pdf", [{ name: "Documento PDF", extensions: ["pdf"] }]);
}

function showEmptyState(message = "Nenhuma captura carregada — clique em Nova captura") {
  hasCapture = false;
  infoLabel.textContent = message;
  canvasShell.classList.add("hidden");
  emptyState.classList.remove("hidden");
  setExportEnabled(false);
  updateDimensionsUI();
}

async function loadCapture() {
  if (!window.screenSnap?.getPendingCapture) {
    showEmptyState("API ScreenSnap indisponível");
    return;
  }

  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) {
    showEmptyState();
    return;
  }

  let capture = null;
  try {
    capture = await window.screenSnap.getPendingCapture(id);
  } catch {
    showEmptyState();
    return;
  }

  if (!capture || !capture.pngBytes) {
    showEmptyState();
    return;
  }

  const bytes =
    capture.pngBytes instanceof Uint8Array
      ? capture.pngBytes
      : new Uint8Array(capture.pngBytes);
  const blob = new Blob([bytes], { type: "image/png" });
  const bmp = await createImageBitmap(blob);

  baseCanvas.width = bmp.width;
  baseCanvas.height = bmp.height;
  baseCtx.clearRect(0, 0, bmp.width, bmp.height);
  baseCtx.drawImage(bmp, 0, 0);
  bmp.close();

  captureMeta = {
    mode: capture.mode || "",
    title: capture.title || "",
    dpr: capture.dpr || 1,
    createdAt: capture.createdAt || Date.now(),
  };

  if (capture.title) {
    document.title = `ScreenSnap — ${capture.title}`;
  }

  hasCapture = true;
  emptyState.classList.add("hidden");
  canvasShell.classList.remove("hidden");
  setExportEnabled(true);
  updateDimensionsUI();
  fitToViewport();
  renderStage();
}

stageCanvas.addEventListener("mousedown", (e) => {
  if (!hasCapture || e.button !== 0) return;
  if (currentTool === "text") {
    e.preventDefault();
    const pos = canvasCoords(e);
    openTextAt(pos, e.clientX, e.clientY);
    return;
  }

  commitPendingText();

  if (currentTool === "pan") {
    panState = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: stageWrap.scrollLeft,
      scrollTop: stageWrap.scrollTop,
    };
    stageCanvas.style.cursor = "grabbing";
    return;
  }

  const pos = canvasCoords(e);
  const scaledStroke = currentStroke * Math.max(1, captureMeta.dpr || 1);

  if (currentTool === "pen") {
    draftShape = {
      type: "pen",
      color: currentColor,
      lineWidth: scaledStroke,
      points: [pos],
    };
  } else {
    draftShape = {
      type: currentTool,
      color: currentColor,
      lineWidth: scaledStroke,
      x1: pos.x,
      y1: pos.y,
      x2: pos.x,
      y2: pos.y,
    };
  }
  renderStage();
});

window.addEventListener("mousemove", (e) => {
  if (panState) {
    stageWrap.scrollLeft = panState.scrollLeft - (e.clientX - panState.startX);
    stageWrap.scrollTop = panState.scrollTop - (e.clientY - panState.startY);
    return;
  }
  if (!draftShape) return;

  const pos = canvasCoords(e);
  if (draftShape.type === "pen") {
    draftShape.points.push(pos);
  } else {
    draftShape.x2 = pos.x;
    draftShape.y2 = pos.y;
  }
  renderStage();
});

window.addEventListener("mouseup", () => {
  if (panState) {
    panState = null;
    if (currentTool === "pan") stageCanvas.style.cursor = "grab";
    return;
  }
  if (!draftShape) return;

  const finished = draftShape;
  draftShape = null;

  if (finished.type === "crop") {
    const r = normalizeRect(finished.x1, finished.y1, finished.x2, finished.y2);
    if (r.w >= 8 && r.h >= 8) {
      cropRect = r;
      cropInfo.textContent = `Área selecionada: ${r.w} × ${r.h} px`;
      btnApplyCrop.disabled = false;
    } else {
      cropRect = null;
      btnApplyCrop.disabled = true;
    }
    renderStage();
    return;
  }

  if (finished.type === "blur") {
    const r = normalizeRect(finished.x1, finished.y1, finished.x2, finished.y2);
    applyPixelateBlur(r);
    return;
  }

  if (finished.type === "pen") {
    if (finished.points.length >= 2) {
      annotations.push(finished);
      undoStack.push({ kind: "annotation", item: finished });
      redoStack = [];
    }
  } else {
    const dist = Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1);
    if (dist >= 4) {
      annotations.push(finished);
      undoStack.push({ kind: "annotation", item: finished });
      redoStack = [];
    }
  }

  updateDimensionsUI();
  renderStage();
});

stageWrap.addEventListener(
  "wheel",
  (e) => {
    if (!hasCapture) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      applyZoom(zoom * (e.deltaY < 0 ? 1.12 : 0.89));
    }
  },
  { passive: false }
);

floatingTextInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    commitPendingText();
  } else if (e.key === "Escape") {
    e.preventDefault();
    pendingTextPos = null;
    floatingTextInput.classList.add("hidden");
    floatingTextInput.value = "";
  }
});

floatingTextInput.addEventListener("blur", () => {
  commitPendingText();
});

btnNewCapture.addEventListener("click", () => {
  window.screenSnap?.openLauncher();
});

btnEmptyNewCapture.addEventListener("click", () => {
  window.screenSnap?.openLauncher();
});

for (const btn of toolButtons) {
  btn.addEventListener("click", () => setTool(btn.dataset.tool));
}

for (const sw of swatches) {
  sw.addEventListener("click", () => setColor(sw.dataset.color));
}

colorPicker.addEventListener("input", (e) => setColor(e.target.value));
strokeSelect.addEventListener("change", (e) => {
  currentStroke = Number(e.target.value) || 4;
});

btnUndo.addEventListener("click", () => {
  undo().catch((err) => showToast(`Erro ao desfazer: ${err.message}`));
});
btnRedo.addEventListener("click", () => {
  redo().catch((err) => showToast(`Erro ao refazer: ${err.message}`));
});
btnApplyCrop.addEventListener("click", () => {
  applyCrop().catch((err) => showToast(`Erro ao recortar: ${err.message}`));
});
btnCancelCrop.addEventListener("click", () => setTool("pan"));

btnZoomOut.addEventListener("click", () => applyZoom(zoom * 0.85));
btnZoomIn.addEventListener("click", () => applyZoom(zoom * 1.18));
btnZoomFit.addEventListener("click", fitToViewport);

btnCopy.addEventListener("click", () =>
  copyImage().catch((err) => showToast(`Erro ao copiar: ${err.message}`))
);
btnPng.addEventListener("click", () =>
  exportPng().catch((err) => showToast(`Erro ao salvar PNG: ${err.message}`))
);
btnJpeg.addEventListener("click", () =>
  exportJpeg().catch((err) => showToast(`Erro ao salvar JPEG: ${err.message}`))
);

btnPdfMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  const hidden = pdfMenu.classList.toggle("hidden");
  btnPdfMenu.setAttribute("aria-expanded", String(!hidden));
});

document.addEventListener("click", () => {
  pdfMenu.classList.add("hidden");
  btnPdfMenu.setAttribute("aria-expanded", "false");
});

btnPdfSingle.addEventListener("click", () =>
  exportPdf("single").catch((err) => showToast(`Erro ao gerar PDF: ${err.message}`))
);
btnPdfA4.addEventListener("click", () =>
  exportPdf("a4").catch((err) => showToast(`Erro ao gerar PDF: ${err.message}`))
);

window.addEventListener("keydown", (e) => {
  if (document.activeElement === floatingTextInput) return;

  const ctrlOrCmd = e.ctrlKey || e.metaKey;
  if (ctrlOrCmd && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo().catch(() => {});
    else undo().catch(() => {});
    return;
  }
  if (ctrlOrCmd && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo().catch(() => {});
    return;
  }
  if (ctrlOrCmd && e.key.toLowerCase() === "c") {
    e.preventDefault();
    if (hasCapture) {
      copyImage().catch((err) => showToast(`Erro ao copiar: ${err.message}`));
    }
    return;
  }
  if (ctrlOrCmd && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (hasCapture) {
      exportPng().catch((err) => showToast(`Erro ao salvar PNG: ${err.message}`));
    }
    return;
  }
  if (e.key === "Enter" && currentTool === "crop" && cropRect) {
    e.preventDefault();
    applyCrop().catch((err) => showToast(`Erro ao recortar: ${err.message}`));
    return;
  }
  if (e.key === "Escape" && currentTool === "crop") {
    e.preventDefault();
    setTool("pan");
    return;
  }

  const shortcutTool = {
    v: "pan",
    c: "crop",
    r: "rect",
    a: "arrow",
    p: "pen",
    t: "text",
    b: "blur",
  }[e.key.toLowerCase()];
  if (!ctrlOrCmd && !e.altKey && shortcutTool) {
    setTool(shortcutTool);
  }
});

window.addEventListener("beforeunload", () => {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
});

setExportEnabled(false);
loadCapture().catch((err) => {
  showEmptyState();
  showToast(err?.message || "Erro ao carregar captura");
});
