# wkbdy2api

A loopback-only gateway that exposes WorkBuddy AI through OpenAI-compatible and Anthropic-compatible HTTP APIs.

## Requirements

- Node.js 20 or newer
- pnpm

## Development

```bash
pnpm install
pnpm dev
```

Run validation with:

```bash
pnpm typecheck
pnpm test
```

## Supported API routes

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`

The gateway forwards chat requests to WorkBuddy using streaming upstream responses and converts them to the response shape expected by each compatible API.

## Reasoning controls

OpenAI-compatible requests may provide `reasoning_effort` with one of these values:

- `none`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

The value is forwarded to the WorkBuddy request body.

Anthropic-compatible `thinking` settings are converted to `reasoning_effort` as follows:

- `disabled` becomes `none`
- `adaptive` becomes `high`
- enabled budgets below 2,048 tokens become `low`
- enabled budgets from 2,048 tokens become `medium`
- enabled budgets from 8,192 tokens become `high`
- enabled budgets from 32,768 tokens become `xhigh`

## Model metadata

`GET /v1/models` returns OpenAI-shaped model objects. WorkBuddy-specific capabilities are exposed under `x_workbuddy`, including:

- reasoning support and reasoning-only status
- supported reasoning efforts
- default context-window length
- all values from `contextWindow.supportedLengths`
- image and tool-call support
- maximum input and output token limits

模型列表显示 WorkBuddy 配置中的 Credits 价格。上下文窗口按模型保存，账号池内所有账号共用该模型的设置，不会影响其他模型。保存失败会显示错误并恢复原选择；未设置时使用模型支持的最大档位。请求中显式指定的 `context_window` 优先于面板设置。

## Streaming and diagnostics

聊天传输没有网关设置的首字节、流空闲或总时长截止。流式请求在上游接受请求后每 15 秒发送 SSE 注释心跳，不伪造 token、usage 或完成事件。客户端断开时仍立即取消上游连接。上游、客户端或反向代理自身的超时不受本项目控制；等待上游响应头期间仍保留返回真实 HTTP 错误的能力。

上游明确返回 `unapproved channel` 时，网关返回渠道权限错误，不伪造渠道或换账号重试。日志只记录账号标签、凭据来源类型、模型、上游状态/数值错误码、阶段和耗时，不包含令牌、用户 ID、请求正文或原始上游错误正文。该错误需要检查 WorkBuddy 的账号/接入授权，不能通过改变本地 API Key 解决。

本地慢流测试（使用 mock 上游，不消耗真实额度）：

```powershell
$env:WKB2API_LONG_STREAM_TEST = '1'
npm test -- tests/runtime-regressions.test.ts
```

该测试用真实 HTTP 连接同时验证三套接口在持续输出、65 秒无内容、65 秒等待响应头时能够正常完成。常规 `npm test` 默认跳过这一个耗时测试。
