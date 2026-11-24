(function () {
  "use strict";

  const freezeImg = document.getElementById("freezeImg");
  const backdrop = document.getElementById("backdrop");
  const toolbarWrap = document.getElementById("toolbarWrap");
  const captureToolbar = document.getElementById("captureToolbar");
  const btnModeRegion = document.getElementById("btnModeRegion");
  const btnModeFull = document.getElementById("btnModeFull");
  const btnToolbarCancel = document.getElementById("btnToolbarCancel");
  const hintPill = document.getElementById("hintPill");
  const box = document.getElementById("selectionBox");
  const dimBadge = document.getElementById("dimBadge");
  const actions = document.getElementById("actions");
  const btnCapture = document.getElementById("btnCapture");
  const btnCancel = document.getElementById("btnCancel");

  let rect = null;
  let interaction = null; // { mode: 'draw' | 'move' | 'resize', dir?, startX, startY, origRect }
  let submitted = false;

  function clampRect(r) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(0, Math.min(r.x, vw - 1));
    const top = Math.max(0, Math.min(r.y, vh - 1));
    const right = Math.max(left + 1, Math.min(r.x + r.width, vw));
    const bottom = Math.max(top + 1, Math.min(r.y + r.height, vh));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function render() {
    toolbarWrap.classList.toggle("is-dragging", Boolean(interaction));

    if (!rect || rect.width < 2 || rect.height < 2) {
      backdrop.classList.remove("has-selection");
      hintPill.classList.remove("hidden");
      box.style.display = "none";
      actions.style.display = "none";
      return;
    }

    backdrop.classList.add("has-selection");
    hintPill.classList.add("hidden");
    box.style.display = "block";
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    dimBadge.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;
    dimBadge.style.top = rect.y < 34 ? "6px" : "-28px";
    if (rect.x > window.innerWidth - 115) {
      dimBadge.style.left = "auto";
      dimBadge.style.right = rect.y < 34 ? "6px" : "0px";
    } else {
      dimBadge.style.right = "auto";
      dimBadge.style.left = rect.y < 34 ? "6px" : "0px";
    }

    if (interaction) {
      actions.style.display = "none";
      return;
    }

    actions.style.display = "flex";
    const actRect = actions.getBoundingClientRect();
    const spaceBelow = window.innerHeight - (rect.y + rect.height);
    const actTop =
      spaceBelow >= actRect.height + 14
        ? rect.y + rect.height + 8
        : Math.max(8, rect.y - actRect.height - 8);
    const actLeft = Math.max(
      8,
      Math.min(rect.x + rect.width - actRect.width, window.innerWidth - actRect.width - 8)
    );
    actions.style.top = `${actTop}px`;
    actions.style.left = `${actLeft}px`;
  }

  function confirmCapture() {
    if (submitted || !rect || rect.width < 4 || rect.height < 4) return;
    submitted = true;
    const payload = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    window.screenSnap?.confirmRegion(payload);
  }

  function confirmFullScreen() {
    if (submitted) return;
    submitted = true;
    window.screenSnap?.confirmFullScreen();
  }

  function cancelSelection() {
    if (submitted) return;
    submitted = true;
    window.screenSnap?.cancelRegion();
  }

  captureToolbar.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });

  btnModeRegion.addEventListener("click", (e) => {
    e.stopPropagation();
    if (submitted) return;
    if (rect) {
      rect = null;
      interaction = null;
      render();
    }
  });

  btnModeFull.addEventListener("click", (e) => {
    e.stopPropagation();
    confirmFullScreen();
  });

  btnToolbarCancel.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelSelection();
  });

  backdrop.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || submitted) return;
    e.preventDefault();
    interaction = { mode: "draw", startX: e.clientX, startY: e.clientY };
    rect = { x: e.clientX, y: e.clientY, width: 0, height: 0 };
    render();
  });

  box.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !rect || submitted) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.target?.dataset?.dir;
    interaction = {
      mode: dir ? "resize" : "move",
      dir,
      startX: e.clientX,
      startY: e.clientY,
      origRect: { ...rect },
    };
    render();
  });

  box.addEventListener("dblclick", (e) => {
    e.preventDefault();
    confirmCapture();
  });

  window.addEventListener("mousemove", (e) => {
    if (!interaction || submitted) return;
    const dx = e.clientX - interaction.startX;
    const dy = e.clientY - interaction.startY;

    if (interaction.mode === "draw") {
      const x = Math.min(interaction.startX, e.clientX);
      const y = Math.min(interaction.startY, e.clientY);
      const width = Math.abs(dx);
      const height = Math.abs(dy);
      rect = clampRect({ x, y, width, height });
    } else if (interaction.mode === "move") {
      const o = interaction.origRect;
      const nx = Math.max(0, Math.min(o.x + dx, window.innerWidth - o.width));
      const ny = Math.max(0, Math.min(o.y + dy, window.innerHeight - o.height));
      rect = { x: nx, y: ny, width: o.width, height: o.height };
    } else if (interaction.mode === "resize") {
      const o = interaction.origRect;
      let left = o.x;
      let top = o.y;
      let right = o.x + o.width;
      let bottom = o.y + o.height;
      const dir = interaction.dir;
      if (dir.includes("w")) left = Math.min(right - 8, Math.max(0, o.x + dx));
      if (dir.includes("e")) right = Math.max(left + 8, Math.min(window.innerWidth, o.x + o.width + dx));
      if (dir.includes("n")) top = Math.min(bottom - 8, Math.max(0, o.y + dy));
      if (dir.includes("s")) bottom = Math.max(top + 8, Math.min(window.innerHeight, o.y + o.height + dy));
      rect = { x: left, y: top, width: right - left, height: bottom - top };
    }
    render();
  });

  window.addEventListener("mouseup", () => {
    if (!interaction) return;
    if (rect && (rect.width < 6 || rect.height < 6)) {
      rect = null;
    }
    interaction = null;
    render();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelSelection();
    } else if (e.key === "Enter" && rect && rect.width >= 6 && rect.height >= 6) {
      e.preventDefault();
      confirmCapture();
    } else if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      e.key.toLowerCase() === "f"
    ) {
      e.preventDefault();
      confirmFullScreen();
    }
  });

  btnCapture.addEventListener("click", (e) => {
    e.stopPropagation();
    confirmCapture();
  });

  btnCancel.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelSelection();
  });

  async function init() {
    window.focus();
    if (!window.screenSnap?.getOverlayData) return;
    try {
      const data = await window.screenSnap.getOverlayData();
      if (data?.imageDataUrl) {
        freezeImg.src = data.imageDataUrl;
      }
    } catch {
      // Allow Esc / Cancel even if overlay image fails to load
    }
  }

  init();
})();
