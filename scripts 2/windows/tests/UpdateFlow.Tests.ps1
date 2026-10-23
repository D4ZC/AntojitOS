#requires -Version 5.1

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1') -Force
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
