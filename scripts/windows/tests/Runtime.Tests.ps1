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
            $script:RuntimeMachine = '[{"Rootful":false,"State":"running","ConnectionInfo":{"PodmanPipe":{"Path":"\\\\.\\pipe\\inspected-runtime-proxy"}}}]'
            $script:RuntimeFreshMachine = $null
            $script:RuntimeMachineInspectCount = 0
            $script:RuntimeInfoFailures = 0
            $script:RuntimeComposeFailures = 0
            $script:RuntimeComposeAlwaysFails = $false
            $script:RuntimeRepairError = $null
            $script:RuntimeProbeEnvironments = New-Object 'System.Collections.Generic.List[object]'
            $script:RuntimeEnvironment = @{}
            foreach ($name in @('CONTAINER_ENGINE', 'CONTAINERS_MACHINE_PROVIDER', 'CONTAINER_CONNECTION', 'PODMAN_COMPOSE_PROVIDER', 'PILOT_PROJECT_NAME', 'CONTAINER_HOST',
                'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')) {
                $script:RuntimeEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            }
            Mock Update-AntojitPath { }
            Mock Test-Path { $true }
            Mock Get-AntojitPodman { 'C:\Podman\podman.exe' }
            Mock Write-AntojitLog { }
            Mock Start-Sleep { }
            Mock Invoke-AntojitNative {
                $script:RuntimeProbeEnvironments.Add([pscustomobject]@{
                    Host = [Environment]::GetEnvironmentVariable('DOCKER_HOST', 'Process')
                    Context = [Environment]::GetEnvironmentVariable('DOCKER_CONTEXT', 'Process')
                    Tls = [Environment]::GetEnvironmentVariable('DOCKER_TLS', 'Process')
                    TlsVerify = [Environment]::GetEnvironmentVariable('DOCKER_TLS_VERIFY', 'Process')
                    CertPath = [Environment]::GetEnvironmentVariable('DOCKER_CERT_PATH', 'Process')
                })
                if ($script:RuntimeComposeAlwaysFails -or $script:RuntimeComposeFailures -gt 0) {
                    $script:RuntimeComposeFailures--
                    throw 'Named pipe was not found by the Compose provider.'
                }
                [pscustomobject]@{ ExitCode = 0; StdOut = '[]'; StdErr = '' }
            }
            Mock Repair-AntojitPodmanProxy {
                if ($script:RuntimeRepairError) { throw $script:RuntimeRepairError }
            }
            Mock Invoke-AntojitCommand {
                param($FilePath, $Arguments)
                switch ($Arguments -join '|') {
                    'machine|list|--format|json' { return $script:RuntimeMachineList }
                    'machine|inspect|antojitos-test' {
                        $script:RuntimeMachineInspectCount++
                        if ($script:RuntimeFreshMachine -and $script:RuntimeMachineInspectCount -gt 1) { return $script:RuntimeFreshMachine }
                        return $script:RuntimeMachine
                    }
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
            $env:DOCKER_HOST | Should -Be 'npipe:////./pipe/inspected-runtime-proxy'
            [Environment]::GetEnvironmentVariable('CONTAINER_HOST', 'Process') | Should -BeNullOrEmpty
            Should -Invoke Invoke-AntojitNative -Times 2 -Exactly -ParameterFilter {
                $FilePath -eq $script:RuntimeInstallation.ComposeProviderPath -and
                ($Arguments -join '|') -eq 'ls|--format|json' -and $TimeoutSeconds -le 10
            }
            Should -Invoke Repair-AntojitPodmanProxy -Times 0 -Exactly
        }

        It 'keeps the stored custom machine when another machine becomes the running default' {
            $script:RuntimeInstallation.MachineName = 'Restaurant_VM.1'
            Mock Invoke-AntojitCommand {
                param($FilePath, $Arguments)
                switch ($Arguments -join '|') {
                    'machine|list|--format|json' {
                        return '[{"Name":"other-machine","Running":true,"Default":true,"VMType":"wsl"},{"Name":"Restaurant_VM.1","Running":true,"Default":false,"VMType":"wsl"}]'
                    }
                    'machine|inspect|Restaurant_VM.1' {
                        return '[{"Rootful":false,"State":"running","ConnectionInfo":{"PodmanPipe":{"Path":"\\\\.\\pipe\\custom-inspected-proxy"}}}]'
                    }
                    'info|--format|{{.Host.Os}}' { return 'linux' }
                    default { throw "Unexpected native command: $FilePath $($Arguments -join ' ')" }
                }
            }

            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0
            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0

            $env:CONTAINER_CONNECTION | Should -Be 'Restaurant_VM.1'
            $env:DOCKER_HOST | Should -Be 'npipe:////./pipe/custom-inspected-proxy'
            Should -Invoke Invoke-AntojitCommand -Times 4 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'inspect' -and $Arguments[2] -eq 'Restaurant_VM.1'
            }
            Should -Invoke Invoke-AntojitCommand -Times 2 -Exactly -ParameterFilter { $Arguments[0] -eq 'info' }
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'machine' -and $Arguments[1] -in 'init', 'start', 'set', 'rm', 'reset'
            }
            Should -Invoke Repair-AntojitPodmanProxy -Times 0 -Exactly
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
            $script:RuntimeMachine = '[{"Rootful":false,"State":"stopped","ConnectionInfo":{"PodmanPipe":{"Path":"\\\\.\\pipe\\inspected-runtime-proxy"}}}]'
            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -AllowCreate -TimeoutSeconds 0
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'init' }
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'start' }
        }

        It 'starts an existing stopped machine without recreating it' {
            $script:RuntimeMachine = '[{"Rootful":false,"State":"stopped"}]'
            $script:RuntimeFreshMachine = '[{"Rootful":false,"State":"running","ConnectionInfo":{"PodmanPipe":{"Path":"\\\\.\\pipe\\fresh-after-start"}}}]'
            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'start' }
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'init' }
            Should -Invoke Invoke-AntojitCommand -Times 2 -Exactly -ParameterFilter { $Arguments[0] -eq 'machine' -and $Arguments[1] -eq 'inspect' }
            $env:DOCKER_HOST | Should -Be 'npipe:////./pipe/fresh-after-start'
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
            Should -Invoke Invoke-AntojitNative -Times 0 -Exactly
            Should -Invoke Repair-AntojitPodmanProxy -Times 0 -Exactly
        }

        It 'tests the inspected local pipe after clearing inherited Docker overrides' {
            $env:DOCKER_HOST = 'tcp://unexpected-host:2376'
            $env:DOCKER_CONTEXT = 'unexpected-context'
            $env:DOCKER_TLS = '1'
            $env:DOCKER_TLS_VERIFY = '1'
            $env:DOCKER_CERT_PATH = 'C:\unexpected-certificates'

            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0

            $script:RuntimeProbeEnvironments.Count | Should -Be 1
            $probe = $script:RuntimeProbeEnvironments[0]
            $probe.Host | Should -Be 'npipe:////./pipe/inspected-runtime-proxy'
            $probe.Context | Should -BeNullOrEmpty
            $probe.Tls | Should -BeNullOrEmpty
            $probe.TlsVerify | Should -BeNullOrEmpty
            $probe.CertPath | Should -BeNullOrEmpty
            Should -Invoke Invoke-AntojitNative -Times 1 -Exactly -ParameterFilter {
                $FilePath -eq $script:RuntimeInstallation.ComposeProviderPath -and
                ($Arguments -join '|') -eq 'ls|--format|json' -and $TimeoutSeconds -le 10
            }
        }

        It 'recovers a failed Compose pipe even when Podman already reports Linux' {
            $script:RuntimeComposeFailures = 1

            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0

            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'info' }
            Should -Invoke Invoke-AntojitNative -Times 2 -Exactly
            Should -Invoke Repair-AntojitPodmanProxy -Times 1 -Exactly -ParameterFilter {
                $PodmanPath -eq 'C:\Podman\podman.exe' -and
                $MachineName -eq 'antojitos-test' -and
                $Machine.ConnectionInfo.PodmanPipe.Path -eq '\\.\pipe\inspected-runtime-proxy'
            }
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'machine' -and $Arguments[1] -in 'init', 'start', 'stop', 'reset', 'rm', 'set'
            }
        }

        It 'retries Compose after one recovery while time remains' {
            $script:RuntimeComposeFailures = 2

            Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 30

            Should -Invoke Invoke-AntojitNative -Times 3 -Exactly
            Should -Invoke Repair-AntojitPodmanProxy -Times 1 -Exactly
            Should -Invoke Start-Sleep -Times 1 -Exactly
        }

        It 'fails clearly when Compose remains unreachable after one recovery' {
            $script:RuntimeComposeAlwaysFails = $true

            $failure = { Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0 } | Should -Throw -PassThru

            $failure.Exception.Message | Should -Match 'Compose'
            $failure.Exception.Message | Should -Match 'win-sshproxy'
            $failure.Exception.Message | Should -Match 'Named pipe was not found'
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'info' }
            Should -Invoke Invoke-AntojitNative -Times 2 -Exactly
            Should -Invoke Repair-AntojitPodmanProxy -Times 1 -Exactly
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'machine' -and $Arguments[1] -in 'init', 'start', 'stop', 'reset', 'rm', 'set'
            }
        }

        It 'preserves the recovery failure detail when the proxy cannot be repaired' {
            $script:RuntimeComposeAlwaysFails = $true
            $script:RuntimeRepairError = 'Proxy service access was denied.'

            $failure = { Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0 } | Should -Throw -PassThru

            $failure.Exception.Message | Should -Match 'Compose'
            $failure.Exception.Message | Should -Match 'win-sshproxy'
            $failure.Exception.Message | Should -Match 'Proxy service access was denied'
            Should -Invoke Repair-AntojitPodmanProxy -Times 1 -Exactly
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'machine' -and $Arguments[1] -in 'init', 'start', 'stop', 'reset', 'rm', 'set'
            }
        }

        It 'rejects an inspected endpoint that is not a local Windows pipe' {
            $script:RuntimeMachine = '[{"Rootful":false,"State":"running","ConnectionInfo":{"PodmanPipe":{"Path":"\\\\remote-server\\pipe\\unexpected"}}}]'

            { Initialize-AntojitRuntime -Installation $script:RuntimeInstallation -TimeoutSeconds 0 } | Should -Throw '*pipe*'

            Should -Invoke Invoke-AntojitNative -Times 0 -Exactly
            Should -Invoke Repair-AntojitPodmanProxy -Times 0 -Exactly
        }
    }
}

Describe 'Podman proxy recovery without restarting WSL' {
    InModuleScope AntojitOS.Windows {
        BeforeEach {
            $script:RepairOriginalDataHome = $env:XDG_DATA_HOME
            $script:RepairDataHome = Join-Path $TestDrive 'Data Home'
            $env:XDG_DATA_HOME = $script:RepairDataHome
            $script:RepairPodman = Join-Path $TestDrive 'Podman installation/podman.exe'
            $script:RepairProxy = Join-Path (Split-Path -Parent $script:RepairPodman) 'win-sshproxy.exe'
            $script:RepairIdentity = Join-Path $TestDrive 'User Profile/SSH identity'
            foreach ($path in @($script:RepairPodman, $script:RepairProxy, $script:RepairIdentity)) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
                [IO.File]::WriteAllText($path, 'fixture')
            }
            $script:RepairState = Join-Path $script:RepairDataHome 'containers/podman/machine/wsl/Restaurant_VM.1'
            New-Item -ItemType Directory -Path $script:RepairState -Force | Out-Null
            $script:RepairThreadFile = Join-Path $script:RepairState 'win-sshproxy.tid'
            $script:RepairMachine = [pscustomobject]@{
                Rootful = $false
                SSHConfig = [pscustomobject]@{ Port = 65094; RemoteUsername = 'user'; IdentityPath = $script:RepairIdentity }
                ConnectionInfo = [pscustomobject]@{ PodmanPipe = [pscustomobject]@{ Path = '\\.\pipe\inspected-proxy' } }
            }
            Mock Write-AntojitLog { }
            Mock Get-AntojitLogPath { $null }
            Mock Get-Process { $null }
            Mock Invoke-AntojitCommand { throw 'Proxy recovery must not run machine commands.' }
            Mock Start-Process {
                $process = [pscustomobject]@{ Id = 4321 }
                $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }
                return $process
            }
        }

        AfterEach { $env:XDG_DATA_HOME = $script:RepairOriginalDataHome }

        It 'starts only the inspected pipe with the existing SSH identity and Podman state directory' {
            Repair-AntojitPodmanProxy -PodmanPath $script:RepairPodman -Machine $script:RepairMachine -MachineName 'Restaurant_VM.1'

            $expected = 'Restaurant_VM.1 "' + $script:RepairState + '" npipe:////./pipe/inspected-proxy ssh://user@localhost:65094/run/user/1000/podman/podman.sock "' + $script:RepairIdentity + '"'
            Should -Invoke Start-Process -Times 1 -Exactly -ParameterFilter {
                $FilePath -eq $script:RepairProxy -and ($ArgumentList -join ' ') -ceq $expected -and
                $PassThru -and $WindowStyle -eq 'Hidden' -and
                $RedirectStandardError -like '*.stderr.log' -and $RedirectStandardOutput -like '*.stdout.log'
            }
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly
        }

        It 'does not duplicate a live proxy or overwrite its thread record' {
            [IO.File]::WriteAllText($script:RepairThreadFile, '5678:9012')
            Mock Get-Process { [pscustomobject]@{ ProcessName = 'win-sshproxy' } } -ParameterFilter { $Id -eq 5678 }

            Repair-AntojitPodmanProxy -PodmanPath $script:RepairPodman -Machine $script:RepairMachine -MachineName 'Restaurant_VM.1'

            Should -Invoke Start-Process -Times 0 -Exactly
            [IO.File]::ReadAllText($script:RepairThreadFile) | Should -Be '5678:9012'
        }

        It 'recovers after a previous proxy exited even when its PID has been reused' {
            [IO.File]::WriteAllText($script:RepairThreadFile, '5678:9012')
            Mock Get-Process { [pscustomobject]@{ ProcessName = 'unrelated-program' } } -ParameterFilter { $Id -eq 5678 }

            Repair-AntojitPodmanProxy -PodmanPath $script:RepairPodman -Machine $script:RepairMachine -MachineName 'Restaurant_VM.1'

            Should -Invoke Start-Process -Times 1 -Exactly
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly
        }

        It 'fails clearly if Podman is missing its proxy helper' {
            Remove-Item -LiteralPath $script:RepairProxy
            { Repair-AntojitPodmanProxy -PodmanPath $script:RepairPodman -Machine $script:RepairMachine -MachineName 'Restaurant_VM.1' } | Should -Throw '*Falta el auxiliar*'
            Should -Invoke Start-Process -Times 0 -Exactly
        }

        It 'does not start a proxy with a missing SSH identity' {
            Remove-Item -LiteralPath $script:RepairIdentity
            { Repair-AntojitPodmanProxy -PodmanPath $script:RepairPodman -Machine $script:RepairMachine -MachineName 'Restaurant_VM.1' } | Should -Throw '*SSH*'
            Should -Invoke Start-Process -Times 0 -Exactly
        }

        It 'rejects rootful storage before starting a helper' {
            $script:RepairMachine.Rootful = $true
            { Repair-AntojitPodmanProxy -PodmanPath $script:RepairPodman -Machine $script:RepairMachine -MachineName 'Restaurant_VM.1' } | Should -Throw '*rootless*'
            Should -Invoke Start-Process -Times 0 -Exactly
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
