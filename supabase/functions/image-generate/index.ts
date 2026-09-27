import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const imageBuckets = new Map<string, { started:number; count:number }>();
const IMAGE_WINDOW_MS = 60_000;
const IMAGE_MAX_REQUESTS = 3;
const IMAGE_MAX_PROMPT_CHARS = 8000;
const IMAGE_BUCKET_MAX = 2000;

const CORS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Credentials": "true",
  "Vary": "Origin",
};

function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...CORS,
    "Access-Control-Allow-Origin": ORIGINS.has(origin)
      ? origin
      : "https://legendaryai.vercel.app",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers(req),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: headers(req) });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const auth = req.headers.get("Authorization");
  if (!auth) {
    return json(req, { error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json(req, {
      error: "Server configuration missing",
      code: "SERVER_CONFIG",
    }, 503);
  }

  if (!openaiKey) {
    return json(req, {
      error: "Image provider chưa được cấu hình. Hãy đặt OPENAI_API_KEY trong Supabase Edge Function secrets.",
      code: "IMAGE_PROVIDER_NOT_CONFIGURED",
    }, 503);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await admin.auth.getUser(token);

  if (authError || !authData.user) {
    return json(req, { error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role,plan")
    .eq("id", authData.user.id)
    .maybeSingle();

  const role = String(profile?.role || "user");
  const plan = String(profile?.plan || "free");

  // Image generation is provider-backed and has a direct API cost.
  // Keep it behind paid/owner entitlements until a separate image quota exists.
  if (role !== "owner" && plan !== "pro" && plan !== "legendary") {
    return json(req, {
      error: "Tạo ảnh hiện yêu cầu gói Pro hoặc Legendary.",
      code: "IMAGE_PROVIDER_FORBIDDEN",
    }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON", code: "INVALID_JSON" }, 400);
  }

  const prompt = String(body?.prompt || "").trim();
  if (!prompt) {
    return json(req, { error: "prompt is required", code: "PROMPT_REQUIRED" }, 400);
  }

  if (prompt.length > IMAGE_MAX_PROMPT_CHARS) {
    return json(req, { error: "Prompt quá dài.", code: "PROMPT_TOO_LARGE" }, 413);
  }

  const bucketKey = authData.user.id;
  const now = Date.now();
  if (imageBuckets.size > IMAGE_BUCKET_MAX) {
    for (const [key, value] of imageBuckets) {
      if (now - value.started >= IMAGE_WINDOW_MS) imageBuckets.delete(key);
      if (imageBuckets.size <= IMAGE_BUCKET_MAX) break;
    }
  }
  const bucket = imageBuckets.get(bucketKey);
  if (!bucket || now - bucket.started >= IMAGE_WINDOW_MS) {
    imageBuckets.set(bucketKey, { started: now, count: 1 });
  } else {
    bucket.count++;
    if (bucket.count > IMAGE_MAX_REQUESTS) {
      const retryAfter = Math.max(1, Math.ceil((IMAGE_WINDOW_MS - (now - bucket.started)) / 1000));
      const response = json(req, { error: "Image generation rate limit.", code: "IMAGE_RATE_LIMITED", retryAfter }, 429);
      response.headers.set("Retry-After", String(retryAfter));
      return response;
    }
  }

  const allowedSizes = new Set(["auto", "1024x1024", "1024x1536", "1536x1024"]);
  const size = allowedSizes.has(String(body?.size || "auto"))
    ? String(body?.size || "auto")
    : "auto";

  const qualityValue = String(body?.quality || "auto");
  const quality = new Set(["auto", "low", "medium", "high"]).has(qualityValue)
    ? qualityValue
    : "auto";

  const backgroundValue = String(body?.background || "auto");
  const background = new Set(["auto", "opaque", "transparent"]).has(backgroundValue)
    ? backgroundValue
    : "auto";

  const model = Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-2";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + openaiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality,
        background,
        output_format: "png",
        n: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const raw = await response.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = data?.error?.message || raw.slice(0, 800) || ("HTTP " + response.status);
      return json(req, {
        error: "Image provider error: " + message,
        code: "IMAGE_PROVIDER_ERROR",
      }, response.status >= 400 && response.status < 500 ? response.status : 502);
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return json(req, {
        error: "Image provider không trả về b64_json.",
        code: "IMAGE_EMPTY",
      }, 502);
    }

    return json(req, {
      provider: "openai",
      model,
      size,
      quality,
      background,
      imageDataUrl: "data:image/png;base64," + b64,
    });
  } catch (error) {
    return json(req, {
      error: error instanceof Error ? error.message : "Image provider request failed",
      code: "IMAGE_PROVIDER_NETWORK",
    }, 502);
  }
});
