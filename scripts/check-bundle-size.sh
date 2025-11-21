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

echo "  Size: $(numfmt --to=iec-i --suffix=B $SIZE 2>/dev/null || echo "${SIZE} bytes")"

# Warn if size is too large
if [ "$SIZE" -gt 10240 ]; then  # 10KB
  echo "  ⚠️  WARNING: configure bundle is larger than 10KB"
fi

# Check config chunk that configure depends on
CONFIG_FILE=$(grep -o 'from "\.\./config-[^"]*"' "$FILE" | sed 's/from "\.\.\/\(.*\)"/\1/')
if [ -n "$CONFIG_FILE" ]; then
  echo ""
  echo "=== $CONFIG_FILE (configure dependency) ==="
  CONFIG_SIZE=$(stat -c%s "dist/$CONFIG_FILE" 2>/dev/null || stat -f%z "dist/$CONFIG_FILE")
  echo "  Size: $(numfmt --to=iec-i --suffix=B $CONFIG_SIZE 2>/dev/null || echo "${CONFIG_SIZE} bytes")"

  TOTAL_SIZE=$((SIZE + CONFIG_SIZE))
  echo ""
  echo "=== Total configure bundle ==="
  echo "  Total: $(numfmt --to=iec-i --suffix=B $TOTAL_SIZE 2>/dev/null || echo "${TOTAL_SIZE} bytes")"

  if [ "$TOTAL_SIZE" -gt 30720 ]; then  # 30KB
    echo "  ⚠️  WARNING: Total configure bundle is larger than 30KB"
  fi
fi

echo ""
echo "=== All configure bundle files ==="
TOTAL_BUNDLE_SIZE=0

# Use process substitution to avoid subshell issue
while IFS= read -r file; do
  SIZE=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file")
  FORMATTED=$(numfmt --to=iec-i --suffix=B "$SIZE" 2>/dev/null || echo "${SIZE} bytes")
  echo "  $file: $FORMATTED"
  TOTAL_BUNDLE_SIZE=$((TOTAL_BUNDLE_SIZE + SIZE))
done < <(find dist/configure -name "*.mjs" -type f 2>/dev/null)

# Show auth/config chunk files that configure depends on
while IFS= read -r file; do
  SIZE=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file")
  FORMATTED=$(numfmt --to=iec-i --suffix=B "$SIZE" 2>/dev/null || echo "${SIZE} bytes")
  echo "  $file: $FORMATTED"
  TOTAL_BUNDLE_SIZE=$((TOTAL_BUNDLE_SIZE + SIZE))
done < <(find dist -maxdepth 1 \( -name "auth-*.mjs" -o -name "config-*.mjs" \) 2>/dev/null)

if [ "$TOTAL_BUNDLE_SIZE" -gt 0 ]; then
  echo ""
  echo "=== Total configure bundle size ==="
  echo "  Total: $(numfmt --to=iec-i --suffix=B $TOTAL_BUNDLE_SIZE 2>/dev/null || echo "${TOTAL_BUNDLE_SIZE} bytes")"

  if [ "$TOTAL_BUNDLE_SIZE" -gt 51200 ]; then  # 50KB
    echo "  ⚠️  WARNING: Total configure bundle is larger than 50KB"
  fi
fi

echo ""
echo "=== Check what's imported ==="
echo "Imports in configure/index.mjs:"
grep -o 'from "[^"]*"' "$FILE" | sort -u | sed 's/^/  /'

echo ""
echo "Done!"
