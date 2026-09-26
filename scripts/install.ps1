# Green Oil 路线助手 - Windows 一键下载与安装脚本 (PowerShell)
# 使用方法:
# 在 PowerShell 中执行:
#   irm https://raw.githubusercontent.com/hellomrleeus/greenoil-chrome-extension/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

# 启用现代 TLS 协议
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
$ProgressPreference = 'SilentlyContinue'

$repoZipUrl = "https://github.com/hellomrleeus/greenoil-chrome-extension/archive/refs/heads/main.zip"
$targetDirName = "greenoil-extension"

Write-Host "==================================================" -ForegroundColor Green
Write-Host "      Green Oil 路线助手 - 扩展程序下载工具       " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green

# 检查当前目录是否已是扩展目录
if (Test-Path (Join-Path $PWD "manifest.json")) {
    $targetDir = $PWD.Path
    Write-Host "[提示] 检测到当前目录已是插件源码目录。" -ForegroundColor Yellow
} else {
    $tempZip = Join-Path $PWD ".greenoil_temp_$([guid]::NewGuid().ToString('N')).zip"
    $tempExtract = Join-Path $PWD ".greenoil_extract_$([guid]::NewGuid().ToString('N'))"

    Write-Host "[1/3] 正在从 GitHub 下载最新版本代码..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $repoZipUrl -OutFile $tempZip

    Write-Host "[2/3] 正在解压并配置文件..." -ForegroundColor Cyan
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

    $sourceSubDir = Join-Path $tempExtract "greenoil-chrome-extension-main"
    $destinationDir = Join-Path $PWD $targetDirName

    if (-not (Test-Path $destinationDir)) {
        New-Item -ItemType Directory -Path $destinationDir | Out-Null
    }

    Copy-Item -Path "$sourceSubDir\*" -Destination $destinationDir -Recurse -Force

    # 清理临时文件
    Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $tempExtract -Recurse -Force -ErrorAction SilentlyContinue

    $targetDir = (Resolve-Path $destinationDir).Path
    Write-Host "[3/3] 代码就绪！" -ForegroundColor Green
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "               插件下载完成，启用指南             " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "插件所在目录绝对路径:" -ForegroundColor White
Write-Host "  $targetDir" -ForegroundColor Yellow
Write-Host "--------------------------------------------------"
Write-Host "请在 Google Chrome 浏览器中按照以下步骤启用插件:" -ForegroundColor White
Write-Host ""
Write-Host "1. 打开 Chrome 浏览器，在地址栏输入并回车:"
Write-Host "   chrome://extensions/" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. 在页面右上角，找到并开启 [开发者模式] (Developer mode)"
Write-Host ""
Write-Host "3. 点击页面左上角出现的 [加载已解压的扩展程序] (Load unpacked)"
Write-Host ""
Write-Host "4. 在弹出的文件选择器中，选中上面显示的目录:"
Write-Host "   $targetDir" -ForegroundColor Yellow
Write-Host ""
Write-Host "5. 加载完成后，点击浏览器右上角的扩展拼图图标，"
Write-Host "   将「Green Oil 路线助手」固定到工具栏即可正常使用。"
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
