# ChatOps Tracker

ChatOps Tracker converts WhatsApp team messages into structured task operations with a hybrid parser:

- Explicit commands (`!task`, `!done`, `!status`, etc.)
- LLM parsing for natural-language updates

The runtime follows an OpenClaw-inspired architecture: channel adapter, composable context assembly, task manager, scheduler, and dashboard sync.

## Version

Current version: `0.2.0`

## What Changed in 0.2.0

- Added provider-agnostic LLM parsing
- Supports `openai`, `anthropic`, `gemini`, and `openai_compatible`
- Added provider factory + HTTP adapters
- Added parser output normalization to keep intent handling stable across providers

See [CHANGELOG.md](./CHANGELOG.md) for details.

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Configure `.env`

- Set `LLM_PROVIDER`
- Set `LLM_MODEL`
- Add the matching provider API key
- Set `ALLOWED_GROUPS`

3. Run in dev mode

```bash
npm run dev
```

4. Scan WhatsApp QR and send `!help` in your group.

## LLM Provider Configuration

Use one provider per runtime:

- `LLM_PROVIDER=openai`
- `LLM_PROVIDER=anthropic`
- `LLM_PROVIDER=gemini`
- `LLM_PROVIDER=openai_compatible`

For provider-specific env details, see [docs/MODEL_PROVIDERS.md](./docs/MODEL_PROVIDERS.md).

## Notes

- OpenAI-compatible mode is useful for local/self-hosted gateways that implement the OpenAI chat completions API.
- The parser still runs command-first for speed and cost efficiency; LLM parsing is used as fallback.
