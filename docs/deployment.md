# 部署

前端静态资源与 API 代理发布到同一个 Cloudflare Worker。配置以 [wrangler.jsonc](../wrangler.jsonc) 和 [CI 工作流](../.github/workflows/ci.yml) 为准。

## GitHub 自动部署

在仓库 Actions Secrets 配置：

| 名称                    | 用途                        |
| ----------------------- | --------------------------- |
| `CLOUDFLARE_API_TOKEN`  | 目标账号的 Workers 部署权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare 账号        |

工作流执行 `npm ci` 和 `npm run check`。仅 main 分支推送或手动运行在校验通过且 Secrets 齐备时部署，复用当次构建结果；PR 只校验。缺少 Secrets 会跳过部署，是否发布以部署步骤结果为准。

## 本地预览与发布

```bash
npm run dev:worker
```

手动发布：

```bash
npx wrangler login
npm run deploy
```

更新已有站点需使用对应账号和 Worker 名称。令牌不写入源码或前端环境变量。

## 运行边界

- `/api/*` 先经过 Worker，其他静态资源直接提供并支持 SPA 回退。
- 静态响应头在 [public/_headers](../public/_headers)，API 响应头在 [worker/index.ts](../worker/index.ts)。
- 发布后验证页面路由、代理、生成与取消、作品读取和刷新恢复；模拟接口不能替代真实服务联调。
- 浏览器数据按站点隔离，更换域名需另行处理迁移，发布本身不会迁移本地数据。
