#requires -Version 5.1

BeforeAll {
    $script:FinalScriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\final_script.ps1'))
    $script:FinalLauncherPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\final_script.cmd'))
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1') -Force
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Printing.psm1') -Force
    . $script:FinalScriptPath
    $script:FinalOriginalEntryRoot = $script:AntojitEntryRoot
}

Describe 'Unified workflow dispatch' {
    BeforeEach {
        $script:AntojitEntryRoot = Join-Path $TestDrive 'project with spaces'
        $helpers = Join-Path $script:AntojitEntryRoot 'scripts\windows'
        New-Item -ItemType Directory -Path $helpers -Force | Out-Null
        $fixture = @'
[CmdletBinding()]
param([switch]$Managed, [string]$InstallPath, [string]$SourcePath, [string]$PrinterQueue, [string]$RepositoryUrl, [string]$Branch,
    [int]$HttpPort, [int]$InternalHttpPort, [string]$PrinterHost, [int]$PrinterPort,
    [string]$AutoStartMode, [switch]$RegisterAutoStart, [switch]$ForceRegister,
    [switch]$ConfirmMaintenance, [switch]$ResumePending)
$bound = @{}
foreach ($name in $PSBoundParameters.Keys) { $bound[$name] = $PSBoundParameters[$name] }
$global:AntojitFinalWorkflowTrace += [pscustomobject]@{ File = [IO.Path]::GetFileName($PSCommandPath); Bound = $bound }
if ($global:AntojitFinalWorkflowFailure) { throw $global:AntojitFinalWorkflowFailure }
'@
        foreach ($name in @('01-instalar.ps1', '02-iniciar.ps1', '03-actualizar.ps1')) {
            Set-Content -LiteralPath (Join-Path $helpers $name) -Value $fixture -Encoding UTF8
        }
        $global:AntojitFinalWorkflowTrace = @()
        $global:AntojitFinalWorkflowFailure = $null
    }

    AfterEach {
        $script:AntojitEntryRoot = $script:FinalOriginalEntryRoot
        Remove-Variable AntojitFinalWorkflowTrace, AntojitFinalWorkflowFailure -Scope Global -ErrorAction SilentlyContinue
    }

    It 'routes installation options and paths with spaces to the managed installer' {
        $options = @{
            InstallPath = (Join-Path $TestDrive 'restaurant installation')
            RepositoryUrl = 'https://github.com/restaurant/AntojitOS.git'
            Branch = 'release/windows'
            HttpPort = 8081
            InternalHttpPort = 18081
            PrinterHost = '192.168.1.50'
            PrinterPort = 9100
            PrinterQueue = 'BIXOLON USB'
            AutoStartMode = 'Logon'
            Unattended = $false
            NoPause = $true
        }
        Invoke-AntojitWorkflow -Action Install -Options $options
        $global:AntojitFinalWorkflowTrace.Count | Should -Be 1
        $call = $global:AntojitFinalWorkflowTrace[0]
        $call.File | Should -Be '01-instalar.ps1'
        $call.Bound.Managed | Should -BeTrue
        foreach ($name in @('InstallPath', 'RepositoryUrl', 'Branch', 'HttpPort', 'InternalHttpPort', 'PrinterHost', 'PrinterPort', 'PrinterQueue', 'AutoStartMode')) {
            $call.Bound[$name] | Should -Be $options[$name]
        }
        $call.Bound.ContainsKey('Unattended') | Should -BeFalse
        $call.Bound.ContainsKey('NoPause') | Should -BeFalse
    }

    It 'passes a ZIP source path and USB queue unchanged to the managed updater' {
        $options = @{
            InstallPath = (Join-Path $TestDrive 'existing installation')
            SourcePath = (Join-Path $TestDrive 'AntojitOS-main extracted ZIP')
            PrinterQueue = 'BIXOLON USB Caja'
            ConfirmMaintenance = $true
        }
        Invoke-AntojitWorkflow -Action Update -Options $options
        $call = $global:AntojitFinalWorkflowTrace[0]
        $call.Bound.SourcePath | Should -BeExactly $options.SourcePath
        $call.Bound.PrinterQueue | Should -BeExactly $options.PrinterQueue
        $call.Bound.ConfirmMaintenance | Should -BeTrue
    }

    It 'passes recovery explicitly without changing its source folder or maintenance confirmation' {
        $options = @{
            InstallPath = (Join-Path $TestDrive 'existing installation')
            SourcePath = (Join-Path $TestDrive 'new ZIP helpers')
            ResumePending = $true
            ConfirmMaintenance = $true
        }
        Invoke-AntojitWorkflow -Action Update -Options $options
        $call = $global:AntojitFinalWorkflowTrace[0]
        $call.File | Should -Be '03-actualizar.ps1'
        $call.Bound.ResumePending | Should -BeTrue
        $call.Bound.SourcePath | Should -BeExactly $options.SourcePath
        $call.Bound.ConfirmMaintenance | Should -BeTrue
    }

    It 'keeps daily start separate from explicit automatic startup registration' {
        $options = @{ InstallPath = $TestDrive; AutoStartMode = 'Logon'; ForceRegister = $true }
        Invoke-AntojitWorkflow -Action Start -Options $options
        Invoke-AntojitWorkflow -Action AutoStart -Options $options
        $global:AntojitFinalWorkflowTrace.Count | Should -Be 2
        $daily = $global:AntojitFinalWorkflowTrace[0]
        $automatic = $global:AntojitFinalWorkflowTrace[1]
        $daily.File | Should -Be '02-iniciar.ps1'
        $daily.Bound.Managed | Should -BeTrue
        $daily.Bound.ContainsKey('RegisterAutoStart') | Should -BeFalse
        $daily.Bound.ContainsKey('ForceRegister') | Should -BeFalse
        $automatic.File | Should -Be '02-iniciar.ps1'
        $automatic.Bound.RegisterAutoStart | Should -BeTrue
        $automatic.Bound.ForceRegister | Should -BeTrue
        $automatic.Bound.AutoStartMode | Should -Be 'Logon'
    }

    It 'passes maintenance confirmation and propagates a managed update failure to its caller' {
        $global:AntojitFinalWorkflowFailure = 'Managed update failed before deployment.'
        $options = @{
            InstallPath = $TestDrive
            RepositoryUrl = 'https://github.com/restaurant/AntojitOS.git'
            Branch = 'main'
            ConfirmMaintenance = $true
        }
        { Invoke-AntojitWorkflow -Action Update -Options $options } | Should -Throw '*Managed update failed before deployment*'
        $global:AntojitFinalWorkflowTrace.Count | Should -Be 1
        $call = $global:AntojitFinalWorkflowTrace[0]
        $call.File | Should -Be '03-actualizar.ps1'
        $call.Bound.Managed | Should -BeTrue
        $call.Bound.ConfirmMaintenance | Should -BeTrue
        $call.Bound.RepositoryUrl | Should -Be $options.RepositoryUrl
        $call.Bound.Branch | Should -Be 'main'
    }
}

Describe 'Unified launcher diagnostics and unattended operation' {
    BeforeEach {
        $script:FinalOriginalOs = $env:OS
        $env:OS = 'Windows_NT'
        $script:AntojitEntryRoot = $script:FinalOriginalEntryRoot
        Mock Start-Transcript { }
        Mock Stop-Transcript { }
        Mock Test-AntojitElevated { $true }
        Mock Import-Module { }
        Mock Start-AntojitLog { }
        Mock Write-AntojitLog { }
        Mock Write-Host { }
        Mock Invoke-AntojitWorkflow { }
        Mock Read-Host { throw 'Unattended execution must not ask a question.' }
        Mock Read-AntojitAction { throw 'Unattended execution must not open the menu.' }
        Mock Read-AntojitAutoStartMode { throw 'Unattended execution must not request a startup mode.' }
        # Simulate bootstrap before the logging module has loaded.
        Mock Get-Command { $null } -ParameterFilter { $Name -eq 'Write-AntojitError' }
    }

    AfterEach {
        $env:OS = $script:FinalOriginalOs
    }

    It 'runs unattended start without prompts or pausing and restores the caller log environment' {
        $session = Join-Path $TestDrive 'unattended logs'
        $previousSessionLog = $env:ANTOJITOS_SESSION_LOG_PATH
        $previousLog = $env:ANTOJITOS_LOG_PATH
        $options = @{ Action = 'Start'; Unattended = $true; SessionDirectory = $session }
        Invoke-AntojitFinalMain -Options $options | Should -Be 0
        Should -Invoke Invoke-AntojitWorkflow -Times 1 -Exactly -ParameterFilter { $Action -eq 'Start' }
        Should -Invoke Read-Host -Times 0 -Exactly
        Should -Invoke Read-AntojitAction -Times 0 -Exactly
        Should -Invoke Read-AntojitAutoStartMode -Times 0 -Exactly
        Should -Invoke Stop-Transcript -Times 1 -Exactly
        $env:ANTOJITOS_SESSION_LOG_PATH | Should -Be $previousSessionLog
        $env:ANTOJITOS_LOG_PATH | Should -Be $previousLog
    }

    It 'requires the same maintenance confirmation for an explicit update action' {
        $destination = Join-Path $TestDrive 'registered installation'
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination } }
        Mock Get-AntojitPrintConfiguration { [pscustomobject]@{ Mode = 'native' } }
        Mock Read-Host { 'ACTUALIZAR' } -ParameterFilter { $Prompt -like '*Escribe ACTUALIZAR*' }
        $options = @{ Action = 'Update'; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'explicit update logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 0
        Should -Invoke Read-Host -Times 1 -Exactly -ParameterFilter { $Prompt -like '*Escribe ACTUALIZAR*' }
        Should -Invoke Invoke-AntojitWorkflow -Times 1 -Exactly -ParameterFilter {
            $Action -eq 'Update' -and $Options.ConfirmMaintenance -and $Options.SourcePath -eq $script:FinalOriginalEntryRoot
        }
    }

    It 'recovers through menu six using the new ZIP helpers without asking to change the printer' {
        $destination = Join-Path $TestDrive 'pending installation'
        $state = Join-Path $destination 'var/windows'
        New-Item -ItemType Directory -Path $state -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $state 'update-pending.json') -Value '{}'
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination; StateDirectory = $state; SourceMode = 'folder' } }
        Mock Read-AntojitAction { 'ResumeUpdate' }
        Mock Read-Host { 'ACTUALIZAR' } -ParameterFilter { $Prompt -like '*Escribe ACTUALIZAR*' }
        Mock Get-AntojitPrintConfiguration { throw 'Recovery must keep the existing printer.' }
        $options = @{ Action = 'Menu'; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'menu recovery logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 0
        Should -Invoke Read-Host -Times 1 -Exactly -ParameterFilter { $Prompt -like '*Escribe ACTUALIZAR*' }
        Should -Invoke Invoke-AntojitWorkflow -Times 1 -Exactly -ParameterFilter {
            $Action -eq 'Update' -and $Options.ResumePending -and $Options.ConfirmMaintenance -and
            $Options.SourcePath -eq $script:FinalOriginalEntryRoot
        }
        Should -Invoke Get-AntojitPrintConfiguration -Times 0 -Exactly
        Should -Invoke Write-AntojitLog -Times 1 -Exactly -ParameterFilter { $Message -like 'Recuperacion completada.*ACTUALIZAR-APP.cmd*' }
        Should -Invoke Write-Host -Times 1 -Exactly -ParameterFilter { $Object -like '*version pendiente guardada*' }
    }

    It 'cancels explicit recovery before invoking the updater when maintenance is not confirmed' {
        $destination = Join-Path $TestDrive 'cancelled recovery installation'
        $state = Join-Path $destination 'var/windows'
        New-Item -ItemType Directory -Path $state -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $state 'update-pending.json') -Value '{}'
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination; StateDirectory = $state } }
        Mock Read-Host { '' }
        $options = @{ Action = 'Update'; ResumePending = $true; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'cancelled recovery logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 0
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        Get-Content -LiteralPath (Join-Path $state 'update-pending.json') -Raw | Should -Match '^\{\}'
        Should -Invoke Write-AntojitLog -Times 0 -Exactly -ParameterFilter { $Message -like 'Recuperacion completada.*' }
    }

    It 'rejects recovery without pending state before asking for maintenance' {
        $destination = Join-Path $TestDrive 'installation without pending state'
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination; StateDirectory = (Join-Path $destination 'var/windows') } }
        $options = @{ Action = 'Update'; ResumePending = $true; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'no pending recovery logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 1
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        Should -Invoke Read-Host -Times 0 -Exactly
        Get-Content -LiteralPath (Join-Path $options.SessionDirectory 'error-resumen.txt') -Raw | Should -Match 'No hay una actualizacion pendiente'
    }

    It 'rejects recovery combined with daily start or a Git repository' {
        $options = @{ Action = 'Start'; ResumePending = $true; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'invalid recovery action') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 1
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        $destination = Join-Path $TestDrive 'Git recovery installation'
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination } }
        $options = @{ Action = 'Update'; ResumePending = $true; RepositoryUrl = 'https://github.com/restaurant/AntojitOS'; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'invalid recovery repository') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 1
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        Should -Invoke Read-Host -Times 0 -Exactly
    }

    It 'does not treat the protected launcher bundle as a downloaded ZIP project' {
        $destination = Join-Path $TestDrive 'registered installation'
        $script:AntojitEntryRoot = Join-Path $TestDrive 'ProgramData/AntojitOS/launcher'
        New-Item -ItemType Directory -Path $script:AntojitEntryRoot -Force | Out-Null
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination; SourceMode = 'folder' } }
        $options = @{ Action = 'Update'; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'bundle update logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 1
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        Should -Invoke Read-Host -Times 0 -Exactly
        $options.ContainsKey('SourcePath') | Should -BeFalse
        Get-Content -LiteralPath (Join-Path $options.SessionDirectory 'bootstrap-error.log') -Raw | Should -Match 'ZIP nuevo'
        $script:AntojitEntryRoot = $script:FinalOriginalEntryRoot
    }

    It 'honors an explicit GitHub update instead of detecting a ZIP source' {
        $destination = Join-Path $TestDrive 'registered installation'
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination; SourceMode = 'git' } }
        Mock Get-AntojitPrintConfiguration { [pscustomobject]@{ Mode = 'native' } }
        $options = @{ Action = 'Update'; RepositoryUrl = 'https://github.com/restaurant/AntojitOS'; ConfirmMaintenance = $true; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'explicit Git logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 0
        Should -Invoke Invoke-AntojitWorkflow -Times 1 -Exactly -ParameterFilter {
            $Action -eq 'Update' -and -not $Options.ContainsKey('SourcePath') -and $Options.RepositoryUrl -eq 'https://github.com/restaurant/AntojitOS'
        }
        Should -Invoke Read-Host -Times 0 -Exactly
    }

    It 'cancels an explicit update without changing the application when confirmation is empty' {
        $destination = Join-Path $TestDrive 'registered installation'
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination } }
        Mock Get-AntojitPrintConfiguration { [pscustomobject]@{ Mode = 'container' } }
        Mock Read-AntojitUsbPrinterQueue { $null }
        Mock Read-Host { '' }
        $options = @{ Action = 'Update'; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'cancel update logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 0
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        $options.ContainsKey('PrinterQueue') | Should -BeFalse
        $options.ConfirmMaintenance | Should -BeFalse
    }

    It 'keeps an existing native queue and does not ask for it again' {
        $destination = Join-Path $TestDrive 'registered installation'
        Mock Resolve-AntojitInstallPath { $destination }
        Mock Get-AntojitInstallation { [pscustomobject]@{ Root = $destination } }
        Mock Get-AntojitPrintConfiguration { [pscustomobject]@{ Mode = 'native' } }
        Mock Read-AntojitUsbPrinterQueue { throw 'Existing USB configuration must survive.' }
        $options = @{ Action = 'Update'; ConfirmMaintenance = $true; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'native update logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 0
        Should -Invoke Read-AntojitUsbPrinterQueue -Times 0 -Exactly
        Should -Invoke Read-Host -Times 0 -Exactly
        Should -Invoke Invoke-AntojitWorkflow -Times 1 -Exactly -ParameterFilter { $Action -eq 'Update' }
    }

    It 'rejects an unattended menu without opening a prompt or dispatching a workflow' {
        $options = @{ Action = 'Menu'; Unattended = $true; SessionDirectory = (Join-Path $TestDrive 'invalid unattended') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 1
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        Should -Invoke Read-Host -Times 0 -Exactly
        Should -Invoke Read-AntojitAction -Times 0 -Exactly
    }

    It 'retains the original import failure on disk before the application logger is available' {
        $session = Join-Path $TestDrive 'bootstrap failure logs'
        Mock Import-Module { throw 'Fixture module import failure.' }
        $options = @{ Action = 'Start'; NoPause = $true; SessionDirectory = $session }
        Invoke-AntojitFinalMain -Options $options | Should -Be 1
        Get-Content -LiteralPath (Join-Path $session 'final_script.log') -Raw | Should -Match 'Inicio final_script'
        Get-Content -LiteralPath (Join-Path $session 'bootstrap-error.log') -Raw | Should -Match 'Fixture module import failure'
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        Should -Invoke Read-Host -Times 0 -Exactly
        Should -Invoke Stop-Transcript -Times 1 -Exactly
    }

    It 'propagates a restart-required exit code from the elevated process without running twice' {
        Mock Test-AntojitElevated { $false }
        Mock Invoke-AntojitElevation { 3010 }
        $options = @{ Action = 'Install'; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'elevated logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 3010
        Should -Invoke Invoke-AntojitElevation -Times 1 -Exactly
        Should -Invoke Import-Module -Times 0 -Exactly
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
        Should -Invoke Read-Host -Times 0 -Exactly
    }

    It 'preserves the restart-required result thrown by a managed installation step' {
        Mock Invoke-AntojitWorkflow {
            $failure = New-Object InvalidOperationException('Fixture Windows restart required.')
            $failure.Data['RestartRequired'] = $true
            throw $failure
        }
        $options = @{ Action = 'Install'; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'restart required') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 3010
        Should -Invoke Invoke-AntojitWorkflow -Times 1 -Exactly
        Should -Invoke Read-Host -Times 0 -Exactly
        Get-Content -LiteralPath (Join-Path $options.SessionDirectory 'bootstrap-error.log') -Raw | Should -Match 'Fixture Windows restart required'
    }

    It 'keeps the interactive console open after a workflow failure' {
        Mock Invoke-AntojitWorkflow { throw 'Fixture workflow failure.' }
        Mock Read-Host { '' }
        $options = @{ Action = 'Start'; SessionDirectory = (Join-Path $TestDrive 'interactive failure') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 1
        Should -Invoke Read-Host -Times 1 -Exactly
        Get-Content -LiteralPath (Join-Path $options.SessionDirectory 'bootstrap-error.log') -Raw | Should -Match 'Fixture workflow failure'
    }

    It 'ends a failed update with a shareable redacted summary of the original cause' {
        Mock Set-AntojitUpdateOptions { $true }
        Mock Invoke-AntojitWorkflow {
            throw "El comando podman compose build api termino con codigo 111.`nDetalle del comando:`n[stdout] fixture build cause`n[stderr] TOKEN=fixture-sensitive-token"
        }
        Mock Get-Command { $true } -ParameterFilter { $Name -eq 'Write-AntojitError' }
        Mock Write-AntojitError { Write-Host '[STACK] fixture technical position' }
        $options = @{ Action = 'Update'; NoPause = $true; SessionDirectory = (Join-Path $TestDrive 'build failed logs') }
        Invoke-AntojitFinalMain -Options $options | Should -Be 1
        $summary = Get-Content -LiteralPath (Join-Path $options.SessionDirectory 'error-resumen.txt') -Raw
        $summary | Should -Match 'build api termino con codigo 111'
        $summary | Should -Match 'fixture build cause'
        $summary | Should -Match 'TOKEN=\[REDACTED\]'
        $summary | Should -Not -Match 'fixture-sensitive-token|\[STACK\]|technical position'
        $summary | Should -Match ([regex]::Escape($options.SessionDirectory))
        Should -Invoke Write-Host -Times 1 -Exactly -ParameterFilter {
            $Object -like '*AntojitOS - resumen del error*' -and $Object -like '*fixture build cause*'
        }
        Should -Invoke Write-Host -Times 1 -Exactly -ParameterFilter { $Object -like '*Comparte este archivo*error-resumen.txt' }
    }

    It 'provides the bootstrap log location when the summary helper could not load' {
        Mock Import-Module { throw 'Fixture module import failure.' }
        Mock Get-Command { $null } -ParameterFilter { $Name -eq 'Get-AntojitErrorSummary' }
        $session = Join-Path $TestDrive 'missing summary helper'
        Invoke-AntojitFinalMain -Options @{ Action = 'Start'; NoPause = $true; SessionDirectory = $session } | Should -Be 1
        $summary = Get-Content -LiteralPath (Join-Path $session 'error-resumen.txt') -Raw
        $summary | Should -Match 'bootstrap-error.log'
        Get-Content -LiteralPath (Join-Path $session 'bootstrap-error.log') -Raw | Should -Match 'Fixture module import failure'
    }

    It 'preserves the workflow failure if generating its summary also fails' {
        Mock Invoke-AntojitWorkflow { throw 'Fixture original workflow failure.' }
        Mock Write-AntojitFailureSummary { throw 'Fixture report write failure.' }
        $session = Join-Path $TestDrive 'summary failure'
        Invoke-AntojitFinalMain -Options @{ Action = 'Start'; NoPause = $true; SessionDirectory = $session } | Should -Be 1
        Get-Content -LiteralPath (Join-Path $session 'bootstrap-error.log') -Raw | Should -Match 'Fixture original workflow failure'
        Should -Invoke Write-Host -Times 1 -Exactly -ParameterFilter { $Object -like '*fallo original*' }
    }

    It 'does not create an error summary when the operation succeeds or requires a restart' {
        $session = Join-Path $TestDrive 'successful operation'
        Invoke-AntojitFinalMain -Options @{ Action = 'Start'; NoPause = $true; SessionDirectory = $session } | Should -Be 0
        Test-Path -LiteralPath (Join-Path $session 'error-resumen.txt') | Should -BeFalse
        Mock Invoke-AntojitWorkflow {
            $failure = New-Object InvalidOperationException('Fixture Windows restart required.')
            $failure.Data['RestartRequired'] = $true
            throw $failure
        }
        $session = Join-Path $TestDrive 'restart operation'
        Invoke-AntojitFinalMain -Options @{ Action = 'Install'; NoPause = $true; SessionDirectory = $session } | Should -Be 3010
        Test-Path -LiteralPath (Join-Path $session 'error-resumen.txt') | Should -BeFalse
    }

    It 'opens the latest failure report from Logs instead of the new session' {
        $root = Join-Path $TestDrive 'all sessions'
        $old = Join-Path $root 'previous failure'
        $latest = Join-Path $root 'latest failure'
        New-Item -ItemType Directory -Path $old, $latest -Force | Out-Null
        $oldReport = Join-Path $old 'error-resumen.txt'
        $latestReport = Join-Path $latest 'error-resumen.txt'
        Set-Content -LiteralPath $oldReport -Value 'Fixture older cause.'
        $latestText = 'Fixture latest build cause: conexi' + [char]0x00F3 + 'n.'
        [IO.File]::WriteAllText($latestReport, $latestText, (New-Object Text.UTF8Encoding($false)))
        [IO.File]::SetLastWriteTimeUtc($oldReport, [DateTime]::UtcNow.AddDays(-1))
        Mock Start-Process { }
        Invoke-AntojitFinalMain -Options @{ Action = 'Logs'; NoPause = $true; SessionDirectory = (Join-Path $root 'new logs session') } | Should -Be 0
        Should -Invoke Start-Process -Times 1 -Exactly -ParameterFilter {
            $FilePath -eq 'explorer.exe' -and $ArgumentList -eq ('/select,"{0}"' -f $latestReport)
        }
        Should -Invoke Write-Host -Times 1 -Exactly -ParameterFilter { $Object -eq $latestText }
        Should -Invoke Invoke-AntojitWorkflow -Times 0 -Exactly
    }

    It 'opens the logs folder when no previous error report exists' {
        $root = Join-Path $TestDrive 'sessions without failure'
        Mock Start-Process { }
        Invoke-AntojitFinalMain -Options @{ Action = 'Logs'; NoPause = $true; SessionDirectory = (Join-Path $root 'new logs session') } | Should -Be 0
        Should -Invoke Start-Process -Times 1 -Exactly -ParameterFilter {
            $FilePath -eq 'explorer.exe' -and $ArgumentList -eq ('"{0}"' -f $root)
        }
    }
}

Describe 'Windows double-click launcher' {
    It 'passes the extracted ZIP folder and returns the original result from <Launcher>' -ForEach @(
        @{ Launcher = 'ACTUALIZAR-APP.cmd'; Recovery = $false }
        @{ Launcher = 'RECUPERAR-ACTUALIZACION.cmd'; Recovery = $true }
    ) -Skip:($env:OS -ne 'Windows_NT') {
        $fixture = Join-Path $TestDrive 'ZIP extracted with spaces'
        New-Item -ItemType Directory -Path $fixture -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $script:FinalScriptPath) $Launcher) -Destination (Join-Path $fixture $Launcher)
        $child = @'
param([string]$Action, [string]$SourcePath, [string]$InstallPath, [switch]$NoPause, [switch]$ResumePending)
@{ Action = $Action; SourcePath = $SourcePath; InstallPath = $InstallPath; NoPause = [bool]$NoPause; ResumePending = [bool]$ResumePending } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'arguments.json')
exit 23
'@
        Set-Content -LiteralPath (Join-Path $fixture 'final_script.ps1') -Value $child -Encoding UTF8
        $install = Join-Path $TestDrive 'restaurant installation'
        $command = '""{0}" -InstallPath "{1}" <nul"' -f (Join-Path $fixture $Launcher), $install
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = Join-Path $env:SystemRoot 'System32/cmd.exe'
        $start.Arguments = '/d /s /c ' + $command
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $start
        try {
            $process.Start() | Should -BeTrue
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'The ZIP batch launcher did not finish.' }
            $process.WaitForExit()
            $stdout.GetAwaiter().GetResult() | Out-Host
            $stderr.GetAwaiter().GetResult() | Out-Host
            $process.ExitCode | Should -Be 23
        } finally { $process.Dispose() }
        $record = Get-Content -LiteralPath (Join-Path $fixture 'arguments.json') -Raw | ConvertFrom-Json
        $record.Action | Should -Be 'Update'
        [IO.Path]::GetFullPath($record.SourcePath).TrimEnd('\', '/') | Should -Be ([IO.Path]::GetFullPath($fixture).TrimEnd('\', '/'))
        $record.InstallPath | Should -Be $install
        $record.NoPause | Should -BeTrue
        $record.ResumePending | Should -Be $Recovery
    }

    It 'preserves arguments and a restart-required exit code after keeping the console open' -Skip:($env:OS -ne 'Windows_NT') {
        $fixture = Join-Path $TestDrive 'launcher with spaces'
        New-Item -ItemType Directory -Path $fixture -Force | Out-Null
        Copy-Item -LiteralPath $script:FinalLauncherPath -Destination (Join-Path $fixture 'final_script.cmd')
        $child = @'
param([string]$Action, [string]$InstallPath, [switch]$NoPause)
@{ Action = $Action; InstallPath = $InstallPath; NoPause = [bool]$NoPause } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'arguments.json')
exit 3010
'@
        Set-Content -LiteralPath (Join-Path $fixture 'final_script.ps1') -Value $child -Encoding UTF8
        $install = Join-Path $TestDrive 'restaurant installation'
        # Redirect pause input so CI can exercise the real batch launcher safely.
        $command = '""{0}" -Action Start -InstallPath "{1}" <nul"' -f (Join-Path $fixture 'final_script.cmd'), $install
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $start.Arguments = '/d /s /c ' + $command
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $start
        try {
            $process.Start() | Should -BeTrue
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(30000)) {
                $process.Kill()
                throw 'The batch launcher did not finish after pause input was redirected.'
            }
            $process.WaitForExit()
            $stdout.GetAwaiter().GetResult() | Out-Host
            $stderr.GetAwaiter().GetResult() | Out-Host
            $process.ExitCode | Should -Be 3010
        } finally { $process.Dispose() }
        $record = Get-Content -LiteralPath (Join-Path $fixture 'arguments.json') -Raw | ConvertFrom-Json
        $record.Action | Should -Be 'Start'
        $record.InstallPath | Should -Be $install
        $record.NoPause | Should -BeTrue
    }
}
