@echo off
chcp 65001 >nul
echo 正在检查8000端口占用情况...
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000') do (
    set PID=%%a
)

if defined PID (
    echo 发现进程 %PID% 正在占用8000端口
    echo 正在关闭该进程...
    taskkill /PID %PID% /F
    echo.
    echo ✅ 端口已释放！
    timeout /t 2 >nul
) else (
    echo ✅ 8000端口未被占用
)

echo.
echo 正在启动服务器...
echo.
node server.js
