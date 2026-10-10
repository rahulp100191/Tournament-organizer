# Rally tournament platform

The `real-app` branch contains the athlete/admin platform. The original demo stays on `main` at https://rally-grassroots-demo.vercel.app. Deploy this branch only to **rally-tournaments-test**. No Cloudflare services or tunnels are used.

React/Vite PWA + Vercel TypeScript API + Neon PostgreSQL + Firebase verified Google/email authentication + public/private Vercel Blob storage. Business data never uses browser localStorage. Unconfigured deployments show clearly labelled, read-only design samples.

## Run

```powershell
npm ci
Copy-Item .env.example .env
# Configure ignored .env securely.
npm run db:migrate
npm run dev:api
# Another terminal:
npm run dev
```

Open http://localhost:5173. `npm run build` typechecks/builds the PWA; `npm test` runs PostgreSQL-compatible integration tests without credentials; `npm run test:browser` verifies actual screens/API/database together and captures `preview/real-app/`. Identity injection exists only in the local test process. The test UI harness is never included in a production build.

## Implemented flows

Athletes browse published events anonymously, filter sport/location/date/category/level/fee, sign in, manage adult/junior multi-sport profiles, submit official ranking claims, choose an eligible category and reserve a slot. Doubles requires partner acceptance. Whole-team categories collect a captain profile, public team name and target roster size; every teammate or guardian independently accepts using their own eligible profile. Payment opens only when the roster is complete, subject to remaining capacity. One team has one payment and one slot. TEST payments remain pending until admin review. My Rally shows entries, partner invitations, corrections, withdrawals, refunds, notifications, history, certificates and disputes.

Admin creates tournaments for preset or custom sports with public description, organiser contact, venue address/map, schedule/deadlines, rules/refund policy and individual/doubles/team categories. Team categories configure roster limits, fees and final-score or set scoring; round-robin final-score categories also support draws and configurable league points. Admin drafts/publishes/closes/cancels events, configures eligibility, reviews payments and registration consent, handles refunds/withdrawals, exports reports, publishes seeded knockout or round-robin draws, schedules courts/times, records/corrects results and resolves disputes. Every decision has an audit record. Only athletes and guardians create or maintain athlete profiles; Admin cannot edit them or review self-reported federation rankings.

## Data guarantees

Category row locks serialize reservation/payment/draw/result operations. Unpaid holds expire after 30 minutes bounded by deadlines; submitted payments retain their slot until review. Late claims never bypass capacity. Unique idempotency keys, references/fingerprints and one-open-payment constraints protect retries. Result corrections replace awards transactionally.

DOB, phone, guardian details and evidence stay private; juniors cannot opt into public visibility. Adults can opt into public names/results. Evidence and avatars use private Blob storage, authenticated owner/admin streaming and no-store responses. Image metadata is stripped; size/type/pixel limits apply. Only public browsing assets and API responses are cached. Mutations require connectivity. Verified tokens and ownership are checked on every protected request; clients cannot choose admin roles. Account deletion removes evidence, scrubs personal data and deletes Firebase sign-in while preserving anonymised competition records and duplicate-reference fingerprints. Active entries must be withdrawn first; incomplete sign-in deletion can be retried.

## Backup

`npm run db:backup -- export private.rally-backup.json` exports a consistent snapshot. Set DATABASE_URL to a different empty migrated database before `npm run db:backup -- restore private.rally-backup.json`. Restore refuses nonempty databases and restores bracket links transactionally. Files contain private data: encrypt and keep outside Git. Upload references are exported, not Blob bytes; Firebase accounts require separate provider recovery.

## Setup and delivery

Follow [SETUP.md](SETUP.md), then [ANDROID.md](ANDROID.md). iPhone users install the PWA through Safari ? Share ? Add to Home Screen. Test payments never collect money. Free provider tiers have quotas, and appropriate hosting terms are needed before commercial operation.

Local tests do not establish store readiness. Verify real Firebase verification/recovery/deletion, actual Neon concurrency, private Blob ownership, cross-device entries, quota monitoring, and physical phone installation/login/uploads/offline behavior after provider configuration. The operator must supply final legal/retention policies, identity/support contact, Play account, signing ownership and eligible testers.

Deliberate limits: manual bank reconciliation, in-app notifications, SVG certificates (downloaded copies cannot be revoked), deterministic entry-ID tiebreak after round-robin wins/set difference/point difference. Eligibility/categories/fees cannot be rewritten after entries exist; use announcements/schedule changes/cancellation. No real gateway, SMS OTP, push delivery, native iOS release, marketplace, scouts, sponsors, video or social feeds. The vision document is reference material; the approved tournament plan controls this branch. Sports images and branding reuse the original demo assets.
