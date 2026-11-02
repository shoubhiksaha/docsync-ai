import { chromeIntentUrl, isAndroid, isInAppBrowser } from '@/app/login/in-app-browser';

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  webViewAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0;]',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.0 (iPhone14,5; iOS 17_5; en_IN)',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

describe('isInAppBrowser', () => {
  it("spots apps' built-in browsers, where Google refuses sign-in", () => {
    for (const ua of [UA.webViewAndroid, UA.facebookAndroid, UA.facebookIos, UA.instagramIos]) expect(isInAppBrowser(ua)).toBe(true);
  });

  it('leaves real browsers alone', () => {
    for (const ua of [UA.chromeAndroid, UA.safariIos, UA.samsung, UA.desktop, '', null, undefined]) expect(isInAppBrowser(ua)).toBe(false);
  });

  it('tells Android, where Chrome can be opened directly', () => {
    expect(isAndroid(UA.facebookAndroid)).toBe(true);
    expect(isAndroid(UA.instagramIos)).toBe(false);
    expect(isAndroid(null)).toBe(false);
  });
});

describe('chromeIntentUrl', () => {
  it('opens the same page in Chrome, with the address as the fallback', () => {
    expect(chromeIntentUrl('https://docsync.example/scan/ngo-receipt?x=1')).toBe(
      'intent://docsync.example/scan/ngo-receipt?x=1#Intent;scheme=https;package=com.android.chrome;'
      + 'S.browser_fallback_url=https%3A%2F%2Fdocsync.example%2Fscan%2Fngo-receipt%3Fx%3D1;end',
    );
  });

  it("drops a #fragment, which would cut the intent's own part short", () => {
    expect(chromeIntentUrl('https://docsync.example/login#faq').startsWith('intent://docsync.example/login#Intent;')).toBe(true);
  });
});
