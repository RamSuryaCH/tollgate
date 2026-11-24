# Tollgate

Tollgate is a self-hosted, OpenAI-style chat gateway for a local Ollama model (or an optional OpenAI-compatible endpoint). It adds per-key token-bucket rate limiting, exact-match Redis caching for deterministic requests, and Postgres persistence for API keys, conversations, request logs, and daily usage rollups. It runs without paid services, and tests use a deterministic mock provider so no model is needed. The frontend is not built yet.
