@echo off
setlocal
chcp 65001 >nul
title AntojitOS - actualizar desde carpeta ZIP
cd /d "%~dp0"
echo Actualizar AntojitOS con la carpeta ZIP nueva.
echo Conserva la instalacion anterior en su ubicacion; no copies archivos encima.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0final_script.ps1" -NoPause -Action Update -SourcePath "%~dp0." %*
set "ANTOJITOS_UPDATE_RESULT=%ERRORLEVEL%"
echo.
echo Resultado: %ANTOJITOS_UPDATE_RESULT%
if "%ANTOJITOS_UPDATE_RESULT%"=="3010" echo Reinicia Windows y abre ACTUALIZAR-APP otra vez para continuar.
if not "%ANTOJITOS_UPDATE_RESULT%"=="0" if not "%ANTOJITOS_UPDATE_RESULT%"=="3010" echo Revisa el error y la carpeta de logs indicada arriba.
echo.
pause
exit /b %ANTOJITOS_UPDATE_RESULT%
