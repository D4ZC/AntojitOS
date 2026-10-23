#requires -Version 5.1

BeforeDiscovery {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1') -Force
}

Describe 'Installation Podman machine selection' {
    InModuleScope AntojitOS.Windows {
        BeforeEach {
            $script:SelectionMachines = '[]'
            $script:SelectionOriginalProvider = $env:CONTAINERS_MACHINE_PROVIDER
            Mock Write-AntojitLog { }
            Mock Invoke-AntojitCommand {
                param($FilePath, $Arguments)
                if ($FilePath -ne 'podman.exe' -or ($Arguments -join '|') -ne 'machine|list|--format|json') {
                    throw "Unexpected native command: $FilePath $($Arguments -join ' ')"
                }
                return $script:SelectionMachines
            }
        }

        AfterEach {
            $env:CONTAINERS_MACHINE_PROVIDER = $script:SelectionOriginalProvider
        }

        It 'adopts the manually created running restaurant machine from the installation log' {
            $script:SelectionMachines = '[{"Name":"antojitos-pilot","Running":true,"Default":true,"VMType":"wsl"}]'

            Resolve-AntojitMachineName -PodmanPath 'podman.exe' | Should -Be 'antojitos-pilot'

            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly
        }

        It 'prefers the named restaurant machine over another running default machine' {
            $script:SelectionMachines = '[{"Name":"personal-machine","Running":true,"Default":true,"VMType":"wsl"},{"Name":"antojitos-pilot","Running":false,"Default":false,"VMType":"wsl"}]'

            Resolve-AntojitMachineName -PodmanPath 'podman.exe' | Should -Be 'antojitos-pilot'
        }

        It 'selects the only running WSL machine before the default stopped machine' {
            $script:SelectionMachines = '[{"Name":"running-machine","Running":true,"Default":false,"VMType":"wsl"},{"Name":"default-machine","Running":false,"Default":true,"VMType":"wsl"}]'

            Resolve-AntojitMachineName -PodmanPath 'podman.exe' | Should -Be 'running-machine'
        }

        It 'selects the unique default when multiple WSL machines are stopped' {
            $script:SelectionMachines = '[{"Name":"other-machine","Running":false,"Default":false,"VMType":"wsl"},{"Name":"podman-machine-default","Running":false,"Default":true,"VMType":"wsl"}]'

            Resolve-AntojitMachineName -PodmanPath 'podman.exe' | Should -Be 'podman-machine-default'
        }

        It 'selects a single stopped machine from older Podman without VMType' {
            $script:SelectionMachines = '[{"Name":"custom-machine","Running":false,"Default":false}]'

            Resolve-AntojitMachineName -PodmanPath 'podman.exe' | Should -Be 'custom-machine'
        }

        It 'ignores machines from a different provider' {
            $script:SelectionMachines = '[{"Name":"hyperv-machine","Running":true,"Default":true,"VMType":"hyperv"},{"Name":"wsl-machine","Running":false,"Default":false,"VMType":"wsl"}]'

            Resolve-AntojitMachineName -PodmanPath 'podman.exe' | Should -Be 'wsl-machine'
        }

        It 'returns the installation machine name when no compatible machine exists without creating it' {
            $script:SelectionMachines = '[{"Name":"other-provider","Running":true,"Default":true,"VMType":"hyperv"}]'

            Resolve-AntojitMachineName -PodmanPath 'podman.exe' | Should -Be 'antojitos-pilot'

            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly
        }

        It 'rejects an incompatible machine that already occupies the restaurant machine name' {
            $script:SelectionMachines = '[{"Name":"antojitos-pilot","Running":true,"Default":true,"VMType":"hyperv"}]'

            { Resolve-AntojitMachineName -PodmanPath 'podman.exe' } | Should -Throw '*antojitos-pilot*'

            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly
        }

        It 'reports all candidate names instead of selecting an ambiguous machine' {
            $script:SelectionMachines = '[{"Name":"first-machine","Running":false,"Default":false,"VMType":"wsl"},{"Name":"second-machine","Running":false,"Default":false,"VMType":"wsl"}]'

            { Resolve-AntojitMachineName -PodmanPath 'podman.exe' } | Should -Throw '*first-machine*second-machine*'

            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly
        }

        It 'accepts safe custom machine names supported by Podman' {
            $script:SelectionMachines = '[{"Name":"Restaurant_VM.1","Running":true,"Default":true,"VMType":"wsl"}]'

            Resolve-AntojitMachineName -PodmanPath 'podman.exe' | Should -Be 'Restaurant_VM.1'
        }

        It 'rejects an invalid selected name before it can become an argument' {
            $script:SelectionMachines = '[{"Name":"--invalid-machine","Running":true,"Default":true,"VMType":"wsl"}]'

            { Resolve-AntojitMachineName -PodmanPath 'podman.exe' } | Should -Throw

            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly
        }

        It 'does not treat malformed Podman output as an empty machine list' {
            $script:SelectionMachines = 'not JSON'

            { Resolve-AntojitMachineName -PodmanPath 'podman.exe' } | Should -Throw
        }
    }
}

Describe 'Selected Podman machine persistence' {
    InModuleScope AntojitOS.Windows {
        It 'roundtrips a safe custom name through installation storage' {
            Mock Protect-AntojitPath { }
            $root = Join-Path $TestDrive 'restaurant'
            $installation = [pscustomobject]@{
                Version = 1
                Engine = 'podman'
                Root = $root
                StateDirectory = Join-Path $root 'var\windows'
                OwnerSid = 'S-1-5-21-1-2-3-1000'
                HttpPort = 8080
                InternalHttpPort = 18080
                MachineName = 'Restaurant_VM.1'
            }

            Save-AntojitInstallation -Installation $installation
            $restored = Get-AntojitInstallation -InstallPath $root

            $restored.MachineName | Should -Be 'Restaurant_VM.1'
            $restored.Root | Should -Be $root
            $restored.HttpPort | Should -Be 8080
            $restored.InternalHttpPort | Should -Be 18080
        }
    }
}

Describe 'Credentials recovery when adopting a Podman machine' {
    InModuleScope AntojitOS.Windows {
        BeforeEach {
            $script:RecoveryEnvironmentExists = $false
            $script:RecoveryVolumes = '[]'
            $script:RecoveryContainers = '[]'
            Mock Test-Path { $script:RecoveryEnvironmentExists }
            Mock Write-AntojitLog { }
            Mock Invoke-AntojitCommand {
                param($FilePath, $Arguments)
                if ($FilePath -ne 'podman.exe') { throw "Unexpected executable: $FilePath" }
                switch ($Arguments -join '|') {
                    'volume|ls|--format|json' { return $script:RecoveryVolumes }
                    'ps|--all|--format|json' { return $script:RecoveryContainers }
                    default { throw "Unexpected native command: $FilePath $($Arguments -join ' ')" }
                }
            }
        }

        It 'preserves an existing environment without querying or changing Podman resources' {
            $script:RecoveryEnvironmentExists = $true

            Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot'

            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly
        }

        It 'permits new credentials when the existing machine has no application resources' {
            Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot'

            Should -Invoke Invoke-AntojitCommand -Times 2 -Exactly
        }

        It 'permits an existing machine used by unrelated projects' {
            $script:RecoveryVolumes = '[{"Name":"another-project_database","Labels":{"com.docker.compose.project":"another-project"}}]'
            $script:RecoveryContainers = '[{"Names":["another-project-api-1"],"Labels":{"io.podman.compose.project":"another-project"}}]'

            Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot'
        }

        It 'requires configuration recovery for a volume with a Docker Compose project label' {
            $script:RecoveryVolumes = '[{"Name":"custom_database","Labels":{"com.docker.compose.project":"antojitos-pilot"}}]'

            { Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot' } | Should -Throw '*.env.pilot*'
        }

        It 'requires configuration recovery for a stopped container with a Podman Compose project label' {
            $script:RecoveryContainers = '[{"Names":["custom-api"],"State":"exited","Labels":{"io.podman.compose.project":"antojitos-pilot"}}]'

            { Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot' } | Should -Throw '*.env.pilot*'
        }

        It 'recognizes the original PostgreSQL volume when its labels are absent' {
            $script:RecoveryVolumes = '[{"Name":"antojitos-pilot_pilot_postgres","Labels":null}]'

            { Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot' } | Should -Throw '*.env.pilot*'
        }

        It 'recognizes the original print agent volume when its labels are absent' {
            $script:RecoveryVolumes = '[{"Name":"antojitos-pilot_pilot_print_agent"}]'

            { Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot' } | Should -Throw '*.env.pilot*'
        }

        It 'recognizes a canonical restaurant container name when its labels are absent' {
            $script:RecoveryContainers = '[{"Names":["antojitos-pilot_api_1"],"State":"exited"}]'

            { Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot' } | Should -Throw '*.env.pilot*'
        }

        It 'fails closed when listing stored resources fails' {
            Mock Invoke-AntojitCommand { throw 'Podman resource query failed.' }

            { Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot' } | Should -Throw '*query failed*'
        }

        It 'fails closed when stored resource output cannot be parsed' {
            $script:RecoveryVolumes = 'not JSON'

            { Assert-AntojitEnvironmentRecovery -PodmanPath 'podman.exe' -EnvironmentFile 'C:\AntojitOS\.env.pilot' } | Should -Throw
        }
    }
}
