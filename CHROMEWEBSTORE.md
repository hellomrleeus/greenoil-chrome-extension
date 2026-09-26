# Chrome Web Store Listing — Green Oil 路线助手

> Last Updated: 2026-09-27

## Store Listing

**Extension Name** [REQUIRED]
Green Oil 路线助手

**Short Description** [REQUIRED]
Green Oil 官方 Google 地图途径点注入与多路线管理扩展，支持导航链接生成、英文 Excel 导出与云端同步。

**Detailed Description** [REQUIRED]
Green Oil 路线助手是专为 Green Oil 业务路线规划与餐厅商户管理打造的 Google 地图效率工具。

主要功能：
- 路线途径点智能规划：一键注入多途径点到 Google 地图，生成最优拜访路线与多途径点导航链接。
- 餐厅与商户智能识别：在地图当前可视区域内自动探索餐厅商户，高亮油炸用油餐饮店，并与内部系统进行实时匹配。
- 客户数据无缝标记：在地图中实时查看已签约客户、重点跟进客户与潜在商户。
- 报表导出与云端备份：支持一键导出格式化英文 Excel 路线行程表，支持云端多路线保存与跨设备同步。

使用方法：
1. 打开 Google 地图网页版（maps.google.com）。
2. 点击浏览器右上角扩展栏中的 Green Oil 路线助手图标。
3. 导入或选择需要规划的路线点，点击注入或规划路线。
4. 在地图中直接查看餐厅信息、油炸标记及客户档案。

隐私说明：
本扩展仅在用户主动授权与登录内部企业系统后同步路线与商户信息。所有业务数据加密传输，绝不出售或分享给任何第三方。

支持与反馈：
如有任何使用问题或功能建议，请联系内部技术支持团队。

版本 1.0.1 — 支持地图视窗餐厅探索、常驻坐标图钉标记与弹出层控制。

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Manages and visualizes route waypoints on Google Maps, matching nearby business accounts and exporting organized itineraries.

**Primary Language** [REQUIRED]
Chinese (Simplified)

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename / Notes |
|-------|-----------|--------|------------------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ 待截取 | Google 地图注入途径点与路线概览界面 |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ 待截取 | 弹出窗口（Popup）路线管理与 Excel 导出 |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ 待截取 | 地图餐厅探索与 MIS 商户匹配图钉展示 |
| Small Promo Tile [RECOMMENDED] | 440×280 PNG/JPEG | ⬜ 待设计 | 应用展示小宣传图 |

---

## Permissions Justification

审核提交时在 Developer Dashboard 中填写的权限理由（建议使用英文填写）：

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Used to store route configurations, user preferences, and a local cache of matched business records across sessions. |
| `activeTab` | permissions | Used to access the currently active Google Maps tab when the user clicks the extension popup to inject route waypoints. |
| `tabs` | permissions | Used to inspect Google Maps tab URLs and update navigation smoothly between stops without full page reloads. |
| `scripting` | permissions | Used to inject the visual marker overlay script into the Google Maps canvas. |
| `cookies` | permissions | Used to read enterprise login session cookies from greenoilinc.com to authenticate MIS customer lookup requests. |
| `https://*.google.com/maps*` (and regional TLDs) | host_permissions | Required to detect visible map view bounds, read place search responses, and render resident waypoint pins on Google Maps. |
| `https://greenoil-api.ydxhjw4j5w.workers.dev/*` | host_permissions | Backend API endpoint used to sync saved routes, load configurations, and cloud backups. |
| `https://api.typesafe.ai/*` | host_permissions | Machine learning API used to classify restaurant menus and identify food establishments with frying oil needs. |
| `*://*.greenoilinc.com/*` | host_permissions | Enterprise MIS system endpoint to verify matching client accounts for nearby restaurants. |

---

## Privacy & Data Use

### Data Collection Declarations

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | N/A | No |
| Health info | No | No | N/A | No |
| Financial info | No | No | N/A | No |
| Authentication info | Yes (Session Cookies) | Yes (to GreenOil internal server) | Authenticate user against enterprise MIS system | No |
| Personal communications | No | No | N/A | No |
| Location | Yes (Map bounds/coords) | Yes (to Google Maps / API) | Calculate routes and display nearby places | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content | Yes (Maps place names) | Yes (to Classification API & MIS) | Match restaurant names with customer database | No |

### Certifications
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for creditworthiness, lending, or advertising
- [x] Data is transmitted over secure HTTPS connections only

---

## Packaging & Exclusions

打包为 ZIP 上传时，必须排除开发环境文件与敏感信息：

```bash
zip -r greenoil-route-assistant-v1.0.1.zip . \
  -x ".git/*" \
  -x ".DS_Store" \
  -x "tests/*" \
  -x "scripts/*" \
  -x "tmp-profile2/*" \
  -x "CHROMEWEBSTORE.md" \
  -x "README.md"
```
