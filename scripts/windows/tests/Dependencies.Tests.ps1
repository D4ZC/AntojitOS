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
    }
}

Describe 'Dependency download validation' {
    InModuleScope AntojitOS.Dependencies {
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
            { Get-AntojitReleaseAsset -Release $release -NamePattern '^podman-.*-setup\.exe$' -Repository 'containers/podman' } | Should -Throw '*oficial*'
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
