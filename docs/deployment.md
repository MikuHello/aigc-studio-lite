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

## 代理凭据与日志

Cloudflare 的默认请求事件脱敏规则会将 `Authorization`、`x-api-key`、`x-goog-api-key` 等认证头的值替换为 `REDACTED`。这是平台对请求事件的处理，不会修改发往上游的认证头，规则来源见 [TailRequest 文档](https://developers.cloudflare.com/workers/runtime-apis/handlers/tail/#tailrequest)。

开启代理后，API Key 以认证头形式经过 Worker，用于向供应商鉴权；Worker 运行时仍能读取 Key。当前[代理代码](../worker/index.ts)不将 Key 写入存储，也不输出请求头、请求体或 Key 日志；Key 不写入部署配置或构建产物。浏览器本地凭据保存方式见[数据边界](architecture.md#数据边界)。

[仓库配置](../wrangler.jsonc)开启了调用日志，因此不能表述为「Worker 不保存数据」或「后台没有记录」。默认认证头脱敏不覆盖主动输出的原始请求、响应或异常，也不能保证额外日志渠道的处理方式。新增日志只能记录必要的状态码、耗时和不含凭据的请求编号，不得输出 Key、原始头、请求体、响应体或含凭据的 URL；不得通过 `getUnredacted()` 绕过请求事件脱敏。

部署者变更日志采集、导出或代理代码后，需用唯一的假 Key 标记验证日志及导出内容，不能只根据源码判断线上日志是否保留了明文 Key。默认脱敏只降低日志留存风险，不构成 Worker 无法读取 Key 的技术保证。

## 代理允许目标

自定义网关使用 Worker 代理前，部署者需在 [wrangler.jsonc](../wrangler.jsonc) 的 `vars.PROXY_ALLOWED_BASE_URLS` 数组中加入可信 API 基础地址，再发布配置。例如：

```json
{
  "PROXY_ALLOWED_BASE_URLS": ["https://gateway.example/v1", "https://video.example/api/v3"]
}
```

配置是额外允许范围，内置官方目标以[目标校验源码](../src/lib/proxy.ts)为准。每项按规范化后的完整来源及路径边界匹配：`/v1` 允许其本身和下级路径，不匹配 `/v10`、其他子域或端口；没有通配符。填写根地址会放行该来源的全部路径，应优先限定实际 API 路径。Wrangler 以仓库配置为准，控制台临时修改可能被下次发布覆盖。

代理仅支持标准端口的 HTTPS 公共域名，拒绝 URL 凭据、片段、IP 字面量、本地域名及含歧义编码的路径。上游重定向不会跟随；请直接填写最终 API 地址。取消请求限定为允许目标下的视频任务取消路径，方法与转发头以 [Worker 实现](../worker/index.ts)为准。

仅加入可信、由部署者确认解析到公网的域名；应用不执行 DNS 地址解析审计，域名放行不能防止其后续变更解析。Worker 不向其他站点开放 CORS，并拒绝带异站 Origin 或跨站来源标记的请求；这些来源检查不是用户鉴权，非浏览器客户端仍可调用已放行目标。公开实例不应放行不可信域名或开放任意目标。

本地 `npm run dev` 仅提供前端；验证代理需使用 `npm run dev:worker`。未放行目标、缺少代理接口或上游不可达都会报错，不回退直连。放行不保证网关可达，仍受上游鉴权、网络与 Cloudflare 平台条件限制。

## 运行边界

- `/api/*` 先经过 Worker，其他静态资源直接提供并支持 SPA 回退。
- 静态响应头在 [public/_headers](../public/_headers)，API 响应头在 [worker/index.ts](../worker/index.ts)。
- 发布后验证页面路由、代理、生成与取消、作品读取和刷新恢复；模拟接口不能替代真实服务联调。
- 浏览器数据按站点隔离，更换域名需另行处理迁移，发布本身不会迁移本地数据。
