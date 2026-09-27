export function detectIntent(text) {
  const x = String(text || '').trim().toLowerCase();
  if (!x) return 'empty';
  if (/^(hi|hello|hey|xin chào|chào)(\s|!|\?|$)/i.test(x)) return 'greeting';
  if (/(tạo|vẽ|generate|draw|image|ảnh|hình|logo|wallpaper|avatar).*(ảnh|image|hình|logo|wallpaper|avatar|con mèo|cat|dog)|^(tạo|vẽ|generate|draw)\s+(ảnh|image|hình)/i.test(x)) return 'image';
  if (/^(tính|calculate|calc)\b|^[0-9+\-*/%(). x×÷]+$/.test(x)) return 'math';
  if (/(debug|bug|lỗi|error|fix|code review|sửa code|viết code|tạo code|lập trình|plugin|javascript|typescript|python|java|sql|html|css|supabase|api|sdk)/i.test(x)) return 'code';
  if (/(email|thư|tin nhắn|caption|bài viết|viết giúp|viết lại|rewrite|paraphrase|chỉnh sửa câu)/i.test(x)) return 'writing';
  if (/(tóm tắt|tóm lược|summarize|summary|ý chính)/i.test(x)) return 'summarize';
  if (/(dịch|translate|translation)/i.test(x)) return 'translate';
  if (/(kế hoạch|plan|roadmap|lộ trình|từng bước|steps)/i.test(x)) return 'plan';
  if (/(so sánh|compare|khác nhau|difference|ưu.*nhược|trade.?off)/i.test(x)) return 'compare';
  if (/(giải thích|explain|tại sao|why|how does|là gì|what is)/i.test(x)) return 'explain';
  if (/(ý tưởng|brainstorm|gợi ý|ideas|đề xuất)/i.test(x)) return 'brainstorm';
  return 'general';
}

export function safeMath(text) {
  const x = String(text || '').replace(/,/g, '.').replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/^(tính|calculate|calc)[: ]*/i, '').trim();
  if (!x || !/[0-9]/.test(x) || !/^[0-9+\-*/%().\s]+$/.test(x)) return null;
  try {
    const value = Function('"use strict";return (' + x + ')')();
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch (_) { return null; }
}

export function buildModelSystemPrompt(basePrompt) {
  const base = String(basePrompt || '').trim();
  return [
    'You are LegendaryAI. Return only the final answer intended for the user.',
    'Never reveal chain-of-thought, hidden reasoning, internal routing, intent labels, keywords, constraints, token counts, backend details, or self-check logs.',
    'Do not claim to have used a tool, source, file, model, or capability unless it actually happened.',
    'If information is missing or uncertain, say what is missing and ask the smallest useful clarification.',
    'For code: provide runnable code when the request is sufficiently specified; otherwise ask for the missing environment/version.',
    'For factual claims: separate known facts from uncertainty and avoid invented specifics.',
    'For writing requests: return the finished text directly, without a preamble about your process.',
    'Prefer concise answers by default; expand when the user asks for detail.',
    base,
  ].filter(Boolean).join('\n');
}

export function nativeAnswer(text, messages = []) {
  const p = String(text || '').trim();
  const intent = detectIntent(p);
  if (!p) return { intent: 'empty', text: 'Mình sẵn sàng. Hãy gửi yêu cầu cụ thể.' };
  if (intent === 'greeting') return { intent, text: 'Xin chào 👋 Mình là LegendaryAI. Bạn muốn làm gì hôm nay?' };
  if (intent === 'math') {
    const value = safeMath(p);
    if (value !== null) return { intent, text: String(value) };
  }
  if (intent === 'image') return { intent, action: 'image', text: 'Mình đã nhận yêu cầu tạo ảnh. Hãy để Image Provider xử lý yêu cầu này.' };
  if (intent === 'writing' && /email.*nghỉ phép|xin nghỉ phép/i.test(p)) {
    return { intent, text: 'Tiêu đề: Xin nghỉ phép\n\nKính gửi Anh/Chị,\n\nEm xin phép nghỉ vào [ngày/thời gian] vì [lý do]. Em sẽ chủ động hoàn thành hoặc bàn giao các công việc cần thiết trước thời gian nghỉ.\n\nMong Anh/Chị xem xét và phê duyệt. Em cảm ơn Anh/Chị.\n\nTrân trọng,\n[Tên]' };
  }
  if (intent === 'summarize') {
    const recent = messages.filter(m => m && (m.role === 'user' || m.role === 'ai' || m.role === 'assistant')).slice(-6).map(m => String(m.content ?? m.text ?? '').trim()).filter(Boolean);
    if (recent.length) return { intent, text: 'Mình chưa có text model hoạt động để tóm tắt ngữ nghĩa chính xác. Context gần nhất:\n\n' + recent.map(x => '- ' + x.slice(0, 500)).join('\n') };
  }
  return {
    intent,
    text: 'Yêu cầu này cần một text model để tạo câu trả lời đáng tin cậy. Hiện LegendaryAI chưa có text model local được bật, nên mình không muốn giả vờ đã suy luận hoặc bịa nội dung. Bạn vẫn có thể dùng các tác vụ deterministic như tính toán và Image Provider.',
  };
}
