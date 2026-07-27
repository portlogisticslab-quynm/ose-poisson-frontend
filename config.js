// Development default. Override this value when deploying the frontend.
window.OSE_API_BASE = window.OSE_API_BASE || (
  ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://127.0.0.1:8000"
    : "https://ose-poisson-backend.onrender.com"
);
