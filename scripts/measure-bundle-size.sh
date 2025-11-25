#!/bin/bash
# Measure bundle size and output in octocov-compatible JSON format

set -e

cd "$(dirname "$0")/../packages/sdk"

# Build SDK if dist doesn't exist or is outdated
if [ ! -d "dist" ]; then
  echo "Building SDK..." >&2
  pnpm build > /dev/null 2>&1
fi

# Measure configure/index.mjs
CONFIGURE_SIZE=0
if [ -f "dist/configure/index.mjs" ]; then
  CONFIGURE_SIZE=$(stat -c%s "dist/configure/index.mjs" 2>/dev/null || stat -f%z "dist/configure/index.mjs")
fi

# Measure dependency chunk files by parsing imports from configure/index.mjs
CHUNK_SIZE=0
if [ -f "dist/configure/index.mjs" ]; then
  CHUNK_FILES=$(grep -oE 'from "[\.]{2}/[^"]+\.mjs"' "dist/configure/index.mjs" | sed 's/from "//; s/"//' | sed 's|^\.\./|dist/|')

  for chunk_file in $CHUNK_FILES; do
    if [ -f "$chunk_file" ]; then
      SIZE=$(stat -c%s "$chunk_file" 2>/dev/null || stat -f%z "$chunk_file")
      CHUNK_SIZE=$((CHUNK_SIZE + SIZE))
    fi
  done
fi

# Calculate total
TOTAL_SIZE=$((CONFIGURE_SIZE + CHUNK_SIZE))

# Convert bytes to KB (with 2 decimal places)
CONFIGURE_SIZE_KB=$(awk "BEGIN {printf \"%.2f\", ${CONFIGURE_SIZE}/1024}")
CHUNK_SIZE_KB=$(awk "BEGIN {printf \"%.2f\", ${CHUNK_SIZE}/1024}")
TOTAL_SIZE_KB=$(awk "BEGIN {printf \"%.2f\", ${TOTAL_SIZE}/1024}")

# Output JSON for octocov
cat <<EOF
{
  "key": "bundle-size",
  "name": "SDK Configure Bundle Size",
  "metrics": [
    {
      "key": "configure-index-size",
      "name": "Configure index.mjs size",
      "value": ${CONFIGURE_SIZE_KB},
      "unit": " KB"
    },
    {
      "key": "auth-config-chunk-size",
      "name": "Auth/Config chunk size",
      "value": ${CHUNK_SIZE_KB},
      "unit": " KB"
    },
    {
      "key": "total-bundle-size",
      "name": "Total bundle size",
      "value": ${TOTAL_SIZE_KB},
      "unit": " KB"
    }
  ]
}
EOF
