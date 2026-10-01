import { createClient } from "npm:@supabase/supabase-js@2";
import { buildModelSystemPrompt, createNativePlan, detectIntent, nativeAnswer } from "./brain-core.js";

const ORIGINS=new Set(["https://legendaryai.vercel.app","https://www.legendaryai.vercel.app","http://localhost:3000","http://127.0.0.1:3000"]);
const MAX_MESSAGES=60,MAX_CONTEXT_CHARS=60000,SHIELD_WINDOW_MS=60000,SHIELD_MAX_REQUESTS=20,LOCAL_TIMEOUT_MS=12000;
const cache=new Map<string,{created:number;text:string}>(),buckets=new Map<string,{started:number;count:number;last:number}>(),memoryCache=new Map<string,{created:number;items:string[]}>();
const CACHE_TTL_MS=15000,MEMORY_TTL_MS=30000;
function cors(req:Request){const origin=req.headers.get("origin")||"";return {"Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"https://legendaryai.vercel.app","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Credentials":"true",Vary:"Origin"}}
function out(req:Request,body:unknown,status=200,extra:Record<string,string>={}){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors(req),...extra}})}
function textOf(v:any):string{if(Array.isArray(v))return v.map((x:any)=>typeof x==="string"?x:x?.type==="text"?x.text||"":x?.type==="image"?`[IMAGE:${String(x.name||"image")}]`:x?.text||x?.content||"").join("\n");if(typeof v==="string")return v;if(v==null)return "";return JSON.stringify(v)}
const approxTokens=(t:string)=>Math.max(1,Math.ceil(String(t||"").length/4));
const fallbackPlan=(key:string)=>({key,name:key,token_limit:key==="legendary"?6000000:key==="pro"?2000000:key==="free"?500000:1000,reset_hours:key==="legendary"?18:key==="pro"?12:6,reasoning_tier:key==="legendary"?"deep-plus":key==="pro"?"deep":key==="free"?"basic":"none",default_model_key:key==="legendary"?"legendary-ultra-1":key==="pro"?"legendary-pro-1":"legendary-lite-1",model_tiers:key==="legendary"?["free","pro","legendary"]:key==="pro"?["free","pro"]:["free"],capabilities:key==="legendary"?{reasoning:true,projectWorkspace:true,vision:true,memory:true,agentMode:true,batchTasks:true,multiModel:true}:key==="pro"?{reasoning:true,projectWorkspace:true,vision:true,memory:true,agentMode:false,batchTasks:true,multiModel:false}:{reasoning:key!=="guest",projectWorkspace:false,vision:false,memory:false,agentMode:false,batchTasks:false,multiModel:false}});
const modelFor=(p:any)=>String(p?.default_model_key||"legendary-lite-1");
const reasoningTier=(p:any)=>String(p?.reasoning_tier||"none");
function allowed(p:any,r:string,t:string){if(r==="owner")return true;const tiers=Array.isArray(p?.model_tiers)?p.model_tiers:[];return tiers.includes(t)}
function capAllowed(p:any,c:string){if(!c)return true;return Boolean(p?.capabilities&&p.capabilities[c])}
function shield(req:Request,id:string,raw:string){const now=Date.now(),ip=(req.headers.get("x-forwarded-for")||req.headers.get("cf-connecting-ip")||"").split(",")[0].trim()||"unknown",key=`${id}:${ip}`,old=buckets.get(key);if(!old||now-old.started>=SHIELD_WINDOW_MS){buckets.set(key,{started:now,count:1,last:now});return{ok:true}}if(now-old.last<50)return{ok:false,code:"REQUEST_BURST",retryAfter:1};old.last=now;old.count++;if(old.count>SHIELD_MAX_REQUESTS)return{ok:false,code:"RATE_LIMITED",retryAfter:Math.max(1,Math.ceil((SHIELD_WINDOW_MS-(now-old.started))/1000))};return{ok:true}}
function normalize(ms:any[]){return(Array.isArray(ms)?ms:[]).filter((m:any)=>m&&(m.role==="user"||m.role==="assistant"||m.role==="ai")).slice(-MAX_MESSAGES).map((m:any)=>({role:m.role==="ai"?"assistant":m.role,content:textOf(m.content)}))}
function compact(ms:any[],prompt:string){const all=normalize(ms),terms=new Set((prompt.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).slice(0,24)),scored=all.map((m,i)=>{let score=i>=all.length-10?3:0;for(const t of terms)if(m.content.toLowerCase().includes(t))score++;return{m,i,score}}),picked=[...scored.filter(x=>x.i<all.length-10).sort((a,b)=>b.score-a.score||b.i-a.i).slice(0,14),...scored.slice(-10)],seen=new Set<number>(),outm:any[]=[];let total=0;for(const x of picked){if(seen.has(x.i))continue;const n=x.m.content.length;if(outm.length&&total+n>MAX_CONTEXT_CHARS)continue;seen.add(x.i);outm.push(x.m);total+=n}return outm}
function budget(intent:string,n:number){const caps:Record<string,number>={greeting:512,math:1024,image:512,writing:4096,translate:4096,summarize:6144,code:12288,plan:8192,compare:8192,explain:8192,brainstorm:6144,general:8192};return Math.min(n,caps[intent]||8192)}
async function sha(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")}
function cacheGet(k:string){const x=cache.get(k);if(!x)return null;if(Date.now()-x.created>CACHE_TTL_MS){cache.delete(k);return null}return x.text}
function cacheSet(k:string,t:string){cache.set(k,{created:Date.now(),text:t});if(cache.size>500)cache.delete(cache.keys().next().value!)}
async function relevantMemories(admin:any,userId:string,prompt:string,enabled:boolean){
  if(!enabled||!userId)return [];
  const cached=memoryCache.get(userId);if(cached&&Date.now()-cached.created<MEMORY_TTL_MS)return cached.items;
  const {data,error}=await admin.from("ai_memories").select("memory,importance,updated_at").eq("user_id",userId).order("importance",{ascending:false}).order("updated_at",{ascending:false}).limit(24);
  if(error||!Array.isArray(data))return [];
  const terms=new Set((prompt.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).slice(0,24));
  const ranked=data.map((m:any)=>{const words=String(m.memory||"").toLowerCase();let score=Number(m.importance||5)*0.15;for(const t of terms)if(words.includes(t))score+=1;return{memory:String(m.memory||"").trim(),score}}).filter((m:any)=>m.memory).sort((a:any,b:any)=>b.score-a.score).slice(0,6).map((m:any)=>m.memory);
  memoryCache.set(userId,{created:Date.now(),items:ranked});if(memoryCache.size>500)memoryCache.delete(memoryCache.keys().next().value!);return ranked;
}
async function maybeSaveExplicitMemory(admin:any,userId:string,prompt:string,enabled:boolean){
  if(!enabled||!userId)return false;
  const match=String(prompt||'').match(/(?:hãy nhớ rằng|hãy ghi nhớ|ghi nhớ rằng|remember that|my preference is)[:\s]+(.{3,280})$/i);
  if(!match)return false;
  const memory=match[1].trim();
  if(/mật khẩu|password|api[ _-]?key|secret|access token|refresh token|cccd|số thẻ|bank account/i.test(memory))return false;
  const {error}=await admin.from("ai_memories").insert({user_id:userId,memory,source:"explicit-user-memory",importance:8});
  if(!error)memoryCache.delete(userId);
  return !error;
}
async function localChat(url:string,model:string,ms:any[],system:string,max:number,temp:number){const base=url.replace(/\/$/,"");let last:any;for(let i=0;i<2;i++){const c=new AbortController(),timer=setTimeout(()=>c.abort(),LOCAL_TIMEOUT_MS);try{const r=await fetch(`${base}/api/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model,stream:false,messages:[{role:"system",content:buildModelSystemPrompt(system)},...ms],options:{temperature:temp,num_predict:max}}),signal:c.signal}),raw=await r.text();if(!r.ok)throw new Error(`Local AI HTTP ${r.status}: ${raw.slice(0,300)}`);const d=raw?JSON.parse(raw):null,t=String(d?.message?.content||d?.response||"").trim();if(!t)throw new Error("Local AI returned an empty response");return t}catch(e){last=e}finally{clearTimeout(timer)}if(i===0)await new Promise(r=>setTimeout(r,250))}throw last instanceof Error?last:new Error("Local AI request failed")}
Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});if(req.method!=="POST")return out(req,{error:"Method not allowed"},405);const auth=req.headers.get("Authorization");if(!auth)return out(req,{error:"Unauthorized"},401);const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return out(req,{error:"Server configuration missing",code:"SERVER_CONFIG"},503);const admin=createClient(url,key),token=auth.replace(/^Bearer\s+/i,"");const {data:authData,error:authError}=await admin.auth.getUser(token);if(authError||!authData.user)return out(req,{error:"Unauthorized"},401);let body:any,raw="";try{raw=await req.text();body=JSON.parse(raw)}catch{return out(req,{error:"Invalid JSON"},400)}const sh=shield(req,authData.user.id,raw);if(!sh.ok)return out(req,{error:"Legendary Shield blocked this request.",code:sh.code,retryAfter:sh.retryAfter},429,{"Retry-After":String(sh.retryAfter||1)});const ms=Array.isArray(body?.messages)?body.messages:[],prompt=textOf([...ms].reverse().find((m:any)=>m?.role==="user")?.content).trim();if(!prompt)return out(req,{error:"messages is required"},400);const isGuest=authData.user.is_anonymous===true;let {data:profile,error:pe}=await admin.from("profiles").select("role,plan,plan_id,token_limit,tokens_used,token_reset_at,plan_expires_at,memory_enabled,vision_enabled").eq("id",authData.user.id).maybeSingle();if(pe||!profile)return out(req,{error:"Profile could not be loaded",code:"PROFILE_NOT_FOUND"},500);
if(!isGuest && String(profile.role||"user")!=="owner" && String(profile.plan||"free")!=="free" && profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() <= Date.now()){
  const {data:freePlan}=await admin.from("plans").select("id,key,token_limit,reset_hours,capabilities").eq("key","free").eq("enabled",true).maybeSingle();
  if(freePlan){
    const caps=(freePlan.capabilities&&typeof freePlan.capabilities==="object")?freePlan.capabilities:{};
    await admin.from("profiles").update({
      plan:freePlan.key,
      plan_id:freePlan.id,
      token_limit:Number(freePlan.token_limit||500000),
      memory_enabled:Boolean(caps.memory),
      vision_enabled:Boolean(caps.vision),
      web_search_enabled:Boolean(caps.webSearch),
      tokens_used:0,
      token_reset_at:new Date(Date.now()+Number(freePlan.reset_hours||6)*3600000).toISOString(),
      plan_expires_at:null,
      updated_at:new Date().toISOString()
    }).eq("id",authData.user.id);
    profile={...profile,plan:freePlan.key,plan_id:freePlan.id,token_limit:Number(freePlan.token_limit||500000),tokens_used:0,token_reset_at:new Date(Date.now()+Number(freePlan.reset_hours||6)*3600000).toISOString(),plan_expires_at:null,memory_enabled:Boolean(caps.memory),vision_enabled:Boolean(caps.vision)};
  }
}
const planKey=isGuest?"guest":String(profile.plan||"free");const {data:planRow}=await admin.from("plans").select("id,key,name,token_limit,reset_hours,reasoning_tier,default_model_key,model_tiers,capabilities,enabled").eq("key",planKey).eq("enabled",true).maybeSingle();const planData=planRow||fallbackPlan(planKey);const plan=String(planData.key||planKey),role=String(profile.role||"user"),rt=reasoningTier(planData);if(isGuest&&Number(profile.token_limit)!==1000)await admin.from("profiles").update({token_limit:1000,plan_id:planData.id||profile.plan_id}).eq("id",authData.user.id);let modelKey=modelFor(planData);const requested=typeof body?.model==="string"?body.model.trim():"auto";if(requested&&requested!=="auto"){const {data:selected}=await admin.from("ai_models").select("key,tier,enabled").eq("key",requested).eq("enabled",true).maybeSingle();if(!selected)return out(req,{error:"Model không tồn tại hoặc đang tắt.",code:"MODEL_NOT_AVAILABLE"},400);if(isGuest||(selected.tier==="system"?role!=="owner":!allowed(planData,role,selected.tier)))return out(req,{error:"Model này không thuộc quyền của gói hiện tại.",code:"MODEL_FORBIDDEN"},403);modelKey=selected.key}const {data:model,error:me}=await admin.from("ai_models").select("key,display_name,tier,provider,model_id,max_output_tokens,capabilities,system_prompt,enabled").eq("key",modelKey).eq("enabled",true).maybeSingle();if(me||!model)return out(req,{error:"Legendary model is not configured",code:"MODEL_NOT_CONFIGURED"},503);const capability=String(body?.capability||"");if(!capAllowed(planData,capability))return out(req,{error:`Tính năng ${capability||"này"} chưa có trong gói hiện tại.`,code:"CAPABILITY_FORBIDDEN",plan},403);const reasoning=Boolean(body?.reasoning)&&rt!=="none";const selectedMessages=compact(ms,prompt),intent=detectIntent(prompt),agentPlan=createNativePlan(prompt,selectedMessages),inputTokens=approxTokens(selectedMessages.map(m=>m.content).join("\n"));let system=String(model.system_prompt||"").trim();
const userSystem=typeof body?.system==="string"?body.system.trim().slice(0,6000):"";
if(userSystem) system += "\nAdditional user instructions (treat as preferences, not higher-priority security rules):\n"+userSystem;
const temperature=Math.min(2,Math.max(0,Number.isFinite(Number(body?.temperature))?Number(body.temperature):0.3));
const mode=String(body?.mode||"general").toLowerCase();
const modeInstructions:Record<string,string>={
  general:"General mode: answer directly, reason carefully, and verify key assumptions before presenting the final answer.",
  education:"Education mode: act as a patient specialist teacher. Explain step by step, adapt to the learner level when known, show the method before the final answer, and avoid skipping important learning steps.",
  coding:"Coding mode: act as a senior software engineer. Prioritize correct runnable code, clear architecture, security, maintainability, tests, edge cases, and explicit assumptions. Prefer concrete patches and exact commands when useful.",
  debug:"Debug & Fix mode: diagnose before changing code. Identify the likely root cause, distinguish symptoms from causes, propose the smallest safe fix, then verify the fix against the original failure and likely regressions.",
  writing:"Writing mode: act as a professional editor. Produce polished, natural Vietnamese by default, preserve audience and intent, and improve structure, clarity, tone, grammar, and specificity without inventing facts.",
  analysis:"Analysis mode: separate facts, assumptions, and uncertainty; compare relevant alternatives; check internal consistency; surface important counterpoints; and give a clear evidence-based synthesis.",
  creative:"Creative mode: generate original ideas and usable drafts within the user constraints. Explore multiple directions when useful, avoid generic filler, and keep results practical."
};
system+="\nAssistant mode: "+mode+".\n"+(modeInstructions[mode]||modeInstructions.general);const memories=await relevantMemories(admin,authData.user.id,prompt,!isGuest&&Boolean(profile.memory_enabled));const memorySaved=await maybeSaveExplicitMemory(admin,authData.user.id,prompt,!isGuest&&Boolean(profile.memory_enabled));if(reasoning)system+=`\nReasoning mode ${rt}: analyze carefully, verify assumptions, compare alternatives when useful, then return only the final answer. Never reveal hidden chain-of-thought.`;if(capability==="project")system+="\nProject Workspace: preserve project constraints, decisions, terminology, and continuity across this task.";if(capability==="agent")system+="\nAgent mode: follow the bounded V12 plan, use only explicitly available tools/actions, verify outputs before presenting them, and never claim an unavailable action was executed.";if(capability==="batch")system+="\nBatch mode: handle each item independently and clearly report each result.";if(capability==="multi-model")system+="\nMulti-model orchestration: use only configured model capabilities and never claim unavailable routing.";if(memories.length)system+="\nRelevant user memory (use only when directly applicable; do not invent beyond it):\n"+memories.map((m:string)=>"- "+m).join("\n");const max=budget(intent,Math.min(Math.max(Number(body?.max_tokens)||Number(model.max_output_tokens)||8192,256),Number(model.max_output_tokens)||8192));
const gateway=Deno.env.get("LEGENDARY_LOCAL_AI_URL")||"";
const local=Boolean(gateway&&model.provider==="ollama-compatible"&&model.model_id);
const cacheKey=await sha(JSON.stringify({
  model:model.key,
  system,
  messages:selectedMessages,
  temp:temperature,
  max,
  regenerate:String(body?.cacheKey||"")
}));
const cachedText=cacheGet(cacheKey);
const cacheHit=Boolean(cachedText);
const started=Date.now();

if(cacheHit){
  const latestCached=await admin.from("profiles").select("token_limit,tokens_used,token_reset_at,plan_expires_at").eq("id",authData.user.id).maybeSingle();
  return out(req,{
    requestId:crypto.randomUUID(),
    model:model.key,
    displayModel:model.display_name||model.key,
    providerModel:model.model_id,
    tier:model.tier,
    capabilities:Array.isArray(model.capabilities)?model.capabilities:[],
    fallbackUsed:false,
    local:false,
    native:true,
    text:cachedText,
    action:"text",
    plan,
    reasoning:{enabled:reasoning,tier:rt},
    brain:{version:"12.0-agent",intent,route:"cache",cacheHit:true,contextMessages:selectedMessages.length,rawContextMessages:ms.length,memoryRecall:memories.length,memorySaved:false,agent:agentPlan,selfCheck:true},
    performance:{latency_ms:Date.now()-started,cache_hit:true,context_compacted:ms.length!==selectedMessages.length},
    usage:{input_tokens:0,output_tokens:0,total_tokens:0,tokens_used:Number(latestCached.data?.tokens_used??profile.tokens_used??0),token_limit:Number(latestCached.data?.token_limit??limitForProfile(profile,planData,isGuest)),remaining_tokens:Math.max(0,Number(latestCached.data?.token_limit??limitForProfile(profile,planData,isGuest))-Number(latestCached.data?.tokens_used??profile.tokens_used??0))}
  });
}

let text="";
let fallback=false;
let route=local?"local-ai":"native-core";
let action="text";
let localReservation=0;
const inputTokens=approxTokens(selectedMessages.map(m=>m.content).join("\n"));

function limitForProfile(p:any,planInfo:any,guest:boolean){
  return guest?1000:Number(planInfo?.token_limit||p?.token_limit||500000);
}

try{
  if(local){
    const limit=limitForProfile(profile,planData,isGuest);
    const remaining=Math.max(0,limit-Number(profile.tokens_used||0));
    localReservation=Math.min(inputTokens+max,remaining);
    if(localReservation<=0){
      return out(req,{error:"Bạn đã chạm hạn mức token của gói hiện tại.",code:"TOKEN_LIMIT",tokenLimit:limit,tokensUsed:Number(profile.tokens_used||0),tokenResetAt:profile.token_reset_at},429);
    }
    const {data:ok,error:te}=await admin.rpc("consume_tokens",{p_amount:localReservation,p_user_id:authData.user.id,p_is_guest:isGuest});
    if(te){
      console.error("consume_tokens failed",te.message);
      return out(req,{error:"Không thể cập nhật hạn mức token.",code:"TOKEN_RPC_ERROR"},500);
    }
    if(!ok)return out(req,{error:"Bạn đã chạm hạn mức token của gói hiện tại.",code:"TOKEN_LIMIT",tokenLimit:limit,tokensUsed:Number(profile.tokens_used||0),tokenResetAt:profile.token_reset_at},429);
  }

  if(local){
    try{
      text=await localChat(gateway,model.model_id,selectedMessages,system,max,temperature);
    }catch{
      fallback=true;
      route="native-fallback";
    }
  }

  if(!text){
    const native=nativeAnswer(prompt,selectedMessages);
    text=native.text;
    action=native.action||"text";
    route=fallback?"native-fallback":"native-core";
  }

  if(text)cacheSet(cacheKey,text);
  const outputTokens=local?approxTokens(text):0;
  const actual=local?inputTokens+outputTokens:0;

  if(localReservation>0){
    const refundAmount=Math.max(0,localReservation-actual);
    if(refundAmount>0){
      const {error:refundError}=await admin.rpc("refund_tokens",{p_amount:refundAmount,p_user_id:authData.user.id});
      if(refundError) console.error("refund_tokens failed",refundError.message);
    }
  }

  const latency=Date.now()-started;
  const latest=await admin.from("profiles").select("token_limit,tokens_used,token_reset_at,plan_expires_at").eq("id",authData.user.id).maybeSingle();
  const finalLimit=Number(latest.data?.token_limit??limitForProfile(profile,planData,isGuest));
  const finalUsed=Number(latest.data?.tokens_used??profile.tokens_used??0);

  const usageRow={
    user_id:authData.user.id,
    model_key:model.key,
    provider_model:model.model_id,
    plan,
    input_tokens:local?inputTokens:0,
    output_tokens:local?outputTokens:0,
    reserved_tokens:local?localReservation:0,
    request_ms:latency,
    status:"success"
  };
  const {error:usageError}=await admin.from("ai_usage_logs").insert(usageRow);
  if(usageError) console.error("usage log failed",usageError.message);

  return out(req,{
    requestId:crypto.randomUUID(),
    model:model.key,
    displayModel:model.display_name||model.key,
    providerModel:model.model_id,
    tier:model.tier,
    capabilities:Array.isArray(model.capabilities)?model.capabilities:[],
    fallbackUsed:fallback,
    local:route==="local-ai",
    native:route!=="local-ai",
    text,
    action,
    plan,
    reasoning:{enabled:reasoning,tier:rt},
    brain:{version:"12.0-agent",intent,route,cacheHit:false,contextMessages:selectedMessages.length,rawContextMessages:ms.length,memoryRecall:memories.length,memorySaved,agent:agentPlan,selfCheck:true},
    performance:{latency_ms:latency,cache_hit:false,context_compacted:ms.length!==selectedMessages.length},
    usage:{input_tokens:local?inputTokens:0,output_tokens:local?outputTokens:0,total_tokens:actual,tokens_used:finalUsed,token_limit:finalLimit,remaining_tokens:Math.max(0,finalLimit-finalUsed)}
  });
}catch(error){
  if(localReservation>0){
    const {error:refundError}=await admin.rpc("refund_tokens",{p_amount:localReservation,p_user_id:authData.user.id});
    if(refundError) console.error("refund after failure failed",refundError.message);
  }
  console.error("AI engine error",error instanceof Error?error.message:String(error));
  return out(req,{error:"AI engine request failed.",code:"AI_ENGINE_ERROR"},502);
}

});
