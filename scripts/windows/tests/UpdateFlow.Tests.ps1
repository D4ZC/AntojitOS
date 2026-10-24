#requires -Version 5.1

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1') -Force
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Printing.psm1') -Force
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Update.psm1') -Force
}

Describe 'Update maintenance and data preservation' {
    BeforeEach {
        $root = Join-Path $TestDrive 'restaurant'
        $state = Join-Path $root 'var\windows'
        New-Item -ItemType Directory -Path $state -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $root '.env.pilot') -Value 'DATABASE_PASSWORD=keep-this-value'
        $ownerSid = if ($env:OS -eq 'Windows_NT') {
            [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        } else { 'S-1-5-21-1-2-3-1000' }
        $global:AntojitUpdateTestInstallation = [pscustomobject]@{
            Root = $root
            StateDirectory = $state
            RepositoryUrl = 'https://github.com/restaurant/AntojitOS.git'
            Branch = 'main'
            SourceMode = 'git'
            OwnerSid = $ownerSid
        }
        $global:AntojitUpdateTestLease = New-Object IO.MemoryStream
        $global:AntojitUpdateTestDirty = ''
        $global:AntojitUpdateTestCurrent = 'a' * 40
        $global:AntojitUpdateTestCandidate = 'b' * 40
        Mock Import-Module { }
        Mock Assert-AntojitWindows { }
        Mock Assert-AntojitAdministrator { }
        Mock Assert-AntojitOwner { }
        Mock Start-AntojitLog { }
        Mock Write-AntojitLog { }
        Mock Get-AntojitInstallation { $global:AntojitUpdateTestInstallation }
        Mock Enter-AntojitOperation { $global:AntojitUpdateTestLease }
        Mock Get-AntojitGit { 'git.exe' }
        Mock Save-AntojitInstallation { }
        Mock Initialize-AntojitRuntime { }
        Mock Update-AntojitNetwork { }
        Mock Invoke-AntojitCompose { throw 'No container mutation expected in this scenario.' }
        Mock Invoke-AntojitPilot { throw 'No pilot command expected in this scenario.' }
        Mock Invoke-AntojitCommand {
            param($FilePath, $Arguments)
            $git = @($Arguments | Select-Object -Skip 4)
            switch ($git -join '|') {
                'rev-parse|--show-toplevel' { return $global:AntojitUpdateTestInstallation.Root }
                'status|--porcelain=v1|--untracked-files=all' { return $global:AntojitUpdateTestDirty }
                'branch|--show-current' { return 'main' }
                'rev-parse|--verify|HEAD' { return $global:AntojitUpdateTestCurrent }
                'check-ref-format|--branch|main' { return }
                'rev-parse|--verify|refs/antojitos-update/candidate^{commit}' { return $global:AntojitUpdateTestCandidate }
            }
            switch ($git[0]) {
                'fetch' { return }
                'ls-tree' { return }
                'rev-list' { return '0' }
                'merge' { return }
                default { throw "Unexpected Git operation: $($git -join ' ')" }
            }
        }
    }

    AfterEach {
        $global:AntojitUpdateTestLease.Dispose()
        Remove-Variable AntojitUpdateTestInstallation, AntojitUpdateTestLease, AntojitUpdateTestDirty,
            AntojitUpdateTestCurrent, AntojitUpdateTestCandidate -Scope Global -ErrorAction SilentlyContinue
    }

    It 'delegates a ZIP folder update before consulting Git or taking a second lock' {
        Mock Invoke-AntojitFolderUpdate { }
        $source = Join-Path $TestDrive 'fresh extracted ZIP'
        & (Join-Path $PSScriptRoot '../03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root -SourcePath $source -PrinterQueue 'USB Caja' -ConfirmMaintenance -Managed
        Should -Invoke Invoke-AntojitFolderUpdate -Times 1 -Exactly -ParameterFilter {
            $SourcePath -eq $source -and $InstallPath -eq $global:AntojitUpdateTestInstallation.Root -and $ConfirmMaintenance -and $PrinterQueue -eq 'USB Caja'
        }
        Should -Invoke Get-AntojitGit -Times 0 -Exactly
        Should -Invoke Enter-AntojitOperation -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly
    }

    It 'does not hide a managed ZIP updater error behind the Git path' {
        Mock Invoke-AntojitFolderUpdate { throw 'Fixture local ZIP manifest mismatch.' }
        { & (Join-Path $PSScriptRoot '../03-actualizar.ps1') -SourcePath (Join-Path $TestDrive 'fresh ZIP') -Managed } |
            Should -Throw '*Fixture local ZIP manifest mismatch*'
        Should -Invoke Get-AntojitGit -Times 0 -Exactly
        Should -Invoke Enter-AntojitOperation -Times 0 -Exactly
    }

    It 'passes explicit pending recovery and its helper ZIP to the folder updater without consulting Git' {
        Mock Invoke-AntojitFolderUpdate { }
        $source = Join-Path $TestDrive 'new ZIP recovery helpers'
        & (Join-Path $PSScriptRoot '../03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root -SourcePath $source -ResumePending -ConfirmMaintenance -Managed
        Should -Invoke Invoke-AntojitFolderUpdate -Times 1 -Exactly -ParameterFilter {
            $SourcePath -eq $source -and $InstallPath -eq $global:AntojitUpdateTestInstallation.Root -and $ResumePending -and $ConfirmMaintenance
        }
        Should -Invoke Get-AntojitGit -Times 0 -Exactly
        Should -Invoke Enter-AntojitOperation -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly
    }

    It 'rejects pending recovery without its helper ZIP before entering the Git update path' {
        Mock Invoke-AntojitFolderUpdate { }
        { & (Join-Path $PSScriptRoot '../03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root -ResumePending -ConfirmMaintenance -Managed } |
            Should -Throw '*RECUPERAR-ACTUALIZACION.cmd*'
        Should -Invoke Invoke-AntojitFolderUpdate -Times 0 -Exactly
        Should -Invoke Get-AntojitGit -Times 0 -Exactly
        Should -Invoke Enter-AntojitOperation -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly
    }

    It 'rejects Git updates for an installation maintained from a ZIP folder' {
        $global:AntojitUpdateTestInstallation.SourceMode = 'folder'
        & (Join-Path $PSScriptRoot '../03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root -ConfirmMaintenance 2>$null
        $LASTEXITCODE | Should -Be 1
        Should -Invoke Get-AntojitGit -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly
    }

    It 'leaves services running when GitHub has no newer commit' {
        $global:AntojitUpdateTestCandidate = $global:AntojitUpdateTestCurrent
        & (Join-Path $PSScriptRoot '..\03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root 2>$null
        $LASTEXITCODE | Should -Be 0
        Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly
        Should -Invoke Invoke-AntojitPilot -Times 0 -Exactly
        Should -Invoke Initialize-AntojitRuntime -Times 0 -Exactly
        $global:AntojitUpdateTestLease.CanWrite | Should -BeFalse
    }

    It 'rejects local changes before fetching or stopping the application' {
        $global:AntojitUpdateTestDirty = ' M apps/api/src/main.ts'
        & (Join-Path $PSScriptRoot '..\03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root -ConfirmMaintenance 2>$null
        $LASTEXITCODE | Should -Be 1
        Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter { $Arguments[4] -eq 'fetch' }
        Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly
        Should -Invoke Invoke-AntojitPilot -Times 0 -Exactly
    }

    It 'requires a maintenance window before changing code or services' {
        & (Join-Path $PSScriptRoot '..\03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root 2>$null
        $LASTEXITCODE | Should -Be 1
        Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter { $Arguments[4] -eq 'merge' -or $Arguments[4] -eq 'checkout' }
        Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly
        Should -Invoke Initialize-AntojitRuntime -Times 0 -Exactly
        Test-Path -LiteralPath (Join-Path $global:AntojitUpdateTestInstallation.StateDirectory 'update-pending.json') | Should -BeFalse
    }

    It 'restores simulator configuration when first-time USB activation fails before migrations' -Skip:($env:OS -ne 'Windows_NT') {
        $pilotPath = Join-Path $global:AntojitUpdateTestInstallation.Root '.env.pilot'
        $nativePath = Join-Path $global:AntojitUpdateTestInstallation.Root '.env.print-agent'
        $before = [IO.File]::ReadAllText($pilotPath)
        Mock Invoke-AntojitCompose { }
        Mock Get-AntojitPrintConfiguration {
            $mode = if (Test-Path -LiteralPath (Join-Path $global:AntojitUpdateTestInstallation.Root '.env.print-agent')) { 'native' } else { 'container' }
            [pscustomobject]@{ Mode = $mode; ActivePath = (Join-Path $global:AntojitUpdateTestInstallation.StateDirectory 'print-agent/active.json') }
        }
        Mock Initialize-AntojitPrintConfiguration {
            [IO.File]::AppendAllText((Join-Path $global:AntojitUpdateTestInstallation.Root '.env.pilot'), "`nPRINT_AGENT_RUNTIME=native`n")
            [IO.File]::WriteAllText((Join-Path $global:AntojitUpdateTestInstallation.Root '.env.print-agent'), 'PRINT_AGENT_MODE=system')
            Get-AntojitPrintConfiguration -Installation $global:AntojitUpdateTestInstallation
        }
        Mock Assert-AntojitNativePrintConfiguration { }
        Mock Prepare-AntojitNativePrintAgent { 'prepared-native-runtime' }
        Mock Stop-AntojitNativePrintAgent { }
        Mock Start-AntojitNativePrintAgent { throw 'A new USB runtime must not start against the previous API.' }
        Mock Invoke-AntojitPilot {
            param($Root, $Command)
            if ($Command -eq 'backup') { throw 'Fixture backup failed before migrations.' }
            if ($Command -ne 'verify') { throw "Unexpected pilot command: $Command" }
        }
        & (Join-Path $PSScriptRoot '../03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root -PrinterQueue 'USB Caja' -ConfirmMaintenance 2>$null
        $LASTEXITCODE | Should -Be 1
        [IO.File]::ReadAllText($pilotPath) | Should -BeExactly $before
        Test-Path -LiteralPath $nativePath | Should -BeFalse
        Should -Invoke Start-AntojitNativePrintAgent -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' -and $Arguments -contains 'print-agent' }
        Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'up' }
    }

    It 'restarts the previous containers when backup fails and retains recovery state' -Skip:($env:OS -ne 'Windows_NT') {
        # This scenario also exercises the real Windows ACL on TestDrive only.
        Mock Invoke-AntojitCompose { }
        Mock Invoke-AntojitPilot {
            param($Root, $Command)
            if ($Command -eq 'backup') { throw 'The database backup failed.' }
            if ($Command -ne 'verify') { throw "Unexpected pilot command: $Command" }
        }
        & (Join-Path $PSScriptRoot '..\03-actualizar.ps1') -InstallPath $global:AntojitUpdateTestInstallation.Root -ConfirmMaintenance 2>$null
        $LASTEXITCODE | Should -Be 1
        Should -Invoke Invoke-AntojitCompose -Times 1 -ParameterFilter { $Arguments[0] -eq 'build' }
        Should -Invoke Invoke-AntojitCompose -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'stop' }
        Should -Invoke Invoke-AntojitCompose -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' }
        Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'up' }
        $pending = Get-Content -LiteralPath (Join-Path $global:AntojitUpdateTestInstallation.StateDirectory 'update-pending.json') -Raw | ConvertFrom-Json
        $pending.Stage | Should -Be 'backing-up'
        $pending.TargetCommit | Should -Be $global:AntojitUpdateTestCandidate
        Get-Content -LiteralPath (Join-Path $global:AntojitUpdateTestInstallation.Root '.env.pilot') -Raw | Should -Match 'DATABASE_PASSWORD=keep-this-value'
        Get-Content -LiteralPath (Join-Path $pending.LatestBackupDirectory '.env.pilot') -Raw | Should -Match 'DATABASE_PASSWORD=keep-this-value'
    }
}
