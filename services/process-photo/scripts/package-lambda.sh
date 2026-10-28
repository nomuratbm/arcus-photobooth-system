#!/usr/bin/env bash
set -euo pipefail

# Package Lambda for AWS Linux Runtime
# Usage: ./package-lambda.sh [arm64|x64]
# Default architecture is arm64 (Graviton2 - better price/performance)

ARCH="${1:-arm64}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${SERVICE_DIR}/dist"
STAGING_DIR="${DIST_DIR}/staging"
ZIP_FILE="${DIST_DIR}/process-photo-${ARCH}.zip"

echo "===================================================="
echo " Packaging process-photo Lambda for AWS Linux (${ARCH})"
echo "===================================================="

# 1. Clean previous staging & dist
rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}" "${DIST_DIR}"

# 2. Build TypeScript bundle using esbuild
echo "1. Bundling code with esbuild..."
cd "${SERVICE_DIR}"
npm run build

# 3. Copy bundle into staging
cp "${DIST_DIR}/index.mjs" "${STAGING_DIR}/index.mjs"

# 4. Prepare staging package.json for production dependencies
cat << 'EOF' > "${STAGING_DIR}/package.json"
{
  "name": "process-photo-deployment",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "sharp": "^0.33.5",
    "dotenv": "^16.4.7"
  }
}
EOF

# 5. Install native Sharp binaries for target Linux architecture
echo "2. Installing native Sharp binaries for linux-${ARCH}..."
cd "${STAGING_DIR}"

npm install --omit=dev sharp dotenv

if [ "${ARCH}" = "arm64" ]; then
  npm install --force --os=linux --cpu=arm64 @img/sharp-linux-arm64
else
  npm install --force --os=linux --cpu=x64 @img/sharp-linux-x64
fi

# 6. Create deployment zip
echo "3. Creating deployment archive..."
rm -f "${ZIP_FILE}"
cd "${STAGING_DIR}"
zip -q -r "${ZIP_FILE}" index.mjs node_modules package.json

# 7. Summary
ZIP_SIZE=$(du -h "${ZIP_FILE}" | cut -f1)
echo "===================================================="
echo "  Success! Package created:"
echo "  Location: ${ZIP_FILE}"
echo "  Size:     ${ZIP_SIZE}"
echo "  Handler:  index.handler"
echo "  Runtime:  nodejs20.x (${ARCH})"
echo "===================================================="
