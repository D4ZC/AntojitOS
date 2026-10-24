#requires -Version 5.1
BeforeDiscovery {
    Import-Module (Join-Path $PSScriptRoot '../AntojitOS.Windows.psm1') -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot '../AntojitOS.Printing.psm1') -Force -DisableNameChecking
}

Describe 'Windows USB configuration and lifecycle' {
    InModuleScope AntojitOS.Printing {
        BeforeEach {
            $script:PrintInstallation = [pscustomobject]@{
                Root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
                StateDirectory = $null
                HttpPort = 8080
            }
            $script:PrintInstallation.StateDirectory = Join-Path $script:PrintInstallation.Root 'var/windows'
            New-Item -ItemType Directory -Path $script:PrintInstallation.Root -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $script:PrintInstallation.Root '.env.pilot'), "PRINT_AGENT_MODE=simulator`nBOOTSTRAP_TOKEN=fixture-bootstrap`n")
            Mock Write-AntojitLog { }
            Mock Get-AntojitPrintProcesses { @() }
        }

        It 'keeps a container installation unchanged until USB is explicitly configured' {
            $path = Join-Path $script:PrintInstallation.Root '.env.pilot'
            $before = [IO.File]::ReadAllText($path)
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation
            $config.Mode | Should -Be 'container'
            [IO.File]::ReadAllText($path) | Should -BeExactly $before
            Test-Path -LiteralPath $config.EnvironmentPath | Should -BeFalse
        }

        It 'creates one native identity and preserves credentials and destinations on repeated updates' {
            $first = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'BIXOLON SRP-F310'
            $first.Mode | Should -Be 'native'
            $native = Read-AntojitPrintEnvironment -Path $first.EnvironmentPath
            $native['PRINT_AGENT_API_URL'] | Should -Be 'http://127.0.0.1:8080/api'
            $native['PRINT_AGENT_CENTERS'] | Should -Be 'KITCHEN,BAR'
            $native['PRINT_AGENT_CODE'] | Should -Match '^PRINT-USB-[A-F0-9]{8}$'
            [IO.File]::AppendAllText($first.EnvironmentPath, "PRINT_AGENT_ID=existing-agent`nPRINT_AGENT_TOKEN=existing-token`n")
            $second = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation
            $after = Read-AntojitPrintEnvironment -Path $second.EnvironmentPath
            $after['PRINT_AGENT_CODE'] | Should -BeExactly $native['PRINT_AGENT_CODE']
            $after['PRINT_AGENT_CREDENTIALS_PATH'] | Should -BeExactly $native['PRINT_AGENT_CREDENTIALS_PATH']
            $after['PRINT_AGENT_ID'] | Should -Be 'existing-agent'
            $after['PRINT_AGENT_TOKEN'] | Should -Be 'existing-token'
            (Read-AntojitPrintEnvironment -Path (Join-Path $script:PrintInstallation.Root '.env.pilot'))['PRINT_AGENT_RUNTIME'] | Should -Be 'native'
        }

        It 'migrates the legacy system configuration and refuses to invent a USB queue' {
            $pilot = Join-Path $script:PrintInstallation.Root '.env.pilot'
            [IO.File]::WriteAllText($pilot, "PRINT_AGENT_MODE=system`nBOOTSTRAP_TOKEN=fixture`n")
            { Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation } | Should -Throw '*PRINTER_QUEUE*'
            [IO.File]::AppendAllText($pilot, "PRINTER_QUEUE='USB Caja'`n")
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation
            $config.Mode | Should -Be 'native'
            $config.PrinterQueue | Should -Be 'USB Caja'
        }

        It 'inherits the installed site, destinations and calibrated paper profile when adding USB' {
            [IO.File]::AppendAllText((Join-Path $script:PrintInstallation.Root '.env.pilot'), "PRINT_AGENT_SITE_CODE=RESTAURANT`nPRINT_AGENT_CENTERS=KITCHEN`nPRINT_AGENT_REGISTERS=`nPRINTER_COLUMNS=48`nPRINTER_CODE_PAGE=0`n")
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja'
            $native = Read-AntojitPrintEnvironment -Path $config.EnvironmentPath
            $native['PRINT_AGENT_SITE_CODE'] | Should -Be 'RESTAURANT'
            $native['PRINT_AGENT_CENTERS'] | Should -Be 'KITCHEN'
            $native['PRINT_AGENT_REGISTERS'] | Should -BeExactly ''
            $native['PRINTER_COLUMNS'] | Should -Be '48'
            $native['PRINTER_CODE_PAGE'] | Should -Be '0'
        }

        It 'rejects control characters instead of injecting another environment setting' {
            { Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue "USB`nPRINT_AGENT_MODE=simulator" } | Should -Throw '*control*'
            Test-Path -LiteralPath (Join-Path $script:PrintInstallation.Root '.env.print-agent') | Should -BeFalse
        }

        It 'preserves literal backslashes in a Windows queue when consumed by the real Node env parser' {
            $queue = '\\servidor\nombre-impresora'
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue $queue
            $node = @(Get-Command node -CommandType Application -ErrorAction Stop)[0].Source
            $output = & $node ('--env-file=' + $config.EnvironmentPath) -e 'process.stdout.write(JSON.stringify(process.env.PRINTER_QUEUE))'
            $LASTEXITCODE | Should -Be 0
            ($output | ConvertFrom-Json) | Should -BeExactly $queue
            (Read-AntojitPrintEnvironment -Path $config.EnvironmentPath)['PRINTER_QUEUE'] | Should -BeExactly $queue
        }

        It 'rejects a mistyped queue during preflight before any deployment command' {
            Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB typo' | Out-Null
            Mock Get-AntojitNode { 'node.exe' }
            Mock Get-AntojitInstalledPrinter { [pscustomobject]@{ Name = 'USB Caja' } }
            Mock Invoke-AntojitCompose { throw 'Preflight must not deploy.' }
            { Assert-AntojitNativePrintConfiguration -Installation $script:PrintInstallation } | Should -Throw '*nombre exacto*'
            Should -Invoke Invoke-AntojitCompose -Times 0 -Exactly
        }

        It 'validates native Node and queue without requiring Windows printing for container mode' {
            Mock Get-AntojitNode { 'node.exe' }
            Mock Get-AntojitInstalledPrinter { [pscustomobject]@{ Name = 'USB Caja' } }
            Assert-AntojitNativePrintConfiguration -Installation $script:PrintInstallation
            Should -Invoke Get-AntojitNode -Times 0 -Exactly
            Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja' | Out-Null
            Assert-AntojitNativePrintConfiguration -Installation $script:PrintInstallation
            Should -Invoke Get-AntojitNode -Times 1 -Exactly
            Should -Invoke Get-AntojitInstalledPrinter -Times 1 -Exactly -ParameterFilter { $Name -eq 'USB Caja' }
        }

        It 'looks up queue names with brackets as literal names rather than wildcard patterns' {
            $needsStub = -not (Get-Command Get-Printer -ErrorAction SilentlyContinue)
            if ($needsStub) { function script:Get-Printer { param($Name) throw 'Windows printer lookup must be mocked.' } }
            try {
                Mock Get-Printer {
                    param($Name)
                    if ('USB [001]' -like $Name) { return [pscustomobject]@{ Name = 'USB [001]' } }
                }
                (Get-AntojitInstalledPrinter -Name 'USB [001]').Name | Should -BeExactly 'USB [001]'
            } finally {
                if ($needsStub) { Remove-Item Function:script:Get-Printer -ErrorAction SilentlyContinue }
            }
        }

        It 'extracts a compiled agent without starting a container or replacing the active release' {
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja'
            New-Item -ItemType Directory -Path (Join-Path $script:PrintInstallation.Root 'apps/print-agent') -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $script:PrintInstallation.Root 'apps/print-agent/package.json'), '{"type":"module"}')
            Save-AntojitPrintRecord -Path $config.ActivePath -Value @{ RuntimeDirectory = 'previous-release' }
            Mock Get-AntojitPodman { 'podman.exe' }
            Mock Invoke-AntojitCommand {
                param($FilePath, $Arguments)
                if ($Arguments[0] -eq 'compose') { return @('postgres:17-alpine', 'antojitos-pilot-print-agent:local') }
                if ($Arguments[0] -eq 'image') { return ('a' * 64) }
                if ($Arguments[0] -eq 'cp') {
                    New-Item -ItemType Directory -Path $Arguments[2] -Force | Out-Null
                    foreach ($name in @('main', 'config', 'api-client', 'printer', 'escpos', 'windows-spooler')) {
                        [IO.File]::WriteAllText((Join-Path $Arguments[2] "$name.js"), '// compiled fixture PRINT_AGENT_STOP_FILE')
                    }
                }
            }
            $release = Prepare-AntojitNativePrintAgent -Installation $script:PrintInstallation -SourceRoot $script:PrintInstallation.Root
            Assert-AntojitPrintRuntime -RuntimeDirectory $release
            (Get-Content -LiteralPath $config.ActivePath -Raw | ConvertFrom-Json).RuntimeDirectory | Should -Be 'previous-release'
            (Get-Content -LiteralPath $config.PreparedPath -Raw | ConvertFrom-Json).RuntimeDirectory | Should -Be $release
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'create' }
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'rm' }
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter { $Arguments[0] -in @('run', 'start') }
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter { ($Arguments -join '|') -eq 'image|inspect|--format|{{.Id}}|antojitos-pilot-print-agent:local' }
        }

        It 'requests a graceful stop and does not force-kill an in-flight print on timeout' {
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja'
            $script:StopPrintProcess = [pscustomobject]@{ Id = 814 }
            $script:StopPrintProcess | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Timeout) return $false }
            Mock Get-AntojitManagedPrintProcess { $script:StopPrintProcess }
            Mock Stop-Process { throw 'A print must not be killed.' }
            { Stop-AntojitNativePrintAgent -Installation $script:PrintInstallation -TimeoutSeconds 0 } | Should -Throw '*no duplicar*'
            Test-Path -LiteralPath $config.StopPath | Should -BeTrue
            Should -Invoke Stop-Process -Times 0 -Exactly
        }

        It 'refuses to interrupt a manually launched old USB agent' {
            Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja' | Out-Null
            Mock Get-AntojitManagedPrintProcess { $null }
            Mock Get-AntojitPrintProcesses { [pscustomobject]@{ ProcessId = 91; CommandLine = 'node --env-file=.env.print-agent apps/print-agent/dist/main.js' } }
            { Stop-AntojitNativePrintAgent -Installation $script:PrintInstallation } | Should -Throw '*Cierra su consola*'
        }

        It 'does not mistake a reused PID for the managed USB process' {
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja'
            Save-AntojitPrintRecord -Path $config.ProcessPath -Value @{ ProcessId = 80; StartedAt = 'old-start'; MainPath = 'old-main' }
            Mock Get-Process { [pscustomobject]@{ Id = 80; StartTime = [datetime]'2026-01-01T00:00:00Z' } }
            Get-AntojitManagedPrintProcess -Configuration $config | Should -BeNullOrEmpty
        }

        It 'starts the prepared Windows runtime and clears inherited simulator overrides only for launch' {
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja'
            $release = Join-Path $config.StateDirectory 'releases/test-release'
            New-Item -ItemType Directory -Path (Join-Path $release 'dist') -Force | Out-Null
            foreach ($name in @('main', 'config', 'api-client', 'printer', 'escpos', 'windows-spooler')) {
                [IO.File]::WriteAllText((Join-Path $release "dist/$name.js"), '// compiled fixture PRINT_AGENT_STOP_FILE')
            }
            [IO.File]::WriteAllText((Join-Path $release 'package.json'), '{"type":"module"}')
            $script:StartPrintProcess = [pscustomobject]@{ Id = 920; StartTime = [datetime]'2026-01-01T00:00:00Z' }
            $script:StartPrintProcess | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Timeout) return $false }
            Mock Get-AntojitManagedPrintProcess { $null }
            Mock Get-AntojitNode { 'node.exe' }
            Mock Get-AntojitInstalledPrinter { [pscustomobject]@{ Name = 'USB Caja' } }
            Mock Invoke-AntojitCompose { }
            Mock Start-Process {
                param($FilePath, $ArgumentList, $RedirectStandardOutput)
                $env:PRINT_AGENT_MODE | Should -BeNullOrEmpty
                $env:PRINT_AGENT_STOP_FILE | Should -Not -BeNullOrEmpty
                $ArgumentList | Should -Match '--env-file='
                [IO.File]::WriteAllText($RedirectStandardOutput, 'Agente activo en modo system')
                return $script:StartPrintProcess
            }
            $previous = $env:PRINT_AGENT_MODE
            try {
                $env:PRINT_AGENT_MODE = 'simulator'
                Start-AntojitNativePrintAgent -Installation $script:PrintInstallation -RuntimeDirectory $release
                $env:PRINT_AGENT_MODE | Should -Be 'simulator'
            } finally { $env:PRINT_AGENT_MODE = $previous }
            Should -Invoke Invoke-AntojitCompose -Times 1 -Exactly -ParameterFilter { ($Arguments -join '|') -eq 'rm|--stop|--force|print-agent' }
            (Get-Content -LiteralPath $config.ActivePath -Raw | ConvertFrom-Json).RuntimeDirectory | Should -Be $release
            (Get-Content -LiteralPath $config.ProcessPath -Raw | ConvertFrom-Json).ProcessId | Should -Be 920
        }

        It 'requests a graceful stop if saving the new process identity fails' {
            $config = Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja'
            $release = Join-Path $config.StateDirectory 'releases/test-release'
            $script:UnrecordedPrintProcess = [pscustomobject]@{ Id = 921; StartTime = [datetime]'2026-01-01T00:00:00Z' }
            $script:UnrecordedPrintProcess | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Timeout) return $true }
            Mock Assert-AntojitPrintRuntime { }
            Mock Get-AntojitManagedPrintProcess { $null }
            Mock Get-AntojitNode { 'node.exe' }
            Mock Get-AntojitInstalledPrinter { [pscustomobject]@{ Name = 'USB Caja' } }
            Mock Invoke-AntojitCompose { }
            Mock Start-Process { $script:UnrecordedPrintProcess }
            Mock Save-AntojitPrintRecord { throw 'Fixture disk failure.' }
            { Start-AntojitNativePrintAgent -Installation $script:PrintInstallation -RuntimeDirectory $release } | Should -Throw '*PID 921*'
            Test-Path -LiteralPath $config.StopPath | Should -BeTrue
        }

        It 'upgrades only this installation startup time limit and preserves the other settings and credentials' {
            Initialize-AntojitPrintConfiguration -Installation $script:PrintInstallation -PrinterQueue 'USB Caja' | Out-Null
            $script:PrintInstallation | Add-Member -NotePropertyName OwnerSid -NotePropertyValue 'S-1-5-21-1-2-3-1000'
            $script:PrintStartupTask = [pscustomobject]@{
                Actions = @([pscustomobject]@{
                    WorkingDirectory = $script:PrintInstallation.Root
                    Execute = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
                    Arguments = ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Action Start -Unattended -InstallPath "{1}"' -f (Join-Path $script:PrintInstallation.Root 'final_script.ps1'), $script:PrintInstallation.Root)
                })
                Principal = [pscustomobject]@{ UserId = $script:PrintInstallation.OwnerSid }
                Settings = [pscustomobject]@{ ExecutionTimeLimit = 'PT15M'; StartWhenAvailable = $true }
            }
            Mock Get-AntojitPrintStartupTask { $script:PrintStartupTask }
            Mock Set-AntojitPrintStartupTaskSettings { }
            Update-AntojitNativePrintTask -Installation $script:PrintInstallation
            Should -Invoke Set-AntojitPrintStartupTaskSettings -Times 1 -Exactly -ParameterFilter { $Settings.ExecutionTimeLimit -eq 'PT0S' -and $Settings.StartWhenAvailable }
            $script:PrintStartupTask.Actions[0].Arguments = 'another application'
            $script:PrintStartupTask.Settings.ExecutionTimeLimit = 'PT15M'
            Update-AntojitNativePrintTask -Installation $script:PrintInstallation
            Should -Invoke Set-AntojitPrintStartupTaskSettings -Times 1 -Exactly
        }
    }
}
