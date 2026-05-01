#!/bin/bash
# convert-animations.sh — Convert id8 I2V outputs to blog-ready WebM hero animations
#
# Usage:
#   bash scripts/convert-animations.sh              # Convert all completed renders
#   bash scripts/convert-animations.sh --status      # Show batch progress
#   bash scripts/convert-animations.sh --dry-run     # Show what would be converted

set -euo pipefail

DB="/home/danko/projects/id8/data/pipeline.db"
COMFYUI_OUTPUT="/home/danko/projects/id8/comfyui/output"
BLOG_IMAGES="/home/danko/projects/southernsky-blog/public/images/posts"

if [[ "${1:-}" == "--status" ]]; then
  echo "=== Batch Progress ==="
  sqlite3 "$DB" "SELECT status, COUNT(*) as count FROM test_runs WHERE prompt_name = 'blog-hero' GROUP BY status"
  echo ""
  total=$(sqlite3 "$DB" "SELECT COUNT(*) FROM test_runs WHERE prompt_name = 'blog-hero'")
  done=$(sqlite3 "$DB" "SELECT COUNT(*) FROM test_runs WHERE prompt_name = 'blog-hero' AND status = 'done'")
  echo "$done / $total complete"
  exit 0
fi

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# Get all completed blog-hero renders
completed=$(sqlite3 "$DB" "SELECT image_file, output_file FROM test_runs WHERE prompt_name = 'blog-hero' AND status = 'done' AND output_file IS NOT NULL")

if [ -z "$completed" ]; then
  echo "No completed renders found yet."
  exit 0
fi

converted=0
skipped=0
failed=0

while IFS='|' read -r image_file output_file; do
  # Extract slug from image filename (blog-home-network.webp -> home-network)
  slug="${image_file#blog-}"
  slug="${slug%.webp}"
  output_path="$COMFYUI_OUTPUT/batch/$output_file"
  webm_path="$BLOG_IMAGES/$slug.webm"

  if [ ! -f "$output_path" ]; then
    echo "  SKIP: $slug (output file missing: $output_file)"
    skipped=$((skipped + 1))
    continue
  fi

  if [ -f "$webm_path" ] && [ "$webm_path" -nt "$output_path" ]; then
    echo "  SKIP: $slug (already converted)"
    skipped=$((skipped + 1))
    continue
  fi

  if $DRY_RUN; then
    echo "  WOULD: $slug ($output_file -> $slug.webm)"
    converted=$((converted + 1))
    continue
  fi

  echo "  Converting: $slug"
  ffmpeg -nostdin -y -i "$output_path" \
    -c:v libvpx-vp9 \
    -b:v 500k \
    -crf 35 \
    -vf "scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630" \
    -an \
    -loop 0 \
    "$webm_path" 2>/dev/null

  if [ -f "$webm_path" ]; then
    size=$(du -h "$webm_path" | cut -f1)
    echo "    OK: $slug.webm ($size)"
    converted=$((converted + 1))
  else
    echo "    FAIL: $slug"
    failed=$((failed + 1))
  fi
done <<< "$completed"

echo ""
echo "Done: $converted converted, $skipped skipped, $failed failed"
