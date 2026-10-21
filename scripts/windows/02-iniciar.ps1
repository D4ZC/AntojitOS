#Requires -Version 5.1
<#
.SYNOPSIS
Levanta AntojitOS con las imagenes ya instaladas, sin Internet.
.DESCRIPTION
El instalador registra este script como tarea. -RegisterAutoStart registra o
repara la tarea; Startup requiere la contrasena real de la cuenta Windows,
Logon arranca al entrar al escritorio. Ejecutar con la cuenta de instalacion.
.EXAMPLE
.\scripts\windows\02-iniciar.ps1
.EXAMPLE
.\scripts\windows\02-iniciar.ps1 -RegisterAutoStart -AutoStartMode Logon
#>
[CmdletBinding()]
param(
    [string]$InstallPath,
    [switch]$RegisterAutoStart,
    [switch]$ForceRegister,
    [ValidateSet('Startup', 'Logon')][string]$AutoStartMode = 'Startup'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AntojitOS.Windows.psm1') -Force -DisableNameChecking
$operation = $null
try {
    Assert-AntojitWindows
    Assert-AntojitAdministrator
    $installation = Get-AntojitInstallation -InstallPath (Resolve-AntojitInstallPath -InstallPath $InstallPath)
    Assert-AntojitOwner -Installation $installation
    $operation = Enter-AntojitOperation -Root $installation.Root
    Start-AntojitLog -Path (Join-Path $installation.StateDirectory ('logs\start-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd')))
    Assert-AntojitNoPendingUpdate -Installation $installation
    if ($RegisterAutoStart) {
        $taskName = 'AntojitOS-Inicio'
        $scriptPath = Join-Path $installation.Root 'scripts\windows\02-iniciar.ps1'
        $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -InstallPath "{1}"' -f $scriptPath, $installation.Root
        $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        $sameTask = $false
        if ($existing) {
            if ($existing.Actions[0].Arguments -ne $arguments) {
                throw 'Ya existe una tarea AntojitOS-Inicio para otra ubicacion. Revisa esa instalacion antes de sustituirla.'
            }
            $expectedType = if ($AutoStartMode -eq 'Startup') { 'MSFT_TaskBootTrigger' } else { 'MSFT_TaskLogonTrigger' }
            $expectedLogon = if ($AutoStartMode -eq 'Startup') { 'Password' } else { 'Interactive' }
            $principalAccount = [string]$existing.Principal.UserId
            if ($principalAccount.StartsWith('S-1-')) { $principalSid = $principalAccount }
            else {
                $account = New-Object Security.Principal.NTAccount($principalAccount)
                $principalSid = $account.Translate([Security.Principal.SecurityIdentifier]).Value
            }
            $sameTask = ($existing.Triggers[0].CimClass.CimClassName -eq $expectedType -and
                [string]$existing.Principal.LogonType -eq $expectedLogon -and $existing.State -ne 'Disabled' -and
                $principalSid -eq $installation.OwnerSid -and [string]$existing.Principal.RunLevel -eq 'Highest' -and
                $existing.Actions[0].Execute -ieq $powershell -and $existing.Actions[0].WorkingDirectory -ieq $installation.Root)
        }
        if (-not $sameTask -or $ForceRegister) {
            $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $installation.Root
            $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 3 `
                -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
            if ($AutoStartMode -eq 'Startup') {
                $trigger = New-ScheduledTaskTrigger -AtStartup
                $trigger.Delay = 'PT45S'
                Write-AntojitLog 'Windows solicitara la contrasena de esta cuenta para arrancar sin iniciar sesion. El PIN de Windows Hello no sirve.'
                $credential = Get-Credential -UserName $installation.OwnerName -Message 'Contrasena de Windows para el arranque de AntojitOS (no PIN)'
                if (-not $credential) { throw 'No se registro el arranque automatico. Repite con -RegisterAutoStart o elige -AutoStartMode Logon.' }
                $account = New-Object Security.Principal.NTAccount($credential.UserName)
                if ($account.Translate([Security.Principal.SecurityIdentifier]).Value -ne $installation.OwnerSid) {
                    throw 'La tarea debe usar la misma cuenta que instalo Podman.'
                }
                # Task Scheduler stores the credential. It never goes into our
                # JSON, environment files, command line or logs.
                Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
                    -User $credential.UserName -Password $credential.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
                $credential = $null
            } else {
                $trigger = New-ScheduledTaskTrigger -AtLogOn -User $installation.OwnerName
                $trigger.Delay = 'PT15S'
                $principal = New-ScheduledTaskPrincipal -UserId $installation.OwnerName -LogonType Interactive -RunLevel Highest
                Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
            }
            $installation.AutoStartMode = $AutoStartMode
            Save-AntojitInstallation -Installation $installation
            Write-AntojitLog "Arranque automatico registrado: $AutoStartMode."
        } else { Write-AntojitLog 'La tarea de arranque ya esta registrada; se conserva.' }
    }
    Write-AntojitLog 'Iniciando AntojitOS con las imagenes existentes...'
    Initialize-AntojitRuntime -Installation $installation
    Invoke-AntojitPilot -Root $installation.Root -Command 'start'
    Update-AntojitNetwork -Installation $installation
    # Check the actual public port as well as the internal application's health.
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($installation.HttpPort)/api/health/ready" -TimeoutSec 15
    if ($health.status -ne 'ready' -or $health.database -ne 'connected') { throw 'La direccion publica aun no esta lista.' }
    Write-AntojitLog "AntojitOS disponible en http://localhost:$($installation.HttpPort)."
} catch {
    Write-AntojitLog ('ERROR: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($operation) { $operation.Dispose() }
}
exit 0
