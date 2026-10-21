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
}
