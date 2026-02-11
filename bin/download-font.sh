#!/usr/bin/env bash
set -euo pipefail

VERSION="5.0.0-beta.3"
TAG="n${VERSION}"
BASE_URL="https://github.com/etbcor/nasin-nanpa/releases/download/${TAG}"

FONTS_DIR="$(dirname "$0")/../public/fonts"
mkdir -p "$FONTS_DIR"

echo "Downloading nasin-nanpa v${VERSION} fonts..."

curl -fL -o "$FONTS_DIR/nasin-nanpa.otf" \
  "${BASE_URL}/nasin-nanpa-${VERSION}.otf"

curl -fL -o "$FONTS_DIR/nasin-nanpa-ucsur.otf" \
  "${BASE_URL}/nasin-nanpa-${VERSION}-UCSUR.otf"

echo "Fonts downloaded to $FONTS_DIR"
ls -la "$FONTS_DIR"
