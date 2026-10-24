#requires -Version 5.1

BeforeDiscovery {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Dependencies.psm1')
}

Describe 'WSL preparation on Windows 10 and Windows 11' {
    InModuleScope AntojitOS.Dependencies {
        BeforeAll {
            # PowerShell on macOS does not ship these Windows-only cmdlets.
            $script:WslTestStubs = @()
            if (-not (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)) {
                function script:Get-CimInstance {
                    [CmdletBinding()]
                    param([string]$ClassName)
                    throw 'CIM must be mocked in WSL tests.'
                }
                $script:WslTestStubs += 'Get-CimInstance'
            }
            if (-not (Get-Command Get-WindowsOptionalFeature -ErrorAction SilentlyContinue)) {
                function script:Get-WindowsOptionalFeature {
                    [CmdletBinding()]
                    param([switch]$Online, [string]$FeatureName)
                    throw 'Windows features must be mocked in WSL tests.'
                }
                $script:WslTestStubs += 'Get-WindowsOptionalFeature'
            }
            if (-not (Get-Command Enable-WindowsOptionalFeature -ErrorAction SilentlyContinue)) {
                function script:Enable-WindowsOptionalFeature {
                    [CmdletBinding()]
                    param([switch]$Online, [string]$FeatureName, [switch]$All, [switch]$NoRestart)
                    throw 'Windows feature changes must be mocked in WSL tests.'
                }
                $script:WslTestStubs += 'Enable-WindowsOptionalFeature'
            }
        }

        AfterAll {
            foreach ($stub in $script:WslTestStubs) {
                Remove-Item -LiteralPath ('Function:\script:' + $stub) -ErrorAction SilentlyContinue
            }
            Remove-Variable WslTestStubs -Scope Script -ErrorAction SilentlyContinue
        }

        BeforeEach {
            $script:WslTestOriginalSystemRoot = $env:SystemRoot
            $env:SystemRoot = $TestDrive
            $script:WslTestVersionChecks = 0
            $script:WslTestInbox = $false
            $script:WslTestInstallExitCode = 0
            $script:WslTestFinalVersionExitCode = 0
            $script:WslTestDefaultVersion = [pscustomobject]@{ DefaultVersion = 2 }
            Mock Write-AntojitDiagnostic { }
            Mock Get-CimInstance {
                param($ClassName)
                if ($ClassName -eq 'Win32_ComputerSystem') { return [pscustomobject]@{ HypervisorPresent = $true } }
                if ($ClassName -eq 'Win32_Processor') { return [pscustomobject]@{ VirtualizationFirmwareEnabled = $true } }
                throw 'Unexpected CIM query.'
            }
            Mock Get-WindowsOptionalFeature { [pscustomobject]@{ State = 'Enabled' } }
            Mock Enable-WindowsOptionalFeature { throw 'Enabled features must not be changed.' }
            Mock Get-AntojitExecutableCandidates { @('C:\Windows\System32\wsl.exe') }
            Mock Get-ItemProperty { $script:WslTestDefaultVersion } -ParameterFilter {
                $LiteralPath -eq 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -and $Name -eq 'DefaultVersion'
            }
            Mock Invoke-AntojitNative {
                param($FilePath, $Arguments, [int[]]$AllowedExitCodes = @(0), [switch]$AllowNonZeroExit)
                $code = 0
                switch ($Arguments[0]) {
                    '--version' {
                        $script:WslTestVersionChecks++
                        if ($script:WslTestInbox -and $script:WslTestVersionChecks -eq 1) { $code = 1 }
                        elseif ($script:WslTestVersionChecks -gt 1) { $code = $script:WslTestFinalVersionExitCode }
                    }
                    '--install' { $code = $script:WslTestInstallExitCode }
                    '--set-default-version' { }
                    default { throw ('Unexpected WSL command: ' + ($Arguments -join ' ')) }
                }
                if (-not $AllowNonZeroExit -and $AllowedExitCodes -notcontains $code) {
                    throw ('Fixture WSL command failed: ' + ($Arguments -join ' '))
                }
                [pscustomobject]@{ ExitCode = $code; StdOut = 'WSL version: 2.6.1'; StdErr = '' }
            }
        }

        AfterEach {
            $env:SystemRoot = $script:WslTestOriginalSystemRoot
        }

        It 'reuses an available WSL runtime without installing or changing its default version' {
            Initialize-AntojitWsl

            Should -Invoke Get-WindowsOptionalFeature -Times 2 -Exactly
            Should -Invoke Enable-WindowsOptionalFeature -Times 0 -Exactly
            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter {
                $FilePath -eq 'C:\Windows\System32\wsl.exe' -and ($Arguments -join ' ') -eq '--version'
            }
            Should -Invoke Invoke-AntojitNative -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq '--install' }
            Should -Invoke Invoke-AntojitNative -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq '--set-default-version' }
        }

        It 'installs the modern runtime for inbox WSL without downloading Ubuntu and verifies it again' {
            $script:WslTestInbox = $true

            Initialize-AntojitWsl

            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter {
                ($Arguments -join ' ') -eq '--install --no-distribution --web-download' -and
                ($AllowedExitCodes -join ',') -eq '0,3010,1641'
            }
            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter {
                ($Arguments -join ' ') -eq '--version' -and $AllowNonZeroExit
            }
            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter {
                ($Arguments -join ' ') -eq '--version' -and -not $AllowNonZeroExit
            }
            $script:WslTestVersionChecks | Should -Be 2
        }

        It 'sets WSL 2 as default when the registry has <Case>' -TestCases @(
            @{ Case = 'no default'; Default = $null },
            @{ Case = 'WSL 1'; Default = 1 }
        ) {
            param($Case, $Default)
            $script:WslTestDefaultVersion = if ($null -eq $Default) { $null } else { [pscustomobject]@{ DefaultVersion = $Default } }

            Initialize-AntojitWsl

            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter {
                ($Arguments -join ' ') -eq '--set-default-version 2' -and ($AllowedExitCodes -join ',') -eq '0,3010,1641'
            }
        }

        It 'stops before touching Windows features when firmware virtualization is disabled' {
            Mock Get-CimInstance {
                param($ClassName)
                if ($ClassName -eq 'Win32_ComputerSystem') { return [pscustomobject]@{ HypervisorPresent = $false } }
                [pscustomobject]@{ VirtualizationFirmwareEnabled = $false }
            }

            { Initialize-AntojitWsl } | Should -Throw '*virtualizacion de hardware*'

            Should -Invoke Get-WindowsOptionalFeature -Times 0 -Exactly
            Should -Invoke Invoke-AntojitNative -Times 0 -Exactly
        }

        It 'checks processor virtualization when Windows has no active hypervisor' {
            Mock Get-CimInstance {
                param($ClassName)
                if ($ClassName -eq 'Win32_ComputerSystem') { return [pscustomobject]@{ HypervisorPresent = $false } }
                [pscustomobject]@{ VirtualizationFirmwareEnabled = $true }
            }

            Initialize-AntojitWsl

            Should -Invoke Get-CimInstance -Times 1 -Exactly -ParameterFilter { $ClassName -eq 'Win32_Processor' }
            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly
        }

        It 'returns a resumable restart for a feature in <State> without invoking WSL' -TestCases @(
            @{ State = 'EnablePending' },
            @{ State = 'DisablePending' }
        ) {
            param($State)
            Mock Get-WindowsOptionalFeature { [pscustomobject]@{ State = $State } }
            $failure = $null

            try { Initialize-AntojitWsl } catch { $failure = $_ }

            $failure | Should -Not -BeNullOrEmpty
            $failure.Exception.Data['RestartRequired'] | Should -BeTrue
            Should -Invoke Enable-WindowsOptionalFeature -Times 0 -Exactly
            Should -Invoke Get-AntojitExecutableCandidates -Times 0 -Exactly
            Should -Invoke Invoke-AntojitNative -Times 0 -Exactly
        }

        It 'enables missing features without restarting automatically and stops for the required restart' {
            Mock Get-WindowsOptionalFeature { [pscustomobject]@{ State = 'Disabled' } }
            Mock Enable-WindowsOptionalFeature { [pscustomobject]@{ RestartNeeded = $true } }
            $failure = $null

            try { Initialize-AntojitWsl } catch { $failure = $_ }

            $failure | Should -Not -BeNullOrEmpty
            $failure.Exception.Data['RestartRequired'] | Should -BeTrue
            Should -Invoke Enable-WindowsOptionalFeature -Times 1 -Exactly -ParameterFilter {
                $FeatureName -eq 'Microsoft-Windows-Subsystem-Linux' -and $Online -and $All -and $NoRestart
            }
            Should -Invoke Enable-WindowsOptionalFeature -Times 1 -Exactly -ParameterFilter {
                $FeatureName -eq 'VirtualMachinePlatform' -and $Online -and $All -and $NoRestart
            }
            Should -Invoke Invoke-AntojitNative -Times 0 -Exactly
        }

        It 'reports a missing wsl executable before running any native command' {
            Mock Get-AntojitExecutableCandidates { @() }

            { Initialize-AntojitWsl } | Should -Throw '*No se encontro wsl.exe*'

            Should -Invoke Invoke-AntojitNative -Times 0 -Exactly
        }

        It 'stops for restart exit code <Code> from runtime installation without further WSL commands' -TestCases @(
            @{ Code = 3010 },
            @{ Code = 1641 }
        ) {
            param($Code)
            $script:WslTestInbox = $true
            $script:WslTestInstallExitCode = $Code
            $failure = $null

            try { Initialize-AntojitWsl } catch { $failure = $_ }

            $failure | Should -Not -BeNullOrEmpty
            $failure.Exception.Data['RestartRequired'] | Should -BeTrue
            Should -Invoke Invoke-AntojitNative -Times 2 -Exactly
            $script:WslTestVersionChecks | Should -Be 1
            Should -Invoke Get-ItemProperty -Times 0 -Exactly
        }

        It 'fails when a successful installation still cannot report a runtime version' {
            $script:WslTestInbox = $true
            $script:WslTestFinalVersionExitCode = 1

            { Initialize-AntojitWsl } | Should -Throw '*Fixture WSL command failed: --version*'

            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq '--install' }
            $script:WslTestVersionChecks | Should -Be 2
            Should -Invoke Get-ItemProperty -Times 0 -Exactly
        }
    }
}
