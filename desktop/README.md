# ScreenSnap Desktop

Aplicativo multiplataforma de captura de tela (**Windows**, **macOS** e **Linux**) construído com **Electron** e estilizado com o design system **Zagid Moss & Citron**. Permite capturar regiões, monitores inteiros ou janelas específicas, realizar anotações rápidas em um editor leve integrado e exportar em **PNG**, **JPEG**, **PDF** ou direto para a área de transferência.

---

## Download (GitHub Releases)

Os instaladores oficiais são distribuídos via **[GitHub Releases](https://github.com/evo06/Screen-Full-Page/releases/latest)**:

| Plataforma | Formato / Arquivo | Tamanho | Download |
| --- | --- | --- | --- |
| **Windows (x64)** | Instalador NSIS (`ScreenSnap-Setup-1.1.1-x64.exe`) | `87,49 MB` | [Baixar Instalador](https://github.com/evo06/Screen-Full-Page/releases/latest/download/ScreenSnap-Setup-1.1.1-x64.exe) |
| **Windows (x64)** | Portátil sem instalação (`ScreenSnap-Portable-1.1.1-x64.exe`) | `80,35 MB` | [Baixar Portátil](https://github.com/evo06/Screen-Full-Page/releases/latest/download/ScreenSnap-Portable-1.1.1-x64.exe) |
| **macOS** | `.dmg` / `.zip` | — | [Ver na Release](https://github.com/evo06/Screen-Full-Page/releases/latest) |
| **Linux** | `.AppImage` / `.deb` | — | [Ver na Release](https://github.com/evo06/Screen-Full-Page/releases/latest) |

<details>
<summary>Verificar integridade (SHA-256 — Windows x64 v1.1.1)</summary>

```text
BC1873E9D9F24B0211C75996B28DCD3B551DDE044C43965FCAE926115C99F4F1  ScreenSnap-Setup-1.1.1-x64.exe
5E7338D4349319D4363C7E80121F5ED4647D71CE4412E69B774ECDD3529AB0A3  ScreenSnap-Portable-1.1.1-x64.exe
```

No PowerShell:
```powershell
Get-FileHash .\ScreenSnap-Setup-1.1.1-x64.exe -Algorithm SHA256
Get-FileHash .\ScreenSnap-Portable-1.1.1-x64.exe -Algorithm SHA256
```

</details>

---

## Recursos principais

- **Captura com escolha imediata (*Pedaço* ou *Tela inteira*)**: ao acionar a captura (`PrtSc` ou botão **Capturar tela**), a tela é congelada (*freeze-frame*) com uma barra superior flutuante para escolher na hora entre **arrastar um pedaço** (com alças de redimensionamento, dimensões em pixels, confirmação por duplo clique / `Enter`) ou capturar a **Tela inteira** em 1 clique (ou tecla `F`), além de cancelar com `Esc`.
- **Monitor / Tela inteira (multi-monitor)**: lista todos os monitores conectados para escolha rápida antes de capturar.
- **Captura de janela (miniaturas ao vivo)**: exibe as janelas abertas com pré-visualização em miniatura e botão de atualização sob demanda.
- **Temporizador**: atraso configurável antes da captura com opções de `0s`, `3s` ou `5s` e contagem regressiva visual.
- **Bandeja do sistema (*System Tray*)**: ao minimizar (`_`) ou fechar o Launcher (com *Minimizar para bandeja ao fechar* ativo), a janela sai da barra de tarefas e permanece acessível somente na bandeja do sistema (`^`), com menu rápido para capturar tela, região ou janela, abrir a pasta de capturas (`Imagens/ScreenSnap`) e alternar o **Modo Gost (ícone flutuante)**.
- **Modo Gost (ícone flutuante sempre acessível)**:
  - Ícone circular discreto (janela `64×64` px / botão `48×48` px) sempre no topo sem roubar o foco da janela ativa (`focusable: false`);
  - Fica semi-transparente quando parado (padrão `30%`, ajustável entre `15%` e `85%`), acende ao passar o mouse e é ocultado automaticamente antes da captura para não sair no print;
  - Ao clicar, abre o seletor unificado (**Pedaço** ou **Tela inteira**) sobre o conteúdo em primeiro plano;
  - Arrastável livremente pela tela com posição salva automaticamente entre sessões;
  - Clique direito abre menu rápido (*Capturar agora (Pedaço / Tela)*, *Abrir ScreenSnap*, *Transparência (parado)* em `20% / 30% / 50% / 75%`, *Resetar posição* e *Desativar Modo Gost*);
  - Configurável pelo **Launcher** (interruptor + slider de opacidade parado) e pela **Bandeja do sistema** (`Modo Gost (ícone flutuante)`).
- **Editor leve integrado**:
  - `Mover (V)` — rolagem e navegação pela imagem;
  - `Recortar (C)` — seleção e aplicação de recorte (`Enter` para aplicar, `Esc` para cancelar);
  - `Retângulo (R)` — destaque retangular;
  - `Seta (A)` — setas direcionais para apontamentos;
  - `Pincel (P)` — desenho à mão livre;
  - `Texto (T)` — anotações de texto flutuantes;
  - `Blur (B)` — ofuscação/pixelização de áreas sensíveis;
  - **Desfazer / Refazer** (`Ctrl+Z` e `Ctrl+Y` / `Ctrl+Shift+Z`, ou `Cmd` no macOS), seletor de cores (paleta + cor personalizada), espessura de traço (`2px`, `4px`, `7px`, `12px`) e controles de zoom (`Ctrl/Cmd + Scroll`, `−`, `Ajustar`, `+`).
- **Exportação flexível (fecha automaticamente ao concluir)**:
  - **Copiar** (`Ctrl+C` / `Cmd+C`) direto para a área de transferência;
  - **PNG** (`Ctrl+S` / `Cmd+S`);
  - **JPEG**;
  - **PDF** em **página única contínua** ou **dividido em páginas A4** (multipágina);
  - Após copiar ou salvar em qualquer formato, o editor exibe a confirmação rápida e fecha automaticamente a janela (cancelar no diálogo de salvar mantém o editor aberto);
  - Nomenclatura padrão `ScreenSnap_<origem>_YYYY-MM-DD_HH-mm-ss.<ext>`.

---

## Atalhos globais

Os atalhos funcionam mesmo com a janela principal minimizada na bandeja do sistema e são atualizados automaticamente no menu da bandeja:

| Ação | Windows / Linux (padrão) | macOS (padrão) |
| --- | --- | --- |
| Capturar tela (escolher pedaço ou inteira) | `PrtSc` (`PrintScreen`) | `Cmd+Shift+S` |
| Capturar tela inteira (direto) | `Ctrl+Shift+1` | `Cmd+Shift+1` |
| Capturar janela (abre o seletor) | `Ctrl+Shift+3` | `Cmd+Shift+3` |

### Personalizar atalhos no launcher

Na janela principal do ScreenSnap, expanda a seção **Personalizar atalhos** para configurar cada ação:

- **Gravador de teclas**: clique no botão do atalho desejado (*Capturar tela*, *Tela inteira (direto)* ou *Capturar janela*) e pressione a tecla ou combinação desejada (pressione `Esc` para cancelar a gravação). Aceita teclas isoladas (`PrintScreen`, `F1`–`F24`) ou combinações com modificadores (`Ctrl`/`Cmd`, `Alt`, `Shift`, `Win`/`Super`).
- **Atalhos rápidos (presets) para Capturar tela**: botões de um clique para alternar entre `PrtSc`, `Ctrl+Shift+S` (`Cmd+Shift+S` no macOS), `Alt+Shift+S` e `Win+Shift+S` (disponível no Windows/Linux).
- **Restaurar padrão**: redefine todas as ações para os atalhos padrão da plataforma.

### Comportamento do `Win+Shift+S` no Windows

No Windows e Linux (`tryWinShiftS` ativo por padrão), o ScreenSnap tenta registrar automaticamente `Win+Shift+S` como atalho extra (*alias*) para **Capturar tela** sempre que a combinação estiver livre no sistema:

- **Quando livre**: `Win+Shift+S` funciona em paralelo ao atalho principal configurado (por exemplo, `PrtSc`), e o painel exibe que o atalho também está ativo.
- **Quando reservado pelo Windows 10/11**: o Windows costuma reservar `Win+Shift+S` exclusivamente para a Ferramenta de Captura nativa (*Snipping Tool*). Nesse caso, o ScreenSnap informa o status no painel **Personalizar atalhos** (*"Win+Shift+S reservado pelo Windows (Ferramenta de Captura) — usando PrtSc"*) e mantém `PrtSc` (ou o atalho personalizado escolhido por você) totalmente funcional.

#### Passo a passo: como desativar/liberar o `Win+Shift+S` (e a tecla `PrtSc`) no Windows 10/11

Você também encontra este guia dentro do próprio Launcher em **Personalizar atalhos → Como liberar Win+Shift+S no Windows?**.

**Opção 1 — Microsoft PowerToys (recomendado, sem alterar o Registro)**

1. Instale o **Microsoft PowerToys** (gratuito na Microsoft Store ou no GitHub oficial da Microsoft).
2. Abra o PowerToys e vá em **Gerenciador de Teclado** (*Keyboard Manager*) no menu lateral.
3. Ative a chave **Habilitar o Gerenciador de Teclado** (*Enable Keyboard Manager*).
4. Clique em **Remapear um atalho** (*Remap a shortcut*) → **Adicionar** (*Add shortcut remapping*).
5. Em **Atalho físico** (*Physical Shortcut*), clique em *Digitar* (*Type*) e pressione `Win+Shift+S`.
6. Em **Mapeado para** (*Mapped To*), escolha o atalho configurado no ScreenSnap (por exemplo, `PrtSc` ou `Ctrl+Shift+S`) e salve em **OK**.
   - *Vantagem:* intercepta apenas `Win+Shift+S` sem mexer no Registro e mantém `Win+S` (Pesquisa do Windows) funcionando normalmente.

**Opção 2 — Registro do Windows (`DisabledHotkeys`)**

> [!NOTE]
> Este método faz o Windows Explorer ignorar a letra `S` com a tecla `Win`, o que libera `Win+Shift+S` para aplicativos de terceiros, **mas também desativa `Win+S` (Pesquisa)**.

1. Pressione `Win+R`, digite `regedit` e aperte `Enter` (confirme no UAC se solicitado).
2. Na barra superior (ou painel esquerdo), acesse:
   ```text
   HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced
   ```
3. No painel da direita, procure um **Valor de Cadeia** (`REG_SZ`) chamado `DisabledHotkeys`.
   - Se não existir: clique com o botão direito em uma área vazia → **Novo → Valor de Cadeia** (*New → String Value*) e nomeie como `DisabledHotkeys`.
4. Dê um duplo clique em `DisabledHotkeys`, defina os dados do valor como `S` e clique em **OK**.
5. **Reinicie o Windows Explorer** (abra o Gerenciador de Tarefas `Ctrl+Shift+Esc` → clique com o direito em **Windows Explorer** → **Reiniciar**) ou reinicie o computador.
6. Reabra o **ScreenSnap**: agora ele conseguirá registrar `Win+Shift+S` automaticamente.

*Opcional via arquivo `.reg`:* salve o conteúdo abaixo como `liberar-win-shift-s.reg`, execute com duplo clique e reinicie o Explorer/PC:
```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced]
"DisabledHotkeys"="S"
```

*Como reverter:* no `regedit`, volte à chave `...\Explorer\Advanced`, remova a letra `S` de `DisabledHotkeys` (ou exclua o valor se você só tinha adicionado `S`) e reinicie o Windows Explorer/PC.

**Script pronto (pelo app, duplo clique ou PowerShell — reversível e sem admin)**

- **Direto pelo ScreenSnap:** em **Personalizar atalhos**, clique no botão **Executar script (Liberar / Restaurar Win+Shift+S)** para abrir o menu interativo no terminal (já empacotado junto com o instalador e a versão portátil do Windows).
- **Duplo clique (menu interativo):** execute `scripts/windows/Liberar-WinShiftS.bat` para abrir o menu interativo (liberar `Win+Shift+S`, liberar também `PrtSc`, consultar status atual ou restaurar o padrão do Windows), preservando outras letras que você já tenha em `DisabledHotkeys`.
- **Via PowerShell (`scripts/windows/toggle-win-shift-s.ps1`):**
  ```powershell
  .\scripts\windows\toggle-win-shift-s.ps1 -Action Status
  .\scripts\windows\toggle-win-shift-s.ps1 -Action Enable -RestartExplorer
  .\scripts\windows\toggle-win-shift-s.ps1 -Action Enable -IncludePrintScreen -RestartExplorer
  .\scripts\windows\toggle-win-shift-s.ps1 -Action Restore -IncludePrintScreen -RestartExplorer
  ```
  *(Adicione `-WhatIf` a qualquer comando acima para apenas simular as alterações sem gravar no Registro.)*

**Bônus — Liberar a tecla `Print Screen` (`PrtSc`) no Windows 10/11**

Se a tecla `PrtSc` ainda abrir a Ferramenta de Captura nativa em vez do ScreenSnap:
- **Windows 11**: abra **Configurações → Acessibilidade → Teclado** e desative **"Usar a tecla Print Screen para abrir a captura de tela"**.
- **Windows 10**: abra **Configurações → Facilidade de Acesso → Teclado** e desative **"Usar o botão PrtScn para abrir a captura de tela"**.

---

## Instalação no Windows

Os artefatos gerados para Windows (x64) ficam disponíveis na pasta `dist/`:

### 1. Instalador NSIS (`dist/ScreenSnap-Setup-1.1.1-x64.exe`)
1. Execute `dist/ScreenSnap-Setup-1.1.1-x64.exe`.
2. Siga o assistente de instalação (instalação por usuário, com opção de escolher o diretório de destino).
3. Atalhos serão criados automaticamente no **Menu Iniciar** e na **Área de Trabalho** como **ScreenSnap**.

### 2. Versão portátil (`dist/ScreenSnap-Portable-1.1.1-x64.exe`)
1. Copie ou execute diretamente `dist/ScreenSnap-Portable-1.1.1-x64.exe` de qualquer pasta ou unidade removível.
2. Não requer instalação nem altera atalhos do sistema.

### Publicação no GitHub Releases

Por terem ~`80–88 MB` (próximo ao limite de `100 MB` por arquivo do Git), os executáveis `.exe` **não devem ser commitados no Git** (`dist/` fica ignorado no `.gitignore`) e sim anexados em **GitHub Releases**:

1. **Opção 1 — Publicação manual (Windows já compilado)**:
   - Acesse **[New Release](https://github.com/evo06/Screen-Full-Page/releases/new)** no GitHub.
   - Crie a tag `v1.1.1` e anexe `dist/ScreenSnap-Setup-1.1.1-x64.exe` (`87,49 MB`) e `dist/ScreenSnap-Portable-1.1.1-x64.exe` (`80,35 MB`).
2. **Opção 2 — Publicação automática (Windows, macOS e Linux via GitHub Actions)**:
   - Garanta que `.github/workflows/release.yml` esteja na raiz do repositório Git e envie uma tag `v*`:
   ```bash
   git tag v1.1.1
   git push origin v1.1.1
   ```
   - O workflow compila automaticamente os pacotes para Windows, macOS e Linux, gera `SHA256SUMS.txt` e publica a Release pública com todos os instaladores anexados.

---

## Desenvolvimento e geração de pacotes (Build)

### Pré-requisitos
- **Node.js** (v22 ou v24 LTS recomendado) e **npm**.

### Instalação das dependências e execução local

```bash
npm install
npm run icons   # gera build/icon.ico, build/icon.png e assets/icon-*.png
npm test        # executa a suíte de testes unitários (node:test)
npm start       # inicia o ScreenSnap em modo de desenvolvimento
npm run smoke   # executa verificação rápida (--smoke-test) no Electron
```

### Build por plataforma

Execute o comando correspondente no sistema operacional de destino para gerar os instaladores em `dist/`:

- **Windows (NSIS + Portable x64)**:
  ```bash
  npm run build:win
  ```
- **macOS (`.dmg` e `.zip`)**:
  ```bash
  npm run build:mac
  ```
- **Linux (`.AppImage` e `.deb`)**:
  ```bash
  npm run build:linux
  ```

---

## Permissão no macOS (*Screen Recording* / Gravação de Tela)

No **macOS**, a captura de telas, regiões e janelas de outros aplicativos exige autorização explícita de **Gravação de Tela** (*Screen Recording*) — configurada via `NSScreenCaptureUsageDescription` no pacote:

1. Ao realizar a primeira captura, confirme a solicitação exibida pelo sistema operacional; ou
2. Acesse **Ajustes do Sistema** → **Privacidade e Segurança** → **Gravação de Tela** (*System Settings → Privacy & Security → Screen Recording*).
3. Ative a chave para **ScreenSnap** e reinicie o aplicativo se solicitado.
