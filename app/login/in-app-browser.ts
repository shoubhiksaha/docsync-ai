/**
 * Google refuses sign-in inside apps' built-in browsers ("Error 403: disallowed_useragent"), and a
 * link shared on Facebook or Instagram opens in one. /login spots them by user agent and asks the
 * visitor to open the page in Chrome instead (InAppBrowserNotice).
 *
 * Android's own WebView marks itself "; wv)". Facebook, Instagram, Line, Snapchat and WeChat add
 * their names, on iPhones too. Chrome Custom Tabs and installed web apps are real Chrome: no marker.
 */
const IN_APP_BROWSER = /; wv\)|FBAN\/|FBAV\/|FB_IAB|FBIOS|Instagram|\bLine\/|Snapchat|MicroMessenger/;

export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return !!userAgent && IN_APP_BROWSER.test(userAgent);
}

export function isAndroid(userAgent: string | null | undefined): boolean {
  return !!userAgent && /Android/i.test(userAgent);
}

/** The notice's id: sign-in controls point here instead of opening Google (useSignIn). */
export const IN_APP_NOTICE_ID = 'in-app-browser';

/**
 * Opens `url` in Chrome from an Android app's built-in browser; without Chrome, at the same address
 * in the browser Android picks. Its #fragment is dropped, since the intent's own part starts at #.
 */
export function chromeIntentUrl(url: string): string {
  const { host, pathname, search } = new URL(url);
  return `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}
