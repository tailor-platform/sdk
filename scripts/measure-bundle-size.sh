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

# Measure auth/config chunk files
CHUNK_SIZE=0
for file in dist/auth-*.mjs dist/config-*.mjs; do
  if [ -f "$file" ]; then
    SIZE=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file")
    CHUNK_SIZE=$((CHUNK_SIZE + SIZE))
  fi
done

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
