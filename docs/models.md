# 模型维护

模型规格写 JSON，模型 ID 映射独立维护，请求转换留在供应商适配器。模型数值、字段定义与默认值以源码为准。

## 配置位置

相对于 [src/providers](../src/providers)：

```text
model-configs/
├── image-models/<provider>/<model>.json
├── video-models/<provider>/<model>.json
├── model-mappings/<provider>.json
└── schemas/
model-config.ts       配置加载与能力转换
model-matching.ts     模型名称匹配与兼容回退
<provider>.ts         请求与响应适配
```

`configId` 对应 `<provider>/<model>` 的配置路径；映射中的 `modelId` 是实际请求 ID。`selectable` 控制手动规格选项，不代表启用模型或拥有调用权限。

## 修改范式

| 需求                                 | 修改位置                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 调整已有比例、分辨率、数量或时长范围 | 对应模型 JSON                                                                                                |
| 新增模型，复用现有协议与字段         | 新建模型 JSON，并添加供应商映射                                                                              |
| 增加同能力别名或 Endpoint ID         | 映射指向已有配置；用户自定义端点也可在设置中绑定规格                                                         |
| 引入全新参数                         | 类型、Schema、配置转换及相关适配器；需要操作入口时同步界面                                                   |
| 修改鉴权、接口或响应解析             | 对应供应商适配器                                                                                             |
| 修改应用默认值或素材限制             | [creation-defaults.ts](../src/lib/creation-defaults.ts)、[referencePolicy.ts](../src/lib/referencePolicy.ts) |

例如调整 Gemini Flash Lite 图片规格，修改 [gemini-3.1-flash-lite-image.json](../src/providers/model-configs/image-models/google/gemini-3.1-flash-lite-image.json)；新增其别名，只修改 [google.json](../src/providers/model-configs/model-mappings/google.json)。新文件自动加载，无需手写导入；新模型沿用现有字段时无需修改 Schema。模型发现若无法识别新类型，还需补充适配器或匹配规则。

修改后运行 `npm run validate:models` 检查配置与引用，再按[开发规范](../CONTRIBUTING.md)验证行为。扩展能力须先核对官方协议和实际实现，不能仅添加配置开关。

## 接入边界

| 接入方式      | 项目职责                                                    |
| ------------- | ----------------------------------------------------------- |
| OpenAI 兼容   | Chat Completions / Responses 与图片接口；同协议服务复用接入 |
| Google Gemini | 原生 generateContent 与图片配置                             |
| xAI           | 保留独立图片参数与结果适配；未实现图片编辑和视频入口        |
| 火山方舟      | 文本、Seedream JSON 图片输入与 Seedance 异步视频任务        |

Anthropic 适配器仅保留在代码层，设置页没有新增入口。未知模型或 Endpoint ID 不推定完整能力；手动声明不代表服务端验证。应用可以限制为上游能力的子集。官方模型的退役判断不直接套用于兼容网关。

Seedance 2.5 的全能参考使用自动任务分类；带参考视频时，添加阶段即校验每段 4–30 秒，提交前要求自动比例和自动时长，以兼容编辑与延长约束。说明、素材时长输入与校验共用 referencePolicy 中的有效限制。纯图片或音频参考保留常规参数。

协议回归入口为 [provider-contracts.test.ts](../tests/provider-contracts.test.ts) 与 [video-provider.test.ts](../tests/video-provider.test.ts)，配置校验入口为 [check-model-configs.mjs](../scripts/check-model-configs.mjs)。

核对上游时使用官方资料：[OpenAI Images](https://developers.openai.com/api/reference/resources/images/methods/generate)、[Gemini 图片](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)、[xAI 图片](https://docs.x.ai/developers/model-capabilities/images/generation)、[Seedream](https://docs.volcengine.com/docs/ark/seedream-4-0-5-0?lang=zh)、[Seedance](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh)。
