# LegendaryAI Hugging Face Local Model Foundation — Design Spec

## Goal

Prepare LegendaryAI for a real **Hugging Face Space-hosted local model** so that when the Space is available, the model can be enabled with configuration rather than a frontend/backend rewrite, while leaving the current model backend untouched for now.

## Scope

This upgrade is infrastructure-only. It does **not** deploy, replace, or modify the actual Hugging Face model/Space.

### In scope

- A provider/adapter contract for Hugging Face Space inference.
- A model registry contract that describes context, output, streaming, vision, JSON, tools, and health state.
- Capability negotiation between plan and model.
- Context preparation and token-budget interfaces.
- Standardized model errors and request tracing metadata.
- Streaming-ready request/response contracts.
- Health/readiness lifecycle for the Hugging Face Space.
- Explicit route metadata so Native Core is never presented as the Hugging Face model.
- Multimodal-ready message normalization without enabling unsupported modalities.
- Bounded agent/tool interfaces ready for a future real model.
- Tests and documentation for the launch path.

### Out of scope

- Deploying or changing the Hugging Face Space.
- Downloading model weights.
- Replacing the current local backend.
- Pretending LegendaryLite-1 is already a neural model.
- Enabling Vision/tools/streaming unless the configured Hugging Face backend actually supports them.
- Adding paid external AI providers.

## Current Constraint

The current Edge Function may use a local-compatible backend when configured. The new foundation must be additive and must not change the behavior of the current backend unless a future Hugging Face adapter is explicitly configured.

## Target Architecture

```
Browser
  -> Legendary Engine
  -> Request Normalizer
  -> Model Registry
  -> Capability Negotiator
  -> Context Engine
  -> Provider Adapter
       -> Hugging Face Space adapter (future)
       -> existing local adapter (unchanged)
       -> Native Core (explicit fallback)
```

The browser never calls the Hugging Face Space directly. The Space URL and any private credentials remain server-side configuration.

## Provider Contract

Introduce a stable internal adapter contract with:

- `health()`
- `chat()`
- `stream()`
- `countTokens()`
- `capabilities()`
- `metadata()`
- `abort()`

The Hugging Face adapter must accept a configurable Space endpoint and model identifier/endpoint name. The transport implementation must be isolated so that changing a Space framework (for example Gradio or an OpenAI-compatible gateway) does not require changes to routing, plans, context, or frontend code.

## Model Registry

Extend model metadata to represent:

- key
- display name
- provider
- model_id
- endpoint/base URL reference
- context_window
- max_output_tokens
- modalities
- supported_tools
- reasoning level
- supports_streaming
- supports_vision
- supports_tools
- supports_json
- supports_system_prompt
- health status
- last health check
- latency
- failure count
- enabled
- priority

`enabled` and `healthy` are separate concepts.

## Capability Negotiation

Effective capability is the intersection of:

1. account/plan capability,
2. model capability,
3. request capability.

The system must reject unsupported requests explicitly instead of silently pretending a capability exists.

## Context Engine

Build a deterministic context pipeline:

1. system instructions
2. relevant memories when enabled
3. recent conversation
4. relevance-selected older messages
5. current user request
6. multimodal parts that the selected model supports

The engine must expose the estimated token budget and the reason content was omitted/truncated.

## Token Counting

Keep the current approximation as a safe fallback, but expose a tokenizer interface so a Hugging Face model-specific tokenizer can be plugged in later without changing quota logic.

## Streaming

Define a streaming contract now, even if the current backend remains non-streaming. Events should distinguish:

- start
- delta
- tool_call
- tool_result
- metadata
- done
- error

The frontend may continue consuming the existing final-response contract until streaming is explicitly enabled.

## Health Lifecycle

Use:

`UNKNOWN -> CHECKING -> READY -> DEGRADED -> OFFLINE`

A model can remain enabled while unhealthy. Routing must check readiness before attempting inference.

Health checks should capture:

- endpoint reachability
- model/Space readiness
- response latency
- protocol compatibility
- minimal smoke generation

## Standard Errors

Use stable codes:

- `MODEL_UNAVAILABLE`
- `MODEL_TIMEOUT`
- `MODEL_OVERLOADED`
- `MODEL_CONTEXT_EXCEEDED`
- `MODEL_INVALID_RESPONSE`
- `MODEL_AUTH_FAILED`
- `MODEL_CAPABILITY_UNSUPPORTED`
- `TOKEN_LIMIT`

The frontend receives safe user-facing messages; internal diagnostics stay server-side.

## Route Truthfulness

Every model response must carry internal metadata equivalent to:

- `route: "huggingface-local" | "local-ai" | "native-core"`
- `local: boolean`
- `fallbackUsed: boolean`
- `modelKey`
- `provider`
- `requestId`

Native Core must never be reported as the selected Hugging Face model.

## Request Tracing

Generate a request ID and record, where appropriate:

- request_id
- user/plan
- model/provider
- intent
- route
- latency
- estimated input/output tokens
- cache hit
- fallback
- error code

Do not log secrets or full private prompts unnecessarily.

## Multimodal Contract

Normalize message content into parts:

- text
- image
- file
- audio

Unsupported parts must produce a capability error rather than being silently discarded or represented as if the model saw them.

## Tools and Agent Loop

Define a server-side tool registry and bounded execution contract for future model tool-calling.

Every agent request must have explicit limits for:

- maximum steps
- maximum tool calls
- maximum wall-clock time
- maximum output tokens

Native tools remain deterministic and server-controlled. The model must not be trusted to bypass these limits.

## Hugging Face Launch Checklist

Before enabling a real Hugging Face model:

- Space URL/endpoint configured server-side.
- Authentication configured server-side if private.
- Health endpoint/protocol verified.
- Model loaded and ready.
- Exact model/endpoint ID verified.
- Context window known.
- Maximum output known.
- Streaming support verified.
- JSON support verified.
- Tool calling support verified.
- Vision/audio support verified before enabling.
- Latency smoke test recorded.
- Token accounting tested.
- Plan capability mapping tested.
- Failure and timeout behavior tested.
- Fallback metadata verified.
- End-to-end chat smoke test passed.

## Success Criteria

When a real Hugging Face Space becomes available, launching it should require configuration/registry changes and deployment of the adapter, not a rewrite of the chat UI, plan system, context handling, token accounting, or core routing.

The current backend must continue to work unchanged while this foundation is being prepared.
