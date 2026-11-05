# 架构

## 技术路线与理由

**统一 Web 核心 + 多端外壳**：Vue 3 + TypeScript + Vite，PWA 直接可用；桌面用 Electron（Node 环境本机就能打包，不需要 Rust），安卓用 Capacitor（本机已有 `D:/android-sdk`）。

为什么不是 Tauri：本机没有 Rust 工具链，首次编译成本高，且当前阶段最需要的是「立刻能跑、能验证」。Electron 体积大，但换来的是本机零额外依赖就能出 EXE，以及成熟的文件/系统能力。若后续在意体积，可平滑迁到 Tauri —— 业务逻辑全在 `src/`，与外壳无关。

为什么不是纯后端方案：要求「不要求开发者部署服务器」。所有能力必须能离线成立，AI 只是可选的增强。

## 分层

```
视图层    views / components          只负责展示与交互
状态层    stores (Pinia)              UI 状态与业务流程编排
领域层    reports / agents / skills   报告骨架、Agent 运行时、Skill 规则
能力层    ai / search / docx / export 适配器与生成器（无 UI 依赖）
存储层    core/db (Dexie) + crypto    本地库与密钥保护
```

依赖方向单向向下：领域层不 import 视图层，能力层不 import stores。这样能力层可以单独测试（见 `tests/`）。

## 关键设计

### 1. 真实性闸门（这是产品的地基）

- 每个内容单元（记录、数据、章节）都带 `sourceType`：`real | literature | web | simulated | provided`。
- `StudyRecord.confirmed` 表示用户确认真实发生。
- `AgentRuntime` 在生成前检查：章节属于「研究工作 / 阶段成果 / 课题进展 / 主要过程」且项目无已确认真实记录时，**拒绝生成**。
- 生成后 `sanityCheck` 再做一次：出现「已完成 / 发放了 N 份 / 百分比」但无对应证据时，返回告警文案，UI 必须展示。
- DOCX 生成器不依赖 UI 是否记得打标：只要 `containsSimulated` 或项目含模拟模式，文首自动加提示框。

### 2. 报告继承

四份报告共读 `Project` 同一份事实。章节生成时把「已确认真实活动 / 数据集 / 来源清单」作为上下文注入，并明确写出「无记录则不能写已完成」。
后续优化方向：把已确认事实抽成 `Fact` 表，做跨报告一致性校验（当前由「总审核」Agent 承担）。

### 3. 成本控制

三道闸：`compress()` 压缩上下文 → 网关 LRU 缓存（5 分钟、同 key 命中不重复请求）→ `budgetSnapshot()` 每日调用/金额上限。超限直接抛 `BudgetExceededError`，不静默降级。
模型按 `tier`（cheap / balanced / strong）自动挑选，可被 Agent 级手动映射覆盖，也可整体关闭自动分配。

### 4. 适配器隔离

`ProviderAdapter` 只有三个方法：`chat` / `listModels` / `supportsBalance`。新增服务商不改其他代码。
约定：**Key 一律走 header**（Gemini 用 `x-goog-api-key`，不拼 URL）。`/models` 不支持时抛 `ModelListUnsupportedError`，UI 转为手动添加，不假装成功。

### 5. 声明式 Skill

`SkillDefinition.capability` 只允许 `prompt | checklist | format`，内容是一段规则文本，注入系统提示词。
没有 `eval`、没有动态 import、没有沙箱逃逸面。外部导入的 Skill 必须展示来源与权限后才可启用。

## 数据流：生成一节的完整链路

```
用户点「AI 生成本节」
  → ReportEditor 调 AgentRuntime.run()
  → runtime 组装 system prompt（Agent + Skills + 硬性约束）
  → 组装上下文（项目事实 / 真实活动 / 模拟记录 / 数据集 / 来源）
  → 前置闸门：本章节是否需要证据？项目有没有真实记录？→ 没有就中止
  → AiGateway.chat()：预算检查 → 缓存 → 选模型 → 适配器 → 记录用量
  → 返回正文 → sanityCheck 告警 → 写回 section.body
  → 用户保存 → 导出时 docx/builder 自动补模拟提示
```

## 已知取舍

- 章节正文用 Markdown 存，导出时转 OOXML。富文本（表格内嵌、脚注）暂不支持。
- 目录用 Word 域（TOC field），打开文档时需要 Word 更新域才显示页码。
- 研究记录是固定字段表（对齐学校表格），不是自由富文本 —— 换来的是导出格式稳定。
