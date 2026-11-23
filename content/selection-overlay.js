(() => {
  if (window.__screenSnapSelectionCleanup) {
    window.__screenSnapSelectionCleanup();
  }

  const host = document.createElement("div");
  host.id = "screensnap-selection-host";
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;margin:0;padding:0;border:0;background:transparent;pointer-events:auto;";

  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; user-select: none; -webkit-user-select: none; }
    .backdrop {
      position: fixed;
      inset: 0;
      cursor: crosshair;
      background: rgba(15, 23, 42, 0.42);
    }
    .backdrop.has-selection {
      background: transparent;
    }
    .banner {
      position: fixed;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      font: 500 12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      padding: 7px 14px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      pointer-events: none;
      white-space: nowrap;
      z-index: 4;
    }
    .selection-box {
      position: fixed;
      display: none;
      border: 2px solid #38bdf8;
      box-shadow: 0 0 0 99999px rgba(15, 23, 42, 0.48);
      cursor: move;
      z-index: 2;
    }
    .dim-badge {
      position: absolute;
      top: -28px;
      left: 0;
      background: #0f172a;
      color: #f8fafc;
      font: 600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid rgba(56, 189, 248, 0.55);
      white-space: nowrap;
      pointer-events: none;
    }
    .handle {
      position: absolute;
      width: 10px;
      height: 10px;
      background: #ffffff;
      border: 2px solid #0284c7;
      border-radius: 2px;
    }
    .handle[data-dir="nw"] { top: -6px; left: -6px; cursor: nwse-resize; }
    .handle[data-dir="ne"] { top: -6px; right: -6px; cursor: nesw-resize; }
    .handle[data-dir="sw"] { bottom: -6px; left: -6px; cursor: nesw-resize; }
    .handle[data-dir="se"] { bottom: -6px; right: -6px; cursor: nwse-resize; }
    .actions {
      position: fixed;
      display: none;
      gap: 6px;
      padding: 5px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.32);
      z-index: 5;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .btn {
      border: 0;
      border-radius: 7px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .btn-primary { background: #0ea5e9; color: #ffffff; }
    .btn-primary:hover { background: #0284c7; }
    .btn-cancel { background: rgba(255, 255, 255, 0.12); color: #f8fafc; }
    .btn-cancel:hover { background: rgba(255, 255, 255, 0.22); }
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const banner = document.createElement("div");
  banner.className = "banner";
  banner.textContent = "Arraste para selecionar • Enter ou duplo clique para capturar • Esc para cancelar";

  const box = document.createElement("div");
  box.className = "selection-box";

  const dimBadge = document.createElement("div");
  dimBadge.className = "dim-badge";
  box.appendChild(dimBadge);

  for (const dir of ["nw", "ne", "sw", "se"]) {
    const h = document.createElement("div");
    h.className = "handle";
    h.dataset.dir = dir;
    box.appendChild(h);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const btnCapture = document.createElement("button");
  btnCapture.className = "btn btn-primary";
  btnCapture.textContent = "Capturar área";
  const btnCancel = document.createElement("button");
  btnCancel.className = "btn btn-cancel";
  btnCancel.textContent = "Cancelar";
  actions.append(btnCapture, btnCancel);

  shadow.append(style, backdrop, banner, box, actions);
  document.documentElement.appendChild(host);

  let rect = null;
  let interaction = null; // { mode: 'draw' | 'move' | 'resize', dir?, startX, startY, origRect }

  const clampRect = (r) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(0, Math.min(r.x, vw - 1));
    const top = Math.max(0, Math.min(r.y, vh - 1));
    const right = Math.max(left + 1, Math.min(r.x + r.width, vw));
    const bottom = Math.max(top + 1, Math.min(r.y + r.height, vh));
    return { x: left, y: top, width: right - left, height: bottom - top };
  };

  const render = () => {
    if (!rect || rect.width < 2 || rect.height < 2) {
      backdrop.classList.remove("has-selection");
      box.style.display = "none";
      actions.style.display = "none";
      return;
    }

    backdrop.classList.add("has-selection");
    box.style.display = "block";
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    dimBadge.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;
    dimBadge.style.top = rect.y < 34 ? "6px" : "-28px";
    dimBadge.style.left = rect.y < 34 ? "6px" : "0px";

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
  };

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    host.remove();
    delete window.__screenSnapSelectionCleanup;
  };
  window.__screenSnapSelectionCleanup = cleanup;

  const confirmCapture = () => {
    if (!rect || rect.width < 4 || rect.height < 4) return;
    const payload = {
      type: "SELECTION_CONFIRMED",
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      dpr: window.devicePixelRatio || 1,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    cleanup();
    // Wait two frames so the browser paints without the overlay before captureVisibleTab
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          chrome.runtime.sendMessage(payload);
        }, 45);
      });
    });
  };

  backdrop.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    interaction = { mode: "draw", startX: e.clientX, startY: e.clientY };
    rect = { x: e.clientX, y: e.clientY, width: 0, height: 0 };
    render();
  });

  box.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !rect) return;
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

  const onMouseMove = (e) => {
    if (!interaction) return;
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
  };

  const onMouseUp = () => {
    if (!interaction) return;
    if (rect && (rect.width < 6 || rect.height < 6)) {
      rect = null;
    }
    interaction = null;
    render();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    } else if (e.key === "Enter" && rect && rect.width >= 6 && rect.height >= 6) {
      e.preventDefault();
      confirmCapture();
    }
  };

  btnCapture.addEventListener("click", (e) => {
    e.stopPropagation();
    confirmCapture();
  });
  btnCancel.addEventListener("click", (e) => {
    e.stopPropagation();
    cleanup();
  });

  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("keydown", onKeyDown, true);
})();
