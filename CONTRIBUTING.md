# 开发规范

保持单人、本地优先、轻量。先确定领域契约，再删除冗余；不要为了统一风格重命名已有持久化字段。

## 注释

源码、测试、开发脚本、CSS 和 HTML 默认禁止注释。只允许下列前缀，且必须跟随具体说明：

- `@reason`：代码本身无法表达的原因、约束或有意取舍。
- `@compat`：外部协议、浏览器或历史数据的兼容要求。
- `@license`：必须保留的版权、许可证说明。

禁止复述实现、章节分隔、TODO、被注释掉的代码、空泛理由和工具禁用指令。先尝试清晰命名、拆分函数或删除死代码，再判断是否确需注释；前缀不是保留冗余说明的通行证。ESLint 检查 JS/TS/JSX/TSX 的注释，轻量脚本检查 CSS/HTML；Markdown 正文、提示词模板和生成物不在代码注释规则内。

## 字段与模块

领域字段的唯一来源是 `src/types.ts`，适配器契约和错误模型在 `src/providers/types.ts`。文档只解释关系和边界，不再复制每个字段的字典。

- `id` 表示本地实体身份，`sessionId`/`attachmentIds` 等表示引用；`modelId` 是服务商原始模型 ID，`modelKey`/模型的 `key` 为 `providerId::modelId`，`label` 仅用于展示。
- `Asset.source` 区分上传和生成；`prompt` 是实际提交图像接口的提示词；`revisedPrompt` 保存供应商修订文本，旧记录也可能保存本地修订；`originalPrompt` / `reviewed` 保留历史自动润色数据兼容。删除会话保留图库资产，因此 `Asset.sessionId` 可以指向已删除会话，不做级联删除。
- `SessionDraft.studio` 与 `chat` 是两套草稿，各自的附件 ID 不混用；消息中的 `attachmentIds` 是输入附件，`imageIds` 是生成结果。`capabilities` 是发现/人工声明的模型能力，`ImageParams` 是经过能力归一化的用户选项；`imageEditing` 是展示镜像，`image.supportsEdit` 控制实际参考图请求，写入与恢复时保持一致。
- `ConnectionMeta` 是不含密钥的持久化连接信息；`ProviderConfig` 扩展它并在运行时持有 `apiKey`；`ProviderRuntime` 仅表示内存中的连接状态，不持久化。
- `createdAt`、`updatedAt`、`fetchedAt` 使用 Unix 毫秒；图像真实宽高使用像素；标注几何按宽度 1000 的画布归一化，笔迹点使用标注范围内的比例。`dataUrl` 包含 MIME 与编码前缀，`mimeType` 只包含媒体类型。新增其他单位须在名称中明确。
- 可选字段表示缺省/未提供；`null` 只用于明确的未选择状态。不要在同一边界混用空字符串、`undefined`、`null` 表达同一个意思。
- 外部协议字段在 `providers/` 映射为领域类型；迁移与不可信本地数据在 `lib/migration.ts`、`lib/storage.ts` 和 hydration 边界归一化。改变已持久化语义必须处理旧数据。
- `store/` 管理领域操作与持久化；`views/` 组织页面；`components/` 管理局部交互；`lib/` 放可复用的窄职责函数；`agent/` 只依赖统一适配器；`worker/` 只负责同源代理与静态资源。
- 不复制已有枚举、协议选择或模块职责。只有实际出现复用需求才提取共享逻辑，不新增空抽象层。

## 风格与检查

使用仓库内的 Prettier 配置统一格式，ESLint 检查代码与注释，TypeScript 检查类型和未使用变量。所有工具仅用于开发，不进入生产运行时。

```bash
npm ci
npm run format
npm run check
```

`check` 依次执行 lint、格式校验、测试、类型检查与生产构建，任何错误都以非零状态退出。CI 使用同一命令。不要添加默认的提交钩子、重复验证流水线或大型规则包；仓库管理员可把 CI 的 `check` 设为分支合并必需检查。

## 提交信息

统一使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 与 [gitmoji](https://gitmoji.dev/)，格式为 `type(scope): emoji 描述`。`scope` 可省略，emoji 放在冒号后，描述简短说明本次变更。

- 初始化仓库：`chore: 🎉 初始化仓库`
- 新增功能：`feat(studio): ✨ 支持图片标注`
- 修复缺陷：`fix(chat): 🐛 阻止取消后回写图片`
- 清理重构：`refactor: ♻️ 移除未使用组件`
- 更新文档：`docs: 📝 更新本地开发说明`

## 回归与冒烟

测试外部协议、数据保留、错误与取消、历史兼容等真实风险。相同契约只有一处主要覆盖；删除只复述常量、实现步骤或重复路径的断言。不按测试数量删减，也不为简单文案/样式变更新增快照。

影响交互时只走一条相关冒烟路径：打开页面 → 完成改动涉及的操作 → 检查结果和控制台。发布前再走接入模型、生成/停止、Chat、图库、刷新恢复这一条主路径；真实 API 需要自备测试凭证。无需把每次探索过程写成长期测试清单。
