# Legendary AI — Website 3D (bản nâng cấp)

Website tĩnh (HTML/CSS/JS thuần) gồm: hero 3D bằng Three.js, thống kê động, lưới 8 tính năng, khối "năng lực 1.000.000 token/ngày", khung chat trực tiếp (có streaming), bảng so sánh gói, testimonials, FAQ, CTA band và bảng giá.

## Điểm mới so với bản trước
- **Giao diện sáng/tối**: nút bật/tắt ở header, tự nhớ lựa chọn (localStorage) và theo `prefers-color-scheme` lần đầu.
- **Hiệu ứng cuộn (scroll-reveal)** và **đếm số động** cho khối thống kê.
- **Scroll-spy**: mục menu đang xem được gạch chân tự động.
- **Khung chat kiểu ClaudeAI** (nâng cấp lớn nhất của bản này):
  - **Nhiều hội thoại song song** ở thanh bên: tạo mới, đổi tên (nhấp đúp vào tiêu đề), xoá — mỗi hội thoại lưu riêng trong `localStorage`.
  - **Đính kèm ảnh và tệp văn bản** (`.txt`, `.md`, `.csv`, `.json`, `.log`…) vào tin nhắn; ảnh được gửi dưới dạng nội dung đa phương thức (multimodal) tới API thật nếu model hỗ trợ.
  - **Tạo lại phản hồi** (regenerate) cho câu trả lời cuối cùng, **sao chép** toàn bộ tin nhắn hoặc **sao chép riêng từng khối mã**.
  - **Markdown đầy đủ hơn**: tiêu đề, danh sách, blockquote, bảng, khối mã có nhãn ngôn ngữ + tô sáng cú pháp (highlight.js).
  - **Chế độ toàn màn hình** cho khung chat (nút ⤢ hoặc phím Esc để thoát).
  - Phản hồi trực tiếp theo thời gian thực (**streaming**) khi gọi API thật.
  - Hỗ trợ cả định dạng **Anthropic-compatible** (`/v1/messages`) lẫn **OpenAI-compatible** (`/chat/completions`).
  - Có thể đặt **chỉ dẫn hệ thống** (system prompt) riêng, nút **Dừng** phản hồi đang chạy.
  - Gợi ý câu hỏi nhanh (chat suggestions), đếm ký tự đang gõ.
- **Tài khoản người dùng (demo)**: đăng ký / đăng nhập, menu tài khoản ở header hiển thị gói hiện tại, đăng xuất. Dữ liệu tài khoản lưu trong `localStorage` của trình duyệt — **không phải hệ thống xác thực thật**, xem cảnh báo bên dưới.
- **Mua gói Pro/Legendary + "thanh toán MoMo" (mô phỏng)**: bấm chọn gói ở bảng giá → nếu chưa đăng nhập sẽ được yêu cầu đăng nhập/đăng ký trước → mở màn hình thanh toán kiểu MoMo (QR giả lập + nhập số điện thoại) → xác nhận sẽ giả lập giao dịch thành công và nâng cấp gói của tài khoản. **Chưa kết nối cổng MoMo thật**, xem phần "Về tài khoản & thanh toán MoMo" bên dưới để tích hợp thật.
- Thêm section **So sánh gói**, **Đánh giá người dùng (testimonials)**, **FAQ** (accordion), **CTA band**, nút **lên đầu trang**, footer nhiều cột.
- Meta SEO đầy đủ hơn: Open Graph, Twitter Card, JSON-LD `SoftwareApplication`, canonical URL.
- Trợ năng (a11y): skip-link, `aria-live` cho khung chat, `aria-expanded` cho menu/nav/sidebar/tài khoản, focus-visible rõ ràng, chỉ mở 1 mục FAQ tại một thời điểm.
- Hiệu năng: script `defer`, tạm dừng vòng lặp render 3D khi tab ẩn để tiết kiệm CPU/pin.

## Cấu trúc thư mục
```
legendary-ai/
├── index.html
├── css/style.css
├── js/bg3d.js      -> hiệu ứng 3D nền (quả cầu hạt kiểu mạng nơ-ron), tự tạm dừng khi tab ẩn
├── js/main.js       -> menu mobile, theme sáng/tối, scroll-spy, reveal, đếm số, back-to-top, FAQ
├── js/account.js     -> đăng ký/đăng nhập demo (localStorage), menu tài khoản, chọn gói +
│                        mô phỏng thanh toán MoMo, cập nhật gói hiện tại lên bảng giá
└── js/chat.js        -> logic khung chat: nhiều hội thoại, đính kèm ảnh/tệp, markdown+code
                          highlight, tạo lại phản hồi, toàn màn hình, chế độ mô phỏng/AI thật

## Về tài khoản & thanh toán MoMo

Phần đăng ký/đăng nhập và mua gói hiện là **mô phỏng phía trình duyệt**, phù hợp để demo giao diện nhưng **không an toàn và không xử lý tiền thật**:
- Tài khoản (tên, email, mật khẩu đã băm sơ bộ) chỉ lưu trong `localStorage` — ai mở DevTools trên máy họ cũng xem được, và dữ liệu mất nếu xoá cache trình duyệt.
- Nút "Xác nhận thanh toán" chỉ đợi 1.5 giây rồi tự đánh dấu thành công, không gọi tới MoMo thật.

Để triển khai thật, bạn cần xây dựng một **backend** (Node.js, PHP, v.v.) làm những việc mà một trang tĩnh không thể làm an toàn:
1. **Đăng ký tài khoản MoMo Business** để lấy `partnerCode`, `accessKey`, `secretKey`.
2. Endpoint phía server nhận yêu cầu thanh toán từ trang web, gọi API tạo đơn hàng của MoMo (`/v2/gateway/api/create`) bằng `secretKey` — **secretKey không bao giờ được đặt trong mã JavaScript chạy ở trình duyệt**.
3. Endpoint nhận **IPN callback** từ MoMo để xác nhận giao dịch đã thanh toán thật, sau đó mới cập nhật gói của người dùng trong cơ sở dữ liệu thật (không phải `localStorage`).
4. Hệ thống xác thực người dùng thật (mã hoá mật khẩu bằng bcrypt/argon2, phiên đăng nhập bằng JWT hoặc session cookie, v.v.) thay cho đoạn `js/account.js` hiện tại.

Tài liệu tích hợp chính thức: MoMo Business Portal (business.momo.vn) → mục "Tích hợp thanh toán" / "API Documentation".
```

## Cách đưa lên vibehost.com
1. Đăng nhập bảng quản trị hosting của bạn trên vibehost.com.
2. Vào phần quản lý file (File Manager) hoặc dùng FTP.
3. Tải **toàn bộ nội dung bên trong thư mục `legendary-ai/`** (không phải bản thân thư mục) lên thư mục gốc web (thường là `public_html` hoặc `www`).
4. Đảm bảo `index.html` nằm ngay trong thư mục gốc đó.
5. Mở tên miền của bạn — trang sẽ chạy ngay, không cần cài đặt máy chủ hay cơ sở dữ liệu.
6. (Tuỳ chọn) Sửa lại `og:image`, `canonical` trong `<head>` của `index.html` cho đúng tên miền thật của bạn.

## Về khung chat AI
M��c định trang chạy ở **chế độ mô phỏng**: không gọi bất kỳ API nào, trả lời bằng các câu dựng sẵn theo từ khóa — dùng để demo giao diện miễn phí, không tốn chi phí.

Để chat với một mô hình AI thật:
1. Bấm nút **"⚙ Cài đặt"** trong khung chat.
2. Chọn chế độ **"Gọi API thật"**.
3. Chọn **định dạng API**: Anthropic-compatible (`/v1/messages`) hoặc OpenAI-compatible (`/chat/completions`).
4. Nhập:
   - **API endpoint** (đã điền sẵn giá trị mặc định theo định dạng bạn chọn).
   - **API key** của riêng bạn.
   - **Model**: tên model bạn có quyền dùng.
   - (Tuỳ chọn) **Chỉ dẫn hệ thống**.
5. Bật/tắt **"Phản hồi trực tiếp (streaming)"** tuỳ ý.
6. Lưu cài đặt — key chỉ được lưu trong `localStorage` của trình duyệt bạn, không gửi lên bất kỳ máy chủ nào ngoài chính nhà cung cấp mô hình.

⚠️ **Lưu ý bảo mật quan trọng**: gọi API trực tiếp từ trình duyệt (client-side) nghĩa là API key nằm trong mã chạy phía người dùng — bất kỳ ai mở DevTools trên trình duyệt của chính họ đều có thể thấy key mà họ tự nhập. Cách này phù hợp để **bạn tự dùng cá nhân hoặc demo nội bộ**. Nếu muốn công khai cho nhiều người dùng, bạn cần dựng một máy chủ trung gian (backend) giữ key an toàn và để website chỉ gọi vào máy chủ đó.

## Tuỳ biến nhanh
- Đổi màu thương hiệu: sửa các biến trong `:root` (và `:root[data-theme="light"]`) ở đầu file `css/style.css` (`--accent`, `--accent-2`, `--bg`...).
- Đổi nội dung tính năng/giá/testimonials/FAQ: sửa trực tiếp trong `index.html`.
- Đổi mật độ hạt 3D hoặc tốc độ xoay: sửa `js/bg3d.js` (`particleCount`, hệ số nhân trong hàm `animate`).
- Đổi số liệu ở khối thống kê: sửa thuộc tính `data-count` / `data-suffix` trên các phần tử `.stat-num`.

## Yêu cầu trình duyệt
Cần trình duyệt hỗ trợ WebGL (hầu hết trình duyệt hiện đại đều có). Nếu WebGL không khả dụng, phần nội dung và chat vẫn hoạt động bình thường, chỉ hiệu ứng nền 3D sẽ không hiển thị. Tính năng streaming cần trình duyệt hỗ trợ `ReadableStream` (mọi trình duyệt hiện đại đều có).


## Production upgrade (2026-09)

Nhánh `feature/production-upgrade` bổ sung kiến trúc backend cho LegendaryAI:

- **Supabase Auth + PostgreSQL** thay cho tài khoản demo trong `localStorage`.
- **Google OAuth + GitHub OAuth** trong màn hình đăng nhập.
- **Profiles** lưu gói, hạn mức token và mức sử dụng; gói Free mặc định **250.000 token/ngày**.
- **Lịch sử hội thoại** được đồng bộ theo tài khoản vào PostgreSQL; giao diện vẫn giữ tạo/đổi tên/xoá hội thoại.
- **MoMo production flow**: frontend gọi Edge Function `momo-create-payment`; secretKey chỉ ở server; Edge Function `momo-ipn` xác minh chữ ký callback trước khi đổi trạng thái đơn và gói.
- **Logo** mới tại `assets/logo.svg`.

### Cấu hình Supabase

1. Tạo project Supabase.
2. Chạy toàn bộ `supabase/schema.sql` trong SQL Editor.
3. Mở Auth → Providers và bật Email, Google và GitHub.
4. Thêm callback/redirect URL của website vào Supabase Auth.
5. Điền `url` và `anonKey` vào `js/supabase-config.js`. Chỉ dùng **anon/publishable key** ở frontend; không đưa service-role key vào repo.

### Cấu hình MoMo

Đặt các biến môi trường cho Edge Functions:

- `MOMO_PARTNER_CODE`
- `MOMO_ACCESS_KEY`
- `MOMO_SECRET_KEY`
- `MOMO_ENDPOINT` (test endpoint khi sandbox; production endpoint khi tài khoản được MoMo cấp)
- `SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Deploy hai function:

- `supabase/functions/momo-create-payment`
- `supabase/functions/momo-ipn`

Không đánh dấu đơn hàng hoặc nâng cấp tài khoản từ frontend. Chỉ IPN đã xác minh mới chuyển đơn sang `paid` và cập nhật `profiles.plan`.

### Lưu ý

Repo hiện vẫn là frontend tĩnh nên **backend Supabase phải được cấu hình/deploy** trước khi đăng nhập OAuth, đồng bộ cloud và thanh toán thật hoạt động. API AI hiện tại trong `js/chat.js` vẫn hỗ trợ endpoint tương thích Anthropic/OpenAI; nếu public production, nên chuyển API key/model call sang backend proxy và kiểm tra hạn mức bằng `consume_tokens()`.


### Legendary Engine / model riêng

Edge Function `ai-chat` là lớp gateway cho model backend. Nó giữ API key ở server và hỗ trợ hai profile:

- `legendary-6`: model chính, lấy URL/key/model từ `AI_API_URL`, `AI_API_KEY`, `AI_MODEL`.
- `custom`: model riêng, lấy URL/key/model từ `CUSTOM_AI_API_URL`, `CUSTOM_AI_API_KEY`, `CUSTOM_AI_MODEL`.

Bảng `ai_models` cho phép Owner thay `model_id`, endpoint và system prompt cho từng profile. Giao diện gọi chúng là **Legendary-6**; đây là một model profile/engine do bạn cấu hình, không phải tuyên bố về một foundation model mới được huấn luyện trong repo.


### Owner

The database migration automatically assigns the Owner role to ltrtrongphu@gmail.com on signup and also upgrades the existing matching account when the SQL migration is run. Owner-only server operations are checked against the protected profiles.role field.

### AI backend secrets

For the main engine, configure these Supabase Edge Function secrets:

- AI_API_URL
- AI_API_KEY
- AI_MODEL
- CUSTOM_AI_API_URL (optional)
- CUSTOM_AI_API_KEY (optional)
- CUSTOM_AI_MODEL (optional)

Use an OpenAI-compatible endpoint for the simplest custom-model integration.