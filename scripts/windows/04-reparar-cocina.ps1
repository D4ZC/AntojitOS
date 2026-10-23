#Requires -Version 5.1
[CmdletBinding()]
param([string]$InstallPath, [string]$PayloadPath = (Join-Path $PSScriptRoot '..\..\deploy\web-patch'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$operation = $null
try {
    Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Windows.psm1') -Force -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Web.psm1') -Force -DisableNameChecking
    Assert-AntojitWindows
    Assert-AntojitAdministrator
    $installation = Get-AntojitInstallation -InstallPath (Resolve-AntojitInstallPath -InstallPath $InstallPath)
    Assert-AntojitOwner -Installation $installation
    $operation = Enter-AntojitOperation -Root $installation.Root
    Start-AntojitLog -Path (Join-Path $installation.StateDirectory 'logs\repair-kds.log')
    Assert-AntojitNoPendingUpdate -Installation $installation
    Initialize-AntojitRuntime -Installation $installation
    $url = Update-AntojitWebImage -Installation $installation -PayloadPath $PayloadPath
    Start-Process $url
} catch {
    if (Get-Command Write-AntojitError -ErrorAction SilentlyContinue) { Write-AntojitError -ErrorRecord $_ }
    else { Write-Error -ErrorRecord $_ -ErrorAction Continue }
    exit 1
} finally {
    if ($operation) { $operation.Dispose() }
}
