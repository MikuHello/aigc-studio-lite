# AIGC Studio Lite

![AIGC Studio Lite 工作台](docs/preview.png)

本地优先的轻量 AI 图像工作台。接入 OpenAI、Google 或 xAI，在同一会话中生成图像、与 Agent 对话、管理参考图和提示词预设。

## 开始使用

推荐 Node.js 24（仓库 `.nvmrc`）。

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`，进入设置，填写 API 地址与 Key。可以发现服务商模型，也可以手动添加模型 ID 和能力；兼容接口可使用自定义地址。

- 左侧管理会话、置顶、重命名及预设；会话栏可收起和调整宽度。
- 中间输入提示词、添加参考图并生成；只展示当前模型支持的参数。
- 右侧 Chat 与生图共用会话，Agent 可调用生图工具；窄屏使用面板布局。
- 图库支持全部/当前会话筛选、提示词搜索、批量选择和删除；灯箱提供下载、提示词与标注。
- 提示词可手动润色并对比采用；规则、模型与参考图使用范围在润色设置中管理。
- 生图与 Chat 草稿分别保留；删除会话保留图库图像，删除图像则移除对应消息和参考图引用。

## 网络方式

| 方式        | 行为                                                        |
| ----------- | ----------------------------------------------------------- |
| 自动        | 同源 Worker 代理可用时使用代理，否则直连                    |
| 直连        | 浏览器直接请求所填 API 地址，受该服务商 CORS 策略影响       |
| Worker 代理 | 经同源 `/api/proxy` 转发，仅允许四家服务商的官方 HTTPS 主机 |

自定义网关应使用直连；内置代理不会替任意自定义域名转发。OpenAI 兼容文本接口支持自动选择 Chat Completions / Responses；认证、限流和服务端失败不会触发盲目重试。

## 本地数据

会话、图库、预设和设置存储于 IndexedDB，草稿额外写入 localStorage 以减少刷新丢失。API Key 与元数据分开保存：当前设置页将连接的 Key 保存在本机 localStorage。Worker 只随请求转发 Key，不持久化。Markdown 渲染使用 DOMPurify 清理。

Anthropic 适配器仍保留于代码层，但当前设置页没有新增接入入口。

数据与站点域名绑定；清理浏览器站点数据会删除本地内容。项目不包含账号、跨设备同步或完整备份导出。模型能力来自模型 ID 推断或人工配置，实际支持范围以服务商为准。

## 开发

[开发规范](CONTRIBUTING.md) 约定注释白名单、字段语义、模块职责和回归取舍；[整理记录与上线准备](docs/maintenance.md) 记录本次整改、待办和部署条件。

| 命令                   | 用途                                    |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | 本地前端开发                            |
| `npm run lint`         | 代码规则与注释检查                      |
| `npm run format`       | 统一代码、样式与文档格式                |
| `npm run format:check` | 格式不一致时直接失败                    |
| `npm run typecheck`    | 前端与 Worker 类型检查                  |
| `npm test`             | 契约与风险回归                          |
| `npm run check`        | lint、格式、测试、类型检查与构建        |
| `npm run build`        | 类型检查后生成 `dist/`                  |
| `npm run preview`      | 预览生产前端                            |
| `npm run dev:worker`   | 构建并启动本地 Worker 与静态资源        |
| `npm run deploy`       | 构建并发布 Cloudflare Worker 与静态资源 |

领域类型在 `src/types.ts`，服务商契约在 `src/providers/types.ts`。新增服务商需实现适配器、注册模型能力，并按实际部署需求更新 Worker 的域名白名单；Agent 无需了解各家协议。

## 部署

纯静态托管只需发布 `npm run build` 生成的 `dist/`，请求使用浏览器直连。同仓 `wrangler.jsonc` 已配置 Workers Static Assets，可同时部署页面与同源代理：

```bash
npm run dev:worker
npm run deploy
```

部署前登录 Cloudflare 并确定 Worker 名称。已配置 GitHub CI 统一校验，尚未在 GitHub 运行；自动发布尚未启用。后续 GitHub Actions 可在检查通过后运行 Wrangler，凭证与触发方式见[上线准备](docs/maintenance.md#github-与-cloudflare-上线准备)。
