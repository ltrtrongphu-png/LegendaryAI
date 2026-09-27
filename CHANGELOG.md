# LegendaryAI Changelog

## 1.1.1
- Added **Adaptive Intelligence Layer**.
- Compacts long conversations to a bounded, recent context window before inference.
- Adds short-lived, user-scoped response caching to reduce duplicate compute.
- Adds request IDs and latency/performance telemetry in the AI response.
- Reports raw vs compacted context size and cache hits for observability.
- Keeps existing Legendary Shield 1.1.0 protection.
- No external AI API key is required for the Native Core path.

## 1.1.0
- Legendary Brain 9.0 structured reasoning.
- Legendary Shield 1.1.0 application-layer abuse/rate protection.
- Versioning baseline and changelog.

### Versioning policy
- Patch: 1.1.0 -> 1.1.1 for fixes/optimizations.
- Minor: 1.1.x -> 1.2.0 for substantial new features.
- Major: 1.x.x -> 2.0.0 for breaking changes.
