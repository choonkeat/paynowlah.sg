---
description: Build, test, and publish Paynowlah to https://paynowlah.sg (S3 + CloudFront)
argument-hint: "[--allow-dirty]"
---

Deploy the current commit to https://paynowlah.sg.

1. Run `git status --short`. If tracked files have uncommitted changes and `$ARGUMENTS` does not contain `--allow-dirty`, stop. Tell the user which files changed, and ask whether to commit them first. Don't commit on your own.
2. The necessary environment variables should already be set. If the upload to S3 fails, stop and report it.
3. Run `scripts/deploy-s3.sh $ARGUMENTS` with a 10-minute timeout. It installs, runs the payment tests, builds, uploads to S3, refreshes CloudFront, and checks the live site serves the new build.
4. If it fails, report the step that failed (install / test / build / upload / refresh / verify), the error line, and the fix. A test failure means the payment QR output changed: never deploy around it.
5. If it succeeds, report the deployed commit (`git log -1 --oneline`) and that https://paynowlah.sg now serves it.
