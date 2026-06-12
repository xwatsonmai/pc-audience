# PC Audience

AI screen behavior observer with live danmaku-style audience comments.

[中文文档](./README.zh-CN.md)

## What It Does

- Captures periodic screen frames locally through Electron.
- Builds a short contact sheet for a vision model to summarize current activity.
- Stores structured behavior summaries and behavior segments, not screenshots.
- Generates live danmaku comments through an OpenAI-compatible or Ollama text model.
- Shows comments in a transparent always-on-top overlay.

## Privacy Defaults

- Screenshots and contact sheets stay in memory only.
- The local database stores summaries, behavior segments, rollups, diagnostics, and generated comments.
- Sensitive apps can be configured to skip observation.
- Overlay capture hiding is supported to avoid the app seeing its own comments.

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

## Model Providers

The app supports separate provider routing for:

- vision analysis
- danmaku generation

Each route can use either an OpenAI-compatible endpoint or Ollama.
