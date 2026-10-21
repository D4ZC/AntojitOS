#Requires -Version 5.1
<#
.SYNOPSIS
Instala y configura AntojitOS en una PC Windows 11 x64.
.DESCRIPTION
Ejecutar como administrador con la cuenta que operara la PC. Conserva secretos y
datos existentes. Si WSL requiere reiniciar, devuelve 3010: reinicia Windows y
ejecuta el mismo comando otra vez. No reinicia la PC automaticamente.
.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\01-instalar.ps1
.EXAMPLE
.\01-instalar.ps1 -RepositoryUrl https://github.com/EMPRESA/REPO.git -AutoStartMode Logon
#>
[CmdletBinding()]
param(
    [string]$InstallPath = (Join-Path $env:ProgramFiles 'AntojitOS'),
    [string]$RepositoryUrl,
    [string]$Branch,
    [ValidateRange(1, 65535)][int]$HttpPort = 8080,
    [ValidateRange(1, 65535)][int]$InternalHttpPort = 18080,
    [string]$PrinterHost,
    [ValidateRange(1, 65535)][int]$PrinterPort = 9100,
    [ValidateSet('Startup', 'Logon')][string]$AutoStartMode = 'Startup',
    [switch]$Managed
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$bootstrapLock = $null
$operation = $null

function Copy-AntojitSource {
    param([string]$Source, [string]$Destination, [bool]$IncludeGitHistory = $true)
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($item.Name -in @('node_modules', 'dist', 'coverage', 'backups', 'var', '.pnpm-store', '.DS_Store')) { continue }
        if (($item.Name -eq '.env' -or $item.Name -like '.env.*') -and $item.Name -notlike '*.example') { continue }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        if ($item.Name -eq '.git') {
            # A worktree's .git file points back to the developer PC. Treat that
            # source as a ZIP/snapshot instead of copying a dangling reference.
            if ($item.PSIsContainer -and $IncludeGitHistory) { Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse }
            continue
        }
        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) { Copy-AntojitSource -Source $item.FullName -Destination $target -IncludeGitHistory $IncludeGitHistory }
        else { Copy-Item -LiteralPath $item.FullName -Destination $target }
    }
}

function Resolve-AntojitLauncher {
    param([string]$SourceRoot, [string]$Root, [string]$BootstrapDirectory, [string]$OwnerSid, $Installation)
    $files = @('final_script.ps1', 'scripts\windows\01-instalar.ps1', 'scripts\windows\02-iniciar.ps1',
        'scripts\windows\03-actualizar.ps1', 'scripts\windows\AntojitOS.Windows.psm1', 'scripts\windows\AntojitOS.Dependencies.psm1')
    $needsBundle = $false
    foreach ($file in $files) {
        $sourceFile = Join-Path $SourceRoot $file
        $installedFile = Join-Path $Root $file
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Proyecto de preparacion incompleto: falta $sourceFile." }
        if (-not (Test-Path -LiteralPath $installedFile -PathType Leaf)) { $needsBundle = $true; continue }
        if ((Get-FileHash -LiteralPath $sourceFile).Hash -ne (Get-FileHash -LiteralPath $installedFile).Hash) { $needsBundle = $true }
    }
    if ($Installation.PSObject.Properties['LauncherPath'] -and $Installation.LauncherPath) { $needsBundle = $true }
    if (-not $needsBundle) { return (Join-Path $Root 'final_script.ps1') }
    # An earlier/partial installation may contain old helpers. Keep the new
    # bootstrap outside its Git tree so updates still see an unchanged checkout.
    $bundle = Join-Path $BootstrapDirectory 'launcher'
    $staging = Join-Path $BootstrapDirectory ('launcher-stage-' + [guid]::NewGuid().ToString('N'))
    $previous = Join-Path $BootstrapDirectory ('launcher-previous-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Protect-AntojitPath -Path $staging -OwnerSid $OwnerSid
    try {
        foreach ($file in $files) {
            $target = Join-Path $staging $file
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $SourceRoot $file) -Destination $target -Force
        }
        if (Test-Path -LiteralPath $bundle) { Move-Item -LiteralPath $bundle -Destination $previous }
        try { Move-Item -LiteralPath $staging -Destination $bundle }
        catch {
            $launcherError = $_
            if ((Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $bundle)) {
                try { Move-Item -LiteralPath $previous -Destination $bundle }
                catch { Write-AntojitLog "No se pudo reponer el lanzador anterior. Se conserva en $previous. Repite la instalacion antes de reiniciar." }
            }
            throw $launcherError
        }
        if (Test-Path -LiteralPath $previous) {
            try { Remove-Item -LiteralPath $previous -Recurse -Force }
            catch { Write-AntojitLog "La copia anterior del lanzador se conserva en $previous." }
        }
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Write-AntojitLog "La instalacion anterior usara el lanzador actualizado en $bundle. Se conserva su codigo, configuracion y datos."
    return (Join-Path $bundle 'final_script.ps1')
}

try {
    Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Windows.psm1') -Force -DisableNameChecking
    Assert-AntojitWindows
    Assert-AntojitAdministrator
    if (-not $PSBoundParameters.ContainsKey('InstallPath') -and (Test-Path -LiteralPath (Join-Path $env:ProgramData 'AntojitOS\installation-location.json'))) {
        $InstallPath = Resolve-AntojitInstallPath
    }
    if ($HttpPort -eq $InternalHttpPort) { throw 'Los puertos publico e interno deben ser diferentes.' }
    if ($RepositoryUrl) { $RepositoryUrl = Test-AntojitRepositoryUrl $RepositoryUrl }
    $root = [IO.Path]::GetFullPath($InstallPath).TrimEnd('\', '/')
    if ($PrinterHost -and [Uri]::CheckHostName($PrinterHost) -eq [UriHostNameType]::Unknown) { throw 'PrinterHost debe ser una IP o un nombre de red valido.' }
    $programFiles = [IO.Path]::GetFullPath($env:ProgramFiles).TrimEnd('\') + '\'
    if (-not $root.StartsWith($programFiles, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'La instalacion debe estar dentro de Program Files, donde el codigo del arranque automatico queda protegido. Usa el destino predeterminado.'
    }
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent()
    $bootstrapDirectory = Join-Path $env:ProgramData 'AntojitOS'
    New-Item -ItemType Directory -Path $bootstrapDirectory -Force | Out-Null
    Protect-AntojitPath -Path $bootstrapDirectory -OwnerSid $owner.User.Value
    $bootstrapLock = Enter-AntojitOperation -Root $bootstrapDirectory
    $locationFile = Join-Path $bootstrapDirectory 'installation-location.json'
    if (Test-Path -LiteralPath $locationFile) {
        $location = Get-Content -LiteralPath $locationFile -Raw | ConvertFrom-Json
        if ($location.Root.TrimEnd('\', '/') -ine $root -or $location.OwnerSid -ne $owner.User.Value) {
            throw "Esta PC ya tiene una instalacion en $($location.Root), asociada a otra ruta o cuenta. Usa esa instalacion para conservar su base de datos."
        }
    }
    $existingTask = Get-ScheduledTask -TaskName 'AntojitOS-Inicio' -ErrorAction SilentlyContinue
    if ($existingTask -and $existingTask.Actions[0].WorkingDirectory -ine $root) {
        throw 'Ya hay una tarea de AntojitOS para otra carpeta. No se cambiaron sus servicios ni sus credenciales.'
    }
    $existingState = Join-Path $root 'var\windows\installation.json'
    if (Test-Path -LiteralPath $existingState) {
        $previousInstallation = Get-AntojitInstallation -InstallPath $root
        Assert-AntojitOwner -Installation $previousInstallation
        Assert-AntojitNoPendingUpdate -Installation $previousInstallation
    }
    $tools = Install-AntojitDependencies -ToolsDirectory (Join-Path $bootstrapDirectory 'tools')

    if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json'))) {
        if ((Test-Path -LiteralPath $root) -and @(Get-ChildItem -LiteralPath $root -Force).Count -gt 0) {
            throw 'La carpeta de destino contiene archivos. El instalador no los reemplaza.'
        }
        if ($RepositoryUrl) {
            $cloneArguments = @('clone')
            if ($Branch) { $cloneArguments += @('--branch', $Branch) }
            $cloneArguments += @('--', $RepositoryUrl, $root)
            Invoke-AntojitCommand -FilePath $tools.GitPath -Arguments $cloneArguments
        } else {
            $source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
            if (-not (Test-Path -LiteralPath (Join-Path $source 'compose.pilot.yaml'))) {
                throw 'Copia el proyecto completo a esta PC y ejecuta su instalador, o indica -RepositoryUrl.'
            }
            Write-Host "Copiando el proyecto a $root..."
            $copyHistory = Test-Path -LiteralPath (Join-Path $source '.git') -PathType Container
            if ($copyHistory) {
                $sourceChanges = @(Invoke-AntojitCommand -FilePath $tools.GitPath -Arguments @('-C', $source, 'status', '--porcelain=v1', '--untracked-files=all') -Capture) -join ''
                if ($sourceChanges.Trim()) {
                    $copyHistory = $false
                    Write-Host 'La fuente incluye cambios locales. Se instalara una instantanea con esos archivos para permitir futuras actualizaciones desde GitHub.'
                }
            }
            Copy-AntojitSource -Source $source -Destination $root -IncludeGitHistory $copyHistory
        }
    }
    if (Test-Path -LiteralPath (Join-Path $root '.git')) {
        # A repository copied from macOS can have core.filemode=true; NTFS does
        # not represent those executable bits, which otherwise dirties the copy.
        Invoke-AntojitCommand -FilePath $tools.GitPath -Arguments @('-C', $root, 'config', 'core.filemode', 'false')
    }
    foreach ($required in @('compose.pilot.yaml', 'Containerfile', '.env.pilot.example', 'scripts\pilot.mjs')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $required))) { throw "El proyecto esta incompleto: falta $required." }
    }
    Protect-AntojitPath -Path $root -OwnerSid $owner.User.Value
    [pscustomobject]@{ Root = $root; OwnerSid = $owner.User.Value } | ConvertTo-Json | Set-Content -LiteralPath $locationFile -Encoding UTF8
    $operation = Enter-AntojitOperation -Root $root
    $stateDirectory = Join-Path $root 'var\windows'
    Protect-AntojitPath -Path $stateDirectory -OwnerSid $owner.User.Value
    Start-AntojitLog -Path (Join-Path $stateDirectory ('logs\install-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd')))
    $statePath = Join-Path $stateDirectory 'installation.json'
    if (Test-Path -LiteralPath $statePath) {
        $installation = Get-AntojitInstallation -InstallPath $root
        Assert-AntojitOwner -Installation $installation
        foreach ($name in @('HttpPort', 'InternalHttpPort')) {
            if ($PSBoundParameters.ContainsKey($name) -and (Get-Variable $name -ValueOnly) -ne $installation.$name) {
                throw "La instalacion ya usa otro $name. Conserva el puerto registrado para no cambiar la conexion de las terminales."
            }
        }
        if (-not $PSBoundParameters.ContainsKey('AutoStartMode')) { $AutoStartMode = $installation.AutoStartMode }
    } else {
        # A pre-existing machine without this installation's configuration must
        # never be adopted with a fresh database password.
        $env:CONTAINERS_MACHINE_PROVIDER = 'wsl'
        $machineList = @(Invoke-AntojitCommand -FilePath $tools.PodmanPath -Arguments @('machine', 'list', '--format', 'json') -Capture) -join "`n"
        if (@($machineList | ConvertFrom-Json | Where-Object { $_.Name -eq 'antojitos-pilot' }).Count -gt 0) {
            throw 'Ya existe una maquina antojitos-pilot sin su configuracion Windows. Recupera la instalacion y .env.pilot anteriores antes de continuar.'
        }
        $sourceMode = 'git'
        if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) { $sourceMode = 'snapshot' }
        $installation = [pscustomobject]@{
            Version = 1
            Root = $root
            StateDirectory = $stateDirectory
            Engine = 'podman'
            MachineName = 'antojitos-pilot'
            OwnerSid = $owner.User.Value
            OwnerName = $owner.Name
            ComposeProviderPath = $tools.ComposeProviderPath
            HttpPort = $HttpPort
            InternalHttpPort = $InternalHttpPort
            AutoStartMode = $AutoStartMode
            RepositoryUrl = $null
            Branch = $null
            SourceMode = $sourceMode
            EnvironmentCreated = $false
            Completed = $false
        }
    }
    $installation.ComposeProviderPath = $tools.ComposeProviderPath
    $installation.AutoStartMode = $AutoStartMode
    $launcher = Resolve-AntojitLauncher -SourceRoot ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))) `
        -Root $root -BootstrapDirectory $bootstrapDirectory -OwnerSid $owner.User.Value -Installation $installation
    if ($launcher -ine (Join-Path $root 'final_script.ps1')) {
        $installation | Add-Member -NotePropertyName LauncherPath -NotePropertyValue $launcher -Force
    }
    if ($RepositoryUrl) { $installation.RepositoryUrl = $RepositoryUrl }
    if ($Branch) {
        Invoke-AntojitCommand -FilePath $tools.GitPath -Arguments @('check-ref-format', '--branch', $Branch)
        $installation.Branch = $Branch
    }
    Save-AntojitInstallation -Installation $installation
    $environmentFile = Join-Path $root '.env.pilot'
    if (-not (Test-Path -LiteralPath $environmentFile)) {
        if ($installation.EnvironmentCreated) {
            throw 'Falta .env.pilot en una instalacion existente. Recupera su copia de respaldo para conservar las credenciales de la base.'
        }
        Write-AntojitLog 'Generando secretos y codigos nuevos. Se guardan en .env.pilot; consulta ese archivo de forma privada para verlos.'
        Invoke-AntojitPilot -Root $root -Command 'init'
    } else { Write-AntojitLog 'Se conserva la configuracion y los codigos existentes.' }
    $installation.EnvironmentCreated = $true
    Save-AntojitInstallation -Installation $installation
    Protect-AntojitPath -Path $environmentFile -OwnerSid $installation.OwnerSid
    Set-AntojitEnvironmentValue -Path $environmentFile -Name 'PILOT_HTTP_PORT' -Value ([string]$installation.InternalHttpPort)
    Set-AntojitEnvironmentValue -Path $environmentFile -Name 'PILOT_BIND_ADDRESS' -Value '127.0.0.1'
    if ($PrinterHost) {
        Set-AntojitEnvironmentValue -Path $environmentFile -Name 'PRINT_AGENT_MODE' -Value 'tcp'
        Set-AntojitEnvironmentValue -Path $environmentFile -Name 'PRINTER_HOST' -Value $PrinterHost
        Set-AntojitEnvironmentValue -Path $environmentFile -Name 'PRINTER_PORT' -Value ([string]$PrinterPort)
    }
    $backupDirectory = Join-Path $root 'backups'
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    Protect-AntojitPath -Path $backupDirectory -OwnerSid $installation.OwnerSid

    if ($installation.SourceMode -eq 'snapshot') {
        if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
            Invoke-AntojitCommand -FilePath $tools.GitPath -Arguments @('init', '--initial-branch=antojitos-local-installation', $root)
        }
        # Keep a baseline so a ZIP install can later adopt the supplied GitHub
        # repository without discarding locally edited files or its old source.
        $head = & $tools.GitPath -C $root rev-parse --verify --quiet HEAD
        if ($LASTEXITCODE -ne 0) {
            foreach ($localPath in @('.env.pilot', 'var/windows/installation.json', 'backups/')) {
                Invoke-AntojitCommand -FilePath $tools.GitPath -Arguments @('-C', $root, 'check-ignore', '-q', '--', $localPath)
            }
            Invoke-AntojitCommand -FilePath $tools.GitPath -Arguments @('-C', $root, 'add', '--all')
            Invoke-AntojitCommand -FilePath $tools.GitPath -Arguments @('-C', $root, '-c', 'user.name=AntojitOS Installer',
                '-c', 'user.email=installer@antojit-os.local', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=NUL', 'commit', '-m', 'Installation source snapshot')
        }
    }
    Initialize-AntojitRuntime -Installation $installation -AllowCreate:(-not $installation.Completed)
    if ($installation.Completed) {
        Write-AntojitLog 'La instalacion ya estaba completa. Se inician sus imagenes existentes.'
        Invoke-AntojitPilot -Root $root -Command 'start'
    } else {
        Write-AntojitLog 'Construyendo e iniciando la aplicacion. La primera instalacion puede tardar varios minutos.'
        Invoke-AntojitPilot -Root $root -Command 'up'
        Invoke-AntojitPilot -Root $root -Command 'ensure-seeded'
    }
    Update-AntojitNetwork -Installation $installation
    Invoke-AntojitPilot -Root $root -Command 'verify'
    # Release the application lock before handing control to the startup script.
    $operation.Dispose()
    $operation = $null
    $startScript = Join-Path (Split-Path -Parent $launcher) 'scripts\windows\02-iniciar.ps1'
    # Keep all setup and registration errors in the same console and session log.
    & $startScript -InstallPath $root -RegisterAutoStart -AutoStartMode $AutoStartMode -Managed
    $operation = Enter-AntojitOperation -Root $root
    $installation = Get-AntojitInstallation -InstallPath $root
    $installation.Completed = $true
    Save-AntojitInstallation -Installation $installation
    Write-AntojitLog "Instalacion lista. Abre http://localhost:$($installation.HttpPort). Para las tablets usa la IP de esta PC y ese puerto."
    Write-AntojitLog 'La conexion del restaurante debe estar marcada como red privada en Windows.'
} catch {
    if (Get-Command Write-AntojitError -ErrorAction SilentlyContinue) { Write-AntojitError -ErrorRecord $_ }
    else { Write-Host ($_ | Format-List * -Force | Out-String) }
    if ($_.Exception.Data['RestartRequired']) {
        Write-Host 'WSL necesita reiniciar Windows. Reinicia y vuelve a ejecutar el mismo comando de instalacion.'
        if ($Managed) { throw }
        exit 3010
    }
    if ($Managed) { throw }
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
} finally {
    if ($operation) { $operation.Dispose() }
    if ($bootstrapLock) { $bootstrapLock.Dispose() }
}
if (-not $Managed) { exit 0 }
