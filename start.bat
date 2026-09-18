@echo off
REM ---------------------------------------------------------------------------
REM  Interactive Poster Studio - Windows launcher
REM
REM  Double-click this file in Explorer. It serves this folder on
REM  http://127.0.0.1:<port> and opens the app in your browser.
REM
REM  Why a server at all? The app uses native ES modules, and browsers refuse to
REM  load modules from file:// URLs. Any static server works - this script picks
REM  whichever one you already have installed.
REM ---------------------------------------------------------------------------

setlocal EnableExtensions EnableDelayedExpansion
title Interactive Poster Studio

REM Always operate on the folder this script lives in, whatever the caller's cwd is.
cd /d "%~dp0"

set "SERVER_CMD="
set /a MAX_TRIES=20
set /a TRIES=0

REM PORT may already be set by the suite launcher one level up, which needs the
REM dashboard iframe and the server to agree on an address. In that case the
REM port is an assignment rather than a preference, so the scan is skipped -
REM and because posters live in localStorage, a different port is a different
REM origin and therefore a different, empty library.
set "PORT_FIXED=no"
if defined PORT set "PORT_FIXED=yes"
if not defined PORT set /a PORT=5173

echo ------------------------------------------------------------
echo   Interactive Poster Studio
echo ------------------------------------------------------------
echo   Folder : %CD%

REM --- Find a free port ------------------------------------------------------
REM  Mirrors start.command, which scans 20 ports. Without this, a second copy of
REM  the app (or anything else already on 5173) makes the launcher appear to work
REM  while the browser silently shows the other server's files.
:find_port
if /i "!PORT_FIXED!"=="yes" goto :port_found
netstat -ano -p tcp 2>nul | findstr /r /c:":!PORT! .*LISTENING" >nul 2>nul
if errorlevel 1 goto :port_found
set /a TRIES+=1
if !TRIES! GEQ %MAX_TRIES% (
  echo.
  echo   Ports 5173-!PORT! are all in use.
  echo   Close whatever is using them and run this file again.
  echo.
  pause
  exit /b 1
)
set /a PORT+=1
goto :find_port

:port_found
set "URL=http://127.0.0.1:!PORT!/index.html"
echo   URL    : !URL!

REM --- Pick a server: python, then the py launcher, then npx serve -----------
REM  `where python` is NOT good enough here. Stock Windows 10/11 ships an
REM  app-execution-alias stub at %LOCALAPPDATA%\Microsoft\WindowsApps\python.exe
REM  that only opens the Microsoft Store, so `where` succeeds on machines with no
REM  Python at all. Probe by actually running it instead.
python -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >nul 2>nul
if not errorlevel 1 (
  set "SERVER_CMD=python -m http.server !PORT! --bind 127.0.0.1"
  echo   Server : python -m http.server
  goto :have_server
)

py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
  set "SERVER_CMD=py -3 -m http.server !PORT! --bind 127.0.0.1"
  echo   Server : py -3 -m http.server
  goto :have_server
)

where npx >nul 2>nul
if not errorlevel 1 (
  set "SERVER_CMD=npx --yes serve --listen !PORT! ."
  echo   Server : npx serve  ^(first run downloads the package^)
  goto :have_server
)

echo ------------------------------------------------------------
echo.
echo   No usable web server was found.
echo.
echo   Install either one, then run this file again:
echo     * Python 3  -  https://www.python.org/downloads/
echo     * Node.js   -  https://nodejs.org/   ^(provides npx^)
echo.
echo   If you installed Python from the Microsoft Store, open a new
echo   Command Prompt and check that "python --version" actually prints
echo   a version number rather than opening the Store.
echo.
pause
exit /b 1

:have_server
echo ------------------------------------------------------------
echo.

REM Run the server in its own window so closing it stops the server cleanly.
start "Poster Studio server (close to stop)" cmd /k "cd /d "%~dp0" && !SERVER_CMD!"

REM Give the server a couple of seconds to bind the port before we open a tab.
timeout /t 2 /nobreak >nul 2>nul || ping -n 3 127.0.0.1 >nul

REM --- Open the browser: Chrome, then Edge, then whatever is the default -----
REM NO_BROWSER is set by the suite launcher, which opens the dashboard itself.
if defined NO_BROWSER goto :opened

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "!URL!"
  goto :opened
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "!URL!"
  goto :opened
)

if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" "!URL!"
  goto :opened
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "!URL!"
  goto :opened
)

start "" "!URL!"

:opened
echo   The app should now be open in your browser.
echo   If it is not, paste this address in yourself:
echo     !URL!
echo.
echo   Your work auto-saves in the browser as you edit.
echo   Close the "Poster Studio server" window to stop the server.
echo.
timeout /t 6 /nobreak >nul 2>nul
endlocal
exit /b 0
