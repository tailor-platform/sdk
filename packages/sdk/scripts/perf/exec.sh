#!/bin/bash
# These options ensure the script fails when diagnostics encounter errors.
set -euo pipefail

cd "$(dirname "$0")/../.."

FEATURES_DIR="scripts/perf/features"
OUTPUT_FILE="diagnostics.json"
TEMP_TSCONFIG="scripts/perf/tsconfig.temp.json"

echo "Running type inference performance measurement..."
echo ""

# Define features to test (must match filenames in features/ directory)
FEATURES=(
  "tailordb-basic"
  "tailordb-optional"
  "tailordb-relation"
  "tailordb-validate"
  "tailordb-hooks"
  "tailordb-object"
  "tailordb-enum"
  "resolver-basic"
  "resolver-nested"
  "resolver-array"
  "executor-schedule"
  "executor-webhook"
  "executor-record"
  "executor-resolver"
  "executor-operation-function"
  "executor-operation-gql"
  "executor-operation-webhook"
  "executor-operation-workflow"
)

echo "Running TypeScript compiler for each feature..."
echo ""

# Collect results
declare -A INSTANTIATIONS
declare -A TYPES

for feature in "${FEATURES[@]}"; do
  file="${FEATURES_DIR}/${feature}.ts"

  echo "  Checking ${feature}..."

  # Create temporary tsconfig for this feature
  cat > "$TEMP_TSCONFIG" << TSCONFIG
{
  "extends": "../../tsconfig.json",
  "include": ["features/${feature}.ts"],
  "exclude": []
}
TSCONFIG

  # Run tsc with the temporary tsconfig and capture output
  tsc_output=$(pnpm exec tsc -p "$TEMP_TSCONFIG" --noEmit --skipLibCheck --diagnostics 2>&1 || true)

  # Extract instantiations and types
  inst=$(echo "$tsc_output" | grep -E "^Instantiations:" | sed 's/Instantiations: *//' || echo "0")
  types=$(echo "$tsc_output" | grep -E "^Types:" | sed 's/Types: *//' || echo "0")

  INSTANTIATIONS[$feature]=$inst
  TYPES[$feature]=$types
done

# Clean up temporary tsconfig
rm -f "$TEMP_TSCONFIG"

echo ""

# Display summary
echo "=== Summary ==="
echo ""
printf "%-30s %15s %10s\n" "Feature" "Instantiations" "Types"
printf "%-30s %15s %10s\n" "-------" "--------------" "-----"
for feature in "${FEATURES[@]}"; do
  printf "%-30s %15s %10s\n" "$feature" "${INSTANTIATIONS[$feature]}" "${TYPES[$feature]}"
done

echo ""

# Generate combined JSON for octocov
echo "Generating ${OUTPUT_FILE}..."

# Build metrics array
metrics_json="["
first=true
for feature in "${FEATURES[@]}"; do
  if [ "$first" = true ]; then
    first=false
  else
    metrics_json+=","
  fi
  metrics_json+="{\"key\":\"${feature}-instantiations\",\"name\":\"${feature} (instantiations)\",\"value\":${INSTANTIATIONS[$feature]},\"unit\":\"\"},"
  metrics_json+="{\"key\":\"${feature}-types\",\"name\":\"${feature} (types)\",\"value\":${TYPES[$feature]},\"unit\":\"\"}"
done
metrics_json+="]"

# Write final JSON
cat > "$OUTPUT_FILE" << EOF
{
  "key": "type-performance",
  "name": "Type Performance",
  "metrics": ${metrics_json}
}
EOF

echo "Results written to ${OUTPUT_FILE}"
