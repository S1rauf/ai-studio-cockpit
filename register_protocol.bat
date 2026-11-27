@echo off
reg add "HKCU\Software\Classes\cockpit" /ve /d "URL:AI Studio Cockpit" /f
reg add "HKCU\Software\Classes\cockpit" /v "URL Protocol" /d "" /f
reg add "HKCU\Software\Classes\cockpit\shell\open\command" /ve /d "\"%~dp0bridge.exe\"" /f
echo Gotovo! Protokol cockpit:// privjazan k bridge.exe
pause
