#!/usr/bin/env bash
# Build, test, and publish Paynowlah to S3 + CloudFront (https://paynowlah.sg).
#
# Expects these environment variables to be set already:
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   deploy-only AWS user
#   PAYNOWLAH_S3_BUCKET                        the site's S3 bucket
#   PAYNOWLAH_CF_DISTRIBUTION_ID               CloudFront distribution id
#   PAYNOWLAH_SITE_URL                         e.g. https://paynowlah.sg
#
# Usage: scripts/deploy-s3.sh [--allow-dirty]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${AWS_ACCESS_KEY_ID:?not set}"
: "${AWS_SECRET_ACCESS_KEY:?not set}"
: "${PAYNOWLAH_S3_BUCKET:?not set}"
: "${PAYNOWLAH_CF_DISTRIBUTION_ID:?not set}"
SITE_URL="${PAYNOWLAH_SITE_URL:-https://paynowlah.sg}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}"
unset AWS_SESSION_TOKEN AWS_PROFILE
export PATH="$HOME/.local/bin:$PATH"
command -v aws >/dev/null || { echo "aws CLI not found" >&2; exit 1; }

# The live site must match a commit.
if [ "${1:-}" != "--allow-dirty" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Uncommitted changes to tracked files. Commit first, or pass --allow-dirty." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"

# pnpm via corepack, pinned (pnpm 12 rejects this repo's build-script settings).
SHIM="$(mktemp -d)"; trap 'rm -rf "$SHIM"' EXIT
printf '#!/bin/sh\nexec corepack pnpm@10.33.0 "$@"\n' > "$SHIM/pnpm"; chmod +x "$SHIM/pnpm"
export PATH="$SHIM:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true

echo "==> install";   pnpm install --frozen-lockfile
echo "==> test";      pnpm test
echo "==> build";     PORT="${PORT:-5173}" BASE_PATH=/ pnpm --filter @workspace/paynowlah run build

DIST="$ROOT/artifacts/paynowlah/dist/public"
[ -f "$DIST/index.html" ] || { echo "build produced no index.html" >&2; exit 1; }
ENTRY="$(grep -o 'assets/index-[^"]*\.js' "$DIST/index.html" | head -1)"

echo "==> upload to s3://$PAYNOWLAH_S3_BUCKET"
# Hashed asset files never change: cache for a year. Upload them before index.html
# so a visitor never gets an index.html pointing at a file not yet uploaded.
aws s3 sync "$DIST/assets" "s3://$PAYNOWLAH_S3_BUCKET/assets" \
  --cache-control "public,max-age=31536000,immutable" --only-show-errors
aws s3 sync "$DIST" "s3://$PAYNOWLAH_S3_BUCKET" --exclude "assets/*" \
  --cache-control "public,max-age=300" --delete --only-show-errors
# Old hashed assets are removed last, after the new index.html is in place.
aws s3 sync "$DIST/assets" "s3://$PAYNOWLAH_S3_BUCKET/assets" --delete --only-show-errors \
  --cache-control "public,max-age=31536000,immutable"

echo "==> refresh CloudFront"
INV="$(aws cloudfront create-invalidation --distribution-id "$PAYNOWLAH_CF_DISTRIBUTION_ID" \
  --paths "/" "/index.html" "/favicon.svg" "/robots.txt" "/licenses/*" --query Invalidation.Id --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$PAYNOWLAH_CF_DISTRIBUTION_ID" --id "$INV"

echo "==> verify $SITE_URL"
LIVE="$(curl -fsS "$SITE_URL/?nocache=$COMMIT" | grep -o 'assets/index-[^"]*\.js' | head -1)"
if [ "$LIVE" != "$ENTRY" ]; then
  echo "Live site serves $LIVE, expected $ENTRY" >&2; exit 1
fi
curl -fsS -o /dev/null "$SITE_URL/$ENTRY"
echo "Deployed commit $COMMIT to $SITE_URL ($ENTRY)"
