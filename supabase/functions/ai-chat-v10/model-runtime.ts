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
