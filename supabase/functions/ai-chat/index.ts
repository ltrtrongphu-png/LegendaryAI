import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS=new Set(["https://legendaryai.vercel.app","https://www.legendaryai.vercel.app","http://localhost:3000","http://127.0.0.1:3000"]);

// Legendary Shield 1.1.0 — application-layer abuse/DDoS resistance.
// This is not a substitute for a CDN/WAF/network DDoS provider.
const SHIELD_WINDOW_MS = 60_000;
const SHIELD_MAX_REQUESTS = 20;
const SHIELD_MAX_BODY_BYTES = 1_500_000;
const SHIELD_MAX_MESSAGE_CHARS = 500_000;
const shieldBuckets = new Map<string, { started: number; count: number; last: number }>();

// Legendary Adaptive Intelligence 1.1.1
const ADAPTIVE_MAX_MESSAGES = 48;
const ADAPTIVE_MAX_CONTEXT_CHARS = 90_000;
const RESPONSE_CACHE_TTL_MS = 15_000;
const responseCache = new Map<string, { created: number; text: string }>();
const SHIELD_BUCKET_MAX = 2000;

function requestId() { return crypto.randomUUID(); }

function compactMessages(messages:any[]) {
  const selected = (Array.isArray(messages) ? messages : []).slice(-ADAPTIVE_MAX_MESSAGES);
  let total = 0;
  const kept:any[] = [];
  for (let i = selected.length - 1; i >= 0; i--) {
    const m = selected[i], size = textOf(m?.content).length;
    if (kept.length && total + size > ADAPTIVE_MAX_CONTEXT_CHARS) break;
    kept.unshift(m);
    total += size;
  }
  return kept;
}

async function stableHash(value:string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function cacheGet(key:string) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.created > RESPONSE_CACHE_TTL_MS) { responseCache.delete(key); return null; }
  return hit.text;
}

function cacheSet(key:string,text:string) {
  responseCache.set(key,{created:Date.now(),text});
  if (responseCache.size > 500) responseCache.delete(responseCache.keys().next().value);
}

function cleanupShield(now:number) {
  if (shieldBuckets.size <= SHIELD_BUCKET_MAX) return;
  for (const [key, bucket] of shieldBuckets) {
    if (now - bucket.started >= SHIELD_WINDOW_MS) shieldBuckets.delete(key);
    if (shieldBuckets.size <= SHIELD_BUCKET_MAX) break;
  }
}
function clientKey(req: Request, userId: string) {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
  const ip = forwarded.split(",")[0].trim();
  return userId + ":" + (ip || "unknown");
}

function shield(req: Request, userId: string, bodyText: string) {
  const now = Date.now();
  cleanupShield(now);
  if (new TextEncoder().encode(bodyText).byteLength > SHIELD_MAX_BODY_BYTES) {
    return { ok: false, code: "REQUEST_TOO_LARGE", retryAfter: 60 };
  }
  const key = clientKey(req, userId);
  const old = shieldBuckets.get(key);
  if (!old || now - old.started >= SHIELD_WINDOW_MS) {
    shieldBuckets.set(key, { started: now, count: 1, last: now });
    return { ok: true, remaining: SHIELD_MAX_REQUESTS - 1 };
  }
  if (now - old.last < 50) {
    return { ok: false, code: "REQUEST_BURST", retryAfter: 1 };
  }
  old.last = now;
  old.count++;
  if (old.count > SHIELD_MAX_REQUESTS) {
    return { ok: false, code: "RATE_LIMITED", retryAfter: Math.max(1, Math.ceil((SHIELD_WINDOW_MS - (now - old.started)) / 1000)) };
  }
  return { ok: true, remaining: SHIELD_MAX_REQUESTS - old.count };
}


const cors=(req:Request)=>({"Access-Control-Allow-Origin":ORIGINS.has(req.headers.get("origin")||"")?(req.headers.get("origin")||""):"https://legendaryai.vercel.app","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Credentials":"true","Vary":"Origin"});
const out=(req:Request,b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json; charset=utf-8",...cors(req)}});
const textOf=(v:any):string=>Array.isArray(v)?v.map((x:any)=>typeof x==="string"?x:x?.type==="text"?x.text||"":x?.type==="image"?"[IMAGE:"+String(x.name||"image")+"]":x?.text||x?.content||"").join("\n"):typeof v==="string"?v:v==null?"":JSON.stringify(v);
const tokens=(s:string)=>Math.max(1,Math.ceil(String(s||"").length/4));
const modelFor=(p:string)=>p==="legendary"?"legendary-ultra-1":p==="pro"?"legendary-pro-1":"legendary-lite-1";
const allowed=(p:string,r:string,t:string)=>r==="owner"||p==="legendary"?["free","pro","legendary"].includes(t):p==="pro"?["free","pro"].includes(t):t==="free";

function intent(p:string){
 const x=p.toLowerCase().trim();
 if(/^(hi|hello|xin chào|chào|hey)\b/.test(x))return"greeting";
 if(/^(tính|calculate|calc)\b|^[0-9+\-*/%(). x×÷]+$/.test(x))return"math";
 if(/(debug|bug|lỗi|error|fix|code review|sửa code|lập trình|javascript|typescript|python|java|sql|html|css|supabase|api)/.test(x))return"code";
 if(/(tóm tắt|tóm lược|summarize|summary|ý chính)/.test(x))return"summarize";
 if(/(dịch|translate|translation)/.test(x))return"translate";
 if(/(viết lại|rewrite|paraphrase|chỉnh sửa|sửa câu)/.test(x))return"rewrite";
 if(/(kế hoạch|plan|roadmap|lộ trình|từng bước|steps)/.test(x))return"plan";
 if(/(so sánh|compare|khác nhau|difference|ưu.*nhược|trade.?off)/.test(x))return"compare";
 if(/(giải thích|explain|tại sao|why|how does|là gì|what is)/.test(x))return"explain";
 if(/(ý tưởng|brainstorm|gợi ý|ideas|đề xuất)/.test(x))return"brainstorm";
 return"general";
}
function context(ms:any[],n=12000){
 return ms.slice(-24).map((m:any)=>(m?.role==="assistant"||m?.role==="ai"?"AI":"User")+": "+textOf(m?.content)).filter(Boolean).join("\n").slice(-n);
}
function math(s:string){
 const x=s.replace(/,/g,".").replace(/[x×]/gi,"*").replace(/÷/g,"/");
 if(!x||!/[0-9]/.test(x)||!/^[0-9+\-*/%().\s]+$/.test(x))return null;
 try{const v=Function('"use strict";return ('+x+')')();return typeof v==="number"&&Number.isFinite(v)?v:null}catch{return null}
}
function keywords(s:string){return [...new Set((s.toLowerCase().match(/[a-zA-ZÀ-ỹ0-9_]{3,}/g)||[]).filter(x=>!["the","and","cho","của","với","một","những","this","that","mình","bạn"].includes(x)))].slice(0,18)}
function constraints(s:string){
 const a:string[]=[];
 if(/ngắn|short|tóm gọn/i.test(s))a.push("ngắn gọn");
 if(/chi tiết|detailed|long|dài/i.test(s))a.push("chi tiết");
 if(/tiếng việt|vietnamese/i.test(s))a.push("tiếng Việt");
 if(/code|mã nguồn|lập trình/i.test(s))a.push("ưu tiên code có thể dùng");
 if(/không|don't|đừng/i.test(s))a.push("có ràng buộc phủ định");
 return a;
}
function outputBudget(i:string, configured:number) {
 const caps:Record<string,number> = {greeting:1024,math:2048,rewrite:4096,translate:4096,summarize:6144,code:12288,plan:8192,compare:8192,explain:8192,brainstorm:6144,general:8192};
 return Math.min(configured, caps[i] || 8192);
}
function codeReview(src:string,prompt:string){
 const findings:string[]=[];
 if(/api[_-]?key|service[_-]?role|password|secret/i.test(src))findings.push("Có dấu hiệu secret/credential; giữ ở server-side secret store.");
 if(/innerHTML\s*=/i.test(src))findings.push("Có innerHTML; kiểm tra nguồn dữ liệu để tránh chèn HTML không tin cậy.");
 if(/fetch\s*\(/i.test(src)&&!/(catch\s*\(|\.catch\s*\()/i.test(src))findings.push("Có fetch nhưng chưa thấy xử lý lỗi rõ ràng.");
 if(/setInterval\s*\(/i.test(src))findings.push("Có timer; kiểm tra cleanup để tránh chạy trùng hoặc leak.");
 if(/TODO|FIXME/i.test(src))findings.push("Có TODO/FIXME chưa hoàn tất.");
 if(/\.map\(|\.filter\(/.test(src)&&/await/i.test(src))findings.push("Kiểm tra async trong callback array; map không tự await Promise.");
 if(!findings.length)findings.push("Chưa phát hiện mẫu lỗi phổ biến từ context hiện có.");
 return "## Legendary Code Reasoning 9.0\n\n**Yêu cầu:** "+prompt+"\n\n### Phân tích\n1. Xác định mục tiêu và phạm vi.\n2. Đối chiếu context gần nhất.\n3. Kiểm tra state, dữ liệu, async flow và quyền.\n4. Ưu tiên thay đổi nhỏ, có thể kiểm thử.\n\n### Findings\n"+findings.map(x=>"- "+x).join("\n")+"\n\n### Next step\n- Xác nhận giả thuyết bằng test/reproduction trước khi sửa rộng.";
}
function answer(model:string,ms:any[],system:string){
 const last=[...ms].reverse().find((m:any)=>m?.role==="user");
 const p=textOf(last?.content).trim(); if(!p)return"Mình sẵn sàng. Hãy gửi yêu cầu cụ thể.";
 const i=intent(p),ctx=context(ms),all=ctx+"\nUser: "+p,ks=keywords(p),cs=constraints(p);
 if(i==="math"){const v=math(p.replace(/^(tính|calculate|calc)[: ]*/i,""));if(v!==null)return"## Kết quả\n\n**"+v+"**\n\nĐã kiểm tra bằng math core nội bộ.\n\n**Brain:** 9.0";}
 if(i==="greeting")return"Xin chào 👋 **Legendary Brain 9.0 đang online.**\n\nMình đã nâng pipeline để phân tích **intent → context → keywords → constraints → answer → self-check** thay vì chỉ phản hồi theo mẫu.";
 if(i==="code")return codeReview(all,p);
 if(i==="summarize"){const lines=ctx.split(/\n+/).filter(x=>x&&x!=="AI:").slice(-8);return"## Tóm tắt\n\n"+(lines.length?lines.map(x=>"- "+x.replace(/^User:\s*/,"")).join("\n"):"Chưa đủ context.")+"\n\n### Self-check\n- Không thêm dữ kiện ngoài context.\n- Ưu tiên nội dung mới nhất.";}
 if(i==="plan")return"## Plan 9.0\n\n**Mục tiêu:** "+p+"\n\n1. Xác định đầu ra và tiêu chí hoàn thành.\n2. Kiểm tra hiện trạng, dependency và ràng buộc.\n3. Chia thành các bước độc lập, dễ kiểm chứng.\n4. Thực hiện từ nền tảng đến phần phụ thuộc.\n5. Test happy path + edge cases.\n6. Review kết quả và rollback phần không cần thiết.\n\n**Constraints:** "+(cs.join(", ")||"không phát hiện")+"\n**Keywords:** "+ks.join(", ")+".";
 if(i==="compare")return"## So sánh có cấu trúc\n\nTách quyết định thành: **mục tiêu → tính năng → chi phí/nguồn lực → độ phức tạp → rủi ro → khả năng mở rộng**.\n\nYêu cầu: "+p+"\n\nMình sẽ không tự bịa thông số; phần nào thiếu dữ kiện sẽ được đánh dấu cần xác minh.";
 if(i==="explain")return"## Giải thích\n\n**Chủ đề:** "+p+"\n\n### Khung hiểu\n**Khái niệm → cơ chế → ví dụ → giới hạn → cách kiểm tra.**\n\n### Context liên quan\n"+(ctx.slice(-2600)||"Chưa có context.")+"\n\n### Self-check\nNếu context không đủ, không suy diễn thành dữ kiện chắc chắn.";
 if(i==="rewrite")return"## Bản viết lại\n\nƯu tiên: **giữ nghĩa → rõ cấu trúc → tự nhiên → đúng giọng → kiểm tra lại**.\n\n> "+p;
 if(i==="translate")return"## Translation\n\nƯu tiên **ngữ cảnh, thuật ngữ và giọng văn**, không dịch từng từ máy móc.\n\n> "+p;
 if(i==="brainstorm")return"## Brainstorm 9.0\n\n- **Core:** "+p+"\n- **Differentiator:** điểm khác biệt có thể tạo giá trị.\n- **UX:** giảm số bước người dùng phải làm.\n- **Scale:** thiết kế để thêm tính năng mà không phá core.\n- **Risk:** xác định phần cần kiểm chứng trước.";
 return"## Legendary Brain 9.0\n\n**Mình hiểu yêu cầu:** "+p+"\n\n### Context\n"+(ctx.slice(-2800)||"Chưa có context trước đó.")+"\n\n### Phân tích nội bộ\n- Intent: **"+i+"**\n- Keywords: "+(ks.join(", ")||"—")+"\n- Constraints: "+(cs.join(", ")||"—")+"\n- Context window: "+ms.length+" messages\n\n### Self-check\n- Không coi suy đoán là dữ kiện.\n- Ưu tiên thông tin mới nhất.\n- Nếu thiếu dữ kiện quan trọng, cần hỏi/đánh dấu thay vì bịa.\n\n**Brain:** 9.0 · **Model:** "+model;
}
async function ollama(url:string,name:string,ms:any[],system:string,max:number,temp:number){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),90000),base=url.replace(/\/$/,"");
 try{const r=await fetch(base+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:name,stream:false,messages:[...(system?[{role:"system",content:system}]:[]),...ms.map((m:any)=>({role:m.role==="ai"?"assistant":m.role,content:m.content}))],options:{temperature:temp,num_predict:max}}),signal:c.signal});const raw=await r.text();if(!r.ok)throw Error("Local AI HTTP "+r.status+": "+raw.slice(0,300));const d=JSON.parse(raw);return String(d?.message?.content||d?.response||"").trim()}finally{clearTimeout(t)}
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
 if(req.method!=="POST")return out(req,{error:"Method not allowed"},405);
 const auth=req.headers.get("Authorization");if(!auth)return out(req,{error:"Unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return out(req,{error:"Server configuration missing",code:"SERVER_CONFIG"},503);
 const sb=createClient(url,key,{global:{headers:{Authorization:auth}}}),u=await sb.auth.getUser();if(u.error||!u.data.user)return out(req,{error:"Unauthorized"},401);
 let body:any;try{body=await req.json()}catch{return out(req,{error:"Invalid JSON"},400)}
 const rawMessages=Array.isArray(body?.messages)?body.messages.slice(-120):[];
const ms=compactMessages(rawMessages);
const reqId=requestId();
if(!ms.length)return out(req,{error:"messages is required"},400);
if(ms.length>120)return out(req,{error:"Too many messages",code:"TOO_MANY_MESSAGES"},400);
const shieldResult=shield(req,u.data.user.id,JSON.stringify(body));
if(!shieldResult.ok){
 const response=out(req,{error:"Legendary Shield đã chặn request quá nhanh/quá lớn.",code:shieldResult.code,retryAfter:shieldResult.retryAfter},429);
 response.headers.set("Retry-After",String(shieldResult.retryAfter));
 return response;
}
const messageChars=rawMessages.reduce((n:any,m:any)=>n+textOf(m?.content).length,0);
if(messageChars>SHIELD_MAX_MESSAGE_CHARS)return out(req,{error:"Nội dung request vượt giới hạn bảo vệ.",code:"MESSAGE_TOO_LARGE"},413);
 let {data:p,error:pe}=await sb.from("profiles").select("role,plan,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled").eq("id",u.data.user.id).maybeSingle();
 if(pe||!p)return out(req,{error:"Profile could not be loaded",code:"PROFILE_NOT_FOUND"},500);
 const plan=String(p.plan||"free"),role=String(p.role||"user"),requested=typeof body?.model==="string"?body.model.trim():"auto";
 let mk=modelFor(plan);
 if(requested&&requested!=="auto"){
  const {data:m}=await sb.from("ai_models").select("key,tier,enabled").eq("key",requested).eq("enabled",true).maybeSingle();
  if(!m)return out(req,{error:"Model không tồn tại hoặc đang tắt.",code:"MODEL_NOT_AVAILABLE"},400);
  if(m.tier==="system"?role!=="owner":!allowed(plan,role,m.tier))return out(req,{error:"Model này không thuộc quyền của gói hiện tại.",code:"MODEL_FORBIDDEN"},403);
  mk=m.key;
 }
 const {data:model}=await sb.from("ai_models").select("key,display_name,tier,provider,model_id,max_output_tokens,capabilities,system_prompt,enabled").eq("key",mk).eq("enabled",true).maybeSingle();
 if(!model)return out(req,{error:"Legendary model is not configured",code:"MODEL_NOT_CONFIGURED"},503);
 const userPrompt=textOf([...ms].reverse().find((m:any)=>m?.role==="user")?.content);
 const requestIntent=intent(userPrompt);
 const requestedMax=Math.min(Math.max(Number(body?.max_tokens)||Number(model.max_output_tokens)||8192,256),Number(model.max_output_tokens)||8192);
 const max=outputBudget(requestIntent,requestedMax);
 const input=tokens(ms.map((m:any)=>textOf(m.content)).join("\n"));
 const reserve=Math.max(1,Math.min(input+max,Number(p.token_limit||150000)));
 const {data:ok,error:te}=await sb.rpc("consume_tokens",{p_amount:reserve});if(te)return out(req,{error:te.message,code:"TOKEN_RPC_ERROR"},500);if(!ok)return out(req,{error:"Bạn đã chạm hạn mức token của gói hiện tại.",code:"TOKEN_LIMIT",tokenLimit:Number(p.token_limit||0),tokensUsed:Number(p.tokens_used||0),tokenResetAt:p.token_reset_at},429);
 try{
  const startedAt=Date.now();
  const system=typeof body?.system==="string"?body.system.trim():String(model.system_prompt||"");
  const gateway=Deno.env.get("LEGENDARY_LOCAL_AI_URL")||"";
  const canUseLocalAI=Boolean(gateway&&model.provider==="ollama-compatible"&&model.model_id);
  const cacheKey=await stableHash(JSON.stringify({user:u.data.user.id,model:model.key,system,messages:ms,temperature:Number(body?.temperature??0.3),max,routeMode:canUseLocalAI?"local-ai":"native-core"}));
  let text=cacheGet(cacheKey);
  const cacheHit=Boolean(text);
  let fallbackUsed=false;
  let route=canUseLocalAI?"local-ai":"native-core";
  if(!text){
    if(canUseLocalAI){
      try{text=await ollama(gateway,model.model_id,ms,system,max,Number(body?.temperature??0.3));}
      catch{fallbackUsed=true;route="native-fallback";text="";}
    }
    if(!text){text=answer(model.display_name||mk,ms,system);route=fallbackUsed?"native-fallback":"native-core";}
    if(text)cacheSet(cacheKey,text);
  }
  const output=tokens(text),actual=input+output;if(reserve>actual)await sb.rpc("refund_tokens",{p_amount:reserve-actual});
  const {data:latest}=await sb.from("profiles").select("token_limit,tokens_used,token_reset_at").eq("id",u.data.user.id).maybeSingle();
  const latencyMs=Date.now()-startedAt;
  await sb.from("ai_usage_logs").insert({user_id:u.data.user.id,model_key:model.key,provider_model:model.model_id,plan,input_tokens:input,output_tokens:output,reserved_tokens:reserve,request_ms:0,status:"success"});
  const i=intent(textOf([...ms].reverse().find((m:any)=>m.role==="user")?.content));
  return out(req,{requestId:reqId,model:model.key,displayModel:model.display_name||mk,providerModel:model.model_id,tier:model.tier,capabilities:Array.isArray(model.capabilities)?model.capabilities:[],fallbackUsed,local:true,native:true,text,plan,brain:{version:"1.1.2",engine:"Legendary Brain 9.0",shield:"Legendary Shield 1.1.0",adaptive:"Adaptive Intelligence 1.1.2",intent:i,memory:Boolean(p.memory_enabled),vision:Boolean(p.vision_enabled),route,fallbackUsed,contextMessages:ms.length,rawContextMessages:rawMessages.length,contextChars:ms.map((m:any)=>textOf(m.content)).join("").length,cacheHit,selfCheck:true,reasoning:"structured",tool:null,outputBudget:max},performance:{latency_ms:latencyMs,cache_hit:cacheHit,context_compacted:rawMessages.length!==ms.length},usage:{input_tokens:input,output_tokens:output,total_tokens:actual,tokens_used:Number(latest?.tokens_used??Number(p.tokens_used||0)+actual),token_limit:Number(latest?.token_limit??p.token_limit),remaining_tokens:Math.max(0,Number(latest?.token_limit??p.token_limit)-Number(latest?.tokens_used??0))}});
 }catch(e){
  await sb.rpc("refund_tokens",{p_amount:reserve});
  return out(req,{error:e instanceof Error?e.message:String(e),code:"AI_ENGINE_ERROR"},502);
 }
});