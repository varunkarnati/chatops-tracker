# Changelog

## 0.2.0 - 2026-04-26

- Added provider-agnostic LLM parsing architecture.
- Added provider factory with support for:
  - `openai`
  - `anthropic`
  - `gemini`
  - `openai_compatible`
- Replaced OpenAI SDK-only parsing path with HTTP provider adapters.
- Added parser output normalization for:
  - intent allowlist enforcement
  - status/priority validation
  - confidence clamping
  - robust JSON extraction from mixed model outputs
- Added new configuration surface in `.env`:
  - `LLM_PROVIDER`
  - `LLM_BASE_URL`
  - `LLM_API_KEY`
  - `GEMINI_API_KEY`
- Kept command-first parsing flow unchanged; LLM remains fallback after command parsing.
- Bumped package version from `0.1.0` to `0.2.0`.
