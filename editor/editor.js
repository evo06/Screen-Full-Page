import { getCapture } from "../lib/capture-store.js";
import { buildScreenshotFilename } from "../lib/filename.js";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  MAX_PDF_PAGE_PT,
  buildPdfFromJpegs,
} from "../lib/pdf-builder.js";

const MAX_CANVAS_SIDE = 16384;

const infoLabel = document.getElementById("infoLabel");
const warningPill = document.getElementById("warningPill");
const stageWrap = document.getElementById("stageWrap");
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

let captureMeta = { url: "", title: "", dpr: 1 };
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

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2400);
}

function updateDimensionsUI() {
  infoLabel.textContent = `${baseCanvas.width} × ${baseCanvas.height} px`;
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
}

function applyZoom(newZoom) {
  zoom = Math.max(0.1, Math.min(3, newZoom));
  stageCanvas.style.width = `${Math.round(baseCanvas.width * zoom)}px`;
  stageCanvas.style.height = `${Math.round(baseCanvas.height * zoom)}px`;
  btnZoomFit.textContent = `${Math.round(zoom * 100)}%`;
}

function fitToViewport() {
  if (!baseCanvas.width || !baseCanvas.height) return;
  const availW = Math.max(200, stageWrap.clientWidth - 48);
  const availH = Math.max(200, stageWrap.clientHeight - 48);
  // For tall full-page captures, fit comfortably to width up to 100%
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
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = "top";
    // Subtle contrast outline so text remains legible over light or dark content
    ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.16));
    ctx.strokeStyle =
      item.color.toLowerCase() === "#ffffff" ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)";
    ctx.strokeText(item.text, item.x, item.y);
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, item.x, item.y);
  }
  ctx.restore();
}

function renderStage() {
  if (!baseCanvas.width || !baseCanvas.height) return;
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
    stageCtx.fillStyle = "rgba(15, 23, 42, 0.5)";
    stageCtx.fillRect(0, 0, stageCanvas.width, r.y);
    stageCtx.fillRect(0, r.y + r.h, stageCanvas.width, stageCanvas.height - (r.y + r.h));
    stageCtx.fillRect(0, r.y, r.x, r.h);
    stageCtx.fillRect(r.x + r.w, r.y, stageCanvas.width - (r.x + r.w), r.h);
  }
  stageCtx.strokeStyle = "#38bdf8";
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
      let r = 0, g = 0, b = 0, a = 0;
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
  if (!cropRect || cropRect.w < 4 || cropRect.h < 4) return;
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

async function copyImage() {
  const composed = composeFinalCanvas();
  const blob = await canvasToBlob(composed, "image/png");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  showToast("Imagem copiada para a área de transferência");
}

async function downloadBlob(blob, extension) {
  const filename = buildScreenshotFilename(captureMeta.url, captureMeta.title, extension);
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
    showToast(`Salvo: ${filename}`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

async function exportPng() {
  const composed = composeFinalCanvas();
  const blob = await canvasToBlob(composed, "image/png");
  await downloadBlob(blob, "png");
}

async function exportJpeg() {
  const composed = composeFinalCanvas();
  const opaque = document.createElement("canvas");
  opaque.width = composed.width;
  opaque.height = composed.height;
  const ctx = opaque.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, opaque.width, opaque.height);
  ctx.drawImage(composed, 0, 0);
  const blob = await canvasToBlob(opaque, "image/jpeg", 0.92);
  await downloadBlob(blob, "jpg");
}

async function exportPdf(layoutMode) {
  pdfMenu.classList.add("hidden");
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
  const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
  await downloadBlob(pdfBlob, "pdf");
}

async function loadCapture() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) {
    infoLabel.textContent = "ID da captura ausente";
    return;
  }

  const capture = await getCapture(id);
  if (!capture || !capture.slices?.length) {
    infoLabel.textContent = "Captura expirada ou não encontrada";
    return;
  }

  captureMeta = {
    url: capture.url || "",
    title: capture.title || "",
    dpr: capture.dpr || 1,
  };
  if (capture.title) {
    document.title = `ScreenSnap — ${capture.title}`;
  }

  if (capture.truncated) {
    warningPill.textContent = capture.abortedByUser
      ? "Captura interrompida (Esc) — trecho parcial"
      : "Página muito longa — limitada por segurança";
    warningPill.classList.remove("hidden");
  }

  if (capture.mode === "visible") {
    const bmp = await createImageBitmap(capture.slices[0].blob);
    baseCanvas.width = bmp.width;
    baseCanvas.height = bmp.height;
    baseCtx.drawImage(bmp, 0, 0);
    bmp.close();
  } else if (capture.mode === "selection") {
    const bmp = await createImageBitmap(capture.slices[0].blob);
    const scaleX = capture.viewportWidth ? bmp.width / capture.viewportWidth : captureMeta.dpr;
    const scaleY = capture.viewportHeight ? bmp.height / capture.viewportHeight : captureMeta.dpr;
    const r = capture.cropRect;
    const sx = Math.max(0, Math.round(r.x * scaleX));
    const sy = Math.max(0, Math.round(r.y * scaleY));
    const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(r.width * scaleX)));
    const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(r.height * scaleY)));
    baseCanvas.width = sw;
    baseCanvas.height = sh;
    baseCtx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    bmp.close();
  } else if (capture.mode === "fullpage") {
    await stitchFullPage(capture);
  }

  updateDimensionsUI();
  fitToViewport();
  renderStage();
}

async function stitchFullPage(capture) {
  const firstBmp = await createImageBitmap(capture.slices[0].blob);
  const scaleX = capture.viewportWidth ? firstBmp.width / capture.viewportWidth : captureMeta.dpr;
  const scaleY = capture.viewportHeight ? firstBmp.height / capture.viewportHeight : captureMeta.dpr;

  if (capture.isRoot !== false) {
    let maxRightPx = Math.round(capture.totalWidth * scaleX);
    let maxBottomPx = Math.round(capture.totalHeight * scaleY);
    for (const s of capture.slices) {
      maxRightPx = Math.max(maxRightPx, Math.round(s.x * scaleX) + firstBmp.width);
      maxBottomPx = Math.max(maxBottomPx, Math.round(s.y * scaleY) + firstBmp.height);
    }
    const targetW = Math.min(MAX_CANVAS_SIDE, Math.max(1, maxRightPx));
    const targetH = Math.min(MAX_CANVAS_SIDE, Math.max(1, maxBottomPx));

    if (maxBottomPx > MAX_CANVAS_SIDE || maxRightPx > MAX_CANVAS_SIDE) {
      warningPill.textContent = `Altura limitada a ${MAX_CANVAS_SIDE}px pelo canvas (use PDF A4 se precisar)`;
      warningPill.classList.remove("hidden");
    }

    baseCanvas.width = targetW;
    baseCanvas.height = targetH;
    baseCtx.fillStyle = "#ffffff";
    baseCtx.fillRect(0, 0, targetW, targetH);
    baseCtx.drawImage(firstBmp, Math.round(capture.slices[0].x * scaleX), Math.round(capture.slices[0].y * scaleY));
    firstBmp.close();

    for (let i = 1; i < capture.slices.length; i++) {
      const s = capture.slices[i];
      const bmp = await createImageBitmap(s.blob);
      const dx = Math.round(s.x * scaleX);
      const dy = Math.round(s.y * scaleY);
      if (dy < targetH && dx < targetW) {
        baseCtx.drawImage(bmp, dx, dy);
      }
      bmp.close();
    }
  } else {
    // Inner scroll container stitching: keep outer chrome from slice 0, stitch container slices
    const cr = capture.containerRect;
    const targetW = Math.min(
      MAX_CANVAS_SIDE,
      Math.max(firstBmp.width, Math.round((cr.left + capture.totalWidth) * scaleX))
    );
    const targetH = Math.min(
      MAX_CANVAS_SIDE,
      Math.max(firstBmp.height, Math.round((cr.top + capture.totalHeight) * scaleY))
    );

    baseCanvas.width = targetW;
    baseCanvas.height = targetH;
    baseCtx.fillStyle = "#ffffff";
    baseCtx.fillRect(0, 0, targetW, targetH);
    baseCtx.drawImage(firstBmp, 0, 0);
    firstBmp.close();

    const sx = Math.round(cr.left * scaleX);
    const sy = Math.round(cr.top * scaleY);
    const sw = Math.round(cr.width * scaleX);
    const sh = Math.round(cr.height * scaleY);

    for (let i = 0; i < capture.slices.length; i++) {
      const s = capture.slices[i];
      const bmp = await createImageBitmap(s.blob);
      const dx = sx + Math.round(s.x * scaleX);
      const dy = sy + Math.round(s.y * scaleY);
      if (dy < targetH && dx < targetW) {
        baseCtx.drawImage(bmp, sx, sy, sw, sh, dx, dy, sw, sh);
      }
      bmp.close();
    }
  }
}

// Mouse / Pointer interactions on canvas
stageCanvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
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

// Controls wiring
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

btnUndo.addEventListener("click", undo);
btnRedo.addEventListener("click", redo);
btnApplyCrop.addEventListener("click", applyCrop);
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
  pdfMenu.classList.toggle("hidden");
});
document.addEventListener("click", () => pdfMenu.classList.add("hidden"));
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
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (ctrlOrCmd && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
    return;
  }
  if (ctrlOrCmd && e.key.toLowerCase() === "c") {
    e.preventDefault();
    copyImage().catch(() => {});
    return;
  }
  if (e.key === "Enter" && currentTool === "crop" && cropRect) {
    e.preventDefault();
    applyCrop();
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

loadCapture().catch((err) => {
  infoLabel.textContent = "Erro ao carregar captura";
  showToast(err?.message || "Erro inesperado");
});
