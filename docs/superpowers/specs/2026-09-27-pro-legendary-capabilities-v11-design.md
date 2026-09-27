# Pro & Legendary Capability Architecture v11

## Goal

Make LegendaryAI's paid tiers materially more capable without relying on client-side plan claims. Pro should feel like a strong daily power-user workspace; Legendary should add agentic, long-context, multimodal, and workflow capabilities. Free remains useful but is deliberately smaller.

## Agreed tier envelope

| Tier | Token window | Reset | Reasoning | Primary model |
| --- | ---: | --- | --- | --- |
| Guest | 1,000 | session | off | Guest Core |
| Free | 500,000 | 6h | basic | LegendaryLite-1 |
| Pro | 2,000,000 | 12h | deep | LegendaryPro-1 |
| Legendary | 6,000,000 | 18h | deep+ | LegendaryUltra-1 |

Owner accounts retain owner controls and are not used as the authorization source for normal customer tiers.

## Capability model

Capabilities are represented as a server-owned policy derived from `profiles.plan` (and owner role only for administration). The browser may render/disable controls, but the Edge Function is authoritative.

### Free

- Chat and everyday writing
- Basic code generation/debugging
- Session context
- Arithmetic and deterministic native tools
- Basic formatting
- 500k token window

### Pro

Everything in Free plus:

- Deep Reasoning button
- Larger context selection and reasoning budget
- Project workspace primitives
- File and image analysis when configured
- Memory read/write
- Code review, refactor and test-generation workflows
- Prompt Studio / reusable prompt presets
- Advanced export
- Priority model routing
- Context optimizer

### Legendary

Everything in Pro plus:

- Deep Reasoning+
- Agent mode with plan → execute → verify loop
- Multi-model routing
- Advanced multimodal analysis
- Project Brain: project instructions + memory + selected files + conversation context
- Long-context synthesis
- Batch task orchestration
- Expert modes for coding, research, math, writing and debugging
- Self-check pass before final response
- Highest priority routing and resource budget
- Custom workflow controls

## Reasoning control

Add a `reasoning` request mode with three states: `off`, `deep`, and `deep_plus`. The client exposes one `Suy luận` toggle/button and maps the effective level from the account tier:

- Free/Guest: `off` (button disabled or upgrade affordance)
- Pro: `deep`
- Legendary: `deep_plus`

The backend ignores a client-requested level above the account's entitlement.

Reasoning affects model routing, output budget, context selection, and native self-check behavior. It must not silently change token accounting: all input/output/reasoning budget reservations are charged through the same server-side token reservation path.

## Agent/workflow control

Agent mode is available to Legendary only. It is implemented as a bounded orchestration loop rather than arbitrary code execution:

1. classify task;
2. create a short plan;
3. execute supported native capabilities (reasoning, file/context analysis, deterministic tools);
4. run self-check;
5. return the final answer plus a compact execution summary.

The first release does not grant arbitrary shell/browser access from the AI model.

## Data model

Extend `profiles` with server-controlled entitlement fields needed by the engine, while keeping `plan` as the source of truth. Prefer a JSONB capability policy only for derived configuration; do not use user-editable metadata for authorization.

Add a small `ai_entitlements`/policy representation only if the existing profile columns cannot express the required server policy cleanly. Avoid duplicating billing state.

Extend `ai_usage_logs` with reasoning/feature metadata needed for observability (reasoning level, capability set, route, and workflow/agent marker) without storing prompt content.

## Guest-to-account continuity

Guest use is limited to 1,000 tokens and local conversation state. On successful sign-in/sign-up, guest conversations are merged into the authenticated account using the existing cloud-sync path. The merge must be idempotent and must never overwrite an existing account conversation with the same ID.

Guest requests must not call privileged Supabase RPCs as an unauthenticated user. The authenticated Edge Function path remains the authoritative token-debit path for account usage.

## Model routing

`modelFor(plan)` remains the default selector, but the effective model may be upgraded by reasoning/feature requirements only when that model is enabled and its tier is allowed for the account.

Requested model keys are validated server-side against `ai_models.tier`. A Pro account can never select Legendary-tier models by crafting the request payload.

## Error handling

- Unsupported capability → structured `CAPABILITY_FORBIDDEN` with an upgrade hint.
- Reasoning entitlement mismatch → downgrade to the maximum allowed level rather than trusting the request.
- Agent step/token exhaustion → stop safely and return a partial execution summary.
- Model unavailable → fall back to an allowed native/local model; never cross the plan boundary.
- Token reservation failure → no model call is made.
- Any post-reservation error → refund the reservation through the authenticated user path.

## UI changes

- Add a visible `Suy luận` control beside the composer.
- Show the effective tier/reasoning state, not merely the requested state.
- Pro/Legendary capability surfaces should be progressive: unavailable controls remain visible with a clear tier label instead of pretending the feature exists.
- Add an Agent control only for Legendary.
- Keep the existing chat layout and visual language.

## Testing strategy

### Unit / static tests

- tier policy matrix
- model authorization matrix
- reasoning entitlement matrix
- token limits and reset windows
- requested-model rejection for lower tiers
- agent capability rejection for non-Legendary

### Integration tests

- Edge Function accepts valid Free/Pro/Legendary requests
- reasoning mode is clamped by tier
- reservation/refund path preserves token accounting
- guest requests are limited to 1k locally
- guest history survives sign-in and merges to account storage

### Production verification

- deploy Edge Function/schema/frontend
- verify Vercel production deployment is Ready
- send one authenticated smoke request per tier where test accounts are available
- verify Supabase logs contain no RPC ambiguity or permission errors

## Non-goals for this release

- arbitrary remote shell execution
- arbitrary browser automation from the model
- paid provider API requirements for core chat
- changing billing prices
- replacing the existing visual identity
