#!/bin/sh
# Self-signed certificate for the local OAuth callback server (https://localhost).
set -e
umask 077 # the key is readable only by you
mkdir -p secrets
chmod 700 secrets
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout secrets/localhost-key.pem -out secrets/localhost-cert.pem \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
echo "Created secrets/localhost-cert.pem and secrets/localhost-key.pem"
