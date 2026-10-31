# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/shoubhiksaha/docsync-ai/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with it. We aim to
acknowledge a report within 3 working days and will keep you updated until it's fixed.

## Supported versions

Only the version running at [docsync.analogdigital.tech](https://docsync.analogdigital.tech), built
from `main`, receives security fixes.

## How DocSync handles data

- **Documents:** DocSync keeps no copy of the documents it reads. Photos are processed in memory,
  and the extracted rows go only to the destinations the user picks: their own Google Sheet, and
  optionally Notion and Google Drive.
- **Sign-in:** everyone signs in with Google. Each user's rows are written only to their own
  spreadsheet.
- **API keys:** keys that users bring are encrypted with AES-256-GCM, either in an encrypted cookie
  or (optionally) in Firestore with envelope encryption.
- **Aadhaar numbers:** never stored in full; only the last 4 digits are kept.
- **Rate limits:** API routes are rate-limited per client.
- **CI:** every PR is checked by a secret scan and a dependency audit.
