# Privacy Policy

_Last updated: 2026-10-03_

LegendaryAI stores account and application data needed to provide authentication, conversation history, usage limits, payments, and security controls.

## Data stored
- Account identity information supplied by the authentication provider.
- Conversations and messages created by the account.
- AI usage records required for quotas, abuse prevention, and operational auditing.
- Files uploaded through chat, when the attachment feature is enabled.

## How data is used
Data is used to provide the service, enforce account limits, synchronize conversation history, prevent abuse, troubleshoot failures, and process requested payments.

## Access and isolation
Authenticated database and storage access is scoped to the authenticated user's identifier. Conversation synchronization uses an authenticated RPC with an ownership check and optimistic concurrency protection.

## Retention and deletion
Users should be able to request deletion of their account and associated application data. Operational backups may retain data for a limited period according to the hosting provider's backup lifecycle.

## Third parties
LegendaryAI may use Supabase for authentication, database, storage, and serverless functions, and payment providers when a user explicitly initiates a payment. Any external AI provider used by a production configuration should be disclosed before enabling it.

## Security
No web application can guarantee absolute security. LegendaryAI uses row-level security, authenticated storage access, server-side secrets, and security headers as defense-in-depth measures.

## Contact
For privacy requests, use the contact method published by the site operator.
