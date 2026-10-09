# Rally grassroots sports demo

A responsive, installable web app built from `Grassroots_Sports_Platform_Master_Vision.docx`. No login, backend, payment gateway or personal data is needed. All athletes, competitions, rankings and transactions are fictional sample data.

Deploy this repository to Vercel using the included `vercel.json`: framework Vite, build command `npm run build`, output directory `dist`. No environment variables are required. Use the resulting HTTPS address to preview and install on phones.

## Run and preview

```powershell
npm install
npm run build
npm run preview
```

Open http://localhost:4173 on this computer. For an editable development server, use `npm run dev` (port 5173).

## Install on Android and iPhone

Use the deployed HTTPS demo address. Preview the app before installing.

- Android: open in Chrome → menu → Install app / Add to Home screen.
- iPhone: open in Safari → Share → Add to Home Screen → Add. Keep “Open as Web App” enabled if offered.
- The sidebar’s “Get the app” button repeats these instructions and shows a native browser install prompt when available.

This is a home-screen installed PWA, not an APK, IPA or store release. Local network HTTP can preview the UI but does not support secure PWA installation. After an initial online visit and service-worker activation, application files and demo data work offline. Fonts have system fallbacks. Demo edits are stored in this browser and do not sync between devices. The installed app can use a separate storage context, depending on platform.

## Demo walkthrough

1. Discover → choose a tournament → accept demo rules → simulate payment → confirmation → My events.
2. Rankings → sport/city/category filters → athlete passport → sample stats, achievements, story and SVG certificate.
3. Organizer → approve a participant → generate sample draw → schedule preview → record a result → updated rankings and history. Publishing again for the same event replaces the placement award instead of duplicating points.
4. Organizer → create a tournament → find it in Discover. Export an event CSV report or publish a local announcement.
5. Community → follow athletes, react to stories, open sample interviews and media storyboards.
6. Explore as Parent → Athlete passport shows the fictional junior athlete Ananya. Junior contact is disabled.
7. Rising athletes / Academies → explore athlete and academy records. Visibility consent is simulated locally.
8. Leagues → sample circuit, promotion/relegation explanation, waitlist and sponsor report.
9. Marketplace → simulate a court, coaching or merchandise booking.
10. Admin → ranking awards for future results, sample dispute resolution and demo reset.

Use “Explore as” to demonstrate athlete, visitor, parent, organizer, coach/scout, academy, sponsor and admin perspectives. There are no authentication or authorization boundaries in this presentation demo.

## Scope and fidelity

The main athlete and organizer loop is interactive. Fixture times, draws, ranking trend bars, ratings, academy metrics and sponsor reports are illustrative. Draw generation reveals a fixed seeded sample draw; it is not a sport-specific tournament engine. Format choices demonstrate the future organizer UI, rather than implementing each bracket algorithm. Registration categories, rules and locations are sample data. Real eligibility checks, payment/refund processing, verification, age consent, moderation, contacts, media hosting, live scoring, advanced analytics, national ranking rules and AI modules require production services.

The document’s strategic recommendations are reference material. The user's request controls this build: skip login and show the broader vision with dummy data, including roadmap previews that the document excludes from its initial MVP.

## Verification

```powershell
npx playwright install chromium
npm run preview
# In another terminal:
npm test
```

Tests cover registration, persistence, remaining spots, approval, draw display, publishing points, leaderboard display, tournament creation, profile editing, bookings, offline reload, mobile navigation, horizontal overflow, manifest metadata and browser errors. These use desktop Chromium and a phone-size Chromium viewport; physical Android/iPhone installation remains a device check.

Screenshots are in `preview/`. Static deployment files are in `dist/`. Runtime code is in `src/`.

## Assets

Sample sports photos from Unsplash; pickleball court illustration and Rally icon created for this demo. UI uses Lucide icons, DM Sans and Manrope with local system fallbacks. Photo IDs are recorded in `scripts/assets.mjs` (badminton replacement: `photo-1626224583764-f87db24ac4ea`).

## Build validation

Production build, browser-flow tests and dependency audit were run during delivery. No real service credentials are required by this app.
