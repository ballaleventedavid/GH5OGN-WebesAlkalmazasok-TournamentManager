param([switch]$Dev)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
    if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'Node.js 24.15 vagy ujabb szukseges: https://nodejs.org/' }
    $nodeVersion = & $nodeExe -p 'process.versions.node'
    if ([version]$nodeVersion -lt [version]'24.15.0') { throw "Tul regi Node.js: $nodeVersion. Telepits 24.15+ verziot." }
    $env:PATH = "$(Split-Path -Parent $nodeExe);$env:PATH"
    if (-not (Test-Path -LiteralPath 'node_modules/tsx/package.json')) {
        Write-Host 'Fuggosegek telepitese (elso alkalommal internet szukseges)...' -ForegroundColor Green
        $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
        $bundledPnpm = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd'
        $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
        if ($pnpmCommand) { & $pnpmCommand.Source install --frozen-lockfile }
        elseif (Test-Path -LiteralPath $bundledPnpm) { & $bundledPnpm install --frozen-lockfile }
        elseif ($npmCommand) { & $npmCommand.Source install }
        else { throw 'npm vagy pnpm nem talalhato. Telepitsd a Node.js-t az npm csomagkezelovel.' }
        if ($LASTEXITCODE -ne 0) { throw 'A fuggosegek telepitese nem sikerult.' }
    }
    if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
    if ($Dev) {
        $env:NODE_ENV = 'development'
        Write-Host 'Fejlesztoi inditas. Nyisd meg: http://localhost:3000' -ForegroundColor Green
        & $nodeExe --import tsx server/index.ts
    } else {
        if (-not (Test-Path -LiteralPath 'dist-server/server/index.js') -or -not (Test-Path -LiteralPath 'dist/index.html')) {
            Write-Host 'Alkalmazas forditasa...' -ForegroundColor Green
            & $nodeExe node_modules/typescript/bin/tsc --noEmit
            if ($LASTEXITCODE -ne 0) { throw 'TypeScript ellenorzesi hiba.' }
            & $nodeExe node_modules/vite/bin/vite.js build
            if ($LASTEXITCODE -ne 0) { throw 'Frontend build hiba.' }
            & $nodeExe node_modules/typescript/bin/tsc -p tsconfig.server.json
            if ($LASTEXITCODE -ne 0) { throw 'Backend build hiba.' }
        }
        $env:NODE_ENV = 'production'
        Write-Host 'TournamentManager - http://localhost:3000' -ForegroundColor Green
        Write-Host 'Ha a .env fajlban mas port szerepel, azt hasznald. Leallitas: Ctrl+C.'
        & $nodeExe dist-server/server/index.js
    }
    if ($LASTEXITCODE -ne 0) { throw "A szerver leallt (kod: $LASTEXITCODE)." }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
