const STOP_WORDS = new Set(['và','là','của','cho','một','những','the','and','or','to','of','in','a','an','is','are','this','that','with']);

export function detectIntent(text) {
  const x = String(text || '').trim().toLowerCase();
  if (!x) return 'empty';
  if (/^(hi|hello|hey|xin chào|chào)[!?. ]*$/i.test(x)) return 'greeting';
  if (/(?:^|\s)(?:vẽ|draw)(?:\s|$)/i.test(x) ||
      /(?:^|\s)(?:tạo|generate|create)(?:\s|$)/i.test(x) &&
      /(?:^|\s)(?:ảnh|hình|image|picture|illustration|art|wallpaper|avatar|logo|poster|thumbnail|photo|meme)(?:\s|$)/i.test(x)) return 'image';
  if (/^(tính|calculate|calc)\b|^[0-9+\-*/%(). x×÷\s]+$/.test(x)) return 'math';
  if (/(json|yaml|yml).*(format|formatted|định dạng|pretty|parse|valid)|((format|pretty|parse|validate|định dạng).*(json|yaml|yml))/i.test(x)) return 'utility';
  if (/\b(kg|g|gram|km|m|cm|mm|mile|mi|ft|inch|in|°c|°f|celsius|fahrenheit|litre|liter|l|ml)\b.*\b(to|sang|đổi|thành)\b/i.test(x) ||
      /\b(kg|g|gram|km|m|cm|mm|mile|mi|ft|inch|in|°c|°f|celsius|fahrenheit|litre|liter|l|ml)\b\s+in\s+\b(kg|g|gram|km|m|cm|mm|mile|mi|ft|inch|in|°c|°f|celsius|fahrenheit|litre|liter|l|ml)\b/i.test(x)) return 'utility';
  if (/(tóm tắt|tóm lược|summarize|summary|ý chính)/i.test(x)) return 'summarize';
  if (/(kế hoạch|plan|roadmap|lộ trình|từng bước|steps)/i.test(x)) return 'plan';
  if (/(so sánh|compare|khác nhau|difference|ưu.*nhược|trade.?off)/i.test(x)) return 'compare';
  if (/(dịch|translate|translation)/i.test(x)) return 'translate';
  if (/(giải thích|explain|tại sao|why|how does|là gì|what is)/i.test(x)) return 'explain';
  if (/(ý tưởng|brainstorm|gợi ý|ideas|đề xuất)/i.test(x)) return 'brainstorm';
  if (/(debug|bug|lỗi|error|fix|code review|sửa code|viết code|tạo code|lập trình|plugin|javascript|typescript|python|java|sql|html|css|supabase|api|sdk)/i.test(x)) return 'code';
  if (/(email|thư|tin nhắn|caption|bài viết|viết giúp|viết lại|rewrite|paraphrase|chỉnh sửa câu)/i.test(x)) return 'writing';
  return 'general';
}

export function safeMath(text) {
  const x = String(text || '').replace(/,/g, '.').replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/^(tính|calculate|calc)[: ]*/i, '').trim();
  if (!x || !/[0-9]/.test(x) || !/^[0-9+\-*/%().\s]+$/.test(x)) return null;
  try { const value = Function('"use strict";return (' + x + ')')(); return typeof value === 'number' && Number.isFinite(value) ? value : null; } catch (_) { return null; }
}

function tokenize(text) { return (String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(x => !STOP_WORDS.has(x)); }
function splitSentences(text) { return String(text || '').replace(/\r/g, '').split(/(?<=[.!?。！？])\s+|\n+/).map(s => s.trim()).filter(Boolean); }

export function extractiveSummary(text, maxSentences = 5) {
  const source = String(text || '').trim(); const sentences = splitSentences(source);
  if (!sentences.length) return ''; if (sentences.length <= maxSentences) return sentences.join('\n');
  const freq = new Map(); tokenize(source).forEach(t => freq.set(t, (freq.get(t) || 0) + 1));
  return sentences.map((sentence,index)=>{const words=tokenize(sentence);const score=words.reduce((sum,w)=>sum+(freq.get(w)||0),0)/Math.max(words.length,1);return{sentence,index,score};})
    .sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,maxSentences).sort((a,b)=>a.index-b.index).map(x=>x.sentence).join('\n');
}

function parseNumberUnit(text) {
  const m=String(text||'').trim().match(/(-?\d+(?:[.,]\d+)?)\s*(°?c|°?f|celsius|fahrenheit|kg|g|km|m|cm|mm|mi|mile|ft|inch|in|l|ml|s|sec|second|seconds|min|minute|minutes|h|hr|hour|hours)\s*(?:to|sang|đổi|thành|in)\s*(°?c|°?f|celsius|fahrenheit|kg|g|km|m|cm|mm|mi|mile|ft|inch|in|l|ml|s|sec|second|seconds|min|minute|minutes|h|hr|hour|hours)/i);
  return m?{value:Number(m[1].replace(',','.')),from:m[2].toLowerCase(),to:m[3].toLowerCase()}:null;
}
export function convertUnits(text) {
  const p=parseNumberUnit(text); if(!p) return null;
  const norm=u=>({kilogram:'kg',gram:'g',kilometers:'km',mile:'mi',miles:'mi',meter:'m',meters:'m',centimeter:'cm',millimeter:'mm',feet:'ft',foot:'ft',inches:'in',litre:'l',liter:'l',liters:'l',litres:'l',milliliter:'ml',milliliters:'ml',second:'s',seconds:'s',sec:'s',minute:'min',minutes:'min',hr:'h',hour:'h',hours:'h',c:'c',f:'f',celsius:'c',fahrenheit:'f'}[u]||u);
  const from=norm(p.from),to=norm(p.to),v=p.value;
  if(from==='c'||from==='f'){if(to!=='c'&&to!=='f')return null;const c=from==='c'?v:(v-32)*5/9;return Number((to==='c'?c:c*9/5+32).toFixed(6));}
  const factors={kg:1000,g:1,km:1000,m:1,cm:.01,mm:.001,mi:1609.344,ft:.3048,in:.0254,l:1000,ml:1,s:1,min:60,h:3600};
  if(!(from in factors)||!(to in factors))return null; return Number((v*factors[from]/factors[to]).toFixed(8));
}

function formatJson(text) {
  const raw=String(text||'').replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();
  const match=raw.match(/(?:format|pretty|parse|validate|định dạng)(?:\s+json)?\s*[:\-]?\s*([\[{][\s\S]*[\]}])$/i);
  const candidate=match?match[1]:((raw.startsWith('{')||raw.startsWith('['))?raw:''); if(!candidate)return null;
  try{return JSON.stringify(JSON.parse(candidate),null,2);}catch(_){return null;}
}

export function codeDiagnostics(text) {
  const raw=String(text||''),blocks=[...raw.matchAll(/```[a-zA-Z0-9+#_-]*\n?([\s\S]*?)```/g)].map(m=>m[1]);
  const code=blocks.join('\n')||(raw.includes('{')||raw.includes('function ')||raw.includes('def ')?raw:''); if(!code)return null;
  const issues=[]; for(const [a,b] of [['(',')'],['[',']'],['{','}']]){const balance=(code.split(a).length-1)-(code.split(b).length-1);if(balance!==0)issues.push('Dấu ngoặc '+a+b+' chưa cân bằng ('+balance+').');}
  if(/\bconsole\.log\(/.test(code)&&/production/i.test(raw))issues.push('Có console.log trong đoạn code được mô tả là production; nên thay bằng logger có kiểm soát.');
  if(/TODO|FIXME/.test(code))issues.push('Có TODO/FIXME chưa hoàn tất.');
  return issues.length?'Phát hiện nhanh:\n'+issues.map(x=>'- '+x).join('\n'):'Kiểm tra nhanh: chưa thấy lỗi cú pháp cân bằng ngoặc rõ ràng. Với lỗi logic/runtime, cần text model hoặc test thực thi để xác minh.';
}

export function buildModelSystemPrompt(basePrompt) {
  const base=String(basePrompt||'').trim();
  return [
    'You are LegendaryAI. Return only the final answer intended for the user.',
    'Never reveal hidden reasoning, internal routing, intent labels, keywords, constraints, token counts, backend details, or self-check logs.',
    'Do not claim to have used a tool, source, file, model, or capability unless it actually happened.',
    'If information is missing or uncertain, say what is missing and ask the smallest useful clarification.',
    'For code: provide runnable code when the request is sufficiently specified; otherwise ask for the missing environment/version.',
    'For factual claims: separate known facts from uncertainty and avoid invented specifics.',
    'For writing requests: return the finished text directly, without a preamble about your process.',
    'Prefer concise answers by default; expand when the user asks for detail.',
    base
  ].filter(Boolean).join('\n');
}

function nativeAnswerLegacy(text,messages=[]) {
  const p=String(text||'').trim(),intent=detectIntent(p); if(!p)return{intent:'empty',text:'Mình sẵn sàng. Hãy gửi yêu cầu cụ thể.'};
  if(intent==='greeting')return{intent,text:'Xin chào 👋 Mình là LegendaryAI. Bạn muốn làm gì hôm nay?'};
  if(intent==='math'){const value=safeMath(p);if(value!==null)return{intent,text:String(value)};}
  if(intent==='utility'){const json=formatJson(p);if(json)return{intent,text:json};const converted=convertUnits(p);if(converted!==null)return{intent,text:String(converted)};}
  if(intent==='image')return{intent,action:'image',text:'Mình đã nhận yêu cầu tạo ảnh. Hãy để Image Provider xử lý yêu cầu này.'};
  if(intent==='writing'&&/email.*nghỉ phép|xin nghỉ phép/i.test(p))return{intent,text:'Tiêu đề: Xin nghỉ phép\n\nKính gửi Anh/Chị,\n\nEm xin phép nghỉ vào [ngày/thời gian] vì [lý do]. Em sẽ chủ động hoàn thành hoặc bàn giao các công việc cần thiết trước thời gian nghỉ.\n\nMong Anh/Chị xem xét và phê duyệt. Em cảm ơn Anh/Chị.\n\nTrân trọng,\n[Tên]'};
  if(intent==='summarize'){const recent=messages.filter(m=>m&&(m.role==='user'||m.role==='ai'||m.role==='assistant')).slice(-8).map(m=>String(m.content||m.text||'').trim()).filter(Boolean);const explicit=p.replace(/^(tóm tắt|tóm lược|summarize|summary)[:\-]?/i,'').trim();const source=explicit.length>60?explicit:recent.join('\n');if(source){const summary=extractiveSummary(source,5);if(summary)return{intent,text:'Tóm tắt nhanh (extractive):\n'+summary};}}
  if(intent==='code'){const diagnostic=codeDiagnostics(p);if(diagnostic)return{intent,text:diagnostic};}
  if(intent==='plan')return{intent,text:'Kế hoạch nhanh:\n1. Xác định mục tiêu và tiêu chí hoàn thành.\n2. Chia việc thành các bước nhỏ, có đầu ra rõ ràng.\n3. Ưu tiên bước có rủi ro/phụ thuộc cao trước.\n4. Thực hiện và kiểm tra từng mốc; ghi lại lỗi và quyết định.\n5. Tổng kiểm tra, tối ưu và chốt bước tiếp theo.\n\nĐể lập kế hoạch cụ thể, hãy gửi mục tiêu, deadline và các ràng buộc chính.'};
  if(intent==='compare')return{intent,text:'Khung so sánh nhanh:\n- Mục tiêu: hai lựa chọn cần đạt điều gì?\n- Chi phí: tiền, thời gian, tài nguyên.\n- Hiệu năng: tốc độ, độ ổn định, khả năng mở rộng.\n- Rủi ro: điểm thất bại và mức độ phục hồi.\n- Phù hợp: lựa chọn nào đáp ứng các ràng buộc thực tế của bạn.\n\nGửi hai phương án cụ thể để mình điền bảng so sánh.'};
  return{intent,text:'Yêu cầu này cần một text model để tạo câu trả lời đáng tin cậy. Hiện LegendaryAI chưa có text model local được bật, nên mình không muốn giả vờ đã suy luận hoặc bịa nội dung. Fast Native Core hiện hỗ trợ greeting, tính toán, chuyển đổi đơn vị, JSON formatting, tóm tắt extractive, code diagnostics, lập kế hoạch và khung so sánh; khi local inference gateway được bật, các tác vụ ngôn ngữ mở sẽ được chuyển sang model thật.'};
}

const NATIVE_TOOL_ALLOWLIST = new Set(['safe_math','unit_convert','json_format','extractive_summary','code_diagnostics','safe_template']);
const AGENT_INTENTS = new Set(['math','utility','summarize','code','writing','greeting','image','plan','compare']);

export function createNativePlan(text, messages = []) {
  const prompt = String(text || '').trim();
  const intent = detectIntent(prompt);
  const steps = [];
  if (intent === 'math') steps.push({id:'s1',tool:'safe_math',goal:'Resolve arithmetic safely'});
  else if (intent === 'utility') {
    if (/(json|yaml|yml)/i.test(prompt)) steps.push({id:'s1',tool:'json_format',goal:'Parse or format structured data'});
    else steps.push({id:'s1',tool:'unit_convert',goal:'Convert the requested unit'});
  } else if (intent === 'summarize') steps.push({id:'s1',tool:'extractive_summary',goal:'Extract the highest-signal sentences'});
  else if (intent === 'code') steps.push({id:'s1',tool:'code_diagnostics',goal:'Run bounded static diagnostics'});
  else if (intent === 'writing' && /email.*nghỉ phép|xin nghỉ phép/i.test(prompt)) steps.push({id:'s1',tool:'safe_template',goal:'Use the bounded leave-email template'});
  else if (AGENT_INTENTS.has(intent)) steps.push({id:'s1',tool:'native_answer',goal:'Generate a bounded Native Core response'});
  else steps.push({id:'s1',tool:'model_required',goal:'Use a configured text model for open-ended generation'});
  return {
    version:'12.0',
    intent,
    mode: steps[0]?.tool === 'model_required' ? 'model' : 'native-tools',
    steps: steps.map(s => ({...s, allowed:NATIVE_TOOL_ALLOWLIST.has(s.tool) || s.tool === 'native_answer' ? 'bounded' : 'model'})),
    contextMessages:Array.isArray(messages) ? messages.length : 0
  };
}

function executeNativeTool(tool, prompt, messages = []) {
  if (!NATIVE_TOOL_ALLOWLIST.has(tool)) return {text:'', tool, error:'TOOL_NOT_ALLOWED'};
  if (tool === 'safe_math') {
    const value = safeMath(prompt);
    return value === null ? {text:'', tool, error:'MATH_UNRESOLVED'} : {text:String(value), tool};
  }
  if (tool === 'unit_convert') {
    const value = convertUnits(prompt);
    return value === null ? {text:'', tool, error:'UNIT_UNRESOLVED'} : {text:String(value), tool};
  }
  if (tool === 'json_format') {
    const value = formatJson(prompt);
    return value === null ? {text:'', tool, error:'JSON_UNRESOLVED'} : {text:value, tool};
  }
  if (tool === 'extractive_summary') {
    const explicit=prompt.replace(/^(tóm tắt|tóm lược|summarize|summary)[:\-]?/i,'').trim();
    const recent=messages.filter(m=>m&&(m.role==='user'||m.role==='ai'||m.role==='assistant')).slice(-8).map(m=>String(m.content||m.text||'').trim()).filter(Boolean);
    const source=explicit.length>60?explicit:recent.join('\n');
    const value=source?extractiveSummary(source,5):'';
    return value?{text:'Tóm tắt nhanh (extractive):\n'+value,tool}:{text:'',tool,error:'SUMMARY_UNRESOLVED'};
  }
  if (tool === 'code_diagnostics') {
    const value=codeDiagnostics(prompt);
    return value?{text:value,tool}:{text:'',tool,error:'CODE_UNRESOLVED'};
  }
  if (tool === 'safe_template') {
    return {text:'Tiêu đề: Xin nghỉ phép\n\nKính gửi Anh/Chị,\n\nEm xin phép nghỉ vào [ngày/thời gian] vì [lý do]. Em sẽ chủ động hoàn thành hoặc bàn giao các công việc cần thiết trước thời gian nghỉ.\n\nMong Anh/Chị xem xét và phê duyệt. Em cảm ơn Anh/Chị.\n\nTrân trọng,\n[Tên]',tool};
  }
  return {text:'',tool,error:'NO_NATIVE_EXECUTOR'};
}

function verifyNativeResult(plan, result) {
  const text = String(result?.text || '').trim();
  const checks = [
    {name:'non_empty',pass:Boolean(text)},
    {name:'bounded_tool',pass:NATIVE_TOOL_ALLOWLIST.has(plan.tool) || plan.tool === 'native_answer'},
    {name:'math_finite',pass:plan.tool!=='safe_math' || /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)}
  ];
  return {passed:checks.every(x=>x.pass),checks};
}

export function nativeAgent(text, messages = []) {
  const plan = createNativePlan(text, messages);
  const started = Date.now();
  const result = plan.mode === 'native-tools'
    ? (plan.steps[0]?.tool === 'native_answer'
      ? nativeAnswerLegacy(text, messages)
      : executeNativeTool(plan.steps[0]?.tool, String(text||''), messages))
    : nativeAnswerLegacy(text, messages);
  const verification = verifyNativeResult({tool:plan.steps[0]?.tool}, result);
  if (!verification.passed && plan.mode === 'native-tools') {
    const fallback = nativeAnswerLegacy(text, messages);
    return {
      ...fallback,
      agent:{version:'12.0',plan,verification,executorFallback:true,latency_ms:Date.now()-started}
    };
  }
  return {...result,agent:{version:'12.0',plan,verification,latency_ms:Date.now()-started}};
}

export function nativeAnswer(text, messages = []) {
  return nativeAgent(text, messages);
}
