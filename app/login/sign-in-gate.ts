/**
 * One Google sign-in at a time for the whole landing page. Every sign-in control (header, hero,
 * document links, final button) shares this, so a second tap anywhere doesn't start another
 * NextAuth sign-in with its own callbackUrl that races the first on the callback and PKCE cookies.
 */

/** What a tap did: started sign-in, was ignored because one is under way, or the phone is offline. */
export type SignInOutcome = 'started' | 'busy' | 'offline';

export interface SignInSteps {
  isOnline: () => boolean;
  signIn: () => Promise<unknown>;
  /** NextAuth still hasn't sent the browser to Google after the timeout; the controls work again. */
  onSlow: () => void;
  /**
   * NextAuth's request failed (a dropped connection, or an error page instead of JSON). A weak
   * signal still counts as online, so isOnline doesn't catch this; the controls work again.
   */
  onError: () => void;
}

/** Long enough for NextAuth's three round trips on 2G, short enough that nobody reloads first. */
export const SIGN_IN_TIMEOUT_MS = 15_000;

export function createSignInGate(timeoutMs = SIGN_IN_TIMEOUT_MS) {
  /** The control that started the sign-in under way, or null. */
  let owner: string | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const set = (next: string | null) => {
    if (owner === next) return;
    owner = next;
    listeners.forEach(listener => listener());
  };

  return {
    owner: () => owner,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start(from: string, steps: SignInSteps): SignInOutcome {
      if (owner !== null) return 'busy';
      // Offline, NextAuth would send the page to /api/auth/error, which only the browser's own
      // "No internet" page can show.
      if (!steps.isOnline()) return 'offline';
      const mine = ++attempt;
      set(from);
      timer = setTimeout(() => {
        if (mine !== attempt) return;
        attempt++;
        set(null);
        steps.onSlow();
      }, timeoutMs);
      Promise.resolve().then(steps.signIn).then(
        // NextAuth has sent the browser to Google: the browser shows that load, and a second tap
        // now would only spoil the first sign-in's cookies.
        () => { if (mine === attempt) clearTimeout(timer); },
        () => {
          if (mine !== attempt) return;
          clearTimeout(timer);
          set(null);
          steps.onError();
        },
      );
      return 'started';
    },
    /** Back on the page with the browser's Back button, as it was left. */
    reset() {
      attempt++;
      clearTimeout(timer);
      set(null);
    },
  };
}

export const signInGate = createSignInGate();

/**
 * Marks every sign-in control (SignInButton, StartLink). Until the page's JavaScript has arrived,
 * which takes many seconds on 2G, the value is "waiting"; "queued" once one was tapped, and
 * "ready" once the control works on its own (useSignIn).
 */
export const SIGN_IN_ATTRIBUTE = 'data-sign-in';

/**
 * Marks the language switch (LanguageButton): "waiting" until the page's JavaScript has arrived,
 * "sending" once tapped before that (the form posts to /login/language without it), "ready" after.
 */
export const LANGUAGE_ATTRIBUTE = 'data-lang-switch';

/** The line KEEP_EARLY_TAPS shows when a kept tap waited too long for the page's JavaScript. */
export const SIGN_IN_STALLED_ID = 'sign-in-stalled';

/**
 * How long a kept tap waits for the page's JavaScript: a little longer than SIGN_IN_TIMEOUT_MS,
 * since the JavaScript has to arrive before NextAuth's round trips can even start.
 */
export const EARLY_TAP_TIMEOUT_MS = 20_000;

/**
 * Runs inline at the top of the landing page, long before React. A tap on a sign-in control that
 * isn't ready yet is kept instead of lost: the control shows a spinner (login.module.css) and
 * sign-in starts as soon as it is ready. One tap is kept; a link isn't followed meanwhile, which
 * would only load /login again. Ctrl/Cmd-click on a document link still opens a new tab. If the
 * JavaScript hasn't arrived after EARLY_TAP_TIMEOUT_MS (a chunk lost on 2G, a browser that runs
 * none of it), the control works again and a line says to reload the page.
 *
 * A tap on the language switch goes ahead as a plain form post; it only shows a spinner.
 */
export const KEEP_EARLY_TAPS = `document.addEventListener('click', function (e) {
  var target = e.target instanceof Element ? e.target : null;
  var lang = target && target.closest('[${LANGUAGE_ATTRIBUTE}]');
  if (lang && lang.getAttribute('${LANGUAGE_ATTRIBUTE}') === 'waiting') lang.setAttribute('${LANGUAGE_ATTRIBUTE}', 'sending');
  var el = target && target.closest('[${SIGN_IN_ATTRIBUTE}]');
  if (!el || el.getAttribute('${SIGN_IN_ATTRIBUTE}') === 'ready') return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (document.querySelector('[${SIGN_IN_ATTRIBUTE}="queued"]')) return;
  el.setAttribute('${SIGN_IN_ATTRIBUTE}', 'queued');
  setTimeout(function () {
    if (el.getAttribute('${SIGN_IN_ATTRIBUTE}') !== 'queued') return;
    el.setAttribute('${SIGN_IN_ATTRIBUTE}', 'waiting');
    var stalled = document.getElementById('${SIGN_IN_STALLED_ID}');
    if (stalled) stalled.hidden = false;
  }, ${EARLY_TAP_TIMEOUT_MS});
}, true);
window.addEventListener('pageshow', function (e) {
  var lang = e.persisted && document.querySelector('[${LANGUAGE_ATTRIBUTE}="sending"]');
  if (lang) lang.setAttribute('${LANGUAGE_ATTRIBUTE}', 'waiting');
});`;
