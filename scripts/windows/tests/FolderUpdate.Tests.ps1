#requires -Version 5.1

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Windows.psm1') -Force -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Printing.psm1') -Force -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Update.psm1') -Force -DisableNameChecking

    function Write-FolderUpdateFile {
        param([string]$Root, [string]$RelativePath, [string]$Content)
        $path = Join-Path $Root $RelativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
        [IO.File]::WriteAllText($path, $Content, (New-Object Text.UTF8Encoding($false)))
    }

    function New-FolderUpdateFixture {
        param([string]$Root)
        $files = @{
            'package.json' = '{"name":"antojit-os","private":true}'
            'pnpm-lock.yaml' = "lockfileVersion: '9.0'"
            'pnpm-workspace.yaml' = "packages:`n  - apps/*`n  - packages/*"
            'tsconfig.base.json' = '{}'
            'Containerfile' = 'FROM node:24-alpine'
            'compose.pilot.yaml' = "services:`n  api:`n    image: fixture"
            '.env.pilot.example' = 'DATABASE_PASSWORD=replace-me'
            '.dockerignore' = 'node_modules'
            '.gitignore' = '.env*'
            'final_script.cmd' = '@echo off'
            'final_script.ps1' = '# fixture entry point'
            'ACTUALIZAR-APP.cmd' = '@echo off'
            'apps/api/package.json' = '{"name":"@antojit-os/api"}'
            'apps/api/src/main.ts' = 'export const version = 2;'
            'apps/api/migrations/0001_fixture.sql' = 'CREATE TABLE fixture (id integer);'
            'apps/pos/package.json' = '{"name":"@antojit-os/pos"}'
            'apps/pos/src/main.ts' = 'export const screen = 2;'
            'apps/print-agent/package.json' = '{"name":"@antojit-os/print-agent"}'
            'apps/print-agent/src/main.ts' = 'export const printer = true;'
            'packages/domain/package.json' = '{"name":"@antojit-os/domain"}'
            'packages/domain/src/index.ts' = 'export const domain = true;'
            'scripts/pilot.mjs' = '// fixture pilot'
            'scripts/check-npm-registry.mjs' = '// fixture npm connectivity check'
            'scripts/windows/01-instalar.ps1' = '# fixture installer'
            'scripts/windows/02-iniciar.ps1' = '# fixture start'
            'scripts/windows/03-actualizar.ps1' = '# fixture updater'
            'scripts/windows/AntojitOS.Update.psm1' = '# fixture update module'
            'scripts/windows/AntojitOS.Windows.psm1' = '# fixture windows module'
            'scripts/windows/AntojitOS.Printing.psm1' = '# fixture printing module'
            'scripts/windows/AntojitOS.Dependencies.psm1' = '# fixture dependencies module'
            'deploy/nginx.conf.template' = 'server { listen 80; }'
        }
        foreach ($relative in $files.Keys) {
            Write-FolderUpdateFile -Root $Root -RelativePath $relative -Content $files[$relative]
        }
    }
}

Describe 'Frozen folder update sources' {
    It 'fingerprints code and relative paths while excluding credentials and generated state' {
        $source = Join-Path $TestDrive 'source with spaces'
        New-FolderUpdateFixture -Root $source
        $privateFiles = @{
            '.env.pilot' = 'DATABASE_PASSWORD=private-source-value'
            '.env.print-agent' = 'BOOTSTRAP_TOKEN=private-source-value'
            'apps/api/.env.production' = 'NESTED_SECRET=private-source-value'
            '.git/config' = 'private local git configuration'
            'var/windows/installation.json' = 'private source installation'
            'backups/source.dump' = 'private source data'
            'apps/api/dist/main.js' = 'generated source build'
            'apps/api/node_modules/local/index.js' = 'generated source dependency'
        }
        foreach ($relative in $privateFiles.Keys) {
            Write-FolderUpdateFile -Root $source -RelativePath $relative -Content $privateFiles[$relative]
        }

        $before = Get-AntojitUpdateManifest -Root $source
        $before.Hash | Should -Match '^[a-fA-F0-9]{64}$'
        $before.Files | Should -Contain 'apps/api/migrations/0001_fixture.sql'
        $before.Files | Should -Contain '.env.pilot.example'
        foreach ($relative in $privateFiles.Keys) { $before.Files | Should -Not -Contain $relative }
        foreach ($relative in $privateFiles.Keys) {
            Write-FolderUpdateFile -Root $source -RelativePath $relative -Content 'changed private state'
        }
        (Get-AntojitUpdateManifest -Root $source).Hash | Should -Be $before.Hash

        Write-FolderUpdateFile -Root $source -RelativePath 'apps/api/src/main.ts' -Content 'export const version = 3;'
        $changed = Get-AntojitUpdateManifest -Root $source
        $changed.Hash | Should -Not -Be $before.Hash
        Move-Item -LiteralPath (Join-Path $source 'apps/api/src/main.ts') -Destination (Join-Path $source 'apps/api/src/renamed.ts')
        (Get-AntojitUpdateManifest -Root $source).Hash | Should -Not -Be $changed.Hash
    }

    It 'freezes a complete project without copying local state or modifying the original' {
        $source = Join-Path $TestDrive 'extracted project'
        $snapshot = Join-Path $TestDrive 'updates\frozen\source'
        New-FolderUpdateFixture -Root $source
        Write-FolderUpdateFile -Root $source -RelativePath '.env.pilot' -Content 'SECRET=source-only'
        Write-FolderUpdateFile -Root $source -RelativePath 'apps/api/.env.local' -Content 'SECRET=nested-source-only'
        Write-FolderUpdateFile -Root $source -RelativePath '.git/index' -Content 'source git index'
        Write-FolderUpdateFile -Root $source -RelativePath 'var/print-agent/credentials.json' -Content 'source credentials'
        $manifest = Get-AntojitUpdateManifest -Root $source

        $frozen = New-AntojitUpdateSnapshot -SourcePath $source -DestinationPath $snapshot
        $frozen.Hash | Should -Be $manifest.Hash
        (Get-AntojitUpdateManifest -Root $snapshot).Hash | Should -Be $manifest.Hash
        Test-Path -LiteralPath (Join-Path $snapshot 'apps/api/migrations/0001_fixture.sql') | Should -BeTrue
        foreach ($relative in @('.env.pilot', 'apps/api/.env.local', '.git', 'var')) {
            Test-Path -LiteralPath (Join-Path $snapshot $relative) | Should -BeFalse
        }
        Get-Content -LiteralPath (Join-Path $source '.env.pilot') -Raw | Should -Be 'SECRET=source-only'
        Get-Content -LiteralPath (Join-Path $source '.git/index') -Raw | Should -Be 'source git index'
        Write-FolderUpdateFile -Root $source -RelativePath 'apps/api/src/main.ts' -Content 'changed after snapshot'
        (Get-AntojitUpdateManifest -Root $snapshot).Hash | Should -Be $manifest.Hash
    }

    It 'fingerprints application paths independently from Windows bootstrap changes' {
        $source = Join-Path $TestDrive 'bootstrap source'
        New-FolderUpdateFixture -Root $source
        $before = Get-AntojitUpdateManifest -Root $source
        $before.ApplicationHash | Should -Match '^[a-f0-9]{64}$'

        foreach ($relative in @('scripts/windows/AntojitOS.Printing.psm1', 'scripts/windows/new-helper.psm1',
            'final_script.ps1', 'final_script.cmd', 'ACTUALIZAR-APP.cmd', 'RECUPERAR-ACTUALIZACION.cmd')) {
            Write-FolderUpdateFile -Root $source -RelativePath $relative -Content '# corrected Windows bootstrap'
        }
        $bootstrapChanged = Get-AntojitUpdateManifest -Root $source
        $bootstrapChanged.Hash | Should -Not -Be $before.Hash
        $bootstrapChanged.ApplicationHash | Should -BeExactly $before.ApplicationHash

        Write-FolderUpdateFile -Root $source -RelativePath 'scripts/pilot.mjs' -Content '// different application lifecycle'
        $pilotChanged = Get-AntojitUpdateManifest -Root $source
        $pilotChanged.ApplicationHash | Should -Not -Be $before.ApplicationHash
        Move-Item -LiteralPath (Join-Path $source 'apps/api/src/main.ts') -Destination (Join-Path $source 'apps/api/src/renamed.ts')
        (Get-AntojitUpdateManifest -Root $source).ApplicationHash | Should -Not -Be $pilotChanged.ApplicationHash
    }

    It 'rejects a snapshot nested inside its source before creating or modifying files' {
        $source = Join-Path $TestDrive 'nested-source'
        $nested = Join-Path $source 'apps/frozen-copy'
        New-FolderUpdateFixture -Root $source
        $before = Get-AntojitUpdateManifest -Root $source

        { New-AntojitUpdateSnapshot -SourcePath $source -DestinationPath $nested } | Should -Throw '*no pueden contenerse*'

        Test-Path -LiteralPath $nested | Should -BeFalse
        (Get-AntojitUpdateManifest -Root $source).Hash | Should -Be $before.Hash
    }

    It 'removes obsolete managed source and migrations while preserving installed secrets, Git and runtime files' {
        $source = Join-Path $TestDrive 'candidate'
        $installed = Join-Path $TestDrive 'installed'
        New-FolderUpdateFixture -Root $source
        New-FolderUpdateFixture -Root $installed
        $protectedFiles = @{
            '.env' = 'local environment'
            '.env.pilot' = 'DATABASE_PASSWORD=keep-local-value'
            '.env.print-agent' = 'BOOTSTRAP_TOKEN=keep-local-token'
            'apps/api/.env.production' = 'NESTED_SECRET=keep-local-value'
            '.git/config' = 'keep installed history configuration'
            '.git/index' = 'keep installed history index'
            'var/windows/installation.json' = 'keep installation settings'
            'var/windows/update-pending.json' = 'keep recovery state'
            'var/print-agent-usb/credentials.json' = 'keep printer credentials'
            'backups/before-update.dump' = 'keep business data'
            'apps/api/node_modules/dependency/index.js' = 'keep generated dependency'
            'apps/api/dist/main.js' = 'keep generated build'
        }
        foreach ($relative in $protectedFiles.Keys) {
            Write-FolderUpdateFile -Root $installed -RelativePath $relative -Content $protectedFiles[$relative]
        }
        Write-FolderUpdateFile -Root $installed -RelativePath 'apps/api/src/removed.ts' -Content 'obsolete source'
        Write-FolderUpdateFile -Root $installed -RelativePath 'apps/api/migrations/9999_removed.sql' -Content 'obsolete migration'
        Write-FolderUpdateFile -Root $installed -RelativePath 'scripts/removed.mjs' -Content 'obsolete script'
        Write-FolderUpdateFile -Root $installed -RelativePath 'apps/api/src/main.ts' -Content 'old source'
        Write-FolderUpdateFile -Root $source -RelativePath '.env.pilot' -Content 'MUST_NOT_REPLACE=local-config'
        Write-FolderUpdateFile -Root $source -RelativePath 'apps/api/.env.production' -Content 'MUST_NOT_REPLACE=nested-config'

        Sync-AntojitUpdateSource -SourcePath $source -DestinationPath $installed

        foreach ($relative in $protectedFiles.Keys) {
            Get-Content -LiteralPath (Join-Path $installed $relative) -Raw | Should -Be $protectedFiles[$relative]
        }
        foreach ($relative in @('apps/api/src/removed.ts', 'apps/api/migrations/9999_removed.sql', 'scripts/removed.mjs')) {
            Test-Path -LiteralPath (Join-Path $installed $relative) | Should -BeFalse
        }
        Get-Content -LiteralPath (Join-Path $installed 'apps/api/src/main.ts') -Raw | Should -Be 'export const version = 2;'
        Test-Path -LiteralPath (Join-Path $installed 'apps/api/migrations/0001_fixture.sql') | Should -BeTrue
    }
}

Describe 'Folder update maintenance and recovery' {
    BeforeEach {
        $suffix = [guid]::NewGuid().ToString('N')
        $global:AntojitFolderFixture = [pscustomobject]@{
            Source = (Join-Path $TestDrive ('source-' + $suffix))
            Installation = [pscustomobject]@{
                Root = (Join-Path $TestDrive ('installed-' + $suffix))
                StateDirectory = $null
                OwnerSid = 'fixture-owner'
                SourceMode = 'snapshot'
                HttpPort = 8080
            }
            Failure = ''
            ApiStarted = $false
            Lease = (New-Object IO.MemoryStream)
        }
        $fixture = $global:AntojitFolderFixture
        $fixture.Installation.StateDirectory = Join-Path $fixture.Installation.Root 'var/windows'
        New-FolderUpdateFixture -Root $fixture.Source
        New-FolderUpdateFixture -Root $fixture.Installation.Root
        New-Item -ItemType Directory -Path $fixture.Installation.StateDirectory -Force | Out-Null
        Write-FolderUpdateFile -Root $fixture.Installation.Root -RelativePath '.env.pilot' -Content 'PRINT_AGENT_MODE=simulator'
        Write-FolderUpdateFile -Root $fixture.Installation.Root -RelativePath 'apps/api/src/main.ts' -Content 'old application source'

        Mock Assert-AntojitWindows { } -ModuleName AntojitOS.Update
        Mock Assert-AntojitAdministrator { } -ModuleName AntojitOS.Update
        Mock Assert-AntojitOwner { } -ModuleName AntojitOS.Update
        Mock Resolve-AntojitInstallPath { $global:AntojitFolderFixture.Installation.Root } -ModuleName AntojitOS.Update
        Mock Get-AntojitInstallation { $global:AntojitFolderFixture.Installation } -ModuleName AntojitOS.Update
        Mock Enter-AntojitOperation { $global:AntojitFolderFixture.Lease } -ModuleName AntojitOS.Update
        Mock Start-AntojitLog { } -ModuleName AntojitOS.Update
        Mock Write-AntojitLog { } -ModuleName AntojitOS.Update
        Mock Protect-AntojitPath { } -ModuleName AntojitOS.Update
        Mock Initialize-AntojitRuntime { } -ModuleName AntojitOS.Update
        Mock Update-AntojitNetwork { } -ModuleName AntojitOS.Update
        Mock Save-AntojitInstallation { } -ModuleName AntojitOS.Update
        Mock Update-AntojitLauncherBundle { } -ModuleName AntojitOS.Update
        Mock Get-AntojitPrintConfiguration {
            [pscustomobject]@{ Mode = 'container'; ActivePath = (Join-Path $global:AntojitFolderFixture.Installation.StateDirectory 'print-agent/active.json') }
        } -ModuleName AntojitOS.Update
        Mock Initialize-AntojitPrintConfiguration { [pscustomobject]@{ Mode = 'container' } } -ModuleName AntojitOS.Update
        Mock Assert-AntojitNativePrintConfiguration { } -ModuleName AntojitOS.Update
        Mock Prepare-AntojitNativePrintAgent { $null } -ModuleName AntojitOS.Update
        Mock Stop-AntojitNativePrintAgent { } -ModuleName AntojitOS.Update
        Mock Start-AntojitNativePrintAgent { } -ModuleName AntojitOS.Update
        Mock Invoke-AntojitCandidateBuild {
            if ($global:AntojitFolderFixture.Failure -eq 'build') { throw 'Fixture candidate build failed.' }
        } -ModuleName AntojitOS.Update
        Mock New-AntojitDatabaseUpdateBackup {
            param($Installation, $BackupDirectory)
            if ($global:AntojitFolderFixture.Failure -eq 'backup') { throw 'Fixture database backup failed.' }
            $path = Join-Path $BackupDirectory 'fixture-verified.dump'
            [IO.File]::WriteAllText($path, 'fixture database backup')
            return $path
        } -ModuleName AntojitOS.Update
        Mock Invoke-AntojitCompose {
            param($Installation, $Arguments)
            if ($Arguments[0] -eq 'up' -and $Arguments -contains 'api') {
                $global:AntojitFolderFixture.ApiStarted = $true
            }
        } -ModuleName AntojitOS.Update
        Mock Invoke-AntojitPilot {
            param($Root, $Command)
            if ($Command -eq 'verify' -and $global:AntojitFolderFixture.Failure -eq 'verify') {
                throw 'Fixture deployed API verification failed.'
            }
        } -ModuleName AntojitOS.Update
        Mock Invoke-RestMethod { [pscustomobject]@{ status = 'ready'; database = 'connected' } } -ModuleName AntojitOS.Update
        Mock Get-AntojitGit { throw 'Folder updates must never require Git.' } -ModuleName AntojitOS.Update
    }

    AfterEach {
        $global:AntojitFolderFixture.Lease.Dispose()
        Remove-Variable AntojitFolderFixture -Scope Global -ErrorAction SilentlyContinue
    }

    It 'deploys verified source and records folder mode without using Git or reseeding' {
        $fixture = $global:AntojitFolderFixture
        Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance

        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root 'apps/api/src/main.ts') -Raw | Should -Be 'export const version = 2;'
        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root '.env.pilot') -Raw | Should -Be 'PRINT_AGENT_MODE=simulator'
        $fixture.Installation.SourceMode | Should -Be 'folder'
        $fixture.Installation.SourceHash | Should -Be (Get-AntojitUpdateManifest -Root $fixture.Source).Hash
        Test-Path -LiteralPath (Join-Path $fixture.Installation.StateDirectory 'update-pending.json') | Should -BeFalse
        $fixture.ApiStarted | Should -BeTrue
        $fixture.Lease.CanWrite | Should -BeFalse
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke New-AntojitDatabaseUpdateBackup -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke Get-AntojitGit -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitPilot -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Command -in @('seed', 'ensure-seeded') }
    }

    It 'requires maintenance before preparing images or changing the installation' {
        $fixture = $global:AntojitFolderFixture
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root } | Should -Throw '*ConfirmMaintenance*'
        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root 'apps/api/src/main.ts') -Raw | Should -Be 'old application source'
        Test-Path -LiteralPath (Join-Path $fixture.Installation.StateDirectory 'update-pending.json') | Should -BeFalse
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly
    }

    It 'rejects the installation itself as update source without acquiring a lock or changing files' {
        $fixture = $global:AntojitFolderFixture
        $before = Get-AntojitUpdateManifest -Root $fixture.Installation.Root

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Installation.Root -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*fuera de la instalacion*'

        (Get-AntojitUpdateManifest -Root $fixture.Installation.Root).Hash | Should -Be $before.Hash
        Should -Invoke Enter-AntojitOperation -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly
        Test-Path -LiteralPath (Join-Path $fixture.Installation.StateDirectory 'update-pending.json') | Should -BeFalse
    }

    It 'rejects an incomplete candidate missing <RelativePath> before locking or replacing installed helpers' -ForEach @(
        @{ RelativePath = 'scripts/windows/02-iniciar.ps1' }
        @{ RelativePath = 'scripts/check-npm-registry.mjs' }
    ) {
        $fixture = $global:AntojitFolderFixture
        $relative = $RelativePath
        $installedPath = Join-Path $fixture.Installation.Root $relative
        $before = [IO.File]::ReadAllText($installedPath)
        if ($relative -eq 'scripts/check-npm-registry.mjs') {
            Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'Containerfile' -Content 'COPY scripts/check-npm-registry.mjs scripts/check-npm-registry.mjs'
        }
        Remove-Item -LiteralPath (Join-Path $fixture.Source $relative) -Force

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw "*$relative*"

        [IO.File]::ReadAllText($installedPath) | Should -BeExactly $before
        Should -Invoke Enter-AntojitOperation -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly
    }

    It 'accepts an older complete release whose Containerfile does not use the npm checker' {
        $fixture = $global:AntojitFolderFixture
        Remove-Item -LiteralPath (Join-Path $fixture.Source 'scripts/check-npm-registry.mjs') -Force

        Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance

        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Test-Path -LiteralPath (Join-Path $fixture.Installation.StateDirectory 'update-pending.json') | Should -BeFalse
    }

    It 'leaves installed code and writers untouched when the staged build fails' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'build'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*candidate build failed*'

        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root 'apps/api/src/main.ts') -Raw | Should -Be 'old application source'
        $pending = Get-Content -LiteralPath (Join-Path $fixture.Installation.StateDirectory 'update-pending.json') -Raw | ConvertFrom-Json
        $pending.Stage | Should -Be 'building'
        $pending.MayHaveMigrated | Should -BeFalse
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -in @('stop', 'start') -or ($Arguments[0] -eq 'up' -and $Arguments -contains 'api') }
        Should -Invoke New-AntojitDatabaseUpdateBackup -ModuleName AntojitOS.Update -Times 0 -Exactly
    }

    It 'restores the previous printing configuration after a USB setup build failure (existing config: <HadPrintEnvironment>)' -ForEach @(
        @{ HadPrintEnvironment = $false }
        @{ HadPrintEnvironment = $true }
    ) {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'build'
        $printPath = Join-Path $fixture.Installation.Root '.env.print-agent'
        $previousPrint = 'PRINTER_QUEUE="Anterior"'
        if ($HadPrintEnvironment) { [IO.File]::WriteAllText($printPath, $previousPrint) }
        Mock Initialize-AntojitPrintConfiguration {
            param($Installation, $PrinterQueue)
            [IO.File]::WriteAllText((Join-Path $Installation.Root '.env.pilot'), 'PRINT_AGENT_RUNTIME=native')
            [IO.File]::WriteAllText((Join-Path $Installation.Root '.env.print-agent'), 'PRINTER_QUEUE="Nueva"')
            [pscustomobject]@{ Mode = 'native' }
        } -ModuleName AntojitOS.Update

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -PrinterQueue 'Nueva' } | Should -Throw '*candidate build failed*'

        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root '.env.pilot') -Raw | Should -Be 'PRINT_AGENT_MODE=simulator'
        if ($HadPrintEnvironment) { Get-Content -LiteralPath $printPath -Raw | Should -BeExactly $previousPrint }
        else { Test-Path -LiteralPath $printPath | Should -BeFalse }
        Should -Invoke Start-AntojitNativePrintAgent -ModuleName AntojitOS.Update -Times 0 -Exactly
    }

    It 'rejects an invalid USB queue before runtime initialization and restores the previous configuration' {
        $fixture = $global:AntojitFolderFixture
        Mock Initialize-AntojitPrintConfiguration {
            param($Installation, $PrinterQueue)
            [IO.File]::WriteAllText((Join-Path $Installation.Root '.env.pilot'), 'PRINT_AGENT_RUNTIME=native')
            [IO.File]::WriteAllText((Join-Path $Installation.Root '.env.print-agent'), 'PRINTER_QUEUE="Cola incorrecta"')
            [pscustomobject]@{ Mode = 'native' }
        } -ModuleName AntojitOS.Update
        Mock Assert-AntojitNativePrintConfiguration { throw 'Fixture USB printer queue does not exist.' } -ModuleName AntojitOS.Update

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -PrinterQueue 'Cola incorrecta' } | Should -Throw '*queue does not exist*'

        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root '.env.pilot') -Raw | Should -Be 'PRINT_AGENT_MODE=simulator'
        Test-Path -LiteralPath (Join-Path $fixture.Installation.Root '.env.print-agent') | Should -BeFalse
        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root 'apps/api/src/main.ts') -Raw | Should -Be 'old application source'
        Should -Invoke Initialize-AntojitRuntime -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly
    }

    It 'restarts the old writers after backup failure and never deploys the candidate' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'backup'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*database backup failed*'

        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root 'apps/api/src/main.ts') -Raw | Should -Be 'old application source'
        $pending = Get-Content -LiteralPath (Join-Path $fixture.Installation.StateDirectory 'update-pending.json') -Raw | ConvertFrom-Json
        $pending.MayHaveMigrated | Should -BeFalse
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' }
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'up' -and $Arguments -contains 'api' }
    }

    It 'recovers an existing native printer after backup failure without starting the simulator' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'backup'
        $activePath = Join-Path $fixture.Installation.StateDirectory 'print-agent/active.json'
        $previousRuntime = Join-Path $fixture.Installation.StateDirectory 'print-agent/previous-runtime'
        New-Item -ItemType Directory -Path (Split-Path -Parent $activePath) -Force | Out-Null
        [IO.File]::WriteAllText($activePath, (@{ RuntimeDirectory = $previousRuntime } | ConvertTo-Json))
        Mock Get-AntojitPrintConfiguration {
            [pscustomobject]@{
                Mode = 'native'
                ActivePath = (Join-Path $global:AntojitFolderFixture.Installation.StateDirectory 'print-agent/active.json')
            }
        } -ModuleName AntojitOS.Update
        Mock Initialize-AntojitPrintConfiguration { [pscustomobject]@{ Mode = 'native' } } -ModuleName AntojitOS.Update

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*database backup failed*'

        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter {
            $Arguments[0] -eq 'start' -and $Arguments -contains 'api' -and $Arguments -contains 'web' -and $Arguments -notcontains 'print-agent'
        }
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' -and $Arguments -contains 'print-agent' }
        Should -Invoke Start-AntojitNativePrintAgent -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter { $RuntimeDirectory -eq $previousRuntime }
    }

    It 'retains the migration barrier and stops writers when deployed verification fails' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'

        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        $pending.MayHaveMigrated | Should -BeTrue
        $pending.SourceHash | Should -Be (Get-AntojitUpdateManifest -Root $fixture.Source).Hash
        $pending.VerifiedBackups.Count | Should -Be 1
        Test-Path -LiteralPath $pending.VerifiedBackups[0] | Should -BeTrue
        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root 'apps/api/src/main.ts') -Raw | Should -Be 'export const version = 2;'
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 2 -Exactly -ParameterFilter { $Arguments[0] -eq 'stop' }
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' }

        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'apps/api/src/main.ts' -Content 'a different pending version'
        $before = [IO.File]::ReadAllText($pendingPath)
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*no se sustituira por otro ZIP*'
        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
    }

    It 'does not overwrite an unresolved Git deployment that may have migrated' {
        $fixture = $global:AntojitFolderFixture
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $original = '{"Stage":"deploying","MayHaveMigrated":true,"TargetCommit":"previous-git-target"}'
        [IO.File]::WriteAllText($pendingPath, $original)

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*migraciones*'
        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $original
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly
    }

    It 'explicitly recovers the frozen application using only new Windows helpers and then stops' {
        $fixture = $global:AntojitFolderFixture
        Remove-Item -LiteralPath (Join-Path $fixture.Source 'scripts/check-npm-registry.mjs') -Force
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $previousText = [IO.File]::ReadAllText($pendingPath)
        $previous = $previousText | ConvertFrom-Json
        $previousManifest = Get-AntojitUpdateManifest -Root $previous.SnapshotPath
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'apps/api/src/main.ts' -Content 'newer application must wait'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'apps/api/migrations/9999_new.sql' -Content 'new migration must wait'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'Containerfile' -Content 'COPY scripts/check-npm-registry.mjs scripts/check-npm-registry.mjs'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/check-npm-registry.mjs' -Content '// latest network check must wait'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/pilot.mjs' -Content '// latest pilot must wait'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# corrected shared log reader'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'RECUPERAR-ACTUALIZACION.cmd' -Content '@echo recovery'
        $requested = Get-AntojitUpdateManifest -Root $fixture.Source
        $fixture | Add-Member -MemberType NoteProperty -Name RecoveryDirectories -Value @()
        Mock Protect-AntojitPath {
            param($Path)
            if ((Split-Path -Leaf $Path) -like 'AntojitOS-recovery-*') { $global:AntojitFolderFixture.RecoveryDirectories += $Path }
        } -ModuleName AntojitOS.Update
        $fixture.Failure = ''

        Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -ResumePending

        Test-Path -LiteralPath $pendingPath | Should -BeFalse
        (Get-AntojitUpdateManifest -Root $previous.SnapshotPath).Hash | Should -BeExactly $previous.SourceHash
        (Get-AntojitUpdateManifest -Root $fixture.Source).Hash | Should -BeExactly $requested.Hash
        (Get-AntojitUpdateManifest -Root $fixture.Installation.Root).ApplicationHash | Should -BeExactly $previousManifest.ApplicationHash
        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root 'apps/api/src/main.ts') -Raw | Should -BeExactly 'export const version = 2;'
        Get-Content -LiteralPath (Join-Path $fixture.Installation.Root 'scripts/windows/AntojitOS.Printing.psm1') -Raw | Should -BeExactly '# corrected shared log reader'
        Test-Path -LiteralPath (Join-Path $fixture.Installation.Root 'apps/api/migrations/9999_new.sql') | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $fixture.Installation.Root 'scripts/check-npm-registry.mjs') | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $fixture.Installation.Root 'RECUPERAR-ACTUALIZACION.cmd') | Should -BeTrue
        $records = @(Get-ChildItem -LiteralPath (Join-Path $fixture.Installation.Root 'backups') -Filter 'update.json' -File -Recurse)
        $records.Count | Should -Be 1
        $completed = Get-Content -LiteralPath $records[0].FullName -Raw | ConvertFrom-Json
        $completed.ApplicationHash | Should -BeExactly $previousManifest.ApplicationHash
        $completed.FirstBackupDirectory | Should -BeExactly $previous.FirstBackupDirectory
        $completed.VerifiedBackups | Should -Contain $previous.VerifiedBackups[0]
        @($completed.VerifiedBackups).Count | Should -Be 2
        @($completed.BootstrapFixRetries).Count | Should -Be 1
        $completed.BootstrapFixRetries[0].PreviousSourceHash | Should -BeExactly $previous.SourceHash
        $completed.BootstrapFixRetries[0].ValidatedSnapshotPath | Should -BeExactly $previous.SnapshotPath
        $completed.BootstrapFixRetries[0].RequestedSourceHash | Should -BeExactly $requested.Hash
        $completed.BootstrapFixRetries[0].Recovery | Should -BeTrue
        [IO.File]::ReadAllText((Join-Path $completed.LatestBackupDirectory 'previous-pending.json')) | Should -BeExactly $previousText
        $fixture.RecoveryDirectories.Count | Should -Be 1
        foreach ($directory in $fixture.RecoveryDirectories) { Test-Path -LiteralPath $directory | Should -BeFalse }
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 2 -Exactly
        Should -Invoke Get-AntojitGit -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Write-AntojitLog -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter { $Message -like 'Se completo la version pendiente*ACTUALIZAR-APP.cmd*' }
    }

    It 'does not install the new ZIP when recovery was requested without a pending update' {
        $fixture = $global:AntojitFolderFixture
        $before = Get-AntojitUpdateManifest -Root $fixture.Installation.Root

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -ResumePending } | Should -Throw '*No hay una actualizacion pendiente*'

        (Get-AntojitUpdateManifest -Root $fixture.Installation.Root).Hash | Should -BeExactly $before.Hash
        Test-Path -LiteralPath (Join-Path $fixture.Installation.Root 'backups') | Should -BeFalse
        Should -Invoke Protect-AntojitPath -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 0 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly
    }

    It 'requires maintenance before creating a recovery staging folder or altering pending state' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $before = [IO.File]::ReadAllText($pendingPath)
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'apps/api/src/main.ts' -Content 'new version'

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ResumePending } | Should -Throw '*ConfirmMaintenance*'

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        Should -Invoke Protect-AntojitPath -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { (Split-Path -Leaf $Path) -like 'AntojitOS-recovery-*' }
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke Initialize-AntojitRuntime -ModuleName AntojitOS.Update -Times 1 -Exactly
    }

    It 'rejects an invalid pending recovery record before modifying state (<Problem>)' -ForEach @(
        @{ Problem = 'Git'; Pattern = '*otro origen*' }
        @{ Problem = 'Version'; Pattern = '*version de carpeta valida*' }
        @{ Problem = 'Hash'; Pattern = '*version de carpeta valida*' }
        @{ Problem = 'Path'; Pattern = '*ruta de la copia congelada*' }
        @{ Problem = 'Tamper'; Pattern = '*copia congelada cambio*' }
        @{ Problem = 'Missing'; Pattern = '*No existe la copia congelada*' }
    ) {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        switch ($Problem) {
            'Git' { $pending.SourceKind = 'git' }
            'Version' { $pending.Version = 99 }
            'Hash' { $pending.SourceHash = '../not-a-hash' }
            'Path' { $pending.SnapshotPath = $fixture.Source }
            'Tamper' { Write-FolderUpdateFile -Root $pending.SnapshotPath -RelativePath 'apps/api/src/main.ts' -Content 'tampered application' }
            'Missing' { Remove-Item -LiteralPath $pending.SnapshotPath -Recurse -Force }
        }
        [IO.File]::WriteAllText($pendingPath, ($pending | ConvertTo-Json -Depth 10))
        $before = [IO.File]::ReadAllText($pendingPath)
        $backupsBefore = @(Get-ChildItem -LiteralPath (Join-Path $fixture.Installation.Root 'backups') -Directory).Count

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -ResumePending } | Should -Throw $Pattern

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        @(Get-ChildItem -LiteralPath (Join-Path $fixture.Installation.Root 'backups') -Directory).Count | Should -Be $backupsBefore
        Should -Invoke Protect-AntojitPath -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { (Split-Path -Leaf $Path) -like 'AntojitOS-recovery-*' }
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke Initialize-AntojitRuntime -ModuleName AntojitOS.Update -Times 1 -Exactly
    }

    It 'preserves the migration barrier and recovery lineage when a resumed build fails' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $previousText = [IO.File]::ReadAllText($pendingPath)
        $previous = $previousText | ConvertFrom-Json
        $applicationHash = (Get-AntojitUpdateManifest -Root $previous.SnapshotPath).ApplicationHash
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'apps/api/src/main.ts' -Content 'newer app must wait'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# corrected helper'
        $fixture | Add-Member -MemberType NoteProperty -Name RecoveryDirectories -Value @()
        Mock Protect-AntojitPath {
            param($Path)
            if ((Split-Path -Leaf $Path) -like 'AntojitOS-recovery-*') { $global:AntojitFolderFixture.RecoveryDirectories += $Path }
        } -ModuleName AntojitOS.Update
        $fixture.Failure = 'build'

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -ResumePending } | Should -Throw '*candidate build failed*'

        $retry = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        $retry.Stage | Should -BeExactly 'building'
        $retry.MayHaveMigrated | Should -BeTrue
        $retry.ApplicationHash | Should -BeExactly $applicationHash
        $retry.FirstBackupDirectory | Should -BeExactly $previous.FirstBackupDirectory
        $retry.VerifiedBackups | Should -Contain $previous.VerifiedBackups[0]
        $retry.BootstrapFixRetries[0].PreviousSourceHash | Should -BeExactly $previous.SourceHash
        $retry.BootstrapFixRetries[0].Recovery | Should -BeTrue
        [IO.File]::ReadAllText((Join-Path $retry.LatestBackupDirectory 'previous-pending.json')) | Should -BeExactly $previousText
        (Get-AntojitUpdateManifest -Root $previous.SnapshotPath).Hash | Should -BeExactly $previous.SourceHash
        (Get-AntojitUpdateManifest -Root $retry.SnapshotPath).Hash | Should -BeExactly $retry.SourceHash
        foreach ($directory in $fixture.RecoveryDirectories) { Test-Path -LiteralPath $directory | Should -BeFalse }
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' }
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'up' -and $Arguments -contains 'api' }
    }

    It 'rejects a linked frozen recovery path (<LinkedPart>)' -ForEach @(
        @{ LinkedPart = 'Source' }
        @{ LinkedPart = 'Parent' }
    ) {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $before = [IO.File]::ReadAllText($pendingPath)
        $pending = $before | ConvertFrom-Json
        $linkPath = if ($LinkedPart -eq 'Source') { $pending.SnapshotPath } else { Split-Path -Parent $pending.SnapshotPath }
        $external = Join-Path $TestDrive ('external-' + [guid]::NewGuid().ToString('N'))
        Move-Item -LiteralPath $linkPath -Destination $external
        try { New-Item -ItemType SymbolicLink -Path $linkPath -Target $external -ErrorAction Stop | Out-Null }
        catch { Set-ItResult -Skipped -Because 'This host cannot create directory symbolic links.'; return }

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -ResumePending } | Should -Throw '*no puede contener enlaces*'

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        Should -Invoke Protect-AntojitPath -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { (Split-Path -Leaf $Path) -like 'AntojitOS-recovery-*' }
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke Initialize-AntojitRuntime -ModuleName AntojitOS.Update -Times 1 -Exactly
    }

    It 'rejects a bootstrap ZIP changed while preparing recovery without overwriting pending state' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $before = [IO.File]::ReadAllText($pendingPath)
        $fixture | Add-Member -MemberType NoteProperty -Name RecoveryDirectories -Value @()
        Mock Protect-AntojitPath {
            param($Path)
            if ((Split-Path -Leaf $Path) -like 'AntojitOS-recovery-*') { $global:AntojitFolderFixture.RecoveryDirectories += $Path }
        } -ModuleName AntojitOS.Update
        Mock Copy-Item {
            param($LiteralPath, $Destination)
            [IO.File]::Copy($LiteralPath, $Destination, $true)
            if ($LiteralPath -eq (Join-Path $global:AntojitFolderFixture.Source 'final_script.ps1')) {
                [IO.File]::WriteAllText((Join-Path $global:AntojitFolderFixture.Source 'apps/api/src/main.ts'), 'changed during bootstrap copy')
            }
        } -ModuleName AntojitOS.Update

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -ResumePending } | Should -Throw '*ZIP de auxiliares cambio*'

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        $fixture.RecoveryDirectories.Count | Should -Be 1
        foreach ($directory in $fixture.RecoveryDirectories) { Test-Path -LiteralPath $directory | Should -BeFalse }
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke Initialize-AntojitRuntime -ModuleName AntojitOS.Update -Times 1 -Exactly
    }

    It 'keeps the original failure when cleanup of the temporary recovery directory fails' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $fixture.Failure = 'build'
        $fixture | Add-Member -MemberType NoteProperty -Name RecoveryDirectories -Value @()
        Mock Protect-AntojitPath {
            param($Path)
            if ((Split-Path -Leaf $Path) -like 'AntojitOS-recovery-*') { $global:AntojitFolderFixture.RecoveryDirectories += $Path }
        } -ModuleName AntojitOS.Update
        Mock Remove-Item { throw 'Fixture cleanup failed.' } -ModuleName AntojitOS.Update -ParameterFilter { (Split-Path -Leaf $LiteralPath) -like 'AntojitOS-recovery-*' }
        try {
            { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance -ResumePending } | Should -Throw '*candidate build failed*'
            $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
            (Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json).MayHaveMigrated | Should -BeTrue
            Should -Invoke Remove-Item -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter { (Split-Path -Leaf $LiteralPath) -like 'AntojitOS-recovery-*' }
        } finally {
            foreach ($directory in $fixture.RecoveryDirectories) { Remove-Item -LiteralPath $directory -Recurse -Force }
        }
    }

    It 'recovers a pending migrated deployment from a ZIP correcting only Windows bootstrap and preserves its audit trail' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $previousText = [IO.File]::ReadAllText($pendingPath)
        $previous = $previousText | ConvertFrom-Json
        $previousApplicationHash = (Get-AntojitUpdateManifest -Root $previous.SnapshotPath).ApplicationHash
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# correction for shared stdout.log reader'
        $candidate = Get-AntojitUpdateManifest -Root $fixture.Source
        $candidate.Hash | Should -Not -Be $previous.SourceHash
        $candidate.ApplicationHash | Should -BeExactly $previousApplicationHash
        $fixture.Failure = ''

        Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance

        Test-Path -LiteralPath $pendingPath | Should -BeFalse
        $fixture.Installation.SourceHash | Should -BeExactly $candidate.Hash
        (Get-AntojitUpdateManifest -Root $previous.SnapshotPath).Hash | Should -BeExactly $previous.SourceHash
        $records = @(Get-ChildItem -LiteralPath (Join-Path $fixture.Installation.Root 'backups') -Filter 'update.json' -File -Recurse)
        $records.Count | Should -Be 1
        $completed = Get-Content -LiteralPath $records[0].FullName -Raw | ConvertFrom-Json
        $completed.MayHaveMigrated | Should -BeTrue
        $completed.SourceHash | Should -BeExactly $candidate.Hash
        $completed.ApplicationHash | Should -BeExactly $previousApplicationHash
        $completed.FirstBackupDirectory | Should -BeExactly $previous.FirstBackupDirectory
        $completed.VerifiedBackups | Should -Contain $previous.VerifiedBackups[0]
        @($completed.VerifiedBackups).Count | Should -Be 2
        @($completed.BootstrapFixRetries).Count | Should -Be 1
        $completed.BootstrapFixRetries[0].PreviousSourceHash | Should -BeExactly $previous.SourceHash
        $completed.BootstrapFixRetries[0].SourceHash | Should -BeExactly $candidate.Hash
        $completed.BootstrapFixRetries[0].ValidatedSnapshotPath | Should -BeExactly $previous.SnapshotPath
        [IO.File]::ReadAllText((Join-Path $completed.LatestBackupDirectory 'previous-pending.json')) | Should -BeExactly $previousText
        (Get-AntojitUpdateManifest -Root $completed.SnapshotPath).Hash | Should -BeExactly $candidate.Hash
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 2 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' }
        Should -Invoke Get-AntojitGit -ModuleName AntojitOS.Update -Times 0 -Exactly
    }

    It 'rejects changed application or build inputs during a bootstrap recovery (<RelativePath>)' -ForEach @(
        @{ RelativePath = 'apps/api/src/main.ts' }
        @{ RelativePath = 'scripts/pilot.mjs' }
        @{ RelativePath = 'apps/api/migrations/0001_fixture.sql' }
        @{ RelativePath = 'Containerfile' }
        @{ RelativePath = 'pnpm-lock.yaml' }
    ) {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $before = [IO.File]::ReadAllText($pendingPath)
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# corrected Windows bootstrap'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath $RelativePath -Content 'different application or build input'

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*no se sustituira por otro ZIP*'

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'up' -and $Arguments -contains 'api' }
    }

    It 'keeps the migration barrier and backup lineage if an accepted Windows correction fails while building' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $previousText = [IO.File]::ReadAllText($pendingPath)
        $previous = $previousText | ConvertFrom-Json
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# corrected Windows bootstrap'
        $candidate = Get-AntojitUpdateManifest -Root $fixture.Source
        $fixture.Failure = 'build'

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*candidate build failed*'

        $retry = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        $retry.Stage | Should -Be 'building'
        $retry.MayHaveMigrated | Should -BeTrue
        $retry.SourceHash | Should -BeExactly $candidate.Hash
        $retry.FirstBackupDirectory | Should -BeExactly $previous.FirstBackupDirectory
        $retry.VerifiedBackups | Should -Contain $previous.VerifiedBackups[0]
        @($retry.BootstrapFixRetries).Count | Should -Be 1
        $retry.BootstrapFixRetries[0].PreviousSourceHash | Should -BeExactly $previous.SourceHash
        [IO.File]::ReadAllText((Join-Path $retry.LatestBackupDirectory 'previous-pending.json')) | Should -BeExactly $previousText
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' }
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'up' -and $Arguments -contains 'api' }
    }

    It 'requires maintenance confirmation even when the new ZIP only corrects Windows bootstrap' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $before = [IO.File]::ReadAllText($pendingPath)
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# corrected Windows bootstrap'
        $candidate = Get-AntojitUpdateManifest -Root $fixture.Source

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root } | Should -Throw '*ConfirmMaintenance*'

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        Test-Path -LiteralPath (Join-Path $fixture.Installation.StateDirectory ('update-source/' + $candidate.Hash + '/source')) | Should -BeFalse
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 2 -Exactly -ParameterFilter { $Arguments[0] -eq 'stop' }
    }

    It 'rejects a bootstrap recovery when the previous frozen snapshot was modified' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $before = [IO.File]::ReadAllText($pendingPath)
        $pending = $before | ConvertFrom-Json
        Write-FolderUpdateFile -Root $pending.SnapshotPath -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# modified frozen bootstrap'
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# corrected new bootstrap'

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*copia congelada cambio*'

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
    }

    It 'rejects a bootstrap recovery when the pending snapshot path points outside its recorded version' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        $pending.SnapshotPath = $fixture.Source
        [IO.File]::WriteAllText($pendingPath, ($pending | ConvertTo-Json -Depth 10))
        $before = [IO.File]::ReadAllText($pendingPath)
        Write-FolderUpdateFile -Root $fixture.Source -RelativePath 'scripts/windows/AntojitOS.Printing.psm1' -Content '# corrected Windows bootstrap'

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*ruta de la copia congelada*'

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
    }

    It 'keeps a prior migration barrier during a same-source retry that fails before deployment' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $firstPending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json

        $fixture.Failure = 'build'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*candidate build failed*'

        $retryPending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        $retryPending.Stage | Should -Be 'building'
        $retryPending.MayHaveMigrated | Should -BeTrue
        $retryPending.SourceHash | Should -Be $firstPending.SourceHash
        $retryPending.FirstBackupDirectory | Should -Be $firstPending.FirstBackupDirectory
        $retryPending.VerifiedBackups | Should -Contain $firstPending.VerifiedBackups[0]
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' }
        Should -Invoke Invoke-AntojitPilot -ModuleName AntojitOS.Update -Times 1 -Exactly -ParameterFilter { $Command -eq 'verify' }
    }

    It 'detects a changed frozen snapshot on retry before building and preserves pending recovery state' {
        $fixture = $global:AntojitFolderFixture
        $fixture.Failure = 'verify'
        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*deployed API verification failed*'
        $pendingPath = Join-Path $fixture.Installation.StateDirectory 'update-pending.json'
        $before = [IO.File]::ReadAllText($pendingPath)
        $pending = $before | ConvertFrom-Json
        Write-FolderUpdateFile -Root $pending.SnapshotPath -RelativePath 'apps/api/src/main.ts' -Content 'unexpected frozen-source modification'
        $fixture.Failure = ''

        { Invoke-AntojitFolderUpdate -SourcePath $fixture.Source -InstallPath $fixture.Installation.Root -ConfirmMaintenance } | Should -Throw '*copia congelada cambio*'

        [IO.File]::ReadAllText($pendingPath) | Should -BeExactly $before
        Should -Invoke Invoke-AntojitCandidateBuild -ModuleName AntojitOS.Update -Times 1 -Exactly
        Should -Invoke Invoke-AntojitCompose -ModuleName AntojitOS.Update -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'start' }
    }
}
