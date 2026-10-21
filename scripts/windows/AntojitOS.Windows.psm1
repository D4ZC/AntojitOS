# Shared implementation for the three Windows entry points. Windows PowerShell 5.1.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Dependencies.psm1') -Force
$script:AntojitLogPath = $null

function Start-AntojitLog {
    param([Parameter(Mandatory)][string]$Path)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $script:AntojitLogPath = $Path
}

function Write-AntojitLog {
    param([Parameter(Mandatory)][string]$Message)
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    if ($script:AntojitLogPath) { Add-Content -LiteralPath $script:AntojitLogPath -Value $line -Encoding UTF8 }
}

function Invoke-AntojitCommand {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory,
        [switch]$Capture
    )
    if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
    try {
        # Windows PowerShell turns native stderr into ErrorRecords. Check the exit
        # code, rather than interpreting a successful program's stderr as failure.
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $global:LASTEXITCODE = $null
            if ($Capture) { $output = @(& $FilePath @Arguments 2>&1) }
            else { & $FilePath @Arguments 2>&1 | ForEach-Object { Write-Host $_.ToString() } }
            $code = $global:LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($null -eq $code -or $code -ne 0) {
            if ($Capture) { $output | ForEach-Object { Write-Host $_.ToString() } }
            throw "$(Split-Path -Leaf $FilePath) termino con codigo $code."
        }
        if ($Capture) { return @($output | ForEach-Object { $_.ToString() }) }
    } finally {
        if ($WorkingDirectory) { Pop-Location }
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
    if (-not (Test-Path -LiteralPath $path)) { throw 'Falta la instalacion de Windows. Ejecuta primero 01-instalar.ps1.' }
    $installation = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($installation.Version -ne 1 -or $installation.Engine -ne 'podman') { throw 'Configuracion Windows incompatible.' }
    if (-not [string]::Equals($root.TrimEnd('\'), $installation.Root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'La carpeta se movio. Restaura su ubicacion original; mover una instalacion requiere migrar tambien la tarea y su estado.'
    }
    foreach ($name in @('HttpPort', 'InternalHttpPort')) {
        if ([int]$installation.$name -lt 1 -or [int]$installation.$name -gt 65535) { throw "Puerto invalido: $name." }
    }
    if ($installation.HttpPort -eq $installation.InternalHttpPort) { throw 'Los puertos publico e interno deben ser diferentes.' }
    if ($installation.MachineName -notmatch '^[a-z][a-z0-9-]+$') { throw 'Nombre de maquina Podman invalido.' }
    return $installation
}

function Resolve-AntojitInstallPath {
    param([string]$InstallPath)
    if ($InstallPath) { return [IO.Path]::GetFullPath($InstallPath).TrimEnd('\', '/') }
    $location = Join-Path $env:ProgramData 'AntojitOS\installation-location.json'
    if (-not (Test-Path -LiteralPath $location)) { throw 'No se encontro la instalacion. Ejecuta primero 01-instalar.ps1.' }
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
        throw 'Hay una actualizacion pendiente. Resuelvela con 03-actualizar.ps1 antes de iniciar o reinstalar: algunas imagenes pueden haber cambiado.'
    }
}

function Initialize-AntojitRuntime {
    param([Parameter(Mandatory)]$Installation, [switch]$AllowCreate, [int]$TimeoutSeconds = 180)
    Update-AntojitPath
    if (-not (Test-Path -LiteralPath $Installation.ComposeProviderPath)) { throw 'Falta el proveedor Compose. Repite 01-instalar.ps1.' }
    $podman = Get-AntojitPodman
    if (-not $podman) { throw 'No se encontro Podman. Repite 01-instalar.ps1.' }
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
        if (-not $AllowCreate) { throw 'La maquina Podman no existe. Ejecuta 01-instalar.ps1; el inicio diario no crea ni reinstala componentes.' }
        Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'init', '--rootful=false', $Installation.MachineName)
    }
    $details = @(Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'inspect', $Installation.MachineName) -Capture) -join "`n"
    $machine = @($details | ConvertFrom-Json)[0]
    if ($machine.Rootful) { throw 'La maquina cambio a rootful. Restaura su conexion rootless antes de continuar; el almacenamiento es distinto.' }
    if ($machine.State -ne 'running') {
        Write-AntojitLog 'Iniciando la maquina local de Podman...'
        Invoke-AntojitCommand -FilePath $podman -Arguments @('machine', 'start', $Installation.MachineName)
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $os = @(Invoke-AntojitCommand -FilePath $podman -Arguments @('info', '--format', '{{.Host.OS}}') -Capture) -join ''
            if ($os.Trim() -eq 'linux') { return }
        } catch {
            if ((Get-Date) -ge $deadline) { throw 'Podman no estuvo listo a tiempo. Revisa WSL y vuelve a ejecutar 02-iniciar.ps1.' }
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
    if (-not $node) { throw 'Se requiere Node.js 24 o superior. Repite 01-instalar.ps1.' }
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

Export-ModuleMember -Function Start-AntojitLog, Write-AntojitLog, Invoke-AntojitCommand, Enter-AntojitOperation,
    Protect-AntojitPath, Test-AntojitRepositoryUrl, Get-AntojitInstallation, Save-AntojitInstallation,
    Resolve-AntojitInstallPath,
    Assert-AntojitOwner, Assert-AntojitNoPendingUpdate, Initialize-AntojitRuntime, Invoke-AntojitCompose, Invoke-AntojitPilot,
    Set-AntojitEnvironmentValue, Update-AntojitNetwork, Assert-AntojitWindows, Assert-AntojitAdministrator,
    Update-AntojitPath, Get-AntojitNode, Get-AntojitGit, Get-AntojitPodman, Install-AntojitDependencies
