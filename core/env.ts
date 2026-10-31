/**
 * Environment helpers shared by every module. Everything here is read lazily on each call,
 * so a missing variable only affects the module that needs it — never the whole app at import time.
 */

export type AppEnvironment = 'production' | 'staging' | 'development' | 'test';

export function appEnvironment(): AppEnvironment {
  const explicit = process.env.APP_ENV;
  if (explicit === 'production' || explicit === 'staging' || explicit === 'development' || explicit === 'test') {
    return explicit;
  }
  return process.env.NODE_ENV === 'test' ? 'test' : 'development';
}

/** Git SHA the running build was made from (inlined by next.config.mjs at build time). */
export function appVersion(): string {
  return process.env.APP_BUILD_SHA || 'dev';
}

/** Trimmed env value, or undefined when unset/blank. */
export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export type ModuleName =
  | 'ai'
  | 'extraction'
  | 'transcription'
  | 'sheets'
  | 'notion'
  | 'media'
  | 'settings';

export const MODULE_NAMES: readonly ModuleName[] = [
  'ai', 'extraction', 'transcription', 'sheets', 'notion', 'media', 'settings',
];

/**
 * Kill switch per module: set MODULE_<NAME>=off (or false/0/disabled) to turn a module off
 * without a code change. Disabled modules report "skipped" and the rest of the app keeps working.
 */
export function isModuleEnabled(name: ModuleName): boolean {
  const raw = process.env[`MODULE_${name.toUpperCase()}`]?.trim().toLowerCase();
  return !(raw === 'off' || raw === 'false' || raw === '0' || raw === 'disabled');
}
