param([string]$Destination = (Join-Path $env:LOCALAPPDATA 'ReadyState'), [switch]$NoShortcut)
$ErrorActionPreference = 'Stop'
function Resolve-InstallPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    $suffix = @()
    while (!(Test-Path -LiteralPath $current)) {
        $suffix = @([IO.Path]::GetFileName($current)) + $suffix
        $current = [IO.Path]::GetDirectoryName($current)
        if (!$current) { throw "No existing ancestor for installation path: $Path" }
    }
    $resolved = (Get-Item -LiteralPath $current -Force).FullName
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Installation paths must not use junctions or symbolic links: $current"
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    foreach ($part in $suffix) { $resolved = Join-Path $resolved $part }
    return $resolved
}
$source = Resolve-InstallPath $PSScriptRoot
$Destination = Resolve-InstallPath $Destination
if ($Destination.StartsWith("$source\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Install outside the extracted package directory.' }
if (Test-Path -LiteralPath $Destination) {
    throw "Destination already exists: $Destination. Stop ReadyState and move the old installation aside before upgrading."
}
if (!(Test-Path -LiteralPath (Join-Path $source 'release.json'))) { throw 'Extract the complete ReadyState archive before installing.' }
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'ReadyState.lnk'
if (!$NoShortcut -and (Test-Path -LiteralPath $menu)) { throw "Shortcut already exists: $menu. Remove the previous ReadyState shortcut first." }
New-Item -ItemType Directory -Path $Destination | Out-Null
Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $Destination -Recurse
if (!$NoShortcut) {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($menu)
    $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $shortcut.Arguments = "-NoProfile -NoExit -File `"$Destination\start.ps1`""
    $shortcut.WorkingDirectory = $Destination
    $shortcut.Save()
}
Write-Host "ReadyState installed for this user at $Destination. Run start.ps1 or use the Start menu shortcut."
