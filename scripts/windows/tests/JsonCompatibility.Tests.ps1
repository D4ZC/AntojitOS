#requires -Version 5.1

BeforeDiscovery {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1')
}

Describe 'Windows PowerShell 5.1 JSON array compatibility' {
    InModuleScope AntojitOS.Windows {
        BeforeEach {
            $script:Json51Environment = @{}
            foreach ($name in @('CONTAINER_ENGINE', 'CONTAINERS_MACHINE_PROVIDER', 'CONTAINER_CONNECTION', 'PODMAN_COMPOSE_PROVIDER',
                'PILOT_PROJECT_NAME', 'CONTAINER_HOST', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')) {
                $script:Json51Environment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            }
            $fixture = Join-Path (Split-Path -Parent (Get-Module AntojitOS.Windows).Path) 'tests/fixtures/podman-6.1.4-machine-inspect.json'
            $script:Json51Inspect = [IO.File]::ReadAllText($fixture)
            $script:Json51Machines = '[{"Name":"unrelated","VMType":"wsl","Running":true,"Default":true},{"Name":"antojitos-pilot","VMType":"wsl","Running":false,"Default":false}]'
            $script:Json51Volumes = '[]'
            $script:Json51Containers = '[]'
            $script:Json51Installation = [pscustomobject]@{
                MachineName = 'antojitos-pilot'
                ComposeProviderPath = 'C:\tools\docker-compose.exe'
            }
            # Reproduce 5.1 on either host: ConvertFrom-Json emits the whole JSON
            # array as one pipeline value. The first test verifies the mock shape.
            $script:Json51Parser = Get-Command ConvertFrom-Json -CommandType Cmdlet
            Mock ConvertFrom-Json {
                param($InputObject)
                $decoded = & $script:Json51Parser -InputObject $InputObject
                Write-Output -NoEnumerate ([object[]]@($decoded))
            }
            Mock Test-Path { $false }
            Mock Update-AntojitPath { }
            Mock Get-AntojitPodman { 'C:\Podman\podman.exe' }
            Mock Write-AntojitLog { }
            Mock Start-Sleep { }
            Mock Repair-AntojitPodmanProxy { throw 'A healthy API must not require recovery.' }
            Mock Invoke-AntojitNative { [pscustomobject]@{ ExitCode = 0; StdOut = '[]'; StdErr = '' } }
            Mock Invoke-AntojitCommand {
                param($Arguments)
                switch ($Arguments -join '|') {
                    'machine|list|--format|json' { return $script:Json51Machines }
                    'machine|inspect|antojitos-pilot' { return $script:Json51Inspect }
                    'info|--format|{{.Host.OS}}' { return 'linux' }
                    'volume|ls|--format|json' { return $script:Json51Volumes }
                    'ps|--all|--format|json' { return $script:Json51Containers }
                    default { throw "Unexpected command: $($Arguments -join ' ')" }
                }
            }
        }

        AfterEach {
            foreach ($name in $script:Json51Environment.Keys) {
                [Environment]::SetEnvironmentVariable($name, $script:Json51Environment[$name], 'Process')
            }
        }

        It 'actually returns the unenumerated array that caused the Windows failure' {
            $captured = @($script:Json51Inspect | ConvertFrom-Json)
            $captured.Count | Should -Be 1
            $captured[0].GetType().IsArray | Should -BeTrue
            $captured[0].PSObject.Properties['ConnectionInfo'] | Should -BeNullOrEmpty
            $captured[0][0].ConnectionInfo.PodmanPipe.Path | Should -Be '\\.\pipe\podman-antojitos-pilot'
        }

        It 'accepts the exact machine inspection from the failing PC and contacts Compose' {
            Initialize-AntojitComposeConnection -Installation $script:Json51Installation -PodmanPath 'C:\Podman\podman.exe' -TimeoutSeconds 0

            $env:DOCKER_HOST | Should -Be 'npipe:////./pipe/podman-antojitos-pilot'
            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter {
                $FilePath -eq 'C:\tools\docker-compose.exe' -and ($Arguments -join '|') -eq 'ls|--format|json'
            }
            Should -Invoke Repair-AntojitPodmanProxy -Times 0 -Exactly
        }

        It 'starts the full runtime with a machine list containing more than one entry' {
            Mock Test-Path { $true }
            Initialize-AntojitRuntime -Installation $script:Json51Installation -TimeoutSeconds 0

            $env:CONTAINER_CONNECTION | Should -Be 'antojitos-pilot'
            $env:DOCKER_HOST | Should -Be 'npipe:////./pipe/podman-antojitos-pilot'
            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly
        }

        It 'selects the existing restaurant machine instead of the other running default' {
            Resolve-AntojitMachineName -PodmanPath 'C:\Podman\podman.exe' | Should -Be 'antojitos-pilot'
        }

        It 'handles an empty machine list without inventing a list entry' {
            $script:Json51Machines = '[]'
            Resolve-AntojitMachineName -PodmanPath 'C:\Podman\podman.exe' | Should -Be 'antojitos-pilot'
        }

        It 'detects an existing database volume before generating new credentials' {
            $script:Json51Volumes = '[{"Name":"unrelated"},{"Name":"antojitos-pilot_pilot_postgres"}]'
            { Assert-AntojitEnvironmentRecovery -PodmanPath 'C:\Podman\podman.exe' -EnvironmentFile 'missing.env' } | Should -Throw '*Recupera su configuracion*'
        }

        It 'detects existing containers by their Compose labels' {
            $script:Json51Containers = '[{"Names":["custom-name"],"Labels":{"com.docker.compose.project":"antojitos-pilot"}}]'
            { Assert-AntojitEnvironmentRecovery -PodmanPath 'C:\Podman\podman.exe' -EnvironmentFile 'missing.env' } | Should -Throw '*Recupera su configuracion*'
        }
    }
}
