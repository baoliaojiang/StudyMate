# 研学帮 StudyMate

> 从立项到结题，把研究性学习的四份材料一次做完。
> AI 研究性学习助手 · 第三方开源工具 · 数据只存本机

[在线体验](https://baoliaojiang.github.io/StudyMate/) ｜ [下载安装包](https://github.com/baoliaojiang/StudyMate/releases) ｜ [提交问题](https://github.com/baoliaojiang/StudyMate/issues) ｜ [更新日志](https://github.com/baoliaojiang/StudyMate/releases)

**本项目与福州鼓山中学及其管理部门不存在官方隶属、授权、合作或背书关系，不代表学校、教师或教育主管部门立场。** 初期按该校下发的研究性学习表格适配，未使用任何学校商标、校徽或官方身份标识。

---

## 一句话说明

一个项目 = **一整套交付物**：开题报告、研究记录、中期报告、结题报告，加上答辩演示稿。四份材料共享同一套项目事实，后一份继承前一份已确认的内容，避免重复填写和前后矛盾。导出的是真正的 `.docx` / `.pptx`，可在 Word / WPS / PowerPoint 里继续编辑。

| 交付物 | 说明 |
| --- | --- |
| 开题报告 | 按学校《课题开题报告》表格还原 |
| 研究记录 | 篇数按上下学期分别设定，导出按「第 x 次」编号 |
| 中期报告 | 按《课题中期检查报告》表格还原 |
| 结题报告 | 十章长文，可选封面与目录 |
| 答辩演示稿 | 逐页生成 16:9 PPTX，附口播讲稿 |

---

## 在线版与下载

| 形态 | 地址 / 文件 | 说明 |
| --- | --- | --- |
| 在线版 | <https://baoliaojiang.github.io/StudyMate/> | 免安装，打开即用；数据存在当前浏览器 |
| Windows | `StudyMate-1.0.12-setup.exe` / `StudyMate-1.0.12-portable.exe` | 安装版可选目录，便携版双击即用 |
| Android | `StudyMate-1.0.12-release.apk` | 自签名 Release 包 |
| 源码 | 本仓库 `main` 分支 | 自行构建，见下方 |
| 安装包备用 | QQ 群 `1134731856` | 进群后在群文件下载 |

安装包与 APK 都放在 [Releases](https://github.com/baoliaojiang/StudyMate/releases)。应用内「设置 → 检查更新 / 关于」也直接放了本仓库、Releases 与 Issues 入口。Windows 未做代码签名，首次运行 SmartScreen 会提示「未知发布者」；Android 为自签名包，安装时系统也会给出提示。

> 在线版使用 hash 路由，静态托管即可。浏览器本地数据与桌面版、安卓版互相独立，不自动同步。

---

## 能做什么

- **建项目**：粘贴教师要求，规则解析离线可用，AI 只做补空；指导教师与成员姓名必须本人填写，AI 不猜不编
- **做研究**：纯理论 / 实践 / AI 模拟可混合，模拟内容全程带「（AI 模拟示例）」标识并保留到导出文件
- **配模型**：OpenAI 兼容 / Anthropic / Gemini / 本地模型，多服务商、多 Key、逐段连接测试、模型可用性校验、预算与调用上限
- **找资料**：OpenAlex / Crossref / arXiv / Semantic Scholar 等公开学术接口，以及通用网页检索；结果默认「待核实」，不会自动当事实
- **写报告**：缺事实就留白（「待补充」），不编数据、访谈、文献；需要撑篇幅时可切「写满再核对」，推断一律标「需核实」
- **看过程**：17 步工作流，5 道确认门和 1 道真实记录守卫；每一步实时显示正在做什么、耗时与调用次数，可暂停、继续、重试、改内容后再确认
- **导交付**：单份 DOCX、研究记录合集、按范围打包的 ZIP、Markdown、PPTX 与讲稿；导出前自动核对必填栏目、待核实来源与模拟标识，清单随包附带；PDF 走系统打印
- **管数据**：IndexedDB 本机存储、口令加密的备份导出 / 恢复、一键清档；存储页可统计附件与全文占用，备份显示体积
- **读得舒服**：打字流速度三档（适中按人类阅读速度），回复只跟随阅读位置，往上翻看时不会被拽回底部
- **自定义**：开发者中心可查看并修改助手、技能、工作流与提示词；外部技能只接受声明式内容，不执行任何代码

界面为浅色 / 深色 / 跟随系统三档，电脑与手机共用同一套导航；每一次页面切换都带方向感转场，可在设置里关闭动效。

---

## 快速开始

环境：Node.js ≥ 20。

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 单元测试
npm run typecheck  # 类型检查
npm run build      # 类型检查 + Web 生产构建
npm run preview    # 预览 dist
```

第一次打开会进入引导页，需要读完并确认隐私政策、用户协议与声明。

### 接一个模型

1. 设置 → API 管理中心 → 选一个预设（如 DeepSeek）
2. 填入 API 密钥 → 保存
3. 「同步模型」或手动录入模型名
4. 「连接测试」依次检查地址、鉴权、指定模型生成

密钥经 AES-GCM 加密后存在本机，只通过请求头传递，不写进 URL、不上传开发者服务器。未配置模型时，手写内容、填记录、导出文档仍可正常使用。

---

## 构建

```bash
# Web / PWA → dist/
npm run build

# 在线版（相对路径，适用于 GitHub Pages 子路径）→ dist-pages/
npm run build:pages

# Windows EXE → dist-electron/ 与 release/
npm run electron:build

# Android APK
npm run build:android
npx cap sync android
cd android && ./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

技术栈：Vue 3 + TypeScript + Vite + Pinia + Dexie/IndexedDB + Capacitor 8 + Electron。`docx` 生成真 OOXML，`pptxgenjs` 生成 PPTX，PDF 走系统打印，不引入第二套排版引擎。

Android 端要求 compileSdk / targetSdk 36；Windows 端用 electron-builder 打包，Electron 下载可设置 `ELECTRON_MIRROR`。

---

## 目录

```
src/
  core/        设置、数据模型、IndexedDB、密钥加密、任务守卫
  ai/          服务商适配、路由、网关、预算与脱敏
  agents/      助手定义与运行时
  skills/      声明式技能规则（不含可执行代码）
  workflow/    17 步流程、确认门、实时过程记录
  reports/     四份报告表格结构、缺口检查、模板导入
  search/      检索来源适配与去重
  ppt/         演示稿策划、清洗与模板兜底
  docx/        DOCX 生成引擎
  export/      DOCX / PPTX / ZIP / Markdown 导出
  views/       页面
  components/  组件（含全局确认弹层、工作流面板）
tests/         Vitest 用例
docs/          架构、法务文本、说明文档
samples/       四份材料的 DOCX 样例
electron/      桌面主进程
```

---

## 数据与隐私

- 项目资料默认只存本机 IndexedDB，不上传开发者服务器，也没有遥测
- 只有主动点击 AI / 检索功能时，才会把必要文本发给你自己配置的服务商
- 可随时导出或删除本地数据，备份文件走口令加密
- 浏览器端的本地加密无法抵御同源脚本或本机恶意程序，界面里已如实说明

详见 [docs/privacy.md](docs/privacy.md) 与应用内「法律声明」。

## 事实边界

- 不编造文献、作者、DOI 与 URL；检索结果默认是「待核实」
- 缺真实活动记录时，工作流不会推进到中期报告
- 「指导教师意见」等学校栏目不代写，只留签名与日期
- AI 生成内容仅作草稿，需逐条核实后再提交；提交前请按学校要求自行审阅

详见 [docs/disclaimer.md](docs/disclaimer.md)。

---

## 反馈与许可证

- 问题与建议：[Issues](https://github.com/baoliaojiang/StudyMate/issues)
- QQ 群：1134731856
- 许可：[使用许可](LICENSE)（学习免费，商用与分发需授权；说明见 [docs/license-note.md](docs/license-note.md)）
- 作者主页：<https://github.com/baoliaojiang>

### 许可范围

**免费、不用问**：学习与阅读源码、自己安装使用、在班级或社团里用、为自己学校改模板改流程并免费分发给本校师生。

**要先拿授权**：商业使用（收费售卖、付费课程、按次咨询代做、招投标、机构内训、作为服务或产品的一部分对外提供），
以及校内免费适配之外的任何二次分发（上架应用商店、公开传到下载站或网盘、打包进别的软件、换个名字发布）。
授权入口：QQ 群 **1134731856**，说明「谁、用来做什么、发给谁、是否收费」，拿到明确答复再用。

**任何形式的使用都要保留**：

```
本项目基于 研学帮 StudyMate 修改
原作者：baoliaojiang
原项目：https://github.com/baoliaojiang/StudyMate
```

这条信息要出现在软件内使用者能点到的位置（例如「设置 → 关于 → 制作人员」），不能只写在安装包说明或源码注释里。

v1.0.13（含）之前的版本发布时采用 MIT 许可，已获得的授权继续有效。

版本说明、更新日志与检查更新入口都在应用内；发布记录见 [Releases](https://github.com/baoliaojiang/StudyMate/releases)。
