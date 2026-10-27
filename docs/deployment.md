# 部署

前端静态资源与 API 代理发布到同一个 Cloudflare Worker，资源与路由配置见 [wrangler.jsonc](../wrangler.jsonc)。

## Cloudflare 仓库自动构建

当前站点由 Cloudflare 连接 GitHub 仓库，跟踪 main 分支。推送或合并到 main 后，由 Cloudflare 构建并部署；不依赖 package.json 版本号或 Git tag。

构建命令、部署命令及触发分支以 Cloudflare 控制台的构建设置为准。发布结果在 Worker 的构建与部署记录中核对提交 SHA、状态和流量分配。

## GitHub Actions

[CI 工作流](../.github/workflows/ci.yml) 独立执行安装、校验、测试和构建。当前站点的 Cloudflare 自动构建不依赖 GitHub Actions 的部署步骤，也不能由 CI 成功或跳过部署推断线上版本。

工作流另保留可选的 Wrangler 部署路径：仅 main 推送或手动运行，且 Actions Secrets 同时提供 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 时执行。缺少时只跳过这一步，不影响 Cloudflare 自身的仓库构建。使用当前部署方式无需配置这两项，以免重复部署。

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
