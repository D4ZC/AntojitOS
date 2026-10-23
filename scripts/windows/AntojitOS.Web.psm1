# Windows PowerShell 5.1. Deploy a prebuilt frontend using the installed nginx image.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Windows.psm1') -DisableNameChecking

function Update-AntojitWebImage {
    param([Parameter(Mandatory)]$Installation, [Parameter(Mandatory)][string]$PayloadPath,
        [ValidateRange(0, 120)][int]$VerifyTimeoutSeconds = 60)
    $PayloadPath = [IO.Path]::GetFullPath($PayloadPath)
    foreach ($file in @('Containerfile', 'nginx.conf.template', 'dist/index.html', 'dist/sw.js', 'dist/recuperar-cocina.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PayloadPath $file) -PathType Leaf)) { throw "Paquete incompleto: falta $file." }
    }
    $index = [IO.File]::ReadAllText((Join-Path $PayloadPath 'dist/index.html'))
    $entry = [regex]::Match($index, 'src="(/assets/[^"<>]+\.js)"').Groups[1].Value
    if (-not $entry -or -not (Test-Path -LiteralPath (Join-Path $PayloadPath ('dist' + $entry)))) {
        throw 'El paquete no contiene el archivo JavaScript de la pantalla.'
    }
    $baseUrl = "http://localhost:$($Installation.HttpPort)"
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health/ready" -TimeoutSec 15
    if ($health.status -ne 'ready' -or $health.database -ne 'connected') { throw 'Inicia AntojitOS antes de actualizar la pantalla.' }
    $podman = Get-AntojitPodman
    $compose = $Installation.ComposeProviderPath
    $prefix = @('--env-file', (Join-Path $Installation.Root '.env.pilot'), '-f', (Join-Path $Installation.Root 'compose.pilot.yaml'), '-p', 'antojitos-pilot')
    # Inspect only web; never print Compose's resolved environment with secrets.
    $containers = @(Invoke-AntojitCommand -FilePath $compose -Arguments ($prefix + @('ps', '--all', '--quiet', 'web')) -WorkingDirectory $Installation.Root -Capture)
    $containers = @($containers | Where-Object { $_.Trim() })
    if ($containers.Count -ne 1) { throw 'No se encontro un unico contenedor web instalado. Inicia AntojitOS primero.' }
    $reference = (@(Invoke-AntojitCommand -FilePath $podman -Arguments @('inspect', '--format', '{{.Config.Image}}', $containers[0].Trim()) -Capture) -join '').Trim()
    if (-not $reference -or $reference -match '^sha256:|@sha256:|^[a-f0-9]{64}$') { throw 'La imagen web instalada no tiene una etiqueta reutilizable.' }
    $oldImage = (@(Invoke-AntojitCommand -FilePath $podman -Arguments @('image', 'inspect', '--format', '{{.Id}}', $reference) -Capture) -join '').Trim()
    if ($oldImage -notmatch '^(sha256:)?[a-f0-9]{64}$') { throw 'No se pudo identificar la imagen web anterior.' }
    $suffix = [guid]::NewGuid().ToString('N')
    $candidate = 'localhost/antojitos-web-repair:' + $suffix
    $backup = 'localhost/antojitos-web-backup:' + $suffix
    Write-AntojitLog 'Preparando la pantalla actualizada con nginx ya instalado, sin descargar dependencias...'
    Invoke-AntojitCommand -FilePath $podman -Arguments @('build', '--pull=never', '--network=none', '--build-arg', "BASE_IMAGE=$reference", '-t', $candidate, '-f', (Join-Path $PayloadPath 'Containerfile'), $PayloadPath)
    Invoke-AntojitCommand -FilePath $podman -Arguments @('tag', $oldImage, $backup)
    $record = Join-Path $Installation.StateDirectory 'web-repair.json'
    @{ PreviousImage = $oldImage; Backup = $backup; Image = $reference; Candidate = $candidate; Applied = $false } |
        ConvertTo-Json | Set-Content -LiteralPath $record -Encoding UTF8
    try {
        Invoke-AntojitCommand -FilePath $podman -Arguments @('tag', $candidate, $reference)
        # Only web is recreated. API, print-agent and PostgreSQL keep running.
        Invoke-AntojitCommand -FilePath $compose -Arguments ($prefix + @('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'web')) -WorkingDirectory $Installation.Root
        $deadline = (Get-Date).AddSeconds($VerifyTimeoutSeconds)
        do {
            try {
                $response = Invoke-WebRequest -Uri "$baseUrl/kds/?verify=$suffix" -UseBasicParsing -TimeoutSec 5 -Headers @{ 'Cache-Control' = 'no-cache' }
                if ($response.StatusCode -eq 200 -and $response.Content.Contains($entry)) {
                    $asset = Invoke-WebRequest -Uri ($baseUrl + $entry) -UseBasicParsing -TimeoutSec 10
                    $recovery = Invoke-WebRequest -Uri "$baseUrl/recuperar-cocina.html?v=$suffix" -UseBasicParsing -TimeoutSec 5
                    if ($asset.StatusCode -eq 200 -and $recovery.StatusCode -eq 200 -and $recovery.Content.Contains('location.replace')) { break }
                }
                throw 'La pantalla publicada no coincide con el paquete.'
            } catch {
                if ((Get-Date) -ge $deadline) { throw }
                Start-Sleep -Seconds 2
            }
        } while ($true)
        @{ PreviousImage = $oldImage; Backup = $backup; Image = $reference; Candidate = $candidate; Applied = $true } |
            ConvertTo-Json | Set-Content -LiteralPath $record -Encoding UTF8
    } catch {
        $failure = $_
        Write-AntojitLog 'La verificacion fallo. Restaurando la pantalla anterior...'
        try {
            Invoke-AntojitCommand -FilePath $podman -Arguments @('tag', $oldImage, $reference)
            Invoke-AntojitCommand -FilePath $compose -Arguments ($prefix + @('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'web')) -WorkingDirectory $Installation.Root
        } catch { Write-AntojitLog "No se pudo restaurar automaticamente. Se conserva la imagen anterior: $backup. $($_.Exception.Message)" }
        throw $failure
    }
    Write-AntojitLog "Pantalla actualizada y comprobada. Abre $baseUrl/recuperar-cocina.html?v=$suffix"
    return "$baseUrl/recuperar-cocina.html?v=$suffix"
}

Export-ModuleMember -Function Update-AntojitWebImage
