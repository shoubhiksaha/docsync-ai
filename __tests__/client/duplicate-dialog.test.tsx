/**
 * The duplicate warning shows the row already in the sheet, with field names in the user's
 * language, and works as before when the server couldn't read that row. Rendered to HTML.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/client/i18n';
import { I18nProvider } from '@/client/i18n/I18nProvider';
import type { DuplicateInfo } from '@/client/scan-flow';
import { localizedFieldLabel } from '@/modules/profiles';
import { FieldNamesProvider } from '@/app/scan/[profile]/fieldNames';
import DuplicateDialog from '@/app/scan/[profile]/DuplicateDialog';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
jest.mock('@/app/scan/[profile]/scan.module.css', () => new Proxy({}, { get: (_, name) => (name === '__esModule' ? undefined : String(name)) }));
jest.mock('@/app/components/ui/ui.module.css', () => new Proxy({}, { get: (_, name) => (name === '__esModule' ? undefined : String(name)) }));

(globalThis as { React?: typeof React }).React = React;

const existing = {
  savedAt: '2026-07-15 10:30',
  fields: [{ label: 'Receipt Number', value: 'HHF/0458' }, { label: 'Donor Name', value: 'Arjun Mehta' }, { label: 'Amount', value: '₹5,000.00' }],
};

function render(info: DuplicateInfo, lang: 'en' | 'hi' = 'en') {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <FieldNamesProvider localize={localizedFieldLabel}>
        <DuplicateDialog info={info} onCancel={noop} onAction={noop} />
      </FieldNamesProvider>
    </I18nProvider>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('DuplicateDialog', () => {
  it('shows when the row already in the sheet was saved and its key fields, under its own heading', () => {
    const html = render({ count: 1, label: 'Receipt Number', value: 'HHF/0458', existing });
    expect(html).toMatch(/<section[^>]*aria-labelledby="([^"]+)"[^>]*>\s*<h3 id="\1"/);
    expect(text(html)).toContain(`${translate('en', 'dup.existing')} `);
    expect(text(html)).toContain(`${translate('en', 'dup.savedAt')} 2026-07-15 10:30`);
    expect(text(html)).toContain('Donor Name Arjun Mehta');
    expect(text(html)).toContain('Amount ₹5,000.00');
    expect(html.match(/<dt>/g)).toHaveLength(4);
  });

  it('says which row it is when there are several, and names the fields in Hindi for a Hindi user', () => {
    const html = render({ count: 2, label: 'Receipt Number', value: 'HHF/0458', existing }, 'hi');
    expect(text(html)).toContain(translate('hi', 'dup.existingFirst'));
    expect(text(html)).toContain(`${translate('hi', 'dup.savedAt')} 2026-07-15 10:30`);
    expect(text(html)).toContain(`${localizedFieldLabel('Amount', 'hi')} ₹5,000.00`);
    expect(localizedFieldLabel('Amount', 'hi')).not.toBe('Amount');
  });

  it('without the row (the sheet could not be read in time) it is the warning it was before', () => {
    const html = render({ count: 1, label: 'Receipt Number', value: 'HHF/0458' });
    expect(html).not.toContain('<section');
    expect(html).not.toContain('<dl');
    expect(text(html)).toContain(translate('en', 'dup.body', { label: 'Receipt Number', value: 'HHF/0458', count: 1 }));
    expect(text(html)).toContain(translate('en', 'dup.cancel'));
    expect(text(html)).toContain(translate('en', 'dup.replace'));
  });
});
