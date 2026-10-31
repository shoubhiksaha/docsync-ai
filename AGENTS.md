# DocSync AI Agents

DocSync AI is a modular Next.js app. Each capability lives in its own module under `modules/` with
one public entry point, and calls between modules are isolated so a failure in one never takes
down the others. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and
[docs/RELEASE_FLOW.md](docs/RELEASE_FLOW.md) for how changes ship.

## Agents

1. **Provider chain (`modules/ai`)**
   - `UniversalAIAdapter` formats one prompt for OpenAI-compatible APIs (OpenAI, Groq, …), Google
     Gemini and Anthropic.
   - `chatJson()` tries the user's saved key first, then server keys (Groq → OpenAI → Gemini →
     Anthropic), and moves on after any provider error. Within Gemini it also falls back across models.
   - Failing server providers are paused for a minute by a circuit breaker. Models are configurable
     per environment (`*_VISION_MODEL` variables).

2. **Extraction Agent (`modules/extraction`, `/api/extract-freeform`)**
   - Zero-shot vision extraction of every visible field into a strict JSON schema
     (key, label, value, confidence, category), normalized field-by-field.
   - Guided by the document profile (`modules/profiles`, 28 document types in six trade groups):
     context, priority fields, and business-rule checks (e.g. PAN for donations above ₹2,000,
     tare < gross, totals that add up, GSTIN/IMEI/vehicle-number formats) returned as warnings.

3. **Sync Orchestrator (`modules/sync`, `/api/sync`)**
   - Read-only duplicate check, then Notion and media storage in parallel, then Google Sheets.
   - Each destination runs isolated (timeout, kill switch, circuit breaker) and reports
     success / failed / skipped. Sheets columns grow as new fields appear, beyond column Z.

4. **Transcription (`modules/transcription`, `/api/transcribe`)**
   - Voice notes via Groq Whisper, Gemini or OpenAI Whisper, with the same fall-through behaviour.

Sheet columns come from the fields the user approves on the review screen. The first save creates
the sheet (or finds "DocSync AI Data") and new fields add columns; there is no separate setup step
or schema-suggestion endpoint.

## User interface
The scan flow (`client/scan-flow.ts`, `app/scan/[profile]/`) is a small state machine: photo →
reading → check → saved. Remembered fields and the duplicate-check field are per-profile
preferences (`/api/profile-prefs`). Copy lives in `client/i18n/` (English and Hindi). DocSync AI is
an offering by ADT: it uses ADT's colours and type, and every screen carries the "An offering by ADT"
badge. See the UI section of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#ui).

## Resilience & Persistence
The agents are stateless. Signed-in users' keys come from encrypted cookies or (optionally)
Firestore with envelope encryption. Everyone signs in with Google; there is no demo or guest mode,
and each user's rows go only to their own sheet. Any module can be
switched off with `MODULE_<NAME>=off`, and `/api/health` reports each module's state.
