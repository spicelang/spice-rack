#!/usr/bin/env bash
# Creates the TLS certificate nginx needs, before or while the stack starts.
#
#   scripts/init-tls.sh            Let's Encrypt certificate for $DOMAIN (needs DNS pointing here, ports 80/443 open)
#   DOMAIN=localhost scripts/init-tls.sh   self-signed certificate for local use
#
# Certificates live in ./data/letsencrypt, renewals are handled by the `certbot` service of docker-compose.yml.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PRESET_DOMAIN="${DOMAIN:-}"
[ -f .env ] && set -a && . ./.env && set +a
DOMAIN="${PRESET_DOMAIN:-${DOMAIN:-rack.spicelang.com}}"
LIVE="data/letsencrypt/live/$DOMAIN"
mkdir -p "$LIVE" data/certbot-www

selfsigned() {
  openssl req -x509 -nodes -newkey rsa:2048 -days "$1" -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN" \
    -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" 2>/dev/null
}

if [ "$DOMAIN" = "localhost" ]; then
  selfsigned 825
  echo "Self-signed certificate written to $LIVE. Start the stack with: docker compose up -d --build"
  exit 0
fi

# nginx refuses to start without a certificate, so begin with a throw-away one and replace it by the real one
[ -f "$LIVE/fullchain.pem" ] || selfsigned 1
docker compose up -d --build nginx
rm -rf "data/letsencrypt/live/$DOMAIN" "data/letsencrypt/archive/$DOMAIN" "data/letsencrypt/renewal/$DOMAIN.conf"
EMAIL_ARGS=(--register-unsafely-without-email)
[ -n "${LETSENCRYPT_EMAIL:-}" ] && EMAIL_ARGS=(--email "$LETSENCRYPT_EMAIL")
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" "${EMAIL_ARGS[@]}" --agree-tos --no-eff-email --non-interactive
docker compose exec nginx nginx -s reload
echo "Certificate for $DOMAIN installed."
