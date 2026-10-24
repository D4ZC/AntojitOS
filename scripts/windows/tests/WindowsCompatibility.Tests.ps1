#requires -Version 5.1

BeforeDiscovery {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Dependencies.psm1')
}

Describe 'Windows desktop compatibility' {
    InModuleScope AntojitOS.Dependencies {
        BeforeAll {
            # The CIM cmdlet is Windows-only; provide a mockable local command on other test hosts.
            $script:AntojitCompatibilityAddedCimStub = -not [bool](Get-Command Get-CimInstance -ErrorAction SilentlyContinue)
            if ($script:AntojitCompatibilityAddedCimStub) {
                function script:Get-CimInstance {
                    [CmdletBinding()]
                    param([string]$ClassName)
                    throw 'Get-CimInstance must be mocked in compatibility tests.'
                }
            }
        }

        AfterAll {
            if ($script:AntojitCompatibilityAddedCimStub) {
                Remove-Item -LiteralPath Function:\Get-CimInstance
            }
            Remove-Variable -Name AntojitCompatibilityAddedCimStub -Scope Script
        }

        BeforeEach {
            $script:AntojitCompatibilityOriginalEnvironment = @{
                OS = $env:OS
                PROCESSOR_ARCHITECTURE = $env:PROCESSOR_ARCHITECTURE
                PROCESSOR_ARCHITEW6432 = $env:PROCESSOR_ARCHITEW6432
            }
            $env:OS = 'Windows_NT'
            $env:PROCESSOR_ARCHITECTURE = 'AMD64'
            Remove-Item Env:\PROCESSOR_ARCHITEW6432 -ErrorAction SilentlyContinue
            Mock Get-ItemProperty { [pscustomobject]@{ CurrentBuildNumber = '19045' } }
            Mock Get-CimInstance { [pscustomobject]@{ ProductType = 1 } }
            Mock Write-AntojitDiagnostic { }
        }

        AfterEach {
            foreach ($name in $script:AntojitCompatibilityOriginalEnvironment.Keys) {
                $value = $script:AntojitCompatibilityOriginalEnvironment[$name]
                if ($null -eq $value) { Remove-Item -LiteralPath "Env:\$name" -ErrorAction SilentlyContinue }
                else { Set-Item -LiteralPath "Env:\$name" -Value $value }
            }
        }

        It 'reads the Windows build as an integer from the registry' {
            $build = Get-AntojitWindowsBuild

            $build | Should -BeOfType ([int])
            $build | Should -Be 19045
            Should -Invoke Get-ItemProperty -Times 1 -Exactly -ParameterFilter {
                $LiteralPath -eq 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
            }
        }

        It 'accepts <Name> on a 64-bit desktop' -TestCases @(
            @{ Name = 'Windows 10 22H2'; Build = 19045 },
            @{ Name = 'Windows 11'; Build = 22000 },
            @{ Name = 'a newer Windows 11 build'; Build = 26100 }
        ) {
            param($Name, $Build)
            Mock Get-ItemProperty { [pscustomobject]@{ CurrentBuildNumber = [string]$Build } }

            { Assert-AntojitWindows } | Should -Not -Throw
            Should -Invoke Get-CimInstance -Times 1 -Exactly -ParameterFilter { $ClassName -eq 'Win32_OperatingSystem' }
        }

        It 'rejects a host that is not Windows before inspecting its registry' {
            $env:OS = 'Other'

            { Assert-AntojitWindows } | Should -Throw '*Windows*'
            Should -Invoke Get-ItemProperty -Times 0 -Exactly
            Should -Invoke Get-CimInstance -Times 0 -Exactly
        }

        It 'rejects unsupported <Name> architecture' -TestCases @(
            @{ Name = '32-bit x86'; Architecture = 'x86'; NativeArchitecture = $null },
            @{ Name = 'ARM64'; Architecture = 'ARM64'; NativeArchitecture = $null },
            @{ Name = 'an emulated x64 process on ARM64'; Architecture = 'AMD64'; NativeArchitecture = 'ARM64' }
        ) {
            param($Name, $Architecture, $NativeArchitecture)
            $env:PROCESSOR_ARCHITECTURE = $Architecture
            if ($null -ne $NativeArchitecture) { $env:PROCESSOR_ARCHITEW6432 = $NativeArchitecture }

            { Assert-AntojitWindows } | Should -Throw '*x64*'
            Should -Invoke Get-ItemProperty -Times 0 -Exactly
        }

        It 'rejects an older Windows build <Build>' -TestCases @(
            @{ Build = 19044 },
            @{ Build = 17763 }
        ) {
            param($Build)
            Mock Get-ItemProperty { [pscustomobject]@{ CurrentBuildNumber = [string]$Build } }

            { Assert-AntojitWindows } | Should -Throw '*19045*'
            Should -Invoke Get-CimInstance -Times 0 -Exactly
        }

        It 'rejects Windows Server product type <ProductType>' -TestCases @(
            @{ ProductType = 2 },
            @{ ProductType = 3 }
        ) {
            param($ProductType)
            Mock Get-CimInstance { [pscustomobject]@{ ProductType = $ProductType } }

            { Assert-AntojitWindows } | Should -Throw '*Windows Server*'
        }
    }
}

Describe 'Podman release selection for Windows' {
    InModuleScope AntojitOS.Dependencies {
        BeforeEach {
            Mock Write-AntojitDiagnostic { }
        }

        It 'pins Windows 10 to the official Podman 5.8.9 release without querying latest' {
            Mock Get-AntojitWindowsBuild { 19045 }
            Mock Invoke-RestMethod { [pscustomobject]@{ tag_name = 'v5.8.9'; assets = @() } }
            Mock Get-AntojitLatestRelease { throw 'Windows 10 must not select the latest Podman release.' }

            $release = Get-AntojitPodmanRelease

            $release.tag_name | Should -Be 'v5.8.9'
            Should -Invoke Invoke-RestMethod -Times 1 -Exactly -ParameterFilter {
                $Uri -eq 'https://api.github.com/repos/podman-container-tools/podman/releases/tags/v5.8.9'
            }
            Should -Invoke Get-AntojitLatestRelease -Times 0 -Exactly
        }

        It 'rejects an unexpected release tag instead of changing the Windows 10 pin' {
            Mock Get-AntojitWindowsBuild { 19045 }
            Mock Invoke-RestMethod { [pscustomobject]@{ tag_name = 'v6.1.4'; assets = @() } }
            Mock Get-AntojitLatestRelease { throw 'Windows 10 must not select the latest Podman release.' }

            { Get-AntojitPodmanRelease } | Should -Throw '*v5.8.9*'
            Should -Invoke Get-AntojitLatestRelease -Times 0 -Exactly
        }

        It 'selects latest Podman on Windows 11 build <Build>' -TestCases @(
            @{ Build = 22000 },
            @{ Build = 26100 }
        ) {
            param($Build)
            Mock Get-AntojitWindowsBuild { $Build }
            Mock Get-AntojitLatestRelease { [pscustomobject]@{ tag_name = 'v6.1.4'; assets = @() } }
            Mock Invoke-RestMethod { throw 'The pinned Windows 10 release must not be queried on Windows 11.' }

            $release = Get-AntojitPodmanRelease

            $release.tag_name | Should -Be 'v6.1.4'
            Should -Invoke Get-AntojitLatestRelease -Times 1 -Exactly -ParameterFilter { $Repository -eq 'podman-container-tools/podman' }
            Should -Invoke Invoke-RestMethod -Times 0 -Exactly
        }
    }
}

Describe 'Installed Podman compatibility' {
    InModuleScope AntojitOS.Dependencies {
        BeforeEach {
            $script:AntojitCompatibilityPodmanOriginalOs = $env:OS
            $env:OS = 'Windows_NT'
            Mock Get-AntojitWindowsBuild { 19045 }
            Mock Get-AntojitExecutableCandidates { @('C:\Podman\podman.exe') }
            Mock Write-AntojitDiagnostic { }
            Mock Save-AntojitDownload { throw 'Detection must not download an installer.' }
            Mock Invoke-AntojitInstaller { throw 'Detection must not replace installed Podman.' }
        }

        AfterEach {
            if ($null -eq $script:AntojitCompatibilityPodmanOriginalOs) { Remove-Item Env:\OS -ErrorAction SilentlyContinue }
            else { $env:OS = $script:AntojitCompatibilityPodmanOriginalOs }
        }

        It 'reuses Podman 5 on Windows 10 after checking its version' {
            Mock Invoke-AntojitNative { [pscustomobject]@{ ExitCode = 0; StdOut = 'podman version 5.8.9'; StdErr = '' } }

            Get-AntojitPodman | Should -Be 'C:\Podman\podman.exe'

            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter {
                $FilePath -eq 'C:\Podman\podman.exe' -and @($Arguments).Count -eq 1 -and $Arguments[0] -eq '--version'
            }
            Should -Invoke Save-AntojitDownload -Times 0 -Exactly
            Should -Invoke Invoke-AntojitInstaller -Times 0 -Exactly
        }

        It 'explicitly rejects Podman <Version> on Windows 10 without replacing it' -TestCases @(
            @{ Version = '6.0.0' },
            @{ Version = '7.1.2' }
        ) {
            param($Version)
            Mock Invoke-AntojitNative { [pscustomobject]@{ ExitCode = 0; StdOut = "podman version $Version"; StdErr = '' } }

            { Get-AntojitPodman } | Should -Throw '*Windows 10*'

            Should -Invoke Save-AntojitDownload -Times 0 -Exactly
            Should -Invoke Invoke-AntojitInstaller -Times 0 -Exactly
        }

        It 'reuses Podman 6 on Windows 11' {
            Mock Get-AntojitWindowsBuild { 22000 }
            Mock Invoke-AntojitNative { [pscustomobject]@{ ExitCode = 0; StdOut = 'podman version 6.1.4'; StdErr = '' } }

            Get-AntojitPodman | Should -Be 'C:\Podman\podman.exe'
        }

        It 'ignores an executable that does not return a Podman version' {
            Mock Invoke-AntojitNative { [pscustomobject]@{ ExitCode = 0; StdOut = 'unrelated executable'; StdErr = '' } }

            Get-AntojitPodman | Should -BeNullOrEmpty
        }
    }
}

Describe 'Windows 10 dependency installation' {
    InModuleScope AntojitOS.Dependencies {
        BeforeEach {
            $script:AntojitCompatibilityOriginalLog = $env:ANTOJITOS_LOG_PATH
            $script:AntojitCompatibilityOriginalSystemRoot = $env:SystemRoot
            $env:ANTOJITOS_LOG_PATH = Join-Path $TestDrive 'dependencies.log'
            $env:SystemRoot = Join-Path $TestDrive 'Windows'
            Mock Assert-AntojitWindows { }
            Mock Assert-AntojitAdministrator { }
            Mock Update-AntojitPath { }
            Mock Initialize-AntojitWsl { }
            Mock Write-AntojitDiagnostic { }
            Mock Get-AntojitWindowsBuild { 19045 }
            Mock Get-AntojitNode { 'C:\Node\node.exe' }
            Mock Get-AntojitGit { 'C:\Git\git.exe' }
            Mock Get-AntojitLatestRelease { throw 'Windows 10 must not query latest to install Podman.' }
            Mock Save-AntojitDownload { }
            Mock Assert-AntojitReleaseDigest { }
            Mock Assert-AntojitAuthenticode { }
            Mock Invoke-AntojitInstaller { }
            Mock Invoke-AntojitNative {
                [pscustomobject]@{ ExitCode = 0; StdOut = 'Docker Compose version v2.39.4'; StdErr = '' }
            }
        }

        AfterEach {
            if ($null -eq $script:AntojitCompatibilityOriginalLog) { Remove-Item Env:\ANTOJITOS_LOG_PATH -ErrorAction SilentlyContinue }
            else { $env:ANTOJITOS_LOG_PATH = $script:AntojitCompatibilityOriginalLog }
            if ($null -eq $script:AntojitCompatibilityOriginalSystemRoot) { Remove-Item Env:\SystemRoot -ErrorAction SilentlyContinue }
            else { $env:SystemRoot = $script:AntojitCompatibilityOriginalSystemRoot }
        }

        It 'downloads and installs Podman 5.8.9 when it is missing' {
            $tools = Join-Path $TestDrive 'windows10-tools'
            New-Item -ItemType Directory -Path $tools -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $tools 'docker-compose.exe') -Value 'fixture'
            $script:AntojitCompatibilityPodmanChecks = 0
            Mock Get-AntojitPodman {
                $script:AntojitCompatibilityPodmanChecks++
                if ($script:AntojitCompatibilityPodmanChecks -gt 1) { 'C:\Podman\podman.exe' }
            }
            Mock Invoke-RestMethod {
                [pscustomobject]@{
                    tag_name = 'v5.8.9'
                    assets = @([pscustomobject]@{
                        name = 'podman-installer-windows-amd64.msi'
                        browser_download_url = 'https://github.com/podman-container-tools/podman/releases/download/v5.8.9/podman-installer-windows-amd64.msi'
                    })
                }
            }

            $result = Install-AntojitDependencies -ToolsDirectory $tools

            $result.PodmanPath | Should -Be 'C:\Podman\podman.exe'
            Should -Invoke Invoke-RestMethod -Times 1 -Exactly -ParameterFilter {
                $Uri -eq 'https://api.github.com/repos/podman-container-tools/podman/releases/tags/v5.8.9'
            }
            Should -Invoke Get-AntojitLatestRelease -Times 0 -Exactly
            Should -Invoke Save-AntojitDownload -Times 1 -Exactly -ParameterFilter {
                $Uri -eq 'https://github.com/podman-container-tools/podman/releases/download/v5.8.9/podman-installer-windows-amd64.msi'
            }
            Should -Invoke Assert-AntojitAuthenticode -Times 1 -Exactly -ParameterFilter { $Publisher -eq 'Podman' }
            Should -Invoke Invoke-AntojitInstaller -Times 1 -Exactly -ParameterFilter {
                $DisplayName -eq 'Podman CLI' -and
                $FilePath -eq (Join-Path $env:SystemRoot 'System32\msiexec.exe') -and
                @($Arguments).Count -eq 4 -and
                $Arguments[0] -eq '/i' -and
                [IO.Path]::GetFileName($Arguments[1]) -eq 'podman-installer-windows-amd64.msi' -and
                $Arguments[2] -eq '/qn' -and
                $Arguments[3] -eq '/norestart' -and
                # Pester may expose the declared MSI default or omit its unbound value.
                ([string]::IsNullOrEmpty($LogStyle) -or $LogStyle -eq 'Msi')
            }
        }
    }
}
