#requires -Version 5.1

Describe 'Installation source copying' {
    BeforeAll {
        $installer = Join-Path $PSScriptRoot '..\01-instalar.ps1'
        $tokens = $null
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            $installer, [ref] $tokens, [ref] $parseErrors
        )
        if ($parseErrors.Count -gt 0) { throw 'The installer must parse before testing its source copier.' }
        $copier = $ast.Find({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                $node.Name -eq 'Copy-AntojitSource'
        }, $false)
        if ($null -eq $copier) { throw 'The installation source copier was not found.' }
        # Execute the real recursive copier without running installer side effects.
        . ([scriptblock]::Create($copier.Extent.Text))

        function Write-SourceFixture {
            param([string]$Root, [string]$RelativePath, [string]$Content)
            $path = Join-Path $Root $RelativePath
            New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
            Set-Content -LiteralPath $path -Value $Content
        }
    }

    It 'copies code and configuration examples while leaving secrets and generated files in the source' {
        $source = Join-Path $TestDrive 'source'
        $destination = Join-Path $TestDrive 'installed'
        $fixtures = @{
            'package.json' = '{"name":"fixture"}'
            '.env' = 'SECRET=local-only'
            '.env.pilot' = 'DATABASE_PASSWORD=local-only'
            '.env.example' = 'SECRET=replace-me'
            '.env.pilot.example' = 'DATABASE_PASSWORD=replace-me'
            'var/windows/installation.json' = '{"Root":"original-pc"}'
            'backups/orders.dump' = 'local customer data'
            'apps/api/src/main.ts' = 'export const application = true;'
            'apps/api/node_modules/dependency/index.js' = 'generated dependency'
            'apps/api/dist/main.js' = 'generated build'
            'apps/api/.env.production' = 'NESTED_SECRET=local-only'
            'scripts/windows/02-iniciar.ps1' = '# application startup source'
        }
        foreach ($relative in $fixtures.Keys) {
            Write-SourceFixture -Root $source -RelativePath $relative -Content $fixtures[$relative]
        }
        $originalHashes = @{}
        foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File -Force) {
            $originalHashes[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }

        Copy-AntojitSource -Source $source -Destination $destination -IncludeGitHistory $false

        $copied = @(Get-ChildItem -LiteralPath $destination -Recurse -File -Force | ForEach-Object {
            $_.FullName.Substring($destination.Length + 1).Replace('\', '/')
        } | Sort-Object)
        $expected = @('.env.example', '.env.pilot.example', 'apps/api/src/main.ts', 'package.json', 'scripts/windows/02-iniciar.ps1') | Sort-Object
        ($copied -join '|') | Should -Be ($expected -join '|')
        @(Get-ChildItem -LiteralPath $source -Recurse -File -Force).Count | Should -Be $originalHashes.Count
        foreach ($path in $originalHashes.Keys) {
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash | Should -Be $originalHashes[$path]
        }
    }

    It 'copies a Git history directory only when requested' {
        $source = Join-Path $TestDrive 'git-source'
        Write-SourceFixture -Root $source -RelativePath '.git/config' -Content '[core]'
        Write-SourceFixture -Root $source -RelativePath '.git/objects/aa/object' -Content 'history fixture'
        Write-SourceFixture -Root $source -RelativePath 'app.ts' -Content 'application source'
        $withoutHistory = Join-Path $TestDrive 'snapshot'
        $withHistory = Join-Path $TestDrive 'clone'

        Copy-AntojitSource -Source $source -Destination $withoutHistory -IncludeGitHistory $false
        Copy-AntojitSource -Source $source -Destination $withHistory -IncludeGitHistory $true

        Test-Path -LiteralPath (Join-Path $withoutHistory '.git') | Should -BeFalse
        Get-Content -LiteralPath (Join-Path $withHistory '.git/config') -Raw | Should -Match '\[core\]'
        Get-Content -LiteralPath (Join-Path $withHistory '.git/objects/aa/object') -Raw | Should -Match 'history fixture'
        Test-Path -LiteralPath (Join-Path $withoutHistory 'app.ts') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $source '.git/objects/aa/object') | Should -BeTrue
    }

    It 'never copies a worktree Git pointer even when history is requested' {
        $source = Join-Path $TestDrive 'worktree-source'
        Write-SourceFixture -Root $source -RelativePath '.git' -Content 'gitdir: C:\developer-pc\repository\.git\worktrees\fixture'
        Write-SourceFixture -Root $source -RelativePath 'app.ts' -Content 'application source'
        foreach ($includeHistory in @($false, $true)) {
            $destination = Join-Path $TestDrive ("worktree-copy-$includeHistory")
            Copy-AntojitSource -Source $source -Destination $destination -IncludeGitHistory $includeHistory
            Test-Path -LiteralPath (Join-Path $destination '.git') | Should -BeFalse
            Test-Path -LiteralPath (Join-Path $destination 'app.ts') | Should -BeTrue
        }
        Get-Content -LiteralPath (Join-Path $source '.git') -Raw | Should -Match '^gitdir: C:'
    }
}
