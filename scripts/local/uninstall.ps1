param([switch]$RemoveInstallation)
$ErrorActionPreference = 'Stop'
$marker = Join-Path $PSScriptRoot 'release.json'
if (!(Test-Path -LiteralPath $marker)) { throw 'Not a ReadyState installation.' }
$release = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
if ($release.source -notlike 'https://github.com/tescolopio/ReadyState/tree/*') { throw 'Unexpected installation marker.' }
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'ReadyState.lnk'
if (Test-Path -LiteralPath $shortcut) {
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    $expectedExecutable = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $ownedArguments = $false
    if ($target.Arguments -match '^(-NoProfile -NoExit -File) "(.+\\start\.ps1)"$' -and
        (Test-Path -LiteralPath $Matches[2] -PathType Leaf)) {
        $actualScript = (Get-Item -LiteralPath $Matches[2]).FullName
        $expectedScript = Join-Path (Get-Item -LiteralPath $PSScriptRoot).FullName 'start.ps1'
        $ownedArguments = [StringComparer]::OrdinalIgnoreCase.Equals($actualScript, $expectedScript)
    }
    if ([StringComparer]::OrdinalIgnoreCase.Equals($target.TargetPath, $expectedExecutable) -and
        $ownedArguments) {
        Remove-Item -LiteralPath $shortcut
    }
}
if ($RemoveInstallation) {
    Write-Host 'Stop ReadyState before removal. Browser household/plan data is not removed.'
    foreach ($entry in @('app', 'runtime', 'launch.mjs', 'start.ps1', 'install.ps1', 'uninstall.ps1', 'LICENSE', 'configuration.example', 'INSTALL.md', 'packaging-review.md', 'binary-components.md', 'release.json')) {
        $path = Join-Path $PSScriptRoot $entry
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse }
    }
}
