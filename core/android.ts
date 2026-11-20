/**
 * The Android app (android/, a Trusted Web Activity) and the certificates that sign it, served as
 * Digital Asset Links by app/.well-known/assetlinks.json so Android opens the app full screen,
 * without Chrome's address bar. Fingerprints are public by design: each is the SHA-256 of a signing
 * certificate. List the upload key (builds installed by hand) and, once the app is on Play, Play's
 * app signing key (Play Console → Test and release → App integrity).
 */
export const ANDROID_APPS: readonly { packageName: string; fingerprints: readonly string[] }[] = [
  {
    packageName: 'tech.analogdigital.docsync',
    fingerprints: [
      // Upload key (~/.docsync-android/upload-key.jks on the release machine; see android/README.md).
      'D9:74:F5:A5:AD:DF:AF:7E:53:66:DB:20:9F:FC:63:18:EE:8B:18:E5:EB:9D:27:C7:CD:15:32:E9:8E:37:75:80',
    ],
  },
];

/** Asset Links statements for this server. Only production claims the app; staging never does. */
export function assetLinks(production: boolean) {
  return (production ? ANDROID_APPS : []).map(app => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: app.packageName, sha256_cert_fingerprints: app.fingerprints },
  }));
}
