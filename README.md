Legendary AI — Website + AI Chat tích hợp

Legendary AI là website HTML/CSS/JS thuần với trải nghiệm chat kiểu các trợ lý AI hiện nay: nhiều hội thoại, Markdown/code, đính kèm tệp/ảnh, đăng ký/đăng nhập, lịch sử theo tài khoản và Legendary Engine gọi model qua Supabase Edge Function.

Những gì đã tích hợp

Chat AI ngay trên website: người dùng không cần mở một website AI khác và không cần dán API key vào trình duyệt.

Legendary Engine mặc định: sau khi đăng nhập, hệ thống tự chọn model theo gói Free/Pro/Legendary.

API key an toàn hơn: key của model nằm trong Supabase Edge Function, không nằm trong localStorage hay frontend.

Đăng ký + đăng nhập bằng email/mật khẩu ngay trên website.

Google/GitHub OAuth nếu bật trong Supabase Auth.

Đồng bộ lịch sử chat theo tài khoản vào PostgreSQL; vẫn có cache local để giao diện phản hồi nhanh.

Nhiều cuộc trò chuyện: tạo mới, đổi tên, xoá, regenerate, copy câu trả lời/code.

Đính kèm ảnh/tệp; vision được kiểm soát theo gói.

Hạn mức token theo tài khoản, reset tự động và kiểm soát bằng RPC phía database.

Owner dashboard + model registry để quản lý model/backend.

MoMo dùng Edge Functions, secret key không đặt trong frontend.

Cấu trúc chính

LegendaryAI-main/
├── index.html
├── css/
│   └── style.css
├── assets/
│   └── logo.svg
├── js/
│   ├── account.js
│   ├── ai-engine.js
│   ├── bg3d.js
│   ├── chat.js
│   ├── cloud-sync.js
│   ├── main.js
│   └── supabase-config.js
└── supabase/
    ├── schema.sql
    └── functions/
        ├── ai-chat/index.ts
        ├── owner-stats/index.ts
        ├── momo-create-payment/index.ts
        ├── momo-ipn/index.ts
        └── _shared/momo.ts

Cấu hình để AI thật hoạt động

1. Supabase

Tạo project trên Supabase.

Chạy toàn bộ file:

supabase/schema.sql

trong SQL Editor.

Vào Authentication → Providers và bật Email. Có thể bật thêm Google/GitHub.

Thêm URL website vào Redirect URLs.

Sửa:

js/supabase-config.js

thành URL project và anon/publishable key của bạn.

Chỉ đưa anon/publishable key vào frontend. Không đưa service_role key vào js/supabase-config.js.

2. Model AI

AI thật chạy qua:

supabase/functions/ai-chat/index.ts

Frontend chỉ gọi function ai-chat.

Cấu hình các secret ở Supabase Edge Functions:

SUPABASE_SERVICE_ROLE_KEY
SITE_URL
LEGENDARY_LOCAL_AI_URL
MOMO_PARTNER_CODE
MOMO_ACCESS_KEY
MOMO_SECRET_KEY
MOMO_ENDPOINT

Nếu muốn dùng model khác, sửa model registry trong:

supabase/schema.sql

hoặc chỉnh các bản ghi trong bảng public.ai_models bằng Owner.

Các model mặc định là product profiles, không phải tên của một foundation model do repo tự huấn luyện:

Free      → legendary-lite-1
Pro       → auto → Reasoner 32B* / Vision Pro 11B* → fallback LegendaryPro-1
Legendary → auto → Ultra 120B* / Vision 109B* → fallback LegendaryUltra-1
Owner     → custom / toàn quyền model registry

* Model self-hosted chỉ được chọn khi bản ghi ai_models đã enabled.

3. Deploy Edge Functions

Sau khi cấu hình Supabase CLI, deploy:

supabase/functions/ai-chat
supabase/functions/owner-stats
supabase/functions/momo-create-payment
supabase/functions/momo-ipn

Quan trọng: không nhúng API key của model hoặc MoMo vào frontend.

Luồng người dùng mới

Website
  ↓
Đăng ký / Đăng nhập
  ↓
Supabase Auth
  ↓
Chat Legendary AI
  ↓
Supabase Edge Function: ai-chat
  ↓
Model backend (Legendary native hoặc self-hosted Ollama-compatible)
  ↓
Trả câu trả lời về website

Người dùng chỉ tương tác với Legendary AI trên website. API key của model được giữ ở server.

File đã được nâng cấp

index.html — tích hợp trạng thái tài khoản ngay trong khung chat, đổi phần mô tả sang Legendary Engine, thêm UX đăng nhập và thông báo đăng ký.

js/chat.js — Legendary Engine trở thành chế độ chat mặc định, yêu cầu đăng nhập trước khi gửi AI thật, tự hiển thị model/gói và nút tài khoản ngay trong chat.

js/account.js — cải thiện đăng ký, thêm luồng quên mật khẩu và sửa Owner dashboard gọi đúng Supabase client.

css/style.css — thêm style cho trạng thái tài khoản và thông báo auth trong chat.

README.md — cập nhật hướng dẫn triển khai AI/auth production.

Lưu ý

Repo không thể tự biết URL/anon key của project Supabase hoặc API key model của bạn. Vì vậy sau khi copy các file lên hosting, bạn vẫn cần cấu hình các secret ở Supabase. Đây là phần bắt buộc để đăng ký/đăng nhập và AI thật hoạt động an toàn.

### Legendary-only mode

LegendaryAI hiện sử dụng **Legendary Engine** làm đường AI duy nhất.

| Gói | Model profile | Backend |
|---|---|---|
| Free | LegendaryLite-1 | Native Legendary Core |
| Pro | Reasoner 32B* / Vision Pro 11B* / LegendaryPro-1 fallback | Native + self-hosted Ollama |
| Legendary | Ultra 120B* / Vision 109B* / LegendaryUltra-1 fallback | Native + self-hosted Ollama |
| Owner | Legendary Custom Core | Native Legendary Core |

External AI (Claude / OpenAI / ChatGPT / Anthropic) đang **tạm ngừng hỗ trợ** ở frontend và gateway. Browser không cần, không lưu và không gửi API key AI bên ngoài.

Legendary Engine hiện tập trung vào:
- routing model theo gói và quyền Owner;
- context dài, chuẩn hoá lịch sử hội thoại và token reservation;
- memory retrieval khi tài khoản được bật memory;
- core tính toán số học an toàn;
- multimodal image payloads qua Ollama cho các gói đã bật vision;
- các bộ xử lý chuyên biệt cho code/debug, viết, tóm tắt và giải thích;
- usage logging, quota và refund khi engine lỗi;
- CORS/error handling rõ ràng ở Supabase Edge Function.

**Quan trọng:** Native Legendary Core hiện là engine/orchestration nội bộ, chưa phải một foundation model neural có năng lực ngang ChatGPT/Claude. Muốn có khả năng sinh ngôn ngữ tự do ở mức foundation-model, cần triển khai một model backend/weights riêng của LegendaryAI. Việc này có thể làm sau mà không cần đưa API key vào frontend.

### Native high-end model profiles

LegendaryAI now has a self-hosted model gateway in `ai-chat` for Ollama-compatible servers. The catalog includes:

- **Legendary Reasoner 32B** → `qwen3:30b` (Pro)
- **Legendary Vision Pro 11B** → `llama3.2-vision:11b` (Pro)
- **Legendary Ultra 120B** → `gpt-oss:120b` (Legendary)
- **Legendary Vision 109B** → `llama4:scout` (Legendary)

These profiles are intentionally disabled until a self-hosted inference server is configured. This keeps the product independent of third-party AI APIs while avoiding fake claims that a large model is already running.

Ollama exposes the configured model families through its local API. The Pro vision profile uses Llama 3.2 Vision 11B; the larger reasoning/vision profiles remain disabled until the private inference server is ready.

Set the Supabase Edge Function secret:

`LEGENDARY_LOCAL_AI_URL=https://your-private-ollama-server`

Then enable the desired `ai_models` row. Do not put this URL or any private inference credentials in browser JavaScript.

### Paid plans

- **Pro — 149.000đ/tháng:** 2.000.000 token/ngày, Reasoner 32B*, Vision Pro 11B*, long context, memory, Prompt Studio và export Markdown.
- **Legendary — 399.000đ/tháng:** 6.000.000 token/ngày, Ultra 120B*, Vision 109B*, Advanced Memory và routing model cao cấp.
- **Free — 0đ/tháng: 150.000 token/ngày, LegendaryLite-1 nâng cấp, Quick Mode, máy tính và session context.

### Conversation URLs

- `/new` creates a fresh chat.
- After the first user message, the route becomes `/chat/<ten-chat>`.
- Conversation slugs are persisted in Supabase so cloud sync can keep deep links stable.
- Browser Back/Forward switches conversations without losing the current thread.

### Deploy

Frontend trên Vercel có thể tự deploy khi push GitHub nếu project Vercel đã liên kết repo.

Supabase Edge Function `ai-chat` cần được deploy lên project Supabase sau khi cập nhật code. Nếu bạn kết nối Supabase với ChatGPT, có thể triển khai function và xem log trực tiếp; không đặt service-role key trong frontend.

Supabase project:
https://ampddcztjvejwjirqoer.supabase.co

Publishable key nằm trong `js/supabase-config.js`. Không đặt service-role key hoặc secret AI/MoMo vào frontend.
