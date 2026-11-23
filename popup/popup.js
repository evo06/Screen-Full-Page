const hostLabel = document.getElementById("hostLabel");
const errorBanner = document.getElementById("errorBanner");
const actionButtons = Array.from(document.querySelectorAll(".action-btn"));
const delayPills = Array.from(document.querySelectorAll(".delay-pill"));
const btnShortcuts = document.getElementById("btnShortcuts");

let selectedDelay = 0;
let currentTab = null;

function isRestrictedUrl(url) {
  if (!url) return "Não foi possível ler a URL da aba atual.";
  const lower = url.toLowerCase();
  const prefixes = ["chrome://", "chrome-extension://", "edge://", "about:", "view-source:", "devtools://"];
  if (prefixes.some((p) => lower.startsWith(p))) {
    return "Páginas internas do navegador não permitem captura.";
  }
  if (
    lower.startsWith("https://chrome.google.com/webstore") ||
    lower.startsWith("https://chromewebstore.google.com") ||
    lower.startsWith("https://microsoftedge.microsoft.com/addons")
  ) {
    return "A loja de extensões bloqueia capturas por segurança do navegador.";
  }
  return null;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove("hidden");
}

function setDelay(val) {
  selectedDelay = Number(val) || 0;
  for (const pill of delayPills) {
    pill.classList.toggle("active", Number(pill.dataset.delay) === selectedDelay);
  }
  chrome.storage.local.set({ delaySeconds: selectedDelay });
}

async function init() {
  const stored = await chrome.storage.local.get(["delaySeconds"]);
  if (stored.delaySeconds !== undefined) {
    setDelay(stored.delaySeconds);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;

  if (tab?.url) {
    try {
      const u = new URL(tab.url);
      hostLabel.textContent = u.hostname || tab.url;
    } catch {
      hostLabel.textContent = tab.url;
    }
  }

  const restriction = isRestrictedUrl(tab?.url);
  if (restriction) {
    showError(restriction);
    for (const btn of actionButtons) {
      btn.disabled = true;
    }
  }
}

for (const pill of delayPills) {
  pill.addEventListener("click", () => setDelay(pill.dataset.delay));
}

for (const btn of actionButtons) {
  btn.addEventListener("click", async () => {
    if (!currentTab?.id) return;
    const mode = btn.dataset.mode;
    for (const b of actionButtons) b.disabled = true;

    try {
      const res = await chrome.runtime.sendMessage({
        type: "START_CAPTURE",
        mode,
        tabId: currentTab.id,
        delaySeconds: selectedDelay,
      });
      if (res && !res.ok) {
        showError(res.error || "Erro ao iniciar captura.");
        for (const b of actionButtons) b.disabled = false;
        return;
      }
      window.close();
    } catch (err) {
      showError(err?.message || "Falha ao comunicar com a extensão.");
      for (const b of actionButtons) b.disabled = false;
    }
  });
}

btnShortcuts.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

init();
