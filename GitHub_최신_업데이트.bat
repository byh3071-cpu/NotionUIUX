@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo GitHub 최신 버전으로 업데이트합니다...
echo.
git fetch origin
git pull origin main
echo.
echo 완료. 아무 키나 누르면 닫습니다.
pause >nul
