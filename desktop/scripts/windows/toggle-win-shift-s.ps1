[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet("Interactive", "Enable", "Restore", "Status")]
  [string]$Action = "Interactive",

  [switch]$IncludePrintScreen,

  [switch]$RestartExplorer
)

try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
  # Ignore if output is redirected or console handle is unavailable
}

$script:AdvancedKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
$script:KeyboardKey = "HKCU:\Control Panel\Keyboard"

function Add-DisabledHotkeyLetter {
  param(
    [AllowNull()]
    [AllowEmptyString()]
    [string]$CurrentValue,
    [string]$Letter = "S"
  )

  if ([string]::IsNullOrEmpty($CurrentValue)) {
    return $Letter
  }
  if ($CurrentValue.IndexOf($Letter, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    return $CurrentValue
  }
  return "$CurrentValue$Letter"
}

function Remove-DisabledHotkeyLetter {
  param(
    [AllowNull()]
    [AllowEmptyString()]
    [string]$CurrentValue,
    [string]$Letter = "S"
  )

  if ([string]::IsNullOrEmpty($CurrentValue)) {
    return ""
  }
  $escaped = [regex]::Escape($Letter)
  return [regex]::Replace(
    $CurrentValue,
    $escaped,
    "",
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
}

function Get-ShortcutRegistryState {
  $disabledHotkeys = $null
  $advProps = Get-ItemProperty -Path $script:AdvancedKey -Name "DisabledHotkeys" -ErrorAction SilentlyContinue
  if ($null -ne $advProps -and $null -ne $advProps.DisabledHotkeys) {
    $disabledHotkeys = [string]$advProps.DisabledHotkeys
  }

  $winShiftSFreed = $false
  if (-not [string]::IsNullOrEmpty($disabledHotkeys)) {
    $winShiftSFreed = $disabledHotkeys.IndexOf("S", [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  }

  $prtScValue = $null
  $kbProps = Get-ItemProperty -Path $script:KeyboardKey -Name "PrintScreenKeyForSnippingEnabled" -ErrorAction SilentlyContinue
  if ($null -ne $kbProps -and $null -ne $kbProps.PrintScreenKeyForSnippingEnabled) {
    $prtScValue = [int]$kbProps.PrintScreenKeyForSnippingEnabled
  }

  $prtScFreed = ($prtScValue -eq 0)

  return [pscustomobject]@{
    DisabledHotkeys          = $disabledHotkeys
    WinShiftSFreed           = $winShiftSFreed
    PrintScreenSnippingValue = $prtScValue
    PrintScreenFreed         = $prtScFreed
  }
}

function Show-ShortcutStatus {
  $state = Get-ShortcutRegistryState

  $hotkeyRaw = if ([string]::IsNullOrEmpty($state.DisabledHotkeys)) {
    "(não definido)"
  } else {
    "'$($state.DisabledHotkeys)'"
  }

  $winShiftStatusText = if ($state.WinShiftSFreed) {
    "LIBERADO para apps como o ScreenSnap"
  } else {
    "RESERVADO pelo Windows (Ferramenta de Captura nativa)"
  }

  $prtScStatusText = if ($null -eq $state.PrintScreenSnippingValue) {
    "Padrão do sistema (não definido)"
  } elseif ($state.PrintScreenFreed) {
    "LIBERADO (0 — não abre a Ferramenta de Captura)"
  } else {
    "RESERVADO ($($state.PrintScreenSnippingValue) — abre a Ferramenta de Captura)"
  }

  Write-Host ""
  Write-Host "=== Status atual dos atalhos (HKCU) ===" -ForegroundColor Cyan
  Write-Host ("  Win+Shift+S : {0} [DisabledHotkeys = {1}]" -f $winShiftStatusText, $hotkeyRaw)
  Write-Host ("  Tecla PrtSc : {0}" -f $prtScStatusText)
  Write-Host ""
}

function Invoke-EnableShortcuts {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [bool]$WithPrintScreen = $false
  )

  $state = Get-ShortcutRegistryState
  $nextHotkeys = Add-DisabledHotkeyLetter -CurrentValue $state.DisabledHotkeys -Letter "S"

  if (-not (Test-Path -LiteralPath $script:AdvancedKey)) {
    if ($PSCmdlet.ShouldProcess($script:AdvancedKey, "Criar chave do Registro")) {
      New-Item -Path $script:AdvancedKey -Force | Out-Null
    }
  }

  if ($state.WinShiftSFreed -and $nextHotkeys -eq $state.DisabledHotkeys) {
    Write-Host "[OK] Win+Shift+S já estava liberado (DisabledHotkeys = '$($state.DisabledHotkeys)')." -ForegroundColor Green
  } elseif ($PSCmdlet.ShouldProcess($script:AdvancedKey, "Definir DisabledHotkeys = '$nextHotkeys' (REG_SZ)")) {
    Set-ItemProperty -Path $script:AdvancedKey -Name "DisabledHotkeys" -Value $nextHotkeys -Type String
    Write-Host "[OK] DisabledHotkeys definido como '$nextHotkeys'." -ForegroundColor Green
  }

  if ($WithPrintScreen) {
    if (-not (Test-Path -LiteralPath $script:KeyboardKey)) {
      if ($PSCmdlet.ShouldProcess($script:KeyboardKey, "Criar chave do Registro")) {
        New-Item -Path $script:KeyboardKey -Force | Out-Null
      }
    }

    if ($PSCmdlet.ShouldProcess($script:KeyboardKey, "Definir PrintScreenKeyForSnippingEnabled = 0 (REG_DWORD)")) {
      Set-ItemProperty -Path $script:KeyboardKey -Name "PrintScreenKeyForSnippingEnabled" -Value 0 -Type DWord
      Write-Host "[OK] PrintScreenKeyForSnippingEnabled definido como 0 (PrtSc liberado)." -ForegroundColor Green
    }
  }
}

function Invoke-RestoreShortcuts {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [bool]$WithPrintScreen = $false
  )

  $state = Get-ShortcutRegistryState
  $nextHotkeys = Remove-DisabledHotkeyLetter -CurrentValue $state.DisabledHotkeys -Letter "S"

  if ((Test-Path -LiteralPath $script:AdvancedKey) -and $null -ne $state.DisabledHotkeys -and $nextHotkeys -ne $state.DisabledHotkeys) {
    if ([string]::IsNullOrEmpty($nextHotkeys)) {
      if ($PSCmdlet.ShouldProcess($script:AdvancedKey, "Remover propriedade DisabledHotkeys")) {
        Remove-ItemProperty -Path $script:AdvancedKey -Name "DisabledHotkeys" -ErrorAction SilentlyContinue
        Write-Host "[OK] Propriedade DisabledHotkeys removida (padrão do Windows restaurado)." -ForegroundColor Green
      }
    } else {
      if ($PSCmdlet.ShouldProcess($script:AdvancedKey, "Atualizar DisabledHotkeys = '$nextHotkeys' (preservando outras teclas)")) {
        Set-ItemProperty -Path $script:AdvancedKey -Name "DisabledHotkeys" -Value $nextHotkeys -Type String
        Write-Host "[OK] Letra 'S' removida; DisabledHotkeys preservado como '$nextHotkeys'." -ForegroundColor Green
      }
    }
  } else {
    Write-Host "[OK] DisabledHotkeys não contém 'S'; nenhuma alteração necessária." -ForegroundColor Yellow
  }

  if ($WithPrintScreen) {
    if (-not (Test-Path -LiteralPath $script:KeyboardKey)) {
      if ($PSCmdlet.ShouldProcess($script:KeyboardKey, "Criar chave do Registro")) {
        New-Item -Path $script:KeyboardKey -Force | Out-Null
      }
    }

    if ($PSCmdlet.ShouldProcess($script:KeyboardKey, "Restaurar PrintScreenKeyForSnippingEnabled = 1 (REG_DWORD)")) {
      Set-ItemProperty -Path $script:KeyboardKey -Name "PrintScreenKeyForSnippingEnabled" -Value 1 -Type DWord
      Write-Host "[OK] PrintScreenKeyForSnippingEnabled restaurado para 1." -ForegroundColor Green
    }
  }
}

function Restart-WindowsExplorer {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param()

  if ($PSCmdlet.ShouldProcess("explorer.exe", "Reiniciar Windows Explorer para aplicar alterações")) {
    Write-Host "Reiniciando o Windows Explorer..." -ForegroundColor Cyan
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath "explorer.exe"
    }
    Write-Host "[OK] Windows Explorer reiniciado." -ForegroundColor Green
  }
}

function Read-YesNoPrompt {
  param(
    [string]$Prompt,
    [bool]$DefaultYes = $true
  )

  $suffix = if ($DefaultYes) { "[S/n]" } else { "[s/N]" }
  $answer = Read-Host "$Prompt $suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) {
    return $DefaultYes
  }
  $trimmed = $answer.Trim().ToLowerInvariant()
  return ($trimmed -eq "s" -or $trimmed -eq "sim" -or $trimmed -eq "y" -or $trimmed -eq "yes")
}

function Invoke-InteractiveMenu {
  Write-Host "==========================================================" -ForegroundColor Green
  Write-Host "  ScreenSnap — Configurar atalho Win+Shift+S no Windows" -ForegroundColor Green
  Write-Host "==========================================================" -ForegroundColor Green

  Show-ShortcutStatus

  Write-Host "Aviso importante:" -ForegroundColor Yellow
  Write-Host "  Liberar Win+Shift+S via Registro (DisabledHotkeys='S') também" -ForegroundColor Yellow
  Write-Host "  desativa Win+S (Pesquisa). Para manter Win+S ativo, prefira" -ForegroundColor Yellow
  Write-Host "  remapear via Microsoft PowerToys." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Escolha uma opção:"
  Write-Host "  [1] Liberar Win+Shift+S para o ScreenSnap"
  Write-Host "  [2] Liberar Win+Shift+S + tecla PrtSc (Print Screen)"
  Write-Host "  [3] Restaurar padrão do Windows (Win+Shift+S, Win+S e PrtSc)"
  Write-Host "  [4] Ver status atual (somente leitura)"
  Write-Host "  [0] Sair"
  Write-Host ""

  $choice = (Read-Host "Opção").Trim()

  switch ($choice) {
    "1" {
      if (Read-YesNoPrompt -Prompt "Confirmar alteração no Registro do usuário atual (HKCU)?" -DefaultYes $true) {
        Invoke-EnableShortcuts -WithPrintScreen $false
        if (Read-YesNoPrompt -Prompt "Reiniciar o Windows Explorer agora para aplicar imediatamente?" -DefaultYes $true) {
          Restart-WindowsExplorer
        } else {
          Write-Host "Reinicie o Windows Explorer ou faça logoff para aplicar." -ForegroundColor Yellow
        }
        Write-Host "Depois, feche e abra novamente o ScreenSnap (inclusive na bandeja) para registrar Win+Shift+S." -ForegroundColor Cyan
      } else {
        Write-Host "Operação cancelada." -ForegroundColor Yellow
      }
    }
    "2" {
      if (Read-YesNoPrompt -Prompt "Confirmar alteração no Registro do usuário atual (HKCU)?" -DefaultYes $true) {
        Invoke-EnableShortcuts -WithPrintScreen $true
        if (Read-YesNoPrompt -Prompt "Reiniciar o Windows Explorer agora para aplicar imediatamente?" -DefaultYes $true) {
          Restart-WindowsExplorer
        } else {
          Write-Host "Reinicie o Windows Explorer ou faça logoff para aplicar." -ForegroundColor Yellow
        }
        Write-Host "Depois, feche e abra novamente o ScreenSnap (inclusive na bandeja) para registrar os atalhos." -ForegroundColor Cyan
      } else {
        Write-Host "Operação cancelada." -ForegroundColor Yellow
      }
    }
    "3" {
      if (Read-YesNoPrompt -Prompt "Confirmar restauração no Registro do usuário atual (HKCU)?" -DefaultYes $true) {
        Invoke-RestoreShortcuts -WithPrintScreen $true
        if (Read-YesNoPrompt -Prompt "Reiniciar o Windows Explorer agora para aplicar imediatamente?" -DefaultYes $true) {
          Restart-WindowsExplorer
        } else {
          Write-Host "Reinicie o Windows Explorer ou faça logoff para concluir a restauração." -ForegroundColor Yellow
        }
      } else {
        Write-Host "Operação cancelada." -ForegroundColor Yellow
      }
    }
    "4" {
      Show-ShortcutStatus
    }
    "0" {
      Write-Host "Saindo sem alterações."
    }
    default {
      Write-Host "Opção inválida. Nenhuma alteração foi realizada." -ForegroundColor Yellow
    }
  }
}

function Invoke-Main {
  switch ($Action) {
    "Status" {
      Show-ShortcutStatus
    }
    "Enable" {
      Invoke-EnableShortcuts -WithPrintScreen ([bool]$IncludePrintScreen)
      if ($RestartExplorer) {
        Restart-WindowsExplorer
      } else {
        Write-Host "Dica: execute com -RestartExplorer ou reinicie o Explorer/PC para aplicar imediatamente." -ForegroundColor Yellow
      }
      Write-Host "Reabra o ScreenSnap (ou encerre pela bandeja e abra novamente) para registrar Win+Shift+S." -ForegroundColor Cyan
    }
    "Restore" {
      Invoke-RestoreShortcuts -WithPrintScreen ([bool]$IncludePrintScreen)
      if ($RestartExplorer) {
        Restart-WindowsExplorer
      } else {
        Write-Host "Dica: execute com -RestartExplorer ou reinicie o Explorer/PC para concluir." -ForegroundColor Yellow
      }
    }
    default {
      Invoke-InteractiveMenu
    }
  }
}

if ($MyInvocation.InvocationName -ne ".") {
  Invoke-Main
}
