#requires -Version 5.1
<#
.SYNOPSIS
Actualiza AntojitOS desde una carpeta ZIP nueva o desde GitHub.
.DESCRIPTION
Ejecutar como administrador, con la misma cuenta propietaria de la instalacion.
Cerrar las cajas y salir de todas las terminales antes de usar -ConfirmMaintenance.
La URL se pide en el primer uso; no se toma del remoto origin. Una instalacion
desde ZIP conserva su rama local inicial al adoptar la rama de GitHub.

Descarga y construye antes de detener el servicio. Conserva .env.pilot y crea un
respaldo PostgreSQL con prueba de restauracion antes de iniciar la nueva API.
No ejecuta seed, elimina volumenes, cambia secretos ni restaura datos por su cuenta.
Un intento fallido deja update-pending.json para permitir reintentar el mismo commit.
.PARAMETER InstallPath
Carpeta de la instalacion. Si se omite, usa la ubicacion registrada por el instalador.
.PARAMETER SourcePath
Carpeta nueva con el ZIP completo extraido. Actualiza la instalacion registrada sin Git.
.PARAMETER PrinterQueue
Nombre exacto de la cola de Windows para activar impresion USB; si se omite conserva la configuracion.
.PARAMETER ResumePending
Recupera la version pendiente desde su copia congelada y verificada. SourcePath
aporta solamente los auxiliares Windows actuales, sin sustituir la aplicacion pendiente.
.PARAMETER RepositoryUrl
URL HTTPS de github.com/propietario/repositorio o SSH git@github.com:propietario/repositorio.git.
No admite credenciales, tokens, parametros ni fragmentos en la URL.
.PARAMETER Branch
Rama de GitHub. En una instalacion Git debe coincidir con la rama local activa.
Para una instalacion ZIP se usa la rama predeterminada de GitHub si se omite.
.PARAMETER ConfirmMaintenance
Confirma que las cajas estan cerradas y que nadie utilizara la aplicacion durante
la actualizacion. Solo es necesario cuando existe una actualizacion pendiente.
.EXAMPLE
.\03-actualizar.ps1 -RepositoryUrl https://github.com/mi-negocio/AntojitOS.git -ConfirmMaintenance
.EXAMPLE
.\03-actualizar.ps1 -ConfirmMaintenance
#>
[CmdletBinding()]
param(
    [string]$InstallPath,
    [string]$SourcePath,
    [string]$PrinterQueue,
    [string]$RepositoryUrl,
    [string]$Branch,
    [switch]$ConfirmMaintenance,
    [switch]$ResumePending,
    [switch]$Managed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-UpdateRepositoryUrl {
    param([string]$Value)
    $owner = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})'
    $repo = '[A-Za-z0-9_.-]+'
    if ($Value -cmatch ('^https://github\.com/(' + $owner + ')/(' + $repo + ')/?$')) {
        $name = $Matches[2] -replace '\.git$', ''
        return ($name -ne '.' -and $name -ne '..' -and $name.Length -gt 0)
    }
    if ($Value -cmatch ('^git@github\.com:(' + $owner + ')/(' + $repo + ')\.git$')) {
        $name = $Matches[2]
        return ($name -ne '.' -and $name -ne '..' -and $name.Length -gt 0)
    }
    return $false
}

function Invoke-UpdateGit {
    param([string[]]$GitArguments, [switch]$Capture)
    $arguments = @('-c', "core.hooksPath=$script:UpdateHooksDirectory", '-c', 'protocol.file.allow=never') + $GitArguments
    Invoke-AntojitCommand -FilePath $script:UpdateGit -Arguments $arguments -WorkingDirectory $script:UpdateRoot -Capture:$Capture
}

function Set-UpdateBackupAccess {
    param([string]$Path, [string]$OwnerSid)
    $item = Get-Item -LiteralPath $Path
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "La carpeta de respaldos no puede ser un enlace: $Path"
    }
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $owner = New-Object System.Security.Principal.SecurityIdentifier($OwnerSid)
    $security.SetOwner($owner)
    $security.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($OwnerSid, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique) {
        $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $security.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $security
}

function Save-UpdatePending {
    param($Record, [string]$Path)
    $temporary = "$Path.tmp"
    $json = $Record | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($temporary, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

$operationLock = $null
$installation = $null
$servicesStopped = $false
$printConfiguration = $null
$nativePrintRuntime = $null
$previousNativeActive = $false
$printConfigurationChanged = $false
$hadNativeEnvironment = $false
$deploymentStarted = $false
$mayHaveMigrated = $false
$backupPath = $null
$backupDirectory = $null
$pendingPath = $null
$script:UpdateHooksDirectory = $null
$exitCode = 0

try {
    Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Windows.psm1') -Force -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Printing.psm1') -Force -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Update.psm1') -Force -DisableNameChecking
    if (-not [string]::IsNullOrWhiteSpace($SourcePath)) {
        Invoke-AntojitFolderUpdate -SourcePath $SourcePath -InstallPath $InstallPath -ConfirmMaintenance:$ConfirmMaintenance -PrinterQueue $PrinterQueue -ResumePending:$ResumePending
        if ($Managed) { return }
        exit 0
    }
    if ($ResumePending) { throw 'La recuperacion requiere el proyecto ZIP de preparacion. Abre RECUPERAR-ACTUALIZACION.cmd desde esa carpeta.' }
    Assert-AntojitWindows
    Assert-AntojitAdministrator
    $resolvedInstallPath = Resolve-AntojitInstallPath -InstallPath $InstallPath
    $installation = Get-AntojitInstallation -InstallPath $resolvedInstallPath
    Assert-AntojitOwner -Installation $installation
    if ($installation.PSObject.Properties['SourceMode'] -and $installation.SourceMode -eq 'folder') {
        throw 'Esta instalacion se actualiza desde carpeta ZIP. Descarga y extrae la version nueva, y abre ACTUALIZAR-APP.cmd dentro de esa carpeta; no uses Git sobre la instalacion.'
    }
    $script:UpdateRoot = $installation.Root
    $operationLock = Enter-AntojitOperation -Root $installation.Root
    Start-AntojitLog -Path (Join-Path $installation.StateDirectory ('logs\update-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log'))
    $script:UpdateGit = Get-AntojitGit
    if ([string]::IsNullOrWhiteSpace($script:UpdateGit)) { throw 'No se encontro Git. Ejecuta primero 01-instalar.ps1.' }
    $script:UpdateHooksDirectory = Join-Path $installation.StateDirectory ('git-hooks-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:UpdateHooksDirectory -Force | Out-Null
    $pendingPath = Join-Path $installation.StateDirectory 'update-pending.json'

    $topLevel = (@(Invoke-UpdateGit -GitArguments @('rev-parse', '--show-toplevel') -Capture) -join "`n").Trim()
    if ([System.IO.Path]::GetFullPath($topLevel).TrimEnd('\', '/') -ine [System.IO.Path]::GetFullPath($installation.Root).TrimEnd('\', '/')) {
        throw 'InstallPath debe ser la raiz de la instalacion Git de AntojitOS.'
    }
    $dirty = @(Invoke-UpdateGit -GitArguments @('status', '--porcelain=v1', '--untracked-files=all') -Capture)
    if (($dirty -join '').Trim().Length -gt 0) {
        throw 'Hay cambios locales o archivos sin seguimiento. Conserva o confirma esos cambios antes de actualizar; el script no los borrara.'
    }
    $currentBranch = (@(Invoke-UpdateGit -GitArguments @('branch', '--show-current') -Capture) -join '').Trim()
    if ([string]::IsNullOrWhiteSpace($currentBranch)) {
        throw 'Git esta en detached HEAD. Activa la rama de la instalacion antes de actualizar.'
    }
    $originalCommit = (@(Invoke-UpdateGit -GitArguments @('rev-parse', '--verify', 'HEAD') -Capture) -join '').Trim()
    $sourceMode = 'git'
    if ($installation.PSObject.Properties['SourceMode'] -and $installation.SourceMode -eq 'snapshot') { $sourceMode = 'snapshot' }

    if ([string]::IsNullOrWhiteSpace($RepositoryUrl)) { $RepositoryUrl = $installation.RepositoryUrl }
    if (-not (Test-UpdateRepositoryUrl -Value $RepositoryUrl)) {
        throw 'Indica -RepositoryUrl con una URL HTTPS o SSH de GitHub sin credenciales. La URL se guarda despues de una actualizacion correcta.'
    }
    if ([string]::IsNullOrWhiteSpace($Branch)) { $Branch = $installation.Branch }
    if ([string]::IsNullOrWhiteSpace($Branch)) {
        if ($sourceMode -eq 'snapshot') {
            $remoteHead = @(Invoke-UpdateGit -GitArguments @('ls-remote', '--symref', '--', $RepositoryUrl, 'HEAD') -Capture)
            foreach ($line in $remoteHead) {
                if ($line -match '^ref:\s+refs/heads/(.+)\s+HEAD$') { $Branch = $Matches[1]; break }
            }
            if ([string]::IsNullOrWhiteSpace($Branch)) { throw 'GitHub no anuncio una rama predeterminada. Indica -Branch.' }
        } else { $Branch = $currentBranch }
    }
    if ($Branch.StartsWith('-') -or $Branch -eq 'HEAD') { throw 'El nombre de rama no es valido.' }
    Invoke-UpdateGit -GitArguments @('check-ref-format', '--branch', $Branch) -Capture | Out-Null

    $pending = $null
    if (Test-Path -LiteralPath $pendingPath) {
        $pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        if ($pending.RepositoryUrl -cne $RepositoryUrl -or $pending.TargetBranch -cne $Branch) {
            throw "Hay una actualizacion pendiente para otro repositorio o rama. Revisa $pendingPath antes de cambiar el origen."
        }
        if ($originalCommit -ne $pending.OriginalCommit -and $originalCommit -ne $pending.PreviousCommit -and $originalCommit -ne $pending.TargetCommit) {
            throw "Git cambio desde la actualizacion pendiente. Revisa $pendingPath antes de continuar."
        }
        $mayHaveMigrated = ($pending.MayHaveMigrated -eq $true)
        Write-AntojitLog -Message "Se reintentara una actualizacion pendiente (etapa: $($pending.Stage)). Los respaldos anteriores se conservaran."
    }
    $adoptSnapshot = ($sourceMode -eq 'snapshot' -and $null -eq $pending)
    if ($sourceMode -eq 'snapshot' -and $null -ne $pending -and $currentBranch -eq $pending.OriginalBranch -and $originalCommit -eq $pending.OriginalCommit) {
        $adoptSnapshot = $true
    }
    if (-not $adoptSnapshot -and $currentBranch -cne $Branch) {
        throw "La rama activa es '$currentBranch'. Para esta instalacion debes actualizar esa misma rama."
    }
    if ($adoptSnapshot) {
        $localBranches = @(Invoke-UpdateGit -GitArguments @('for-each-ref', '--format=%(refname:short)', 'refs/heads/') -Capture)
        if ($localBranches -ccontains $Branch) { throw "La rama '$Branch' ya existe. Se conserva la rama local inicial; revisa Git antes de adoptar GitHub." }
    }

    Write-AntojitLog -Message "Descargando la rama '$Branch' de GitHub."
    $candidateRef = 'refs/antojitos-update/candidate'
    Invoke-UpdateGit -GitArguments @('fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--', $RepositoryUrl, "+refs/heads/${Branch}:$candidateRef")
    $candidate = (@(Invoke-UpdateGit -GitArguments @('rev-parse', '--verify', "$candidateRef^{commit}") -Capture) -join '').Trim()
    if ($mayHaveMigrated -and $candidate -ne $pending.TargetCommit) {
        throw "GitHub cambio desde un despliegue que pudo aplicar migraciones. Conserva el commit pendiente $($pending.TargetCommit) y sus respaldos; resuelve esa actualizacion antes de adoptar otra version."
    }
    $treePaths = ((@(Invoke-UpdateGit -GitArguments @('ls-tree', '-r', '-z', '--name-only', $candidate) -Capture) -join "`n").Split([char]0))
    $protectedPaths = @($treePaths | Where-Object { $_ -match '^(?:\.env|\.env\.pilot|\.env\.print-agent|var|backups)(?:/|$)' })
    if (($protectedPaths -join '').Trim().Length -gt 0) {
        throw 'La rama de GitHub versiona rutas locales protegidas (.env, .env.pilot, var o backups). Se cancela para conservar configuracion y datos.'
    }
    if (-not $adoptSnapshot) {
        $localOnly = [long]((@(Invoke-UpdateGit -GitArguments @('rev-list', '--count', "$candidate..$originalCommit") -Capture) -join '').Trim())
        if ($localOnly -gt 0) { throw 'La rama local diverge de GitHub o contiene commits que GitHub no conserva. Se requiere un avance fast-forward; no se forzara Git.' }
        if ($originalCommit -eq $candidate -and $null -eq $pending) {
            $installation.RepositoryUrl = $RepositoryUrl
            $installation.Branch = $Branch
            Save-AntojitInstallation -Installation $installation
            Write-AntojitLog -Message 'La aplicacion ya tiene el ultimo commit. No fue necesario detener servicios.'
            if ($Managed) { return }
            exit 0
        }
    }
    if (-not $ConfirmMaintenance) {
        throw 'Hay una actualizacion disponible. Cierra las cajas, sal de todas las terminales y repite con -ConfirmMaintenance durante una ventana de mantenimiento.'
    }

    Initialize-AntojitRuntime -Installation $installation
    if ($mayHaveMigrated) {
        Write-AntojitLog -Message 'Preparando solo PostgreSQL para respaldar el estado del intento anterior.'
        Invoke-AntojitCompose -Installation $installation -Arguments @('up', '--detach', '--no-build', '--pull', 'never', 'postgres')
        $databaseReady = $false
        $databaseDeadline = (Get-Date).AddSeconds(120)
        do {
            try {
                Invoke-AntojitCompose -Installation $installation -Arguments @('exec', '-T', 'postgres', 'pg_isready', '--quiet')
                $databaseReady = $true
            } catch {
                if ((Get-Date) -ge $databaseDeadline) { throw 'PostgreSQL no estuvo listo a tiempo. Revisa el error antes de reintentar la actualizacion pendiente.' }
                Start-Sleep -Seconds 2
            }
        } while (-not $databaseReady)
    } else {
        Invoke-AntojitPilot -Root $installation.Root -Command 'verify'
    }
    $allBackups = Join-Path $installation.Root 'backups'
    New-Item -ItemType Directory -Path $allBackups -Force | Out-Null
    Set-UpdateBackupAccess -Path $allBackups -OwnerSid $installation.OwnerSid
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $backupDirectory = Join-Path $allBackups "windows-update-$stamp"
    New-Item -ItemType Directory -Path $backupDirectory | Out-Null
    Set-UpdateBackupAccess -Path $backupDirectory -OwnerSid $installation.OwnerSid
    $environmentFile = Join-Path $installation.Root '.env.pilot'
    if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { throw 'Falta .env.pilot; revisa la instalacion antes de actualizar.' }
    Copy-Item -LiteralPath $environmentFile -Destination (Join-Path $backupDirectory '.env.pilot')
    $nativeEnvironmentFile = Join-Path $installation.Root '.env.print-agent'
    $hadNativeEnvironment = Test-Path -LiteralPath $nativeEnvironmentFile -PathType Leaf
    if ($hadNativeEnvironment) {
        Copy-Item -LiteralPath $nativeEnvironmentFile -Destination (Join-Path $backupDirectory '.env.print-agent')
    }
    $originalPrintConfiguration = Get-AntojitPrintConfiguration -Installation $installation
    $previousNativeActive = $originalPrintConfiguration.Mode -eq 'native' -and (Test-Path -LiteralPath $originalPrintConfiguration.ActivePath -PathType Leaf)
    $printConfigurationChanged = $true
    $printConfiguration = Initialize-AntojitPrintConfiguration -Installation $installation -PrinterQueue $PrinterQueue
    Assert-AntojitNativePrintConfiguration -Installation $installation
    if ($null -eq $pending) {
        $pending = [ordered]@{
            CreatedAt = [DateTime]::UtcNow.ToString('o')
            RepositoryUrl = $RepositoryUrl
            SourceMode = $sourceMode
            OriginalBranch = $currentBranch
            OriginalCommit = $originalCommit
            PreviousCommit = $originalCommit
            TargetBranch = $Branch
            TargetCommit = $candidate
            Stage = 'prepared'
            MayHaveMigrated = $false
            FirstBackupDirectory = $backupDirectory
            LatestBackupDirectory = $backupDirectory
            VerifiedBackups = @()
            CompletedAt = $null
        }
    } else {
        $pending.PreviousCommit = $originalCommit
        $pending.TargetCommit = $candidate
        $pending.LatestBackupDirectory = $backupDirectory
        $pending.Stage = 'prepared'
    }
    Save-UpdatePending -Record $pending -Path $pendingPath
    if ($adoptSnapshot) {
        Invoke-UpdateGit -GitArguments @('checkout', '--no-overwrite-ignore', '-b', $Branch, $candidate)
    } elseif ($originalCommit -ne $candidate) {
        Invoke-UpdateGit -GitArguments @('merge', '--ff-only', '--no-overwrite-ignore', $candidate)
    }
    $pending.Stage = 'building'
    Save-UpdatePending -Record $pending -Path $pendingPath
    if ($mayHaveMigrated) {
        Write-AntojitLog -Message 'Construyendo las imagenes del intento pendiente; los servicios de escritura permanecen detenidos.'
    } else {
        Write-AntojitLog -Message 'Construyendo las nuevas imagenes; la version actual sigue disponible.'
    }
    foreach ($service in @('api', 'web', 'print-agent')) {
        Invoke-AntojitCompose -Installation $installation -Arguments @('build', $service)
    }

    $nativePrintRuntime = Prepare-AntojitNativePrintAgent -Installation $installation -SourceRoot $installation.Root

    $pending.Stage = 'backing-up'
    Save-UpdatePending -Record $pending -Path $pendingPath
    $previousBackups = @(Get-ChildItem -LiteralPath $allBackups -Filter '*.dump' -File | Select-Object -ExpandProperty FullName)
    Stop-AntojitNativePrintAgent -Installation $installation
    $servicesStopped = $true
    Invoke-AntojitCompose -Installation $installation -Arguments @('stop', '--timeout', '30', 'web', 'print-agent', 'api')
    Invoke-AntojitPilot -Root $installation.Root -Command 'backup'
    $newBackups = @(Get-ChildItem -LiteralPath $allBackups -Filter '*.dump' -File | Where-Object { $previousBackups -notcontains $_.FullName })
    if ($newBackups.Count -ne 1) { throw "No fue posible identificar un unico respaldo nuevo. Revisa $allBackups." }
    $createdBackup = $newBackups[0].FullName
    $backupPath = Join-Path $backupDirectory $newBackups[0].Name
    Move-Item -LiteralPath $createdBackup -Destination $backupPath
    if (Test-Path -LiteralPath "$createdBackup.json") {
        Move-Item -LiteralPath "$createdBackup.json" -Destination "$backupPath.json"
    }
    Invoke-AntojitPilot -Root $installation.Root -Command 'verify-backup' -Arguments @($backupPath)
    $pending.VerifiedBackups = @($pending.VerifiedBackups) + @($backupPath)
    $pending.Stage = 'deploying'
    $pending.MayHaveMigrated = $true
    Save-UpdatePending -Record $pending -Path $pendingPath

    Write-AntojitLog -Message 'Respaldo verificado. Iniciando la nueva version y sus migraciones.'
    $deploymentStarted = $true
    $mayHaveMigrated = $true
    $services = @('postgres', 'api', 'web')
    if ($printConfiguration.Mode -ne 'native') { $services += 'print-agent' }
    Invoke-AntojitCompose -Installation $installation -Arguments (@('up', '--detach', '--no-build', '--pull', 'never') + $services)
    Update-AntojitNetwork -Installation $installation
    Invoke-AntojitPilot -Root $installation.Root -Command 'verify'
    if ($printConfiguration.Mode -eq 'native') {
        Start-AntojitNativePrintAgent -Installation $installation -RuntimeDirectory $nativePrintRuntime
    }
    $installation.RepositoryUrl = $RepositoryUrl
    $installation.Branch = $Branch
    if ($installation.PSObject.Properties['SourceMode']) { $installation.SourceMode = 'git' }
    Save-AntojitInstallation -Installation $installation
    $pending.Stage = 'completed'
    $pending.CompletedAt = [DateTime]::UtcNow.ToString('o')
    $pending | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backupDirectory 'update.json') -Encoding UTF8
    Remove-Item -LiteralPath $pendingPath
    Write-AntojitLog -Message "Actualizacion completada. Commit: $candidate"
    Write-AntojitLog -Message "Respaldo de datos y configuracion: $backupDirectory"
}
catch {
    $exitCode = 1
    $updateError = $_
    if (Get-Command Write-AntojitError -ErrorAction SilentlyContinue) {
        Write-AntojitError -ErrorRecord $updateError
    } else {
        Write-Error -ErrorRecord $updateError -ErrorAction Continue
    }
    if ($printConfigurationChanged -and -not $mayHaveMigrated) {
        try {
            Copy-Item -LiteralPath (Join-Path $backupDirectory '.env.pilot') -Destination (Join-Path $installation.Root '.env.pilot') -Force
            if ($hadNativeEnvironment) {
                Copy-Item -LiteralPath (Join-Path $backupDirectory '.env.print-agent') -Destination (Join-Path $installation.Root '.env.print-agent') -Force
            } else {
                Remove-Item -LiteralPath (Join-Path $installation.Root '.env.print-agent') -Force -ErrorAction SilentlyContinue
            }
            $printConfiguration = Get-AntojitPrintConfiguration -Installation $installation
        } catch { Write-Warning "No se pudo reponer toda la configuracion anterior. Conserva $backupDirectory y revisa el log antes de abrir caja." }
    }
    if ($servicesStopped -and -not $mayHaveMigrated) {
        try {
            $previousServices = @('api', 'web')
            if ($null -eq $printConfiguration -or $printConfiguration.Mode -ne 'native') { $previousServices += 'print-agent' }
            Invoke-AntojitCompose -Installation $installation -Arguments (@('start') + $previousServices)
            if ($previousNativeActive) { Start-AntojitNativePrintAgent -Installation $installation }
            Write-AntojitLog -Message 'Se reiniciaron los contenedores anteriores. No se iniciaron las nuevas migraciones.'
        } catch {
            Write-Warning 'No se pudieron reiniciar todos los contenedores anteriores. Revisa el estado del motor antes de abrir las terminales.'
        }
    } elseif ($mayHaveMigrated -and ($servicesStopped -or $deploymentStarted)) {
        try { Stop-AntojitNativePrintAgent -Installation $installation }
        catch { Write-Warning 'No se pudo confirmar que el agente USB quedara detenido.' }
        try { Invoke-AntojitCompose -Installation $installation -Arguments @('stop', '--timeout', '30', 'web', 'print-agent', 'api') }
        catch { Write-Warning 'No se pudo confirmar que todos los servicios de escritura quedaran detenidos.' }
    }
    if ($mayHaveMigrated) {
        Write-Warning 'La nueva API pudo haber aplicado migraciones. Revisa el error antes de reintentar; la recuperacion de codigo y datos debe planearse con el respaldo, sin restauracion automatica.'
    }
    if ($null -ne $backupDirectory) { Write-Warning "Configuracion y respaldos conservados en: $backupDirectory" }
    if ($null -ne $pendingPath -and (Test-Path -LiteralPath $pendingPath)) {
        Write-Warning "Estado pendiente: $pendingPath. El siguiente intento con -ConfirmMaintenance reintentara el despliegue aunque Git ya tenga ese commit."
    }
    if ($Managed) { throw $updateError }
}
finally {
    if ($null -ne $script:UpdateHooksDirectory -and (Test-Path -LiteralPath $script:UpdateHooksDirectory)) {
        try { Remove-Item -LiteralPath $script:UpdateHooksDirectory -Force -Recurse } catch { }
    }
    if ($null -ne $operationLock) { $operationLock.Dispose() }
}
if (-not $Managed) { exit $exitCode }
