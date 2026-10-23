Set-StrictMode -Version 2.0
$script:AntojitPrivateKeyLogBlock = $false

function ConvertTo-AntojitLogText {
    param([AllowEmptyString()][string]$Text)
    if ($null -eq $Text) { return '' }
    $safe = [regex]::Replace($Text, '(?is)-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----', '[PRIVATE KEY REDACTED]')
    $safe = [regex]::Replace($safe, '(?i)(\b(?:https?|postgres(?:ql)?|ssh)://)[^\s/]+@', '$1[REDACTED]@')
    $safe = [regex]::Replace($safe, '(?i)(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)\S+', '$1[REDACTED]')
    $secretName = '(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|TOKEN|PEPPER|SECRET|API_KEY|PRIVATE_KEY)[A-Z0-9_]*|(?:[A-Z0-9_]+_)?PIN)'
    $safe = [regex]::Replace($safe, ('(?im)(\b' + $secretName + '\s*[=:]\s*)(?:"[^"\r\n]*"|''[^''\r\n]*''|[^\s\r\n,;]+)'), '$1[REDACTED]')
    $secretKey = '(?:[^"\r\n]*(?:password|passwd|token|pepper|secret|api[_-]?key|private[_-]?key)[^"\r\n]*|(?:[a-z0-9_-]+[_-])?pin|(?:admin|waiter|mesero)Pin)'
    $safe = [regex]::Replace($safe, ('(?i)("' + $secretKey + '"\s*:\s*)(?:"(?:\\.|[^"\\])*"|[^\s,}\]\r\n]+)'), '$1"[REDACTED]"')
    $safe = [regex]::Replace($safe, '(?i)((?:--?|/)(?:password|passwd|token|secret|pin|api-key|apikey)(?:=|:|\s+))(?:"[^"\r\n]*"|''[^''\r\n]*''|[^\s]+)', '$1[REDACTED]')
    # Accept OEM/UTF-8 mojibake around the accented "o" from older consoles.
    $safe = [regex]::Replace($safe, '(?im)(\b(?:C[^\s:]{0,16}digo\s+(?:ADMIN|MESERO)|(?:ADMIN|MESERO)\s+PIN|PIN\s+(?:ADMIN|MESERO)|Token\s+para\s+registrar\s+terminales)\s*:\s*)[^\r\n]+', '$1[REDACTED]')
    return $safe
}

function Write-AntojitDiagnostic {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Message)
    # Suppress a private key even when a native command streams it line by line.
    $safeLines = New-Object 'System.Collections.Generic.List[string]'
    foreach ($rawLine in ($Message -split '\r\n|\n|\r')) {
        if ($script:AntojitPrivateKeyLogBlock) {
            $safeLines.Add('[PRIVATE KEY REDACTED]')
            if ($rawLine -match '-----END [^-]*PRIVATE KEY-----') { $script:AntojitPrivateKeyLogBlock = $false }
            continue
        }
        if ($rawLine -match '-----BEGIN [^-]*PRIVATE KEY-----') {
            if ($rawLine -notmatch '-----END [^-]*PRIVATE KEY-----') { $script:AntojitPrivateKeyLogBlock = $true }
            $safeLines.Add('[PRIVATE KEY REDACTED]')
            continue
        }
        $safeLines.Add((ConvertTo-AntojitLogText -Text $rawLine))
    }
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $lines = @($safeLines | ForEach-Object { '{0} {1}' -f $timestamp, $_ })
    foreach ($line in $lines) { Write-Host $line }
    $targets = @($env:ANTOJITOS_LOG_PATH, $env:ANTOJITOS_SESSION_LOG_PATH) | Where-Object { $_ } | Select-Object -Unique
    foreach ($path in $targets) {
        try {
            $directory = Split-Path -Parent $path
            if ($directory -and -not (Test-Path -LiteralPath $directory)) {
                New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
            }
            Add-Content -LiteralPath $path -Value $lines -Encoding UTF8 -ErrorAction Stop
        } catch {
            $safeError = ConvertTo-AntojitLogText -Text $_.Exception.Message
            Write-Warning "No se pudo escribir el registro $path. $safeError"
        }
    }
}

function Write-AntojitNativeOutput {
    param([string]$Text, [string]$Stream)
    if (-not $Text) { return }
    foreach ($line in ((ConvertTo-AntojitLogText -Text $Text).TrimEnd([char[]]"`r`n") -split '\r\n|\n|\r')) {
        Write-AntojitDiagnostic -Message "[$Stream] $line"
    }
}

function Get-AntojitInstallerLogPath {
    param([string]$DisplayName, [string]$Suffix)
    $activeLog = $env:ANTOJITOS_LOG_PATH
    if (-not $activeLog) { $activeLog = $env:ANTOJITOS_SESSION_LOG_PATH }
    $directory = if ($activeLog) { Join-Path (Split-Path -Parent $activeLog) 'installers' } else { Join-Path ([IO.Path]::GetTempPath()) 'AntojitOS-installer-logs' }
    New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
    $name = [regex]::Replace($DisplayName, '[^a-zA-Z0-9._-]+', '-')
    return Join-Path $directory ('{0}-{1}-{2}.{3}' -f $name, (Get-Date -Format 'yyyyMMdd-HHmmss'), [Guid]::NewGuid().ToString('N').Substring(0, 8), $Suffix)
}

function Assert-AntojitWindows {
    if ($env:OS -ne 'Windows_NT') {
        throw 'Este instalador requiere Windows 11 x64.'
    }
    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
    if ($architecture -ne 'AMD64' -or -not [Environment]::Is64BitProcess) {
        throw 'Se requiere Windows x64 y PowerShell de 64 bits. No se admite ARM64.'
    }
    $windows = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    if ([int]$windows.CurrentBuildNumber -lt 22000) {
        throw 'Se requiere Windows 11 (compilacion 22000 o posterior). Actualiza Windows antes de continuar.'
    }
    $operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    if ($operatingSystem.ProductType -ne 1) {
        throw 'Este instalador admite Windows 11 de escritorio; Windows Server requiere otro despliegue.'
    }
}

function Assert-AntojitAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Abre PowerShell como administrador y vuelve a ejecutar el instalador con la misma cuenta de Windows.'
    }
}

function Update-AntojitPath {
    $entries = New-Object 'System.Collections.Generic.List[string]'
    foreach ($pathValue in @(
        [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::Machine),
        [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User),
        $env:Path
    )) {
        if (-not $pathValue) { continue }
        foreach ($entry in $pathValue.Split(';')) {
            $expanded = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))
            if ($expanded -and -not $entries.Contains($expanded)) { $entries.Add($expanded) }
        }
    }
    $env:Path = $entries -join ';'
}

function ConvertTo-AntojitNativeArgument {
    param([AllowEmptyString()][string]$Argument)
    if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"]') { return $Argument }
    $escaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '\\+$', '$0$0')
    return '"' + $escaped + '"'
}

function Invoke-AntojitNative {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [int[]]$AllowedExitCodes = @(0),
        [switch]$AllowNonZeroExit,
        [int]$TimeoutSeconds = 1800
    )
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-AntojitNativeArgument $_ }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    $command = ConvertTo-AntojitLogText -Text ('"{0}" {1}' -f $FilePath, $startInfo.Arguments)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $exitCode = $null
    $exitLogged = $false
    Write-AntojitDiagnostic -Message "[CMD] $command"
    Write-AntojitDiagnostic -Message "[CWD] $([Environment]::CurrentDirectory)"
    try {
        if (-not $process.Start()) { throw "No se pudo iniciar $FilePath." }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try { $process.Kill() } catch { }
            $null = $process.WaitForExit(5000)
            if ($stdoutTask.IsCompleted) { Write-AntojitNativeOutput -Text ($stdoutTask.GetAwaiter().GetResult()) -Stream stdout }
            if ($stderrTask.IsCompleted) { Write-AntojitNativeOutput -Text ($stderrTask.GetAwaiter().GetResult()) -Stream stderr }
            throw "Tiempo de espera agotado ($TimeoutSeconds s) al ejecutar $command."
        }
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
        Write-AntojitNativeOutput -Text $stdout -Stream stdout
        Write-AntojitNativeOutput -Text $stderr -Stream stderr
        Write-AntojitDiagnostic -Message ("[EXIT] {0}; {1:N1} s; {2}" -f $exitCode, $timer.Elapsed.TotalSeconds, $command)
        $exitLogged = $true
        if (-not $AllowNonZeroExit -and $AllowedExitCodes -notcontains $exitCode) {
            $detail = ConvertTo-AntojitLogText -Text (($stderr + [Environment]::NewLine + $stdout).Trim())
            throw "El comando $command termino con codigo $exitCode. $detail"
        }
        return [pscustomobject]@{ ExitCode = $exitCode; StdOut = $stdout; StdErr = $stderr }
    }
    catch {
        Write-AntojitDiagnostic -Message ('[ERROR] ' + $_.Exception.Message)
        throw
    }
    finally {
        $timer.Stop()
        if (-not $exitLogged) {
            $status = if ($null -eq $exitCode) { 'sin codigo de salida' } else { [string]$exitCode }
            Write-AntojitDiagnostic -Message ("[EXIT] {0}; {1:N1} s; {2}" -f $status, $timer.Elapsed.TotalSeconds, $command)
        }
        $process.Dispose()
    }
}

function Get-AntojitExecutableCandidates {
    param([string]$Name, [string[]]$FallbackPaths = @())
    $seen = @{}
    $commands = @(Get-Command -Name $Name -CommandType Application -All -ErrorAction SilentlyContinue)
    foreach ($candidate in @($commands | ForEach-Object { $_.Source }) + $FallbackPaths) {
        if (-not $candidate -or $seen.ContainsKey($candidate)) { continue }
        $seen[$candidate] = $true
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            [IO.Path]::GetFullPath($candidate)
        }
    }
}

function Get-AntojitNode {
    $fallbacks = @()
    if ($env:ProgramFiles) { $fallbacks += Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    foreach ($candidate in @(Get-AntojitExecutableCandidates -Name 'node.exe' -FallbackPaths $fallbacks)) {
        try {
            $result = Invoke-AntojitNative -FilePath $candidate -Arguments @('--version') -TimeoutSeconds 30
            if ($result.StdOut.Trim() -match '^v(?<major>\d+)\.\d+\.\d+(?:[-+].*)?$' -and [int]$Matches.major -ge 24) {
                return $candidate
            }
        }
        catch { continue }
    }
    return $null
}

function Get-AntojitGit {
    $fallbacks = @()
    if ($env:ProgramFiles) { $fallbacks += Join-Path $env:ProgramFiles 'Git\cmd\git.exe' }
    if ($env:LOCALAPPDATA) { $fallbacks += Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe' }
    foreach ($candidate in @(Get-AntojitExecutableCandidates -Name 'git.exe' -FallbackPaths $fallbacks)) {
        try {
            $result = Invoke-AntojitNative -FilePath $candidate -Arguments @('--version') -TimeoutSeconds 30
            if ($result.StdOut.Trim() -match '^git version \d+\.') { return $candidate }
        }
        catch { continue }
    }
    return $null
}

function Get-AntojitPodman {
    $fallbacks = @()
    if ($env:ProgramFiles) {
        $fallbacks += Join-Path $env:ProgramFiles 'RedHat\Podman\podman.exe'
        $fallbacks += Join-Path $env:ProgramFiles 'Podman\podman.exe'
    }
    if ($env:LOCALAPPDATA) { $fallbacks += Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe' }
    foreach ($candidate in @(Get-AntojitExecutableCandidates -Name 'podman.exe' -FallbackPaths $fallbacks)) {
        try {
            $result = Invoke-AntojitNative -FilePath $candidate -Arguments @('--version') -TimeoutSeconds 30
            if ($result.StdOut.Trim() -match '^podman version \d+\.') { return $candidate }
        }
        catch { continue }
    }
    return $null
}

function Stop-AntojitForRestart {
    [CmdletBinding()]
    param([string]$Reason)
    Write-AntojitDiagnostic -Message "[RESTART] $Reason Reinicia Windows y vuelve a ejecutar final_script."
    $exception = New-Object InvalidOperationException("$Reason Reinicia Windows y vuelve a ejecutar el instalador.")
    $exception.Data['RestartRequired'] = $true
    $record = New-Object Management.Automation.ErrorRecord(
        $exception,
        'AntojitOS.RestartRequired',
        [Management.Automation.ErrorCategory]::ResourceUnavailable,
        $null
    )
    $PSCmdlet.ThrowTerminatingError($record)
}

function Invoke-AntojitInstaller {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$DisplayName,
        [ValidateSet('Msi', 'Inno', 'Wix')][string]$LogStyle = 'Msi'
    )
    $installerLogPath = Get-AntojitInstallerLogPath -DisplayName $DisplayName -Suffix 'log'
    $stdoutPath = $installerLogPath + '.stdout.log'
    $stderrPath = $installerLogPath + '.stderr.log'
    switch ($LogStyle) {
        Msi { $Arguments += @('/L*V!', $installerLogPath) }
        Inno { $Arguments += @('/LOG=' + $installerLogPath) }
        Wix { $Arguments += @('/log', $installerLogPath) }
    }
    $argumentLine = @($Arguments | ForEach-Object { ConvertTo-AntojitNativeArgument $_ }) -join ' '
    $command = ConvertTo-AntojitLogText -Text ('"{0}" {1}' -f $FilePath, $argumentLine)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $process = $null
    $exitCode = $null
    Write-AntojitDiagnostic -Message "[INSTALL] $DisplayName. Registro detallado: $installerLogPath"
    Write-AntojitDiagnostic -Message "[CMD] $command"
    Write-AntojitDiagnostic -Message "[CWD] $((Get-Location).Path)"
    try {
        $process = Start-Process -FilePath $FilePath -ArgumentList $argumentLine -Wait -PassThru `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -ErrorAction Stop
        $exitCode = $process.ExitCode
    }
    catch {
        Write-AntojitDiagnostic -Message ('[ERROR] Instalador: ' + $_.Exception.ToString())
        throw
    }
    finally {
        $timer.Stop()
        if ($null -ne $process) { $process.Dispose() }
        foreach ($path in @($installerLogPath, $stdoutPath, $stderrPath)) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            try {
                $text = [IO.File]::ReadAllText($path)
                $safeText = ConvertTo-AntojitLogText -Text $text
                # Keep installer diagnostics outside the temporary downloads folder.
                # Windows installers can use UTF-16; normalize their persistent logs.
                Set-Content -LiteralPath $path -Value $safeText -Encoding UTF8 -NoNewline -ErrorAction Stop
                if ($path -eq $stdoutPath) { Write-AntojitNativeOutput -Text $safeText -Stream stdout }
                elseif ($path -eq $stderrPath) { Write-AntojitNativeOutput -Text $safeText -Stream stderr }
                Write-AntojitDiagnostic -Message "[LOG] $path"
            }
            catch { Write-AntojitDiagnostic -Message ('[ERROR] Al leer el registro del instalador: ' + $_.Exception.Message) }
        }
        $status = if ($null -eq $exitCode) { 'sin codigo de salida' } else { [string]$exitCode }
        Write-AntojitDiagnostic -Message ("[EXIT] {0}; {1:N1} s; {2}" -f $status, $timer.Elapsed.TotalSeconds, $command)
    }
    if ($exitCode -eq 3010 -or $exitCode -eq 1641) {
        Write-AntojitDiagnostic -Message "[RESTART] $DisplayName se instalo y requiere reiniciar Windows."
        Stop-AntojitForRestart "$DisplayName se instalo y requiere reiniciar."
    }
    if ($exitCode -ne 0) { throw "La instalacion de $DisplayName fallo con codigo $exitCode. Registro: $installerLogPath" }
    Update-AntojitPath
}

function Save-AntojitDownload {
    param([string]$Uri, [string]$Destination)
    if (-not ([uri]$Uri).IsAbsoluteUri -or ([uri]$Uri).Scheme -ne 'https') {
        throw 'La descarga debe usar una URL HTTPS absoluta.'
    }
    Write-AntojitDiagnostic -Message "[DOWNLOAD] $Uri -> $Destination"
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing -UserAgent 'AntojitOS-Windows-Setup' -TimeoutSec 1800 -ErrorAction Stop | Out-Null
        $size = (Get-Item -LiteralPath $Destination -ErrorAction Stop).Length
        Write-AntojitDiagnostic -Message ("[DOWNLOAD] Completada: {0} bytes; {1:N1} s." -f $size, $timer.Elapsed.TotalSeconds)
    }
    catch { Write-AntojitDiagnostic -Message ('[ERROR] Descarga: ' + $_.Exception.ToString()); throw }
    finally { $timer.Stop() }
}

function Get-AntojitLatestRelease {
    param([string]$Repository)
    $allowed = @('git-for-windows/git', 'podman-container-tools/podman', 'docker/compose')
    if ($allowed -notcontains $Repository) { throw 'Repositorio de dependencias no autorizado.' }
    Write-AntojitDiagnostic -Message "[RELEASE] Consultando la ultima version oficial de $Repository."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers @{
        Accept = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
    } -UserAgent 'AntojitOS-Windows-Setup' -TimeoutSec 60 -ErrorAction Stop
    Write-AntojitDiagnostic -Message "[RELEASE] $Repository $($release.tag_name)"
    return $release
}

function Get-AntojitReleaseAsset {
    param($Release, [string]$NamePattern, [string]$Repository)
    $assets = @($Release.assets | Where-Object { $_.name -match $NamePattern })
    if ($assets.Count -ne 1) {
        throw "No se encontro un unico instalador x64 oficial para $Repository. Revisa la publicacion antes de continuar."
    }
    $asset = $assets[0]
    if (-not $asset.browser_download_url.StartsWith("https://github.com/$Repository/releases/download/", [StringComparison]::OrdinalIgnoreCase)) {
        throw "La URL del instalador de $Repository no pertenece a su publicacion oficial."
    }
    Write-AntojitDiagnostic -Message "[ASSET] $Repository / $($asset.name)"
    return $asset
}

function Assert-AntojitSha256 {
    param([string]$Path, [string]$ExpectedHash)
    if ($ExpectedHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'El SHA-256 oficial no tiene un formato valido.' }
    $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash
    if ($actualHash -ne $ExpectedHash) { throw "El SHA-256 no coincide: $([IO.Path]::GetFileName($Path)). No se ejecutara el archivo." }
    Write-AntojitDiagnostic -Message "[VERIFY] SHA-256 valido: $([IO.Path]::GetFileName($Path)) ($actualHash)."
}

function Assert-AntojitReleaseDigest {
    param([string]$Path, $Asset)
    $digestProperty = $Asset.PSObject.Properties['digest']
    if ($null -eq $digestProperty -or -not $digestProperty.Value) { return }
    if ([string]$digestProperty.Value -notmatch '^sha256:(?<hash>[a-fA-F0-9]{64})$') {
        throw 'La publicacion utiliza un digest no compatible; no se ejecutara el instalador.'
    }
    Assert-AntojitSha256 -Path $Path -ExpectedHash $Matches.hash
}

function Assert-AntojitAuthenticode {
    param([string]$Path, [ValidateSet('Node', 'Git', 'Podman')][string]$Publisher)
    $signature = Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
        throw "La firma Authenticode no es valida: $([IO.Path]::GetFileName($Path)). No se ejecutara el archivo."
    }
    $certificate = $signature.SignerCertificate
    $names = @($certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false))
    $decoded = $certificate.SubjectName.Decode([Security.Cryptography.X509Certificates.X500DistinguishedNameFlags]::UseNewLines)
    foreach ($line in ($decoded -split '\r?\n')) {
        if ($line.Trim() -match '^(?:CN|O)\s*=\s*(?<name>.*)$') { $names += $Matches.name.Trim().Trim('"') }
    }
    $publisherPatterns = @{
        Node = '^(?:OpenJS Foundation|Node\.js Foundation)(?:,? Inc\.?)?$'
        Git = '^(?:(?:Open Source Developer, )?Johannes Schindelin|Git for Windows(?: \(Johannes Schindelin\))?)$'
        Podman = '^Red Hat(?:,? Inc\.?)?$'
    }
    $matchesPublisher = @($names | Where-Object { $_ -match $publisherPatterns[$Publisher] }).Count -gt 0
    if (-not $matchesPublisher) {
        throw "El firmante de $([IO.Path]::GetFileName($Path)) no corresponde al editor oficial esperado ($Publisher)."
    }
    Write-AntojitDiagnostic -Message "[VERIFY] Authenticode valido: $([IO.Path]::GetFileName($Path)); editor $Publisher."
}

function Initialize-AntojitWsl {
    Write-AntojitDiagnostic -Message '[WSL] Comprobando virtualizacion y componentes de Windows.'
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    if (-not $computer.HypervisorPresent) {
        $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
        if (@($processors | Where-Object { $_.VirtualizationFirmwareEnabled -eq $false }).Count -gt 0) {
            throw 'La virtualizacion de hardware no esta habilitada. Habilita Intel VT-x/AMD-V en BIOS/UEFI (o virtualizacion anidada en una VM), reinicia Windows y vuelve a ejecutar el instalador.'
        }
    }
    $restartNeeded = $false
    foreach ($featureName in @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')) {
        $feature = Get-WindowsOptionalFeature -Online -FeatureName $featureName -ErrorAction Stop
        Write-AntojitDiagnostic -Message "[WSL] $featureName = $($feature.State)"
        if ([string]$feature.State -match 'Pending') { $restartNeeded = $true; continue }
        if ([string]$feature.State -ne 'Enabled') {
            Write-AntojitDiagnostic -Message "[WSL] Habilitando $featureName..."
            $enabled = Enable-WindowsOptionalFeature -Online -FeatureName $featureName -All -NoRestart -ErrorAction Stop
            if ($enabled.RestartNeeded -eq $true -or [string]$enabled.RestartNeeded -eq 'Yes') { $restartNeeded = $true }
        }
    }
    if ($restartNeeded) { Stop-AntojitForRestart 'Se habilitaron componentes de WSL2 y hay un reinicio pendiente.' }
    $wslCommands = @(Get-AntojitExecutableCandidates -Name 'wsl.exe' -FallbackPaths @((Join-Path $env:SystemRoot 'System32\wsl.exe')))
    if ($wslCommands.Count -eq 0) { throw 'No se encontro wsl.exe despues de habilitar WSL2. Actualiza Windows y vuelve a ejecutar el instalador.' }
    $wslPath = $wslCommands[0]
    $version = Invoke-AntojitNative -FilePath $wslPath -Arguments @('--version') -AllowNonZeroExit -TimeoutSeconds 60
    if ($version.ExitCode -ne 0) {
        Write-AntojitDiagnostic -Message '[WSL] Instalando o actualizando el runtime de WSL2 (sin instalar Ubuntu)...'
        $updated = Invoke-AntojitNative -FilePath $wslPath -Arguments @('--update', '--web-download') -AllowedExitCodes @(0, 3010, 1641)
        if ($updated.ExitCode -ne 0) { Stop-AntojitForRestart 'El runtime de WSL2 requiere reiniciar.' }
        $null = Invoke-AntojitNative -FilePath $wslPath -Arguments @('--version') -TimeoutSeconds 60
    }
    $defaultVersion = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -Name DefaultVersion -ErrorAction SilentlyContinue
    if ($null -eq $defaultVersion -or $defaultVersion.DefaultVersion -ne 2) {
        $configured = Invoke-AntojitNative -FilePath $wslPath -Arguments @('--set-default-version', '2') -AllowedExitCodes @(0, 3010, 1641) -TimeoutSeconds 120
        if ($configured.ExitCode -ne 0) { Stop-AntojitForRestart 'La configuracion de WSL2 requiere reiniciar.' }
    }
}

function Install-AntojitDependencies {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ToolsDirectory)
    if (-not [IO.Path]::IsPathRooted($ToolsDirectory)) { throw 'ToolsDirectory debe ser una ruta absoluta.' }
    $ToolsDirectory = [IO.Path]::GetFullPath($ToolsDirectory)
    if (-not $env:ANTOJITOS_LOG_PATH -and -not $env:ANTOJITOS_SESSION_LOG_PATH) {
        $logDirectory = Join-Path (Split-Path -Parent $ToolsDirectory) 'logs'
        $env:ANTOJITOS_LOG_PATH = Join-Path $logDirectory ('dependencies-{0}-{1}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [Guid]::NewGuid().ToString('N').Substring(0, 8))
    }
    Write-AntojitDiagnostic -Message "[DEPENDENCIES] Inicio. PowerShell $($PSVersionTable.PSVersion); arquitectura $env:PROCESSOR_ARCHITECTURE; herramientas $ToolsDirectory."
    Assert-AntojitWindows
    Assert-AntojitAdministrator
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Update-AntojitPath
    Initialize-AntojitWsl
    $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('AntojitOS-dependencies-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $temporaryDirectory -Force -ErrorAction Stop
    try {
        $nodePath = Get-AntojitNode
        if (-not $nodePath) {
            Write-AntojitDiagnostic -Message '[DEPENDENCY] Instalando Node.js 24 x64...'
            $manifestPath = Join-Path $temporaryDirectory 'node-SHASUMS256.txt'
            Save-AntojitDownload -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -Destination $manifestPath
            $manifest = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop
            $nodeMatch = [regex]::Match($manifest, '(?m)^(?<hash>[a-fA-F0-9]{64})\s+\*?(?<name>node-v24\.\d+\.\d+-x64\.msi)\s*$')
            if (-not $nodeMatch.Success) { throw 'No se encontro el MSI x64 de Node.js 24 en el manifiesto oficial.' }
            $nodeInstaller = Join-Path $temporaryDirectory $nodeMatch.Groups['name'].Value
            Save-AntojitDownload -Uri ('https://nodejs.org/dist/latest-v24.x/' + $nodeMatch.Groups['name'].Value) -Destination $nodeInstaller
            Assert-AntojitSha256 -Path $nodeInstaller -ExpectedHash $nodeMatch.Groups['hash'].Value
            Assert-AntojitAuthenticode -Path $nodeInstaller -Publisher Node
            Invoke-AntojitInstaller -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -Arguments @('/i', $nodeInstaller, '/qn', '/norestart') -DisplayName 'Node.js 24'
            $nodePath = Get-AntojitNode
            if (-not $nodePath) { throw 'Node.js 24 o posterior no esta disponible despues de la instalacion.' }
        }
        Write-AntojitDiagnostic -Message "[DEPENDENCY] Node.js disponible: $nodePath"
        $gitPath = Get-AntojitGit
        if (-not $gitPath) {
            Write-AntojitDiagnostic -Message '[DEPENDENCY] Instalando Git for Windows x64...'
            $release = Get-AntojitLatestRelease -Repository 'git-for-windows/git'
            $asset = Get-AntojitReleaseAsset -Release $release -NamePattern '^Git-[0-9].*-64-bit\.exe$' -Repository 'git-for-windows/git'
            $gitInstaller = Join-Path $temporaryDirectory $asset.name
            Save-AntojitDownload -Uri $asset.browser_download_url -Destination $gitInstaller
            Assert-AntojitReleaseDigest -Path $gitInstaller -Asset $asset
            Assert-AntojitAuthenticode -Path $gitInstaller -Publisher Git
            Invoke-AntojitInstaller -FilePath $gitInstaller -Arguments @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/ALLUSERS', '/SUPPRESSMSGBOXES') -DisplayName 'Git for Windows' -LogStyle Inno
            $gitPath = Get-AntojitGit
            if (-not $gitPath) { throw 'Git no esta disponible despues de la instalacion.' }
        }
        Write-AntojitDiagnostic -Message "[DEPENDENCY] Git disponible: $gitPath"
        $podmanPath = Get-AntojitPodman
        if (-not $podmanPath) {
            Write-AntojitDiagnostic -Message '[DEPENDENCY] Instalando Podman CLI x64...'
            $release = Get-AntojitLatestRelease -Repository 'podman-container-tools/podman'
            if (@($release.assets | Where-Object { $_.name -eq 'podman-installer-windows-amd64.msi' }).Count -gt 0) {
                $asset = Get-AntojitReleaseAsset -Release $release -NamePattern '^podman-installer-windows-amd64\.msi$' -Repository 'podman-container-tools/podman'
            }
            else {
                $asset = Get-AntojitReleaseAsset -Release $release -NamePattern '^podman-[0-9](?!.*(?:arm|aarch)).*-setup\.exe$' -Repository 'podman-container-tools/podman'
            }
            $podmanInstaller = Join-Path $temporaryDirectory $asset.name
            Save-AntojitDownload -Uri $asset.browser_download_url -Destination $podmanInstaller
            Assert-AntojitReleaseDigest -Path $podmanInstaller -Asset $asset
            Assert-AntojitAuthenticode -Path $podmanInstaller -Publisher Podman
            if ([IO.Path]::GetExtension($podmanInstaller) -eq '.msi') {
                Invoke-AntojitInstaller -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -Arguments @('/i', $podmanInstaller, '/qn', '/norestart') -DisplayName 'Podman CLI'
            }
            else {
                Invoke-AntojitInstaller -FilePath $podmanInstaller -Arguments @('/install', '/quiet', '/norestart') -DisplayName 'Podman CLI' -LogStyle Wix
            }
            $podmanPath = Get-AntojitPodman
            if (-not $podmanPath) { throw 'Podman CLI no esta disponible despues de la instalacion.' }
        }
        Write-AntojitDiagnostic -Message "[DEPENDENCY] Podman disponible: $podmanPath"
        $null = New-Item -ItemType Directory -Path $ToolsDirectory -Force -ErrorAction Stop
        $composeProviderPath = Join-Path $ToolsDirectory 'docker-compose.exe'
        $composeIsValid = $false
        if (Test-Path -LiteralPath $composeProviderPath -PathType Leaf) {
            try {
                $existing = Invoke-AntojitNative -FilePath $composeProviderPath -Arguments @('--version') -TimeoutSeconds 30
                $composeIsValid = $existing.StdOut.Trim() -match '^Docker Compose version v?\d+\.'
            }
            catch { $composeIsValid = $false }
        }
        if (-not $composeIsValid) {
            Write-AntojitDiagnostic -Message '[DEPENDENCY] Instalando el proveedor Docker Compose standalone...'
            $release = Get-AntojitLatestRelease -Repository 'docker/compose'
            $asset = Get-AntojitReleaseAsset -Release $release -NamePattern '^docker-compose-windows-x86_64\.exe$' -Repository 'docker/compose'
            $checksumAsset = Get-AntojitReleaseAsset -Release $release -NamePattern '^docker-compose-windows-x86_64\.exe\.sha256$' -Repository 'docker/compose'
            $downloadedCompose = Join-Path $temporaryDirectory 'docker-compose.exe'
            $checksumPath = Join-Path $temporaryDirectory 'docker-compose.sha256'
            Save-AntojitDownload -Uri $asset.browser_download_url -Destination $downloadedCompose
            Save-AntojitDownload -Uri $checksumAsset.browser_download_url -Destination $checksumPath
            $checksum = Get-Content -LiteralPath $checksumPath -Raw -ErrorAction Stop
            $checksumMatch = [regex]::Match($checksum, '(?im)^\s*(?<hash>[a-fA-F0-9]{64})(?:\s+\*?docker-compose-windows-x86_64\.exe)?\s*$')
            if (-not $checksumMatch.Success) { throw 'El checksum oficial de Docker Compose no tiene un formato reconocido.' }
            Assert-AntojitSha256 -Path $downloadedCompose -ExpectedHash $checksumMatch.Groups['hash'].Value
            Assert-AntojitReleaseDigest -Path $downloadedCompose -Asset $asset
            $composeVersion = Invoke-AntojitNative -FilePath $downloadedCompose -Arguments @('--version') -TimeoutSeconds 30
            if ($composeVersion.StdOut.Trim() -notmatch '^Docker Compose version v?\d+\.') { throw 'El proveedor Compose descargado no responde con una version valida.' }
            Move-Item -LiteralPath $downloadedCompose -Destination $composeProviderPath -Force -ErrorAction Stop
        }
        Write-AntojitDiagnostic -Message "[DEPENDENCY] Compose disponible: $composeProviderPath"
        Write-AntojitDiagnostic -Message '[DEPENDENCIES] Comprobacion e instalacion terminadas.'
        return [pscustomobject]@{
            NodePath = $nodePath
            GitPath = $gitPath
            PodmanPath = $podmanPath
            ComposeProviderPath = $composeProviderPath
        }
    }
    catch { Write-AntojitDiagnostic -Message ('[ERROR] Dependencias: ' + $_.Exception.ToString()); throw }
    finally {
        if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

Export-ModuleMember -Function Assert-AntojitWindows, Assert-AntojitAdministrator, Update-AntojitPath, Get-AntojitNode, Get-AntojitGit, Get-AntojitPodman, Install-AntojitDependencies,
    ConvertTo-AntojitLogText, Write-AntojitDiagnostic
