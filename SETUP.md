# Connect providers after reviewing the code

Configure **rally-tournaments-test**, never the original demo. Production here means the stable test URL; payments remain simulated.

1. Vercel ? Storage: connect a free Neon PostgreSQL database. Put its **pooled** URL in DATABASE_URL for Production/Preview. Keep it secret.
2. Firebase: enable Google and Email/Password authentication, register a web app, and authorise rally-tournaments-test.vercel.app and localhost. Configure verification/recovery templates and provider support email. Keep account enumeration protection enabled.
3. Put public web configuration in VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID. Put service-account credentials ONLY in server variables FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY. Private keys accept newlines or escaped \n. Never prefix secrets with VITE_.
4. ADMIN_EMAILS lists approved verified owner emails. Admin is assigned only on first account creation. Existing accounts require trusted database promotion; list changes do not silently promote them. Remove example owner values when using another owner.
5. Create a private Blob store for evidence/avatars and a public store for posters. Use separate PRIVATE_BLOB_READ_WRITE_TOKEN and PUBLIC_BLOB_READ_WRITE_TOKEN values. Never point the private variable at a public store. Screenshots are optional while storage is unconfigured.
6. Keep PAYMENTS_MODE=test and COMMERCIAL_LAUNCH_ENABLED=false. Leave merchant values blank. Live operation requires both flags plus merchant settings and is outside private testing.
7. Securely copy values into ignored .env, or pull with Vercel CLI linked specifically to this test project. Run npm run db:migrate against this test database. Never share secrets in chat, issues, commits or screenshots.
8. Redeploy real-app. VITE_ values are compiled and require a new build. Check /api/v1/health, sign in as owner, create/publish a sample event, and verify it on a signed-out second device. Use TEST- references; no bank transfer.

Run the approved acceptance checklist against actual services: Google/email verification/recovery/deletion; adult/junior onboarding; doubles from two accounts; concurrent final-slot reservations on Neon; duplicate/retried/late payments; other-user screenshot denial; draws/progression/corrections; cancellations/withdrawals/refunds; phone installation; export/restore to another database. Monitor provider quotas/errors. Blob bytes and Firebase users are outside database backups.

For automatic deployments, connect GitHub and explicitly set the test project's production branch to **real-app**; the demo's production branch stays **main**. Avoid giving arbitrary PRs production credentials. Publish actual operator/support contact and final policies before store submission.
