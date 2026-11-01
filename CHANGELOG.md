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

### Removed
- Demo and guest mode. Everyone signs in with Google.
- Retired AI models.

### Fixed
- The language button's accessible name now starts with the word it shows ("हिन्दी" / "English"),
  so voice-control users can say what they see (WCAG 2.5.3, Label in Name).
- **Sign out no longer loses unsaved work:** it asks first when scans on the phone aren't saved
  yet, does nothing while offline, and deletes local data only once the sign-out went through. On
  phones the Settings and Sign out buttons now show their labels.
- **Offline:** a banner stays under the header while the phone is offline; the offline page follows
  the chosen language; on a weak connection the app opens its saved copy after a few seconds
  instead of a blank screen.
- Unknown links show a translated "page not found" screen with a way back to the home page.
- The installed app's splash screen uses the light theme instead of black.

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
