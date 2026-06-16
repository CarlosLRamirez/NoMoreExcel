#!/usr/bin/env bash
set -euo pipefail

# Descarga la versión PINEADA de PocketBase para el SO/arquitectura actual
# en pb/pocketbase.
PB_VERSION="0.39.4"

cd "$(dirname "$0")/.."
mkdir -p pb

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) goos="darwin" ;;
  Linux)  goos="linux" ;;
  *) echo "SO no soportado por este script: $os (descarga manual desde pocketbase.io)"; exit 1 ;;
esac

case "$arch" in
  x86_64|amd64) goarch="amd64" ;;
  arm64|aarch64) goarch="arm64" ;;
  *) echo "Arquitectura no soportada: $arch"; exit 1 ;;
esac

zip="pocketbase_${PB_VERSION}_${goos}_${goarch}.zip"
url="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${zip}"

echo "Descargando $url ..."
tmp="$(mktemp -d)"
curl -fsSL "$url" -o "$tmp/$zip"
unzip -o "$tmp/$zip" -d "$tmp" >/dev/null
mv "$tmp/pocketbase" pb/pocketbase
chmod +x pb/pocketbase
rm -rf "$tmp"

echo "PocketBase v${PB_VERSION} instalado en pb/pocketbase"
pb/pocketbase --version
