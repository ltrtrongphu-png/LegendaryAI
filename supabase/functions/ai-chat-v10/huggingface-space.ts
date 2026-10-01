import { modelError, requestId } from "./model-runtime.ts";

const TIMEOUT_MS=Number(Deno.env.get("HF_SPACE_TIMEOUT_MS")||"20000");
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

type ChatMessage={role:"system"|"user"|"assistant";content:string};

function baseUrl(){
  const v=Deno.env.get("HF_SPACE_URL")||"";
  return v.replace(/\/$/,"");
}
function apiKey(){
  const env=Deno.env.get("HF_SPACE_API_KEY_ENV")||"HF_TOKEN";
  return Deno.env.get(env)||Deno.env.get("HF_TOKEN")||"";
}
function headers(){
  const h:Record<string,string>={"Content-Type":"application/json"};
  const k=apiKey(); if(k) h.Authorization="Bearer "+k;
  return h;
}
function fetchWithTimeout(url:string,init:RequestInit){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),TIMEOUT_MS);
  return fetch(url,{...init,signal:c.signal}).finally(()=>clearTimeout(timer));
}

export async function hfHealth(){
  const url=baseUrl(); if(!url) return {status:"offline" as const,latency_ms:0,detail:"HF_SPACE_URL missing"};
  const started=Date.now();
  try{
    const r=await fetchWithTimeout(url+"/gradio_api/info",{method:"GET",headers:headers()});
    const body=await r.text();
    if(!r.ok) return {status:"degraded" as const,latency_ms:Date.now()-started,detail:"HTTP "+r.status};
    return {status:"ready" as const,latency_ms:Date.now()-started,detail:body.slice(0,500)};
  }catch(e){
    return {status:"offline" as const,latency_ms:Date.now()-started,detail:String(e)};
  }
}

function parseOpenAI(body:any){
  const text=String(body?.choices?.[0]?.message?.content||body?.choices?.[0]?.text||"").trim();
  if(!text) throw modelError("MODEL_INVALID_RESPONSE","Hugging Face Space returned no text.");
  return text;
}

async function openAIChat(messages:ChatMessage[],model:string,max:number,temp:number){
  const url=baseUrl(); if(!url) throw modelError("MODEL_UNAVAILABLE","Hugging Face Space is not configured.");
  const r=await fetchWithTimeout(url+"/v1/chat/completions",{method:"POST",headers:headers(),body:JSON.stringify({
    model, messages, stream:false, temperature:temp, max_tokens:max
  })});
  const raw=await r.text();
  if(r.status===401||r.status===403) throw modelError("MODEL_AUTH_FAILED","Hugging Face Space authentication failed.");
  if(r.status===408||r.status===504) throw modelError("MODEL_TIMEOUT","Hugging Face Space timed out.");
  if(r.status===429) throw modelError("MODEL_OVERLOADED","Hugging Face Space is overloaded.");
  if(!r.ok) throw modelError("MODEL_UNAVAILABLE","Hugging Face Space HTTP "+r.status,raw.slice(0,500));
  try{return parseOpenAI(raw?JSON.parse(raw):null)}catch(e){throw (e as any)?.code?e:modelError("MODEL_INVALID_RESPONSE","Invalid Hugging Face Space response.",raw.slice(0,500))}
}

async function gradioChat(messages:ChatMessage[],max:number,temp:number){
  const url=baseUrl(),fn=Deno.env.get("HF_SPACE_API_NAME")||"";
  if(!url||!fn) throw modelError("MODEL_UNAVAILABLE","HF Gradio endpoint is not configured.");
  const prompt=messages.filter(m=>m.role!=="system").map(m=>m.role+": "+m.content).join("\n");
  const payloadRaw=Deno.env.get("HF_SPACE_GRADIO_DATA_JSON");
  let data:any[]=[prompt];
  if(payloadRaw){try{data=JSON.parse(payloadRaw)}catch{throw modelError("MODEL_INVALID_RESPONSE","HF_SPACE_GRADIO_DATA_JSON is invalid JSON.")}}
  const start=await fetchWithTimeout(url+"/gradio_api/call/"+encodeURIComponent(fn),{
    method:"POST",headers:headers(),body:JSON.stringify({data,session_hash:requestId().replace(/-/g,"")})
  });
  const startRaw=await start.text();
  if(!start.ok) throw modelError(start.status===429?"MODEL_OVERLOADED":"MODEL_UNAVAILABLE","Hugging Face Gradio call failed.",startRaw.slice(0,500));
  let eventId="";
  try{eventId=JSON.parse(startRaw)?.event_id||""}catch{}
  if(!eventId) throw modelError("MODEL_INVALID_RESPONSE","Hugging Face Gradio did not return an event id.");
  const result=await fetchWithTimeout(url+"/gradio_api/call/"+encodeURIComponent(fn)+"/"+encodeURIComponent(eventId),{method:"GET",headers:{...headers(),Accept:"text/event-stream"}});
  const raw=await result.text();
  if(!result.ok) throw modelError("MODEL_UNAVAILABLE","Hugging Face Gradio event failed.",raw.slice(0,500));
  const lines=raw.split("\n").filter(Boolean).reverse();
  for(const line of lines){
    if(!line.startsWith("data:")) continue;
    const d=line.slice(5).trim(); if(!d||d==="null") continue;
    try{
      const parsed=JSON.parse(d);
      if(Array.isArray(parsed)){
        const text=String(parsed.find((x:any)=>typeof x==="string"&&x.trim())||"").trim();
        if(text)return text;
      }
      if(typeof parsed==="string"&&parsed.trim())return parsed.trim();
    }catch{}
  }
  throw modelError("MODEL_INVALID_RESPONSE","Hugging Face Gradio returned no text.");
}

export async function huggingFaceChat(messages:ChatMessage[],model:string,max:number,temp:number){
  const protocol=(Deno.env.get("HF_SPACE_PROTOCOL")||"openai-compatible").toLowerCase();
  return protocol==="gradio"?gradioChat(messages,max,temp):openAIChat(messages,model,max,temp);
}
