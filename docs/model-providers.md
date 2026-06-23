# 模型服务商接入说明

## 推荐接入方式

项目的前端只暴露 `base_url` 和 `key`，模型通过“解析模型”自动获取。后端会统一代理请求，避免浏览器直接暴露跨域和协议细节。

当前支持两类常见协议：

- OpenAI Chat Completions：`/chat/completions`
- OpenAI Responses API：`/responses`

用户看到的仍然是对话体验。协议差异由后端适配，不需要用户理解。

## DeepSeek

推荐作为默认可用服务商。

```txt
base_url: https://api.deepseek.com
model: deepseek-chat
protocol: chat
```

设置页操作：

1. 填 `base_url`
2. 填 `key`
3. 点击“解析模型”
4. 选择 `deepseek-chat`
5. 保存并测试

## OpenAI-compatible 服务商

如果服务商文档明确提供 OpenAI-compatible Chat Completions 接口，通常可直接接入。

要求：

```txt
GET  {base_url}/models
POST {base_url}/chat/completions
Authorization: Bearer sk-...
```

如果服务商只支持 Responses API，也可以接入：

```txt
POST {base_url}/responses
```

## AnyRouter 测试结论

当前不建议把 AnyRouter 作为网页项目的推荐服务商。

测试现象：

- `GET https://anyrouter.top/v1/models` 可以返回模型列表，说明 key 可用于模型查询。
- Node.js 后端请求 AnyRouter 时出现 TLS 握手失败或上游空错误。
- `POST /v1/responses`、`POST /v1/chat/completions` 在测试中无法得到可用对话结果。

这说明它当前更偏向 Codex、Claude Code、OpenClaw 等特定客户端转发场景，不等同于可被本项目后端稳定调用的通用 OpenAI-compatible API。

如果后续服务商提供明确支持 Node.js 后端调用的标准 API 地址，可以再接入。

## 最小连通性测试

使用脚本直接发送“你好”：

```powershell
$env:LLM_BASE_URL="https://api.deepseek.com"
$env:LLM_API_KEY="你的key"
$env:LLM_MODEL="deepseek-chat"
$env:LLM_PROTOCOL="chat"
$env:LLM_PROMPT="你好"
node scripts/test-llm.mjs
```

Responses API 示例：

```powershell
$env:LLM_BASE_URL="https://example.com/v1"
$env:LLM_API_KEY="你的key"
$env:LLM_MODEL="gpt-5-codex"
$env:LLM_PROTOCOL="responses"
$env:LLM_PROMPT="你好"
node scripts/test-llm.mjs
```

如果脚本失败，请优先看错误类型：

- `401` / `403`：key、权限、余额或服务商限制问题。
- `404`：接口路径或协议不支持。
- `400`：请求体参数不被该服务商接受。
- TLS handshake failure：服务商网络层或 TLS 策略与 Node.js 后端不兼容。

## 安全注意

- 不要把 key 写入仓库、文档或截图。
- 测试用 key 暴露后应在服务商后台删除或重置。
- 代理接口不得记录 Authorization、请求正文或响应正文。
