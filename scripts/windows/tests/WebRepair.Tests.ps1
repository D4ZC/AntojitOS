#Requires -Version 5.1
BeforeDiscovery {
    Import-Module (Join-Path $PSScriptRoot '..\AntojitOS.Web.psm1') -Force -DisableNameChecking
}

Describe 'Prebuilt kitchen screen repair' {
    InModuleScope AntojitOS.Web {
        BeforeEach {
            $script:Payload = Join-Path $TestDrive 'payload'
            New-Item -ItemType Directory -Path (Join-Path $script:Payload 'dist/assets') -Force | Out-Null
            foreach ($file in @('Containerfile', 'nginx.conf.template', 'dist/sw.js', 'dist/recuperar-cocina.html', 'dist/assets/current.js')) {
                Set-Content -LiteralPath (Join-Path $script:Payload $file) -Value 'fixture'
            }
            Set-Content -LiteralPath (Join-Path $script:Payload 'dist/index.html') -Value '<script type="module" src="/assets/current.js"></script>'
            $script:Installation = [pscustomobject]@{ Root = $TestDrive; StateDirectory = $TestDrive; HttpPort = 8080; ComposeProviderPath = 'compose.exe' }
            $script:OldImage = 'sha256:' + ('a' * 64)
            $script:FailBuild = $false
            $script:FailVerify = $false
            Mock Get-AntojitPodman { 'podman.exe' }
            Mock Write-AntojitLog { }
            Mock Start-Sleep { }
            Mock Invoke-RestMethod { [pscustomobject]@{ status = 'ready'; database = 'connected' } }
            Mock Invoke-WebRequest {
                param($Uri)
                if ($script:FailVerify) { throw 'frontend not responding' }
                if ($Uri -match 'recuperar-cocina') { return [pscustomobject]@{ StatusCode = 200; Content = 'location.replace' } }
                return [pscustomobject]@{ StatusCode = 200; Content = '<script src="/assets/current.js"></script>' }
            }
            Mock Invoke-AntojitCommand {
                param($FilePath, $Arguments)
                $command = $Arguments -join '|'
                if ($command -match '\|ps\|--all\|--quiet\|web$') { return 'web-container' }
                if ($command -eq 'inspect|--format|{{.Config.Image}}|web-container') { return 'localhost/antojitos-pilot-web:latest' }
                if ($command -eq 'image|inspect|--format|{{.Id}}|localhost/antojitos-pilot-web:latest') { return $script:OldImage }
                if ($Arguments[0] -eq 'build' -and $script:FailBuild) { throw 'build failed' }
                if ($Arguments[0] -in @('build', 'tag') -or $command -match '\|up\|') { return }
                throw "Unexpected command: $command"
            }
        }

        It 'deploys the local prebuilt frontend and recreates only web' {
            $url = Update-AntojitWebImage -Installation $script:Installation -PayloadPath $script:Payload
            $url | Should -BeLike 'http://localhost:8080/recuperar-cocina.html?v=*'
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'build' -and $Arguments -contains '--pull=never' -and $Arguments -contains '--network=none'
            }
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter {
                ($Arguments -join '|') -match '\|up\|--detach\|--no-deps\|--no-build\|--pull\|never\|--force-recreate\|web$'
            }
            $state = Get-Content -LiteralPath (Join-Path $TestDrive 'web-repair.json') -Raw | ConvertFrom-Json
            $state.Applied | Should -BeTrue
            $state.PreviousImage | Should -Be $script:OldImage
        }

        It 'does not replace the active image when preparation fails' {
            $script:FailBuild = $true
            { Update-AntojitWebImage -Installation $script:Installation -PayloadPath $script:Payload } | Should -Throw '*build failed*'
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly -ParameterFilter { $Arguments[0] -eq 'tag' -or $Arguments -contains 'up' }
        }

        It 'restores the previous image when the published page cannot be verified' {
            $script:FailVerify = $true
            { Update-AntojitWebImage -Installation $script:Installation -PayloadPath $script:Payload -VerifyTimeoutSeconds 0 } | Should -Throw '*frontend not responding*'
            Should -Invoke Invoke-AntojitCommand -Times 1 -Exactly -ParameterFilter {
                $Arguments[0] -eq 'tag' -and $Arguments[1] -eq $script:OldImage -and $Arguments[2] -eq 'localhost/antojitos-pilot-web:latest'
            }
            Should -Invoke Invoke-AntojitCommand -Times 2 -Exactly -ParameterFilter { $Arguments -contains 'up' -and $Arguments[-1] -eq 'web' }
            $state = Get-Content -LiteralPath (Join-Path $TestDrive 'web-repair.json') -Raw | ConvertFrom-Json
            $state.Applied | Should -BeFalse
        }

        It 'rejects an incomplete package before touching the containers' {
            Remove-Item -LiteralPath (Join-Path $script:Payload 'dist/assets/current.js')
            { Update-AntojitWebImage -Installation $script:Installation -PayloadPath $script:Payload } | Should -Throw '*JavaScript*'
            Should -Invoke Invoke-AntojitCommand -Times 0 -Exactly
        }
    }
}
