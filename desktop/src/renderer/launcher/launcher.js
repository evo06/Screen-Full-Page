(function () {
  "use strict";

  const versionPill = document.getElementById("versionPill");
  const statusSubtitle = document.getElementById("statusSubtitle");
  const errorBanner = document.getElementById("errorBanner");
  const countdownBanner = document.getElementById("countdownBanner");
  const countdownText = document.getElementById("countdownText");
  const countdownValue = document.getElementById("countdownValue");

  const btnMinimize = document.getElementById("btnMinimize");
  const btnClose = document.getElementById("btnClose");
  const btnRegion = document.getElementById("btnRegion");
  const btnScreen = document.getElementById("btnScreen");
  const btnWindow = document.getElementById("btnWindow");

  const kbdRegion = document.getElementById("kbdRegion");
  const kbdScreen = document.getElementById("kbdScreen");
  const kbdWindow = document.getElementById("kbdWindow");

  const displayRow = document.getElementById("displayRow");
  const displaySelect = document.getElementById("displaySelect");

  const windowPicker = document.getElementById("windowPicker");
  const windowList = document.getElementById("windowList");
  const btnRefreshWindows = document.getElementById("btnRefreshWindows");

  const toggleGost = document.getElementById("toggleGost");
  const gostOpacityRow = document.getElementById("gostOpacityRow");
  const gostOpacitySlider = document.getElementById("gostOpacitySlider");
  const gostOpacityValue = document.getElementById("gostOpacityValue");

  const delayPills = Array.from(document.querySelectorAll(".delay-pill"));
  const toggleTrayOnClose = document.getElementById("toggleTrayOnClose");
  const btnOpenFolder = document.getElementById("btnOpenFolder");

  const btnToggleShortcuts = document.getElementById("btnToggleShortcuts");
  const shortcutsPanel = document.getElementById("shortcutsPanel");
  const shortcutRecordButtons = Array.from(document.querySelectorAll(".shortcut-record-btn"));
  const presetPills = Array.from(document.querySelectorAll(".preset-pill"));
  const winShiftStatus = document.getElementById("winShiftStatus");
  const winShiftScriptRow = document.getElementById("winShiftScriptRow");
  const btnRunWinShiftScript = document.getElementById("btnRunWinShiftScript");
  const winShiftGuide = document.getElementById("winShiftGuide");
  const winShiftRegPath = document.getElementById("winShiftRegPath");
  const btnCopyRegPath = document.getElementById("btnCopyRegPath");
  const shortcutFeedback = document.getElementById("shortcutFeedback");
  const btnResetShortcuts = document.getElementById("btnResetShortcuts");

  const actionButtons = [btnRegion, btnScreen, btnWindow];

  const BARE_MODIFIER_KEYS = new Set([
    "Control",
    "Shift",
    "Alt",
    "Meta",
    "OS",
    "AltGraph",
    "CapsLock",
    "NumLock",
    "ScrollLock",
  ]);

  const SPECIAL_KEY_MAP = {
    Tab: "Tab",
    Enter: "Enter",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    Delete: "Delete",
    Backspace: "Backspace",
    Minus: "-",
    Equal: "=",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
  };

  let currentPlatform = "win32";
  let currentShortcuts = null;
  let selectedDelay = 0;
  let traySettingKey = "minimizeToTray";
  let delaySettingKey = "delaySeconds";
  let isCapturing = false;
  let recordingAction = null;
  let unsubCountdown = null;
  let unsubCaptureError = null;
  let unsubOpenWindowPicker = null;
  let unsubSettingsChanged = null;

  function showError(msg) {
    if (!msg) {
      clearError();
      return;
    }
    errorBanner.textContent = msg;
    errorBanner.classList.remove("hidden");
  }

  function clearError() {
    errorBanner.textContent = "";
    errorBanner.classList.add("hidden");
  }

  function setBusy(busy) {
    isCapturing = busy;
    for (const btn of actionButtons) {
      btn.disabled = busy;
    }
    displaySelect.disabled = busy;
    btnRefreshWindows.disabled = busy;
    for (const item of windowList.querySelectorAll(".window-item")) {
      item.disabled = busy;
    }
  }

  function formatShortcut(raw, platform, fallback) {
    if (!raw || typeof raw !== "string") return fallback;
    const plat = platform || currentPlatform || "win32";
    const cmdOrCtrlLabel = plat === "darwin" ? "Cmd" : "Ctrl";
    const superLabel = plat === "darwin" ? "Cmd" : plat === "win32" ? "Win" : "Super";

    const tokens = raw
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === "printscreen" || lower === "prtsc") return "PrtSc";
        if (lower === "commandorcontrol" || lower === "cmdorctrl") return cmdOrCtrlLabel;
        if (lower === "control" || lower === "ctrl") return "Ctrl";
        if (lower === "command" || lower === "cmd") return "Cmd";
        if (lower === "super" || lower === "meta") return superLabel;
        if (lower === "alt" || lower === "option") return plat === "darwin" ? "Option" : "Alt";
        if (lower === "shift") return "Shift";
        if (part.length === 1) return part.toUpperCase();
        return part;
      });

    return tokens.length > 0 ? tokens.join("+") : fallback;
  }

  function showShortcutFeedback(msg, isError = false) {
    if (!msg) {
      shortcutFeedback.textContent = "";
      shortcutFeedback.classList.add("hidden");
      shortcutFeedback.classList.remove("is-error", "is-success");
      return;
    }
    shortcutFeedback.textContent = msg;
    shortcutFeedback.classList.remove("hidden", "is-error", "is-success");
    shortcutFeedback.classList.add(isError ? "is-error" : "is-success");
  }

  function applyShortcutsUI(shortcuts, platform) {
    const plat = platform || currentPlatform || "win32";
    currentShortcuts = shortcuts || currentShortcuts || {};
    const status = currentShortcuts.status || {};

    const regionAcc = currentShortcuts.region || status.region?.accelerator || "PrintScreen";
    const screenAcc =
      currentShortcuts.screen || status.screen?.accelerator || "CommandOrControl+Shift+1";
    const windowAcc =
      currentShortcuts.window || status.window?.accelerator || "CommandOrControl+Shift+3";

    kbdRegion.textContent = formatShortcut(regionAcc, plat, "PrtSc");
    kbdScreen.textContent = formatShortcut(
      screenAcc,
      plat,
      plat === "darwin" ? "Cmd+Shift+1" : "Ctrl+Shift+1"
    );
    kbdWindow.textContent = formatShortcut(
      windowAcc,
      plat,
      plat === "darwin" ? "Cmd+Shift+3" : "Ctrl+Shift+3"
    );

    const accByAction = { region: regionAcc, screen: screenAcc, window: windowAcc };
    for (const btn of shortcutRecordButtons) {
      const action = btn.dataset.action;
      const actionAcc = accByAction[action];
      if (recordingAction !== action) {
        btn.textContent = formatShortcut(actionAcc, plat, "—");
      }
      const isUnregistered = status[action]?.registered === false;
      btn.classList.toggle("is-unregistered", isUnregistered);
      btn.title = isUnregistered
        ? "Atalho indisponível no sistema; clique para definir outro"
        : "Clique e pressione o novo atalho";
    }

    for (const pill of presetPills) {
      const presetAcc = pill.dataset.acc || "";
      const isWinPreset = presetAcc.toLowerCase() === "super+shift+s";
      pill.classList.toggle("hidden", plat === "darwin" && isWinPreset);
      pill.textContent = formatShortcut(presetAcc, plat, pill.textContent);
      pill.classList.toggle(
        "active",
        Boolean(regionAcc && regionAcc.toLowerCase() === presetAcc.toLowerCase())
      );
    }

    if (plat === "darwin") {
      winShiftStatus.classList.add("hidden");
      winShiftStatus.classList.remove("is-active", "is-reserved");
      winShiftScriptRow?.classList.add("hidden");
      winShiftGuide?.classList.add("hidden");
      return;
    }

    winShiftScriptRow?.classList.toggle("hidden", plat !== "win32");
    winShiftGuide?.classList.toggle("hidden", plat !== "win32");

    const winShiftS = status.winShiftS;
    winShiftStatus.classList.remove("hidden", "is-active", "is-reserved");
    if (winShiftS?.registered) {
      winShiftStatus.classList.add("is-active");
      winShiftStatus.textContent = "Win+Shift+S também está ativo para capturar tela.";
    } else {
      winShiftStatus.classList.add("is-reserved");
      const activeRegionLabel = formatShortcut(regionAcc, plat, "PrtSc");
      winShiftStatus.textContent = `Win+Shift+S reservado pelo Windows (Ferramenta de Captura) — usando ${activeRegionLabel}.`;
    }
  }

  function stopRecording() {
    recordingAction = null;
    for (const btn of shortcutRecordButtons) {
      btn.classList.remove("is-recording");
    }
    applyShortcutsUI(currentShortcuts, currentPlatform);
  }

  function startRecording(action) {
    if (recordingAction === action) {
      stopRecording();
      showShortcutFeedback("");
      return;
    }
    recordingAction = action;
    showShortcutFeedback("");
    for (const btn of shortcutRecordButtons) {
      const isTarget = btn.dataset.action === action;
      btn.classList.toggle("is-recording", isTarget);
      if (isTarget) {
        btn.textContent = "Pressione o atalho...";
      } else {
        const actionKey = btn.dataset.action;
        const otherAcc =
          currentShortcuts?.[actionKey] || currentShortcuts?.status?.[actionKey]?.accelerator;
        btn.textContent = formatShortcut(otherAcc, currentPlatform, "—");
      }
    }
  }

  function eventToKeyName(e) {
    if (e.code === "PrintScreen" || e.key === "PrintScreen" || e.keyCode === 44) {
      return "PrintScreen";
    }
    if (/^Digit([0-9])$/.test(e.code)) {
      return e.code.slice(5);
    }
    if (/^Key([A-Z])$/.test(e.code)) {
      return e.code.slice(3);
    }
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) {
      return e.code;
    }
    if (e.code === "Space" || e.key === " ") {
      return "Space";
    }
    if (SPECIAL_KEY_MAP[e.code]) {
      return SPECIAL_KEY_MAP[e.code];
    }
    if (SPECIAL_KEY_MAP[e.key]) {
      return SPECIAL_KEY_MAP[e.key];
    }
    if (e.key && e.key.length === 1 && !/\s/.test(e.key)) {
      return e.key.toUpperCase();
    }
    return null;
  }

  function buildAcceleratorFromEvent(e) {
    const keyName = eventToKeyName(e);
    if (!keyName) return null;

    const parts = [];
    if (currentPlatform === "darwin") {
      if (e.metaKey) parts.push("CommandOrControl");
      if (e.ctrlKey) parts.push("Control");
    } else {
      if (e.ctrlKey) parts.push("CommandOrControl");
      if (e.metaKey) parts.push("Super");
    }
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    parts.push(keyName);
    return parts.join("+");
  }

  async function saveShortcut(action, accelerator) {
    if (!window.screenSnap?.setShortcut) return;
    try {
      const res = await window.screenSnap.setShortcut(action, accelerator);
      if (res?.shortcuts) {
        applyShortcutsUI(res.shortcuts, currentPlatform);
      }
      if (res && !res.ok) {
        showShortcutFeedback(res.error || "Não foi possível registrar esse atalho.", true);
      } else {
        const label = formatShortcut(accelerator, currentPlatform, accelerator);
        showShortcutFeedback(`Atalho atualizado: ${label}`, false);
      }
    } catch (err) {
      showShortcutFeedback(err?.message || "Falha ao atualizar atalho.", true);
    }
  }

  function handleShortcutKeyEvent(e) {
    if (!recordingAction) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopRecording();
      showShortcutFeedback("");
      return;
    }

    if (BARE_MODIFIER_KEYS.has(e.key)) {
      return;
    }

    const keyName = eventToKeyName(e);
    if (!keyName) {
      return;
    }

    // Only capture PrintScreen on keyup (Windows often suppresses PrintScreen keydown);
    // ignore other keyup events so activating the record button via Enter doesn't record Enter.
    if (e.type === "keyup" && keyName !== "PrintScreen") {
      return;
    }

    const accelerator = buildAcceleratorFromEvent(e);
    if (!accelerator) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const targetAction = recordingAction;
    stopRecording();
    saveShortcut(targetAction, accelerator);
  }

  function applyDelayUI(val) {
    const num = Number(val);
    selectedDelay = [0, 3, 5].includes(num) ? num : 0;
    for (const pill of delayPills) {
      pill.classList.toggle("active", Number(pill.dataset.delay) === selectedDelay);
    }
  }

  function clampGostOpacityPercent(rawOpacity) {
    const num = Number(rawOpacity);
    if (!Number.isFinite(num)) return 30;
    const pct = Math.round((num * 100) / 5) * 5;
    return Math.max(15, Math.min(85, pct));
  }

  function updateGostSliderState(enabled) {
    gostOpacitySlider.disabled = !enabled;
    gostOpacityRow.classList.toggle("is-disabled", !enabled);
  }

  function applySettingsUI(settings) {
    if (!settings || typeof settings !== "object") return;

    if ("delay" in settings && !("delaySeconds" in settings)) {
      delaySettingKey = "delay";
    }
    if (settings[delaySettingKey] !== undefined) {
      applyDelayUI(settings[delaySettingKey]);
    }

    if ("closeToTray" in settings && !("minimizeToTray" in settings)) {
      traySettingKey = "closeToTray";
    }
    if (settings[traySettingKey] !== undefined) {
      toggleTrayOnClose.checked = Boolean(settings[traySettingKey]);
    }

    if (Object.prototype.hasOwnProperty.call(settings, "gostEnabled")) {
      const gostEnabled = Boolean(settings.gostEnabled);
      toggleGost.checked = gostEnabled;
      updateGostSliderState(gostEnabled);
    }

    if (Object.prototype.hasOwnProperty.call(settings, "gostIdleOpacity")) {
      const pct = clampGostOpacityPercent(settings.gostIdleOpacity);
      gostOpacitySlider.value = String(pct);
      gostOpacityValue.textContent = `${pct}%`;
    }
  }

  async function persistDelay(val) {
    applyDelayUI(val);
    if (!window.screenSnap?.updateSettings) return;
    try {
      await window.screenSnap.updateSettings({ [delaySettingKey]: selectedDelay });
    } catch (err) {
      showError(err?.message || "Não foi possível salvar o atraso.");
    }
  }

  function renderDisplays(displays, preferredDisplayId) {
    displaySelect.replaceChildren();
    const list = Array.isArray(displays) ? displays : [];

    if (list.length === 0) {
      displayRow.classList.add("hidden");
      return;
    }

    displayRow.classList.remove("hidden");
    list.forEach((d, idx) => {
      const opt = document.createElement("option");
      opt.value = String(d.id);
      const baseLabel = d.label || `Monitor ${idx + 1}`;
      const sizeText = d.width && d.height ? ` (${d.width}×${d.height})` : "";
      const primaryText = d.primary ? " • Principal" : "";
      opt.textContent = `${baseLabel}${sizeText}${primaryText}`;
      displaySelect.appendChild(opt);
    });

    const preferred = list.find((d) => String(d.id) === String(preferredDisplayId));
    const primary = list.find((d) => d.primary) || list[0];
    if (preferred) {
      displaySelect.value = String(preferred.id);
    } else if (primary) {
      displaySelect.value = String(primary.id);
    }
  }

  function getSelectedDisplayId() {
    if (!displaySelect.value) return undefined;
    const raw = displaySelect.value;
    const asNum = Number(raw);
    return Number.isFinite(asNum) && String(asNum) === raw ? asNum : raw;
  }

  async function refreshDisplays() {
    if (!window.screenSnap?.listDisplays) return;
    try {
      const prev = displaySelect.value;
      const displays = await window.screenSnap.listDisplays();
      renderDisplays(displays, prev);
    } catch {
      // Keep existing display list on transient error
    }
  }

  function extractErrorText(payload) {
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    return payload.error || payload.message || "Falha ao capturar tela.";
  }

  function handleCountdown(payload) {
    let remaining = 0;
    let mode = "";

    if (typeof payload === "number") {
      remaining = payload;
    } else if (payload && typeof payload === "object") {
      if (payload.canceled || payload.done || payload.active === false) {
        remaining = 0;
      } else {
        remaining = Number(payload.remaining ?? payload.seconds ?? payload.count ?? 0);
        mode = payload.mode || "";
      }
    }

    if (remaining > 0) {
      const modeNames = {
        region: "Capturando área em",
        screen: "Capturando tela em",
        window: "Capturando janela em",
      };
      countdownText.textContent = modeNames[mode] || "Capturando em";
      countdownValue.textContent = `${Math.ceil(remaining)}s`;
      countdownBanner.classList.remove("hidden");
      statusSubtitle.textContent = `Aguardando ${Math.ceil(remaining)}s...`;
      setBusy(true);
    } else {
      countdownBanner.classList.add("hidden");
      statusSubtitle.textContent = "Pronto para capturar";
      setBusy(false);
    }
  }

  function closeWindowPicker() {
    windowPicker.classList.add("hidden");
    btnWindow.classList.remove("is-open");
    btnWindow.setAttribute("aria-expanded", "false");
  }

  function renderWindowList(windows) {
    windowList.replaceChildren();
    const items = Array.isArray(windows) ? windows : [];

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "window-empty";
      empty.textContent = "Nenhuma janela aberta disponível.";
      windowList.appendChild(empty);
      return;
    }

    for (const win of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "window-item";
      btn.setAttribute("role", "listitem");
      btn.disabled = isCapturing;

      if (win.thumbnailDataUrl) {
        const thumb = document.createElement("img");
        thumb.className = "window-thumb";
        thumb.src = win.thumbnailDataUrl;
        thumb.alt = "";
        btn.appendChild(thumb);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "window-thumb window-thumb--placeholder";
        placeholder.textContent = "—";
        btn.appendChild(placeholder);
      }

      const meta = document.createElement("div");
      meta.className = "window-meta";

      if (win.appIconDataUrl) {
        const icon = document.createElement("img");
        icon.className = "window-app-icon";
        icon.src = win.appIconDataUrl;
        icon.alt = "";
        meta.appendChild(icon);
      }

      const nameEl = document.createElement("span");
      nameEl.className = "window-name";
      const label = win.name || "Janela sem título";
      nameEl.textContent = label;
      nameEl.title = label;
      meta.appendChild(nameEl);

      btn.appendChild(meta);
      btn.addEventListener("click", () => {
        runCapture(() =>
          window.screenSnap.captureWindow({
            sourceId: win.id,
            name: label,
            delaySeconds: selectedDelay,
          })
        );
      });

      windowList.appendChild(btn);
    }
  }

  async function loadWindows() {
    if (!window.screenSnap?.listWindows) return;
    btnRefreshWindows.disabled = true;
    windowList.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "window-empty";
    loading.textContent = "Carregando janelas...";
    windowList.appendChild(loading);

    try {
      const windows = await window.screenSnap.listWindows();
      renderWindowList(windows);
    } catch (err) {
      windowList.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "window-empty";
      empty.textContent = "Falha ao listar janelas.";
      windowList.appendChild(empty);
      showError(err?.message || "Não foi possível listar as janelas abertas.");
    } finally {
      btnRefreshWindows.disabled = isCapturing;
    }
  }

  async function toggleWindowPicker() {
    const isHidden = windowPicker.classList.contains("hidden");
    if (!isHidden) {
      closeWindowPicker();
      return;
    }
    windowPicker.classList.remove("hidden");
    btnWindow.classList.add("is-open");
    btnWindow.setAttribute("aria-expanded", "true");
    await loadWindows();
  }

  async function runCapture(invoker) {
    if (isCapturing) return;
    clearError();
    setBusy(true);

    try {
      const res = await invoker();
      if (res && !res.ok) {
        countdownBanner.classList.add("hidden");
        statusSubtitle.textContent = "Pronto para capturar";
        showError(res.error || "Erro ao iniciar captura.");
      }
    } catch (err) {
      countdownBanner.classList.add("hidden");
      statusSubtitle.textContent = "Pronto para capturar";
      showError(err?.message || "Falha ao executar captura.");
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    if (!window.screenSnap) {
      showError("API ScreenSnap indisponível neste contexto.");
      setBusy(true);
      return;
    }

    unsubCountdown = window.screenSnap.onCountdown?.((payload) => {
      handleCountdown(payload);
    });
    unsubCaptureError = window.screenSnap.onCaptureError?.((payload) => {
      countdownBanner.classList.add("hidden");
      statusSubtitle.textContent = "Pronto para capturar";
      setBusy(false);
      showError(extractErrorText(payload));
    });
    unsubOpenWindowPicker = window.screenSnap.onOpenWindowPicker?.(() => {
      if (windowPicker.classList.contains("hidden")) {
        toggleWindowPicker();
      } else {
        loadWindows();
      }
    });
    unsubSettingsChanged = window.screenSnap.onSettingsChanged?.((nextSettings) => {
      applySettingsUI(nextSettings);
    });

    try {
      const state = await window.screenSnap.getAppState();
      if (state?.version) {
        const ver = String(state.version).startsWith("v") ? state.version : `v${state.version}`;
        versionPill.textContent = ver;
      }

      currentPlatform = state?.platform || "win32";
      applyShortcutsUI(state?.shortcuts || {}, currentPlatform);

      const settings = state?.settings || {};
      applySettingsUI({
        delaySeconds: 0,
        minimizeToTray: true,
        gostEnabled: false,
        gostIdleOpacity: 0.3,
        ...settings,
      });

      const displays = Array.isArray(state?.displays) && state.displays.length > 0
        ? state.displays
        : await window.screenSnap.listDisplays();
      renderDisplays(displays, settings.displayId);
    } catch (err) {
      showError(err?.message || "Erro ao carregar estado inicial.");
    }
  }

  btnMinimize.addEventListener("click", () => {
    window.screenSnap?.minimizeWindow();
  });

  btnClose.addEventListener("click", () => {
    window.screenSnap?.closeWindow();
  });

  btnRegion.addEventListener("click", () => {
    closeWindowPicker();
    runCapture(() =>
      window.screenSnap.captureRegion({
        displayId: getSelectedDisplayId(),
        delaySeconds: selectedDelay,
      })
    );
  });

  btnScreen.addEventListener("click", () => {
    closeWindowPicker();
    runCapture(() =>
      window.screenSnap.captureScreen({
        displayId: getSelectedDisplayId(),
        delaySeconds: selectedDelay,
      })
    );
  });

  btnWindow.addEventListener("click", () => {
    toggleWindowPicker();
  });

  btnRefreshWindows.addEventListener("click", () => {
    loadWindows();
  });

  toggleGost.addEventListener("change", async () => {
    const enabled = Boolean(toggleGost.checked);
    updateGostSliderState(enabled);
    if (!window.screenSnap?.updateSettings) return;
    try {
      const updated = await window.screenSnap.updateSettings({ gostEnabled: enabled });
      if (updated && typeof updated === "object") {
        applySettingsUI(updated);
      }
    } catch (err) {
      showError(err?.message || "Erro ao atualizar Modo Gost.");
    }
  });

  gostOpacitySlider.addEventListener("input", () => {
    gostOpacityValue.textContent = `${gostOpacitySlider.value}%`;
  });

  gostOpacitySlider.addEventListener("change", async () => {
    const opacity = Number(gostOpacitySlider.value) / 100;
    if (!window.screenSnap?.updateSettings) return;
    try {
      const updated = await window.screenSnap.updateSettings({ gostIdleOpacity: opacity });
      if (updated && typeof updated === "object") {
        applySettingsUI(updated);
      }
    } catch (err) {
      showError(err?.message || "Erro ao atualizar opacidade do Modo Gost.");
    }
  });

  for (const pill of delayPills) {
    pill.addEventListener("click", () => {
      persistDelay(pill.dataset.delay);
    });
  }

  toggleTrayOnClose.addEventListener("change", async () => {
    if (!window.screenSnap?.updateSettings) return;
    try {
      await window.screenSnap.updateSettings({
        [traySettingKey]: toggleTrayOnClose.checked,
      });
    } catch (err) {
      showError(err?.message || "Erro ao atualizar preferência de bandeja.");
    }
  });

  btnToggleShortcuts.addEventListener("click", () => {
    const opening = shortcutsPanel.classList.contains("hidden");
    shortcutsPanel.classList.toggle("hidden", !opening);
    btnToggleShortcuts.classList.toggle("is-open", opening);
    btnToggleShortcuts.setAttribute("aria-expanded", String(opening));
    if (!opening) {
      stopRecording();
      showShortcutFeedback("");
    }
  });

  for (const btn of shortcutRecordButtons) {
    btn.addEventListener("click", () => {
      startRecording(btn.dataset.action);
    });
  }

  for (const pill of presetPills) {
    pill.addEventListener("click", () => {
      stopRecording();
      saveShortcut("region", pill.dataset.acc);
    });
  }

  btnResetShortcuts.addEventListener("click", async () => {
    if (!window.screenSnap?.resetShortcuts) return;
    stopRecording();
    btnResetShortcuts.disabled = true;
    try {
      const res = await window.screenSnap.resetShortcuts();
      if (res?.shortcuts) {
        applyShortcutsUI(res.shortcuts, currentPlatform);
      }
      showShortcutFeedback("Atalhos restaurados para o padrão.", false);
    } catch (err) {
      showShortcutFeedback(err?.message || "Erro ao restaurar atalhos.", true);
    } finally {
      btnResetShortcuts.disabled = false;
    }
  });

  let copyRegTimer = null;

  async function copyRegistryPath() {
    const regPath = winShiftRegPath?.textContent?.trim();
    if (!regPath || !btnCopyRegPath) return;

    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(regPath);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      const helper = document.createElement("textarea");
      helper.value = regPath;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        helper.remove();
      }
    }

    btnCopyRegPath.textContent = copied ? "Copiado!" : "Falhou";
    btnCopyRegPath.classList.toggle("is-copied", copied);
    if (copyRegTimer) {
      clearTimeout(copyRegTimer);
    }
    copyRegTimer = setTimeout(() => {
      copyRegTimer = null;
      btnCopyRegPath.textContent = "Copiar";
      btnCopyRegPath.classList.remove("is-copied");
    }, 1800);
  }

  btnRunWinShiftScript?.addEventListener("click", async () => {
    if (!window.screenSnap?.runWinShiftScript) {
      showShortcutFeedback("Função disponível apenas no aplicativo desktop.", true);
      return;
    }

    btnRunWinShiftScript.disabled = true;
    try {
      const res = await window.screenSnap.runWinShiftScript();
      if (res?.ok) {
        showShortcutFeedback(
          "Script aberto no terminal. Após aplicar, feche o ScreenSnap (inclusive na bandeja) e abra novamente.",
          false
        );
      } else {
        showShortcutFeedback(res?.error || "Não foi possível abrir o script.", true);
      }
    } catch (err) {
      showShortcutFeedback(err?.message || "Erro ao abrir o script auxiliar.", true);
    } finally {
      btnRunWinShiftScript.disabled = false;
    }
  });

  btnCopyRegPath?.addEventListener("click", () => {
    copyRegistryPath();
  });

  btnOpenFolder.addEventListener("click", () => {
    window.screenSnap?.openCapturesFolder();
  });

  window.addEventListener("focus", () => {
    refreshDisplays();
  });

  // Listen in capture phase on both keydown and keyup because Windows often fires PrintScreen only on keyup
  window.addEventListener("keydown", handleShortcutKeyEvent, true);
  window.addEventListener("keyup", handleShortcutKeyEvent, true);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !recordingAction && !windowPicker.classList.contains("hidden")) {
      e.preventDefault();
      closeWindowPicker();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (copyRegTimer) clearTimeout(copyRegTimer);
    if (typeof unsubCountdown === "function") unsubCountdown();
    if (typeof unsubCaptureError === "function") unsubCaptureError();
    if (typeof unsubOpenWindowPicker === "function") unsubOpenWindowPicker();
    if (typeof unsubSettingsChanged === "function") unsubSettingsChanged();
  });

  init();
})();
