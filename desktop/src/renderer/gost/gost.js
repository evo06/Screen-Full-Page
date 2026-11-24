(function () {
  "use strict";

  const DRAG_THRESHOLD_PX = 5;
  const gostBtn = document.getElementById("gostBtn");

  let activePointerId = null;
  let startScreenX = 0;
  let startScreenY = 0;
  let dragging = false;
  let unsubGostConfig = null;

  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return;
    const raw = Number(cfg.idleOpacity);
    if (!Number.isFinite(raw)) return;
    const clamped = Math.max(0.05, Math.min(1, raw));
    document.documentElement.style.setProperty("--gost-idle-opacity", String(clamped));
  }

  gostBtn.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });

  gostBtn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    activePointerId = e.pointerId;
    startScreenX = e.screenX;
    startScreenY = e.screenY;
    dragging = false;

    try {
      gostBtn.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable
    }
  });

  gostBtn.addEventListener("pointermove", (e) => {
    if (activePointerId !== e.pointerId) return;
    const dx = e.screenX - startScreenX;
    const dy = e.screenY - startScreenY;

    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      dragging = true;
      gostBtn.classList.add("is-dragging");
      window.screenSnap?.gostDragStart?.();
    }

    if (dragging) {
      window.screenSnap?.gostDragMove?.({ dx, dy });
    }
  });

  async function finishPointerInteraction(e) {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;

    try {
      if (gostBtn.hasPointerCapture(e.pointerId)) {
        gostBtn.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore pointer capture release errors
    }

    const wasDragging = dragging;
    dragging = false;

    if (wasDragging) {
      gostBtn.classList.remove("is-dragging");
      await window.screenSnap?.gostDragEnd?.();
      return;
    }

    if (e.type === "pointerup" && e.button === 0) {
      await window.screenSnap?.gostTriggerCapture?.();
    }
  }

  gostBtn.addEventListener("pointerup", finishPointerInteraction);
  gostBtn.addEventListener("pointercancel", finishPointerInteraction);

  gostBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      window.screenSnap?.gostTriggerCapture?.();
    }
  });

  gostBtn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.screenSnap?.gostShowMenu?.();
  });

  async function init() {
    if (!window.screenSnap) return;
    unsubGostConfig = window.screenSnap.onGostConfig?.((cfg) => {
      applyConfig(cfg);
    });

    try {
      const cfg = await window.screenSnap.getGostConfig?.();
      applyConfig(cfg);
    } catch {
      // Fall back to default --gost-idle-opacity CSS value
    }
  }

  window.addEventListener("beforeunload", () => {
    if (typeof unsubGostConfig === "function") {
      unsubGostConfig();
    }
  });

  init();
})();
