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

function Invoke-AntojitCommand {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory,
        [switch]$Capture
    )
    $shownArguments = @($Arguments | ForEach-Object {
        if ($_ -match '[\s"]' -or $_.Length -eq 0) { '"' + $_.Replace('"', '\"') + '"' }
        else { $_ }
    }) -join ' '
    $command = ConvertTo-AntojitLogText -Text ('"{0}" {1}' -f $FilePath, $shownArguments)
    $output = New-Object 'System.Collections.Generic.List[string]'
    $locationPushed = $false
    $code = $null
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Write-AntojitLog -Message "[CMD] $command"
    try {
        if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory; $locationPushed = $true }
        Write-AntojitLog -Message "[CWD] $((Get-Location).Path)"
        # Windows PowerShell turns native stderr into ErrorRecords. Check the exit
        # code, rather than interpreting a successful program's stderr as failure.
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $global:LASTEXITCODE = $null
            & $FilePath @Arguments 2>&1 | ForEach-Object {
                $text = $_.ToString()
                $stream = if ($_ -is [Management.Automation.ErrorRecord]) { 'stderr' } else { 'stdout' }
                # JSON and other machine-readable captures contain stdout only;
                # successful tools can also emit warnings on stderr.
                if ($Capture -and $stream -eq 'stdout') { $output.Add($text) }
                Write-AntojitLog -Message "[$stream] $text"
            }
            $code = $global:LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($null -eq $code -or $code -ne 0) {
            $status = if ($null -eq $code) { 'sin codigo de salida' } else { [string]$code }
            throw "El comando $command termino con codigo $status."
        }
        if ($Capture) { return @($output.ToArray()) }
    }
    catch {
        Write-AntojitError -ErrorRecord $_
        throw
    }
    finally {
        $timer.Stop()
        $status = if ($null -eq $code) { 'sin codigo de salida' } else { [string]$code }
        Write-AntojitLog -Message ("[EXIT] {0}; {1:N1} s; {2}" -f $status, $timer.Elapsed.TotalSeconds, $command)
        if ($locationPushed) { Pop-Location }
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
    $entries = @($json | ConvertFrom-Json)
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
    $resources = @($volumeJson | ConvertFrom-Json) + @($containerJson | ConvertFrom-Json)
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
    $entries = @($machines | ConvertFrom-Json)
    $found = @($entries | Where-Object { $_.Name -eq $Installation.MachineName })
    if ($found.Count -eq 0) {
        if (-not $AllowCreate) { throw 'La maquina Podman no existe. Ejecuta final_script.cmd y elige 1 (Instalar); el inicio diario no crea ni reinstala componentes.' }
        Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'init', '--rootful=false', $Installation.MachineName)
    }
    $details = @(Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'inspect', $Installation.MachineName) -Capture) -join "`n"
    $machine = @($details | ConvertFrom-Json)[0]
    if ($machine.Rootful) { throw 'La maquina cambio a rootful. Restaura su conexion rootless antes de continuar; el almacenamiento es distinto.' }
    if ($machine.State -ne 'running') {
        Write-AntojitLog 'Iniciando la maquina local de Podman...'
        Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'start', $Installation.MachineName)
    } else {
        Write-AntojitLog "La maquina Podman $($Installation.MachineName) ya esta encendida; se usara sin recrearla."
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $os = @(Invoke-AntojitCommand -FilePath $podman -Arguments @('info', '--format', '{{.Host.OS}}') -Capture) -join ''
            if ($os.Trim() -eq 'linux') { return }
        } catch {
            if ((Get-Date) -ge $deadline) { throw 'Podman no estuvo listo a tiempo. Revisa WSL, ejecuta final_script.cmd y elige 2 (Iniciar).' }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw 'Podman no respondio como un motor Linux local.'
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

Export-ModuleMember -Function Start-AntojitLog, Write-AntojitLog, Get-AntojitLogPath, Write-AntojitError, Invoke-AntojitCommand, Enter-AntojitOperation,
    Protect-AntojitPath, Test-AntojitRepositoryUrl, Get-AntojitInstallation, Save-AntojitInstallation,
    Resolve-AntojitInstallPath,
    Assert-AntojitOwner, Assert-AntojitNoPendingUpdate, Resolve-AntojitMachineName, Assert-AntojitEnvironmentRecovery,
    Initialize-AntojitRuntime, Invoke-AntojitCompose, Invoke-AntojitPilot,
    Set-AntojitEnvironmentValue, Update-AntojitNetwork, Assert-AntojitWindows, Assert-AntojitAdministrator,
    Update-AntojitPath, Get-AntojitNode, Get-AntojitGit, Get-AntojitPodman, Install-AntojitDependencies
