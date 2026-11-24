<div align="center">
  <img src="icons/icon128.png" alt="ScreenSnap Logo" width="84" height="84" />
  <h1>ScreenSnap</h1>
  <p><strong>Extensão Chrome / Edge (Manifest V3) para captura de tela, página inteira e anotações rápidas — 100% local e sem dependências externas.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Manifest-V3-A4C639?style=flat-square&labelColor=151C08" alt="Manifest V3" />
    <img src="https://img.shields.io/badge/Chrome-%E2%89%A5114-4C621A?style=flat-square&labelColor=151C08" alt="Chrome 114+" />
    <img src="https://img.shields.io/badge/Depend%C3%AAncias-Zero-D8EB8A?style=flat-square&labelColor=151C08" alt="Zero Dependencies" />
    <img src="https://img.shields.io/badge/Privacidade-100%25%20Local-151C08?style=flat-square" alt="100% Local" />
  </p>
</div>

---

## Visão geral

O **ScreenSnap** captura **área selecionada**, **parte visível** ou a **página inteira** (com rolagem e costura automática), abre um editor leve em uma nova aba para anotações ou ofuscação de dados sensíveis e exporta diretamente para **PNG**, **JPEG**, **PDF** ou **Área de Transferência**.

Todo o processamento acontece localmente no navegador — sem servidores externos, sem telemetria e sem permissões amplas de acesso a sites (`host_permissions`).

---

## Funcionalidades

### Modos de captura
- **Área selecionada (`Alt+Shift+2`)**: overlay isolado em *Shadow DOM* (`mode: "closed"`) com caixa redimensionável pelas 4 alças, movimentação livre, prévia das dimensões em pixels, confirmação por duplo clique ou `Enter` e cancelamento via `Esc`.
- **Parte visível (`Alt+Shift+1`)**: captura imediata da janela visível na aba ativa.
- **Página inteira (`Alt+Shift+3`)**:
  - Detecta automaticamente a janela raiz ou containers internos roláveis (compatível com SPAs).
  - Oculta temporariamente elementos `position: fixed` e `sticky` após a primeira fatia e restaura tudo ao concluir.
  - Costura automaticamente até **45 fatias** (respeitando o limite máximo de `16384 px` por lado no canvas) e aceita cancelamento imediato com `Esc`.
- **Temporizador & menu de contexto**: atraso configurável (`0s`, `3s`, `5s`) com contagem regressiva no ícone da barra e atalhos rápidos no menu do botão direito.

### Editor leve integrado
- **Ferramentas com atalhos**:
  - `V` — Mover / Rolar
  - `C` — Recortar (`Enter` aplica, `Esc` cancela)
  - `R` — Retângulo
  - `A` — Seta
  - `P` — Pincel livre
  - `T` — Texto flutuante
  - `B` — Blur / Ofuscar por pixelização
- **Personalização & histórico**: 7 cores rápidas (incluindo `#A4C639` e `#151C08`) + seletor livre, 4 espessuras (`2px`, `4px`, `7px`, `12px`), zoom (`−`, `Ajustar`, `+`) e histórico completo (`Ctrl+Z` / `Ctrl+Y` ou `Ctrl+Shift+Z`).

### Exportação pura em JavaScript
- **Área de Transferência (`Ctrl+C`)**: copia a imagem final em PNG diretamente para colar em documentos ou chats.
- **PNG**: exportação sem perdas.
- **JPEG**: qualidade `0.92` sobre fundo branco opaco.
- **PDF** (`lib/pdf-builder.js`, PDF 1.4 sem bibliotecas externas):
  - **Página única contínua** (proporcional à captura).
  - **Dividir em páginas A4** (quebra automática para leitura e impressão).
- Nomes de arquivo gerados e sanitizados automaticamente no formato `ScreenSnap_<titulo-ou-host>_YYYY-MM-DD_HH-mm-ss.<ext>`.

---

## Como instalar localmente (Chrome / Edge)

1. Baixe ou clone este repositório:
   ```bash
   git clone https://github.com/evo06/Screen-Full-Page.git
   ```
2. Abra `chrome://extensions` (ou `edge://extensions`).
3. Ative o **Modo do desenvolvedor** (*Developer mode*) no canto superior direito.
4. Clique em **Carregar sem compactação** (*Load unpacked*).
5. Selecione a pasta raiz da extensão (onde está o `manifest.json`).

---

## Aplicativo Desktop (Windows, macOS e Linux)

Além da extensão para navegador, o **ScreenSnap Desktop** (Electron) permite capturar com escolha imediata entre **um pedaço da tela (*freeze-frame*)** ou a **tela inteira** (multi-monitor e janelas específicas), com atalhos globais configuráveis (`PrtSc` como padrão no Windows/Linux, suporte automático a `Win+Shift+S` quando livre), **Modo Gost** (botão flutuante discreto `48×48` em janela `64×64`, sempre no topo sem roubar foco, semi-transparente parado — padrão `30%`, ajustável entre `15%` e `85%` — que acende ao passar o mouse, oculta-se antes do print, abre o seletor **Pedaço** / **Tela inteira** ao clicar, é arrastável com posição persistida e traz menu rápido no clique direito além de controles no Launcher e na Bandeja do sistema), inicialização automática com o Windows (**Iniciar com o Windows**, abrindo silenciosamente na bandeja `^`, configurável no Launcher e na Bandeja), editor leve (que fecha automaticamente após copiar ou salvar em **PNG**, **JPEG** ou **PDF**).

Os instaladores são distribuídos via **[GitHub Releases](https://github.com/evo06/Screen-Full-Page/releases/latest)**:

| Plataforma | Arquivo / Formato | Tamanho | Download |
| --- | --- | --- | --- |
| **Windows (x64)** | Instalador NSIS (`ScreenSnap-Setup-1.1.2-x64.exe`) | `87,49 MB` | [Baixar Instalador](https://github.com/evo06/Screen-Full-Page/releases/latest/download/ScreenSnap-Setup-1.1.2-x64.exe) |
| **Windows (x64)** | Portátil (`ScreenSnap-Portable-1.1.2-x64.exe`) | `80,34 MB` | [Baixar Portátil](https://github.com/evo06/Screen-Full-Page/releases/latest/download/ScreenSnap-Portable-1.1.2-x64.exe) |
| **macOS** | `.dmg` / `.zip` | — | [Ver na Release](https://github.com/evo06/Screen-Full-Page/releases/latest) |
| **Linux** | `.AppImage` / `.deb` | — | [Ver na Release](https://github.com/evo06/Screen-Full-Page/releases/latest) |

<details>
<summary>Checksums SHA-256 (Windows x64 v1.1.2)</summary>

```text
A9A2A040B160A768BCDDADB434FAEA2FBCD2084A7E95D059E2391A79813EF219  ScreenSnap-Setup-1.1.2-x64.exe
2EEEFB4E479AE24869D75838C61A7782AFFDAFE4CCF451DB2C42ABFDF7AC9688  ScreenSnap-Portable-1.1.2-x64.exe
```

*(As releases publicadas via GitHub Actions também anexam `SHA256SUMS.txt` com os hashes de todas as plataformas — Windows, macOS e Linux.)*

</details>

<details>
<summary>Passo a passo: como liberar o atalho nativo Win+Shift+S (e PrtSc) no Windows 10/11</summary>

No Windows 10/11, `Win+Shift+S` costuma vir reservado para a Ferramenta de Captura nativa (*Snipping Tool*). Este passo a passo também está disponível dentro do Launcher em **Personalizar atalhos → Como liberar Win+Shift+S no Windows?**:

1. **Opção 1 — Microsoft PowerToys (recomendado, sem mexer no Registro):**
   - Instale o **Microsoft PowerToys** (Microsoft Store) e abra **Gerenciador de Teclado** (*Keyboard Manager*).
   - Ative o recurso e acesse **Remapear um atalho** → **Adicionar**.
   - Em *Atalho físico*, pressione `Win+Shift+S`; em *Mapeado para*, escolha o atalho ativo do ScreenSnap (ex.: `PrtSc` ou `Ctrl+Shift+S`) e salve em **OK**. Mantém `Win+S` (Pesquisa) intacto.
2. **Opção 2 — Registro do Windows (`DisabledHotkeys`):**
   - Pressione `Win+R`, digite `regedit` e abra `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced`.
   - Crie (ou edite) o **Valor de Cadeia** (`REG_SZ`) `DisabledHotkeys` com o valor `S` (ou importe um `.reg` definindo `"DisabledHotkeys"="S"`).
   - Reinicie o **Windows Explorer** (pelo Gerenciador de Tarefas) ou o PC e reabra o ScreenSnap.
   - *Atenção:* também desativa `Win+S` (Pesquisa). Para reverter, remova o `S` de `DisabledHotkeys` e reinicie o Explorer.
3. **Bônus — Liberar a tecla `PrtSc` (`Print Screen`):**
   - **Windows 11**: **Configurações → Acessibilidade → Teclado** → desative *"Usar a tecla Print Screen para abrir a captura de tela"*.
   - **Windows 10**: **Configurações → Facilidade de Acesso → Teclado** → desative *"Usar o botão PrtScn para abrir a captura de tela"*.
4. **Script pronto (pelo app, duplo clique ou PowerShell — reversível e sem admin):**
   - No próprio Launcher do app no Windows, abra **Personalizar atalhos** e clique em **Executar script (Liberar / Restaurar Win+Shift+S)** — ou execute manualmente `desktop/scripts/windows/Liberar-WinShiftS.bat` / `toggle-win-shift-s.ps1` (`-Action Status`, `Enable`, `Restore`, `-IncludePrintScreen`, `-RestartExplorer` e `-WhatIf`).

</details>

---

## Atalhos de teclado

| Ação | Windows / Linux | macOS |
|---|---|---|
| Capturar parte visível | `Alt+Shift+1` | `Command+Shift+1` |
| Capturar área selecionada | `Alt+Shift+2` | `Command+Shift+2` |
| Capturar página inteira | `Alt+Shift+3` | `Command+Shift+3` |

*(Todos os atalhos podem ser personalizados em `chrome://extensions/shortcuts`.)*

---

## Privacidade e permissões

O ScreenSnap não coleta dados, não faz requisições externas e armazena as fatias temporárias apenas no **IndexedDB local** (`ScreenSnapDB`, com limpeza automática de registros após 1 hora).

| Permissão | Finalidade exata |
|---|---|
| `activeTab` | Acessar temporariamente a aba atual apenas após ação do usuário para capturar a tela visível e medir rolagem. |
| `scripting` | Injetar os scripts de seleção e rolagem sob demanda no momento da captura. |
| `storage` | Salvar a preferência de atraso (`0s`, `3s`, `5s`) em `chrome.storage.local`. |
| `downloads` | Baixar os arquivos exportados (`PNG`, `JPEG`, `PDF`) para a pasta de downloads do usuário. |
| `contextMenus` | Exibir as opções de captura do ScreenSnap no menu de contexto do botão direito. |

---

## Estrutura do projeto

```text
├── manifest.json                 # Manifesto MV3 (Chrome >= 114)
├── background.js                 # Service worker: fluxo de captura, atalhos, badge e menu de contexto
├── content/
│   ├── selection-overlay.js      # Overlay isolado via Shadow DOM para seleção e ajuste de área
│   └── fullpage-scroller.js      # Motor de rolagem (janela raiz e containers SPA + fixed/sticky)
├── popup/
│   ├── popup.html                # Interface do popup da extensão
│   ├── popup.css                 # Estilização do popup (tema Zagid Moss & Citron)
│   └── popup.js                  # Controle de modos, atraso e validação de URLs restritas
├── editor/
│   ├── editor.html               # Interface do editor de capturas
│   ├── editor.css                # Estilização do editor
│   └── editor.js                 # Costura de fatias, anotações, blur, recorte e exportação
├── lib/
│   ├── theme.css                 # Tokens compartilhados do Design System Zagid Moss & Citron
│   ├── capture-store.js          # Persistência temporária em IndexedDB
│   ├── pdf-builder.js            # Gerador PDF 1.4 puro em JavaScript
│   └── filename.js               # Sanitização de nomes de arquivos para download
├── icons/                        # Ícones PNG (16, 32, 48 e 128 px)
├── desktop/                      # Aplicativo desktop multiplataforma (Electron)
└── .github/workflows/release.yml # Build e publicação automática em GitHub Releases
```
