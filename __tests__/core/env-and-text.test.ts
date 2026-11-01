import { appEnvironment, appVersion, env, isModuleEnabled } from '@/core/env';
import { normalizeKey, parseNumber, toAsciiDigits } from '@/core/text';

describe('core/env', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('reads the environment from APP_ENV, else NODE_ENV', () => {
    process.env.APP_ENV = 'staging';
    expect(appEnvironment()).toBe('staging');
    process.env.APP_ENV = 'production';
    expect(appEnvironment()).toBe('production');
    process.env.APP_ENV = 'nonsense';
    expect(appEnvironment()).toBe('test');
    delete process.env.APP_ENV;
    expect(appEnvironment()).toBe('test');
  });

  it('reports the build version', () => {
    process.env.APP_BUILD_SHA = 'abc123';
    expect(appVersion()).toBe('abc123');
    delete process.env.APP_BUILD_SHA;
    expect(appVersion()).toBe('dev');
  });

  it('module kill switches', () => {
    expect(isModuleEnabled('notion')).toBe(true);
    for (const v of ['off', 'false', '0', 'disabled', ' OFF ']) {
      process.env.MODULE_NOTION = v;
      expect(isModuleEnabled('notion')).toBe(false);
    }
    process.env.MODULE_NOTION = 'on';
    expect(isModuleEnabled('notion')).toBe(true);
  });

  it('env() trims and treats blanks as unset', () => {
    process.env.X_TEST = '  value ';
    expect(env('X_TEST')).toBe('value');
    process.env.X_TEST = '   ';
    expect(env('X_TEST')).toBeUndefined();
  });
});

describe('core/text', () => {
  it('normalizeKey', () => {
    expect(normalizeKey('Donor Name')).toBe('donorname');
    expect(normalizeKey('donor_name')).toBe('donorname');
    expect(normalizeKey(undefined)).toBe('');
    expect(normalizeKey('Amount (₹)')).toBe('amount');
    // Hindi keeps its letters and vowel signs, so it never collapses to '' and matches itself.
    expect(normalizeKey('रसीद नंबर')).toBe('रसीदनंबर');
    expect(normalizeKey('रसीद_नंबर')).toBe(normalizeKey('रसीद नंबर'));
    expect(normalizeKey('राशि')).not.toBe(normalizeKey('तारीख'));
  });

  it('parseNumber', () => {
    expect(parseNumber('₹5,000.50')).toBe(5000.5);
    expect(parseNumber('15,000 kg')).toBe(15000);
    expect(parseNumber(12)).toBe(12);
    expect(parseNumber('n/a')).toBeNull();
    expect(parseNumber(Number.NaN)).toBeNull();
  });

  it('reads digits written in Indian scripts', () => {
    expect(toAsciiDigits('₹१,५४० / ২০২৬ / ૧૨૩ / ௯')).toBe('₹1,540 / 2026 / 123 / 9');
    expect(toAsciiDigits('Ramesh 42')).toBe('Ramesh 42');
    expect(parseNumber('₹१,५४०')).toBe(1540);
    expect(parseNumber('१२.५ किलो')).toBe(12.5);
  });
});
