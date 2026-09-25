import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const MODEL_BY_PLAN: Record<string, string> = {
  free: "legendary-lite-1",
  pro: "legendary-pro-1",
  legendary: "legendary-ultra-1",
};

const SYSTEM_DEFAULT = `You are LegendaryAI, a high-reliability general AI assistant.

Operating principles:
- Understand intent before answering.
- Reason carefully; do not invent facts, APIs, benchmarks, or completed actions.
- For software tasks, produce maintainable, secure, production-oriented code.
- Preserve relevant conversation context and avoid unnecessary repetition.
- Distinguish verified facts, assumptions, and uncertainty.
- Be concise by default but expand when the task requires depth.
- Use tools and external data only when actually available to the backend.
- Refuse unsafe requests and provide safe alternatives.`;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...headers },
  });
}
