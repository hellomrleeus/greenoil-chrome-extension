#!/usr/bin/env bash
set -e

# Change directory to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

EXTENSION_NAME="greenoil-route-assistant"
VERSION=$(grep '"version"' manifest.json | head -n 1 | awk -F '"' '{print $4}')
if [ -z "$VERSION" ]; then
  VERSION="1.0.0"
fi

OUTPUT="${EXTENSION_NAME}-v${VERSION}.zip"
rm -f "$OUTPUT"

echo "Creating package: $OUTPUT for version $VERSION ..."

zip -r "$OUTPUT" . \
  -x ".*" \
  -x ".git/*" \
  -x ".DS_Store" \
  -x "tests/*" \
  -x "scripts/*" \
  -x "tmp-profile2/*" \
  -x "CHROMEWEBSTORE.md" \
  -x "README.md" \
  -x "*.zip"

echo "Packaging complete!"
echo "Package file: $(pwd)/$OUTPUT"
echo "Package size: $(du -h "$OUTPUT" | cut -f1)"
