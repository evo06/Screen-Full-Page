(() => {
  if (window.__screenSnapScrollerInstalled) return;
  window.__screenSnapScrollerInstalled = true;

  let session = null;

  function findScrollTarget() {
    const root = document.scrollingElement || document.documentElement;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (root.scrollHeight > vh + 4 || root.scrollWidth > vw + 4) {
      return { element: root, isRoot: true };
    }

    // Fallback for SPAs that keep document 100vh and scroll an inner container
    let bestEl = null;
    let bestScore = 0;
    const candidates = document.querySelectorAll("main, div, section, article");
    for (const el of candidates) {
      if (el.scrollHeight <= el.clientHeight + 24) continue;
      const style = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.45 || r.height < vh * 0.45) continue;
      const score = r.width * r.height + el.scrollHeight;
      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (bestEl) {
      return { element: bestEl, isRoot: false };
    }
    return { element: root, isRoot: true };
  }

  function collectFixedAndStickyElements(scrollTarget, isRoot) {
    const tracked = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const isAncestorOfTarget = !isRoot && (node === scrollTarget || node.contains(scrollTarget));
      if (
        node !== document.documentElement &&
        node !== document.body &&
        !isAncestorOfTarget
      ) {
        const pos = getComputedStyle(node).position;
        if (pos === "fixed" || pos === "sticky") {
          const r = node.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            tracked.push({
              el: node,
              origVisibility: node.style.getPropertyValue("visibility"),
              origPriority: node.style.getPropertyPriority("visibility"),
              hidden: false,
            });
          }
        }
      }
      node = walker.nextNode();
    }
    return tracked;
  }

  function setFixedVisibility(hide) {
    if (!session) return;
    for (const item of session.fixedElements) {
      if (hide && !item.hidden) {
        item.el.style.setProperty("visibility", "hidden", "important");
        item.hidden = true;
      } else if (!hide && item.hidden) {
        if (item.origVisibility) {
          item.el.style.setProperty("visibility", item.origVisibility, item.origPriority);
        } else {
          item.el.style.removeProperty("visibility");
        }
        item.hidden = false;
      }
    }
  }

  function onEsc(e) {
    if (e.key === "Escape" && session) {
      session.aborted = true;
    }
  }

  function prepareFullpage() {
    const { element, isRoot } = findScrollTarget();
    const htmlEl = document.documentElement;
    const origHtmlScrollBehavior = htmlEl.style.scrollBehavior;
    const origTargetScrollBehavior = element.style.scrollBehavior;
    const origScrollLeft = element.scrollLeft;
    const origScrollTop = element.scrollTop;

    htmlEl.style.scrollBehavior = "auto";
    element.style.scrollBehavior = "auto";

    const fixedElements = collectFixedAndStickyElements(element, isRoot);
    const rect = element.getBoundingClientRect();

    session = {
      element,
      isRoot,
      origHtmlScrollBehavior,
      origTargetScrollBehavior,
      origScrollLeft,
      origScrollTop,
      fixedElements,
      aborted: false,
    };

    window.addEventListener("keydown", onEsc, true);

    return {
      ok: true,
      dpr: window.devicePixelRatio || 1,
      isRoot,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      totalWidth: Math.max(element.scrollWidth, isRoot ? window.innerWidth : element.clientWidth),
      totalHeight: Math.max(element.scrollHeight, isRoot ? window.innerHeight : element.clientHeight),
      containerRect: isRoot
        ? null
        : {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(element.clientWidth),
            height: Math.round(element.clientHeight),
          },
    };
  }

  async function scrollToStep(x, y, hideFixed) {
    if (!session) return { ok: false, error: "Sessão de rolagem não iniciada." };
    if (session.aborted) return { ok: true, aborted: true };

    setFixedVisibility(Boolean(hideFixed));

    if (session.isRoot) {
      window.scrollTo(x, y);
    } else {
      session.element.scrollTo(x, y);
    }

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 90));

    if (session.aborted) return { ok: true, aborted: true };

    const actualX = session.isRoot ? window.scrollX : session.element.scrollLeft;
    const actualY = session.isRoot ? window.scrollY : session.element.scrollTop;
    return {
      ok: true,
      aborted: false,
      actualX,
      actualY,
    };
  }

  function restoreFullpage() {
    if (!session) return { ok: true };
    window.removeEventListener("keydown", onEsc, true);
    setFixedVisibility(false);

    if (session.isRoot) {
      window.scrollTo(session.origScrollLeft, session.origScrollTop);
    } else {
      session.element.scrollTo(session.origScrollLeft, session.origScrollTop);
    }

    document.documentElement.style.scrollBehavior = session.origHtmlScrollBehavior;
    session.element.style.scrollBehavior = session.origTargetScrollBehavior;
    session = null;
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return false;
    if (message.type === "PREPARE_FULLPAGE") {
      try {
        sendResponse(prepareFullpage());
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
      return false;
    }
    if (message.type === "SCROLL_TO") {
      scrollToStep(message.x, message.y, message.hideFixed)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }
    if (message.type === "RESTORE_FULLPAGE") {
      try {
        sendResponse(restoreFullpage());
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
      return false;
    }
    return false;
  });
})();
