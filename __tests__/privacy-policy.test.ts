import { GOOGLE_SCOPES } from '@/app/login/google-scopes';
import { POLICY } from '@/app/privacy/policy';

const text = (lang: 'en' | 'hi', id?: string) => POLICY[lang].sections
  .filter(s => !id || s.id === id)
  .flatMap(s => [s.title, ...s.blocks.flat()])
  .join('\n');

describe('privacy policy', () => {
  it('names every Google permission DocSync asks for, with what it is used for', () => {
    for (const lang of ['en', 'hi'] as const) {
      const google = text(lang, 'google');
      for (const scope of GOOGLE_SCOPES) expect(google).toContain(scope);
    }
  });

  it('makes the Limited Use disclosure Google verification requires', () => {
    expect(text('en', 'google')).toContain('Google API Services User Data Policy');
    expect(text('en', 'google')).toContain('including the Limited Use requirements');
    expect(text('hi', 'google')).toContain('Limited Use');
  });

  it('says Google data is never used to train AI or for ads, and never sold', () => {
    const google = text('en', 'google');
    expect(google).toMatch(/train generalised or non-personalised AI/);
    expect(google).toMatch(/advertising/);
    expect(google).toMatch(/sell Google user data/);
  });

  it('has the same sections in English and Hindi', () => {
    expect(POLICY.hi.sections.map(s => s.id)).toEqual(POLICY.en.sections.map(s => s.id));
    for (const [i, section] of POLICY.en.sections.entries()) {
      const hi = POLICY.hi.sections[i];
      expect(hi.blocks.map(b => typeof b)).toEqual(section.blocks.map(b => typeof b).concat(hi.id === 'who' ? ['string'] : []));
    }
  });

  it('tells people how to revoke access and how to reach ADT', () => {
    for (const lang of ['en', 'hi'] as const) {
      expect(text(lang, 'choices')).toContain('https://myaccount.google.com/permissions');
      expect(text(lang, 'contact')).toContain('support@analogdigital.tech');
      expect(text(lang, 'contact')).toContain('https://analogdigital.tech');
    }
  });
});
