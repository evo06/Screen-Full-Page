# ScreenSnap — Extensão Chrome / Edge (Manifest V3)

Plugin original em Manifest V3 para capturar **área selecionada (parte da tela)**, **parte visível** ou **página inteira** (rolagem e costura automática), com editor leve de anotações e exportação para **PNG**, **JPEG**, **PDF** (página única ou A4 multipágina) e **Área de Transferência**.

## Como instalar no Chrome / Edge

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Selecione esta pasta (`01`).

## Atalhos padrão

- `Alt+Shift+1` — Capturar parte visível
- `Alt+Shift+2` — Capturar área selecionada
- `Alt+Shift+3` — Capturar página inteira

(Personalizáveis em `chrome://extensions/shortcuts`.)

## Estrutura

- `manifest.json` — Manifesto MV3 com permissões mínimas (`activeTab`, `scripting`, `storage`, `downloads`, `contextMenus`)
- `background.js` — Service worker que coordena capturas, atrasos, menu de contexto e atalhos
- `content/selection-overlay.js` — Overlay isolado via Shadow DOM para seleção e ajuste de região
- `content/fullpage-scroller.js` — Motor de rolagem (suporta janela raiz e containers internos + ocultação de `fixed`/`sticky`)
- `popup/` — Interface do popup da barra de ferramentas
- `editor/` — Tela de preview, costura de fatias, editor leve (Mover, Recortar, Retângulo, Seta, Pincel, Texto, Blur/Ofuscar, Undo/Redo) e exportação
- `lib/capture-store.js` — Armazenamento temporário de fatias em IndexedDB (sem limite de 10 MB do `storage.local`)
- `lib/pdf-builder.js` — Gerador PDF 1.4 puro em JavaScript (sem dependências externas)
- `lib/filename.js` — Sanitização de nomes de arquivos para download
