# Green Oil 路线助手 (Google Maps Chrome Extension)

Green Oil 官方 Google 地图途径点注入与多路线管理浏览器扩展（Manifest V3）。

用户在浏览 Google Maps 官方网页（`https://www.google.com/maps/*`）时，扩展能够无缝识别并注入 `[+ 途径点]` 按钮，支持多路线规划、官方导航链接生成、英文 Excel 导出与 Cloudflare Worker 云端双向同步。

---

## 核心特性

1. **官方 Google Maps 零成本运行（零 API Key）**：
   - 运行在官方地图网页上，直接从 DOM 与页面 URL 智能提取地点名称、坐标、地址、评分与 Place 标识。
   - **不调用任何收费的 Google Maps Platform API**，无额度与账单限制。

2. **多路线分组与经停点管理**：
   - 默认初始化“路线 1”，支持在扩展弹窗中快速切换路线、新建路线分组、重命名与删除。
   - 默认出发点设定：`Green Oil Inc. 4490 Chesswood Dr Unit 3, North York, ON M3J 2B9`（支持自定义修改与一键恢复默认）。
   - 途径点卡片支持上移/下移实时排序、删除单个经停点、直接跳转官方地图查看。

3. **中文 UI + 英文数据展示与导出规范**：
   - **界面交互**：全中文专业 UI，严格遵守无 Emoji 设计规范，全量采用内联矢量 SVG 图标。
   - **数据展示与导出**：途径点商户名称与地址保持英文对齐。
   - **Excel 导出规范**：点击“导出 Excel”即可生成 `.xlsx` 表格，包含规范的英文表头，且**严格移除电话号码（Phone）**。

4. **官方分段导航链接计算器**：
   - 一键生成包含当前路线所有经停点的官方导航直达链接。
   - 针对 Google Maps 单次导航通常不超过 9-10 站的限制，当经停点超过 9 个时，自动计算并拆解为 9 站一程的 Leg 分段导航，提供一键全部在新标签页打开功能。

5. **Cloudflare Worker 云端持久化**：
   - 支持 Green Oil 账号登录（基于 Bearer Token 鉴权），多路线与途径点数据双向同步至 Cloudflare KV (`map_routes_v1`)。
   - 数据与网页端工作台实时互通。

---

## 项目目录结构

```
greenoil-chrome-extension/
├── manifest.json              # 扩展清单文件 (Manifest V3)
├── background.js              # 扩展后台服务 (Service Worker)
├── api.js                     # Cloudflare Worker API 客户端
├── content.js                 # Google Maps 内容脚本 (按钮注入与数据抓取)
├── content.css                # 注入按钮与 Toast 反馈样式
├── popup.html                 # 扩展弹窗管理面板 HTML
├── popup.js                   # 扩展弹窗交互逻辑 (多路线、排序、导航、导出)
├── popup.css                  # 弹窗现代简约科技绿主题样式
├── icons/                     # 扩展图标 (16x16, 32x32, 48x48, 128x128 PNG)
├── vendor/
│   └── xlsx.full.min.js       # 离线 SheetJS Excel 导出库
├── scripts/
│   └── generate_icons.py      # 图标生成工具脚本
└── README.md
```

---

## 安装与使用指引

### 1. 一键下载与安装 (推荐)

用户无需安装 git，直接在终端中运行一行命令即可下载最新版本代码至当前目录的 `greenoil-extension` 文件夹，并打印启用指引：

- **macOS / Linux 用户**（打开终端 Terminal 执行）：
  ```bash
  curl -fsSL https://raw.githubusercontent.com/hellomrleeus/greenoil-chrome-extension/main/scripts/install.sh | bash
  ```

- **Windows 用户**（在开始菜单搜索并打开 PowerShell 执行）：
  ```powershell
  irm https://raw.githubusercontent.com/hellomrleeus/greenoil-chrome-extension/main/scripts/install.ps1 | iex
  ```
  *(注：也可以直接下载并双击运行 `scripts/install.bat`)*

### 2. 在 Chrome 浏览器中启用插件
1. 打开 Google Chrome 浏览器，在地址栏输入 `chrome://extensions/` 并回车。
2. 开启右上角的 **“开发者模式” (Developer mode)** 开关。
3. 点击左上角的 **“加载已解压的扩展程序” (Load unpacked)** 按钮。
4. 在弹出的文件选择器中，选择刚刚下载解压的目录（例如当前目录下的 `greenoil-extension` 文件夹，或本工程源码根目录）。
5. 扩展安装成功，可在浏览器右上角扩展程序列表中将 **“Green Oil 路线助手”** 图标固定到工具栏。

### 3. 在 Google 地图中添加途径点
1. 在浏览器中打开官方 [Google Maps](https://www.google.com/maps)。
2. 在搜索框中搜索任何餐馆或商户（例如搜索 `Church's Texas Chicken` 或多伦多任意餐馆）。
3. 点击商户，左侧展开商户详细信息面板。
4. 面板操作栏（路线、保存同排位置）将自动出现 Green Oil 专属绿色的 **`[+ 途径点]`** 按钮。
5. 点击该按钮，按钮变为“已添加”，屏幕左下角弹出提示，扩展图标角标数字自动加 1。

### 4. 管理路线与导出
1. 点击浏览器工具栏的扩展图标，打开管理弹窗。
2. 可查看当前路线中的所有经停点、调整顺序或删除。
3. 可在下拉框中切换路线或点击“+ 新建”创建新的路线组。
4. 点击 **“生成导航链接”**，可在 Google 地图中查看完整驾驶路线（超过 9 站自动提供分段导航）。
5. 点击 **“导出 Excel”**，立即下载不含电话号码的规范英文经停点清单。
6. 点击右上角账号图标输入用户名与密码，即可将路线实时备份至 Green Oil 云端。
