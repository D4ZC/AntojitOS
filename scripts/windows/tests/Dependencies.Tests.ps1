#requires -Version 5.1

BeforeDiscovery {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Dependencies.psm1')
}

Describe 'Dependency detection and reuse' {
    InModuleScope AntojitOS.Dependencies {
        It 'skips an old Node installation and finds an already installed compatible version' {
            Mock Get-AntojitExecutableCandidates { @('C:\old\node.exe', 'C:\current\node.exe') }
            Mock Invoke-AntojitNative {
                param($FilePath)
                $version = if ($FilePath -eq 'C:\old\node.exe') { 'v22.20.0' } else { 'v24.10.0' }
                [pscustomobject]@{ ExitCode = 0; StdOut = $version; StdErr = '' }
            }
            Get-AntojitNode | Should -Be 'C:\current\node.exe'
            Should -Invoke Invoke-AntojitNative -Times 2 -Exactly
        }

        It 'reuses installed dependencies without downloading or executing installers' {
            $tools = Join-Path $TestDrive 'tools'
            New-Item -ItemType Directory -Path $tools -Force | Out-Null
            $compose = Join-Path $tools 'docker-compose.exe'
            Set-Content -LiteralPath $compose -Value 'fixture'
            Mock Assert-AntojitWindows { }
            Mock Assert-AntojitAdministrator { }
            Mock Update-AntojitPath { }
            Mock Initialize-AntojitWsl { }
            Mock Get-AntojitNode { 'C:\node\node.exe' }
            Mock Get-AntojitGit { 'C:\git\git.exe' }
            Mock Get-AntojitPodman { 'C:\podman\podman.exe' }
            Mock Invoke-AntojitNative {
                [pscustomobject]@{ ExitCode = 0; StdOut = 'Docker Compose version v2.39.4'; StdErr = '' }
            }
            Mock Save-AntojitDownload { throw 'A satisfied dependency must not be downloaded.' }
            Mock Get-AntojitLatestRelease { throw 'A satisfied dependency must not query a release.' }
            Mock Invoke-AntojitInstaller { throw 'A satisfied dependency must not run an installer.' }

            $result = Install-AntojitDependencies -ToolsDirectory $tools
            $result.ComposeProviderPath | Should -Be $compose
            $result.NodePath | Should -Be 'C:\node\node.exe'
            Should -Invoke Save-AntojitDownload -Times 0 -Exactly
            Should -Invoke Get-AntojitLatestRelease -Times 0 -Exactly
            Should -Invoke Invoke-AntojitInstaller -Times 0 -Exactly
        }

        It 'installs a missing Podman from its current official repository using the EXE fallback' {
            $tools = Join-Path $TestDrive 'podman-tools'
            New-Item -ItemType Directory -Path $tools -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $tools 'docker-compose.exe') -Value 'fixture'
            $script:AntojitTestPodmanChecks = 0
            Mock Assert-AntojitWindows { }
            Mock Assert-AntojitAdministrator { }
            Mock Update-AntojitPath { }
            Mock Initialize-AntojitWsl { }
            Mock Get-AntojitNode { 'C:\node\node.exe' }
            Mock Get-AntojitGit { 'C:\git\git.exe' }
            Mock Get-AntojitPodman {
                $script:AntojitTestPodmanChecks++
                if ($script:AntojitTestPodmanChecks -gt 1) { 'C:\podman\podman.exe' }
            }
            Mock Get-AntojitPodmanRelease {
                [pscustomobject]@{ assets = @([pscustomobject]@{
                    name = 'podman-5.6.2-setup.exe'
                    browser_download_url = 'https://github.com/podman-container-tools/podman/releases/download/v5.6.2/podman-5.6.2-setup.exe'
                }) }
            }
            Mock Save-AntojitDownload { }
            Mock Assert-AntojitReleaseDigest { }
            Mock Assert-AntojitAuthenticode { }
            Mock Invoke-AntojitInstaller { }
            Mock Invoke-AntojitNative {
                [pscustomobject]@{ ExitCode = 0; StdOut = 'Docker Compose version v2.39.4'; StdErr = '' }
            }

            $result = Install-AntojitDependencies -ToolsDirectory $tools
            $result.PodmanPath | Should -Be 'C:\podman\podman.exe'
            Should -Invoke Get-AntojitPodmanRelease -Times 1 -Exactly
            Should -Invoke Save-AntojitDownload -Times 1 -Exactly -ParameterFilter {
                $Uri -eq 'https://github.com/podman-container-tools/podman/releases/download/v5.6.2/podman-5.6.2-setup.exe'
            }
            Should -Invoke Invoke-AntojitInstaller -Times 1 -Exactly -ParameterFilter { $DisplayName -eq 'Podman CLI' }
        }
    }
}

Describe 'Dependency download validation' {
    InModuleScope AntojitOS.Dependencies {
        It 'queries the current official Podman repository without relying on a GitHub redirect' {
            Mock Invoke-RestMethod { [pscustomobject]@{ tag_name = 'v6.1.4'; assets = @() } }

            $release = Get-AntojitLatestRelease -Repository 'podman-container-tools/podman'
            $release.tag_name | Should -Be 'v6.1.4'
            Should -Invoke Invoke-RestMethod -Times 1 -Exactly -ParameterFilter {
                $Uri -eq 'https://api.github.com/repos/podman-container-tools/podman/releases/latest'
            }
        }

        It 'accepts the official <Repository> release asset' -TestCases @(
            @{
                Repository = 'podman-container-tools/podman'
                Name = 'podman-installer-windows-amd64.msi'
                NamePattern = '^podman-installer-windows-amd64\.msi$'
                Tag = 'v6.1.4'
            },
            @{
                Repository = 'git-for-windows/git'
                Name = 'Git-2.56.0-64-bit.exe'
                NamePattern = '^Git-[0-9].*-64-bit\.exe$'
                Tag = 'v2.56.0.windows.2'
            },
            @{
                Repository = 'docker/compose'
                Name = 'docker-compose-windows-x86_64.exe'
                NamePattern = '^docker-compose-windows-x86_64\.exe$'
                Tag = 'v2.39.4'
            }
        ) {
            param($Repository, $Name, $NamePattern, $Tag)
            $asset = [pscustomobject]@{
                name = $Name
                browser_download_url = "https://github.com/$Repository/releases/download/$Tag/$Name"
            }
            $release = [pscustomobject]@{ assets = @($asset) }
            $selected = Get-AntojitReleaseAsset -Release $release -NamePattern $NamePattern -Repository $Repository
            $selected | Should -Be $asset
        }

        It 'rejects a corrupted installer checksum' {
            $installer = Join-Path $TestDrive 'installer.exe'
            Set-Content -LiteralPath $installer -Value 'corrupted download'
            { Assert-AntojitSha256 -Path $installer -ExpectedHash ('0' * 64) } | Should -Throw '*SHA-256*'
        }

        It 'rejects a release asset hosted outside the official repository before downloading' {
            $release = [pscustomobject]@{ assets = @([pscustomobject]@{
                name = 'podman-5.0-setup.exe'
                browser_download_url = 'https://example.org/installer.exe'
            }) }
            { Get-AntojitReleaseAsset -Release $release -NamePattern '^podman-.*-setup\.exe$' -Repository 'podman-container-tools/podman' } | Should -Throw '*oficial*'
        }

        It 'rejects a Podman URL with <Case>' -TestCases @(
            @{ Case = 'a non-HTTPS scheme'; Url = 'http://github.com/podman-container-tools/podman/releases/download/v6.1.4/podman-installer-windows-amd64.msi' },
            @{ Case = 'a lookalike host'; Url = 'https://github.com.example.org/podman-container-tools/podman/releases/download/v6.1.4/podman-installer-windows-amd64.msi' },
            @{ Case = 'an unrelated GitHub owner'; Url = 'https://github.com/unrelated/podman/releases/download/v6.1.4/podman-installer-windows-amd64.msi' },
            @{ Case = 'a repository sharing the official prefix'; Url = 'https://github.com/podman-container-tools/podman-extra/releases/download/v6.1.4/podman-installer-windows-amd64.msi' }
        ) {
            param($Case, $Url)
            $release = [pscustomobject]@{ assets = @([pscustomobject]@{
                name = 'podman-installer-windows-amd64.msi'
                browser_download_url = $Url
            }) }
            { Get-AntojitReleaseAsset -Release $release -NamePattern '^podman-installer-windows-amd64\.msi$' -Repository 'podman-container-tools/podman' } | Should -Throw '*oficial*'
        }

        It 'rejects <Count> matching installers' -TestCases @(@{ Count = 0 }, @{ Count = 2 }) {
            param($Count)
            $asset = [pscustomobject]@{
                name = 'podman-installer-windows-amd64.msi'
                browser_download_url = 'https://github.com/podman-container-tools/podman/releases/download/v6.1.4/podman-installer-windows-amd64.msi'
            }
            $assets = @()
            for ($i = 0; $i -lt $Count; $i++) { $assets += $asset }
            $release = [pscustomobject]@{ assets = $assets }
            { Get-AntojitReleaseAsset -Release $release -NamePattern '^podman-installer-windows-amd64\.msi$' -Repository 'podman-container-tools/podman' } | Should -Throw '*un unico*'
        }

        It 'marks a required Windows restart as a terminating resumable installation error' {
            $caught = $null
            try { Stop-AntojitForRestart -Reason 'WSL2 was enabled.' }
            catch { $caught = $_ }
            $caught | Should -Not -BeNullOrEmpty
            $caught.Exception.Data['RestartRequired'] | Should -BeTrue
            $caught.FullyQualifiedErrorId | Should -Match 'AntojitOS.RestartRequired'
        }
    }
}
