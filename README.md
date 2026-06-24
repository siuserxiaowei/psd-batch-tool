# PSD 批量换图工作台

<!-- SIUSER-REPO-GUIDE:START -->
## 项目介绍 / Project Introduction

### 中文
PSD 批处理工具：面向设计素材自动化、图片工作流和批量处理。

### English
PSD batch tool for design automation, image workflows, and bulk processing.

## 使用方式 / Usage

### 中文
1. 先克隆仓库并安装 Node 依赖。
2. 根据 `package.json` 中的 scripts 启动开发、构建或测试命令。
3. 如果有在线入口，先对照线上页面理解最终效果，再回到源码修改。

### English
1. Clone the repository and install the Node dependencies.
2. Use the scripts in `package.json` for development, build, or tests.
3. If a live link exists, review the deployed page first, then make source changes.

## 入口与元信息 / Entry Points & Metadata

- GitHub 仓库 / Repository: https://github.com/siuserxiaowei/psd-batch-tool
- Live / 在线入口：https://siuserxiaowei.github.io/psd-batch-tool/
- 默认分支 / Default branch: `main`
- 主要语言 / Primary language: `TypeScript`
- 可见性 / Visibility: `public`
- 仓库类型 / Repository type: `source`
- Topics / 主题：`batch-processing`, `poster-generator`, `psd`, `react`, `vite`

## 本地运行 / Local Run

```bash
git clone https://github.com/siuserxiaowei/psd-batch-tool.git
cd psd-batch-tool
npm install
npm run dev
npm run build
```

## 仓库结构 / Repository Map

| 路径 / Path | 中文说明 | English |
| --- | --- | --- |
| `README.md` | 项目入口说明，先读这里。 | Main project entry point and orientation. |
| `package.json` | Node/前端项目配置、依赖和脚本。 | Node/frontend dependencies and scripts. |
| `index.html` | 静态站首页或页面入口。 | Static-site homepage or entry page. |
| `src` | 主要源码目录。 | Main source-code directory. |
| `public` | 公开静态资源。 | Public static assets. |
| `docs` | 文档或 GitHub Pages 输出目录。 | Documentation or GitHub Pages output. |
| `.github` | GitHub Actions 和协作自动化配置。 | GitHub Actions and collaboration automation. |
| `.gitignore` | 项目文件或目录。 | Project file or directory. |
| `eslint.config.js` | 项目文件或目录。 | Project file or directory. |
| `package-lock.json` | npm 依赖锁定文件。 | npm dependency lockfile. |
| `tsconfig.app.json` | 项目文件或目录。 | Project file or directory. |
| `tsconfig.json` | 项目文件或目录。 | Project file or directory. |

## 维护备注 / Maintenance Notes

- 中文：当项目目标、在线入口、运行命令或目录结构变化时，同步更新本说明。
- English: Keep this guide updated when the project purpose, live link, run commands, or structure changes.
- 中文：修改代码、数据或生成页面后，优先运行相关构建、测试或校验命令。
- English: After changing code, data, or generated pages, run the relevant build, test, or validation command.

## 安全与隐私 / Safety & Privacy

- 中文：不要提交 API key、token、密码、cookie、私有链接或内部账号资料。
- English: Do not commit API keys, tokens, passwords, cookies, private URLs, or internal account data.
- 中文：公开 GitHub Pages 前，确认资料已脱敏并允许公开。
- English: Before publishing GitHub Pages output, confirm the material is redacted and cleared for public release.
<!-- SIUSER-REPO-GUIDE:END -->



<!-- SIUSER-SEO-INTRO:START -->

## 项目介绍 / Project Introduction

**中文介绍**：PSD 批处理工具，用于图片素材、设计文件和内容生产流程中的批量处理与自动化。

**English**: A PSD batch processing tool for automating image assets, design files, and content production workflows.

**SEO 关键词 / SEO Keywords**: PSD, batch processing, design automation, image workflow, 设计自动化

<!-- SIUSER-SEO-INTRO:END -->

一个给设计师和运营同学试用的 PSD 海报批量生成原型。它的目标很简单：保留设计师在 Photoshop 里的模板工作流，把重复出图这一步变成网页里的几次点击。

给设计师看的操作文档：[PSD 批量换图工作台使用说明](./docs/usage.md)

## 适合解决什么问题

- 一套海报版式，需要批量替换商品图、人物图、二维码或活动主图。
- 同一个价格角标、标签、姓名、标题等文字区域，需要按表格逐行替换。
- 设计师习惯先在 PS 里做好模板，不想重新学习复杂的设计工具。
- 运营同学只需要准备图片和表格，就可以导出一批 PNG 成品。

## 当前功能

- 导入 PSD 文件并读取图层。
- 自动优先识别带 `_替换`、`换图`、`replace` 等命名的图层。
- 从 PSD 图层里选择可替换槽位，并可保存当前 PSD 的槽位配置。
- 支持图片槽位：铺满、完整显示、拉伸三种模式。
- 支持图片裁切：矩形、圆角、圆形，适合 Logo、头像、二维码。
- 支持文字槽位：按表格内容替换，支持字号、颜色、字体、对齐，并自动缩小避免溢出。
- 支持上传 TTF / OTF / WOFF / WOFF2 字体文件。
- 支持 CSV / XLSX 数据表。
- 支持批量图片上传。
- 自动提示表格缺字段、图片文件名匹配不上等问题。
- 实时预览每一行生成结果。
- 一键导出 PNG 压缩包。
- 内置样例和测试数据，方便快速体验。

## 推荐的 PS 模板命名方式

为了让工具更好识别，建议把要替换的图层命名得直白一点：

```text
商品图_替换
Logo_替换
价格_替换
角标文案_替换
姓名_替换
二维码_替换
```

如果是黄色价格牌这类区域，建议拆成多个图层：

```text
黄色价格底框      固定不替换
角标文案_替换    表格列名：角标文案
价格_替换        表格列名：价格
```

表格示例：

```csv
页面名称,姓名,Logo,商品图,角标文案,价格
张三_新人价,张三,logo-a.png,product-a.png,新人价,¥129
李四_会员价,李四,logo-b.png,product-b.png,会员价,¥159
王五_限时价,王五,logo-c.png,product-c-wide.png,限时价,¥199
```

如果要按行切换字体，可以增加全局字体列，或者给某个文字槽位单独指定字体：

```csv
页面名称,姓名,字体:姓名
张三卡片,张三,BrandFont.otf
李四卡片,李四,Songti SC
```

## 设计师试用流程

1. 打开页面后，先点「测试」看内置样例。
2. 上传自己的 PSD 模板。
3. 在「PSD 图层」里点选需要替换的图层。
4. 在「替换槽位」里确认槽位类型是「图片」还是「文字」。
5. 给图片槽位选择裁切方式，给文字槽位调整字号、颜色、字体、对齐。
6. 上传图片素材和可选字体。
7. 上传 CSV 或 XLSX 表格。
8. 查看数据匹配提醒，修正缺图或列名不一致的问题。
9. 翻页预览不同成品。
10. 点击「导出 PNG 包」。

## 本地开发

```bash
npm install
npm run dev
```

常用检查：

```bash
npm run lint
npm run build
```

## 技术栈

- React + TypeScript + Vite
- ag-psd：读取 PSD 图层
- JSZip：生成批量导出压缩包
- read-excel-file：读取 XLSX 表格
- lucide-react：界面图标

## 当前原型限制

- 目前导出格式是 PNG。
- PSD 的复杂效果、智能对象和部分高级混合效果可能无法完全还原。
- 文字渲染使用浏览器字体，和 Photoshop 字体可能存在细微差异。
- 更适合验证「批量替换和出图流程」是否顺手，后续再补更完整的 PSD 兼容性。

<!-- SIUSER-CONTACT:START -->

## 联系我 / Contact

想交流 AI 工具、内容自动化、SEO、私域增长或项目合作，可以扫码加我微信。

For collaboration on AI tools, content automation, SEO, private-domain growth, or product experiments, scan the WeChat QR code below.

<img src="https://raw.githubusercontent.com/siuserxiaowei/siuserxiaowei/main/assets/contact/wechat-qrcode.jpg" width="180" alt="WeChat QR code / 微信二维码" />

**关键词 / Keywords**: PSD, batch processing, design automation, image workflow, AI tools, AI automation, GitHub Pages, SEO

<!-- SIUSER-CONTACT:END -->
