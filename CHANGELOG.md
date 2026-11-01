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
- **Home page on a phone:** each card has one short line saying what you get; saved scans fold into one "Saved recently" line so the document types come first; the group links stay on screen while you scroll; search lists the best match first, finds trade names, everyday words and one-letter typos, and its Search key opens a single match; the footer says photos go to an AI service and links the privacy policy.
- **Checking a scan on a phone:** camera photos wait in a page tray ("Add another page"), the photo can stay pinned above the fields, flagged fields are listed as one-tap links, the auto-save countdown sits on the Save button, "Start over" and the duplicate-check setting moved below the fields.
- **Landing page:** each document name signs in straight to its scan screen, and a refused Google permission no longer drops a shared `/scan/…` link; a new FAQ gives the reading limit; the sample slip's Amount stays visible and the scan sweep stops after two passes; features are compact rows on phones with plainer "Catches mistakes" copy.
- **Shared phones and offline use:** when a different Google account signs in, the previous account's offline pages and preferences are deleted from the phone first, even if that account's session only expired (its scans stay on the phone, hidden, until that account signs in again or they are deleted from Home); pages saved for offline use are refreshed after each update so they keep working without a connection; a damaged recent scan no longer takes down the home page; the home-screen icon's shortcuts are your recent document types, in your language.

### Removed
- Demo and guest mode. Everyone signs in with Google.
- Retired AI models.

### Fixed
- **Document checks:** Aadhaar is masked for every document type; loan balances include interest,
  brick counts in thousands, MT/kg weights, advance khata balances and dates with a time are read
  right; NGO receipts flag cash donations above ₹2,000; the NGO and lorry samples are corrected.
- **Hindi numerals and mixed units:** Aadhaar numbers written in Devanagari digits (२३४५…) are
  masked too, and every check reads Hindi digits; weights like "18 क्विंटल 60 किलो", "24.86 टन" or
  "500 g" are read right; decorator challans count pieces out and returned (not rates) and flag
  items not returned; a karigar's "Wastage 3.5%" is read as a percent; "IMEI 1:" labels no longer
  give a false 16-digit warning; the tailoring, decorator and prescription samples match their
  photos; and document type cards say what you get instead of "Parse/Digitize/Extract".
- **More document checks:** e-way bill, ration card, LR, invoice, account and transaction numbers
  are no longer masked as Aadhaar; garage and agri bills add up CGST + SGST, a GST percent and a
  discount; daily loans read the days from the scheme ("100 days"); a mandi weight in kg without a
  unit is no longer taken as quintals; NGO receipts accept a passport, voter ID or driving licence;
  ration cards written in Hindi (अंत्योदय, पात्र गृहस्थी) are checked; lorry receipts check
  freight = weight × rate.
- **Document checks, round 5:** construction challans read a rate per 1,000 bricks or per kg of steel (no more ₹3.75 crore brick amounts); mandi slips read a rate per kg, bag or crate, and a market fee or commission written as a percent; a fish commission of "5% (₹1,953)" is read as ₹1,953; muster rolls read a half day written "5 1/2"; yarn in grams and stones in mg or carats are converted; and cable receipts accept a payment for several months.
- **App shell:** a quick server error (e.g. during a deploy restart) shows the saved copy of a page instead of a bare error page; the installed app's name and shortcuts follow the current language and account instead of the last ones; and the sign-out warning no longer counts scans already in your sheet as unsaved, saying instead that only their photo or Notion copy is lost.
- **Document checks, round 6:** artisan rates per dozen or per hundred and cards with several product rates are priced right (no more 12× amounts due); a khata total written "₹1,540 Cr" is read as credit, not crore; kabadi receipts read weights in quintals, tonnes or "12 kg 500 g"; lorry receipts read a weight whose unit is only in the column header and accept "EWB No." in front of the e-way bill number; and timber slips count a line of equal logs ("× 3 nos") as that many logs.
- The language button's accessible name now starts with the word it shows ("हिन्दी" / "English"),
  so voice-control users can say what they see (WCAG 2.5.3, Label in Name).
- **Sign-in page:** a cancelled or failed Google sign-in now says why; shared `/scan/…` links and
  home-screen shortcuts open that page after sign-in; the button shows "Opening Google…" at once;
  the privacy copy says photos are read by an outside AI service and what Google will ask; and a
  privacy policy (`/privacy`) and a link preview image were added.
- **Landing page, round 5:** a sign-in tap made while the page is still loading on 2G is kept (a spinner shows at once) and goes ahead when the page is ready; a sign-in that can't reach Google says to check the connection instead of blaming the visitor or failing silently; each Sign in with Google says Google will ask for Sheets and Drive; the remembered-fields and offline feature copy now says what the app really does; the first line names artisans and community groups too; and the hero ticks sit in two even columns on phones.
- **Landing page, round 6:** opened inside Facebook, Instagram or another app's built-in browser, where Google refuses sign-in, the page says so and offers Open in Chrome and Copy link instead of a dead end; a shared `/scan/…` link or an ended session says where signing in leads ("Sign in to open Dairy Collection Slip"); a sign-in that outlived Google's screen asks to start again instead of blaming the internet; the header keeps Sign in on narrow phones; the Hindi headline has room for its matras; the sample sheet's new row is named for screen readers; and the copy no longer says nothing is saved until you say so, next to the auto-save feature.
- **Landing page, round 7:** the language switch works before the page's JavaScript arrives (and without it), with a spinner at once; a sign-in tap that waits 20 s for a page that never finishes loading stops spinning and says to reload; the FAQ says voice notes have their own allowance and that your own AI key, once added, is used first; the scan sweep stops within 5 s; the "12 fields read" chip keeps its edge in dark mode; and small Hindi lines are larger on phones.
- Photos waiting offline and failed saves are no longer dropped after 20 scans, removing one can be
  undone, and home search understands Roman Hindi and Hindi plurals ("doodh", "bilty", "खाता").
- **Scan review no longer loses work:** leaving with changes (back, links, Start over) asks first; a save that fails on a weak connection or an ended session is kept on the device with a "Sign in again" path; stalled requests time out; Cancel really stops a reading; voice notes no longer overwrite typed notes or get lost on Save; offline photos the phone couldn't store are no longer reported as saved.
- **Scan flow:** fields are locked while saving; pages waiting in the tray ask before leaving and
  take pasted, dropped or uploaded pages; an expired session while reading offers sign-in and
  reads the photo afterwards; reading shows real upload progress and can be kept for later; the
  sample shows a spinner; warnings are re-checked after edits; a save that failed everywhere says
  where; and voice notes stop at 3 minutes.
- **Scan flow, round 3:** on 2G a slow upload that keeps moving is no longer cut off (photos are also about half the size), a stalled one says "Your connection is too slow" and offers Keep for later, and Save shows how much has been sent; a flagged value can be marked as checked (✓) without retyping it; any failed save except a bad file keeps the checked values and offers Keep for later; auto-save waits while the app is in the background; leaving while a photo is being read asks first and stops the read; two retries at once no longer undo each other; Saved shows all three steps done; and "Photo" replaces "Photo and voice note" when there was no recording.
- **Scan flow, round 4:** a Sheets retry from the Saved screen now writes the photo and voice-note links and no longer uploads the photo again; a retry still running after "Scan the next one" no longer changes the next scan; "Stop reading" keeps the pages taken so they can be fixed and read again; tray pages open larger and Remove sits below each page; each field has a worded "Looks right" button and its Rename / Remove behind "⋯", and a removed field leaves an in-place Restore; a retry that finds the session ended offers "Sign in again"; the duplicate check says when it is off because its field wasn't read; and the Hindi "Saved" message no longer has the wrong gender.
- **Scan flow, round 5:** document-check warnings are shown in Hindi too, under the field they are about, and that field is listed to check; a retry from the Saved screen keeps "Replace the old row" and checks for duplicates again instead of always adding a row; a photo with nothing readable says to retake it in good light, offers "Retake photo" (or "Back to pages") instead of sending it again; reading starts at once even when the remembered settings are slow, and the duplicate check then says "as set in Settings" instead of "Don't check"; "Scan the next one" comes before the Notion and Remember offers; a new voice recording says it replaces the old one and a double tap no longer leaves the microphone on; screen readers hear the reading stage instead of the whole list at every 10%; and phones no longer show "drag a file here, or paste it".
- **Scan flow, round 6:** a save or retry whose reply is lost on a weak network no longer adds the row twice; "Looks right" also clears a document-check warning (the note stays, marked as checked) and is offered on clearly read values a check questions; a sample scan says it adds a test row to your sheet and never saves itself; Save no longer waits up to 90 s for a voice note to turn into text; Hindi check warnings appear even when the checks load late on 2G; Back after leaving a changed review through a link no longer opens an empty scan page; and restoring a removed field moves focus to it.
- **Settings:** "Use my settings on all my devices" now really copies the AI key, Notion connection,
  photo choice and remembered fields, removals made on another device stick, and turning it off keeps
  everything on this device; Notion connect problems are explained and reconnecting reuses the
  "DocSync AI Data" database; Remove key, Disconnect and sync-off ask first; remembered fields list
  only what is remembered, including the duplicate-check field.
- **Settings, round 2:** removing or replacing a key, Notion or remembered fields on one device now
  reaches devices that still had the old copy; a new AI key is tested on Save and a refused one is
  not saved; the page starts with Language and "Your records" (signed-in account, Open sheet, where
  photos go); the photo choice appears only once Notion is connected; quick taps no longer undo each
  other; Forget can be undone; focus returns to the button after a confirmation; a slow Notion
  connect ends with a message instead of a blank page.
- **Settings, round 3:** turning "Use my settings on all my devices" off now stays off, even when
  another device still had it on, and a failed upload no longer shows it as on; a stalled request on
  a weak network ends after a few seconds instead of blocking every later save; the photo choice and
  the sync box change at once and say "Saving…" / "Saved" beside them; a page that couldn't load
  offers Try again (or Sign in again); Forget keeps an Undo in its row and keeps focus there; Forget
  and duplicate-check buttons name their document type for screen readers; and Connect Notion says
  "Opening Notion…" and ignores extra taps.
- **Settings, round 4:** remembering fields for one document type no longer quietly cuts another type's list (Hindi users lost fields from the fourth type on), and a list that can't fit says so; turning "Use my settings on all my devices" on keeps newer keys and Notion from your other device instead of overwriting them, and a failure says "Couldn't turn this on" instead of "Saved"; a stalled cloud copy ends in 3 seconds; a new phone points to "DocSync AI Data" in Google Drive; a Notion connection that was removed or lost its database says so with Reconnect; an ended session offers Sign in again; Chrome no longer offers to save the AI key as a password; a tested key says it works even when the cross-device copy failed; Forget says when other devices didn't get the change; and a Notion template's page is no longer saved as the database.
- **Settings, round 6:** turning "Use my settings on all my devices" off while the cloud copy can't be reached now says "Couldn't turn this off" and keeps it on, instead of saying "Saved" and losing the AI key, Notion connection or remembered fields this device only had through sync; when Notion isn't working and photos go only to Notion, Settings says they aren't being saved and offers "Keep photos in Google Drive"; the AI key box no longer sits in a form Chrome may offer to save as a password; newer "AQ." Google keys are recognised, and a Google key that can't use Gemini says to make one in Google AI Studio instead of "check it was copied in full"; "Show all" names its document type and keeps focus in its row, as does resetting the duplicate check; the Language choice shows "Changing language…" until the whole page has switched; and the saved key reads "Groq key gsk_…a1b2" instead of "ending gsk_…a1b2".
- **Sign out no longer loses unsaved work:** it asks first when scans on the phone aren't saved
  yet, does nothing while offline, and deletes local data only once the sign-out went through. On
  phones the Settings and Sign out buttons now show their labels.
- **Offline:** a banner stays under the header while the phone is offline; the offline page follows
  the chosen language; on a weak connection the app opens its saved copy after a few seconds
  instead of a blank screen.
- **Offline and accessibility polish:** saved pages are no longer swapped between addresses (an old
  sign-in error or an old scan to resume), come back in the chosen language, and every document
  type opens offline; the offline page links back to Home; install no longer downloads an unused
  1 MB image; "Try again" on an error page really reloads it; the crash screen follows the light
  theme and language and carries the ADT badge; the sign-out dialog lists "Stay signed in" first
  for screen readers too; buttons keep focus while busy; the header shows "DocSync AI" on most
  phones; finished steps are announced as done; and focus no longer hides under the sticky header.
- **Landing page, round 3:** no sideways scrolling on 320–390px phones in Hindi; Sign in with Google says "You're offline" instead of opening the browser's error page, and stops waiting after 15 seconds; one sign-in at a time, with focus kept on the button; the language button waits for the whole page to change instead of flipping back on a second tap; on phones the 28 document types fold under their six trades (no sample photos downloaded), and "For shops, farms, transporters and workshops" shows again; the Google permission copy says "all your Google Sheets spreadsheets", as Google does.
- Unknown links show a translated "page not found" screen with a way back to the home page.
- **Shell, round 3:** e-way bill, account and other 12-digit numbers are no longer masked as Aadhaar
  (Aadhaar and ID-proof fields still are); Home, Settings, "page not found" and error pages have
  their own title in the chosen language, and the last two a main heading; the language button
  shows a spinner until the page has changed language, and offline it says to connect instead of
  half-switching; the saved screen shows all three steps as done; the crash screen's "Try again"
  reloads the page; the skip link no longer hides the heading under the header; the header's phone
  labels are larger and darker; and signed-out visitors no longer see Settings and Sign out flash.
- **Shell, round 4:** the header no longer disappears after a failed session check on a weak or lost connection, and the offline banner stays in view on signed-out pages too; signing out keeps the offline page, icons and scripts (only saved pages are deleted); messages and errors stay on screen long enough to read (10 s plus a little per character) and have a close button, and errors are announced at once; busy buttons keep their full colour beside the spinner; Sign out shows a spinner and announces "Signing out…"; and the Google avatar is now the Settings button's icon, so "DocSync AI" shows on 360–391px phones.
- The installed app's splash screen uses the light theme instead of black.
- **Saving is safer and more honest:** a new Google account on a shared phone no longer inherits
  the previous user's AI key, Notion or sheet; a paused Sheets shows "Not saved" with a retry;
  Aadhaar numbers are masked on every document type; receipt numbers keep their leading zeros;
  one user's errors no longer pause saving for others; and save notes appear in Hindi too.
- **Sheets keep their shape:** a new field adds a column without moving earlier rows' notes and links under the wrong heading; Hindi field names reuse their column instead of adding one each save; an expired Google sign-in asks you to sign in again (and recovers after a brief network blip) instead of failing every save; a Notion save that timed out no longer creates a second page on Retry; very long values no longer fail the save; and voice notes stay in Hindi when the app is in Hindi, with no English sample text when transcription isn't set up.
- **Home page, round 3:** Retry after the Google sign-in ended offers "Sign in again" and keeps the scans (it no longer leaves Sign out, which deletes them, as the only way); two Retries at once no longer save a scan twice, and a scan can't be deleted while it retries; search understands phrases like "kirana ka khata", "medical bill" or "दूध का हिसाब", lists the closest matches when no type has every word, ignores single letters and no longer turns "dhaba" into thread; a tapped document card shows a spinner while its scan screen loads.
- **Home page, round 4:** the group links on phones no longer slide under the offline banner, mark the group you're in and scroll to show it; search says "No exact match… Closest:" for a guess and its Search key opens only a sure match (no more "school fees" opening Cable TV); "बिजली" no longer finds bills; "sabzi mandi" finds Mandi slips and "kapda dukan" no longer lists the kirana shop first; no match says DocSync has no such type yet instead of "try a shorter word"; phones show two waiting scans before "Show all"; offline Retry and Process now say why they can't run; Hindi "Your document types" reads as types, not saved papers.
- **Document checks, round 4:** check warnings are now written in English and Hindi and say which field they are about; a total is read from the Total field even when an Estimate or Stitching Charges line comes first; amounts written in lakh, crore or हज़ार are read in full (so the e-way bill and 80G checks fire); a cash donation of ₹2 lakh or more warns about the s.269ST ban; Hindi units (बोरी, ब्रास) count as units; measurements in cm are checked in cm; balances written as an advance are read as negative on every card; BIS hallmarks like 22K916 are checked; and bajra, jowar, ragi and maize count towards PDS grain.
- **Home page, round 5:** recent scans on a shared phone are tied to the Google account that took them, so the next account no longer sees, retries or saves them (it can delete them); a scan stored by an older version can no longer take the document types down; "Show all" becomes "Show fewer" and removing a row moves focus to the next one; checked scans kept for later say "Checked, not saved yet" with "Save now"; and "fees", "chai" or "rent" show no match instead of Cable TV or the decorator.
- **Home page, round 6:** signing in with another Google account no longer deletes the first account's waiting photos and unsaved scans: Home says they are kept and offers to delete them; a save or retry whose reply was lost on a weak network no longer adds a second sheet row, and a retry from Home keeps "Replace the old row" and writes the photo and voice-note links; the weighbridge card is now "Weighbridge (Dharam Kanta) Slips", so "scrap" and "स्क्रैप" list the scrap dealer first; search finds वाईफाई, मस्टर रोल, पेट्रोल पंप, टेंट हाउस and बिलटी; screen readers hear the match count once typing pauses; and the group links no longer fill the Back button's history.
- **Retries and replaces keep the sheet right:** a Notion or photo retry fills the photo link and Sync Status into the row already saved; "Replace the old rows" leaves the record in one row instead of several identical copies; a sheet moved to the Drive trash no longer keeps receiving rows (they go to your "DocSync AI Data" sheet, with a note); two phones saving for the first time at once share one sheet; iPhone voice notes are stored as .m4a so they play; with reading switched off on the server, a photo gets "try again later" instead of sample fields; and oversized uploads are refused before they are read.
- **Landing page, round 4:** a first visit from a phone set to Hindi opens in Hindi (until a language is chosen); on narrow phones Sign in returns to the header once the big Sign in with Google has scrolled away; the page says DocSync is free and never asks for a card, with a "Does it cost anything?" question first in the FAQ; "Back to DocSync" on the privacy policy keeps a shared `/scan/…` link; the six trade names are real headings for screen readers; and on wide screens the document lists show before the page finishes loading instead of snapping open.
- **Saving and reading, round 4:** choosing Google Drive for photos no longer stops records going to Notion; the sheet's "Link to Image" opens the Drive photo (a Notion page only when the photo is on it); a photo or voice note that took long to upload on 2G is still read; a Notion or photo retry finds its row when the amount has a ₹ sign; Hindi users get Hindi headings and Sync Status on a new sheet; one user's too-large photo no longer pauses DocSync's AI for everyone; and new Notion databases no longer have an empty "Original Image" column.
- **Settings, round 5:** a change says "Saved" as soon as it is saved instead of waiting for a check of Notion, and the page opens sooner with Notion connected; Reconnect no longer makes a second "DocSync AI Data" database when Notion is slow or busy, and a new one goes in the page you chose; a Notion error says "Couldn't connect" instead of "no page was chosen", and says when your earlier connection still works; Notion can only be connected while signed in, and only to that account; the hidden AI key is a password field, so screen readers don't read it aloud; Save key with an empty field says to paste the key first; Notion is marked optional and no longer has the page's loudest button; the Devices card and key field use plain words; and the Hindi page names the default duplicate-check field in Hindi.
- **Saving and reading, round 5:** in production, a server without a working AI key now says reading is unavailable instead of filling a real photo with sample values that could be saved to the sheet; "Replace the old row" keeps the old row's Drive photo instead of storing a second copy, and says when Notion still has the old page; an account can no longer be locked out of reading for good after a brief hiccup in rate-limit storage; and a broken server Gemini key is paused instead of being tried on every scan.
- **Saving and reading, round 6:** when the first AI finds nothing on a page, the next one is asked before you are told to retake the photo; a photo an AI service declines to read moves on to the next one at once and no longer pauses that service for everyone; slip and book numbers like "12/3" stay as written in the sheet instead of turning into dates, and "12/3" and "1/23" are no longer taken for the same slip; "Replace the old row" now stores the new photo with the corrected values and moves the old photo to the Drive trash; a Notion or photo retry finds its row by the save's id, even when the sheet reformatted a date or time in it; and voice notes have their own allowance, so they no longer use up document reads.

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
