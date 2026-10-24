#requires -Version 5.1

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1') -Force
    $script:LoggingNativeExecutable = if ($PSVersionTable.PSEdition -eq 'Desktop') {
        Join-Path $PSHOME 'powershell.exe'
    } else {
        Join-Path $PSHOME 'pwsh'
    }
}

Describe 'Persistent Windows command diagnostics' {
    BeforeEach {
        $script:LoggingOriginalPhase = $env:ANTOJITOS_LOG_PATH
        $script:LoggingOriginalSession = $env:ANTOJITOS_SESSION_LOG_PATH
        $script:LoggingPhasePath = Join-Path $TestDrive 'operation.log'
        $script:LoggingSessionPath = Join-Path $TestDrive 'session\commands.log'
        Remove-Item -LiteralPath $script:LoggingPhasePath, $script:LoggingSessionPath -Force -ErrorAction SilentlyContinue
        $env:ANTOJITOS_SESSION_LOG_PATH = $script:LoggingSessionPath
        Start-AntojitLog -Path $script:LoggingPhasePath
    }

    AfterEach {
        $env:ANTOJITOS_LOG_PATH = $script:LoggingOriginalPhase
        $env:ANTOJITOS_SESSION_LOG_PATH = $script:LoggingOriginalSession
    }

    It 'retains native stdout, stderr and the failure code in operation and session logs' {
        $command = '[Console]::Out.WriteLine("fixture stdout diagnostic"); [Console]::Error.WriteLine("fixture stderr diagnostic"); exit 23'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        {
            Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -WorkingDirectory $TestDrive
        } | Should -Throw '*23*'
        foreach ($path in @($script:LoggingPhasePath, $script:LoggingSessionPath)) {
            $text = Get-Content -LiteralPath $path -Raw
            $text | Should -Match 'fixture stdout diagnostic'
            $text | Should -Match 'fixture stderr diagnostic'
            $text | Should -Match '\[EXIT\] 23;'
            $text | Should -Match '\[CMD\]'
            $text | Should -Match ([regex]::Escape($TestDrive))
        }
    }

    It 'keeps captured native JSON machine readable while also saving diagnostics' {
        $command = '[Console]::Out.WriteLine(''{"status":"ready","database":"connected"}''); [Console]::Error.WriteLine("fixture readiness warning"); exit 0'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = @(Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Capture -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded))
        $output.Count | Should -Be 1
        $record = $output[0] | ConvertFrom-Json
        $record.status | Should -Be 'ready'
        $record.database | Should -Be 'connected'
        Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Match '\[EXIT\] 0;'
        Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Match 'fixture readiness warning'
    }

    It 'includes the native diagnostic and complete log path in the reported failure' {
        $command = '[Console]::Out.WriteLine("build context"); [Console]::Error.WriteLine("fixture build could not connect to Podman"); exit 19'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $failure = $null
        try { Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) }
        catch { $failure = $_ }
        $failure | Should -Not -BeNullOrEmpty
        $failure.Exception.Message | Should -Match 'codigo 19'
        $failure.Exception.Message | Should -Match 'fixture build could not connect to Podman'
        $failure.Exception.Message | Should -Match ([regex]::Escape($script:LoggingPhasePath))
        $failure.Exception.Message | Should -Match ([regex]::Escape($script:LoggingNativeExecutable))
    }

    It 'reports stdout when the failing tool has no stderr diagnostic' {
        $command = '[Console]::Out.WriteLine("fixture compile failed on stdout"); exit 27'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        { Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) } |
            Should -Throw '*fixture compile failed on stdout*'
    }

    It 'reports the build failure on stdout even when stderr only contains a warning' {
        $command = '[Console]::Error.WriteLine("fixture deprecated warning"); [Console]::Out.WriteLine("fixture API build failed on stdout"); exit 111'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $failure = $null
        try { Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) }
        catch { $failure = $_ }
        $failure | Should -Not -BeNullOrEmpty
        $failure.Exception.Message | Should -Match 'codigo 111'
        $failure.Exception.Message | Should -Match '\[stdout\] fixture API build failed on stdout'
        $failure.Exception.Message | Should -Match '\[stderr\] fixture deprecated warning'
    }

    It 'explains an early npm connection failure after its warning leaves the diagnostic tail: <ErrorCode>' -TestCases @(
        @{ ErrorCode = 'ETIMEDOUT' }
        @{ ErrorCode = 'ECONNRESET' }
        @{ ErrorCode = 'EAI_AGAIN' }
        @{ ErrorCode = 'ENOTFOUND' }
        @{ ErrorCode = 'ENETUNREACH' }
        @{ ErrorCode = 'ECONNREFUSED' }
    ) {
        param($ErrorCode)
        $command = '[Console]::Out.WriteLine("WARN GET https://registry.npmjs.org/fixture error (' + $ErrorCode + '). Will retry in 5 seconds"); 1..30 | ForEach-Object { [Console]::Out.WriteLine("fixture build line $_") }; exit 111'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $failure = $null
        try { Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) }
        catch { $failure = $_ }
        $failure | Should -Not -BeNullOrEmpty
        $failure.Exception.Message | Should -Match 'codigo 111'
        $failure.Exception.Message | Should -Match 'fixture build line 30'
        $failure.Exception.Message | Should -Not -Match 'Will retry in'
        $failure.Exception.Message | Should -Match 'Se registraron problemas de conexion con registry\.npmjs\.org durante la descarga'
        $failure.Exception.Message | Should -Match 'Internet.*DNS de Podman.*VPN o cortafuegos'
        $failure.Exception.Message | Should -Match 'mismo ZIP'
        Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Match ([regex]::Escape("error ($ErrorCode). Will retry in"))
    }

    It 'allows an npm retry to recover without reporting a command failure' {
        $command = '[Console]::Error.WriteLine("WARN GET https://registry.npmjs.org/fixture error (ETIMEDOUT). Will retry in 5 seconds"); [Console]::Out.WriteLine("fixture recovered"); exit 0'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = @(Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Capture -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded))
        $output.Count | Should -Be 1
        $output[0] | Should -Be 'fixture recovered'
        $log = Get-Content -LiteralPath $script:LoggingPhasePath -Raw
        $log | Should -Match '\[EXIT\] 0;'
        $log | Should -Not -Match 'Se registraron problemas de conexion'
    }

    It 'does not diagnose npm for an unrelated failure: <Diagnostic>' -TestCases @(
        @{ Diagnostic = 'GET https://example.org/fixture error (ETIMEDOUT)' }
        @{ Diagnostic = 'GET https://registry.npmjs.org.example.org/fixture error (ETIMEDOUT)' }
        @{ Diagnostic = 'fixture compilation failed' }
    ) {
        param($Diagnostic)
        $command = '[Console]::Error.WriteLine("' + $Diagnostic + '"); exit 17'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $failure = $null
        try { Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) }
        catch { $failure = $_ }
        $failure | Should -Not -BeNullOrEmpty
        $failure.Exception.Message | Should -Match 'codigo 17'
        $failure.Exception.Message | Should -Match ([regex]::Escape($Diagnostic))
        $failure.Exception.Message | Should -Not -Match 'Se registraron problemas de conexion'
    }

    It 'bounds each output channel independently so one cannot discard the other diagnostic' {
        $command = '1..30 | ForEach-Object { [Console]::Out.WriteLine("fixture stdout line $_") }; 1..30 | ForEach-Object { [Console]::Error.WriteLine("fixture stderr line $_") }; exit 33'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $failure = $null
        try { Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) }
        catch { $failure = $_ }
        foreach ($stream in @('stdout', 'stderr')) {
            $failure.Exception.Message | Should -Match "\[$stream\] fixture $stream line 30"
            $failure.Exception.Message | Should -Not -Match "fixture $stream line 1(?:\D|$)"
            [regex]::Matches($failure.Exception.Message, "(?m)^\[$stream\] ").Count | Should -Be 12
            Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Match "fixture $stream line 1(?:\D|$)"
        }
    }

    It 'bounds and redacts the diagnostic tail while retaining the complete log' {
        $command = '1..30 | ForEach-Object { [Console]::Error.WriteLine("fixture error line $_") }; [Console]::Error.WriteLine("TOKEN=fixture-command-secret"); exit 31'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $failure = $null
        try { Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) }
        catch { $failure = $_ }
        $failure.Exception.Message | Should -Match 'fixture error line 30'
        $failure.Exception.Message | Should -Not -Match 'fixture error line 1(?:\D|$)'
        $failure.Exception.Message | Should -Not -Match 'fixture-command-secret'
        $failure.Exception.Message | Should -Match 'TOKEN=\[REDACTED\]'
        Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Match 'fixture error line 1(?:\D|$)'
    }

    It 'redacts a private key even when its BEGIN marker has fallen outside the error tail' {
        $command = '[Console]::Error.WriteLine("-----BEGIN PRIVATE KEY-----"); 1..20 | ForEach-Object { [Console]::Error.WriteLine("fixture-private-key-body-$_") }; [Console]::Error.WriteLine("-----END PRIVATE KEY-----"); exit 32'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $failure = $null
        try { Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) }
        catch { $failure = $_ }
        $failure.Exception.Message | Should -Not -Match 'fixture-private-key-body'
        $failure.Exception.Message | Should -Match '\[PRIVATE KEY REDACTED\]'
        Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Not -Match 'fixture-private-key-body'
    }

    It 'drains both native pipes without mixing stderr into captured stdout' {
        $command = '1..80 | ForEach-Object { [Console]::Out.WriteLine(("o" * 1024)); [Console]::Error.WriteLine(("e" * 1024)) }; exit 0'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = @(Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Capture -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) 6>$null)
        $output.Count | Should -Be 80
        $output[0] | Should -BeExactly ('o' * 1024)
        $output[-1] | Should -BeExactly ('o' * 1024)
        Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Match '\[stderr\] e{1024}'
    }

    It 'preserves a process launch error instead of replacing it with a missing exit code' {
        $missing = Join-Path $TestDrive 'missing-native-executable.exe'
        $failure = $null
        try { Invoke-AntojitCommand -FilePath $missing }
        catch { $failure = $_ }
        $failure | Should -Not -BeNullOrEmpty
        $failure.Exception.ToString() | Should -Match ([regex]::Escape($missing))
        $failure.Exception.Message | Should -Not -Match 'termino con codigo sin codigo'
        Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Match 'Win32Exception'
    }

    It 'preserves spaces, empty strings, embedded quotes and trailing backslashes in native arguments' {
        $fixture = Join-Path $TestDrive 'echo native arguments.ps1'
        'ConvertTo-Json -InputObject @($args) -Compress' | Set-Content -LiteralPath $fixture -Encoding UTF8
        $arguments = @('', 'two words', 'say "hello"', 'C:\folder with spaces\', 'literal $() and & characters')
        $output = @(Invoke-AntojitCommand -FilePath $script:LoggingNativeExecutable -Capture -Arguments (@('-NoProfile', '-NonInteractive', '-File', $fixture) + $arguments))
        $actual = ($output -join "`n") | ConvertFrom-Json
        @($actual).Count | Should -Be $arguments.Count
        for ($i = 0; $i -lt $arguments.Count; $i++) { $actual[$i] | Should -BeExactly $arguments[$i] }
    }

    It 'redacts pilot credentials and configuration secrets before saving the logs' {
        $codeLabel = 'C' + [char]0xF3 + 'digo'
        Write-AntojitLog -Message "$codeLabel ADMIN: 73918264"
        Write-AntojitLog -Message "$codeLabel MESERO: 48619372"
        Write-AntojitLog -Message 'Token para registrar terminales: terminal-secret-for-fixture'
        Write-AntojitLog -Message 'DATABASE_PASSWORD=database-secret-for-fixture'
        Write-AntojitLog -Message '{"adminPin":"json-pin-for-fixture","status":"configured"}'
        Write-AntojitLog -Message 'postgres://restaurant:url-password-for-fixture@localhost/antojitos'
        Write-AntojitLog -Message 'Configuration completed.'
        foreach ($path in @($script:LoggingPhasePath, $script:LoggingSessionPath)) {
            $text = Get-Content -LiteralPath $path -Raw
            foreach ($secret in @('73918264', '48619372', 'terminal-secret-for-fixture', 'database-secret-for-fixture', 'json-pin-for-fixture', 'url-password-for-fixture')) {
                $text | Should -Not -Match ([regex]::Escape($secret))
            }
            $text | Should -Match '\[REDACTED\]'
            $text | Should -Match 'Configuration completed\.'
        }
    }

    It 'saves the original error message, position and stack for a managed failure' {
        try { throw 'Fixture managed diagnostic failure.' }
        catch { Write-AntojitError -ErrorRecord $_ }
        $text = Get-Content -LiteralPath $script:LoggingPhasePath -Raw
        $text | Should -Match 'Fixture managed diagnostic failure'
        $text | Should -Match 'Logging.Tests.ps1'
        $text | Should -Match '\[POSITION\]'
        $text | Should -Match '\[STACK\]'
    }

    It 'returns only the original error message without printing or writing logs' {
        $before = Get-Content -LiteralPath $script:LoggingPhasePath -Raw
        $summary = @()
        try { throw "Fixture update failed.`nUseful original diagnostic." }
        catch { $summary = @(Get-AntojitErrorSummary -ErrorRecord $_) }
        $summary.Count | Should -Be 1
        $summary[0] | Should -Be ("Fixture update failed." + [Environment]::NewLine + 'Useful original diagnostic.')
        $summary[0] | Should -Not -Match '\[STACK\]|\[POSITION\]|OperationStopped'
        Get-Content -LiteralPath $script:LoggingPhasePath -Raw | Should -Be $before
    }

    It 'redacts credentials and complete private key blocks from the error summary' {
        $message = "TOKEN=fixture-summary-secret`npostgres://restaurant:fixture-summary-password@localhost/antojitos`n-----BEGIN PRIVATE KEY-----`nfixture-summary-key-body`n-----END PRIVATE KEY-----`nFixture original failure."
        $summary = $null
        try { throw $message }
        catch { $summary = Get-AntojitErrorSummary -ErrorRecord $_ }
        $summary | Should -Match 'TOKEN=\[REDACTED\]'
        $summary | Should -Match 'postgres://\[REDACTED\]@localhost/antojitos'
        $summary | Should -Match '\[PRIVATE KEY REDACTED\]'
        $summary | Should -Match 'Fixture original failure\.'
        $summary | Should -Not -Match 'fixture-summary-secret|fixture-summary-password|fixture-summary-key-body'
    }

    It 'redacts an unterminated private key and does not affect the next error summary' {
        $summary = $null
        try { throw "Fixture precheck failed.`n-----BEGIN RSA PRIVATE KEY-----`nfixture-truncated-key-body`nmore-truncated-key-body" }
        catch { $summary = Get-AntojitErrorSummary -ErrorRecord $_ }
        $summary | Should -Match 'Fixture precheck failed\.'
        $summary | Should -Match '\[PRIVATE KEY REDACTED\]'
        $summary | Should -Not -Match 'truncated-key-body'
        try { throw 'Fixture next failure.' }
        catch { Get-AntojitErrorSummary -ErrorRecord $_ | Should -Be 'Fixture next failure.' }
    }
}
