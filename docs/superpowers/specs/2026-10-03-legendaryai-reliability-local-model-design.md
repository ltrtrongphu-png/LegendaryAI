# LegendaryAI Reliability + Local Model Design

## Goal

Stabilize the existing LegendaryAI chat/product before connecting a real local inference backend. The system must prevent accidental image routing, avoid oversized requests and destructive cloud sync, isolate local data by account, expose user-safe errors, align advertised capabilities with implemented capabilities, and provide a clean contract for a future local model gateway.

## Scope

### Phase 1 — Chat request path
- Remove the capture-phase image routing hotfix from `js/main.js`.
- Keep one canonical image-intent classifier in `js/chat.js` with token boundaries and explicit image-language terms.
- Do not classify code words such as `smart`, `particles`, `start`, `hình thành`, or `hình thức` as image intent.
- Add a request-context builder that sends a bounded recent message window instead of the entire conversation.
- Exclude historical base64 image payloads from normal text-chat requests.
- Enforce a client-side serialized payload budget below the Edge Function limit.
- Replace raw HTTP/JSON errors with stable user-facing error codes/messages.
- Move model generation defaults out of the hard-coded call site into one configuration path while preserving safe server-side limits.

### Phase 2 — Cloud synchronization and data isolation
- Replace delete-and-reinsert message synchronization with incremental upsert/delete operations.
- Add optimistic concurrency using `updated_at` and a monotonically increasing conversation/message version where appropriate.
- Do not rewrite `updated_at` during no-op syncs.
- Debounce change-triggered sync and remove the unconditional full-upload 15-second loop.
- Namespace localStorage by authenticated `user.id`; keep guest state separate.
- On sign-out, flush pending work when possible and clear the authenticated user's local conversation/draft cache so another account cannot inherit it.
- Generate new conversation/message/attachment IDs with `crypto.randomUUID()` while retaining compatibility with legacy IDs.

### Phase 3 — Attachments, privacy, and product truth
- Store image/file payloads in Supabase Storage and keep metadata/object paths in message JSON rather than large base64 blobs.
- Add safe deletion flows for conversations, attachments, memories, and account data where supported by existing schema.
- Add Privacy Policy, Terms, and Contact pages/sections with real destinations instead of `#top` placeholders.
- Ensure public copy and structured data only advertise capabilities that have an implemented backend path.
- Disable or clearly mark paid image generation if no zero-cost provider is configured.
- Add `robots.txt`, `sitemap.xml`, and a valid `og-image.png`.
- Improve basic accessibility labels and status announcements around chat/send/error states.

### Phase 4 — Local model gateway
- Keep `ai-chat-v10` as the public authenticated application boundary.
- Add a private model gateway contract behind it, preferably OpenAI-compatible `/v1/chat/completions` semantics.
- Support a local provider such as Ollama or llama.cpp without exposing gateway credentials to the browser.
- Configure model IDs only after an actual local model is available; do not enable placeholder `CHANGE_ME` models.
- Keep plan/model selection in Supabase and have the Edge Function resolve the enabled model/provider server-side.
- Add health checks and explicit `MODEL_UNAVAILABLE`/`MODEL_TIMEOUT` errors.
- Do not claim `Local` in the UI unless the response provider actually identifies as local.

## Data flow

```text
Browser chat
  -> canonical intent/request builder
  -> authenticated ai-chat-v10
  -> plan/model resolution
  -> local model gateway
  -> Ollama/llama.cpp or another configured local inference server
  -> normalized response + usage/provider metadata
  -> browser

Conversation changes
  -> local per-user cache
  -> incremental sync
  -> Supabase conversations/messages

Attachments
  -> Supabase Storage
  -> message attachment metadata
```

## Error contract

The Edge Function should return a stable shape such as:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Bạn đã đạt giới hạn sử dụng. Vui lòng thử lại sau."
  }
}
```

Known codes should include at least `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `AUTH_REQUIRED`, `MODEL_UNAVAILABLE`, `MODEL_TIMEOUT`, `INVALID_REQUEST`, and `INTERNAL_ERROR`. Technical details remain server-side logs.

## Sync rules

- A successful local write must not depend on a cloud write succeeding.
- A failed cloud write must leave the local state intact and retry only the changed records.
- Cloud-to-local loading must not blindly overwrite newer local changes.
- A conversation's activity timestamp changes only when its content actually changes.
- Deletes must be explicit and scoped to the authenticated user's records.

## Security constraints

- Browser uses only Supabase anon key plus the user's access token.
- Service-role keys and local-model gateway secrets remain server-side.
- Existing RLS protections remain mandatory for conversations/messages/storage metadata.
- Storage object paths must include user identity and be protected by Storage RLS/policies.
- User data must never be selected solely by client-supplied conversation IDs without ownership enforcement.

## Verification

Before declaring the work complete:

1. Static checks for duplicate image classifiers and raw error exposure.
2. Automated tests for image intent false positives/positives.
3. Payload-size tests with long chats, files, and images.
4. Sync tests for create/update/delete, retry, concurrent device edits, and logout/login account isolation.
5. Storage attachment upload/read/delete tests with RLS.
6. Edge Function tests for normalized errors and model-unavailable behavior.
7. Supabase checks for RLS, migrations, Edge Function deployment, and Storage policies.
8. End-to-end test using a real configured local model before enabling the Local label or marketing copy.

## Non-goals

- Do not silently invent or enable a local model that is not actually installed/configured.
- Do not preserve the current delete-and-reinsert sync merely for implementation convenience.
- Do not add another frontend image-routing hotfix.
- Do not expose provider/API secrets to the browser.
