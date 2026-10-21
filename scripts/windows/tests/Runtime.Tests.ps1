#requires -Version 5.1

BeforeDiscovery {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1')
}

Describe 'Daily Podman runtime startup' {
    InModuleScope AntojitOS.Windows {
        BeforeEach {
            $script:RuntimeInstallation = [pscustomobject]@{
                MachineName = 'antojitos-test'
                ComposeProviderPath = 'C:\AntojitOS\tools\docker-compose.exe'
            }
            $script:RuntimeMachineList = '[{"Name":"antojitos-test"}]'
            $script:RuntimeMachine = '[{"Rootful":false,"State":"running"}]'
            $script:RuntimeInfoFailures = 0
            $script:RuntimeEnvironment = @{}
            foreach ($name in @('CONTAINER_ENGINE', 'CONTAINERS_MACHINE_PROVIDER', 'CONTAINER_CONNECTION', 'PODMAN_COMPOSE_PROVIDER', 'PILOT_PROJECT_NAME', 'CONTAINER_HOST')) {
                $script:RuntimeEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            }
            Mock Update-AntojitPath { }
            Mock Test-Path { $true }
            Mock Get-AntojitPodman { 'C:\Podman\podman.exe' }
            Mock Write-AntojitLog { }
            Mock Start-Sleep { }
            Mock Invoke-AntojitCommand {
                param($FilePath, $Arguments)
                switch ($Arguments -join '|') {
                    'machine|list|--format|json' { return $script:RuntimeMachineList }
                    'machine|inspect|antojitos-test' { return $script:RuntimeMachine }
                    'machine|init|--rootful=false|antojitos-test' { return }
                    'machine|start|antojitos-test' { return }
                    'info|--format|{{.Host.Os}}' {
                        if ($script:RuntimeInfoFailures -gt 0) {
                            $script:RuntimeInfoFailures--
                            throw 'The engine is still starting.'
                        }
                        return 'linux'
                    }
                    default { throw "Unexpected native command: $FilePath $($Arguments -join ' ')" }
                }
            }
        }

        AfterEach {
            foreach ($name in $script:RuntimeEnvironment.Keys) {
                [Environment]::SetEnvironmentVariable($name, $script:RuntimeEnvironment[$name], 'Process')
            }
        }

        It 'reuses a running machine on repeated startup and selects its local connection' {
            $env:CONTAINER_HOST = 'ssh://unexpected-host'
            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0
            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0

            Should -Invoke Invoke-AntojitCommand -Times 2 -Exactly -ParameterFilter { $Arguments[0] -eq 'info' }
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter {
                $Arguments[0] -ne 'info' -and $Arguments[1] -notin 'list', 'inspect'
            }
            $env:CONTAINER_ENGINE | Should -Be 'C:\Podman\podman.exe'
            $env:CONTAINER_CONNECTION | Should -Be 'antojitos-test'
            $env:CONTAINERS_MACHINE_PROVIDER | Should -Be 'wsl'
            $env:PODMAN_COMPOSE_PROVIDER | Should -Be $script:RuntimeInstallation.ComposeProviderPath
            [Environment]::GetEnvironmentVariable('CONTAINER_HOST', 'Process') | Should -BeNullOrEmpty
        }

        It 'requires the installer when the machine is missing' {
            $script:RuntimeMachineList = '[]'
            { Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0 } | Should -Throw '*final_script.cmd*'
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'info' -or $Arguments[1] -ne 'list'
            }
        }

        It 'creates a machine only with explicit installation permission' {
            $script:RuntimeMachineList = '[]'
            $script:RuntimeMachine = '[{"Rootful":false,"State":"stopped"}]'
            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -AllowCreate -TimeoutSeconds 0
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'init' }
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'start' }
        }

        It 'starts an existing stopped machine without recreating it' {
            $script:RuntimeMachine = '[{"Rootful":false,"State":"stopped"}]'
            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'start' }
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'init' }
        }

        It 'rejects a rootful machine before touching its separate storage' {
            $script:RuntimeMachine = '[{"Rootful":true,"State":"stopped"}]'
            { Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0 } | Should -Throw '*rootful*'
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'info' -or $Arguments[1] -eq 'start'
            }
        }

        It 'retries readiness without downloading or changing the machine' {
            $script:RuntimeInfoFailures = 1
            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 30
            Should -Invoke Invoke-AntojitCommand -Times 2 -Exactly -ParameterFilter { $Arguments[0] -eq 'info' }
            Should -Invoke Start-Sleep -Times 1 -Exactly
        }

        It 'fails when readiness exceeds its deadline' {
            $script:RuntimeInfoFailures = 1
            { Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0 } | Should -Throw '*tiempo*'
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'info' }
            Should -Invoke Start-Sleep -Times 0 -Exactly
        }
    }
}

Describe 'Checked native execution and operation locking' {
    BeforeAll {
        $script:NativeTestExecutable = if ($PSVersionTable.PSEdition -eq 'Desktop') {
            Join-Path $PSHOME 'powershell.exe'
        } else {
            Join-Path $PSHOME 'pwsh'
        }
    }

    It 'propagates a native error and restores the caller working directory' {
        $before = (Get-Location).Path
        { Invoke-AntojitCommand -FilePath $script:NativeTestExecutable -Arguments @('-NoProfile', '-NonInteractive', '-Command', 'exit 17') -WorkingDirectory $TestDrive } | Should -Throw '*17*'
        (Get-Location).Path | Should -Be $before
    }

    It 'captures stdout while allowing stderr from a successful command' {
        $command = '[Console]::Out.WriteLine("ready"); [Console]::Error.WriteLine("diagnostic"); exit 0'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = @(Invoke-AntojitCommand -FilePath $script:NativeTestExecutable -Capture -Arguments @(
            '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded
        ))
        $output | Should -Contain 'ready'
        $output | Should -Not -Contain 'diagnostic'
    }

    It 'blocks a concurrent operation and permits retry after disposal' {
        $root = Join-Path $TestDrive 'installation'
        $first = Enter-AntojitOperation -Root $root
        try {
            { Enter-AntojitOperation -Root $root } | Should -Throw '*curso*'
        } finally { $first.Dispose() }
        $second = Enter-AntojitOperation -Root $root
        try { $second.CanWrite | Should -BeTrue }
        finally { $second.Dispose() }
    }
}
