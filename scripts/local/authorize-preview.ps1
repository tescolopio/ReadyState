$ErrorActionPreference = 'Stop'

if ($env:GITHUB_REF -cne 'refs/heads/main') { throw 'Preview uploads require exact lowercase main' }
if ($env:PREVIEW_TAG -cne 'v0.1.0-preview.1') { throw 'Only the exact authorized tester pre-release is supported' }
if ($env:SOURCE_REVISION -cnotmatch '^[0-9a-f]{40}$') { throw 'A full reviewed source SHA is required' }

$actual = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine the checked-out source revision' }
if ($actual -cne $env:SOURCE_REVISION) { throw 'Checked-out source differs from the authorized revision' }

$remote = git ls-remote --exit-code origin refs/heads/main
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify live main; no preview upload is allowed' }
$live = ($remote -split '\s+')[0]
if ($live -cne $env:SOURCE_REVISION) { throw 'Main moved: review and verify the actual revision before uploading' }
