# Android test APK and App Bundle

Trusted Web Activity origin: https://rally-tournaments-test.vercel.app. Package: app.rally.tournaments.test. The wrapper reuses the PWA/API, without a separate offline business database. Choose the production package/signing owner before a store release. Native iOS publication is deferred; Safari supports PWA installation.

npm run android:generate generates the Bubblewrap project from deployed icons. Java 17 and SDK 36 are used. Configure the SDK in ignored android/local.properties, then run gradlew.bat assembleRelease bundleRelease inside android. scripts/android-sign.mjs signs test artifacts locally. Keystores/password files and generated artifacts are ignored. Preserve the signing key securely; installed updates require the same certificate.

/.well-known/assetlinks.json must include the installed APK's SHA-256 signing fingerprint and matching package. For Play builds add the Play App Signing certificate, not just the upload key. A mismatch produces browser-toolbar fallback rather than a verified full-screen TWA.

Test on a physical phone: install/update, verified origin, Google/email login/recovery, doubles links, private uploads, navigation/back, offline browsing and connectivity-required changes. No physical phone was attached during development. Play registration, policy/privacy review, tester access and store submission remain operator steps. A signed test AAB does not establish store readiness.

Listing draft: Rally ? tournaments for your game. Discover badminton, tennis and pickleball; register adults or guardian-managed juniors; coordinate doubles; track manually reviewed payments, fixtures and verified results. Testing uses simulated payments only. Store policy links: /privacy, /account-deletion, /support. Publish actual operator contact and final policies before submission.
