#!/bin/bash
# Runtime performance benchmark for tailor-sdk generate and apply -d commands
# These options ensure the script fails on errors
set -euo pipefail

# Get script directory before changing directories
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_DIR="${SCRIPT_DIR}/../.."

# Cross-platform millisecond timestamp function
get_timestamp_ms() {
  if command -v gdate &> /dev/null; then
    # macOS with coreutils
    gdate +%s%3N
  elif date +%s%3N &> /dev/null 2>&1; then
    # Linux or BSD with millisecond support
    date +%s%3N
  else
    # Fallback: use perl for millisecond precision
    perl -MTime::HiRes=time -e 'printf "%.0f\n", time * 1000'
  fi
}

cd "${SCRIPT_DIR}/../../../../example"

ITERATIONS=${1:-10}
OUTPUT_FILE="${SDK_DIR}/runtime-perf.json"
SUMMARY_FILE="${SDK_DIR}/runtime-perf-summary.json"
LOG_DIR=$(mktemp -d)
trap "rm -rf ${LOG_DIR}" EXIT

echo "Running runtime performance benchmark..."
echo "Iterations: ${ITERATIONS}"
echo ""

# Arrays to store timing results
declare -a GENERATE_TIMES
declare -a APPLY_DRY_TIMES

# Warmup runs (not counted) to avoid cold-start effects
echo "Warmup: Running generate..."
if ! pnpm generate > "${LOG_DIR}/generate-warmup.log" 2>&1; then
  echo "ERROR: generate warmup failed"
  cat "${LOG_DIR}/generate-warmup.log"
  exit 1
fi

echo "Warmup: Running apply (build-only)..."
if ! TAILOR_PLATFORM_SDK_BUILD_ONLY=true pnpm exec tailor-sdk apply -c tailor.config.ts > "${LOG_DIR}/apply-warmup.log" 2>&1; then
  echo "ERROR: apply warmup failed"
  cat "${LOG_DIR}/apply-warmup.log"
  exit 1
fi

echo ""
echo "Starting measurements..."
echo ""

# Measure generate command
echo "Measuring generate command..."
for i in $(seq 1 $ITERATIONS); do
  echo "  generate iteration $i/$ITERATIONS..."
  START=$(get_timestamp_ms)
  if ! pnpm generate > "${LOG_DIR}/generate-iter-${i}.log" 2>&1; then
    echo "ERROR: generate iteration $i failed"
    cat "${LOG_DIR}/generate-iter-${i}.log"
    exit 1
  fi
  END=$(get_timestamp_ms)
  ELAPSED=$((END - START))
  GENERATE_TIMES+=($ELAPSED)
done

echo ""

# Measure apply (build-only) command
echo "Measuring apply (build-only) command..."
for i in $(seq 1 $ITERATIONS); do
  echo "  apply iteration $i/$ITERATIONS..."
  START=$(get_timestamp_ms)
  if ! TAILOR_PLATFORM_SDK_BUILD_ONLY=true pnpm exec tailor-sdk apply -c tailor.config.ts > "${LOG_DIR}/apply-iter-${i}.log" 2>&1; then
    echo "ERROR: apply iteration $i failed"
    cat "${LOG_DIR}/apply-iter-${i}.log"
    exit 1
  fi
  END=$(get_timestamp_ms)
  ELAPSED=$((END - START))
  APPLY_DRY_TIMES+=($ELAPSED)
done

echo ""

# Function to calculate statistics (max and median only)
calculate_stats() {
  local -n arr=$1
  local max=${arr[0]}
  local count=${#arr[@]}

  # Calculate max
  for val in "${arr[@]}"; do
    ((val > max)) && max=$val
  done

  # Sort for median
  IFS=$'\n' sorted=($(sort -n <<<"${arr[*]}")); unset IFS
  local mid=$((count / 2))
  local median
  if ((count % 2 == 0)); then
    median=$(( (sorted[mid-1] + sorted[mid]) / 2 ))
  else
    median=${sorted[$mid]}
  fi

  echo "$max $median"
}

# Calculate stats for generate
read GEN_MAX GEN_MEDIAN <<< $(calculate_stats GENERATE_TIMES)

# Calculate stats for apply
read APPLY_MAX APPLY_MEDIAN <<< $(calculate_stats APPLY_DRY_TIMES)

# Display summary
echo "=== Summary ==="
echo ""
printf "%-20s %10s %10s\n" "Command" "Max" "Median"
printf "%-20s %10s %10s\n" "-------" "---" "------"
printf "%-20s %10s %10s\n" "generate" "${GEN_MAX}ms" "${GEN_MEDIAN}ms"
printf "%-20s %10s %10s\n" "apply (build)" "${APPLY_MAX}ms" "${APPLY_MEDIAN}ms"
echo ""

# Generate JSON for octocov
echo "Generating ${OUTPUT_FILE}..."

cat > "$OUTPUT_FILE" << EOF
{
  "key": "runtime-performance",
  "name": "Runtime Performance",
  "metrics": [
    {"key": "generate-median", "name": "Generate Median", "value": ${GEN_MEDIAN}, "unit": "ms"},
    {"key": "generate-max", "name": "Generate Max", "value": ${GEN_MAX}, "unit": "ms"},
    {"key": "apply-build-median", "name": "Apply Build Median", "value": ${APPLY_MEDIAN}, "unit": "ms"},
    {"key": "apply-build-max", "name": "Apply Build Max", "value": ${APPLY_MAX}, "unit": "ms"}
  ]
}
EOF

# Generate summary JSON with raw data
echo "Generating ${SUMMARY_FILE}..."

# Convert arrays to JSON format
gen_times_json=$(printf '%s\n' "${GENERATE_TIMES[@]}" | jq -s '.')
apply_times_json=$(printf '%s\n' "${APPLY_DRY_TIMES[@]}" | jq -s '.')

cat > "$SUMMARY_FILE" << EOF
{
  "generate": {
    "iterations": ${ITERATIONS},
    "times": ${gen_times_json},
    "max": ${GEN_MAX},
    "median": ${GEN_MEDIAN}
  },
  "apply-build": {
    "iterations": ${ITERATIONS},
    "times": ${apply_times_json},
    "max": ${APPLY_MAX},
    "median": ${APPLY_MEDIAN}
  }
}
EOF

echo "Results written to ${OUTPUT_FILE} and ${SUMMARY_FILE}"
