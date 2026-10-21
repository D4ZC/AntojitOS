#requires -Version 5.1

Describe 'GitHub update repository validation' {
    BeforeAll {
        $updateScript = Join-Path $PSScriptRoot '..\03-actualizar.ps1'
        $tokens = $null
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            $updateScript, [ref] $tokens, [ref] $parseErrors
        )
        if ($parseErrors.Count -gt 0) { throw 'The update script must parse before testing its URL validator.' }
        $validator = $ast.Find({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                $node.Name -eq 'Test-UpdateRepositoryUrl'
        }, $false)
        if ($null -eq $validator) { throw 'The update repository validator was not found.' }
        # Load only the real validator; loading the entire script would start an update.
        . ([scriptblock]::Create($validator.Extent.Text))
    }

    It 'accepts an explicit GitHub repository: <Value>' -TestCases @(
        @{ Value = 'https://github.com/mi-negocio/AntojitOS' }
        @{ Value = 'https://github.com/mi-negocio/AntojitOS.git' }
        @{ Value = 'https://github.com/mi-negocio/AntojitOS/' }
        @{ Value = 'git@github.com:mi-negocio/AntojitOS.git' }
    ) {
        param($Value)
        Test-UpdateRepositoryUrl -Value $Value | Should -BeTrue
    }

    It 'rejects credentials, ambiguous origins and extra URL data: <Value>' -TestCases @(
        @{ Value = '' }
        @{ Value = 'https://token@github.com/owner/repo.git' }
        @{ Value = 'https://user:secret@github.com/owner/repo.git' }
        @{ Value = 'https://github.com/owner/repo.git?token=secret' }
        @{ Value = 'https://github.com/owner/repo.git#main' }
        @{ Value = 'https://github.com.example.org/owner/repo.git' }
        @{ Value = 'https://example.org/owner/repo.git' }
        @{ Value = 'http://github.com/owner/repo.git' }
        @{ Value = 'https://github.com/owner/repo/extra' }
        @{ Value = 'https://github.com/owner/..' }
        @{ Value = 'https://github.com/owner/.git' }
        @{ Value = 'https://github.com/owner/repo%2fextra' }
        @{ Value = 'git@github.com:owner/repo.git;whoami' }
        @{ Value = '--upload-pack=anything' }
    ) {
        param($Value)
        Test-UpdateRepositoryUrl -Value $Value | Should -BeFalse
    }
}
