const EMOTION_PATTERNS = [
  ['frustration', /(không chạy|không được|lỗi|bug|failed|fail|bực|ức chế|mệt|đéo|vl|wtf|why doesn't|why won't)/i],
  ['confusion', /(không hiểu|chưa hiểu|khó hiểu|what do you mean|hả|sao vậy|giải thích lại)/i],
  ['anxiety', /(lo|sợ|worried|anxious|rủi ro|nguy cơ|có mất|có sao không)/i],
  ['disappointment', /(thất vọng|disappointed|tệ quá|không như mong đợi)/i],
  ['sadness', /(buồn|buồn quá|sad|chán|mất mát)/i],
  ['anger', /(tức|giận|angry|đm|đụ|đéo|fuck|shit)/i],
  ['excitement', /(quá đã|tuyệt|yay|awesome|excited|🔥|🎉)/i],
  ['gratitude', /(cảm ơn|thanks|thank you|biết ơn)/i],
  ['joy', /(vui|happy|hài lòng|tốt quá|nice)/i]
];

const SARCASM_PATTERNS = [
  /ừs*hays*quá/i,
  /tuyệts*vờis*quás*ha/i,
  /hays*quás*nhỉ/i,
  /đỉnhs*quás*nhỉ/i,
  /wows*giỏis*quá/i,
  /👏s*👏/i
];

const STOP = new Set(['và','là','của','cho','một','những','the','and','or','to','of','in','a','an','is','are','this','that','with','tôi','mình','bạn']);

function tokens(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(x => !STOP.has(x));
}

export function analyzeEmotion(text, context = {}) {
  const input = String(text || '').trim();
  const hits = EMOTION_PATTERNS.filter(([, re]) => re.test(input)).map(([emotion]) => emotion);
  const sarcasm = SARCASM_PATTERNS.some(re => re.test(input));
  let primary = hits[0] || 'neutral';
  if (sarcasm && primary === 'neutral') primary = 'sarcasm-likely';
  const intensity = Math.min(1, (hits.length ? 0.35 + hits.length * 0.16 : 0.08) + (/[!?]{2,}/.test(input) ? 0.15 : 0) + (/[A-ZÀ-Ỹ]{5,}/.test(input) ? 0.08 : 0));
  const confidence = primary === 'neutral' ? 0.72 : Math.min(0.96, 0.58 + hits.length * 0.1 + (sarcasm ? 0.08 : 0));
  return {
    primary,
    secondary: [...new Set(hits.filter(x => x !== primary))].slice(0, 2),
    intensity: Number(intensity.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    sarcasm_likelihood: sarcasm ? 0.78 : 0.04,
    source: hits.length || sarcasm ? 'linguistic-signal' : 'default-neutral',
    contextual: Boolean(context?.previousEmotion || context?.recentMessages)
  };
}

export function resolveContext(text, messages = []) {
  const input = String(text || '').trim();
  const recent = Array.isArray(messages) ? messages.slice(-8).filter(Boolean) : [];
  const priorUser = recent.filter(m => m.role === 'user').map(m => String(m.content ?? m.text ?? '').trim()).filter(Boolean);
  const previous = priorUser.at(-1) || '';
  const references = [];
  if (/\b(nó|cái đó|cái này|việc đó|vừa nói|that|it|this|the first one|the second one)\b/i.test(input) && previous) {
    references.push({expression: input.match(/\b(nó|cái đó|cái này|việc đó|vừa nói|that|it|this|the first one|the second one)\b/i)?.[0] || 'reference', target: previous.slice(0, 240), confidence: 0.74});
  }
  const topicTokens = tokens([...priorUser.slice(-3), input].join(' '));
  const counts = new Map();
  topicTokens.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
  const topics = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([term])=>term);
  return {
    activeTask: input || null,
    previousUserMessage: previous || null,
    references,
    recentGoal: priorUser[0] || null,
    topics,
    continuity: previous ? Math.min(1, 0.35 + topics.length * 0.1) : 0
  };
}

const INTENT_RULES = [
  ['image', /(?:vẽ|draw|tạo|generate|create).*(?:ảnh|hình|image|picture|illustration|art|wallpaper|avatar|logo|poster|thumbnail|photo|meme)|(?:^|\s)(?:vẽ|draw)(?:\s|$)/i],
  ['math', /^(?:tính|calculate|calc)\b|^[0-9+\-*/%(). x×÷\s]+$/i],
  ['utility', /(json|yaml|yml).*(format|formatted|định dạng|pretty|parse|valid)|((format|pretty|parse|validate|định dạng).*(json|yaml|yml))|\b(?:kg|g|gram|km|m|cm|mm|mile|mi|ft|inch|in|°c|°f|celsius|fahrenheit|litre|liter|l|ml)\b.*\b(?:to|sang|đổi|thành|in)\b/i],
  ['summarize', /(tóm tắt|tóm lược|summarize|summary|ý chính)/i],
  ['plan', /(kế hoạch|plan|roadmap|lộ trình|từng bước|steps)/i],
  ['compare', /(so sánh|compare|khác nhau|difference|ưu.*nhược|trade.?off)/i],
  ['translate', /(dịch|translate|translation)/i],
  ['explain', /(giải thích|explain|tại sao|why|how does|là gì|what is)/i],
  ['brainstorm', /(ý tưởng|brainstorm|gợi ý|ideas|đề xuất)/i],
  ['code', /(debug|bug|lỗi|error|fix|code review|sửa code|viết code|tạo code|lập trình|plugin|javascript|typescript|python|java|sql|html|css|supabase|api|sdk)/i],
  ['writing', /(email|thư|tin nhắn|caption|bài viết|viết giúp|viết lại|rewrite|paraphrase|chỉnh sửa câu)/i],
  ['greeting', /^(hi|hello|hey|xin chào|chào)[!?. ]*$/i]
];

export function rankIntentCandidates(text, context = {}) {
  const input = String(text || '').trim();
  if (!input) return [{intent:'empty', confidence:1, evidence:['empty-input']}];
  const results = [];
  for (const [intent, rule] of INTENT_RULES) {
    if (rule.test(input)) {
      const evidence = [`pattern:${intent}`];
      let confidence = 0.68;
      if (intent === 'code' && context?.topics?.some(t => ['code','javascript','python','supabase','api'].includes(t))) confidence += 0.12;
      if (intent === 'writing' && /email|caption|bài viết/i.test(input)) confidence += 0.1;
      results.push({intent, confidence: Math.min(0.94, Number(confidence.toFixed(2))), evidence});
    }
  }
  if (!results.length) return [{intent:'general', confidence:0.45, evidence:['no-specialized-rule']}];
  results.sort((a,b)=>b.confidence-a.confidence);
  return results;
}

export function buildCognitivePlan(text, messages = [], options = {}) {
  const context = resolveContext(text, messages);
  const emotion = analyzeEmotion(text, context);
  const candidates = rankIntentCandidates(text, context);
  const top = candidates[0];
  const ambiguous = candidates.length > 1 && Math.abs(candidates[0].confidence - candidates[1].confidence) < 0.08;
  return {
    version:'2.0',
    goal:String(text || '').trim(),
    intent: top.intent,
    intent_confidence: top.confidence,
    candidates,
    ambiguous,
    needs_clarification: top.intent === 'general' && String(text || '').trim().length < 18,
    emotion,
    context,
    constraints: {
      bounded: true,
      max_steps: Number(options.max_steps || 4),
      preserve_truthful_capability: true
    }
  };
}

export function composeTone(cognitive, mode = 'General') {
  const e = cognitive?.emotion?.primary || 'neutral';
  if (e === 'frustration' || e === 'anger') return {tone:'calm-direct', empathy_level:0.78, verbosity:'concise'};
  if (e === 'confusion' || e === 'anxiety') return {tone:'reassuring-clear', empathy_level:0.68, verbosity:'clear'};
  if (e === 'sadness' || e === 'disappointment') return {tone:'warm-supportive', empathy_level:0.72, verbosity:'gentle'};
  if (e === 'excitement' || e === 'joy' || e === 'gratitude') return {tone:'positive-natural', empathy_level:0.45, verbosity:'normal'};
  if (cognitive?.emotion?.sarcasm_likelihood > 0.6) return {tone:'literal-light', empathy_level:0.35, verbosity:'concise'};
  if (mode === 'Coding' || mode === 'Debug & Fix') return {tone:'technical-direct', empathy_level:0.25, verbosity:'structured'};
  return {tone:'neutral-helpful', empathy_level:0.2, verbosity:'normal'};
}

export function applyEmpathyPrefix(text, cognitive) {
  const value = String(text || '');
  if (!value) return value;
  const e = cognitive?.emotion?.primary;
  if (e === 'frustration' || e === 'anger') return `Mình hiểu, lỗi kiểu này khá khó chịu. ${value}`;
  if (e === 'confusion') return `Không sao, mình tách vấn đề ra cho dễ hiểu nhé. ${value}`;
  if (e === 'anxiety') return `Mình sẽ nói rõ phần chắc chắn và phần còn phụ thuộc nhé. ${value}`;
  return value;
}

export function cognitiveProcess(text, messages = [], options = {}) {
  const plan = buildCognitivePlan(text, messages, options);
  return {
    ...plan,
    response: {
      tone: composeTone(plan, options.mode || 'General'),
      answer: null,
      confidence: plan.intent_confidence
    }
  };
}
