# Shared implementation for the three Windows entry points. Windows PowerShell 5.1.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Dependencies.psm1') -Force
$script:AntojitLogPath = $null

function Start-AntojitLog {
    param([Parameter(Mandatory)][string]$Path)
    $Path = [IO.Path]::GetFullPath($Path)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $script:AntojitLogPath = $Path
    $env:ANTOJITOS_LOG_PATH = $Path
    Write-AntojitLog -Message "[LOG] Registro de esta operacion: $Path"
}

function Write-AntojitLog {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Message)
    Write-AntojitDiagnostic -Message $Message
}

function Get-AntojitLogPath {
    if ($script:AntojitLogPath) { return $script:AntojitLogPath }
    if ($env:ANTOJITOS_LOG_PATH) { return $env:ANTOJITOS_LOG_PATH }
    if ($env:ANTOJITOS_SESSION_LOG_PATH) { return $env:ANTOJITOS_SESSION_LOG_PATH }
    return $null
}

function Write-AntojitError {
    param([Parameter(Mandatory)][Management.Automation.ErrorRecord]$ErrorRecord)
    $details = New-Object 'System.Collections.Generic.List[string]'
    $details.Add('[ERROR] ' + $ErrorRecord.ToString())
    if ($ErrorRecord.Exception) { $details.Add('[EXCEPTION] ' + $ErrorRecord.Exception.ToString()) }
    if ($ErrorRecord.FullyQualifiedErrorId) { $details.Add('[ERROR ID] ' + $ErrorRecord.FullyQualifiedErrorId) }
    if ($ErrorRecord.CategoryInfo) { $details.Add('[CATEGORY] ' + $ErrorRecord.CategoryInfo.ToString()) }
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) { $details.Add('[DETAILS] ' + $ErrorRecord.ErrorDetails.Message) }
    if ($ErrorRecord.InvocationInfo -and $ErrorRecord.InvocationInfo.PositionMessage) { $details.Add('[POSITION] ' + $ErrorRecord.InvocationInfo.PositionMessage) }
    if ($ErrorRecord.ScriptStackTrace) { $details.Add('[STACK] ' + $ErrorRecord.ScriptStackTrace) }
    Write-AntojitLog -Message ($details -join [Environment]::NewLine)
}

function Get-AntojitErrorSummary {
    param([Parameter(Mandatory)][Management.Automation.ErrorRecord]$ErrorRecord)
    $message = if ($ErrorRecord.Exception) { $ErrorRecord.Exception.Message } else { $null }
    if ([string]::IsNullOrWhiteSpace($message)) { $message = $ErrorRecord.ToString() }
    $safeLines = New-Object 'System.Collections.Generic.List[string]'
    $privateKeyBlock = $false
    foreach ($line in ($message -split '\r\n|\n|\r')) {
        # A truncated error can contain BEGIN without END. Never show its body,
        # and keep this state local so summarizing another error starts cleanly.
        if ($privateKeyBlock -or $line -match '-----BEGIN [^-]*PRIVATE KEY-----') {
            $safeLines.Add('[PRIVATE KEY REDACTED]')
            $privateKeyBlock = $line -notmatch '-----END [^-]*PRIVATE KEY-----'
        } else {
            $safeLines.Add((ConvertTo-AntojitLogText -Text $line))
        }
    }
    return ($safeLines -join [Environment]::NewLine)
}

function Invoke-AntojitCommand {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory,
        [switch]$Capture
    )
    # ProcessStartInfo avoids Windows PowerShell 5.1's native argument binder,
    # which drops empty arguments and embedded quotes. Read both pipes together:
    # stderr may contain warnings even when the process exits successfully.
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-AntojitNativeArgument $_ }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = if ($WorkingDirectory) {
        $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($WorkingDirectory)
    } else { (Get-Location).ProviderPath }
    $command = ConvertTo-AntojitLogText -Text ('"{0}" {1}' -f $FilePath, $startInfo.Arguments)
    $output = New-Object 'System.Collections.Generic.List[string]'
    $recentStdout = New-Object 'System.Collections.Generic.Queue[string]'
    $recentStderr = New-Object 'System.Collections.Generic.Queue[string]'
    $privateKeyBlock = $false
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    $code = $null
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Write-AntojitLog -Message "[CMD] $command"
    Write-AntojitLog -Message "[CWD] $($startInfo.WorkingDirectory)"
    try {
        if (-not $process.Start()) { throw "No se pudo iniciar el comando $command." }
        $stdoutTask = $process.StandardOutput.ReadLineAsync()
        $stderrTask = $process.StandardError.ReadLineAsync()
        while ($null -ne $stdoutTask -or $null -ne $stderrTask) {
            foreach ($stream in @('stdout', 'stderr')) {
                $pending = if ($stream -eq 'stdout') { $stdoutTask } else { $stderrTask }
                if ($null -eq $pending -or -not $pending.IsCompleted) { continue }
                $line = $pending.GetAwaiter().GetResult()
                if ($null -ne $line) {
                    if ($Capture -and $stream -eq 'stdout') { $output.Add($line) }
                    Write-AntojitLog -Message "[$stream] $line"
                    # Keep only a bounded, redacted tail for the final error.
                    # Track multiline keys before trimming, so even a tail that
                    # no longer includes BEGIN cannot disclose key material.
                    $safeLine = ConvertTo-AntojitLogText -Text $line
                    if ($privateKeyBlock -or $line -match '-----BEGIN [^-]*PRIVATE KEY-----') {
                        $safeLine = '[PRIVATE KEY REDACTED]'
                        $privateKeyBlock = $line -notmatch '-----END [^-]*PRIVATE KEY-----'
                    }
                    if ($safeLine.Length -gt 1000) { $safeLine = $safeLine.Substring(0, 1000) + ' [truncado]' }
                    # Some tools print warnings to stderr and the actual build
                    # failure to stdout. Retain a tail from each independently.
                    $recent = $recentStdout
                    if ($stream -eq 'stderr') { $recent = $recentStderr }
                    $recent.Enqueue("[$stream] $safeLine")
                    while ($recent.Count -gt 12) { [void]$recent.Dequeue() }
                }
                $next = if ($null -eq $line) { $null } elseif ($stream -eq 'stdout') {
                    $process.StandardOutput.ReadLineAsync()
                } else { $process.StandardError.ReadLineAsync() }
                if ($stream -eq 'stdout') { $stdoutTask = $next } else { $stderrTask = $next }
            }
            $pendingTasks = @($stdoutTask, $stderrTask | Where-Object { $null -ne $_ })
            if ($pendingTasks.Count -gt 0) {
                [void][Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]$pendingTasks, 100)
            }
        }
        $process.WaitForExit()
        $code = $process.ExitCode
        if ($code -ne 0) {
            $detail = @($recentStdout.ToArray()) + @($recentStderr.ToArray())
            $message = "El comando $command termino con codigo $code."
            if ($detail.Count -gt 0) { $message += [Environment]::NewLine + 'Detalle del comando (ultimas lineas por canal):' + [Environment]::NewLine + ($detail -join [Environment]::NewLine) }
            $logPath = Get-AntojitLogPath
            if ($logPath) { $message += [Environment]::NewLine + "Registro completo: $logPath" }
            throw $message
        }
        if ($Capture) { return @($output.ToArray()) }
    }
    catch {
        # Preserve launch, pipe and process errors instead of replacing them
        # with a misleading native failure that has no exit code.
        Write-AntojitError -ErrorRecord $_
        throw
    }
    finally {
        $timer.Stop()
        $status = if ($null -eq $code) { 'sin codigo de salida' } else { [string]$code }
        Write-AntojitLog -Message ("[EXIT] {0}; {1:N1} s; {2}" -f $status, $timer.Elapsed.TotalSeconds, $command)
        $process.Dispose()
    }
}

function Enter-AntojitOperation {
    param([Parameter(Mandatory)][string]$Root)
    $directory = Join-Path $Root 'var\windows'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    try {
        return [System.IO.File]::Open((Join-Path $directory 'operation.lock'),
            [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None)
    } catch {
        throw 'Otra instalacion, inicio o actualizacion esta en curso. Espera a que termine.'
    }
}

function Protect-AntojitPath {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$OwnerSid)
    $item = Get-Item -LiteralPath $Path
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $administrators = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
    $acl.SetOwner($administrators)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    foreach ($sid in @($OwnerSid, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique) {
        $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
        $rights = if ($sid -eq $OwnerSid) { 'ReadAndExecute' } else { 'FullControl' }
        if ($item.PSIsContainer) {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                $identity, $rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        } else {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, $rights, 'Allow')
        }
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Test-AntojitRepositoryUrl {
    param([Parameter(Mandatory)][string]$RepositoryUrl)
    $value = $RepositoryUrl.Trim()
    if ($value -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$' -and
        $value -notmatch '^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$') {
        throw 'Usa una URL de repositorio GitHub HTTPS o git@github.com:propietario/repositorio.git, sin tokens en la URL.'
    }
    return $value
}

function Get-AntojitInstallation {
    param([Parameter(Mandatory)][string]$InstallPath)
    $root = [System.IO.Path]::GetFullPath($InstallPath).TrimEnd('\', '/')
    $path = Join-Path $root 'var\windows\installation.json'
    if (-not (Test-Path -LiteralPath $path)) { throw 'Falta la instalacion de Windows. Ejecuta final_script.cmd y elige 1 (Instalar).' }
    $installation = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($installation.Version -ne 1 -or $installation.Engine -ne 'podman') { throw 'Configuracion Windows incompatible.' }
    if (-not [string]::Equals($root.TrimEnd('\'), $installation.Root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'La carpeta se movio. Restaura su ubicacion original; mover una instalacion requiere migrar tambien la tarea y su estado.'
    }
    foreach ($name in @('HttpPort', 'InternalHttpPort')) {
        if ([int]$installation.$name -lt 1 -or [int]$installation.$name -gt 65535) { throw "Puerto invalido: $name." }
    }
    if ($installation.HttpPort -eq $installation.InternalHttpPort) { throw 'Los puertos publico e interno deben ser diferentes.' }
    if ($installation.MachineName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$') { throw 'Nombre de maquina Podman invalido.' }
    return $installation
}

function Resolve-AntojitInstallPath {
    param([string]$InstallPath)
    if ($InstallPath) { return [IO.Path]::GetFullPath($InstallPath).TrimEnd('\', '/') }
    $location = Join-Path $env:ProgramData 'AntojitOS\installation-location.json'
    if (-not (Test-Path -LiteralPath $location)) { throw 'No se encontro la instalacion. Ejecuta final_script.cmd y elige 1 (Instalar).' }
    $record = Get-Content -LiteralPath $location -Raw | ConvertFrom-Json
    return [IO.Path]::GetFullPath([string]$record.Root).TrimEnd('\', '/')
}

function Save-AntojitInstallation {
    param([Parameter(Mandatory)]$Installation)
    New-Item -ItemType Directory -Path $Installation.StateDirectory -Force | Out-Null
    Protect-AntojitPath -Path $Installation.StateDirectory -OwnerSid $Installation.OwnerSid
    $path = Join-Path $Installation.StateDirectory 'installation.json'
    $temporary = "$path.tmp"
    $Installation | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $path -Force
}

function Assert-AntojitOwner {
    param([Parameter(Mandatory)]$Installation)
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($sid -ne $Installation.OwnerSid) {
        throw 'Usa la misma cuenta de Windows que hizo la instalacion. WSL y Podman pertenecen a esa cuenta.'
    }
}

function Assert-AntojitNoPendingUpdate {
    param([Parameter(Mandatory)]$Installation)
    if (Test-Path -LiteralPath (Join-Path $Installation.StateDirectory 'update-pending.json')) {
        throw 'Hay una actualizacion pendiente. Ejecuta final_script.cmd y elige 4 (Actualizar) antes de iniciar o reinstalar: algunas imagenes pueden haber cambiado.'
    }
}

function Resolve-AntojitMachineName {
    param([Parameter(Mandatory)][string]$PodmanPath)
    $env:CONTAINERS_MACHINE_PROVIDER = 'wsl'
    $json = @(Invoke-AntojitCommand -FilePath $PodmanPath -Arguments @('machine', 'list', '--format', 'json') -Capture) -join "`n"
    # Windows PowerShell 5.1 emits a JSON array as a single pipeline value.
    # Assign it first; wrapping the command itself would introduce a nested list.
    $entries = $json | ConvertFrom-Json
    $candidates = @($entries | Where-Object {
        $_ -and (-not $_.PSObject.Properties['VMType'] -or $_.VMType -eq 'wsl')
    })
    $selected = @($candidates | Where-Object { $_.Name -eq 'antojitos-pilot' })
    if ($selected.Count -eq 0) { $selected = @($candidates | Where-Object { $_.PSObject.Properties['Running'] -and $_.Running }) }
    if ($selected.Count -ne 1) { $selected = @($candidates | Where-Object { $_.PSObject.Properties['Default'] -and $_.Default }) }
    if ($selected.Count -ne 1 -and $candidates.Count -eq 1) { $selected = $candidates }
    if ($candidates.Count -eq 0) {
        if (@($entries | Where-Object { $_ -and $_.Name -eq 'antojitos-pilot' }).Count -gt 0) {
            throw 'La maquina antojitos-pilot existente no usa WSL. Conserva esa maquina y selecciona un runtime WSL compatible.'
        }
        Write-AntojitLog 'No hay una maquina WSL disponible. Se creara antojitos-pilot durante la instalacion.'
        return 'antojitos-pilot'
    }
    if ($selected.Count -ne 1) {
        $names = ($candidates | ForEach-Object { $_.Name }) -join ', '
        throw "Hay varias maquinas WSL sin una seleccion unica: $names. Establece una como predeterminada en Podman y repite la instalacion."
    }
    $name = [string]$selected[0].Name
    if ($name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$') { throw 'Nombre de maquina Podman invalido.' }
    Write-AntojitLog "Se reutilizara la maquina Podman existente: $name."
    return $name
}

function Assert-AntojitEnvironmentRecovery {
    param([Parameter(Mandatory)][string]$PodmanPath, [Parameter(Mandatory)][string]$EnvironmentFile)
    if (Test-Path -LiteralPath $EnvironmentFile) { return }
    # A manually created VM is reusable. Existing application storage, rather
    # than the presence of the VM, determines whether credentials need recovery.
    $volumeJson = @(Invoke-AntojitCommand -FilePath $PodmanPath -Arguments @('volume', 'ls', '--format', 'json') -Capture) -join "`n"
    $containerJson = @(Invoke-AntojitCommand -FilePath $PodmanPath -Arguments @('ps', '--all', '--format', 'json') -Capture) -join "`n"
    $volumes = $volumeJson | ConvertFrom-Json
    $containers = $containerJson | ConvertFrom-Json
    $resources = @($volumes) + @($containers)
    $recoveryMessage = 'La maquina contiene datos o contenedores de AntojitOS y falta .env.pilot. Recupera su configuracion anterior antes de generar credenciales nuevas.'
    foreach ($resource in $resources) {
        if ($null -eq $resource) { continue }
        foreach ($propertyName in @('Name', 'Names')) {
            $property = $resource.PSObject.Properties[$propertyName]
            if ($null -eq $property) { continue }
            foreach ($name in @($property.Value)) {
                if ($name -in @('antojitos-pilot_pilot_postgres', 'antojitos-pilot_pilot_print_agent') -or
                    $name -match '^antojitos-pilot[_-](?:postgres|api|web|print-agent)[_-][0-9]+$') {
                    throw $recoveryMessage
                }
            }
        }
        $labels = $resource.PSObject.Properties['Labels']
        if ($null -eq $labels -or $null -eq $labels.Value) { continue }
        foreach ($labelName in @('com.docker.compose.project', 'io.podman.compose.project')) {
            $label = $labels.Value.PSObject.Properties[$labelName]
            if ($null -ne $label -and $label.Value -eq 'antojitos-pilot') { throw $recoveryMessage }
        }
    }
}

function Repair-AntojitPodmanProxy {
    param([Parameter(Mandatory)][string]$PodmanPath, [Parameter(Mandatory)]$Machine, [Parameter(Mandatory)][string]$MachineName)
    if ($MachineName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$' -or $Machine.Rootful) {
        throw 'La recuperacion requiere la maquina rootless seleccionada en la instalacion.'
    }
    $proxy = Join-Path (Split-Path -Parent $PodmanPath) 'win-sshproxy.exe'
    if (-not (Test-Path -LiteralPath $proxy -PathType Leaf)) {
        throw "Falta el auxiliar de Podman: $proxy. Repara la instalacion de Podman antes de reintentar."
    }
    if (-not $Machine.PSObject.Properties['SSHConfig']) { throw 'Podman no informa su configuracion SSH.' }
    $ssh = $Machine.SSHConfig
    if ($ssh.RemoteUsername -notmatch '^[a-zA-Z0-9_-]+$' -or [int]$ssh.Port -lt 1 -or [int]$ssh.Port -gt 65535 -or
        -not (Test-Path -LiteralPath $ssh.IdentityPath -PathType Leaf)) {
        throw 'La configuracion SSH de la maquina Podman esta incompleta.'
    }
    $pipe = [string]$Machine.ConnectionInfo.PodmanPipe.Path
    if (-not $pipe.StartsWith('\\.\pipe\', [StringComparison]::OrdinalIgnoreCase) -or $pipe.Length -le 9 -or $pipe.Substring(9) -match '[/\\]') {
        throw 'El auxiliar de Podman requiere un named pipe local de Windows.'
    }
    $dataHome = $env:XDG_DATA_HOME
    if (-not $dataHome) { $dataHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.local\share' }
    $stateDirectory = Join-Path $dataHome ('containers\podman\machine\wsl\' + $MachineName)
    $threadFile = Join-Path $stateDirectory 'win-sshproxy.tid'
    if (Test-Path -LiteralPath $threadFile -PathType Leaf) {
        $thread = ([IO.File]::ReadAllText($threadFile)).Trim()
        if ($thread -match '^([0-9]+):[0-9]+$') {
            $proxyProcessId = [int]$Matches[1]
            $existing = Get-Process -Id $proxyProcessId -ErrorAction SilentlyContinue
            if ($existing -and $existing.ProcessName -eq 'win-sshproxy') {
                Write-AntojitLog 'win-sshproxy sigue activo. Se esperara a su API sin duplicarlo ni detener la maquina.'
                return
            }
        }
    }
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $logPath = Get-AntojitLogPath
    $logDirectory = if ($logPath) { Split-Path -Parent $logPath } else { $stateDirectory }
    $logBase = Join-Path $logDirectory ('win-sshproxy-' + [guid]::NewGuid().ToString('N'))
    # Podman 5.8.9 / gvisor-tap-vsock 0.8.9 and Podman 6.1.4 / 0.9.0 share
    # this positional protocol. Forward only this machine's local pipe.
    # Preserve Podman's state directory so `machine stop` can stop this proxy too.
    $arguments = @($MachineName, $stateDirectory, ('npipe://' + $pipe.Replace('\', '/')),
        ('ssh://{0}@localhost:{1}/run/user/1000/podman/podman.sock' -f $ssh.RemoteUsername, $ssh.Port), [string]$ssh.IdentityPath)
    $argumentLine = @($arguments | ForEach-Object { ConvertTo-AntojitNativeArgument $_ }) -join ' '
    Write-AntojitLog "Recuperando el puente local de Podman. Diagnostico: $logBase.stderr.log"
    $process = Start-Process -FilePath $proxy -ArgumentList $argumentLine -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logBase.stdout.log" -RedirectStandardError "$logBase.stderr.log"
    try { Write-AntojitLog "win-sshproxy iniciado (PID $($process.Id)); se comprobara la API de Compose." }
    finally { $process.Dispose() }
}

function Initialize-AntojitComposeConnection {
    param([Parameter(Mandatory)]$Installation, [Parameter(Mandatory)][string]$PodmanPath, [int]$TimeoutSeconds = 180)
    # Starting WSL can change the SSH port. Inspect again before repairing its proxy.
    $details = @(Invoke-AntojitCommand -FilePath $PodmanPath -Arguments @('machine', 'inspect', $Installation.MachineName) -Capture) -join "`n"
    $decoded = $details | ConvertFrom-Json
    $machine = @($decoded)[0]
    if ($machine.Rootful) { throw 'La maquina cambio a rootful. Restaura su conexion rootless antes de continuar; el almacenamiento es distinto.' }
    if (-not $machine.PSObject.Properties['ConnectionInfo'] -or
        -not $machine.ConnectionInfo.PSObject.Properties['PodmanPipe'] -or
        -not $machine.ConnectionInfo.PodmanPipe.PSObject.Properties['Path']) {
        throw 'Podman no informa el canal local que necesita Compose. Revisa la maquina WSL seleccionada.'
    }
    $pipe = [string]$machine.ConnectionInfo.PodmanPipe.Path
    if (-not $pipe.StartsWith('\\.\pipe\', [StringComparison]::OrdinalIgnoreCase) -or $pipe.Substring(9) -match '[/\\]' -or $pipe.Length -le 9) {
        throw 'El canal de Compose no es un named pipe local de Windows.'
    }
    $env:DOCKER_HOST = 'npipe://' + $pipe.Replace('\', '/')
    foreach ($name in @('DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $repairAttempted = $false
    $repairError = ''
    while ($true) {
        try {
            # `ls` contacts the Docker API without a project or .env.pilot. Call
            # the provider directly so its timeout also terminates the API client.
            $remaining = [Math]::Max(1, [Math]::Min(10, [int][Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)))
            $null = Invoke-AntojitNative -FilePath $Installation.ComposeProviderPath -Arguments @('ls', '--format', 'json') -TimeoutSeconds $remaining
            Write-AntojitLog 'La conexion local de Compose esta lista.'
            return
        } catch {
            $connectionError = $_.Exception.Message
        }
        if (-not $repairAttempted) {
            $repairAttempted = $true
            Write-AntojitLog 'Podman responde, pero Compose no se conecta. Se intentara recuperar su puente local una vez.'
            try { Repair-AntojitPodmanProxy -PodmanPath $PodmanPath -Machine $machine -MachineName $Installation.MachineName }
            catch {
                $repairError = $_.Exception.Message
                Write-AntojitLog "No se pudo recuperar win-sshproxy: $repairError"
            }
            continue
        }
        if ((Get-Date) -ge $deadline) {
            throw "La conexion de Compose no estuvo lista a tiempo. Podman responde, pero no se pudo usar la API a traves de win-sshproxy. Revisa los eventos de Windows y los logs de esta ejecucion. Compose: $connectionError Recuperacion: $repairError"
        }
        Start-Sleep -Seconds 2
    }
}

function Initialize-AntojitRuntime {
    param([Parameter(Mandatory)]$Installation, [switch]$AllowCreate, [int]$TimeoutSeconds = 180)
    Update-AntojitPath
    if (-not (Test-Path -LiteralPath $Installation.ComposeProviderPath)) { throw 'Falta el proveedor Compose. Ejecuta final_script.cmd y elige 1 (Instalar).' }
    $podman = Get-AntojitPodman
    if (-not $podman) { throw 'No se encontro Podman. Ejecuta final_script.cmd y elige 1 (Instalar).' }
    $env:CONTAINER_ENGINE = $podman
    $env:CONTAINERS_MACHINE_PROVIDER = 'wsl'
    $env:CONTAINER_CONNECTION = $Installation.MachineName
    $env:PODMAN_COMPOSE_PROVIDER = $Installation.ComposeProviderPath
    $env:PILOT_PROJECT_NAME = 'antojitos-pilot'
    # A shell-level remote override must not redirect this restaurant's commands.
    Remove-Item Env:CONTAINER_HOST -ErrorAction SilentlyContinue
    $machines = @(Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'list', '--format', 'json') -Capture) -join "`n"
    $entries = $machines | ConvertFrom-Json
    $found = @($entries | Where-Object { $_ -and $_.Name -eq $Installation.MachineName })
    if ($found.Count -eq 0) {
        if (-not $AllowCreate) { throw 'La maquina Podman no existe. Ejecuta final_script.cmd y elige 1 (Instalar); el inicio diario no crea ni reinstala componentes.' }
        Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'init', '--rootful=false', $Installation.MachineName)
    }
    $details = @(Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'inspect', $Installation.MachineName) -Capture) -join "`n"
    $decoded = $details | ConvertFrom-Json
    $machine = @($decoded)[0]
    if ($machine.Rootful) { throw 'La maquina cambio a rootful. Restaura su conexion rootless antes de continuar; el almacenamiento es distinto.' }
    if ($machine.State -ne 'running') {
        Write-AntojitLog 'Iniciando la maquina local de Podman...'
        Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'start', $Installation.MachineName)
    } else {
        Write-AntojitLog "La maquina Podman $($Installation.MachineName) ya esta encendida; se usara sin recrearla."
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $os = ''
    do {
        try {
            $os = @(Invoke-AntojitCommand -FilePath $podman -Arguments @('info', '--format', '{{.Host.OS}}') -Capture) -join ''
            if ($os.Trim() -eq 'linux') { break }
        } catch {
            if ((Get-Date) -ge $deadline) { throw 'Podman no estuvo listo a tiempo. Revisa WSL, ejecuta final_script.cmd y elige 2 (Iniciar).' }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if ($os.Trim() -ne 'linux') { throw 'Podman no respondio como un motor Linux local.' }
    Initialize-AntojitComposeConnection -Installation $Installation -PodmanPath $podman -TimeoutSeconds $TimeoutSeconds
}

function Invoke-AntojitCompose {
    param([Parameter(Mandatory)]$Installation, [Parameter(Mandatory)][string[]]$Arguments)
    $prefix = @('compose', '--env-file', (Join-Path $Installation.Root '.env.pilot'),
        '-f', (Join-Path $Installation.Root 'compose.pilot.yaml'), '-p', 'antojitos-pilot')
    Invoke-AntojitCommand -FilePath (Get-AntojitPodman) -Arguments ($prefix + $Arguments) -WorkingDirectory $Installation.Root
}

function Invoke-AntojitPilot {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Command, [string[]]$Arguments = @())
    $node = Get-AntojitNode
    if (-not $node) { throw 'Se requiere Node.js 24 o superior. Ejecuta final_script.cmd y elige 1 (Instalar).' }
    Invoke-AntojitCommand -FilePath $node -Arguments (@((Join-Path $Root 'scripts\pilot.mjs'), $Command) + $Arguments) -WorkingDirectory $Root
}

function Set-AntojitEnvironmentValue {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Value)
    if ($Name -notmatch '^[A-Z_]+$' -or $Value -match '[\r\n]') { throw 'Variable de configuracion invalida.' }
    $text = [IO.File]::ReadAllText($Path)
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=.*$'
    if ([regex]::IsMatch($text, $pattern)) { $text = [regex]::Replace($text, $pattern, "$Name=$Value") }
    else { $text = $text.TrimEnd() + "`n$Name=$Value`n" }
    # Node's env-file parser expects UTF-8. Do not introduce a Windows UTF-16 file.
    [IO.File]::WriteAllText($Path, $text, (New-Object Text.UTF8Encoding($false)))
}

function Update-AntojitNetwork {
    param([Parameter(Mandatory)]$Installation)
    $publicPort = [int]$Installation.HttpPort
    $privatePort = [int]$Installation.InternalHttpPort
    if ($publicPort -eq $privatePort) { throw 'El puerto publico no puede coincidir con el puerto interno.' }
    $registry = 'HKLM:\SYSTEM\CurrentControlSet\Services\PortProxy\v4tov4\tcp'
    $key = '0.0.0.0/{0}' -f $publicPort
    $target = '127.0.0.1/{0}' -f $privatePort
    $mapping = Get-ItemProperty -LiteralPath $registry -Name $key -ErrorAction SilentlyContinue
    if ($mapping -and $mapping.$key -ne $target) { throw "El puerto $publicPort ya pertenece a otro proxy de Windows." }
    Set-Service -Name iphlpsvc -StartupType Automatic
    Start-Service -Name iphlpsvc
    if (-not $mapping) {
        $listener = Get-NetTCPConnection -State Listen -LocalPort $publicPort -ErrorAction SilentlyContinue
        if ($listener) { throw "El puerto publico $publicPort ya esta ocupado por otro programa." }
        Invoke-AntojitCommand -FilePath (Join-Path $env:SystemRoot 'System32\netsh.exe') -Arguments @(
            'interface', 'portproxy', 'add', 'v4tov4', "listenport=$publicPort", 'listenaddress=0.0.0.0',
            "connectport=$privatePort", 'connectaddress=127.0.0.1')
    }
    $name = 'AntojitOS-HTTP'
    $rule = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($rule) {
        Set-NetFirewallRule -Name $name -Enabled True -Profile Private -Direction Inbound -Action Allow | Out-Null
        $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $publicPort | Out-Null
        $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet | Out-Null
    } else {
        New-NetFirewallRule -Name $name -DisplayName 'AntojitOS - red local' -Direction Inbound -Action Allow `
            -Enabled True -Profile Private -Protocol TCP -LocalPort $publicPort -RemoteAddress LocalSubnet | Out-Null
    }
}

Export-ModuleMember -Function Start-AntojitLog, Write-AntojitLog, Get-AntojitLogPath, Write-AntojitError, Get-AntojitErrorSummary, Invoke-AntojitCommand, Enter-AntojitOperation,
    Protect-AntojitPath, Test-AntojitRepositoryUrl, Get-AntojitInstallation, Save-AntojitInstallation,
    Resolve-AntojitInstallPath,
    Assert-AntojitOwner, Assert-AntojitNoPendingUpdate, Resolve-AntojitMachineName, Assert-AntojitEnvironmentRecovery,
    Initialize-AntojitRuntime, Invoke-AntojitCompose, Invoke-AntojitPilot,
    Set-AntojitEnvironmentValue, Update-AntojitNetwork, Assert-AntojitWindows, Assert-AntojitAdministrator,
    Update-AntojitPath, Get-AntojitNode, Get-AntojitGit, Get-AntojitPodman, Install-AntojitDependencies
