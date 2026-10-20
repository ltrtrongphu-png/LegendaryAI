export type ModelRoute = "huggingface-local" | "local-ai" | "native-core" | "native-fallback";
export type ModelHealth = "unknown" | "checking" | "ready" | "degraded" | "offline";
export type ModelCapability = "chat" | "streaming" | "vision" | "audio" | "json" | "tools" | "system_prompt" | "files";

export type RuntimeModel = {
  key:string; display_name?:string; provider:string; model_id:string;
  base_url_env?:string|null; api_key_env?:string|null;
  context_window?:number; max_output_tokens?:number;
  capabilities?:unknown; health_status?:ModelHealth|null;
  supports_streaming?:boolean; supports_vision?:boolean; supports_tools?:boolean;
  supports_json?:boolean; supports_system_prompt?:boolean;
};

export function hasCapability(model:RuntimeModel, capability:ModelCapability){
  const caps=Array.isArray(model.capabilities)?model.capabilities.map(String):[];
  const direct=(model as any)["supports_"+capability];
  return direct===true || caps.includes(capability);
}

export function negotiateCapability(model:RuntimeModel, requested:string, planCaps:Record<string,unknown>={}){
  if(!requested) return {ok:true};
  const aliases:Record<string,string>={project:"projectWorkspace","agent":"agentMode","batch":"batchTasks","multi-model":"multiModel"};
  const planKey=aliases[requested]||requested;
  if(planCaps[planKey]===false) return {ok:false,code:"CAPABILITY_FORBIDDEN"};
  if(["vision","audio","streaming","json","tools","system_prompt"].includes(requested) && !hasCapability(model,requested as ModelCapability))
    return {ok:false,code:"MODEL_CAPABILITY_UNSUPPORTED"};
  return {ok:true};
}

export function modelError(code:string,message:string,details?:unknown){
  const e=new Error(message); (e as any).code=code; (e as any).details=details; return e;
}

export function requestId(){ return crypto.randomUUID(); }

export type RateLimitBucket = { started: number; count: number; last: number };

/** Per-key in-memory rate bucket. Call independently for user and trusted client IP. */
export function checkRateLimitBucket(
  buckets: Map<string, RateLimitBucket>,
  key: string,
  now: number,
  windowMs = 60_000,
  maxRequests = 20,
  minIntervalMs = 50,
) {
  const existing = buckets.get(key);
  if (!existing || now - existing.started >= windowMs) {
    buckets.set(key, { started: now, count: 1, last: now });
    return { ok: true as const, code: "", retryAfter: 0 };
  }
  if (now - existing.last < minIntervalMs) {
    return { ok: false as const, code: "REQUEST_BURST", retryAfter: 1 };
  }
  existing.last = now;
  existing.count += 1;
  if (existing.count > maxRequests) {
    return {
      ok: false as const,
      code: "RATE_LIMITED",
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - existing.started)) / 1000)),
    };
  }
  return { ok: true as const, code: "", retryAfter: 0 };
}

export type TokenReservationPlan = {
  ok: true;
  inputTokens: number;
  outputTokens: number;
  reservedTokens: number;
} | {
  ok: false;
  code: "TOKEN_LIMIT";
  inputTokens: number;
  outputTokens: 0;
  reservedTokens: 0;
};

/** Reserve enough for input + output before execution, capped by current balance. */
export function planTokenReservation(
  inputTokens: number,
  requestedOutputTokens: number,
  remainingTokens: number,
  minimumOutputTokens = 256,
): TokenReservationPlan {
  const input = Math.max(0, Math.floor(Number.isFinite(inputTokens) ? inputTokens : 0));
  const requestedOutput = Math.max(0, Math.floor(Number.isFinite(requestedOutputTokens) ? requestedOutputTokens : 0));
  const remaining = Math.max(0, Math.floor(Number.isFinite(remainingTokens) ? remainingTokens : 0));
  const minimum = Math.max(1, Math.floor(Number.isFinite(minimumOutputTokens) ? minimumOutputTokens : 256));
  if (remaining < input + minimum || requestedOutput < minimum) {
    return { ok: false, code: "TOKEN_LIMIT", inputTokens: input, outputTokens: 0, reservedTokens: 0 };
  }
  const output = Math.min(requestedOutput, remaining - input);
  return { ok: true, inputTokens: input, outputTokens: output, reservedTokens: input + output };
}
