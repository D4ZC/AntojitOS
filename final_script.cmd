@echo off
setlocal
chcp 65001 >nul
title AntojitOS - final_script
cd /d "%~dp0"
echo AntojitOS - instalacion, inicio y actualizacion
echo Los errores quedaran visibles en esta ventana.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0final_script.ps1" -NoPause %*
set "ANTOJITOS_RESULT=%ERRORLEVEL%"
echo.
echo Resultado: %ANTOJITOS_RESULT%
if "%ANTOJITOS_RESULT%"=="3010" echo Reinicia Windows y abre final_script otra vez para continuar.
if not "%ANTOJITOS_RESULT%"=="0" if not "%ANTOJITOS_RESULT%"=="3010" echo Revisa el error y la carpeta de logs indicada arriba.
echo.
pause
exit /b %ANTOJITOS_RESULT%
