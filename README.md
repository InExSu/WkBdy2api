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

## Security

The service is intended for local loopback use. Configure downstream authentication and credential storage before exposing it to clients. Do not publish the service directly to an untrusted network.
