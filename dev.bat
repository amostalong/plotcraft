@echo off
REM PlotCraft v0.1 dev launcher
REM Double-click to launch tauri dev from project root, or run from cmd/PowerShell.
REM
REM Equivalent to Locus's scripts/run-tauri.mjs, but v0.1 does not need
REM WEBVIEW2 debug port allocation or MCP integration, so a simple .bat
REM wrapping `bun run tauri dev` is enough. Move to scripts/run-tauri.mjs
REM in v0.2+ if dev-mcp / dev-release flavors become needed.
REM
REM --- reserved port ranges (do NOT collide with Locus) ---
REM   Locus:    WEBVIEW2 debug = 19222-19246, MCP = (varies)
REM   PlotCraft: WEBVIEW2 debug = 29222-29246, MCP = 29247-29271
REM   Default Vite dev = 5173 (Tauri picks free port if taken)
REM   Default Tauri dev = 1420 (auto-allocates if taken)
REM
REM Usage:
REM   dev.bat             -- start tauri dev (default; cargo incremental build)
REM   dev.bat build       -- typecheck + cargo check + vite build (lint)
REM   dev.bat typecheck   -- run typecheck only
REM   dev.bat cargo       -- run cargo check only

setlocal EnableDelayedExpansion

REM cd to the directory of this .bat (handles double-click from Explorer)
cd /d "%~dp0"

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=dev"

echo [dev] PlotCraft launcher - action=%ACTION%
echo [dev] cwd=%CD%
echo.

REM --- prerequisites ---
where bun >nul 2>nul
if errorlevel 1 (
    echo [dev] ERROR: bun not found in PATH
    echo [dev]   install from https://bun.sh  then retry
    exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo [dev] ERROR: cargo not found in PATH
    echo [dev]   install Rust toolchain via rustup  then retry
    exit /b 1
)

REM --- node_modules check ---
if not exist "node_modules" (
    echo [dev] node_modules missing - running bun install ...
    call bun install
    if errorlevel 1 (
        echo [dev] bun install failed
        exit /b 1
    )
    echo.
)

REM --- action dispatch ---
if /i "%ACTION%"=="dev" (
    echo [dev] starting tauri dev ...
    call bun run tauri dev
    exit /b %errorlevel%
)

if /i "%ACTION%"=="build" (
    echo [dev] running typecheck ...
    call bun run typecheck
    if errorlevel 1 exit /b 1
    echo [dev] running cargo check ...
    pushd src-tauri
    call cargo check
    set RC=!errorlevel!
    popd
    if not "!RC!"=="0" exit /b !RC!
    echo [dev] running vite build ...
    call bun run build
    exit /b !errorlevel!
)

if /i "%ACTION%"=="typecheck" (
    call bun run typecheck
    exit /b %errorlevel!
)

if /i "%ACTION%"=="cargo" (
    pushd src-tauri
    call cargo check
    set RC=!errorlevel!
    popd
    exit /b !RC!
)

echo [dev] unknown action: %ACTION%
echo [dev] valid: dev ^| build ^| typecheck ^| cargo
exit /b 1

endlocal
