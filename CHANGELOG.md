# Changelog

Notable changes to DocSync AI. The format follows [Keep a Changelog](https://keepachangelog.com/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Verified on staging, not yet in production.

### Added
- **26 more document types (28 in all)**, grouped into six trades: shops & services; farm, dairy &
  food; transport & storage; factory & construction; crafts & artisans; community & collections.
  Each type has Hindi copy, derived totals, business-rule warnings and a fictional sample document.
- **Landing page for signed-out visitors** (`/login`): a sample dairy slip turning into a sheet row,
  how it works, the 28 document types by trade with sample photos, features, privacy and FAQ, in
  English and Hindi. Sign in with Google at the top and again at the end.
- **Home page** grouped by trade, with jump links and a search box that works in English or Hindi.
- **ADT branding:** ADT's colours, type and icons, and the "An offering by ADT" badge on every
  screen.
- **Module isolation:** each module has a timeout, a kill switch (`MODULE_<NAME>=off`) and a circuit
  breaker. `GET /api/health` reports every module.
- **Staged release flow:** every change goes through staging before production, with approval
  gates and contract tests.

### Changed
- **Hosting moved to Google Cloud Run in Mumbai**, one service per environment, deployed from
  GitHub Actions without stored Google keys. The domains stay on Cloudflare.
- **Redesigned scan flow:** photo → reading → check → saved, with remembered fields, auto-save, and
  per-destination retry.
- **Shared checks:** one rule each for vehicle numbers, phone numbers, GSTIN and money amounts,
  used by every document type.
- **Aadhaar masking:** numbers are masked whatever the separators, including misread values.
- **Back-to-back scans:** keep working when an AI provider is briefly busy.
- **Firestore status:** Settings reports whether Firestore is reachable.
- **Checking a scan on a phone:** camera photos wait in a page tray ("Add another page"), the photo can stay pinned above the fields, flagged fields are listed as one-tap links, the auto-save countdown sits on the Save button, "Start over" and the duplicate-check setting moved below the fields.

### Removed
- Demo and guest mode. Everyone signs in with Google.
- Retired AI models.

### Fixed
- The language button's accessible name now starts with the word it shows ("हिन्दी" / "English"),
  so voice-control users can say what they see (WCAG 2.5.3, Label in Name).
- **Sign-in page:** a cancelled or failed Google sign-in now says why; shared `/scan/…` links and
  home-screen shortcuts open that page after sign-in; the button shows "Opening Google…" at once;
  the privacy copy says photos are read by an outside AI service and what Google will ask; and a
  privacy policy (`/privacy`) and a link preview image were added.
- Photos waiting offline and failed saves are no longer dropped after 20 scans, removing one can be
  undone, and home search understands Roman Hindi and Hindi plurals ("doodh", "bilty", "खाता").
- **Scan review no longer loses work:** leaving with changes (back, links, Start over) asks first; a save that fails on a weak connection or an ended session is kept on the device with a "Sign in again" path; stalled requests time out; Cancel really stops a reading; voice notes no longer overwrite typed notes or get lost on Save; offline photos the phone couldn't store are no longer reported as saved.
- **Settings:** "Use my settings on all my devices" now really copies the AI key, Notion connection,
  photo choice and remembered fields, removals made on another device stick, and turning it off keeps
  everything on this device; Notion connect problems are explained and reconnecting reuses the
  "DocSync AI Data" database; Remove key, Disconnect and sync-off ask first; remembered fields list
  only what is remembered, including the duplicate-check field.

## [0.1.0] - 2026-08-05

First public version.

### Added
- **Two document types:** NGO donation receipts and factory weight slips.
- **Vision extraction** across OpenAI, Groq, Gemini and Anthropic, with automatic fallback.
- **Sync** to Google Sheets, Notion and Google Drive.
- **Bring your own key:** user keys encrypted with AES-256-GCM.
- **Installable mobile web app** (PWA).

[Unreleased]: https://github.com/shoubhiksaha/docsync-ai/compare/v0.1.0...staging
[0.1.0]: https://github.com/shoubhiksaha/docsync-ai/releases/tag/v0.1.0
