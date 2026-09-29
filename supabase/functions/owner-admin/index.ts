import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS=new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

function cors(req:Request){
  const origin=req.headers.get("origin")||"";
  return {
    "Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"https://legendaryai.vercel.app",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials":"true",
    Vary:"Origin"
  };
}
function out(req:Request,body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8",...cors(req)}
  });
}
function cleanKey(v:unknown){
  return String(v||"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"-").replace(/-+/g,"-").slice(0,48);
}
function positiveInt(v:unknown,fallback:number,min=1,max=2147483647){
  const n=Number(v);
  if(!Number.isFinite(n)) return fallback;
  return Math.min(max,Math.max(min,Math.floor(n)));
}
function jsonObject(v:unknown,fallback:Record<string,unknown>={}){
  return v && typeof v==="object" && !Array.isArray(v) ? v as Record<string,unknown> : fallback;
}
function jsonArray(v:unknown,fallback:unknown[]=[]){
  return Array.isArray(v) ? v : fallback;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST") return out(req,{error:"Method not allowed"},405);

  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return out(req,{error:"Server configuration missing",code:"SERVER_CONFIG"},503);

  const auth=req.headers.get("Authorization")||"";
  const token=auth.replace(/^Bearer\s+/i,"");
  if(!token) return out(req,{error:"Unauthorized"},401);

  const admin=createClient(url,key);
  const {data:authData,error:authError}=await admin.auth.getUser(token);
  if(authError||!authData.user) return out(req,{error:"Unauthorized"},401);

  const {data:owner,error:ownerError}=await admin.from("profiles").select("id,role").eq("id",authData.user.id).maybeSingle();
  if(ownerError||owner?.role!=="owner") return out(req,{error:"Owner access required",code:"OWNER_ONLY"},403);

  let body:any;
  try{body=await req.json()}catch{return out(req,{error:"Invalid JSON"},400)}
  const action=String(body?.action||"list_plans");

  if(action==="list_plans"){
    const {data,error}=await admin.from("plans").select("*").order("priority",{ascending:false}).order("created_at",{ascending:true});
    if(error) return out(req,{error:error.message},500);
    return out(req,{plans:data||[]});
  }

  if(action==="create_plan"){
    const keyValue=cleanKey(body?.key);
    const name=String(body?.name||"").trim().slice(0,120);
    if(!keyValue||!name) return out(req,{error:"key và name là bắt buộc"},400);
    const payload={
      key:keyValue,
      name,
      description:String(body?.description||"").trim().slice(0,500),
      price_vnd:Math.max(0,Math.floor(Number(body?.price_vnd)||0)),
      billing_period:String(body?.billing_period||"month").slice(0,32),
      token_limit:positiveInt(body?.token_limit,500000,1,2147483647),
      reset_hours:positiveInt(body?.reset_hours,6,1,720),
      reasoning_tier:String(body?.reasoning_tier||"basic").slice(0,32),
      default_model_key:String(body?.default_model_key||"legendary-lite-1").slice(0,120),
      model_tiers:jsonArray(body?.model_tiers,["free"]),
      capabilities:jsonObject(body?.capabilities,{}),
      features:jsonArray(body?.features,[]),
      enabled:body?.enabled!==false,
      priority:Number.isFinite(Number(body?.priority))?Math.floor(Number(body.priority)):0
    };
    const {data,error}=await admin.from("plans").insert(payload).select("*").single();
    if(error) return out(req,{error:error.message,code:"PLAN_CREATE_FAILED"},400);
    return out(req,{plan:data});
  }

  if(action==="update_plan"){
    const id=String(body?.id||"");
    if(!id) return out(req,{error:"plan id is required"},400);
    const patch:any={updated_at:new Date().toISOString()};
    const fields=["name","description","billing_period","reasoning_tier","default_model_key","enabled"];
    for(const field of fields) if(body[field]!==undefined) patch[field]=String(body[field]).trim();
    if(body.price_vnd!==undefined) patch.price_vnd=Math.max(0,Math.floor(Number(body.price_vnd)||0));
    if(body.token_limit!==undefined) patch.token_limit=positiveInt(body.token_limit,500000,1,2147483647);
    if(body.reset_hours!==undefined) patch.reset_hours=positiveInt(body.reset_hours,6,1,720);
    if(body.priority!==undefined) patch.priority=Math.floor(Number(body.priority)||0);
    if(body.model_tiers!==undefined) patch.model_tiers=jsonArray(body.model_tiers);
    if(body.capabilities!==undefined) patch.capabilities=jsonObject(body.capabilities);
    if(body.features!==undefined) patch.features=jsonArray(body.features);
    const {data,error}=await admin.from("plans").update(patch).eq("id",id).select("*").single();
    if(error) return out(req,{error:error.message,code:"PLAN_UPDATE_FAILED"},400);
    return out(req,{plan:data});
  }

  if(action==="delete_plan"){
    const id=String(body?.id||"");
    if(!id) return out(req,{error:"plan id is required"},400);
    const {data:plan}=await admin.from("plans").select("id,key").eq("id",id).maybeSingle();
    if(!plan) return out(req,{error:"Plan not found"},404);
    const {count:profileCount}=await admin.from("profiles").select("id",{count:"exact",head:true}).eq("plan_id",id);
    if(Number(profileCount||0)>0) return out(req,{error:"Không thể xoá gói đang được người dùng sử dụng. Hãy tắt gói hoặc chuyển người dùng sang gói khác trước.",code:"PLAN_IN_USE"},409);
    const {count:orderCount}=await admin.from("orders").select("id",{count:"exact",head:true}).eq("plan",plan.key);
    if(Number(orderCount||0)>0) return out(req,{error:"Không thể xoá gói đã có lịch sử đơn hàng. Hãy tắt gói thay vì xoá.",code:"PLAN_HAS_HISTORY"},409);
    const {error}=await admin.from("plans").delete().eq("id",id);
    if(error) return out(req,{error:error.message,code:"PLAN_DELETE_FAILED"},400);
    return out(req,{success:true});
  }

  if(action==="list_users"){
    const page=positiveInt(body?.page,1,1,100000),perPage=positiveInt(body?.perPage,50,1,100);
    const {data,error}=await admin.auth.admin.listUsers({page,perPage});
    if(error) return out(req,{error:error.message},500);
    const users=data?.users||[];
    const ids=users.map((u:any)=>u.id);
    const {data:profiles}=ids.length
      ? await admin.from("profiles").select("id,display_name,role,plan,plan_id,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled,web_search_enabled,created_at,updated_at").in("id",ids)
      : {data:[]};
    const map=new Map((profiles||[]).map((p:any)=>[p.id,p]));
    return out(req,{users:users.map((u:any)=>({id:u.id,email:u.email,created_at:u.created_at,last_sign_in_at:u.last_sign_in_at,is_anonymous:u.is_anonymous===true,profile:map.get(u.id)||null})),page,perPage});
  }

  if(action==="update_user"){
    const userId=String(body?.user_id||"");
    if(!userId) return out(req,{error:"user_id is required"},400);
    const {data:target}=await admin.from("profiles").select("id,role,plan_id,tokens_used").eq("id",userId).maybeSingle();
    if(!target) return out(req,{error:"Profile not found"},404);
    if(target.role==="owner" && userId!==authData.user.id) return out(req,{error:"Không thể sửa tài khoản Owner khác bằng giao diện này."},403);

    const patch:any={updated_at:new Date().toISOString()};
    if(body.display_name!==undefined) patch.display_name=String(body.display_name).trim().slice(0,120);

    if(body.plan_key!==undefined){
      const planKey=cleanKey(body.plan_key);
      const {data:plan}=await admin.from("plans").select("id,key,token_limit,reset_hours,enabled").eq("key",planKey).maybeSingle();
      if(!plan||(!plan.enabled&&target.plan_id!==plan.id)) return out(req,{error:"Gói không tồn tại hoặc đang tắt."},400);
      patch.plan_id=plan.id;
      patch.plan=plan.key;
      patch.token_limit=positiveInt(body.token_limit,Number(plan.token_limit),1,2147483647);
      patch.tokens_used=0;
      patch.token_reset_at=new Date(Date.now()+Number(plan.reset_hours||6)*3600000).toISOString();
    }

    if(body.token_limit!==undefined && body.plan_key===undefined) patch.token_limit=positiveInt(body.token_limit,500000,1,2147483647);
    if(body.tokens_delta!==undefined) patch.tokens_used=Math.max(0,Number(target.tokens_used||0)+Math.floor(Number(body.tokens_delta)||0));
    if(body.reset_tokens===true){
      const {data:plan}=await admin.from("plans").select("reset_hours").eq("id",target.plan_id).maybeSingle();
      patch.tokens_used=0;
      patch.token_reset_at=new Date(Date.now()+Number(plan?.reset_hours||6)*3600000).toISOString();
    }

    const {data,error}=await admin.from("profiles").update(patch).eq("id",userId).select("id,display_name,role,plan,plan_id,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled,web_search_enabled,created_at,updated_at").single();
    if(error) return out(req,{error:error.message,code:"USER_UPDATE_FAILED"},400);
    return out(req,{profile:data});
  }

  return out(req,{error:"Unknown action",code:"UNKNOWN_ACTION"},400);
});
