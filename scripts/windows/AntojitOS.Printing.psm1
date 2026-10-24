# Native USB printing lifecycle. Windows PowerShell 5.1; import after Windows.psm1.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Dependencies.psm1') -DisableNameChecking

function Read-AntojitPrintEnvironment {
    param([Parameter(Mandatory)][string]$Path)
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $values }
    foreach ($originalLine in [IO.File]::ReadAllLines($Path)) {
        $line = $originalLine.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        if ($line.StartsWith('export ')) { $line = $line.Substring(7) }
        $separator = $line.IndexOf('=')
        if ($separator -le 0) { continue }
        $value = $line.Substring($separator + 1).Trim()
        if ($value.Length -ge 2) {
            foreach ($quote in @('"', "'", ([string][char]96))) {
                if ($value.StartsWith($quote) -and $value.EndsWith($quote)) { $value = $value.Substring(1, $value.Length - 2); break }
            }
        }
        $values[$line.Substring(0, $separator).Trim()] = $value
    }
    return $values
}

function Get-AntojitPrintConfiguration {
    param([Parameter(Mandatory)]$Installation)
    $environmentPath = Join-Path $Installation.Root '.env.print-agent'
    $native = Read-AntojitPrintEnvironment -Path $environmentPath
    $pilot = Read-AntojitPrintEnvironment -Path (Join-Path $Installation.Root '.env.pilot')
    $mode = 'container'
    if ($native['PRINT_AGENT_MODE'] -eq 'system' -or $pilot['PRINT_AGENT_MODE'] -eq 'system' -or $pilot['PRINT_AGENT_RUNTIME'] -eq 'native') { $mode = 'native' }
    $stateDirectory = Join-Path $Installation.StateDirectory 'print-agent'
    return [pscustomobject]@{
        Mode = $mode
        EnvironmentPath = $environmentPath
        PrinterQueue = $native['PRINTER_QUEUE']
        StateDirectory = $stateDirectory
        ProcessPath = Join-Path $stateDirectory 'process.json'
        ActivePath = Join-Path $stateDirectory 'active.json'
        PreparedPath = Join-Path $stateDirectory 'prepared.json'
        StopPath = Join-Path $stateDirectory 'stop.requested'
    }
}

function ConvertTo-AntojitPrintEnvironmentValue {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)
    if ($Value -match '[\x00-\x1f\x7f]') { throw 'La configuracion de impresion contiene caracteres de control.' }
    # Node expands literal \n in double-quoted env values. Single quotes keep
    # Windows paths and UNC queue names byte-for-byte intact.
    if (-not $Value.Contains("'")) { return "'" + $Value + "'" }
    $backtick = [string][char]96
    if (-not $Value.Contains($backtick)) { return $backtick + $Value + $backtick }
    if (-not $Value.Contains('"') -and -not $Value.Contains('\')) { return '"' + $Value + '"' }
    throw 'El nombre de la cola contiene comillas incompatibles con el archivo de configuracion.'
}

function Initialize-AntojitPrintConfiguration {
    param([Parameter(Mandatory)]$Installation, [string]$PrinterQueue)
    $configuration = Get-AntojitPrintConfiguration -Installation $Installation
    $pilotPath = Join-Path $Installation.Root '.env.pilot'
    $pilot = Read-AntojitPrintEnvironment -Path $pilotPath
    if (-not [string]::IsNullOrWhiteSpace($PrinterQueue)) { $configuration.Mode = 'native' }
    if ($configuration.Mode -ne 'native') { return $configuration }
    $native = Read-AntojitPrintEnvironment -Path $configuration.EnvironmentPath
    if (-not [string]::IsNullOrWhiteSpace($PrinterQueue)) {
        $native['PRINTER_QUEUE'] = $PrinterQueue.Trim()
    } elseif (-not $native['PRINTER_QUEUE'] -and $pilot['PRINT_AGENT_MODE'] -eq 'system') {
        $native['PRINTER_QUEUE'] = $pilot['PRINTER_QUEUE']
    }
    if ([string]::IsNullOrWhiteSpace($native['PRINTER_QUEUE'])) {
        throw 'La impresion USB necesita PRINTER_QUEUE. Configura el nombre exacto de la impresora de Windows antes de actualizar.'
    }
    if ($native['PRINTER_QUEUE'].Length -gt 255) { throw 'PRINTER_QUEUE no puede exceder 255 caracteres.' }
    $null = ConvertTo-AntojitPrintEnvironmentValue -Value $native['PRINTER_QUEUE']
    $native['PRINT_AGENT_MODE'] = 'system'
    # Existing native identities, credentials and destinations must survive updates.
    # A new USB identity avoids colliding with the simulator's registered code.
    $defaults = [ordered]@{
        PRINT_AGENT_API_URL = ('http://127.0.0.1:{0}/api' -f $Installation.HttpPort)
        PRINT_AGENT_SITE_CODE = 'PILOT'
        PRINT_AGENT_CODE = ('PRINT-USB-' + [guid]::NewGuid().ToString('N').Substring(0, 8).ToUpperInvariant())
        PRINT_AGENT_NAME = 'Impresora USB de caja'
        PRINT_AGENT_CENTERS = 'KITCHEN,BAR'
        PRINT_AGENT_REGISTERS = 'MAIN'
        PRINT_AGENT_CREDENTIALS_PATH = 'var/print-agent-usb/credentials.json'
        PRINTER_COLUMNS = '42'
        PRINTER_ENCODING = 'cp858'
        PRINTER_CODE_PAGE = '19'
        PRINTER_TIMEOUT_MS = '10000'
        BOOTSTRAP_TOKEN = $pilot['BOOTSTRAP_TOKEN']
    }
    foreach ($name in @('PRINT_AGENT_SITE_CODE', 'PRINT_AGENT_CENTERS', 'PRINT_AGENT_REGISTERS',
        'PRINTER_COLUMNS', 'PRINTER_ENCODING', 'PRINTER_CODE_PAGE', 'PRINTER_TIMEOUT_MS')) {
        if ($pilot.ContainsKey($name)) { $defaults[$name] = $pilot[$name] }
    }
    foreach ($name in $defaults.Keys) {
        if (-not $native.ContainsKey($name)) { $native[$name] = $defaults[$name] }
    }
    if (-not $native['BOOTSTRAP_TOKEN'] -and -not ($native['PRINT_AGENT_ID'] -and $native['PRINT_AGENT_TOKEN'])) {
        $credentials = [string]$native['PRINT_AGENT_CREDENTIALS_PATH']
        if (-not [IO.Path]::IsPathRooted($credentials)) { $credentials = Join-Path $Installation.Root $credentials }
        if (-not (Test-Path -LiteralPath $credentials -PathType Leaf)) { throw 'Falta el token o las credenciales para registrar la impresora USB.' }
    }
    $lines = @('# Configuracion local de la impresora USB; conservar junto con sus credenciales.')
    foreach ($name in @($native.Keys | Sort-Object)) {
        if ($name -notmatch '^[A-Z][A-Z0-9_]*$') { throw 'Variable de impresion invalida.' }
        $lines += $name + '=' + (ConvertTo-AntojitPrintEnvironmentValue -Value ([string]$native[$name]))
    }
    [IO.File]::WriteAllText($configuration.EnvironmentPath, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
    Set-AntojitEnvironmentValue -Path $pilotPath -Name 'PRINT_AGENT_RUNTIME' -Value 'native'
    return Get-AntojitPrintConfiguration -Installation $Installation
}

function Save-AntojitPrintRecord {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Value)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText("$Path.tmp", (($Value | ConvertTo-Json -Depth 5) + "`n"), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath "$Path.tmp" -Destination $Path -Force
}

function Assert-AntojitPrintRuntime {
    param([Parameter(Mandatory)][string]$RuntimeDirectory)
    foreach ($name in @('main', 'config', 'api-client', 'printer', 'escpos', 'windows-spooler')) {
        if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDirectory "dist/$name.js") -PathType Leaf)) {
            throw "El agente USB no tiene una version compilada completa: $RuntimeDirectory. Ejecuta la actualizacion antes de iniciar."
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDirectory 'package.json') -PathType Leaf)) { throw 'Falta package.json en el agente USB preparado.' }
    if (-not [IO.File]::ReadAllText((Join-Path $RuntimeDirectory 'dist/main.js')).Contains('PRINT_AGENT_STOP_FILE')) {
        throw 'La imagen del agente USB es anterior al administrador de actualizaciones. Construye la version nueva antes de cambiar el proceso.'
    }
}

function Prepare-AntojitNativePrintAgent {
    param([Parameter(Mandatory)]$Installation, [string]$SourceRoot)
    $configuration = Get-AntojitPrintConfiguration -Installation $Installation
    if ($configuration.Mode -ne 'native') { return $null }
    if (-not $SourceRoot) { $SourceRoot = $Installation.Root }
    $package = Get-Content -LiteralPath (Join-Path $SourceRoot 'apps/print-agent/package.json') -Raw | ConvertFrom-Json
    if ($package.PSObject.Properties['dependencies'] -and @($package.dependencies.PSObject.Properties).Count -gt 0) {
        throw 'El agente USB incluye nuevas dependencias de produccion y necesita un empaquetado nativo compatible. Se conserva la version actual.'
    }
    $podman = Get-AntojitPodman
    $prefix = @('compose', '--env-file', (Join-Path $Installation.Root '.env.pilot'), '-f', (Join-Path $SourceRoot 'compose.pilot.yaml'), '-p', 'antojitos-pilot')
    # `compose images` reports the image of existing containers, which can be an
    # older release (or absent after native startup removed the container).
    # Resolve the explicitly tagged build instead and pin its immutable image ID.
    # Only request image names: full `compose config` would expose resolved
    # environment secrets to command logs.
    $imageNames = @(@(Invoke-AntojitCommand -FilePath $podman -Arguments ($prefix + @('config', '--images')) -WorkingDirectory $SourceRoot -Capture) |
        Where-Object { $_ -match '^[a-zA-Z0-9][a-zA-Z0-9_.-]*-print-agent:local$' } | Select-Object -Unique)
    if ($imageNames.Count -ne 1) { throw 'Falta una etiqueta explicita unica de la imagen del agente USB.' }
    $imageName = $imageNames[0]
    $images = @((@(Invoke-AntojitCommand -FilePath $podman -Arguments @('image', 'inspect', '--format', '{{.Id}}', $imageName) -WorkingDirectory $SourceRoot -Capture)) | Where-Object { $_.Trim() } | Select-Object -Unique)
    if ($images.Count -ne 1 -or $images[0] -notmatch '^(?:sha256:)?[a-fA-F0-9]{12,64}$') { throw 'No se encontro una imagen compilada unica para preparar el agente USB.' }
    $release = Join-Path $configuration.StateDirectory ('releases/' + [guid]::NewGuid().ToString('N'))
    $temporaryContainer = 'antojitos-usb-package-' + [guid]::NewGuid().ToString('N')
    $created = $false
    try {
        New-Item -ItemType Directory -Path $release -Force | Out-Null
        Invoke-AntojitCommand -FilePath $podman -Arguments @('create', '--name', $temporaryContainer, $images[0]) -WorkingDirectory $SourceRoot
        $created = $true
        # A stopped container cannot register an agent or consume print jobs.
        Invoke-AntojitCommand -FilePath $podman -Arguments @('cp', ($temporaryContainer + ':/app/dist'), (Join-Path $release 'dist')) -WorkingDirectory $SourceRoot
        [IO.File]::WriteAllText((Join-Path $release 'package.json'), '{"private":true,"type":"module"}', (New-Object Text.UTF8Encoding($false)))
        Assert-AntojitPrintRuntime -RuntimeDirectory $release
        Save-AntojitPrintRecord -Path $configuration.PreparedPath -Value @{ RuntimeDirectory = $release }
        Write-AntojitLog 'Agente USB preparado desde la nueva imagen, sin iniciar otro consumidor de comandas.'
        return $release
    } catch {
        if (Test-Path -LiteralPath $release) { Remove-Item -LiteralPath $release -Recurse -Force }
        throw
    } finally {
        if ($created) { Invoke-AntojitCommand -FilePath $podman -Arguments @('rm', $temporaryContainer) -WorkingDirectory $SourceRoot }
    }
}

function Get-AntojitManagedPrintProcess {
    param([Parameter(Mandatory)]$Configuration)
    if (-not (Test-Path -LiteralPath $Configuration.ProcessPath -PathType Leaf)) { return $null }
    $record = Get-Content -LiteralPath $Configuration.ProcessPath -Raw | ConvertFrom-Json
    if (-not $record.PSObject.Properties['ProcessId'] -or -not $record.PSObject.Properties['StartedAt'] -or -not $record.PSObject.Properties['MainPath']) { throw 'El registro del agente USB esta incompleto; revisa process.json antes de continuar.' }
    $running = Get-Process -Id ([int]$record.ProcessId) -ErrorAction SilentlyContinue
    if (-not $running) { return $null }
    $created = $running.StartTime.ToUniversalTime().ToString('o')
    if ($created -ne [string]$record.StartedAt) { return $null }
    $command = Get-AntojitPrintProcesses -ProcessId ([int]$record.ProcessId)
    if (-not $command -or $command.Name -ine 'node.exe' -or -not ([string]$command.CommandLine).Contains([string]$record.MainPath)) {
        throw 'El PID registrado para USB pertenece a otro comando; no se detendra ese proceso.'
    }
    return $running
}

function Get-AntojitPrintProcesses {
    param([int]$ProcessId = 0)
    $filter = if ($ProcessId -gt 0) { 'ProcessId = ' + $ProcessId } else { "Name = 'node.exe'" }
    Get-CimInstance -ClassName Win32_Process -Filter $filter
}

function Get-AntojitInstalledPrinter {
    param([Parameter(Mandatory)][string]$Name)
    Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($Name)) -ErrorAction Stop
}

function Assert-AntojitNativePrintConfiguration {
    param([Parameter(Mandatory)]$Installation)
    $configuration = Get-AntojitPrintConfiguration -Installation $Installation
    if ($configuration.Mode -ne 'native') { return }
    $native = Read-AntojitPrintEnvironment -Path $configuration.EnvironmentPath
    if ($native['PRINT_AGENT_MODE'] -ne 'system' -or -not $native['PRINTER_QUEUE']) {
        throw 'La configuracion USB esta incompleta. Indica el nombre exacto de la cola instalada en Windows antes de actualizar.'
    }
    if (-not (Get-AntojitNode)) { throw 'El agente USB necesita Node.js 24 o superior en Windows.' }
    try { $printer = Get-AntojitInstalledPrinter -Name $native['PRINTER_QUEUE'] }
    catch { throw "No se encontro la impresora USB '$($native['PRINTER_QUEUE'])'. Revisa el nombre de la cola de Windows antes de actualizar. $($_.Exception.Message)" }
    if (-not $printer -or @($printer | Where-Object { $_.Name -ceq $native['PRINTER_QUEUE'] }).Count -ne 1) {
        throw 'La impresora USB configurada no esta instalada en Windows con ese nombre exacto.'
    }
}

function Assert-AntojitNoLegacyPrintProcess {
    param([Parameter(Mandatory)]$Configuration, [int]$ManagedProcessId = 0)
    $candidates = @(Get-AntojitPrintProcesses)
    foreach ($candidate in $candidates) {
        if ([int]$candidate.ProcessId -eq $ManagedProcessId) { continue }
        $commandLine = [string]$candidate.CommandLine
        if ($commandLine -match '(?i)apps[\\/]print-agent[\\/]dist[\\/]main\.js' -or
            $commandLine.IndexOf($Configuration.StateDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "Hay un agente de impresion iniciado fuera de este actualizador (PID $($candidate.ProcessId)). Cierra su consola o tarea anterior y reintenta; no se forzara la interrupcion de una impresion."
        }
    }
}

function Stop-AntojitNativePrintAgent {
    param([Parameter(Mandatory)]$Installation, [int]$TimeoutSeconds = 45)
    $configuration = Get-AntojitPrintConfiguration -Installation $Installation
    if ($configuration.Mode -ne 'native') { return }
    $running = Get-AntojitManagedPrintProcess -Configuration $configuration
    $managedId = if ($running) { $running.Id } else { 0 }
    Assert-AntojitNoLegacyPrintProcess -Configuration $configuration -ManagedProcessId $managedId
    if (-not $running) { return }
    New-Item -ItemType Directory -Path $configuration.StateDirectory -Force | Out-Null
    [IO.File]::WriteAllText($configuration.StopPath, 'stop')
    if (-not $running.WaitForExit([Math]::Max(0, $TimeoutSeconds) * 1000)) {
        throw 'El agente USB no termino su impresion a tiempo. Se conserva el proceso para no duplicar una comanda. Revisa la cola y reintenta.'
    }
    Remove-Item -LiteralPath $configuration.ProcessPath -Force -ErrorAction SilentlyContinue
    Write-AntojitLog 'Agente USB detenido despues de finalizar su trabajo en curso.'
}

function Get-AntojitPrintStartupTask {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) -or
        -not (Get-Command Set-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    Get-ScheduledTask -TaskName 'AntojitOS-Inicio' -ErrorAction SilentlyContinue
}

function Set-AntojitPrintStartupTaskSettings {
    param([Parameter(Mandatory)]$Settings)
    Set-ScheduledTask -TaskName 'AntojitOS-Inicio' -Settings $Settings | Out-Null
}

function Update-AntojitNativePrintTask {
    param([Parameter(Mandatory)]$Installation)
    if ((Get-AntojitPrintConfiguration -Installation $Installation).Mode -ne 'native') { return }
    $task = Get-AntojitPrintStartupTask
    if (-not $task -or @($task.Actions).Count -ne 1 -or
        $task.Actions[0].WorkingDirectory -ine $Installation.Root -or
        $task.Actions[0].Execute -notmatch '(?i)[\\/]powershell\.exe$') { return }
    $launchers = @((Join-Path $Installation.Root 'final_script.ps1'))
    if ($Installation.PSObject.Properties['LauncherPath'] -and $Installation.LauncherPath) { $launchers += [string]$Installation.LauncherPath }
    $matchesInstallation = $false
    foreach ($launcher in $launchers) {
        $expected = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Action Start -Unattended -InstallPath "{1}"' -f $launcher, $Installation.Root
        if ($task.Actions[0].Arguments -ceq $expected) { $matchesInstallation = $true; break }
    }
    if (-not $matchesInstallation) { return }
    if ($Installation.PSObject.Properties['OwnerSid'] -and $Installation.OwnerSid) {
        $taskOwner = [string]$task.Principal.UserId
        if (-not $taskOwner.StartsWith('S-1-')) {
            try {
                $account = New-Object Security.Principal.NTAccount($taskOwner)
                $taskOwner = $account.Translate([Security.Principal.SecurityIdentifier]).Value
            } catch { return }
        }
        if ($taskOwner -ne $Installation.OwnerSid) { return }
    }
    if ($task.PSObject.Properties['Settings'] -and $task.Settings -and
        $task.Settings.PSObject.Properties['ExecutionTimeLimit'] -and [string]$task.Settings.ExecutionTimeLimit -ne 'PT0S') {
        $task.Settings.ExecutionTimeLimit = 'PT0S'
        Set-AntojitPrintStartupTaskSettings -Settings $task.Settings
        Write-AntojitLog 'La tarea de inicio conserva sus credenciales y permite mantener activo el agente USB sin limite de tiempo.'
    }
}

function Start-AntojitNativePrintAgent {
    param([Parameter(Mandatory)]$Installation, [string]$RuntimeDirectory)
    $configuration = Get-AntojitPrintConfiguration -Installation $Installation
    if ($configuration.Mode -ne 'native') { return }
    $native = Read-AntojitPrintEnvironment -Path $configuration.EnvironmentPath
    Assert-AntojitNativePrintConfiguration -Installation $Installation
    $node = Get-AntojitNode
    $running = Get-AntojitManagedPrintProcess -Configuration $configuration
    $managedId = if ($running) { $running.Id } else { 0 }
    Assert-AntojitNoLegacyPrintProcess -Configuration $configuration -ManagedProcessId $managedId
    if ($running) {
        if ($RuntimeDirectory -or (Test-Path -LiteralPath $configuration.StopPath)) { throw 'El agente USB anterior sigue activo. Espera a que termine antes de iniciar otra version.' }
        Invoke-AntojitCompose -Installation $Installation -Arguments @('rm', '--stop', '--force', 'print-agent')
        Update-AntojitNativePrintTask -Installation $Installation
        Write-AntojitLog 'El agente USB ya esta activo; se conserva su proceso.'
        return
    }
    if (-not $RuntimeDirectory) {
        $pointer = if (Test-Path -LiteralPath $configuration.ActivePath) { $configuration.ActivePath } else { $configuration.PreparedPath }
        if (-not (Test-Path -LiteralPath $pointer -PathType Leaf)) { throw 'Falta preparar el agente USB. Ejecuta primero la actualizacion desde la nueva carpeta ZIP.' }
        $RuntimeDirectory = [string](Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json).RuntimeDirectory
    }
    $RuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
    $releasesRoot = [IO.Path]::GetFullPath((Join-Path $configuration.StateDirectory 'releases')).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $RuntimeDirectory.StartsWith($releasesRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'La version del agente USB no esta en el directorio administrado de esta instalacion.' }
    Assert-AntojitPrintRuntime -RuntimeDirectory $RuntimeDirectory
    Invoke-AntojitCompose -Installation $Installation -Arguments @('rm', '--stop', '--force', 'print-agent')
    New-Item -ItemType Directory -Path $configuration.StateDirectory -Force | Out-Null
    Remove-Item -LiteralPath $configuration.StopPath -Force -ErrorAction SilentlyContinue
    $mainPath = Join-Path $RuntimeDirectory 'dist/main.js'
    $argumentLine = @(('--env-file=' + $configuration.EnvironmentPath), $mainPath) | ForEach-Object { ConvertTo-AntojitNativeArgument $_ }
    $logBase = Join-Path $configuration.StateDirectory ('agent-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    $previousEnvironment = @{}
    $process = $null
    try {
        # Node's --env-file lets inherited OS variables win. Clear those overrides
        # for this launch so old simulator configuration cannot replace USB.
        foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -match '^(?:PRINT_AGENT_|PRINTER_)' -or $_.Name -eq 'BOOTSTRAP_TOKEN' })) {
            $previousEnvironment[$entry.Name] = $entry.Value
            [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process')
        }
        $env:PRINT_AGENT_STOP_FILE = $configuration.StopPath
        $process = Start-Process -FilePath $node -ArgumentList ($argumentLine -join ' ') -WorkingDirectory $Installation.Root -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput "$logBase.stdout.log" -RedirectStandardError "$logBase.stderr.log"
        # Record immediately, so even a later startup check failure remains
        # manageable rather than leaving an untracked consumer behind.
        Save-AntojitPrintRecord -Path $configuration.ProcessPath -Value @{
            ProcessId = $process.Id; StartedAt = $process.StartTime.ToUniversalTime().ToString('o'); MainPath = $mainPath
        }
    } catch {
        $launchError = $_
        if ($process) {
            # If saving process.json failed, still request graceful shutdown so
            # we do not leave a new consumer running without its managed PID.
            try {
                [IO.File]::WriteAllText($configuration.StopPath, 'stop')
                $null = $process.WaitForExit(45000)
            } catch { }
            throw "No se pudo registrar el proceso USB (PID $($process.Id)). Se solicito su parada; revisa la cola y los logs antes de reintentar. $($launchError.Exception.Message)"
        }
        throw
    } finally {
        Remove-Item Env:PRINT_AGENT_STOP_FILE -ErrorAction SilentlyContinue
        foreach ($name in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
    }
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($process.WaitForExit(500)) {
            Remove-Item -LiteralPath $configuration.ProcessPath -Force -ErrorAction SilentlyContinue
            throw "El agente USB no pudo iniciar (codigo $($process.ExitCode)). Revisa $logBase.stderr.log."
        }
        if (Test-Path -LiteralPath "$logBase.stdout.log") {
            $output = [IO.File]::ReadAllText("$logBase.stdout.log")
            if ($output.Contains('activo en modo system')) { $ready = $true; break }
        }
    }
    if (-not $ready) { throw "El agente USB no confirmo su inicio. Se conserva su PID para detenerlo de forma segura; revisa $logBase.stderr.log." }
    Save-AntojitPrintRecord -Path $configuration.ActivePath -Value @{ RuntimeDirectory = $RuntimeDirectory }
    Update-AntojitNativePrintTask -Installation $Installation
    Write-AntojitLog "Agente USB activo para '$($native['PRINTER_QUEUE'])'. Registro: $logBase.stdout.log"
}

Export-ModuleMember -Function Get-AntojitPrintConfiguration, Initialize-AntojitPrintConfiguration,
    Assert-AntojitNativePrintConfiguration, Prepare-AntojitNativePrintAgent, Stop-AntojitNativePrintAgent,
    Start-AntojitNativePrintAgent, Update-AntojitNativePrintTask
