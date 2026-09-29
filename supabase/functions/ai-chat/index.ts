import { createClient } from "npm:@supabase/supabase-js@2";
const configuredSiteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
const ALLOWED_WEB_ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
if (configuredSiteUrl) ALLOWED_WEB_ORIGINS.add(configuredSiteUrl);

const baseCorsHeaders = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Expose-Headers": "content-type",
};

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_WEB_ORIGINS.has(origin)
    ? origin
    : "https://legendaryai.vercel.app";
  return {
    ...baseCorsHeaders,
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(req ? getCorsHeaders(req) : baseCorsHeaders),
    },
  });
}

const MODEL_BY_PLAN: Record<string, string> = {
  free: "legendary-lite-1",
  pro: "legendary-pro-1",
  legendary: "legendary-ultra-1",
};

const FALLBACK_BY_PLAN: Record<string, string> = {
  free: "legendary-lite-1",
  pro: "legendary-pro-1",
  legendary: "legendary-ultra-1",
};

const PLAN_FEATURES: Record<string, Record<string, boolean | number | string>> = {
  free: {
    token_limit: 500000,
    memory: false,
    session_context: true,
    vision: false,
    advanced_reasoning: false,
    quick_reasoning: true,
    smart_math: true,
    smart_formatting: true,
    advanced_memory: false,
    long_context: false,
    file_analysis: false,
    web_search: false,
    priority: false,
    token_reset_hours: 6,
    manual_reset: false,
  },
  pro: {
    token_limit: 2000000,
    memory: true,
    vision: true,
    file_analysis: true,
    advanced_reasoning: true,
    quick_reasoning: true,
    smart_math: true,
    smart_formatting: true,
    advanced_memory: false,
    long_context: true,
    web_search: false,
    priority: true,
    token_reset_hours: 12,
    manual_reset: true,
  },
  legendary: {
    token_limit: 6000000,
    memory: true,
    vision: true,
    file_analysis: true,
    advanced_reasoning: true,
    quick_reasoning: true,
    smart_math: true,
    smart_formatting: true,
    advanced_memory: true,
    long_context: true,
    web_search: false,
    priority: true,
    token_reset_hours: 18,
    manual_reset: true,
  },
};

function routeModelByTask(plan: string, role: string, prompt: string, reasoningRequested = false): string {
  const text = (prompt || "").toLowerCase();
  const localGatewayReady = Boolean(Deno.env.get("LEGENDARY_LOCAL_AI_URL"));

  if (localGatewayReady && reasoningRequested && (plan === "legendary" || role === "owner")) {
    return "legendary-ultra-120b";
  }

  if (localGatewayReady && reasoningRequested && (plan === "pro" || plan === "legendary" || role === "owner")) {
    return "legendary-reasoner-32b";
  }

  if (localGatewayReady && /vision|ảnh|image|hình ảnh|screenshot|camera|ocr/.test(text)) {
    if (plan === "pro") return "legendary-vision-pro-11b";
    if (plan === "legendary" || role === "owner") return "legendary-vision-109b";
  }

  if (localGatewayReady && (plan === "legendary" || role === "owner") &&
      /reason|reasoning|suy luận|chứng minh|toán|math|logic|debug|kiến trúc|architecture|phân tích sâu|bài tập|bài toán|lớp|thpt|thcs|tiểu học|vật lý|hóa học|sinh học|ngữ văn|tiếng anh|lịch sử|địa lý|tin học/.test(text)) {
    return "legendary-ultra-120b";
  }

  if (localGatewayReady && (plan === "pro" || plan === "legendary" || role === "owner") &&
      /code|coding|javascript|typescript|python|sql|supabase|github|debug|lỗi|bug|api|backend|frontend|bài tập|bài toán|lớp|thpt|thcs|tiểu học|tiểu học|vật lý|hóa học|sinh học|ngữ văn|tiếng anh|lịch sử|địa lý|tin học/.test(text)) {
    return "legendary-reasoner-32b";
  }

  return MODEL_BY_PLAN[plan] || MODEL_BY_PLAN.free;
}

function detectIntent(prompt: string): string {
  // Delegates to the weighted scorer (defined further below) so a message
  // matching several categories picks the strongest signal instead of the
  // first regex that happens to match.
  return scoreIntent(prompt);
}

const SYSTEM_DEFAULT = `You are LegendaryAI, the native AI core of LegendaryAI.

Core principles:
- Understand the user's actual goal before answering.
- Use the full available conversation context.
- Never claim to have used a tool, web search, file, API, or external model when you did not.
- Never invent sources, facts, benchmark numbers, or completed actions.
- For code, prefer secure, maintainable, production-ready solutions and explain important trade-offs.
- For writing, follow the requested audience, tone, structure, and language.
- For reasoning, work step-by-step internally and present a clear, useful result.
- For Grade 12/THPT school problems, act like a rigorous tutor: identify the subject and problem type, state the needed formula/theorem, show decisive transformations and substitutions, then conclude. Explain why each non-obvious step is valid.
- Keep school solutions compact: Nhận dạng -> Công thức/ý tưởng -> Giải từng bước -> Kết luận. Do not repeat the prompt or add generic encouragement.
- For advanced problems, do not skip the key proof/derivation. For multiple-choice, show the shortest valid derivation before the selected option.
- If a statement is missing a necessary value or condition, ask for that exact missing item. Never invent data.
- If the Native Core deterministic solver does not support a problem type, say so briefly rather than pretending it solved it.
- Keep answers concise by default, but go deep when the task requires it.
- LegendaryAI does not call Claude, OpenAI, ChatGPT, Anthropic, or other external AI providers.`;
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function tierAllowed(role: string, plan: string, tier: string): boolean {
  if (role === "owner") return true;
  if (tier === "free") return true;
  if (tier === "pro") return plan === "pro" || plan === "legendary";
  if (tier === "legendary") return plan === "legendary";
  return false;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (typeof part === "string") return part;
      return part?.text || part?.content || "";
    }).join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

function hasImageContent(content: unknown): boolean {
  return Array.isArray(content) && content.some((part: any) =>
    part && part.type === "image" && typeof part.image === "string"
  );
}

function cleanMessages(messages: any[], maxChars: number): any[] {
  const cleaned = messages
    .filter((m: any) => m && ["user", "assistant", "system"].includes(m.role))
    .map((m: any) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content
            .filter((part: any) => part && (part.type === "text" || part.type === "image"))
            .map((part: any) => part.type === "image"
              ? { type: "image", image: String(part.image || "").slice(0, 8_000_000), name: part.name || "image" }
              : { type: "text", text: String(part.text || part.content || "").slice(0, 12000) })
        : textFromContent(m.content).slice(0, 12000),
    }));

  let total = 0;
  const kept: any[] = [];
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const item = cleaned[i];
    const size = (typeof item.content === "string"
      ? item.content.length
      : textFromContent(item.content).length + JSON.stringify(item.content).length) + 40;
    if (kept.length && total + size > maxChars) break;
    kept.unshift(item);
    total += size;
  }
  return kept;
}

function safeArithmetic(input: string): number | null {
  const expression = input
    .replace(/,/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .trim();

  if (!/^[0-9+\-*/().%\s]+$/.test(expression) || !/[0-9]/.test(expression)) {
    return null;
  }

  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%]/g);
  if (!tokens) return null;

  const values: number[] = [];
  const ops: string[] = [];
  const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };

  const apply = () => {
    const op = ops.pop();
    const b = values.pop();
    const a = values.pop();
    if (op == null || a == null || b == null) throw new Error("bad expression");
    if (op === "/" && b === 0) throw new Error("division by zero");
    if (op === "+") values.push(a + b);
    else if (op === "-") values.push(a - b);
    else if (op === "*") values.push(a * b);
    else if (op === "/") values.push(a / b);
    else if (op === "%") values.push(a % b);
  };

  try {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (/^\d/.test(token)) {
        values.push(Number(token));
        continue;
      }
      if (token === "(") {
        ops.push(token);
        continue;
      }
      if (token === ")") {
        while (ops.length && ops[ops.length - 1] !== "(") apply();
        if (ops.pop() !== "(") return null;
        continue;
      }
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        precedence[ops[ops.length - 1]] >= precedence[token]
      ) apply();
      ops.push(token);
    }
    while (ops.length) {
      if (ops[ops.length - 1] === "(") return null;
      apply();
    }
    if (values.length !== 1 || !Number.isFinite(values[0])) return null;
    return values[0];
  } catch {
    return null;
  }
}

/* ============================================================
 * LEGENDARY REASONING TOOLKIT
 * Pure deterministic (no external model) "thinking" primitives:
 * advanced math, equation solving, unit conversion, date math,
 * extractive summarization, weighted intent scoring, and static
 * code review. These are real algorithms, not templates — they
 * give the native engine genuine capability even with no LLM
 * behind it, and keep working unchanged once a local model
 * (LEGENDARY_LOCAL_AI_URL) is added later.
 * ============================================================ */

// ---- Advanced math: functions, constants, factorial, ^ power ----
function evaluateAdvancedMath(input: string): { value: number; trace: string[] } | null {
  const trace: string[] = [];
  let expr = input
    .trim()
    .replace(/,/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\^/g, "**")
    .toLowerCase();

  if (!expr) return null;
  if (!/^[0-9a-z+\-*/().%\s!]+$/.test(expr)) return null;

  const FUNCS: Record<string, (a: number, b?: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    sin: (a) => Math.sin((a * Math.PI) / 180),
    cos: (a) => Math.cos((a * Math.PI) / 180),
    tan: (a) => Math.tan((a * Math.PI) / 180),
    log: (a) => Math.log10(a),
    ln: (a) => Math.log(a),
    pow: (a, b) => Math.pow(a, b ?? 2),
    min: (a, b) => Math.min(a, b ?? a),
    max: (a, b) => Math.max(a, b ?? a),
  };
  const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

  let i = 0;
  const peek = () => expr[i];
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isAlpha = (c: string) => /[a-z]/.test(c);

  function skipSpace() {
    while (peek() === " ") i++;
  }

  function parseFactorial(base: number): number {
    while (peek() === "!") {
      i++;
      if (base < 0 || !Number.isInteger(base) || base > 170) throw new Error("bad factorial");
      const operand = base;
      let r = 1;
      for (let k = 2; k <= operand; k++) r *= k;
      trace.push(`${operand}! = ${r}`);
      base = r;
    }
    return base;
  }

  function parsePrimary(): number {
    skipSpace();
    const c = peek();
    if (c === "(") {
      i++;
      const v = parseExpr();
      skipSpace();
      if (peek() !== ")") throw new Error("missing )");
      i++;
      return parseFactorial(v);
    }
    if (c === "-") {
      i++;
      return -parsePrimary();
    }
    if (c === "+") {
      i++;
      return parsePrimary();
    }
    if (isDigit(c) || c === ".") {
      let start = i;
      while (isDigit(peek()) || peek() === ".") i++;
      return parseFactorial(parseFloat(expr.slice(start, i)));
    }
    if (isAlpha(c)) {
      let start = i;
      while (isAlpha(peek())) i++;
      const name = expr.slice(start, i);
      skipSpace();
      if (peek() === "(") {
        i++;
        const args: number[] = [parseExpr()];
        skipSpace();
        while (peek() === ",") {
          i++;
          args.push(parseExpr());
          skipSpace();
        }
        if (peek() !== ")") throw new Error("missing )");
        i++;
        if (!FUNCS[name]) throw new Error("unknown function " + name);
        trace.push(`${name}(${args.join(", ")})`);
        return parseFactorial(FUNCS[name](args[0], args[1]));
      }
      if (name in CONSTS) return parseFactorial(CONSTS[name]);
      throw new Error("unknown identifier " + name);
    }
    throw new Error("unexpected token");
  }

  function parsePow(): number {
    let base = parsePrimary();
    skipSpace();
    if (peek() === "*" && expr[i + 1] === "*") {
      i += 2;
      const exp = parsePow();
      trace.push(`${base} ^ ${exp}`);
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseTerm(): number {
    let v = parsePow();
    skipSpace();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = peek();
      i++;
      const rhs = parsePow();
      if (op === "*") v *= rhs;
      else if (op === "/") { if (rhs === 0) throw new Error("div by zero"); v /= rhs; }
      else v %= rhs;
      skipSpace();
    }
    return v;
  }

  function parseExpr(): number {
    let v = parseTerm();
    skipSpace();
    while (peek() === "+" || peek() === "-") {
      const op = peek();
      i++;
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
      skipSpace();
    }
    return v;
  }

  try {
    const value = parseExpr();
    skipSpace();
    if (i !== expr.length || !Number.isFinite(value)) return null;
    return { value, trace };
  } catch {
    return null;
  }
}

// ---- Linear equation solver: "2x + 5 = 17", "3*x - 4 = 11", "x/2 = 9" ----
function solveLinearEquation(input: string): { x: number; steps: string[] } | null {
  const text = input.replace(/,/g, ".").replace(/×/g, "*").toLowerCase().trim();
  const m = text.match(/^([\-\d.]*)\s*\*?\s*x\s*([+\-]\s*[\d.]+)?\s*=\s*([\-\d.]+)$/) ||
    text.match(/^x\s*\/\s*([\d.]+)\s*([+\-]\s*[\d.]+)?\s*=\s*([\-\d.]+)$/);
  if (!m) return null;

  const isDivForm = text.includes("x/") || /x\s*\/\s*[\d.]/.test(text);
  const steps: string[] = [];

  if (isDivForm) {
    const divisor = parseFloat(m[1]) || 1;
    const addend = m[2] ? parseFloat(m[2].replace(/\s/g, "")) : 0;
    const rhs = parseFloat(m[3]);
    steps.push(`x/${divisor} ${addend ? (addend > 0 ? "+" + addend : addend) : ""} = ${rhs}`);
    const afterMove = rhs - addend;
    steps.push(`x/${divisor} = ${afterMove}`);
    const x = afterMove * divisor;
    steps.push(`x = ${afterMove} × ${divisor} = ${x}`);
    return { x, steps };
  }

  let coef = m[1] === "" || m[1] === "-" ? (m[1] === "-" ? -1 : 1) : parseFloat(m[1]);
  const addend = m[2] ? parseFloat(m[2].replace(/\s/g, "")) : 0;
  const rhs = parseFloat(m[3]);
  if (coef === 0 || !Number.isFinite(coef) || !Number.isFinite(rhs)) return null;

  steps.push(`${coef}x ${addend ? (addend > 0 ? "+ " + addend : "- " + Math.abs(addend)) : ""} = ${rhs}`);
  const afterMove = rhs - addend;
  steps.push(`${coef}x = ${afterMove}`);
  const x = afterMove / coef;
  steps.push(`x = ${afterMove} / ${coef} = ${x}`);
  return { x, steps };
}

// ---- Unit conversion: length, weight, temperature ----
const UNIT_TABLES: Record<string, Record<string, number>> = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mile: 1609.34, yard: 0.9144, foot: 0.3048, ft: 0.3048, inch: 0.0254, in: 0.0254 },
  weight: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, ton: 1000 },
};

// Plural / common alt spellings -> canonical key used in UNIT_TABLES above.
const UNIT_ALIASES: Record<string, string> = {
  miles: "mile", meters: "m", meter: "m", metres: "m", metre: "m",
  kilometers: "km", kilometres: "km", centimeters: "cm", centimetres: "cm",
  millimeters: "mm", millimetres: "mm", yards: "yard", feet: "foot", foots: "foot",
  inches: "inch", ins: "in", kilograms: "kg", grams: "g", milligrams: "mg",
  pounds: "lb", lbs: "lb", ounces: "oz", tons: "ton", tonnes: "ton",
};

function normalizeUnit(u: string): string {
  const key = u.trim().toLowerCase();
  return UNIT_ALIASES[key] || key;
}

function convertUnits(input: string): { result: number; from: string; to: string; formula: string } | null {
  const text = input.toLowerCase().replace(/,/g, ".");
  const m = text.match(/([\-\d.]+)\s*([a-zA-Zàâăêôơư°]+)\s*(?:to|sang|ra|thành|→|->)\s*([a-zA-Zàâăêôơư°]+)/i);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  let from = normalizeUnit(m[2]);
  let to = normalizeUnit(m[3]);
  if (!Number.isFinite(amount)) return null;

  // Temperature (special: not linear scale factor)
  const tempAliases: Record<string, string> = { "°c": "c", c: "c", celsius: "c", "°f": "f", f: "f", fahrenheit: "f", k: "k", kelvin: "k" };
  if (tempAliases[from] && tempAliases[to]) {
    const fu = tempAliases[from], tu = tempAliases[to];
    let celsius: number;
    if (fu === "c") celsius = amount;
    else if (fu === "f") celsius = (amount - 32) * (5 / 9);
    else celsius = amount - 273.15;
    let result: number;
    if (tu === "c") result = celsius;
    else if (tu === "f") result = celsius * (9 / 5) + 32;
    else result = celsius + 273.15;
    return { result: Math.round(result * 1000) / 1000, from: fu, to: tu, formula: `${amount}°${fu.toUpperCase()} → ${tu.toUpperCase()}` };
  }

  for (const table of [UNIT_TABLES.length, UNIT_TABLES.weight]) {
    if (table[from] != null && table[to] != null) {
      const meters = amount * table[from];
      const result = meters / table[to];
      return { result: Math.round(result * 100000) / 100000, from, to, formula: `${amount} ${from} × ${table[from]} / ${table[to]}` };
    }
  }
  return null;
}

// ---- Date math: difference between two dates, or add/subtract days ----
function parseFlexibleDate(s: string): Date | null {
  const t = s.trim();
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

function dateReasoning(input: string): string | null {
  const text = input.trim();
  const dates = [...text.matchAll(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{1,2}-\d{1,2}/g)].map((m) => m[0]);
  if (dates.length >= 2) {
    const d1 = parseFlexibleDate(dates[0]);
    const d2 = parseFlexibleDate(dates[1]);
    if (d1 && d2) {
      const diffDays = Math.round((d2.getTime() - d1.getTime()) / 86400000);
      return `Khoảng cách giữa **${dates[0]}** và **${dates[1]}** là **${Math.abs(diffDays)} ngày** (${diffDays >= 0 ? dates[1] + " sau " + dates[0] : dates[0] + " sau " + dates[1]}).`;
    }
  }
  const addMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\s*(?:\+|cộng|sau)\s*(\d+)\s*ng(?:ày|ay)/i);
  if (addMatch) {
    const base = parseFlexibleDate(addMatch[1]);
    if (base) {
      const result = new Date(base.getTime() + Number(addMatch[2]) * 86400000);
      const fmt = `${String(result.getDate()).padStart(2, "0")}/${String(result.getMonth() + 1).padStart(2, "0")}/${result.getFullYear()}`;
      return `**${addMatch[1]} + ${addMatch[2]} ngày = ${fmt}**`;
    }
  }
  return null;
}

/* ============================================================
 * NATIVE ACADEMIC SOLVER
 * Conservative deterministic solvers for common Vietnamese THPT/Grade 12 forms.
 * Unsupported statements never receive fabricated answers.
 * ============================================================ */

function normalizeSchoolText(input: string): string {
  return String(input || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
}
function isAcademicPrompt(input: string): boolean {
  const t=normalizeSchoolText(input);
  return /lop\s*(?:[1-9]|1[0-2])|cap\s*1|cap\s*2|cap\s*3|thcs|thpt|tieu hoc|pho thong|bai tap|bai toan|giai bai|dao ham|nguyen ham|tich phan|xac suat|hinh hoc|mon toan|vat ly|hoa hoc|sinh hoc|ngu van|tieng anh|tieng viet|lich su|dia ly|cong nghe|tin hoc/.test(t);
}
function detectSchoolLevel(input: string): string {
  const t=normalizeSchoolText(input);
  const m=t.match(/lop\s*(1[0-2]|[1-9])/);
  if(m) return 'Lớp '+m[1];
  if(/cap\s*1|tieu hoc/.test(t)) return 'Tiểu học';
  if(/cap\s*2|thcs/.test(t)) return 'THCS';
  if(/cap\s*3|thpt/.test(t)) return 'THPT';
  return 'không xác định';
}
function detectSchoolSubject(input: string): string {
  const t=normalizeSchoolText(input);
  if(/toan|math|dai so|hinh hoc|giai tich|xac suat/.test(t)) return 'Toán';
  if(/vat ly|co hoc|dien|quang|song|hat nhan/.test(t)) return 'Vật lý';
  if(/hoa hoc|hoa|mol|pH|oxi hoa|phuong trinh hoa hoc/.test(t)) return 'Hóa học';
  if(/sinh hoc|di truyen|te bao|sinh thai/.test(t)) return 'Sinh học';
  if(/ngu van|van hoc|thong diep|nghi luan/.test(t)) return 'Ngữ văn';
  if(/tieng anh|english|grammar|reading|writing/.test(t)) return 'Tiếng Anh';
  if(/lich su/.test(t)) return 'Lịch sử';
  if(/dia ly/.test(t)) return 'Địa lý';
  if(/tin hoc|lap trinh|python|algorithm/.test(t)) return 'Tin học';
  if(/cong nghe|ky thuat|thiet ke|nong nghiep|co khi/.test(t)) return 'Công nghệ';
  if(/giao duc cong dan|gdcd|kinh te|phap luat/.test(t)) return 'GDCD/Kinh tế & Pháp luật';
  return 'không xác định';
}
function schoolTaskProfile(input: string): { level: string; subject: string; mode: string; difficulty: string } {
  const t = normalizeSchoolText(input);
  const level = detectSchoolLevel(input);
  const subject = detectSchoolSubject(input);
  const mode = /de thi|trac nghiem|multiple choice|chon dap an/.test(t)
    ? "trắc nghiệm"
    : /chung minh|giai thich|tai sao|vi sao|proof|essay|nghi luan/.test(t)
      ? "tự luận/giải thích"
      : "bài tập";
  const difficulty = /olympic|hoc sinh gioi|chuyen|nang cao|van dung cao|thach thuc/.test(t)
    ? "nâng cao"
    : /co ban|de|can ban|on tap/.test(t)
      ? "cơ bản"
      : "tiêu chuẩn";
  return { level, subject, mode, difficulty };
}
function fmt(n:number):string { if(!Number.isFinite(n)) return 'không xác định'; const x=Math.abs(n)<1e-10?0:Number(n.toFixed(10)); return String(x); }

function solveQuadraticAcademic(input:string):string|null {
  const normalized=normalizeSchoolText(input).replace(/²/g,'^2').replace(/x\s*\^\s*2/g,'x2'); const match=normalized.match(/([+-]?[0-9.\s*x2*]+)\s*=\s*([+-]?[0-9.\s*x2*]+)/); if(!match||!match[1].includes('x2')) return null; const sides=[match[1].replace(/\s+/g,''),match[2].replace(/\s+/g,'')];
  const parse=(s:string)=>{const terms=s.replace(/-/g,'+-').split('+').filter(Boolean);let a=0,b=0,c=0;for(const raw of terms){const q=raw.replace(/\*/g,'');if(/^[+-]?[\d.]*x2$/.test(q)){const z=q.slice(0,-2);a+=z===''||z==='+'?1:z==='-'?-1:Number(z);}else if(/^[+-]?[\d.]*x$/.test(q)){const z=q.slice(0,-1);b+=z===''||z==='+'?1:z==='-'?-1:Number(z);}else if(/^[+-]?[\d.]+$/.test(q))c+=Number(q);else throw 0;}return [a,b,c] as const;};
  try{const [a1,b1,c1]=parse(sides[0]),[a2,b2,c2]=parse(sides[1]);const a=a1-a2,b=b1-b2,c=c1-c2;if(!a) return null;const d=b*b-4*a*c;
    if(d>0){const x1=(-b+Math.sqrt(d))/(2*a),x2=(-b-Math.sqrt(d))/(2*a);return '## Toán 12 — phương trình bậc hai\n\n**Nhận dạng:** đưa về `ax²+bx+c=0`.\n\n**1.** `a='+fmt(a)+', b='+fmt(b)+', c='+fmt(c)+'`.\n**2.** `Δ=b²-4ac='+fmt(d)+'>0` nên có hai nghiệm phân biệt.\n**3.** `x=(-b±√Δ)/(2a)`.\n\n**Kết luận:** `x₁='+fmt(x1)+', x₂='+fmt(x2)+'`.\n\n**Vì sao:** `Δ>0` cho hai giá trị căn khác nhau nên phương trình có hai nghiệm thực.';}
    if(Math.abs(d)<1e-10){const x=-b/(2*a);return '## Toán 12 — phương trình bậc hai\n\n**1.** `Δ=0` nên có nghiệm kép.\n**2.** `x=-b/(2a)`.\n\n**Kết luận:** `x='+fmt(x)+'`.';}
    return '## Toán 12 — phương trình bậc hai\n\n**1.** `Δ='+fmt(d)+'<0`.\n\n**Kết luận:** phương trình **vô nghiệm trong R**.\n\n**Vì sao:** `Δ<0` nên không tồn tại căn bậc hai thực của `Δ`.';
  }catch{return null;}
}

function solveSystemAcademic(input:string):string|null {
  const t=normalizeSchoolText(input).replace(/\s+/g,'');const eq=t.split(/[,;\n]+/).filter(x=>x.includes('=')&&x.includes('x')&&x.includes('y'));if(eq.length!==2)return null;
  const parse=(s:string)=>{const p=s.split('=');if(p.length!==2)throw 0;const side=(z:string)=>{let a=0,b=0,c=0;for(const r of z.replace(/-/g,'+-').split('+').filter(Boolean)){const q=r.replace(/\*/g,'');if(/^[+-]?[\d.]*x$/.test(q)){const n=q.slice(0,-1);a+=n===''||n==='+'?1:n==='-'?-1:Number(n);}else if(/^[+-]?[\d.]*y$/.test(q)){const n=q.slice(0,-1);b+=n===''||n==='+'?1:n==='-'?-1:Number(n);}else if(/^[+-]?[\d.]+$/.test(q))c+=Number(q);else throw 0;}return[a,b,c]as const;};const [a,b,c]=side(p[0]);return[a,b,Number(p[1])-c]as const;};
  try{const [a1,b1,c1]=parse(eq[0]),[a2,b2,c2]=parse(eq[1]);const d=a1*b2-a2*b1;if(!d)return null;const x=(c1*b2-c2*b1)/d,y=(a1*c2-a2*c1)/d;return '## Toán 12 — hệ 2 ẩn\n\nDùng Cramer vì `D='+fmt(d)+'≠0`.\n\n**1.** `D='+fmt(d)+'`.\n**2.** `Dₓ='+fmt(c1*b2-c2*b1)+'`, `Dᵧ='+fmt(a1*c2-a2*c1)+'`.\n**3.** `x=Dₓ/D='+fmt(x)+'`, `y=Dᵧ/D='+fmt(y)+'`.\n\n**Kết luận:** `x='+fmt(x)+', y='+fmt(y)+'`.';}catch{return null;}
}

function academicNativeResponse(prompt:string):string|null {
  if(!isAcademicPrompt(prompt)) return null;
  // Deterministic native solvers take precedence only when they can prove the result.
  // Otherwise return null so an available local model can solve the full problem.
  return solveQuadraticAcademic(prompt) || solveSystemAcademic(prompt) || null;
}

// ---- Extractive summarization: word-frequency sentence scoring (TextRank-lite) ----
const VI_STOPWORDS = new Set(["là","của","và","có","cho","một","các","này","đó","với","được","trong","để","không","những","khi","như","đã","sẽ","về","tôi","bạn","mình","thì","nên","rằng","nếu","the","a","an","is","are","of","to","in","and","for","on","with","that","this"]);

function extractiveSummarize(text: string, maxSentences = 5): string {
  const clean = text.replace(/```[\s\S]*?```/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8);
  if (sentences.length <= maxSentences) return sentences.join(" ");

  const freq: Record<string, number> = {};
  for (const sentence of sentences) {
    const words = sentence.toLowerCase().match(/[\p{L}\d]+/gu) || [];
    for (const w of words) {
      if (VI_STOPWORDS.has(w) || w.length < 2) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  const scored = sentences.map((sentence, idx) => {
    const words = sentence.toLowerCase().match(/[\p{L}\d]+/gu) || [];
    const raw = words.reduce((sum, w) => sum + (freq[w] || 0), 0) / Math.max(1, words.length);
    const positionBoost = idx === 0 || idx === sentences.length - 1 ? 1.15 : 1;
    return { sentence, idx, score: raw * positionBoost };
  });

  const top = scored.sort((a, b) => b.score - a.score).slice(0, maxSentences).sort((a, b) => a.idx - b.idx);
  return top.map((s) => "- " + s.sentence).join("\n");
}

// ---- Weighted intent scoring (replaces first-match regex ordering) ----
const INTENT_KEYWORDS: Record<string, { weight: number; pattern: RegExp }[]> = {
  vision: [{ weight: 3, pattern: /ảnh|image|vision|screenshot|ocr|hình/ }],
  coding: [
    { weight: 3, pattern: /code|coding|javascript|typescript|python|sql|debug|bug|api|supabase|github/ },
    { weight: 1, pattern: /hàm|function|biến|variable|class|module/ },
  ],
  reasoning: [
    { weight: 3, pattern: /tính|math|toán|phương trình|calculate|logic|reason|suy luận|chứng minh/ },
    { weight: 2, pattern: /=|\+|\-|\*|\// },
  ],
  writing: [{ weight: 3, pattern: /viết|soạn|email|content|rewrite|dịch|translate/ }],
  summarization: [{ weight: 3, pattern: /tóm tắt|summarize|summary|tổng hợp/ }],
};

function scoreIntent(prompt: string): string {
  const text = (prompt || "").toLowerCase();
  let best = "general";
  let bestScore = 0;
  for (const [intent, rules] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const rule of rules) if (rule.pattern.test(text)) score += rule.weight;
    if (score > bestScore) { bestScore = score; best = intent; }
  }
  return bestScore > 0 ? best : "general";
}

// ---- Static code review heuristics (no execution, pattern-based) ----
function extractCodeBlocks(text: string): string[] {
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n?([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.length ? blocks : (text.length > 40 && /[{};]/.test(text) ? [text] : []);
}

function staticCodeReview(code: string): string[] {
  const findings: string[] = [];
  const lines = code.split("\n");

  if (/[^=!<>]==[^=]/.test(code)) findings.push("Dùng `==` thay vì `===` có thể gây so sánh sai kiểu dữ liệu — nên dùng `===`/`!==`.");
  if (/\bvar\s+\w+/.test(code)) findings.push("Dùng `var` — nên chuyển sang `let`/`const` để tránh hoisting và scope rò rỉ.");
  if (/catch\s*\([^)]*\)\s*{\s*}/.test(code)) findings.push("Có `catch` rỗng — lỗi bị nuốt âm thầm, nên log hoặc xử lý lỗi cụ thể.");
  if (/console\.log|print\(/.test(code)) findings.push("Còn `console.log`/`print` debug — nên dọn trước khi đưa vào production.");
  if (/SELECT .* \+ |query\s*\(\s*["'`].*\$\{/.test(code)) findings.push("Có dấu hiệu nối chuỗi SQL trực tiếp — rủi ro SQL injection, nên dùng parameterized query.");
  if (/(api[_-]?key|secret|password)\s*=\s*["'`][^"'`]{6,}/i.test(code)) findings.push("Có vẻ có key/secret hardcode trong code — không nên commit secret, dùng biến môi trường.");

  const opens = (code.match(/[{[(]/g) || []).length;
  const closes = (code.match(/[}\])]/g) || []).length;
  if (opens !== closes) findings.push(`Số ngoặc mở (${opens}) và đóng (${closes}) không khớp — khả năng thiếu/thừa dấu ngoặc.`);

  if (lines.length > 60) findings.push(`Khối code dài ${lines.length} dòng — cân nhắc tách hàm nhỏ hơn để dễ đọc/test.`);
  if (/await\s+\w+\([^)]*\)(?!\s*;?\s*$)/.test(code) === false && /async /.test(code) && !/await/.test(code)) findings.push("Hàm khai báo `async` nhưng không thấy `await` nào — kiểm tra lại có cần async không.");

  if (!findings.length) findings.push("Không phát hiện lỗi phổ biến qua static scan (== , var, catch rỗng, ngoặc lệch, secret hardcode). Vẫn nên test kỹ theo logic nghiệp vụ.");
  return findings;
}

function analysisDepth(prompt: string, reasoningRequested: boolean, plan: string, localReady: boolean, requestedLevel?: unknown): { tier: number; label: string } {
  if (!localReady) return { tier: 1, label: 'Native Core' };
  const t = normalizeSchoolText(prompt);
  const explicit = Number(requestedLevel);
  const complex = /chung minh|chung minh|bai nang cao|nang cao|olympic|thi hoc sinh gioi|dai so|giai tich|hinh khong gian|xac suat|vat ly|hoa hoc|sinh hoc|logic|thuat toan|kien truc|debug|phan tich sau|multi-step|research|de thi|trac nghiem/.test(t);
  let tier = complex ? 4 : (reasoningRequested ? 3 : (plan === 'pro' ? 2 : 2));
  if (Number.isFinite(explicit)) tier = Math.max(tier, Math.min(4, Math.max(1, Math.floor(explicit))));
  const maxTier = plan === 'legendary' || plan === 'pro' || plan === 'owner' ? 4 : 2;
  tier = Math.min(tier, maxTier);
  return { tier, label: tier === 4 ? 'Local Deep ×4' : tier === 3 ? 'Local Deep ×3' : tier === 2 ? 'Local Enhanced ×2' : 'Local Core ×1' };
}

function buildIntelligenceInstruction(prompt: string, tier: number, reasoningRequested: boolean): string {
  const academic = isAcademicPrompt(prompt);
  const profile = academic ? schoolTaskProfile(prompt) : null;
  const lines = [
    "INTELLIGENCE ORCHESTRATION:",
    `- Quality tier: ${tier}x. This is an internal quality budget, not a benchmark claim.`,
    "- First classify intent, constraints, ambiguity, assumptions, and the required output.",
    "- Prefer exact reasoning over plausible wording. Verify arithmetic, units, definitions, assumptions, edge cases, and contradictions.",
    "- If the request contains multiple tasks, decompose them, solve each, then reconcile the result.",
    "- If evidence is insufficient, identify exactly what is missing instead of guessing.",
    ...(reasoningRequested ? ["- Reasoning mode: perform deeper internal verification before the final answer."] : []),
    ...(academic && profile ? [
      `- ACADEMIC TUTOR MODE: ${profile.level} | ${profile.subject} | ${profile.mode} | ${profile.difficulty}.`,
      "- Adapt vocabulary, notation, examples, and explanation depth to the student's level from Grade 1 through Grade 12.",
      "- Prefer the simplest school-appropriate method before advanced machinery. For advanced problems, preserve the key proof/derivation.",
      "- Solution contract: Nhận dạng → Dữ kiện → Công thức/ý tưởng → Giải từng bước → Kiểm tra → Kết luận.",
      "- Explain WHY at every decisive transformation, but never pad the answer with generic commentary.",
      "- For multiple choice: derive the shortest valid proof, then state the selected option and why the others do not fit when useful.",
      "- For essays/language subjects: separate thesis, evidence, reasoning, and conclusion; do not invent quotations, facts, or sources.",
    ] : []),
    "- Never expose hidden chain-of-thought. Provide concise reasoning summaries and the decisive derivation only.",
  ];
  return "\n\n" + lines.join("\n");
}
async function ollamaResponse(
  baseUrl: string,
  modelId: string,
  messages: any[],
  system: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const url = baseUrl.replace(/\/$/, "") + "/api/chat";
  const payloadMessages = [
    ...(system ? [{ role: "system", content: system }] : []),
    ...messages.map((m: any) => {
      const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
      if (!Array.isArray(m.content)) return { role, content: textFromContent(m.content) };
      const content = m.content
        .filter((p: any) => p?.type === "text")
        .map((p: any) => p.text || "")
        .join("\n");
      const images = m.content
        .filter((p: any) => p?.type === "image" && typeof p.image === "string")
        .map((p: any) => String(p.image).replace(/^data:[^;]+;base64,/, ""));
      return images.length ? { role, content, images } : { role, content };
    }),
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      messages: payloadMessages,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Self-hosted model error (${response.status}): ${raw.slice(0, 600)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Self-hosted model returned invalid JSON.");
  }

  const text = data?.message?.content || data?.response || "";
  if (!text) throw new Error("Self-hosted model returned no text.");
  return String(text);
}

async function ollamaEnhancedResponse(
  baseUrl: string, modelId: string, messages: any[], system: string, maxTokens: number, temperature: number, tier: number,
): Promise<string> {
  const draft = await ollamaResponse(baseUrl, modelId, messages, system, maxTokens, temperature);
  if (tier <= 1) return draft;
  const verifierSystem = system + `\n\nVERIFICATION PASS: Review the draft below for factual, mathematical, logical, instructional, and formatting errors. List only concrete corrections. If it is correct, say VERIFIED.`;
  const verifyMessages = [
    ...messages,
    { role: 'assistant', content: draft },
    { role: 'user', content: 'Kiểm tra đáp án trên thật kỹ. Không viết lại toàn bộ; chỉ nêu lỗi cần sửa hoặc VERIFIED.' },
  ];
  const critique = await ollamaResponse(baseUrl, modelId, verifyMessages, verifierSystem, Math.min(2048, maxTokens), 0.15);
  if (tier === 2) return critique.includes('VERIFIED') ? draft : await ollamaResponse(baseUrl, modelId, messages, system + `\n\nCORRECTION PASS: Fix only the concrete issues identified by this verifier:\n${critique}`, maxTokens, 0.2);
  const refinement = await ollamaResponse(
    baseUrl, modelId, messages,
    system + `\n\nFINAL REVIEW: Produce the final answer using this draft and verifier notes. Keep the useful derivation, remove errors and unnecessary text.\nDRAFT:\n${draft}\nVERIFIER:\n${critique}`,
    maxTokens, 0.2,
  );
  if (tier >= 4) {
    const audit = await ollamaResponse(baseUrl, modelId, [{ role: 'user', content: refinement }], system + '\n\nFINAL AUDIT: Return AUDIT_OK if the answer is internally consistent; otherwise give only the exact correction.', 1024, 0.1);
    if (!audit.includes('AUDIT_OK')) return await ollamaResponse(baseUrl, modelId, [{ role: 'user', content: refinement }, { role: 'user', content: 'Apply this final audit correction exactly:\n' + audit }], system, maxTokens, 0.15);
  }
  return refinement;
}
const TOOL_PROMPTS: Record<string, string> = {
  calculator: "Evaluate a basic arithmetic expression safely. Never use eval or execute code.",
  summarize: "Summarize the supplied material. Return the key points, decisions, risks, and next actions. Do not invent missing facts.",
  rewrite: "Rewrite the user's material while preserving meaning. Improve clarity, structure, grammar, and tone. Return only the requested rewritten result unless explanation is requested.",
  plan: "Create an actionable plan with goal, assumptions, ordered steps, dependencies, risks, and a verification checklist.",
  code_review: "Perform a production-grade code review. Identify correctness bugs, security issues, edge cases, maintainability problems, and concrete fixes. Prioritize findings by severity.",
  debug: "Debug systematically. Identify likely root cause, evidence, reproduction steps, and the smallest safe fix. Do not pretend to execute code.",
  email: "Draft a complete send-ready email. Infer a professional structure from the request, but never invent sensitive facts.",
  translate: "Translate accurately while preserving meaning, formatting, terminology, and tone. Do not add commentary unless asked.",
  extract: "Extract the requested facts into a compact structured format. If JSON is requested, return valid JSON only.",
  json: "Return valid JSON only. Do not wrap it in markdown fences. Preserve the requested schema exactly.",
};

function normalizeTool(value: unknown): string {
  const tool = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TOOL_PROMPTS, tool) ? tool : "";
}

function inferTool(prompt: string): string {
  const text = String(prompt || "").toLowerCase();
  // Fixed: the old regex used `[:\\s]` / `\\d` / `\\s` (double backslash inside
  // a regex literal), which either fails to match whitespace/digits at all or,
  // worse, produces an invalid out-of-order character-class range (`\\-*`)
  // that throws a SyntaxError the moment this module loads — crashing the
  // entire Edge Function on every request (this is the most likely cause of
  // the "Failed to fetch" error reported earlier).
  if (/^(tính|calculate|calculator|calc)[:\s]/.test(text) || /^(?:[-+]?\d+(?:[.,]\d+)?\s*[+\-*/%×÷()\s]+)$/.test(text) || solveLinearEquation(text) || convertUnits(text)) return "calculator";
  if (/tóm tắt|summarize|summary|rút gọn/.test(text)) return "summarize";
  if (/viết lại|rewrite|paraphrase/.test(text)) return "rewrite";
  if (/lập kế hoạch|plan|roadmap|kế hoạch từng bước/.test(text)) return "plan";
  if (/code review|review code|review đoạn code/.test(text)) return "code_review";
  if (/debug|gỡ lỗi|tìm bug|sửa lỗi/.test(text)) return "debug";
  if (/soạn email|viết email|draft email/.test(text)) return "email";
  if (/dịch sang|translate|dịch đoạn/.test(text)) return "translate";
  if (/json|trích xuất|extract|tách dữ liệu/.test(text)) return "extract";
  return "";
}

function toolInstruction(tool: string): string {
  return tool && TOOL_PROMPTS[tool] ? "\n\nACTIVE TOOL MODE: " + tool + "\n" + TOOL_PROMPTS[tool] : "";
}

function modelName(modelKey: string): string {
  if (modelKey === "legendary-ultra-1") return "LegendaryUltra-1";
  if (modelKey === "legendary-pro-1") return "LegendaryPro-1";
  if (modelKey === "custom") return "Legendary Custom Core";
  if (modelKey === "legendary-reasoner-32b") return "Legendary Reasoner 32B";
  if (modelKey === "legendary-vision-pro-11b") return "Legendary Vision Pro 11B";
  if (modelKey === "legendary-ultra-120b") return "Legendary Ultra 120B";
  if (modelKey === "legendary-vision-109b") return "Legendary Vision 109B";
  return "LegendaryLite-1";
}

function extractMemoryCandidates(prompt: string): { memory: string; importance: number }[] {
  const p = (prompt || "").trim();
  if (!p) return [];

  // NOTE: fixed a bug here — the old patterns used `[:\\s]+` (matches the
  // literal characters ':' '\' 's'), not `[:\s]+` (whitespace). That silently
  // dropped most "nhớ rằng ..." style memories whenever a plain space followed
  // the trigger phrase, since the class never actually matched a space.
  const patterns: { re: RegExp; importance: number }[] = [
    { re: /(?:hãy nhớ|nhớ rằng|ghi nhớ|remember that)[:\s]+(.{4,300})$/i, importance: 9 },
    { re: /(?:tôi tên là|mình tên là|my name is)[:\s]+(.{2,80})$/i, importance: 9 },
    { re: /(?:sinh nhật|birthday)(?: của tôi| của mình)?\s*(?:là|is)?[:\s]+(.{2,60})$/i, importance: 8 },
    { re: /(?:tôi làm việc ở|mình làm việc ở|i work at|tôi làm nghề)[:\s]+(.{2,120})$/i, importance: 8 },
    { re: /(?:tôi thích|mình thích|i like|i love)[:\s]+(.{3,200})$/i, importance: 7 },
    { re: /(?:tôi không thích|mình không thích|i dislike|i hate)[:\s]+(.{3,200})$/i, importance: 7 },
    { re: /(?:tôi đang làm|mình đang làm|i am working on|đang xây dựng)[:\s]+(.{3,240})$/i, importance: 7 },
    { re: /(?:mục tiêu của tôi|goal của tôi|my goal is)[:\s]+(.{3,240})$/i, importance: 7 },
    { re: /(?:tôi dùng|mình dùng|i use)[:\s]+(.{3,150})$/i, importance: 6 },
    { re: /(?:ngôn ngữ ưa thích|preferred language)[:\s]+(.{2,60})$/i, importance: 6 },
  ];

  const seen = new Set<string>();
  const results: { memory: string; importance: number }[] = [];
  for (const { re, importance } of patterns) {
    const match = p.match(re);
    const value = match?.[1]?.trim();
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      results.push({ memory: value, importance });
    }
  }
  return results;
}

function memoryAugmentedSystem(system: string, memories: string[], maxCount = 10): string {
  if (!memories.length) return system;
  const memoryBlock = memories
    .slice(0, maxCount)
    .map((m) => "- " + m)
    .join("\n");
  return system + "\n\nLONG-TERM MEMORY (trusted user-provided context; use only when relevant):\n" + memoryBlock;
}

function localLegendaryResponse(
  modelKey: string,
  messages: any[],
  system: string,
  memories: string[],
): string {
  const latest = [...messages].reverse().find((m: any) => m?.role === "user");
  const prompt = textFromContent(latest?.content).trim();
  const lower = prompt.toLowerCase();
  const name = modelName(modelKey);
  const recent = messages.slice(-8).map((m: any) => `${m.role}: ${textFromContent(m.content)}`).join("\n");
  const memoryText = memories.length
    ? memories.slice(0, 8).map((m) => "- " + m).join("\n")
    : "";

  const academic = academicNativeResponse(prompt);
  if (academic) return academic;

  if (!prompt) {
    return "Mình đã sẵn sàng. Hãy gửi yêu cầu cụ thể để Legendary Engine xử lý.";
  }

  // --- Smart math: equation > unit conversion > date math > advanced math > basic arithmetic
  const mathCandidate = prompt.replace(/^(tính|calculate|giúp tôi tính|=?)[\s:]*/i, "").trim();
  const equation = solveLinearEquation(mathCandidate);
  const unitConv = !equation ? convertUnits(mathCandidate) : null;
  const dateCalc = !equation && !unitConv ? dateReasoning(mathCandidate) : null;
  const advMath = !equation && !unitConv && !dateCalc ? evaluateAdvancedMath(mathCandidate) : null;
  const basicMath = !equation && !unitConv && !dateCalc && !advMath && /[+\-*/%]|×|÷/.test(mathCandidate)
    ? safeArithmetic(mathCandidate)
    : null;

  if (equation) {
    return `## Giải phương trình\n\n${equation.steps.map((s) => "- " + s).join("\n")}\n\n**x = ${equation.x}**\n\nLegendary Engine giải bằng bộ giải phương trình tuyến tính nội bộ (không cần model ngoài).`;
  }
  if (unitConv) {
    return `## Quy đổi đơn vị\n\n${unitConv.formula}\n\n**Kết quả: ${unitConv.result} ${unitConv.to}**`;
  }
  if (dateCalc) {
    return `## Tính toán ngày tháng\n\n${dateCalc}`;
  }
  if (advMath) {
    return `## Kết quả\n\n**${advMath.value}**${advMath.trace.length ? "\n\n" + advMath.trace.map((t) => "- " + t).join("\n") : ""}\n\nLegendary Engine đã phân tích biểu thức bằng core toán học nâng cao nội bộ (hỗ trợ hàm, lũy thừa, giai thừa).`;
  }
  if (basicMath !== null) {
    return `## Kết quả\n\n**${basicMath}**\n\nLegendary Engine đã phân tích biểu thức trực tiếp bằng core tính toán nội bộ.`;
  }

  if (/^(xin chào|chào|hello|hi|hey)\b/i.test(prompt)) {
    return `Xin chào! Mình là **${name}**, core AI native của LegendaryAI.\n\nMình đang dùng context của cuộc trò chuyện và memory được phép của tài khoản; không gọi Claude, OpenAI, ChatGPT hay API AI bên ngoài.`;
  }

  if (/(debug|lỗi|error|bug|code|javascript|typescript|python|java|sql|html|css|supabase|github)/i.test(prompt)) {
    const codeBlocks = extractCodeBlocks(prompt + "\n" + recent);
    const codeHints = [];
    if (/undefined|cannot read|null/i.test(prompt)) codeHints.push("Kiểm tra biến có thể null/undefined trước khi truy cập thuộc tính.");
    if (/cors|cross.origin/i.test(prompt)) codeHints.push("Kiểm tra Origin, CORS headers và endpoint backend; không đưa secret vào browser.");
    if (/401|unauthorized|auth/i.test(prompt)) codeHints.push("Kiểm tra access token, session hiện tại và bước xác thực ở server.");
    if (/404|not found/i.test(prompt)) codeHints.push("Kiểm tra route/function name, deployment và URL endpoint.");
    if (!codeHints.length && !codeBlocks.length) codeHints.push("Tách lỗi thành input → state → request → response, sau đó kiểm tra log ở từng lớp.");

    const reviewSection = codeBlocks.length
      ? `\n\n### Static code review (bộ quét tĩnh nội bộ)\n${staticCodeReview(codeBlocks[0]).map((x) => "- " + x).join("\n")}`
      : "\n\n*Chưa thấy khối code (```...```) trong tin nhắn — dán code vào để mình chạy static review chi tiết hơn.*";

    return `## Legendary Code Reasoning\n\n**Yêu cầu:**\n> ${prompt}\n\n### Hướng xử lý\n${codeHints.map((x) => "- " + x).join("\n")}${reviewSection}\n\n### Context gần nhất\n\`\`\`text\n${recent.slice(-2200)}\n\`\`\`\n\nCore model: **${name}**. Nếu bạn gửi file/code hoặc log đầy đủ, mình có thể bám trực tiếp vào nội dung đó thay vì đoán.`;
  }

  if (/(viết|soạn|email|bài|content|rewrite|dịch|translate|kịch bản|mô tả)/i.test(prompt)) {
    return `## Soạn thảo\n\nMình đã nhận yêu cầu: **${prompt}**\n\nĐể tạo bản hoàn chỉnh, hãy cung cấp (nếu có):\n1. Đối tượng đọc.\n2. Giọng văn mong muốn.\n3. Độ dài hoặc định dạng.\n\nLegendary Engine sẽ ưu tiên giữ đúng yêu cầu và context thay vì tự bịa thông tin chưa được cung cấp.`;
  }

  if (/(tóm tắt|summarize|tổng hợp|rút gọn)/i.test(prompt)) {
    const source = recent.replace(/^\w+:\s*/gm, "").slice(-5000);
    const summary = source ? extractiveSummarize(source, 5) : "";
    return `## Tóm tắt (extractive, chấm điểm theo tần suất từ khóa)\n\n${summary || "Chưa có đủ nội dung nguồn để tóm tắt."}\n\n> Đây là bản tóm tắt thuật toán trích xuất câu quan trọng từ context đã gửi; chưa có web search trong phiên này.`;
  }

  if (/(checklist|liệt kê|danh sách|bullet|gạch đầu dòng)/i.test(prompt)) {
    const items = prompt
      .replace(/^(hãy|giúp tôi|cho tôi|tạo|làm)\s+/i, "")
      .split(/[,;]|\s+và\s+/i)
      .map((x) => x.trim())
      .filter((x) => x.length > 2)
      .slice(0, 10);
    return items.length > 1
      ? "## Checklist nhanh\n\n" + items.map((x, i) => (i + 1) + ". " + x).join("\n") + "\n\n**Free Quick Mode** · LegendaryLite-1"
      : "## Checklist nhanh\n\n- Làm rõ mục tiêu\n- Chia việc thành bước nhỏ\n- Kiểm tra kết quả\n\n**Free Quick Mode** · LegendaryLite-1";
  }

  if (/(ai là|what is|là gì|giải thích|explain)/i.test(prompt)) {
    return `## Phân tích yêu cầu\n\nBạn đang hỏi: **${prompt}**\n\nLegendary Engine hiện ưu tiên trả lời từ context, memory và các năng lực core đã triển khai. Với dữ liệu kiến thức bên ngoài chưa có trong context, mình sẽ không giả vờ đã tra web.\n\n**Memory liên quan:**\n${memoryText || "- Không có memory được lưu cho phiên này."}`;
  }

  return `## Legendary Engine\n\nMình đã nhận yêu cầu:\n\n> ${prompt}\n\n### Cách mình xử lý\n- Giữ context của các tin nhắn gần nhất.\n- Áp dụng system instruction của LegendaryAI.\n- Ưu tiên câu trả lời có cấu trúc, kiểm chứng được và không bịa nguồn.\n- Dùng memory của tài khoản khi được bật.\n\n**Model core:** ${name}\n**Chế độ:** Native Legendary / Local Core\n\n${memoryText ? "### Memory đang hoạt động\n" + memoryText : "Memory chưa có dữ liệu liên quan."}`;
}

Deno.serve(async (req) => {
  const responseCors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseCors });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401, req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Supabase server configuration is missing.", code: "SERVER_CONFIG" }, 503, req);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: auth } },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401, req);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, 400, req);
  }

  const requestStarted = Date.now();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: "messages is required", code: "MESSAGES_REQUIRED" }, 400, req);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,plan,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled,web_search_enabled")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return json({ error: "Profile not found.", code: "PROFILE_NOT_FOUND" }, 404, req);

  const requested = typeof body.model === "string" ? body.model.trim() : "";
  const provisionalLastUser = [...messages].reverse().find((m: any) => m?.role === "user");
  const provisionalPrompt = textFromContent(provisionalLastUser?.content);
  const reasoningRequested = body.reasoning === true;
  const requestedKey = requested && requested !== "auto"
    ? requested
    : routeModelByTask(profile.plan, profile.role, provisionalPrompt, reasoningRequested);

  const { data: requestedModel } = await supabase
    .from("ai_models")
    .select("key,display_name,tier,provider,model_id,context_window,max_output_tokens,capabilities,system_prompt,enabled,base_url,base_url_env")
    .eq("key", requestedKey)
    .eq("enabled", true)
    .maybeSingle();

  let selectedModel = requestedModel;
  let fallbackUsed = false;

  if (
    !selectedModel ||
    !["local", "ollama-compatible"].includes(selectedModel.provider) ||
    !tierAllowed(profile.role, profile.plan, selectedModel.tier)
  ) {
    const entitledKey = MODEL_BY_PLAN[profile.plan] || MODEL_BY_PLAN.free;
    const fallbackKey = FALLBACK_BY_PLAN[profile.plan] || FALLBACK_BY_PLAN.free;

    let fallback = null;
    const { data: entitledModel } = await supabase
      .from("ai_models")
      .select("key,display_name,tier,provider,model_id,context_window,max_output_tokens,capabilities,system_prompt,enabled,base_url,base_url_env")
      .eq("key", entitledKey)
      .eq("enabled", true)
      .maybeSingle();
    fallback = entitledModel;

    if (!fallback && fallbackKey !== entitledKey) {
      const { data: safeFallback } = await supabase
        .from("ai_models")
        .select("key,display_name,tier,provider,model_id,context_window,max_output_tokens,capabilities,system_prompt,enabled,base_url,base_url_env")
        .eq("key", fallbackKey)
        .eq("enabled", true)
        .maybeSingle();
      fallback = safeFallback;
    }

    selectedModel = fallback;
    fallbackUsed = true;
  }

  if (!selectedModel) {
    return json({ error: "Legendary model chưa được cấu hình cho tài khoản này.", code: "MODEL_NOT_CONFIGURED" }, 503, req);
  }

  const hasImages = messages.some((m: any) => hasImageContent(m?.content));
  if (hasImages && !profile.vision_enabled) {
    return json({
      error: "Phân tích hình ảnh cần gói Pro hoặc Legendary.",
      code: "VISION_PLAN_REQUIRED",
    }, 403, req);
  }

  const capabilities = Array.isArray(selectedModel.capabilities)
    ? selectedModel.capabilities
    : [];
  const planFeatures = PLAN_FEATURES[profile.plan] || PLAN_FEATURES.free;

  const maxContextChars = Math.min(
    Math.max(12000, Number(selectedModel.context_window || 32768) * 3),
    360000,
  );
  const normalizedMessages = cleanMessages(messages, maxContextChars);

  const system =
    (typeof body.system === "string" && body.system.trim())
      ? body.system.trim()
      : (selectedModel.system_prompt || SYSTEM_DEFAULT);

  let memories: string[] = [];
  const memoryLimit = profile.plan === "legendary" || profile.role === "owner" ? 24 : 12;
  if (profile.memory_enabled) {
    const { data: memoryRows } = await supabase
      .from("ai_memories")
      .select("memory,importance")
      .eq("user_id", user.id)
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(memoryLimit);
    memories = (memoryRows || [])
      .map((row: any) => String(row.memory || "").trim())
      .filter(Boolean);
  }

  const lastUser = [...normalizedMessages].reverse().find((m: any) => m?.role === "user");
  const lastUserText = textFromContent(lastUser?.content);

  const requestedTool = normalizeTool(body.tool) || inferTool(lastUserText);
  const localReady = Boolean(Deno.env.get("LEGENDARY_LOCAL_AI_URL"));
  const depth = analysisDepth(
    lastUserText,
    reasoningRequested,
    profile.plan,
    localReady,
    body.analysis_level ?? body.intelligence_level ?? body.reasoning_depth,
  );
  const effectiveSystem = memoryAugmentedSystem(
    system + buildIntelligenceInstruction(lastUserText, depth.tier, reasoningRequested) + toolInstruction(requestedTool),
    memories,
    profile.plan === "legendary" || profile.role === "owner" ? 24 : 10,
  );
  const intent = requestedTool || detectIntent(lastUserText);

  if (profile.memory_enabled) {
    const candidates = extractMemoryCandidates(lastUserText);
    for (const candidate of candidates.slice(0, 3)) {
      const exists = memories.some((m) => m.toLowerCase() === candidate.memory.toLowerCase());
      if (!exists) {
        await supabase.from("ai_memories").insert({
          user_id: user.id,
          memory: candidate.memory,
          source: "chat",
          importance: candidate.importance,
        });
      }
    }
  }

  const estimatedInputTokens = estimateTokens(
    normalizedMessages.map((m: any) => textFromContent(m.content)).join("\n")
  );

  const requestedOutput = Number(body.max_tokens) || Number(selectedModel.max_output_tokens) || 4096;
  const maxTokens = Math.min(
    Math.max(256, requestedOutput),
    Number(selectedModel.max_output_tokens || 4096),
  );
  // Reasoning is intentionally more expensive: reserve and bill a larger
  // token budget so the UI toggle has a real quota cost, not just a label.
  const localReadyForBudget = localReady && selectedModel.provider === 'ollama-compatible';
  const localDepthForBudget = analysisDepth(lastUserText, reasoningRequested, profile.plan, localReadyForBudget, body.analysis_level ?? body.intelligence_level ?? body.reasoning_depth);
  const qualityMultiplier = localReadyForBudget ? Math.max(1, localDepthForBudget.tier) : 1;
  const reasoningMultiplier = reasoningRequested ? 1.75 : 1;
  const estimatedRequestTokens = Math.ceil(
    (estimatedInputTokens + maxTokens) * reasoningMultiplier * qualityMultiplier,
  );
  const reservation = Math.max(
    1,
    Math.min(
      estimatedRequestTokens,
      Number(profile.token_limit || 500000),
    ),
  );

  const { data: allowed, error: tokenError } = await supabase.rpc("consume_tokens", { p_amount: reservation, p_user_id: user.id, p_is_guest: user.is_anonymous === true });

  if (tokenError) return json({ error: tokenError.message, code: "TOKEN_RPC_ERROR" }, 500, req);

  if (!allowed) {
    return json({
      error: "Bạn đã chạm hạn mức token của gói hiện tại. Hãy chờ reset hoặc nâng gói.",
      code: "TOKEN_LIMIT",
      tokenLimit: profile.token_limit,
      tokensUsed: profile.tokens_used,
      model: selectedModel.display_name,
    }, 429, req);
  }

  try {
    const temperature = Math.min(
      1.5,
      Math.max(0, Number(body.temperature ?? 0.35)),
    );

    let text: string;

    let calculatorResult: string | null = null;
    if (requestedTool === "calculator") {
      const cleaned = lastUserText.replace(/^(?:tính|calculate|calculator|calc)[:\s]*/i, "").trim();

      const equation = solveLinearEquation(cleaned);
      const unit = !equation ? convertUnits(cleaned) : null;
      const dateResult = !equation && !unit ? dateReasoning(cleaned) : null;
      const advanced = !equation && !unit && !dateResult ? evaluateAdvancedMath(cleaned) : null;
      const basic = !equation && !unit && !dateResult && !advanced ? safeArithmetic(cleaned) : null;

      if (equation) {
        calculatorResult = `## Giải phương trình\n\n${equation.steps.map((s) => "- " + s).join("\n")}\n\n**Kết quả: x = ${equation.x}**\n\nĐã giải bằng bộ giải phương trình tuyến tính nội bộ của LegendaryAI.`;
      } else if (unit) {
        calculatorResult = `## Quy đổi đơn vị\n\n${unit.formula}\n\n**Kết quả: ${unit.result} ${unit.to}**`;
      } else if (dateResult) {
        calculatorResult = `## Tính toán ngày tháng\n\n${dateResult}`;
      } else if (advanced) {
        calculatorResult = `## Calculator\n\n**${advanced.value}**${advanced.trace.length ? "\n\n" + advanced.trace.map((t) => "- " + t).join("\n") : ""}\n\nĐã tính bằng bộ máy toán học nâng cao (hỗ trợ hàm, lũy thừa, giai thừa) của LegendaryAI.`;
      } else if (basic !== null) {
        calculatorResult = `## Calculator\n\n**${basic}**\n\nĐã tính bằng bộ máy số học an toàn của LegendaryAI.`;
      }

      if (calculatorResult === null) {
        throw new Error("Calculator cần một biểu thức hợp lệ: số học (125*(8+2)), phương trình (2x+5=17), đổi đơn vị (10km to miles) hoặc ngày tháng (01/01/2026 đến 15/03/2026).");
      }
    }

    if (requestedTool === "calculator" && calculatorResult !== null) {
      text = calculatorResult;
    } else if (selectedModel.provider === "ollama-compatible") {
      const baseUrl = selectedModel.base_url ||
        (selectedModel.base_url_env ? Deno.env.get(selectedModel.base_url_env) : "") ||
        "";
      if (!baseUrl) {
        throw new Error(
          "Self-hosted model chưa được cấu hình. Đặt secret LEGENDARY_LOCAL_AI_URL trong Supabase trước khi bật model này.",
        );
      }

      const localDepth = depth.tier > 1 ? depth : analysisDepth(lastUserText, reasoningRequested, profile.plan, true, body.analysis_level ?? body.intelligence_level ?? body.reasoning_depth);
      const enhancedSystem = effectiveSystem;
      text = await ollamaEnhancedResponse(
        baseUrl,
        selectedModel.model_id,
        normalizedMessages,
        enhancedSystem,
        maxTokens,
        temperature,
        localDepth.tier,
      );
    } else {
      text = localLegendaryResponse(
        selectedModel.key,
        normalizedMessages,
        effectiveSystem,
        memories,
      );
    }

    const estimatedOutputTokens = estimateTokens(text);
    const actualTokens = Math.ceil(
      (estimatedInputTokens + estimatedOutputTokens) * reasoningMultiplier * qualityMultiplier,
    );
    const { data: tokenStateRows } = await supabase.rpc("finalize_tokens", {
      p_reserved: reservation,
      p_actual: actualTokens,
    });
    const tokenState = Array.isArray(tokenStateRows) ? tokenStateRows[0] : tokenStateRows;

    const usageLog = supabase.from("ai_usage_logs").insert({
      user_id: user.id,
      model_key: selectedModel.key,
      provider_model: selectedModel.model_id,
      plan: profile.plan,
      input_tokens: estimatedInputTokens,
      output_tokens: estimatedOutputTokens,
      reserved_tokens: reservation,
      request_ms: Date.now() - requestStarted,
      status: "success",
      tool_key: requestedTool || null,
    });

    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(usageLog);
    else await usageLog;

    return json({
      model: selectedModel.key,
      displayModel: selectedModel.display_name || modelName(selectedModel.key),
      providerModel: selectedModel.model_id,
      tier: selectedModel.tier,
      capabilities,
      fallbackUsed,
      local: true,
      selfHosted: selectedModel.provider === "ollama-compatible",
      reasoning: reasoningRequested,
      reasoningMultiplier,
      analysisLevel: depth.tier,
      analysisLabel: depth.label,
      qualityMultiplier,
      native: true,
      text,
      plan: profile.plan,
      planFeatures,
      brain: {
        version: "7.0",
        intent,
        tool: requestedTool || null,
        route: selectedModel.key,
        analysis_level: depth.tier,
        analysis_label: depth.label,
        cognitive_pipeline: depth.tier > 1 ? "multi-pass" : "single-pass",
        memory: profile.memory_enabled,
        session_context: !!planFeatures.session_context,
        memory_count: memories.length,
        capabilities,
        tools: {
          arithmetic: !!planFeatures.smart_math,
          quick_reasoning: !!planFeatures.quick_reasoning,
          smart_formatting: !!planFeatures.smart_formatting,
          summarizer: true,
          translator: true,
          structured_output: true,
          extraction: true,
          planning: true,
          code_review: true,
          calculator: !!planFeatures.smart_math,
          memory: profile.memory_enabled,
          web_search: false,
          vision: !!profile.vision_enabled,
          self_hosted_models: Boolean(Deno.env.get("LEGENDARY_LOCAL_AI_URL")),
        },
      },
      usage: {
        estimated_input_tokens: estimatedInputTokens,
        estimated_output_tokens: estimatedOutputTokens,
        actual_tokens: actualTokens,
        reserved_tokens: reservation,
        tokens_used: Number(tokenState?.tokens_used ?? profile.tokens_used),
        tokens_remaining: Number(tokenState?.tokens_remaining ?? Math.max(Number(profile.token_limit) - Number(profile.tokens_used), 0)),
        token_limit: Number(tokenState?.token_limit ?? profile.token_limit),
        token_reset_at: tokenState?.token_reset_at ?? null,
        reasoning: reasoningRequested,
        reasoning_multiplier: reasoningMultiplier,
        analysis_level: depth.tier,
        analysis_label: depth.label,
        quality_multiplier: qualityMultiplier,
        request_ms: Date.now() - requestStarted,
      },
    }, 200, req);
  } catch (error) {
    await supabase.rpc("refund_tokens", { p_amount: reservation, p_user_id: user.id }).catch(() => null);
    const message = error instanceof Error ? error.message : "Legendary Engine failed.";
    return json({ error: message, code: "LEGENDARY_ENGINE_ERROR" }, 500, req);
  }
});
