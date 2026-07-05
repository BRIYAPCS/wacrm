#!/usr/bin/env bash
# ============================================================
# setup-waha-server.sh — stand up a WAHA (GOWS) WhatsApp gateway on a fresh
# Ubuntu VM (Linode, DigitalOcean, EC2, …) for a wacrm deployment.
#
# Run it as root on the NEW VM:
#     bash setup-waha-server.sh
#
# It installs Docker, runs WAHA with a freshly generated API key (the server
# stores only the key's sha512 hash), and prints the four env vars to paste
# into that client's wacrm app. Safe to re-run (recreates the container;
# sessions persist in the mounted volume).
# ============================================================
set -euo pipefail

echo "==> Installing Docker (if needed)…"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

echo "==> Generating credentials…"
API_KEY="waha_$(openssl rand -hex 24)"
API_HASH="sha512:$(printf %s "$API_KEY" | openssl dgst -sha512 | awk '{print $2}')"
HMAC_KEY="$(openssl rand -hex 32)"
DASH_PW="$(openssl rand -base64 18)"

echo "==> Starting WAHA (engine GOWS)…"
mkdir -p /root/waha/sessions
docker rm -f waha >/dev/null 2>&1 || true
docker run -d --name waha --restart always \
  -p 3000:3000 \
  -e WHATSAPP_DEFAULT_ENGINE=GOWS \
  -e WAHA_API_KEY="$API_HASH" \
  -e WHATSAPP_RESTART_ALL_SESSIONS=true \
  -e WAHA_DASHBOARD_ENABLED=true \
  -e WAHA_DASHBOARD_USERNAME=admin \
  -e WAHA_DASHBOARD_PASSWORD="$DASH_PW" \
  -e WHATSAPP_SWAGGER_ENABLED=false \
  -v /root/waha/sessions:/app/.sessions \
  devlikeapro/waha >/dev/null

# Save a recreate script that keeps the SAME credentials.
cat > /root/waha/run.sh <<RUN
#!/usr/bin/env bash
set -e
docker rm -f waha 2>/dev/null || true
docker run -d --name waha --restart always -p 3000:3000 \\
  -e WHATSAPP_DEFAULT_ENGINE=GOWS \\
  -e WAHA_API_KEY="$API_HASH" \\
  -e WHATSAPP_RESTART_ALL_SESSIONS=true \\
  -e WAHA_DASHBOARD_ENABLED=true \\
  -e WAHA_DASHBOARD_USERNAME=admin \\
  -e WAHA_DASHBOARD_PASSWORD="$DASH_PW" \\
  -e WHATSAPP_SWAGGER_ENABLED=false \\
  -v /root/waha/sessions:/app/.sessions \\
  devlikeapro/waha
RUN
chmod +x /root/waha/run.sh

IP="$(curl -fsSL https://api.ipify.org 2>/dev/null || echo YOUR_VM_IP)"

cat <<OUT

============================================================
 WAHA is running on this VM.
 Dashboard:  http://$IP:3000/dashboard   (admin / $DASH_PW)
 Recreate:   /root/waha/run.sh
============================================================
 Paste these into the wacrm app's environment (.env):

WAHA_BASE_URL=http://$IP:3000
WAHA_API_KEY=$API_KEY
WAHA_WEBHOOK_HMAC_KEY=$HMAC_KEY
WAHA_WEBHOOK_URL=https://YOUR_APP_PUBLIC_URL

 (set WAHA_WEBHOOK_URL to that deployment's public URL)
============================================================
 PRODUCTION: put WAHA behind HTTPS (reverse proxy / Cloudflare
 Tunnel) and use the https:// URL for WAHA_BASE_URL, so the API
 key and QR images don't travel in the clear.
============================================================
OUT
