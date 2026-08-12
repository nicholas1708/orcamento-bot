@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo === O que mudou ===
git status --short
echo.

git add -A
git commit -F .git-commit-msg.txt
if errorlevel 1 (
  echo.
  echo Nada para commitar ^(ou o commit falhou^). Nada foi enviado.
  pause
  exit /b 1
)

git push origin main
if errorlevel 1 (
  echo.
  echo O push falhou. Confira o login do GitHub e tente de novo.
  pause
  exit /b 1
)

echo.
echo Push concluido. O GitHub Actions ja esta buildando a imagem:
echo   ghcr.io/nicholas1708/orcamento-bot:latest
echo.
echo Depois que o build terminar, atualize o servico no servidor:
echo   docker service update --image ghcr.io/nicholas1708/orcamento-bot:latest --force orcamento_bot
echo.
pause
