#!/bin/bash
# Bundle size checker for @tailor-platform/sdk

set -e

echo "=== SDK Bundle Size Check ==="
echo ""

# Build SDK
echo "Building SDK..."
cd "$(dirname "$0")/../packages/sdk"
pnpm build > /dev/null 2>&1

echo ""
echo "=== configure/index.mjs (User-facing API) ==="
FILE="dist/configure/index.mjs"
SIZE=$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE")
GZIP_SIZE=$(gzip -c "$FILE" | wc -c | tr -d ' ')

echo "  Raw size:  $(numfmt --to=iec-i --suffix=B $SIZE 2>/dev/null || echo "${SIZE} bytes")"
echo "  Gzip size: $(numfmt --to=iec-i --suffix=B $GZIP_SIZE 2>/dev/null || echo "${GZIP_SIZE} bytes")"

# Warn if size is too large
if [ "$SIZE" -gt 10240 ]; then  # 10KB
  echo "  ⚠️  WARNING: configure bundle is larger than 10KB"
fi

# Check auth chunk that configure depends on
AUTH_FILE=$(grep -o 'from "\.\./auth-[^"]*"' "$FILE" | sed 's/from "\.\.\/\(.*\)"/\1/')
if [ -n "$AUTH_FILE" ]; then
  echo ""
  echo "=== $AUTH_FILE (configure dependency) ==="
  AUTH_SIZE=$(stat -c%s "dist/$AUTH_FILE" 2>/dev/null || stat -f%z "dist/$AUTH_FILE")
  AUTH_GZIP=$(gzip -c "dist/$AUTH_FILE" | wc -c | tr -d ' ')
  echo "  Raw size:  $(numfmt --to=iec-i --suffix=B $AUTH_SIZE 2>/dev/null || echo "${AUTH_SIZE} bytes")"
  echo "  Gzip size: $(numfmt --to=iec-i --suffix=B $AUTH_GZIP 2>/dev/null || echo "${AUTH_GZIP} bytes")"

  TOTAL_SIZE=$((SIZE + AUTH_SIZE))
  echo ""
  echo "=== Total configure bundle ==="
  echo "  Total: $(numfmt --to=iec-i --suffix=B $TOTAL_SIZE 2>/dev/null || echo "${TOTAL_SIZE} bytes")"

  if [ "$TOTAL_SIZE" -gt 30720 ]; then  # 30KB
    echo "  ⚠️  WARNING: Total configure bundle is larger than 30KB"
  fi
fi

echo ""
echo "=== All dist files ==="
find dist -name "*.mjs" -exec bash -c 'echo "  $(basename {}): $(stat -c%s {} 2>/dev/null || stat -f%z {} | numfmt --to=iec-i --suffix=B)"' \;

echo ""
echo "=== Check what's imported ==="
echo "Imports in configure/index.mjs:"
grep -o 'from "[^"]*"' "$FILE" | sort -u | sed 's/^/  /'

echo ""
echo "=== Checking for problematic dependencies ==="
PROBLEMATIC=("zod" "yup" "joi" "ajv")
for dep in "${PROBLEMATIC[@]}"; do
  if grep -q "$dep" "$FILE"; then
    echo "  ❌ Found: $dep (should not be in configure bundle)"
  else
    echo "  ✅ Clean: $dep not found"
  fi
done

echo ""
echo "Done!"
