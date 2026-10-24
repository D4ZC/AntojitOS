#requires -Version 5.1

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1') -Force
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Printing.psm1') -Force -DisableNameChecking
    # These guards also exist when the suite runs on macOS PowerShell 7.
    function Get-ScheduledTask { param($TaskName) throw 'Task Scheduler must be mocked.' }
    function Register-ScheduledTask {
        [CmdletBinding()]
        param($TaskName, $Action, $Trigger, $Settings, $Principal, $User, $Password, $RunLevel, [switch]$Force)
        throw 'Task Scheduler must be mocked.'
    }
    function Set-ScheduledTask { param($TaskName, $Action, $Settings) throw 'Task Scheduler must be mocked.' }
    function New-ScheduledTaskAction {
        param($Execute, $Argument, $WorkingDirectory)
        throw 'Task Scheduler must be mocked.'
    }
    function New-ScheduledTaskSettingsSet {
        param([switch]$StartWhenAvailable, [switch]$AllowStartIfOnBatteries,
            [switch]$DontStopIfGoingOnBatteries, $MultipleInstances, $RestartCount, $RestartInterval, $ExecutionTimeLimit)
        throw 'Task Scheduler must be mocked.'
    }
    function New-ScheduledTaskTrigger {
        param([switch]$AtStartup, [switch]$AtLogOn, $User)
        throw 'Task Scheduler must be mocked.'
    }
    function New-ScheduledTaskPrincipal {
        param($UserId, $LogonType, $RunLevel)
        throw 'Task Scheduler must be mocked.'
    }
    function New-StartupTaskFixture {
        param([string]$Root, [string]$OwnerSid, [switch]$Legacy)
        if ($Legacy) {
            $scriptPath = Join-Path $Root 'scripts\windows\02-iniciar.ps1'
            $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -InstallPath "{1}"' -f $scriptPath, $Root
        } else {
            $scriptPath = Join-Path $Root 'final_script.ps1'
            $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Action Start -Unattended -InstallPath "{1}"' -f $scriptPath, $Root
        }
        [pscustomobject]@{
            State = 'Ready'
            Actions = @([pscustomobject]@{
                Execute = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
                Arguments = $arguments
                WorkingDirectory = $Root
            })
            Triggers = @([pscustomobject]@{ CimClass = [pscustomobject]@{ CimClassName = 'MSFT_TaskBootTrigger' } })
            Principal = [pscustomobject]@{
                UserId = $OwnerSid
                LogonType = 'Password'
                RunLevel = 'Highest'
            }
        }
    }
}

Describe 'Daily startup entry point' {
    BeforeEach {
        $script:StartupOriginalSystemRoot = $env:SystemRoot
        $env:SystemRoot = $TestDrive
        $global:AntojitStartupTestInstallation = [pscustomobject]@{
            Root = $TestDrive
            StateDirectory = (Join-Path $TestDrive 'var\windows')
            HttpPort = 8080
            OwnerName = 'FIXTURE\Restaurant'
            OwnerSid = 'S-1-5-21-1-2-3-1000'
            AutoStartMode = 'Startup'
        }
        $global:AntojitStartupTestLease = New-Object System.IO.MemoryStream
        # Keep the real module loaded so mocks remain installed during the entry point.
        Mock Import-Module { }
        Mock Assert-AntojitWindows { }
        Mock Assert-AntojitAdministrator { }
        Mock Get-AntojitInstallation { $global:AntojitStartupTestInstallation }
        Mock Assert-AntojitOwner { }
        Mock Enter-AntojitOperation { $global:AntojitStartupTestLease }
        Mock Start-AntojitLog { }
        Mock Write-AntojitLog { }
        Mock Save-AntojitInstallation { }
        Mock Initialize-AntojitRuntime { }
        Mock Update-AntojitNetwork { }
        Mock Invoke-RestMethod { [pscustomobject]@{ status = 'ready'; database = 'connected' } }
        Mock Invoke-AntojitPilot {
            param($Root, $Command)
            if ($Command -ne 'start') { throw "Daily startup must not run pilot $Command." }
        }
        Mock Invoke-AntojitCompose { throw 'Daily startup must delegate the installed start command.' }
        Mock Install-AntojitDependencies { throw 'Daily startup must not install dependencies.' }
        Mock Get-ScheduledTask { throw 'Daily startup must not read or register a scheduled task.' }
        Mock Register-ScheduledTask { throw 'Daily startup must not register a scheduled task.' }
        Mock Set-ScheduledTask { throw 'Daily startup must not change a scheduled task.' }
        Mock New-ScheduledTaskAction {
            param($Execute, $Argument, $WorkingDirectory)
            [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory }
        }
        Mock New-ScheduledTaskSettingsSet { [pscustomobject]@{} }
        Mock New-ScheduledTaskTrigger { [pscustomobject]@{ Delay = '' } }
        Mock New-ScheduledTaskPrincipal {
            param($UserId, $LogonType, $RunLevel)
            [pscustomobject]@{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel }
        }
        Mock Get-Credential { throw 'Daily startup must not ask for a password.' }
    }

    AfterEach {
        $global:AntojitStartupTestLease.Dispose()
        $env:SystemRoot = $script:StartupOriginalSystemRoot
        Remove-Variable AntojitStartupTestInstallation, AntojitStartupTestLease -Scope Global -ErrorAction SilentlyContinue
    }

    It 'can run twice using existing images without installation, seed or task registration' {
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive
        $LASTEXITCODE | Should -Be 0
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive
        $LASTEXITCODE | Should -Be 0
        Should -Invoke Invoke-AntojitPilot -Times 2 -Exactly -ParameterFilter { $Command -eq 'start' }
        Should -Invoke Invoke-AntojitPilot -Times 0 -Exactly -ParameterFilter { $Command -ne 'start' }
        Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly
        Should -Invoke Install-AntojitDependencies -Times 0 -Exactly
        Should -Invoke Register-ScheduledTask -Times 0 -Exactly
        Should -Invoke Get-ScheduledTask -Times 0 -Exactly
        Should -Invoke Get-Credential -Times 0 -Exactly
    }

    It 'returns failure and releases its lock when the engine cannot start' {
        Mock Initialize-AntojitRuntime { throw 'Podman unavailable.' }
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive
        $LASTEXITCODE | Should -Be 1
        $global:AntojitStartupTestLease.CanWrite | Should -BeFalse
        Should -Invoke Invoke-AntojitPilot -Times 0 -Exactly
        Should -Invoke Update-AntojitNetwork -Times 0 -Exactly
    }

    It 'starts the native USB agent only after the public application is ready' {
        $global:AntojitStartupOrder = New-Object 'System.Collections.Generic.List[string]'
        Mock Get-AntojitPrintConfiguration { [pscustomobject]@{ Mode = 'native' } }
        Mock Invoke-AntojitPilot { $global:AntojitStartupOrder.Add('containers') }
        Mock Update-AntojitNetwork { $global:AntojitStartupOrder.Add('network') }
        Mock Invoke-RestMethod {
            $global:AntojitStartupOrder.Add('health')
            [pscustomobject]@{ status = 'ready'; database = 'connected' }
        }
        Mock Start-AntojitNativePrintAgent { $global:AntojitStartupOrder.Add('usb') }
        try {
            & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -Managed
            ($global:AntojitStartupOrder -join '|') | Should -Be 'containers|network|health|usb'
            Should -Invoke Start-AntojitNativePrintAgent -Times 1 -Exactly
        } finally { Remove-Variable AntojitStartupOrder -Scope Global -ErrorAction SilentlyContinue }
    }

    It 'does not start native printing when the public application is not healthy' {
        Mock Get-AntojitPrintConfiguration { [pscustomobject]@{ Mode = 'native' } }
        Mock Invoke-RestMethod { [pscustomobject]@{ status = 'starting'; database = 'connected' } }
        Mock Start-AntojitNativePrintAgent { }
        { & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -Managed } | Should -Throw '*direccion publica*'
        Should -Invoke Start-AntojitNativePrintAgent -Times 0 -Exactly
    }

    It 'returns control to the unified launcher on success and throws the original failure in managed mode' {
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -Managed
        Should -Invoke Invoke-AntojitPilot -Times 1 -Exactly -ParameterFilter { $Command -eq 'start' }
        Mock Initialize-AntojitRuntime { throw 'Managed engine failure.' }
        { & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -Managed } | Should -Throw '*Managed engine failure*'
        $global:AntojitStartupTestLease.CanWrite | Should -BeFalse
    }

    It 'registers a logon task only when requested and does not request a password' {
        Mock Get-ScheduledTask { $null }
        Mock Register-ScheduledTask { }
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -RegisterAutoStart -AutoStartMode Logon
        $LASTEXITCODE | Should -Be 0
        Should -Invoke Register-ScheduledTask -Times 1 -Exactly -ParameterFilter {
            $TaskName -eq 'AntojitOS-Inicio' -and
                $Principal.UserId -eq 'FIXTURE\Restaurant' -and
                $Principal.LogonType -eq 'Interactive' -and
                $Action.WorkingDirectory -eq $global:AntojitStartupTestInstallation.Root -and
                $Action.Arguments -like '*final_script.ps1" -Action Start -Unattended -InstallPath*'
        }
        Should -Invoke Get-Credential -Times 0 -Exactly
        Should -Invoke Save-AntojitInstallation -Times 1 -Exactly
        $global:AntojitStartupTestInstallation.AutoStartMode | Should -Be 'Logon'
    }

    It 'registers the stored repair launcher while keeping the installed application as the working directory' {
        $launcher = Join-Path $TestDrive 'program data\launcher\final_script.ps1'
        $global:AntojitStartupTestInstallation | Add-Member -NotePropertyName LauncherPath -NotePropertyValue $launcher
        Mock Get-ScheduledTask { $null }
        Mock Register-ScheduledTask { }
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -RegisterAutoStart -AutoStartMode Logon
        $LASTEXITCODE | Should -Be 0
        Should -Invoke Register-ScheduledTask -Times 1 -Exactly -ParameterFilter {
            $Action.Arguments.Contains(('"{0}" -Action Start -Unattended' -f $global:AntojitStartupTestInstallation.LauncherPath)) -and
                $Action.WorkingDirectory -eq $global:AntojitStartupTestInstallation.Root
        }
        Should -Invoke Get-Credential -Times 0 -Exactly
    }

    It 'stops registration when the startup credential dialog is cancelled' {
        Mock Get-ScheduledTask { $null }
        Mock Get-Credential { $null }
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -RegisterAutoStart -AutoStartMode Startup
        $LASTEXITCODE | Should -Be 1
        Should -Invoke Get-Credential -Times 1 -Exactly
        Should -Invoke Register-ScheduledTask -Times 0 -Exactly
        Should -Invoke Save-AntojitInstallation -Times 0 -Exactly
        Should -Invoke Invoke-AntojitPilot -Times 0 -Exactly
    }

    It 'preserves a matching startup task without requesting its stored password again' {
        Mock Get-ScheduledTask {
            New-StartupTaskFixture -Root $global:AntojitStartupTestInstallation.Root -OwnerSid $global:AntojitStartupTestInstallation.OwnerSid
        }
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -RegisterAutoStart -AutoStartMode Startup
        $LASTEXITCODE | Should -Be 0
        Should -Invoke Register-ScheduledTask -Times 0 -Exactly
        Should -Invoke Set-ScheduledTask -Times 0 -Exactly
        Should -Invoke Get-Credential -Times 0 -Exactly
        Should -Invoke Save-AntojitInstallation -Times 0 -Exactly
        Should -Invoke Invoke-AntojitPilot -Times 1 -Exactly -ParameterFilter { $Command -eq 'start' }
    }

    It 'removes the old startup time limit without replacing stored task credentials' {
        Mock Get-ScheduledTask {
            $task = New-StartupTaskFixture -Root $global:AntojitStartupTestInstallation.Root -OwnerSid $global:AntojitStartupTestInstallation.OwnerSid
            $task | Add-Member -NotePropertyName Settings -NotePropertyValue ([pscustomobject]@{ ExecutionTimeLimit = 'PT15M'; StartWhenAvailable = $true })
            return $task
        }
        Mock Set-ScheduledTask { }
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -RegisterAutoStart -AutoStartMode Startup
        $LASTEXITCODE | Should -Be 0
        Should -Invoke Set-ScheduledTask -Times 1 -Exactly -ParameterFilter {
            $TaskName -eq 'AntojitOS-Inicio' -and $Settings.ExecutionTimeLimit -eq 'PT0S' -and $Settings.StartWhenAvailable
        }
        Should -Invoke Get-Credential -Times 0 -Exactly
        Should -Invoke Register-ScheduledTask -Times 0 -Exactly
    }

    It 'migrates a compatible legacy task action while preserving its stored credentials and trigger' {
        Mock Get-ScheduledTask {
            New-StartupTaskFixture -Root $global:AntojitStartupTestInstallation.Root -OwnerSid $global:AntojitStartupTestInstallation.OwnerSid -Legacy
        }
        Mock Set-ScheduledTask { }
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -RegisterAutoStart -AutoStartMode Startup
        $LASTEXITCODE | Should -Be 0
        Should -Invoke Set-ScheduledTask -Times 1 -Exactly -ParameterFilter {
            $TaskName -eq 'AntojitOS-Inicio' -and
                $Action.Arguments -like '*final_script.ps1" -Action Start -Unattended -InstallPath*' -and
                $Action.WorkingDirectory -eq $global:AntojitStartupTestInstallation.Root
        }
        Should -Invoke Register-ScheduledTask -Times 0 -Exactly
        Should -Invoke Get-Credential -Times 0 -Exactly
        Should -Invoke New-ScheduledTaskTrigger -Times 0 -Exactly
        Should -Invoke Save-AntojitInstallation -Times 0 -Exactly
        Should -Invoke Invoke-AntojitPilot -Times 1 -Exactly -ParameterFilter { $Command -eq 'start' }
    }

    It 'migrates a root wrapper action to the stored repair launcher without replacing task credentials' {
        $launcher = Join-Path $TestDrive 'program data\launcher\final_script.ps1'
        $global:AntojitStartupTestInstallation | Add-Member -NotePropertyName LauncherPath -NotePropertyValue $launcher
        Mock Get-ScheduledTask {
            New-StartupTaskFixture -Root $global:AntojitStartupTestInstallation.Root -OwnerSid $global:AntojitStartupTestInstallation.OwnerSid
        }
        Mock Set-ScheduledTask { }
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -RegisterAutoStart -AutoStartMode Startup
        $LASTEXITCODE | Should -Be 0
        Should -Invoke Set-ScheduledTask -Times 1 -Exactly -ParameterFilter {
            $Action.Arguments.Contains(('"{0}" -Action Start -Unattended' -f $global:AntojitStartupTestInstallation.LauncherPath)) -and
                $Action.WorkingDirectory -eq $global:AntojitStartupTestInstallation.Root
        }
        Should -Invoke Register-ScheduledTask -Times 0 -Exactly
        Should -Invoke Get-Credential -Times 0 -Exactly
        Should -Invoke New-ScheduledTaskTrigger -Times 0 -Exactly
        Should -Invoke Invoke-AntojitPilot -Times 1 -Exactly -ParameterFilter { $Command -eq 'start' }
    }

    It 'blocks a pending update before starting containers or changing the scheduled task' {
        $state = $global:AntojitStartupTestInstallation.StateDirectory
        New-Item -ItemType Directory -Path $state -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $state 'update-pending.json') -Value '{"Stage":"building"}'
        & (Join-Path $PSScriptRoot '..\02-iniciar.ps1') -InstallPath $TestDrive -RegisterAutoStart -AutoStartMode Startup
        $LASTEXITCODE | Should -Be 1
        $global:AntojitStartupTestLease.CanWrite | Should -BeFalse
        Should -Invoke Initialize-AntojitRuntime -Times 0 -Exactly
        Should -Invoke Invoke-AntojitPilot -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly
        Should -Invoke Get-ScheduledTask -Times 0 -Exactly
        Should -Invoke Register-ScheduledTask -Times 0 -Exactly
        Should -Invoke Get-Credential -Times 0 -Exactly
        Test-Path -LiteralPath (Join-Path $state 'update-pending.json') | Should -BeTrue
    }
}
