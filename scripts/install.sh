#!/usr/bin/env bash
#
# Green Oil 路线助手 - 一键下载与安装脚本 (macOS / Linux)
#
set -e

REPO_ZIP_URL="https://github.com/hellomrleeus/greenoil-chrome-extension/archive/refs/heads/main.zip"
TARGET_DIR_NAME="greenoil-extension"
TARGET_DIR="$(pwd)/${TARGET_DIR_NAME}"

echo "=================================================="
echo "      Green Oil 路线助手 - 扩展程序下载工具       "
echo "=================================================="

# 如果当前目录本身就是插件根目录（包含 manifest.json）
if [ -f "$(pwd)/manifest.json" ]; then
  TARGET_DIR="$(pwd)"
  echo "[提示] 检测到当前目录已是插件源码目录。"
else
  TEMP_ZIP="$(pwd)/.greenoil_temp_$$.zip"
  TEMP_EXTRACT="$(pwd)/.greenoil_extract_$$"

  echo "[1/3] 正在从 GitHub 下载最新版本代码..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$REPO_ZIP_URL" -o "$TEMP_ZIP"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TEMP_ZIP" "$REPO_ZIP_URL"
  else
    echo "[错误] 系统未检测到 curl 或 wget，请先安装后再试。"
    exit 1
  fi

  echo "[2/3] 正在解压并配置文件..."
  rm -rf "$TEMP_EXTRACT"
  mkdir -p "$TEMP_EXTRACT"
  unzip -q "$TEMP_ZIP" -d "$TEMP_EXTRACT"

  mkdir -p "$TARGET_DIR"
  cp -R "$TEMP_EXTRACT"/greenoil-chrome-extension-main/* "$TARGET_DIR"/

  # 清理临时文件
  rm -rf "$TEMP_ZIP" "$TEMP_EXTRACT"
  echo "[3/3] 代码就绪！"
fi

echo ""
echo "=================================================="
echo "               插件下载完成，启用指南             "
echo "=================================================="
echo "插件所在目录绝对路径:"
echo "  ${TARGET_DIR}"
echo "--------------------------------------------------"
echo "请在 Google Chrome 浏览器中按照以下步骤启用插件:"
echo ""
echo "1. 打开 Chrome 浏览器，在地址栏输入并回车:"
echo "   chrome://extensions/"
echo ""
echo "2. 在页面右上角，找到并开启 [开发者模式] (Developer mode)"
echo ""
echo "3. 点击页面左上角出现的 [加载已解压的扩展程序] (Load unpacked)"
echo ""
echo "4. 在弹出的文件选择器中，选中上面显示的目录:"
echo "   ${TARGET_DIR}"
echo ""
echo "5. 加载完成后，点击浏览器右上角的扩展拼图图标，"
echo "   将「Green Oil 路线助手」固定到工具栏即可正常使用。"
echo "=================================================="
echo ""
