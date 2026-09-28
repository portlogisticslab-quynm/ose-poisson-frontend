// Chọn backend: máy desktop (chính) → Render (dự phòng) → localhost (khi phát triển)
(function () {
  const BACKENDS = {
    home:   "https://api-poisson.ose.vn",                    // máy desktop qua Cloudflare Tunnel
    render: "https://ose-poisson-backend-1.onrender.com",    // Render (dự phòng)
    local:  "http://127.0.0.1:8000",                         // chạy trên máy khi phát triển
  };

  const done = (base) => {
    window.OSE_API_BASE = base;
    window.OSE_API_READY = Promise.resolve(base);
  };

  // 1. Đã được gán từ nơi khác thì giữ nguyên
  if (window.OSE_API_BASE) return done(window.OSE_API_BASE);

  // 2. Đang chạy trên localhost
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return done(BACKENDS.local);

  // 3. Ép chọn bằng URL: ?api=home | ?api=render | ?api=auto (bỏ ép)
  let forced = new URLSearchParams(location.search).get("api");
  try {
    if (forced === "auto") { localStorage.removeItem("ose_api"); forced = null; }
    else if (forced) localStorage.setItem("ose_api", forced);
    else forced = localStorage.getItem("ose_api");
  } catch (e) {}
  if (forced && BACKENDS[forced]) return done(BACKENDS[forced]);

  // 4. Tự động: thử máy desktop, không được thì chuyển sang Render
  window.OSE_API_BASE = BACKENDS.home;

  async function alive(base, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(base + "/api/health", { signal: ctrl.signal, cache: "no-store" });
      return r.ok;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  window.OSE_API_READY = (async () => {
    if (await alive(BACKENDS.home, 4000)) return BACKENDS.home;
    console.warn("[OSE] Máy chủ chính không phản hồi, chuyển sang Render");
    window.OSE_API_BASE = BACKENDS.render;
    return BACKENDS.render;
  })();
})();
