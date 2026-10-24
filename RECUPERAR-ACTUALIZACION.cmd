@echo off
setlocal
chcp 65001 >nul
title AntojitOS - recuperar actualizacion pendiente
cd /d "%~dp0"
echo Recuperar la version pendiente desde la copia guardada en esta PC.
echo Este paso completa esa version. Despues podras instalar el ZIP nuevo.
echo Conserva update-pending.json y sus respaldos.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0final_script.ps1" -NoPause -Action Update -ResumePending -SourcePath "%~dp0." %*
set "ANTOJITOS_RECOVERY_RESULT=%ERRORLEVEL%"
echo.
echo Resultado: %ANTOJITOS_RECOVERY_RESULT%
if "%ANTOJITOS_RECOVERY_RESULT%"=="3010" echo Reinicia Windows y abre RECUPERAR-ACTUALIZACION otra vez para continuar.
if not "%ANTOJITOS_RECOVERY_RESULT%"=="0" if not "%ANTOJITOS_RECOVERY_RESULT%"=="3010" echo Revisa el error y los logs. Conserva el estado pendiente y sus respaldos.
echo.
pause
exit /b %ANTOJITOS_RECOVERY_RESULT%
