#requires -Version 5.1

Describe 'Legacy installation launcher repair' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1') -Force
        $tokens = $null
        $parseErrors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile(
            (Join-Path $PSScriptRoot '..\01-instalar.ps1'), [ref] $tokens, [ref] $parseErrors
        )
        if ($parseErrors.Count -gt 0) { throw 'The installer must parse before testing launcher repair.' }
        $resolver = $ast.Find({
            param($node)
            $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
                $node.Name -eq 'Resolve-AntojitLauncher'
        }, $false)
        if ($null -eq $resolver) { throw 'The launcher repair function was not found.' }
        . ([scriptblock]::Create($resolver.Extent.Text))

        function Write-LauncherFixture {
            param([string]$Root, [string]$RelativePath, [string]$Content)
            $path = Join-Path $Root $RelativePath
            New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
            [IO.File]::WriteAllText($path, $Content, (New-Object Text.UTF8Encoding($false)))
        }

        function Get-LauncherFixtureHashes {
            param([string]$Root)
            $hashes = @{}
            foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File -Force) {
                $hashes[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            }
            return $hashes
        }

        function Assert-LauncherFixtureUnchanged {
            param([string]$Root, [hashtable]$Hashes)
            @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force).Count | Should -Be $Hashes.Count
            foreach ($path in $Hashes.Keys) {
                (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash | Should -Be $Hashes[$path]
            }
        }
    }

    BeforeEach {
        $script:LauncherSource = Join-Path $TestDrive 'new preparation'
        $script:LauncherInstalled = Join-Path $TestDrive 'installed restaurant'
        $script:LauncherBootstrap = Join-Path $TestDrive 'program data'
        $script:LauncherFiles = @('final_script.ps1', 'scripts\windows\01-instalar.ps1',
            'scripts\windows\02-iniciar.ps1', 'scripts\windows\03-actualizar.ps1',
            'scripts\windows\AntojitOS.Windows.psm1', 'scripts\windows\AntojitOS.Dependencies.psm1',
            'scripts\windows\AntojitOS.Printing.psm1', 'scripts\windows\AntojitOS.Update.psm1')
        foreach ($file in $script:LauncherFiles) {
            foreach ($root in @($script:LauncherSource, $script:LauncherInstalled)) {
                Write-LauncherFixture -Root $root -RelativePath $file -Content "# $file`nparam([switch]`$Managed)"
            }
        }
        $script:LauncherInstallation = [pscustomobject]@{ Root = $script:LauncherInstalled }
        Mock Protect-AntojitPath { }
        Mock Write-AntojitLog { }
    }

    It 'uses an identical installed runtime without copying an external bundle' {
        Mock Copy-Item { throw 'An identical runtime must not be copied.' }
        $launcher = Resolve-AntojitLauncher -SourceRoot $script:LauncherSource -Root $script:LauncherInstalled `
            -BootstrapDirectory $script:LauncherBootstrap -OwnerSid 'fixture-owner' -Installation $script:LauncherInstallation
        $launcher | Should -Be (Join-Path $script:LauncherInstalled 'final_script.ps1')
        Test-Path -LiteralPath $script:LauncherBootstrap | Should -BeFalse
        Should -Invoke Copy-Item -Times 0 -Exactly
        Should -Invoke Protect-AntojitPath -Times 0 -Exactly
    }

    It 'stages a protected current launcher while preserving the old checkout and local secrets byte for byte' {
        Remove-Item -LiteralPath (Join-Path $script:LauncherInstalled 'final_script.ps1')
        Write-LauncherFixture -Root $script:LauncherInstalled -RelativePath 'scripts\windows\02-iniciar.ps1' -Content '# old helper without managed mode'
        Write-LauncherFixture -Root $script:LauncherInstalled -RelativePath '.env.pilot' -Content 'DATABASE_PASSWORD=existing-local-secret'
        Write-LauncherFixture -Root $script:LauncherInstalled -RelativePath '.env' -Content 'LOCAL_CONFIG=existing-value'
        Write-LauncherFixture -Root $script:LauncherInstalled -RelativePath '.git/config' -Content '[core]'
        Write-LauncherFixture -Root $script:LauncherInstalled -RelativePath '.git/objects/aa/object' -Content 'existing git object'
        Write-LauncherFixture -Root $script:LauncherInstalled -RelativePath 'apps/api/src/main.ts' -Content 'existing tracked source'
        Write-LauncherFixture -Root $script:LauncherSource -RelativePath '.env.pilot' -Content 'DATABASE_PASSWORD=do-not-copy-this'
        $installedHashes = Get-LauncherFixtureHashes -Root $script:LauncherInstalled
        $sourceHashes = Get-LauncherFixtureHashes -Root $script:LauncherSource

        $launcher = Resolve-AntojitLauncher -SourceRoot $script:LauncherSource -Root $script:LauncherInstalled `
            -BootstrapDirectory $script:LauncherBootstrap -OwnerSid 'fixture-owner' -Installation $script:LauncherInstallation

        $bundle = Join-Path $script:LauncherBootstrap 'launcher'
        $launcher | Should -Be (Join-Path $bundle 'final_script.ps1')
        @(Get-ChildItem -LiteralPath $bundle -Recurse -File -Force).Count | Should -Be $script:LauncherFiles.Count
        foreach ($file in $script:LauncherFiles) {
            (Get-FileHash -LiteralPath (Join-Path $bundle $file)).Hash | Should -Be (Get-FileHash -LiteralPath (Join-Path $script:LauncherSource $file)).Hash
        }
        Should -Invoke Protect-AntojitPath -Times 1 -Exactly -ParameterFilter {
            (Split-Path -Leaf $Path) -like 'launcher-stage-*' -and $OwnerSid -eq 'fixture-owner'
        }
        Assert-LauncherFixtureUnchanged -Root $script:LauncherInstalled -Hashes $installedHashes
        Assert-LauncherFixtureUnchanged -Root $script:LauncherSource -Hashes $sourceHashes
        @(Get-ChildItem -LiteralPath $script:LauncherBootstrap -Directory | Where-Object Name -like 'launcher-stage-*').Count | Should -Be 0
    }

    It 'keeps the previous launcher intact when copying the replacement fails' {
        Remove-Item -LiteralPath (Join-Path $script:LauncherInstalled 'final_script.ps1')
        $bundle = Join-Path $script:LauncherBootstrap 'launcher'
        Write-LauncherFixture -Root $bundle -RelativePath 'final_script.ps1' -Content '# previous working launcher'
        Write-LauncherFixture -Root $bundle -RelativePath 'scripts/windows/02-iniciar.ps1' -Content '# previous working startup helper'
        $previousHashes = Get-LauncherFixtureHashes -Root $bundle
        Mock Copy-Item { throw 'Fixture replacement copy failed.' } -ParameterFilter {
            [IO.Path]::GetFileName($LiteralPath) -eq '02-iniciar.ps1'
        }

        {
            Resolve-AntojitLauncher -SourceRoot $script:LauncherSource -Root $script:LauncherInstalled `
                -BootstrapDirectory $script:LauncherBootstrap -OwnerSid 'fixture-owner' -Installation $script:LauncherInstallation
        } | Should -Throw '*Fixture replacement copy failed*'

        Assert-LauncherFixtureUnchanged -Root $bundle -Hashes $previousHashes
        @(Get-ChildItem -LiteralPath $script:LauncherBootstrap -Directory | Where-Object Name -like 'launcher-stage-*').Count | Should -Be 0
    }
}
