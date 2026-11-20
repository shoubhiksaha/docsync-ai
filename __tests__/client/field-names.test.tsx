/**
 * Field names in Hindi beyond the Check screen: the Saved summary, the remembered fields on the
 * photo screen and the duplicate dialog, and the duplicate-check fields Settings names. Rendered
 * to HTML (no DOM needed); the sheet columns keep their English labels throughout.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/client/i18n';
import { I18nProvider } from '@/client/i18n/I18nProvider';
import { initialScanState, savedFieldsShown, scanReducer, type SaveResult, type ScanState } from '@/client/scan-flow';
import { activeProfiles, localizedFieldLabel } from '@/modules/profiles';
import { FieldNamesProvider } from '@/app/components/FieldNames';
import CaptureStep from '@/app/scan/[profile]/CaptureStep';
import DoneStep from '@/app/scan/[profile]/DoneStep';
import DuplicateDialog from '@/app/scan/[profile]/DuplicateDialog';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
// Browser-only image handling (it loads the PDF reader); the photo screen only needs the page limit.
jest.mock('@/client/images', () => ({ MAX_PAGES: 4 }));
// CSS modules: each class name comes back as itself.
jest.mock('@/app/scan/[profile]/scan.module.css', () => new Proxy({}, { get: (_, name) => (name === '__esModule' ? undefined : String(name)) }));
jest.mock('@/app/components/ui/ui.module.css', () => new Proxy({}, { get: (_, name) => (name === '__esModule' ? undefined : String(name)) }));

// The app's components use the automatic JSX runtime; this test build compiles them to React.createElement.
(globalThis as { React?: typeof React }).React = React;

const page = new Blob(['x'], { type: 'image/jpeg' });
const noop = () => undefined;

function inLanguage(lang: 'en' | 'hi', children: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <FieldNamesProvider localize={localizedFieldLabel}>{children}</FieldNamesProvider>
    </I18nProvider>,
  );
}

/** A dairy slip read, a field renamed and one added by the user, then saved. */
function saved(): ScanState {
  const extracting = scanReducer(scanReducer(initialScanState, { type: 'captured', pages: [page], scanId: 's1' }), { type: 'extract-start' });
  let state = scanReducer(extracting, {
    type: 'extract-ok', template: null, rules: [],
    extraction: {
      fields: [
        { key: 'memberName', label: 'Member Name', value: 'Fictional Member', confidence: 99 },
        { key: 'quantityLitres', label: 'Quantity (Litres)', value: '4.5', confidence: 99 },
        { key: 'shift', label: 'Shift', value: 'Morning', confidence: 99 },
      ],
    },
  });
  state = scanReducer(state, { type: 'rename', id: state.fields[2].id, label: 'Rate' });
  state = scanReducer(state, { type: 'add', label: 'Notes', value: 'Sample note' });
  return scanReducer(state, { type: 'save-start' });
}

const result: SaveResult = {
  status: 'saved',
  destinations: { sheets: { status: 'success', code: 'saved' } },
  warnings: [],
};

function done(state: ScanState, lang: 'en' | 'hi') {
  return inLanguage(lang, (
    <DoneStep
      result={result} fields={savedFieldsShown(state)} documentName="Milk slip" retrying={new Set()} sessionEnded={false}
      onSignIn={noop} withVoice={false} offerRemember={false} offerNotion={false} onRetry={noop} onRemember={noop}
      onDismissRemember={noop} onDismissNotion={noop} onScanNext={noop}
    />
  ));
}

describe('Field names in Hindi outside the Check screen', () => {
  it('names the saved fields in Hindi on the Saved screen, and ones the user named as written', () => {
    const state = saved();
    const html = done(state, 'hi');
    expect(html).toContain('<dt>सदस्य का नाम</dt>');
    expect(html).toContain('<dt>मात्रा (लीटर)</dt>');
    // Renamed to, and added as, names the table knows: shown as the user wrote them, as on Check.
    expect(html).toContain('<dt>Rate</dt>');
    expect(html).toContain('<dt>Notes</dt>');
    expect(html).not.toContain('Member Name');
    expect(done(state, 'en')).toContain('<dt>Member Name</dt>');
    // What was saved (and would be remembered) keeps the English labels.
    expect(state.savedFields!.map(f => f.label)).toEqual(['Member Name', 'Quantity (Litres)', 'Rate', 'Notes']);
  });

  it('lists the remembered fields in Hindi on the photo screen', () => {
    const html = inLanguage('hi', (
      <CaptureStep
        documentName="Milk slip" pages={[]} tray={[]} error={null} problem={null} preparing={false} loadingSample={false}
        offline={false} offlineSaved={false} waitingOnline={false} sampleHref={null}
        remembered={[{ key: 'memberName', label: 'Member Name' }, { key: 'myColumn', label: 'My own column' }]}
        onTakePhoto={noop} onUpload={noop} onFiles={noop} onSample={noop} onReadTray={noop} onRemoveTrayPage={noop}
        onRetry={noop} onReadNow={noop} onKeep={noop} onSignIn={noop} onRetake={noop} onBackToPages={noop}
        onOtherPhoto={noop} onForget={noop}
      />
    ));
    expect(html).toMatch(/<span[^>]*>सदस्य का नाम<\/span>/);
    expect(html).toMatch(/<span[^>]*>My own column<\/span>/);
  });

  it('names the duplicate-check field in Hindi in the duplicate dialog', () => {
    const html = inLanguage('hi', <DuplicateDialog info={{ label: 'Receipt Number', value: 'R-100', count: 2 }} onCancel={noop} onAction={noop} />);
    const body = translate('hi', 'dup.body', { label: 'रसीद नंबर', value: 'R-100', count: 2 });
    expect(html).toContain(body.replace(/"/g, '&quot;'));
  });

  it("has a Hindi name for every document type's default duplicate-check field (shown in Settings)", () => {
    for (const profile of activeProfiles().filter(p => p.duplicateKey)) {
      // Its sample field's label, else the key, which Settings spells out ("slipId" → "Slip Id").
      const label = profile.mockFields.find(f => f.key === profile.duplicateKey)?.label ?? profile.duplicateKey!;
      expect([profile.id, localizedFieldLabel(label, 'hi')]).not.toEqual([profile.id, label]);
    }
    expect(localizedFieldLabel('Slip Id', 'hi')).toBe(localizedFieldLabel('slipId', 'hi'));
  });
});
