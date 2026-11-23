import { saveCapture } from "./lib/capture-store.js";

const MENU_IDS = {
  SELECTION: "screensnap-capture-selection",
  VISIBLE: "screensnap-capture-visible",
  FULLPAGE: "screensnap-capture-fullpage",
};

const CAPTURE_MIN_INTERVAL_MS = 560;
const MAX_FULLPAGE_SLICES = 45;

let lastCaptureTimestamp = 0;
let activeCaptureTabId = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.SELECTION,
      title: "ScreenSnap: Capturar área selecionada",
      contexts: ["page", "selection", "image", "link"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.VISIBLE,
      title: "ScreenSnap: Capturar parte visível",
      contexts: ["page", "selection", "image", "link"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.FULLPAGE,
      title: "ScreenSnap: Capturar página inteira",
      contexts: ["page", "selection", "image", "link"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const modeMap = {
    [MENU_IDS.SELECTION]: "selection",
    [MENU_IDS.VISIBLE]: "visible",
    [MENU_IDS.FULLPAGE]: "fullpage",
  };
  const mode = modeMap[info.menuItemId];
  if (mode) {
    await startCaptureFlow({ mode, tab, delaySeconds: 0 }).catch(console.error);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === "capture-visible") {
    await startCaptureFlow({ mode: "visible", tab, delaySeconds: 0 }).catch(console.error);
  } else if (command === "capture-selection") {
    await startCaptureFlow({ mode: "selection", tab, delaySeconds: 0 }).catch(console.error);
  } else if (command === "capture-fullpage") {
    await startCaptureFlow({ mode: "fullpage", tab, delaySeconds: 0 }).catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "START_CAPTURE") {
    (async () => {
      try {
        const tab = message.tabId
          ? await chrome.tabs.get(message.tabId)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (!tab?.id) throw new Error("Nenhuma aba ativa encontrada.");
        assertCapturableUrl(tab.url);
        const delay = Number(message.delaySeconds) || 0;
        if (message.mode === "selection" && delay === 0) {
          await startCaptureFlow({ mode: "selection", tab, delaySeconds: 0 });
          sendResponse({ ok: true });
        } else {
          // Acknowledge immediately so popup can close cleanly before delayed/scroll capture
          sendResponse({ ok: true });
          await startCaptureFlow({
            mode: message.mode,
            tab,
            delaySeconds: delay,
          }).catch(async (err) => {
            console.error("Falha na captura:", err);
            await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#ef4444" }).catch(() => {});
            await chrome.action.setBadgeText({ tabId: tab.id, text: "ERR" }).catch(() => {});
            setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {}), 4000);
          });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === "SELECTION_CONFIRMED" && sender.tab?.id) {
    (async () => {
      try {
        await finishSelectionCapture(sender.tab, message);
        sendResponse({ ok: true });
      } catch (err) {
        console.error("Erro ao finalizar seleção:", err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  return false;
});

/**
 * Validate whether Chrome allows scripting and visible capture on the URL.
 * @param {string | undefined} url
 */
export function assertCapturableUrl(url) {
  if (!url) {
    throw new Error("Não foi possível identificar a URL desta aba.");
  }
  const blockedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "view-source:",
    "devtools://",
  ];
  const lower = url.toLowerCase();
  if (blockedPrefixes.some((p) => lower.startsWith(p))) {
    throw new Error("Páginas internas do navegador não podem ser capturadas por política de segurança.");
  }
  if (
    lower.startsWith("https://chrome.google.com/webstore") ||
    lower.startsWith("https://chromewebstore.google.com") ||
    lower.startsWith("https://microsoftedge.microsoft.com/addons")
  ) {
    throw new Error("Lojas de extensões bloqueiam scripts e capturas por segurança do navegador.");
  }
}

async function startCaptureFlow({ mode, tab, delaySeconds }) {
  assertCapturableUrl(tab.url);

  if (activeCaptureTabId !== null && activeCaptureTabId === tab.id) {
    throw new Error("Já existe uma captura em andamento nesta aba.");
  }

  if (delaySeconds > 0) {
    await runCountdownBadge(tab.id, delaySeconds);
  }

  if (mode === "visible") {
    await captureVisible(tab);
  } else if (mode === "selection") {
    await injectSelectionOverlay(tab);
  } else if (mode === "fullpage") {
    await captureFullPage(tab);
  } else {
    throw new Error(`Modo de captura desconhecido: ${mode}`);
  }
}

async function runCountdownBadge(tabId, seconds) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
  for (let remaining = seconds; remaining > 0; remaining--) {
    await chrome.action.setBadgeText({ tabId, text: `${remaining}s` });
    await sleep(1000);
  }
  await chrome.action.setBadgeText({ tabId, text: "" });
}

async function captureVisible(tab) {
  const [{ result: metrics }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      dpr: window.devicePixelRatio || 1,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }),
  });

  const blob = await captureTabPngBlob(tab.windowId);
  const id = makeId();
  await saveCapture({
    id,
    createdAt: Date.now(),
    mode: "visible",
    title: tab.title || "",
    url: tab.url || "",
    dpr: metrics?.dpr || 1,
    viewportWidth: metrics?.viewportWidth || 0,
    viewportHeight: metrics?.viewportHeight || 0,
    totalWidth: metrics?.viewportWidth || 0,
    totalHeight: metrics?.viewportHeight || 0,
    slices: [{ blob, x: 0, y: 0 }],
  });
  await openEditorTab(tab, id);
}

async function injectSelectionOverlay(tab) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/selection-overlay.js"],
  });
}

async function finishSelectionCapture(tab, payload) {
  const blob = await captureTabPngBlob(tab.windowId);
  const id = makeId();
  await saveCapture({
    id,
    createdAt: Date.now(),
    mode: "selection",
    title: tab.title || "",
    url: tab.url || "",
    dpr: payload.dpr || 1,
    viewportWidth: payload.viewportWidth || 0,
    viewportHeight: payload.viewportHeight || 0,
    totalWidth: payload.rect.width,
    totalHeight: payload.rect.height,
    cropRect: payload.rect,
    slices: [{ blob, x: 0, y: 0 }],
  });
  await openEditorTab(tab, id);
}

async function captureFullPage(tab) {
  activeCaptureTabId = tab.id;
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#0ea5e9" });
  await chrome.action.setBadgeText({ tabId: tab.id, text: "..." });

  let prepared = false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/fullpage-scroller.js"],
    });

    const info = await chrome.tabs.sendMessage(tab.id, { type: "PREPARE_FULLPAGE" });
    if (!info?.ok) {
      throw new Error(info?.error || "Não foi possível preparar a rolagem da página.");
    }
    prepared = true;

    const {
      dpr,
      isRoot,
      viewportWidth,
      viewportHeight,
      totalWidth,
      totalHeight,
      containerRect,
    } = info;

    const stepX = isRoot ? viewportWidth : Math.max(1, containerRect.width);
    const stepY = isRoot ? viewportHeight : Math.max(1, containerRect.height);

    const xs = buildAxisPositions(totalWidth, stepX);
    const ys = buildAxisPositions(totalHeight, stepY);

    const plannedSteps = [];
    for (const y of ys) {
      for (const x of xs) {
        if (plannedSteps.length >= MAX_FULLPAGE_SLICES) break;
        plannedSteps.push({ x, y });
      }
      if (plannedSteps.length >= MAX_FULLPAGE_SLICES) break;
    }

    const slices = [];
    let truncated = xs.length * ys.length > MAX_FULLPAGE_SLICES;
    let abortedByUser = false;

    for (let i = 0; i < plannedSteps.length; i++) {
      const target = plannedSteps[i];
      await chrome.action.setBadgeText({
        tabId: tab.id,
        text: `${i + 1}/${plannedSteps.length}`,
      });

      const stepRes = await chrome.tabs.sendMessage(tab.id, {
        type: "SCROLL_TO",
        x: target.x,
        y: target.y,
        hideFixed: i > 0,
      });

      if (!stepRes?.ok) {
        throw new Error(stepRes?.error || "Falha ao rolar a página.");
      }
      if (stepRes.aborted) {
        abortedByUser = true;
        break;
      }

      const blob = await captureTabPngBlob(tab.windowId);
      slices.push({
        blob,
        x: stepRes.actualX,
        y: stepRes.actualY,
      });
    }

    if (slices.length === 0) {
      return;
    }

    const id = makeId();
    await saveCapture({
      id,
      createdAt: Date.now(),
      mode: "fullpage",
      title: tab.title || "",
      url: tab.url || "",
      dpr,
      isRoot,
      viewportWidth,
      viewportHeight,
      totalWidth,
      totalHeight,
      containerRect: containerRect || null,
      truncated: truncated || abortedByUser,
      abortedByUser,
      slices,
    });

    await openEditorTab(tab, id);
  } finally {
    if (prepared) {
      await chrome.tabs.sendMessage(tab.id, { type: "RESTORE_FULLPAGE" }).catch(() => {});
    }
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {});
    activeCaptureTabId = null;
  }
}

function buildAxisPositions(total, step) {
  if (total <= step + 2) return [0];
  const positions = [];
  for (let pos = 0; pos < total - step; pos += step) {
    positions.push(pos);
  }
  const last = Math.max(0, total - step);
  if (positions.length === 0 || positions[positions.length - 1] !== last) {
    positions.push(last);
  }
  return positions;
}

async function captureTabPngBlob(windowId) {
  const elapsed = Date.now() - lastCaptureTimestamp;
  if (elapsed < CAPTURE_MIN_INTERVAL_MS) {
    await sleep(CAPTURE_MIN_INTERVAL_MS - elapsed);
  }

  let dataUrl;
  try {
    lastCaptureTimestamp = Date.now();
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")) {
      await sleep(700);
      lastCaptureTimestamp = Date.now();
      dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    } else {
      throw err;
    }
  }

  const res = await fetch(dataUrl);
  return await res.blob();
}

async function openEditorTab(sourceTab, captureId) {
  const editorUrl = chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(captureId)}`);
  await chrome.tabs.create({
    url: editorUrl,
    index: typeof sourceTab.index === "number" ? sourceTab.index + 1 : undefined,
    active: true,
  });
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
