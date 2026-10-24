#Requires -Version 5.1
<#
.SYNOPSIS
Instala, inicia, configura el arranque y actualiza AntojitOS desde una sola entrada.
.DESCRIPTION
Abre final_script.cmd para usar el menu. Guarda consola, comandos y errores antes
incluso de cargar los modulos. Solicita elevacion con la misma cuenta de Windows.
-Unattended esta reservado para el arranque automatico: nunca muestra preguntas.
.EXAMPLE
.\final_script.ps1 -Action Install
.EXAMPLE
.\final_script.ps1 -Action Update -RepositoryUrl https://github.com/EMPRESA/REPO.git -ConfirmMaintenance
#>
[CmdletBinding()]
param(
    [ValidateSet('Menu', 'Install', 'Start', 'AutoStart', 'Update', 'Logs')][string]$Action = 'Menu',
    [string]$InstallPath,
    [string]$RepositoryUrl,
    [string]$Branch,
    [ValidateRange(1, 65535)][int]$HttpPort,
    [ValidateRange(1, 65535)][int]$InternalHttpPort,
    [string]$PrinterHost,
    [ValidateRange(1, 65535)][int]$PrinterPort,
    [ValidateSet('Startup', 'Logon')][string]$AutoStartMode,
    [switch]$ConfirmMaintenance,
    [switch]$ForceRegister,
    [switch]$Unattended,
    [switch]$NoPause,
    [Parameter(DontShow)][string]$SessionDirectory,
    [Parameter(DontShow)][string]$RequestedOwnerSid
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:AntojitEntryRoot = $PSScriptRoot
$script:AntojitEntryPath = $PSCommandPath

function New-AntojitSession {
    param([hashtable]$Options)
    if ($Options.ContainsKey('SessionDirectory') -and $Options.SessionDirectory) {
        $directory = [IO.Path]::GetFullPath($Options.SessionDirectory)
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        return $directory
    }
    $name = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), $PID
    foreach ($base in @($env:ProgramData, $env:LOCALAPPDATA, $env:TEMP)) {
        if (-not $base) { continue }
        try {
            $directory = Join-Path $base "AntojitOS\logs\$name"
            New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
            # Test write permission now, before running any installation step.
            Set-Content -LiteralPath (Join-Path $directory 'session.txt') -Value 'AntojitOS final_script' -Encoding UTF8
            return $directory
        } catch { continue }
    }
    throw 'No se pudo crear una carpeta de logs en ProgramData, LocalAppData ni TEMP.'
}

function Test-AntojitElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-AntojitElevation {
    param([hashtable]$Options, [string]$Directory)
    $copy = @{}
    foreach ($key in $Options.Keys) {
        $value = $Options[$key]
        if ($value -is [System.Management.Automation.SwitchParameter]) { $value = [bool]$value }
        $copy[$key] = $value
    }
    $copy.SessionDirectory = $Directory
    $copy.RequestedOwnerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $json = ConvertTo-Json -InputObject $copy -Compress
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    $quotedPath = $script:AntojitEntryPath.Replace("'", "''")
    # Encode the entire bootstrap so spaces, apostrophes and URLs survive UAC.
    $command = @"
`$ErrorActionPreference = 'Stop'
try {
    `$record = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$payload')) | ConvertFrom-Json
    `$options = @{}
    foreach (`$property in `$record.PSObject.Properties) { `$options[`$property.Name] = `$property.Value }
    & '$quotedPath' @options
    exit `$LASTEXITCODE
} catch {
    Write-Host (`$_ | Format-List * -Force | Out-String)
    Read-Host 'No se pudo abrir final_script. Presiona Enter para cerrar'
    exit 1
}
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $process = Start-Process -FilePath $powershell -Verb RunAs -Wait -PassThru `
        -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded)
    return [int]$process.ExitCode
}

function Read-AntojitAction {
    Write-Host ''
    Write-Host 'AntojitOS - final_script'
    Write-Host '  1. Instalar / completar configuracion (incluye arranque automatico e inicio)'
    Write-Host '  2. Iniciar la aplicacion instalada'
    Write-Host '  3. Configurar / reparar el arranque automatico'
    Write-Host '  4. Actualizar desde GitHub'
    Write-Host '  5. Abrir la carpeta de logs'
    Write-Host '  0. Salir'
    while ($true) {
        switch (Read-Host 'Elige una opcion') {
            '1' { return 'Install' }
            '2' { return 'Start' }
            '3' { return 'AutoStart' }
            '4' { return 'Update' }
            '5' { return 'Logs' }
            '0' { return 'Exit' }
            default { Write-Host 'Opcion invalida. Escribe un numero de la lista.' }
        }
    }
}

function Read-AntojitAutoStartMode {
    Write-Host 'Startup inicia al encender la PC y requiere la contrasena real de Windows (no el PIN).'
    Write-Host 'Logon inicia al entrar a tu escritorio y no requiere guardar una contrasena.'
    while ($true) {
        $choice = Read-Host '1 = al encender (predeterminado), 2 = al entrar al escritorio'
        if ($choice -eq '' -or $choice -eq '1') { return 'Startup' }
        if ($choice -eq '2') { return 'Logon' }
    }
}

function Invoke-AntojitWorkflow {
    param([Parameter(Mandatory)][string]$Action, [Parameter(Mandatory)][hashtable]$Options)
    $arguments = @{ Managed = $true }
    $names = @('InstallPath')
    switch ($Action) {
        'Install' {
            $file = '01-instalar.ps1'
            $names += @('RepositoryUrl', 'Branch', 'HttpPort', 'InternalHttpPort', 'PrinterHost', 'PrinterPort', 'AutoStartMode')
        }
        'Start' { $file = '02-iniciar.ps1' }
        'AutoStart' {
            $file = '02-iniciar.ps1'
            $arguments.RegisterAutoStart = $true
            $names += @('AutoStartMode', 'ForceRegister')
        }
        'Update' {
            $file = '03-actualizar.ps1'
            $names += @('RepositoryUrl', 'Branch', 'ConfirmMaintenance')
        }
        default { throw "Operacion no valida: $Action" }
    }
    foreach ($name in $names) {
        if ($Options.ContainsKey($name)) { $arguments[$name] = $Options[$name] }
    }
    $path = Join-Path $script:AntojitEntryRoot "scripts\windows\$file"
    if (-not (Test-Path -LiteralPath $path)) { throw "Proyecto incompleto: falta $path. Conserva la carpeta completa del proyecto junto a final_script." }
    # Managed helpers propagate the original ErrorRecord and never spawn another shell.
    & $path @arguments | Out-Host
}

function Wait-AntojitClose {
    param([hashtable]$Options)
    if (-not $Options.Unattended -and -not $Options.NoPause) {
        try { [void](Read-Host 'La ventana seguira abierta. Presiona Enter para cerrar') }
        catch { } # A redirected console cannot read; the .cmd launcher remains open.
    }
}

function Invoke-AntojitFinalMain {
    param([hashtable]$Options)
    foreach ($name in @('Action', 'Unattended', 'NoPause', 'ConfirmMaintenance')) {
        if (-not $Options.ContainsKey($name)) {
            $Options[$name] = if ($name -eq 'Action') { 'Menu' } else { $false }
        }
    }
    $directory = $null
    $transcribing = $false
    $delegated = $false
    $code = 0
    $previousSessionLog = $env:ANTOJITOS_SESSION_LOG_PATH
    $previousLog = $env:ANTOJITOS_LOG_PATH
    try {
        if ($env:OS -eq 'Windows_NT') {
            # Node and container tools emit UTF-8, also when Task Scheduler starts us.
            [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
        }
        $directory = New-AntojitSession -Options $Options
        $transcript = Join-Path $directory 'final_script.log'
        # Write a marker even if the console host cannot start a transcript.
        Add-Content -LiteralPath $transcript -Value ("{0} Inicio final_script, accion: {1}" -f (Get-Date -Format o), $Options.Action) -Encoding UTF8
        Start-Transcript -LiteralPath $transcript -Append -Force | Out-Null
        $transcribing = $true
        $env:ANTOJITOS_SESSION_LOG_PATH = Join-Path $directory 'commands.log'
        Write-Host "Logs de esta ejecucion: $directory" -ForegroundColor Cyan
        Write-Host "Consola: $transcript"
        Write-Host "Comandos y errores: $env:ANTOJITOS_SESSION_LOG_PATH"
        Write-Host ("Sistema: {0}; PowerShell: {1}; proceso de {2} bits" -f [Environment]::OSVersion.VersionString, $PSVersionTable.PSVersion, ([IntPtr]::Size * 8))
        Write-Host "Origen: $script:AntojitEntryRoot"
        if ($env:OS -ne 'Windows_NT') { throw 'Este script requiere Windows 10 22H2 o Windows 11 de 64 bits.' }
        if ($Options.Unattended -and $Options.Action -ne 'Start') {
            throw '-Unattended solo admite -Action Start. No se instalara ni actualizara sin una sesion interactiva.'
        }
        if ($Options.ContainsKey('RequestedOwnerSid') -and $Options.RequestedOwnerSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
            throw 'La elevacion cambio de cuenta. Usa una cuenta administradora e inicia con esa misma cuenta para conservar el acceso a WSL y los datos.'
        }
        if (-not (Test-AntojitElevated)) {
            if ($Options.Unattended) { throw 'El arranque necesita privilegios de administrador. Repara la tarea desde final_script, opcion 3.' }
            Write-Host 'Windows solicitara permiso de administrador. Usa esta misma cuenta.'
            Stop-Transcript | Out-Null
            $transcribing = $false
            $code = Invoke-AntojitElevation -Options $Options -Directory $directory
            $delegated = $true
            Write-Host "Proceso de administrador terminado con codigo $code. Logs: $directory"
            Write-Host 'Ultimas lineas del proceso (el log completo esta guardado):'
            Get-Content -LiteralPath $transcript -Tail 80 | Out-Host
        } else {
            Import-Module (Join-Path $script:AntojitEntryRoot 'scripts\windows\AntojitOS.Windows.psm1') -Force -DisableNameChecking
            Start-AntojitLog -Path $env:ANTOJITOS_SESSION_LOG_PATH
            $selected = $Options.Action
            $fromMenu = $selected -eq 'Menu'
            if ($fromMenu) { $selected = Read-AntojitAction }
            if ($selected -eq 'Logs') {
                Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f (Split-Path -Parent $directory)) | Out-Null
            } elseif ($selected -ne 'Exit') {
                if ($fromMenu -and $selected -in @('Install', 'AutoStart') -and -not $Options.ContainsKey('AutoStartMode')) {
                    $Options.AutoStartMode = Read-AntojitAutoStartMode
                }
                if ($fromMenu -and $selected -eq 'AutoStart') { $Options.ForceRegister = $true }
                if ($fromMenu -and $selected -eq 'Update') {
                    if (-not $Options.ContainsKey('RepositoryUrl')) {
                        $url = Read-Host 'URL de GitHub (Enter para usar la ya guardada)'
                        if ($url.Trim()) { $Options.RepositoryUrl = $url.Trim() }
                    }
                    if (-not $Options.ConfirmMaintenance) {
                        Write-Host 'La actualizacion puede detener el servicio. Cierra caja y sal de las terminales.'
                        $answer = Read-Host 'Escribe ACTUALIZAR para desplegar; Enter solo comprueba si hay cambios'
                        $Options.ConfirmMaintenance = $answer -ceq 'ACTUALIZAR'
                    }
                }
                Write-AntojitLog "Operacion: $selected"
                Invoke-AntojitWorkflow -Action $selected -Options $Options
                Write-AntojitLog 'Operacion completada correctamente.'
            }
        }
    } catch {
        $failure = $_
        if ($failure.Exception.Data['RestartRequired']) {
            $code = 3010
            Write-Host 'Se necesita reiniciar Windows. Reinicia y vuelve a abrir final_script; elige instalar para continuar.' -ForegroundColor Yellow
        } else {
            $code = 1
            Write-Host 'ERROR: la operacion no se completo.' -ForegroundColor Red
        }
        if (Get-Command Write-AntojitError -ErrorAction SilentlyContinue) {
            try { Write-AntojitError -ErrorRecord $failure } catch { Write-Host $failure.ToString() }
        } else {
            $detail = ($failure | Format-List * -Force | Out-String) + "`n" + $failure.ScriptStackTrace
            Write-Host $detail
            if ($directory) { Add-Content -LiteralPath (Join-Path $directory 'bootstrap-error.log') -Value $detail -Encoding UTF8 }
        }
    } finally {
        if ($directory) { Write-Host "Resultado: $code. Conserva la carpeta de logs: $directory" -ForegroundColor Cyan }
        if ($transcribing) { try { Stop-Transcript | Out-Null } catch { } }
        $env:ANTOJITOS_SESSION_LOG_PATH = $previousSessionLog
        $env:ANTOJITOS_LOG_PATH = $previousLog
        if (-not $delegated) { Wait-AntojitClose -Options $Options }
    }
    return $code
}

# Dot-sourcing loads functions for tests without installing or prompting.
if ($MyInvocation.InvocationName -ne '.') {
    $options = @{}
    foreach ($key in $PSBoundParameters.Keys) { $options[$key] = $PSBoundParameters[$key] }
    exit (Invoke-AntojitFinalMain -Options $options)
}
