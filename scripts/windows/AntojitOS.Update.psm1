#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-AntojitUpdateExcluded {
    param([string]$Name)
    if ($Name -in @('.git', 'var', 'backups', 'node_modules', 'dist', 'coverage', '.pnpm-store', '.DS_Store')) { return $true }
    if (($Name -eq '.env' -or $Name.StartsWith('.env.')) -and -not $Name.EndsWith('.example')) { return $true }
    return ($Name -match '(?i)\.(log|zip|dump)$')
}

function Test-AntojitUpdateBootstrapPath {
    param([Parameter(Mandatory)][string]$Path)
    return ($Path.StartsWith('scripts/windows/', [StringComparison]::OrdinalIgnoreCase) -or
        $Path -in @('final_script.ps1', 'final_script.cmd', 'ACTUALIZAR-APP.cmd', 'RECUPERAR-ACTUALIZACION.cmd'))
}

function Get-AntojitUpdateManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Root)
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $base -PathType Container)) { throw "No existe la carpeta del proyecto: $base" }
    $items = New-Object 'System.Collections.Generic.List[string]'
    $directories = New-Object 'System.Collections.Generic.Queue[string]'
    $directories.Enqueue($base)
    while ($directories.Count -gt 0) {
        $directory = $directories.Dequeue()
        if (((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "El codigo no puede contener enlaces: $directory" }
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if (Test-AntojitUpdateExcluded -Name $item.Name) { continue }
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "El codigo no puede contener enlaces: $($item.FullName)" }
            if ($item.PSIsContainer) { $directories.Enqueue($item.FullName) }
            else { $items.Add($item.FullName.Substring($base.Length + 1).Replace('\', '/')) }
        }
    }
    $files = $items.ToArray()
    [Array]::Sort($files, [StringComparer]::Ordinal)
    $lines = New-Object Text.StringBuilder
    $applicationLines = New-Object Text.StringBuilder
    foreach ($file in $files) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $base $file) -Algorithm SHA256).Hash
        [void]$lines.Append($file.Length).Append(':').Append($file).Append(':').Append($hash).Append("`n")
        # Only these Windows launchers can change during recovery of the same
        # application version. Keep build inputs, migrations and pilot.mjs here.
        if (-not (Test-AntojitUpdateBootstrapPath -Path $file)) {
            [void]$applicationLines.Append($file.Length).Append(':').Append($file).Append(':').Append($hash).Append("`n")
        }
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($lines.ToString()))
        $applicationDigest = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($applicationLines.ToString()))
    }
    finally { $sha.Dispose() }
    [pscustomobject]@{
        Hash = ([BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant())
        ApplicationHash = ([BitConverter]::ToString($applicationDigest).Replace('-', '').ToLowerInvariant())
        Files = @($files)
    }
}

function Assert-AntojitUpdateProject {
    param([Parameter(Mandatory)][string]$Root)
    foreach ($file in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'Containerfile', 'compose.pilot.yaml', '.dockerignore',
        'final_script.ps1', 'final_script.cmd', 'ACTUALIZAR-APP.cmd', 'scripts/pilot.mjs',
        'scripts/windows/01-instalar.ps1', 'scripts/windows/02-iniciar.ps1', 'scripts/windows/03-actualizar.ps1',
        'scripts/windows/AntojitOS.Dependencies.psm1', 'scripts/windows/AntojitOS.Update.psm1',
        'scripts/windows/AntojitOS.Windows.psm1', 'scripts/windows/AntojitOS.Printing.psm1',
        'apps/api/package.json', 'apps/pos/package.json', 'apps/print-agent/package.json', 'packages/domain/package.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $file) -PathType Leaf)) { throw "ZIP incompleto: falta $file. Extrae el proyecto completo antes de actualizar." }
    }
    # Frozen releases predating the network check remain valid recovery sources.
    if ([IO.File]::ReadAllText((Join-Path $Root 'Containerfile')).Contains('scripts/check-npm-registry.mjs') -and
        -not (Test-Path -LiteralPath (Join-Path $Root 'scripts/check-npm-registry.mjs') -PathType Leaf)) {
        throw 'ZIP incompleto: falta scripts/check-npm-registry.mjs. Extrae el proyecto completo antes de actualizar.'
    }
    if (@(Get-ChildItem -LiteralPath (Join-Path $Root 'apps/api/migrations') -Filter '*.sql' -File -ErrorAction SilentlyContinue).Count -eq 0) {
        throw 'ZIP incompleto: faltan las migraciones de la API.'
    }
}

function Get-AntojitPendingSnapshot {
    param([Parameter(Mandatory)]$Installation, [Parameter(Mandatory)]$Pending, [Parameter(Mandatory)][string]$PendingPath)
    if (-not $Pending.PSObject.Properties['SourceKind'] -or $Pending.SourceKind -ne 'folder') {
        throw "Hay un despliegue pendiente de otro origen que pudo aplicar migraciones. Reintenta su mismo origen; no se sustituira por otro ZIP. Conserva $PendingPath y sus respaldos."
    }
    if (-not $Pending.PSObject.Properties['Version'] -or $Pending.Version -ne 1 -or
        -not $Pending.PSObject.Properties['SourceHash'] -or $Pending.SourceHash -cnotmatch '^[a-f0-9]{64}$') {
        throw "El estado pendiente no identifica una version de carpeta valida. Conserva $PendingPath y sus respaldos."
    }
    $expected = [IO.Path]::GetFullPath((Join-Path $Installation.StateDirectory ('update-source/' + $Pending.SourceHash + '/source')))
    if (-not $Pending.PSObject.Properties['SnapshotPath'] -or -not $Pending.SnapshotPath -or
        -not [IO.Path]::GetFullPath([string]$Pending.SnapshotPath).Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "La ruta de la copia congelada pendiente no corresponde a su version. Conserva $PendingPath y sus respaldos."
    }
    # Check the containing directories too: a junction above /source must not
    # redirect a protected recovery snapshot elsewhere.
    $current = $expected
    $state = [IO.Path]::GetFullPath($Installation.StateDirectory).TrimEnd('\', '/')
    while ($current.Length -ge $state.Length) {
        if (-not (Test-Path -LiteralPath $current -PathType Container)) { throw "No existe la copia congelada pendiente: $expected" }
        if (((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "La copia congelada pendiente no puede contener enlaces: $current"
        }
        if ($current.TrimEnd('\', '/').Equals($state, [StringComparison]::OrdinalIgnoreCase)) { break }
        $current = Split-Path -Parent $current
    }
    $manifest = Get-AntojitUpdateManifest -Root $expected
    if ($manifest.Hash -cne $Pending.SourceHash) { throw "La copia congelada cambio. No se usara: $expected" }
    Assert-AntojitUpdateProject -Root $expected
    return [pscustomobject]@{ Path = $expected; Manifest = $manifest }
}

function New-AntojitPendingRecoverySource {
    param([Parameter(Mandatory)]$Installation, [Parameter(Mandatory)]$Snapshot,
        [Parameter(Mandatory)][string]$BootstrapRoot, [Parameter(Mandatory)]$BootstrapManifest)
    $directory = Join-Path ([IO.Path]::GetTempPath()) ('AntojitOS-recovery-' + [guid]::NewGuid().ToString('N'))
    Assert-AntojitDisjointUpdatePaths -SourcePath $directory -DestinationPath $Installation.Root
    try {
        New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null
        Protect-AntojitPath -Path $directory -OwnerSid $Installation.OwnerSid
        $source = Join-Path $directory 'source'
        $copied = New-AntojitUpdateSnapshot -SourcePath $Snapshot.Path -DestinationPath $source
        if ($copied.Hash -cne $Snapshot.Manifest.Hash) { throw 'La copia congelada cambio antes de preparar su recuperacion.' }
        foreach ($relative in $copied.Files) {
            if (Test-AntojitUpdateBootstrapPath -Path $relative) { Remove-Item -LiteralPath (Join-Path $source $relative) -Force }
        }
        foreach ($relative in $BootstrapManifest.Files) {
            if (-not (Test-AntojitUpdateBootstrapPath -Path $relative)) { continue }
            $target = Join-Path $source $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $BootstrapRoot $relative) -Destination $target -Force
        }
        if ((Get-AntojitUpdateManifest -Root $BootstrapRoot).Hash -cne $BootstrapManifest.Hash) {
            throw 'El ZIP de auxiliares cambio durante la recuperacion. Conserva el origen sin modificar y vuelve a intentar.'
        }
        $manifest = Get-AntojitUpdateManifest -Root $source
        if ($manifest.ApplicationHash -cne $Snapshot.Manifest.ApplicationHash) {
            throw 'La recuperacion no conserva exactamente la aplicacion pendiente. Se cancelo sin sustituirla.'
        }
        Assert-AntojitUpdateProject -Root $source
        return [pscustomobject]@{ Directory = $directory; SourcePath = $source; Manifest = $manifest }
    } catch {
        $recoveryError = $_
        try { if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force } }
        catch { Write-Warning "No se pudo retirar la carpeta temporal de recuperacion: $directory" }
        throw $recoveryError
    }
}

function Assert-AntojitDisjointUpdatePaths {
    param([string]$SourcePath, [string]$DestinationPath)
    $source = [IO.Path]::GetFullPath($SourcePath).TrimEnd('\', '/')
    $destination = [IO.Path]::GetFullPath($DestinationPath).TrimEnd('\', '/')
    $separator = [IO.Path]::DirectorySeparatorChar
    if ($source.Equals($destination, [StringComparison]::OrdinalIgnoreCase) -or
        $destination.StartsWith($source + $separator, [StringComparison]::OrdinalIgnoreCase) -or
        $source.StartsWith($destination + $separator, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Usa el ZIP completo extraido en una carpeta nueva, fuera de la instalacion. El origen y el destino no pueden contenerse.'
    }
}

function New-AntojitUpdateSnapshot {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$SourcePath, [Parameter(Mandatory)][string]$DestinationPath)
    Assert-AntojitDisjointUpdatePaths -SourcePath $SourcePath -DestinationPath $DestinationPath
    if (Test-Path -LiteralPath $DestinationPath) { throw "Ya existe el destino de la copia: $DestinationPath" }
    $manifest = Get-AntojitUpdateManifest -Root $SourcePath
    New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    foreach ($relative in $manifest.Files) {
        $target = Join-Path $DestinationPath $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $SourcePath $relative) -Destination $target -Force
    }
    $copied = Get-AntojitUpdateManifest -Root $DestinationPath
    if ($copied.Hash -cne $manifest.Hash -or (Get-AntojitUpdateManifest -Root $SourcePath).Hash -cne $manifest.Hash) {
        throw 'El proyecto cambio durante la copia. Conserva el ZIP sin modificar y vuelve a intentar.'
    }
    return $copied
}

function Sync-AntojitUpdateSource {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$SourcePath, [Parameter(Mandatory)][string]$DestinationPath)
    $source = Get-AntojitUpdateManifest -Root $SourcePath
    $destination = Get-AntojitUpdateManifest -Root $DestinationPath
    $known = @{}
    foreach ($relative in $source.Files) { $known[$relative] = $true }
    # Delete only application-owned source, never a whole tree containing local state.
    $rootFiles = @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'Containerfile',
        'compose.pilot.yaml', '.dockerignore', '.gitignore', '.env.example', '.env.pilot.example',
        'final_script.ps1', 'final_script.cmd', 'ACTUALIZAR-APP.cmd', 'RECUPERAR-ACTUALIZACION.cmd', 'README.md')
    foreach ($relative in $destination.Files) {
        if (-not $known.ContainsKey($relative) -and ($relative -match '^(apps|packages|scripts|deploy|docs|\.github)/' -or $relative -in $rootFiles)) {
            Remove-Item -LiteralPath (Join-Path $DestinationPath $relative) -Force
        }
    }
    foreach ($relative in $source.Files) {
        $target = Join-Path $DestinationPath $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        $temporary = $target + '.update-' + [guid]::NewGuid().ToString('N')
        try {
            Copy-Item -LiteralPath (Join-Path $SourcePath $relative) -Destination $temporary -Force
            Move-Item -LiteralPath $temporary -Destination $target -Force
        } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
    }
}

function Save-AntojitUpdateRecord {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Record)
    $temporary = "$Path.tmp"
    [IO.File]::WriteAllText($temporary, ($Record | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Invoke-AntojitCandidateBuild {
    param([Parameter(Mandatory)]$Installation, [Parameter(Mandatory)][string]$SourceRoot)
    # Compose also resolves service env_file relative to its YAML, not --env-file.
    Copy-Item -LiteralPath (Join-Path $Installation.Root '.env.pilot') -Destination (Join-Path $SourceRoot '.env.pilot') -Force
    foreach ($service in @('api', 'web', 'print-agent')) {
        Invoke-AntojitCommand -FilePath (Get-AntojitPodman) -WorkingDirectory $SourceRoot -Arguments @(
            'compose', '--env-file', (Join-Path $Installation.Root '.env.pilot'), '-f', (Join-Path $SourceRoot 'compose.pilot.yaml'),
            '-p', 'antojitos-pilot', 'build', $service)
    }
}

function New-AntojitDatabaseUpdateBackup {
    param([Parameter(Mandatory)]$Installation, [Parameter(Mandatory)][string]$BackupDirectory)
    $allBackups = Join-Path $Installation.Root 'backups'
    New-Item -ItemType Directory -Path $allBackups -Force | Out-Null
    $before = @(Get-ChildItem -LiteralPath $allBackups -Filter '*.dump' -File | Select-Object -ExpandProperty FullName)
    Invoke-AntojitPilot -Root $Installation.Root -Command 'backup'
    $created = @(Get-ChildItem -LiteralPath $allBackups -Filter '*.dump' -File | Where-Object { $before -notcontains $_.FullName })
    if ($created.Count -ne 1) { throw "No se identifico un unico respaldo nuevo en $allBackups." }
    $backup = Join-Path $BackupDirectory $created[0].Name
    Move-Item -LiteralPath $created[0].FullName -Destination $backup
    if (Test-Path -LiteralPath ($created[0].FullName + '.json')) { Move-Item -LiteralPath ($created[0].FullName + '.json') -Destination "$backup.json" }
    Invoke-AntojitPilot -Root $Installation.Root -Command 'verify-backup' -Arguments @($backup)
    return $backup
}

function Update-AntojitLauncherBundle {
    param([Parameter(Mandatory)]$Installation)
    if (-not $Installation.PSObject.Properties['LauncherPath'] -or -not $Installation.LauncherPath -or
        [IO.Path]::GetFullPath($Installation.LauncherPath).Equals((Join-Path $Installation.Root 'final_script.ps1'), [StringComparison]::OrdinalIgnoreCase)) { return }
    $bundle = Split-Path -Parent ([string]$Installation.LauncherPath)
    $parent = Split-Path -Parent $bundle
    $staging = Join-Path $parent ('launcher-stage-' + [guid]::NewGuid().ToString('N'))
    $previous = Join-Path $parent ('launcher-previous-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Protect-AntojitPath -Path $staging -OwnerSid $Installation.OwnerSid
    try {
        foreach ($relative in @('final_script.ps1', 'scripts/windows/01-instalar.ps1', 'scripts/windows/02-iniciar.ps1',
            'scripts/windows/03-actualizar.ps1', 'scripts/windows/AntojitOS.Windows.psm1', 'scripts/windows/AntojitOS.Dependencies.psm1',
            'scripts/windows/AntojitOS.Printing.psm1', 'scripts/windows/AntojitOS.Update.psm1')) {
            $target = Join-Path $staging $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $Installation.Root $relative) -Destination $target -Force
        }
        if (Test-Path -LiteralPath $bundle) { Move-Item -LiteralPath $bundle -Destination $previous }
        try { Move-Item -LiteralPath $staging -Destination $bundle }
        catch {
            if ((Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $bundle)) { Move-Item -LiteralPath $previous -Destination $bundle }
            throw
        }
        # Retain the previous launcher with the other recovery material.
    } finally { if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Force -Recurse } }
}

function Invoke-AntojitFolderUpdate {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$SourcePath, [string]$InstallPath, [switch]$ConfirmMaintenance, [string]$PrinterQueue,
        [switch]$ResumePending)
    $operation = $null
    $installation = $null
    $pending = $null
    $backupDirectory = $null
    $servicesStopped = $false
    $codeApplied = $false
    $mayHaveMigrated = $false
    $maintenanceStarted = $false
    $oldPrintRuntime = $null
    $configurationChanged = $false
    $hadPrintEnvironment = $false
    $bootstrapRetry = $null
    $recoverySource = $null
    try {
        Assert-AntojitWindows
        Assert-AntojitAdministrator
        $installation = Get-AntojitInstallation -InstallPath (Resolve-AntojitInstallPath -InstallPath $InstallPath)
        Assert-AntojitOwner -Installation $installation
        $source = [IO.Path]::GetFullPath($SourcePath).TrimEnd('\', '/')
        Assert-AntojitDisjointUpdatePaths -SourcePath $source -DestinationPath $installation.Root
        Assert-AntojitUpdateProject -Root $source
        $operation = Enter-AntojitOperation -Root $installation.Root
        Start-AntojitLog -Path (Join-Path $installation.StateDirectory ('logs/update-folder-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log'))
        $manifest = Get-AntojitUpdateManifest -Root $source
        $pendingPath = Join-Path $installation.StateDirectory 'update-pending.json'
        $previousSnapshot = $null
        if (Test-Path -LiteralPath $pendingPath) {
            $pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
            $mayHaveMigrated = ($pending.MayHaveMigrated -eq $true)
            if ($ResumePending -or $mayHaveMigrated) {
                $previousSnapshot = Get-AntojitPendingSnapshot -Installation $installation -Pending $pending -PendingPath $pendingPath
            }
            if ($mayHaveMigrated -and -not $ResumePending) {
                $pendingMessage = "Hay un despliegue pendiente que pudo aplicar migraciones. Reintenta su mismo origen; no se sustituira por otro ZIP. Conserva $pendingPath y sus respaldos."
                if ($pending.SourceHash -cne $manifest.Hash) {
                    # A bootstrap fix must prove that every application path and
                    # byte still matches the immutable source that may have run.
                    if ($previousSnapshot.Manifest.ApplicationHash -cne $manifest.ApplicationHash) { throw $pendingMessage }
                    $bootstrapRetry = [pscustomobject]@{
                        PreviousSourceHash = $pending.SourceHash
                        SourceHash = $manifest.Hash
                        ValidatedSnapshotPath = $previousSnapshot.Path
                        AcceptedAt = [DateTime]::UtcNow.ToString('o')
                    }
                }
            }
        } elseif ($ResumePending) {
            throw 'No hay una actualizacion pendiente que recuperar. Abre ACTUALIZAR-APP.cmd para instalar la version nueva.'
        }
        if (-not $ConfirmMaintenance) { throw 'Cierra caja y sal de todas las terminales. Confirma ACTUALIZAR en el lanzador o usa -ConfirmMaintenance para continuar.' }
        if ($ResumePending) {
            $requestedHash = $manifest.Hash
            $recoverySource = New-AntojitPendingRecoverySource -Installation $installation -Snapshot $previousSnapshot -BootstrapRoot $source -BootstrapManifest $manifest
            $source = $recoverySource.SourcePath
            $manifest = $recoverySource.Manifest
            $bootstrapRetry = [pscustomobject]@{
                PreviousSourceHash = $pending.SourceHash
                SourceHash = $manifest.Hash
                ValidatedSnapshotPath = $previousSnapshot.Path
                RequestedSourceHash = $requestedHash
                Recovery = $true
                AcceptedAt = [DateTime]::UtcNow.ToString('o')
            }
            Write-AntojitLog 'Recuperando exclusivamente la aplicacion pendiente con los auxiliares Windows nuevos; los cambios de aplicacion del ZIP nuevo se instalaran despues.'
        }
        $maintenanceStarted = $true
        $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
        $backupDirectory = Join-Path $installation.Root ('backups/windows-update-' + $stamp)
        New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
        Protect-AntojitPath -Path $backupDirectory -OwnerSid $installation.OwnerSid
        Save-AntojitUpdateRecord -Path (Join-Path $backupDirectory 'installation.json') -Record $installation
        foreach ($relative in @('.env.pilot', '.env.print-agent')) {
            $path = Join-Path $installation.Root $relative
            if (Test-Path -LiteralPath $path -PathType Leaf) { Copy-Item -LiteralPath $path -Destination (Join-Path $backupDirectory $relative) -Force }
        }
        $hadPrintEnvironment = Test-Path -LiteralPath (Join-Path $backupDirectory '.env.print-agent') -PathType Leaf
        if (Test-Path -LiteralPath $pendingPath) { Copy-Item -LiteralPath $pendingPath -Destination (Join-Path $backupDirectory 'previous-pending.json') }
        # Backups live inside excluded /backups, so use a sibling temporary source
        # destination only through this controlled internal copy.
        $codeBackup = Join-Path $backupDirectory 'source'
        $oldManifest = Get-AntojitUpdateManifest -Root $installation.Root
        New-Item -ItemType Directory -Path $codeBackup -Force | Out-Null
        foreach ($relative in $oldManifest.Files) {
            $target = Join-Path $codeBackup $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $installation.Root $relative) -Destination $target -Force
        }
        if ((Get-AntojitUpdateManifest -Root $codeBackup).Hash -cne $oldManifest.Hash) { throw 'No se pudo verificar la copia del codigo instalado.' }
        $snapshot = Join-Path $installation.StateDirectory ('update-source/' + $manifest.Hash + '/source')
        if (Test-Path -LiteralPath $snapshot) {
            if ((Get-AntojitUpdateManifest -Root $snapshot).Hash -cne $manifest.Hash) { throw "La copia congelada cambio. No se usara: $snapshot" }
        } else {
            New-Item -ItemType Directory -Path (Split-Path -Parent $snapshot) -Force | Out-Null
            Protect-AntojitPath -Path (Split-Path -Parent $snapshot) -OwnerSid $installation.OwnerSid
            $frozen = New-AntojitUpdateSnapshot -SourcePath $source -DestinationPath $snapshot
            if ($frozen.Hash -cne $manifest.Hash) { throw 'El ZIP cambio antes de congelar la version. Vuelve a intentar desde la carpeta original.' }
        }
        $verified = @()
        if ($null -ne $pending -and $pending.PSObject.Properties['VerifiedBackups']) { $verified = @($pending.VerifiedBackups) }
        $firstBackup = $backupDirectory
        if ($null -ne $pending -and $pending.PSObject.Properties['FirstBackupDirectory']) { $firstBackup = $pending.FirstBackupDirectory }
        $bootstrapRetries = @()
        if ($null -ne $pending -and $pending.PSObject.Properties['BootstrapFixRetries']) { $bootstrapRetries = @($pending.BootstrapFixRetries) }
        if ($null -ne $bootstrapRetry) { $bootstrapRetries += $bootstrapRetry }
        $pending = [pscustomobject]@{
            Version = 1; SourceKind = 'folder'; SourceHash = $manifest.Hash; ApplicationHash = $manifest.ApplicationHash; SnapshotPath = $snapshot
            Stage = 'prepared'; MayHaveMigrated = $mayHaveMigrated
            FirstBackupDirectory = $firstBackup; LatestBackupDirectory = $backupDirectory
            VerifiedBackups = $verified; BootstrapFixRetries = $bootstrapRetries; CompletedAt = $null
        }
        Save-AntojitUpdateRecord -Path $pendingPath -Record $pending
        if ($null -ne $bootstrapRetry) {
            if ($ResumePending) {
                Write-AntojitLog 'Se verifico que la copia de recuperacion conserva la aplicacion pendiente, incorpora solo los auxiliares Windows nuevos y mantiene sus respaldos.'
            } else {
                Write-AntojitLog 'Se verifico que el nuevo ZIP solo corrige scripts Windows y conserva la misma aplicacion pendiente y sus respaldos.'
            }
        }
        $printBefore = Get-AntojitPrintConfiguration -Installation $installation
        if ($printBefore.Mode -eq 'native' -and (Test-Path -LiteralPath $printBefore.ActivePath -PathType Leaf)) {
            $oldPrintRuntime = [string](Get-Content -LiteralPath $printBefore.ActivePath -Raw | ConvertFrom-Json).RuntimeDirectory
        }
        $configurationChanged = $true
        $printing = Initialize-AntojitPrintConfiguration -Installation $installation -PrinterQueue $PrinterQueue
        Assert-AntojitNativePrintConfiguration -Installation $installation
        Initialize-AntojitRuntime -Installation $installation
        if ($mayHaveMigrated) {
            Stop-AntojitNativePrintAgent -Installation $installation
            $servicesStopped = $true
            Invoke-AntojitCompose -Installation $installation -Arguments @('stop', '--timeout', '30', 'web', 'print-agent', 'api')
        }
        # PostgreSQL alone may restart when recovering a previously stopped update.
        Invoke-AntojitCompose -Installation $installation -Arguments @('up', '--detach', '--no-build', '--pull', 'never', 'postgres')
        $deadline = (Get-Date).AddSeconds(120)
        while ($true) {
            try {
                Invoke-AntojitCompose -Installation $installation -Arguments @('exec', '-T', 'postgres', 'pg_isready', '--quiet')
                break
            } catch {
                if ((Get-Date) -ge $deadline) { throw 'PostgreSQL no estuvo listo para respaldar. Revisa el log antes de reintentar.' }
                Start-Sleep -Seconds 2
            }
        }
        $pending.Stage = 'building'
        Save-AntojitUpdateRecord -Path $pendingPath -Record $pending
        Write-AntojitLog 'Construyendo desde la copia congelada del ZIP. La construccion puede necesitar Internet.'
        Invoke-AntojitCandidateBuild -Installation $installation -SourceRoot $snapshot
        if ((Get-AntojitUpdateManifest -Root $snapshot).Hash -cne $manifest.Hash) { throw 'El codigo congelado cambio durante la construccion.' }
        $preparedRuntime = Prepare-AntojitNativePrintAgent -Installation $installation -SourceRoot $snapshot
        $pending.Stage = 'backing-up'
        Save-AntojitUpdateRecord -Path $pendingPath -Record $pending
        Stop-AntojitNativePrintAgent -Installation $installation
        $servicesStopped = $true
        Invoke-AntojitCompose -Installation $installation -Arguments @('stop', '--timeout', '30', 'web', 'print-agent', 'api')
        $databaseBackup = New-AntojitDatabaseUpdateBackup -Installation $installation -BackupDirectory $backupDirectory
        $pending.VerifiedBackups = @($pending.VerifiedBackups) + @($databaseBackup)
        $pending.Stage = 'copying'
        Save-AntojitUpdateRecord -Path $pendingPath -Record $pending
        $codeApplied = $true
        Sync-AntojitUpdateSource -SourcePath $snapshot -DestinationPath $installation.Root
        $pending.Stage = 'deploying'
        $pending.MayHaveMigrated = $true
        Save-AntojitUpdateRecord -Path $pendingPath -Record $pending
        $mayHaveMigrated = $true
        $services = @('postgres', 'api', 'web')
        if ($printing.Mode -eq 'native') {
            Invoke-AntojitCompose -Installation $installation -Arguments @('rm', '--stop', '--force', 'print-agent')
        } else { $services += 'print-agent' }
        Invoke-AntojitCompose -Installation $installation -Arguments (@('up', '--detach', '--no-build', '--pull', 'never') + $services)
        Update-AntojitNetwork -Installation $installation
        Invoke-AntojitPilot -Root $installation.Root -Command 'verify'
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($installation.HttpPort)/api/health/ready" -TimeoutSec 15
        if ($health.status -ne 'ready' -or $health.database -ne 'connected') { throw 'La direccion publica de la aplicacion no esta lista.' }
        Start-AntojitNativePrintAgent -Installation $installation -RuntimeDirectory $preparedRuntime
        Update-AntojitLauncherBundle -Installation $installation
        $installation | Add-Member -MemberType NoteProperty -Name SourceMode -Value 'folder' -Force
        $installation | Add-Member -MemberType NoteProperty -Name SourceHash -Value $manifest.Hash -Force
        Save-AntojitInstallation -Installation $installation
        $pending.Stage = 'completed'
        $pending.CompletedAt = [DateTime]::UtcNow.ToString('o')
        Save-AntojitUpdateRecord -Path (Join-Path $backupDirectory 'update.json') -Record $pending
        Remove-Item -LiteralPath $pendingPath -Force
        Write-AntojitLog "Actualizacion desde ZIP completada. Respaldo verificado: $backupDirectory"
        if ($ResumePending) {
            Write-AntojitLog 'Se completo la version pendiente. Vuelve a ejecutar ACTUALIZAR-APP.cmd desde el ZIP nuevo para instalar sus cambios.'
        }
    } catch {
        $updateError = $_
        if ($configurationChanged -and -not $mayHaveMigrated) {
            try {
                Copy-Item -LiteralPath (Join-Path $backupDirectory '.env.pilot') -Destination (Join-Path $installation.Root '.env.pilot') -Force
                if ($hadPrintEnvironment) {
                    Copy-Item -LiteralPath (Join-Path $backupDirectory '.env.print-agent') -Destination (Join-Path $installation.Root '.env.print-agent') -Force
                } else {
                    Remove-Item -LiteralPath (Join-Path $installation.Root '.env.print-agent') -Force -ErrorAction SilentlyContinue
                }
            } catch { Write-Warning "No se pudo reponer toda la configuracion anterior. Conserva $backupDirectory y revisa el log antes de abrir caja." }
        }
        if ($codeApplied -and -not $mayHaveMigrated) {
            try { Sync-AntojitUpdateSource -SourcePath (Join-Path $backupDirectory 'source') -DestinationPath $installation.Root }
            catch { Write-Warning "No se pudo reponer el codigo anterior. Conserva $backupDirectory y no abras caja." }
        }
        if ($servicesStopped -and -not $mayHaveMigrated) {
            try {
                $previousServices = @('api', 'web')
                if ((Get-AntojitPrintConfiguration -Installation $installation).Mode -ne 'native') { $previousServices += 'print-agent' }
                Invoke-AntojitCompose -Installation $installation -Arguments (@('start') + $previousServices)
                if ($oldPrintRuntime) { Start-AntojitNativePrintAgent -Installation $installation -RuntimeDirectory $oldPrintRuntime }
                Write-AntojitLog 'Se reiniciaron los contenedores anteriores. No se iniciaron nuevas migraciones.'
            } catch { Write-Warning 'No se pudo confirmar el reinicio de todos los servicios anteriores. Revisa el log antes de abrir caja.' }
        } elseif ($mayHaveMigrated -and $maintenanceStarted) {
            try { Stop-AntojitNativePrintAgent -Installation $installation } catch { Write-Warning 'No se pudo confirmar la detencion del agente USB.' }
            try { Invoke-AntojitCompose -Installation $installation -Arguments @('stop', '--timeout', '30', 'web', 'print-agent', 'api') }
            catch { Write-Warning 'No se pudo confirmar la detencion de todos los servicios de escritura.' }
            Write-Warning 'La API pudo aplicar migraciones. Se conserva el estado pendiente; reintenta este mismo ZIP. No se restauran datos automaticamente.'
        }
        if ($backupDirectory) { Write-Warning "Material de recuperacion conservado en: $backupDirectory" }
        throw $updateError
    } finally {
        if ($null -ne $recoverySource) {
            try { if (Test-Path -LiteralPath $recoverySource.Directory) { Remove-Item -LiteralPath $recoverySource.Directory -Recurse -Force } }
            catch { Write-Warning "No se pudo retirar la carpeta temporal de recuperacion: $($recoverySource.Directory)" }
        }
        if ($null -ne $operation) { $operation.Dispose() }
    }
}

Export-ModuleMember -Function Get-AntojitUpdateManifest, New-AntojitUpdateSnapshot, Sync-AntojitUpdateSource,
    Invoke-AntojitFolderUpdate, Invoke-AntojitCandidateBuild, New-AntojitDatabaseUpdateBackup, Update-AntojitLauncherBundle
