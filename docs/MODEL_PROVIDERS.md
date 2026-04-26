# Model Provider Configuration

ChatOps Tracker is model-agnostic at the parser layer and currently supports:

- OpenAI
- Anthropic
- Gemini
- OpenAI-compatible APIs

## Common Environment Variables

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=
```

- `LLM_PROVIDER`: `openai | anthropic | gemini | openai_compatible`
- `LLM_MODEL`: model id for selected provider
- `LLM_BASE_URL`: optional custom base URL override

## Provider-Specific Keys

### OpenAI

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
# optional:
# LLM_BASE_URL=https://api.openai.com/v1
```

Defaults:

- Base URL: `https://api.openai.com/v1`

### Anthropic

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-3-5-sonnet-latest
# optional:
# LLM_BASE_URL=https://api.anthropic.com/v1
```

Defaults:

- Base URL: `https://api.anthropic.com/v1`

### Gemini

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
LLM_MODEL=gemini-2.0-flash
# optional:
# LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

Defaults:

- Base URL: `https://generativelanguage.googleapis.com/v1beta`

### OpenAI-Compatible

```env
LLM_PROVIDER=openai_compatible
LLM_API_KEY=...
LLM_MODEL=your-model-name
LLM_BASE_URL=http://localhost:8000/v1
```

Behavior:

- Uses the OpenAI Chat Completions wire format.
- Requires a base URL that exposes `/chat/completions` with OpenAI-compatible request/response schema.

## Fallback Behavior

If provider config is invalid or provider calls fail, parser gracefully falls back to:

```json
{ "intent": "GENERAL_CHAT", "confidence": 0 }
```

This protects task state from malformed LLM outputs.
