/**
 * The Check screen in Hindi: business-rule warnings are shown in Hindi, under the field they are
 * about, and that field is in the "Fields to check" list. Rendered to HTML (no DOM needed).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/client/i18n';
import { I18nProvider } from '@/client/i18n/I18nProvider';
import { initialScanState, scanReducer, type ScanState } from '@/client/scan-flow';
import ReviewStep from '@/app/scan/[profile]/ReviewStep';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
// CSS modules: each class name comes back as itself.
jest.mock('@/app/scan/[profile]/scan.module.css', () => new Proxy({}, { get: (_, name) => (name === '__esModule' ? undefined : String(name)) }));
jest.mock('@/app/components/ui/ui.module.css', () => new Proxy({}, { get: (_, name) => (name === '__esModule' ? undefined : String(name)) }));

// The app's components use the automatic JSX runtime; this test build compiles them to React.createElement.
(globalThis as { React?: typeof React }).React = React;

const page = new Blob(['x'], { type: 'image/jpeg' });

function review(rules: ScanState['rules'], warnings: string[] = []): ScanState {
  const extracting = scanReducer(scanReducer(initialScanState, { type: 'captured', pages: [page], scanId: 's1' }), { type: 'extract-start' });
  return scanReducer(extracting, {
    type: 'extract-ok',
    template: null,
    rules,
    extraction: {
      warnings,
      fields: [
        { key: 'vehicleNumber', label: 'Vehicle Number', value: 'XX 1', confidence: 99 },
        { key: 'amount', label: 'Amount', value: '500', confidence: 99 },
      ],
    },
  });
}

function render(state: ScanState, lang: 'en' | 'hi' = 'hi', duplicateKey: string | null = '') {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <ReviewStep
        state={state} dispatch={noop} documentName="Lorry receipt" saving={false} countdown={5} saveSent={0}
        duplicateKey={duplicateKey} onDuplicateKey={noop} kept={false} onKeep={noop} onSignIn={noop} onSave={noop}
        onSaveWithoutVoice={noop} onStartOver={noop}
      />
    </I18nProvider>,
  );
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('Check screen business-rule warnings', () => {
  it('shows them in Hindi under their field, and lists that field to check', () => {
    const html = render(review([{ code: 'vehicle', field: 'vehicleNumber', params: { vehicle: 'XX 1' } }], ['English sentence from the server']));
    const hindi = translate('hi', 'rule.vehicle', { vehicle: 'XX 1' });
    expect(html).toContain(escape(hindi));
    expect(html).not.toContain('English sentence from the server');
    expect(html).not.toContain(escape(translate('en', 'rule.vehicle', { vehicle: 'XX 1' })));
    // Under the vehicle number's value (its notes come right after its box), not in a loose list.
    const box = html.indexOf('id="field-');
    const note = html.indexOf(escape(hindi));
    expect(note).toBeGreaterThan(box);
    expect(html.slice(box, note)).not.toContain('Amount');
    // The field is one tap away in "Fields to check", although it was read clearly.
    expect(html).toContain(escape(translate('hi', 'review.attention', { count: 1 })));
    expect(html).toMatch(/<button[^>]*class="jump"[^>]*>Vehicle Number<\/button>/);
  });

  it("keeps a warning about no field in the list, and the server's text until the checks have run", () => {
    expect(render(review([{ code: 'unavailable' }]))).toContain(escape(translate('hi', 'rule.unavailable')));
    expect(render(review(null, ['Server sentence']))).toContain('Server sentence');
  });

  it('says the duplicate check is as set in Settings while they are not loaded, not that it is off', () => {
    const unknown = render(review([]), 'en', null);
    expect(unknown).toContain(escape(translate('en', 'review.duplicateTitle', { field: translate('en', 'review.duplicateSettings') })));
    expect(render(review([]), 'en', '')).toContain(escape(translate('en', 'review.duplicateTitle', { field: translate('en', 'review.duplicateNone') })));
  });
});
