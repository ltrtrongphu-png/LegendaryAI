import { createClient } from "npm:@supabase/supabase-js@2";
const ORIGINS = new Set(["https://legendaryai.vercel.app","https://www.legendaryai.vercel.app","http://localhost:3000","http://127.0.0.1:3000"]);
const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
if (siteUrl) ORIGINS.add(siteUrl);
const buckets = new Map<string, { started: number; count: number }>();

function json(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get("origin") || "";
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
    ...(ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin}:{}),
    "Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Vary":"Origin"
  }});
}

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(origin&&!ORIGINS.has(origin))return json(req,{error:"Origin not allowed",code:"ORIGIN_NOT_ALLOWED"},403);
 if(req.method==="OPTIONS")return new Response("ok",{headers:{"Content-Type":"application/json",...(ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",Vary:"Origin"}});
 if(req.method!=="POST")return json(req,{error:"Method not allowed"},405);
 const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!key)return json(req,{error:"Server configuration missing"},503);
 let body:any;
 try{const raw=await req.text();if(raw.length>20000)return json(req,{error:"Message too large"},413);body=JSON.parse(raw);}catch{return json(req,{error:"Invalid JSON"},400);}
 const email=String(body?.email||"").trim().toLowerCase(),topic=String(body?.topic||"other"),message=String(body?.message||"").trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return json(req,{error:"Email không hợp lệ."},400);
 if(!["privacy","billing","bug","abuse","other"].includes(topic))return json(req,{error:"Chủ đề không hợp lệ."},400);
 if(message.length<15||message.length>15000)return json(req,{error:"Nội dung cần từ 15 đến 15.000 ký tự."},400);
 const ip=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim().slice(0,80)||"unknown";
 const now=Date.now(),prev=buckets.get(ip);
 if(!prev||now-prev.started>=900000)buckets.set(ip,{started:now,count:1});
 else {prev.count++;if(prev.count>4)return json(req,{error:"Bạn đã gửi quá nhiều yêu cầu. Hãy thử lại sau.",code:"RATE_LIMITED"},429);}
 if(buckets.size>2000)for(const [k,v] of buckets)if(now-v.started>900000)buckets.delete(k);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 let userId:string|null=null;
 const authorization=req.headers.get("Authorization")||"";
 if(authorization){
  const {data,error}=await admin.auth.getUser(authorization.replace(/^Bearer\s+/i,""));
  if(error||!data.user)return json(req,{error:"Unauthorized"},401);
  userId=data.user.id;
 }
 const {data,error}=await admin.from("support_requests").insert({user_id:userId,contact_email:email,topic,message}).select("id,created_at").single();
 if(error||!data){console.error("support request insert failed");return json(req,{error:"Không thể ghi nhận yêu cầu. Vui lòng thử lại sau."},500);}
 return json(req,{ok:true,ticket_id:data.id,created_at:data.created_at,message:"Đã ghi nhận yêu cầu trong hàng chờ hỗ trợ. Email phản hồi tự động chưa được cấu hình."},201);
});
