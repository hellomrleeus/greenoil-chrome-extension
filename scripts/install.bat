@echo off
chcp 65001 >nul
title Green Oil 路线助手 - 一键安装

echo ==================================================
echo       Green Oil 路线助手 - Windows 一键安装
echo ==================================================
echo 正在启动安装脚本，请稍候...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/hellomrleeus/greenoil-chrome-extension/main/scripts/install.ps1 | iex"

echo.
echo 按任意键退出窗口...
pause >nul
