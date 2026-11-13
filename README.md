# NeighborhoodOS

A mobile-first Northeast Ohio neighborhood app. The initial pilot areas are Old Brooklyn, Parma, Brook Park, and Lakewood. People choose and attest to their neighborhood. Address verification is optional and deletes the address once a postcard is mailed.

## What is in the app

- Neighborhood feed with discussions, events with RSVPs, polls, service requests, safety alerts, lost and found, and business updates. Posts can carry one photo. Neighbors can thank a post and reply in threads.
- Three views of the feed and marketplace: your neighborhood, nearby neighborhoods, and all of Northeast Ohio. Nearby means sharing a border; the links in `neighborhood.area_links` are generated from the real outlines by the map build.
- A built-in map of Cleveland's 34 neighborhoods and Cuyahoga County's 57 suburbs with water, highways, main roads and local streets. It is generated from open data by `node tooling/build-map.mjs`, shipped as static files under `public/map`, and changes only on a deploy. No map provider is contacted. New members can drop a pin to choose their neighborhood; the pin's position is never sent to the server.
- Marketplace for items for sale or free, with price, pickup area, photo, and a sold marker.
- Business directory with free profiles (logo, phone, hours), human-moderated reviews with ratings, a vetted-only filter, and up to two business updates a week.
- Notifications for replies, thanks, RSVPs, messages, safety alerts, review and vetting decisions. Search across posts, businesses and neighbors. Neighbor profiles with a short introduction.
- One-to-one messages with blocking. Blocking also hides that person's posts from your feed and search.
- Installable on a phone home screen through the web app manifest.

## Run the isolated demo

Use Node 24. Run the following from this directory.

    npm ci
    npm run dev

Open http://127.0.0.1:4173 and sign in with ava@neighborhood.test and local-fixture-pass. Other local accounts include jamal, luis, rina, devon, and taylor at neighborhood.test, all with the same fixture password. Luis owns a sample business. Rina and Devon are separate moderators. Taylor is in a different neighborhood. Data is discarded when the process exits. No local fixture accounts or companies are included in production builds.

    npm test
    npx playwright install chromium --only-shell
    CHROMIUM_PATH=/path/to/chromium npm run browser
    npm run build

For a specific system Chromium, set CHROMIUM_PATH. For local app testing against a dedicated hosted Supabase project, set LOCAL_FIXTURES=false and load the values from .env.example into the process environment. Keep OPEN_SIGNUPS=false until pilot enrollment is ready.

## App and privacy boundaries

- A confirmed Supabase identity and enrolled neighborhood membership are required for feeds, business directory, and messages. Profile enrollment starts invite-only. Each post carries an audience its author chooses: their neighborhood only, their neighborhood and nearby ones, or all of Northeast Ohio. The feed and marketplace can be switched between those three views. Posts written before this choice existed stay inside their neighborhood. The business directory and reviews stay local; a business page, a neighbor's profile and direct messages open across neighborhoods only through a post the member can see.
- Residents can recommend anyone and reply using a personal account. Business profiles and replies are free. Linking an owned profile automatically adds an affiliation disclosure. A person without a profile can disclose a relevant affiliation on the reply.
- One-to-one messages are visible in-app only to the two participants. Either participant can block future messages. Messages are stored in the database and are not end-to-end encrypted. Database operators retain infrastructure access.
- A private SQL dispatcher enforces authorization on every operation. Client roles cannot query the private tables. The web API uses secure HttpOnly session cookies, origin checks, bounded payloads, and operation-specific database rate limits.
- Reviews are screened inside PostgreSQL using a transparent Bernoulli naive Bayes classifier over signals such as matching review text, incentives, affiliation, promotional terms, possible private information, and potentially abusive language. The classifier is fitted on 38 synthetic signal patterns and ranks the queue. It has no calibration on real community reviews. Its output is a triage signal. Every initial publication or removal requires a human decision. Appeals require a different authorized moderator. The author can see the reason and appeal status.
- Vetted Business is optional and costs a one-time $250 when billing is enabled. Human approval requires written evidence from independent identity, public contact control, and applicable credential checks. Payment is possible only after approval, so a declined business is never charged. A badge is computed from unexpired approval and a recorded, unrefunded payment. Approval lasts one year and a recheck is free. Website, phone or category changes invalidate vetting, and a full refund removes the badge. Neither checkout completion alone nor the synthetic fixture grants a badge in a live deployment.
- Address verification is verify-then-delete. A member submits a mailing address and staff post a card carrying a one-time code. Recording the card as mailed erases the address and the plain code in the same statement, and a table constraint makes any other state impossible to store. Entering the code deletes the remaining record and keeps only the verification date. Withdrawn, declined, failed (five wrong codes) and stale (45 days) requests are deleted. Staff who post the card see the address while it is waiting, and it is never written to the audit log.
- Photos are resized in the browser to a JPEG under 300 KB, stored in the database, and served only to signed-in members of the same neighborhood. This suits a pilot. Move photos to object storage before a wide launch.

## Pilot operator workflow

1. Use a dedicated Supabase project. Apply the tracked migrations in order. Keep the neighborhood schema outside the Data API's exposed schema list.
2. Set the deployed origin as Supabase Auth's Site URL. Add the exact callback URL with the query string from the application, /api/core?action=callback, to allowed redirects for each approved origin. Keep email confirmation on. Configure transactional SMTP, review sender and rate limits, and test sign-up, recovery, and expiry with controlled inboxes before opening enrollment. PKCE confirmation links are designed to be opened in the original browser.
3. Provision confirmed pilot accounts through the approved Auth enrollment process. Add each authorized auth.users UUID to neighborhood.pilot_access. Add only named staff UUIDs to neighborhood.staff with role moderator or admin. Assign at least two moderators before taking live reviews. Provision real accounts separately from test fixtures.
4. Keep APP_ORIGIN fixed in hosted environments. Use SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for standard access. Leave Stripe and the Supabase backend secret unset for a no-billing pilot. Enable real public enrollment only when both the app OPEN_SIGNUPS and the database neighborhood.launch_settings.public_enrollment gates are intentionally opened.
5. Schedule `select neighborhood.purge_residency()` daily with the backend role (for example with pg_cron) so unfinished address requests are deleted even when no moderator opens the queue. Opening the moderation queue also runs it.
6. Start with a private cohort. Assign an operator for community reports, suspected review fraud, appeals, business vetting, and account-data requests. Publish a support contact and an approved retention policy. Define the identity and privacy escalation path before a public launch. Neighborhood membership is self-attested.
7. For Vercel, use a new NeighborhoodOS project, the checked-in Vite settings, and a private preview before a public deployment. Confirm the team plan permits the intended use. The GitHub copy should be a dedicated private repository. Keep provider credentials, hosted test passwords, and test session tokens out of source.

## Vetting procedure

Check the submitted legal name against an independent registry or an appropriate official alternative. Record the checked record, source, and date. Independently locate a public business contact and challenge control through that channel. Check license and insurance where applicable and record the source, dates, and outcome, or document why a credential is inapplicable. Record discrepancies before approving. Keep identity documents and sensitive records out of the application. Approval expires after one year. Revocation hides the badge immediately. The badge does not guarantee work quality.

## Billing activation

1. In Stripe test mode first, create a one-time USD 250.00 price. Set the test secret key, price ID, webhook signing secret, and dedicated Supabase backend secret in the host's protected runtime configuration. The app refuses billing unless these values and APP_ORIGIN are present.
2. Configure the webhook at /api/core?action=stripe-webhook. Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.expired, and charge.refunded.
3. Verify checkout retry, payment, expiry, delayed webhook delivery, full refund, and test-mode isolation before live billing. The app checks provider signatures and re-reads the Checkout Session for mode, status, currency, the undiscounted amount, and checkout binding. Do not attach coupons to this price, because a discounted session is not accepted. A full refund removes the badge automatically. Partial refunds and disputes are handled operationally.
4. For a checkout reservation that never reaches Stripe or has an unrecoverable webhook failure, check Stripe for any session and payment first. Only after confirming there is neither a completed payment nor an open checkout may an authorized database operator clear that business's checkout key.

## Private preview build

The npm run build:sites command packages the same application as a Worker for the owner-private review deployment. The Sites manifest is specific to that private preview. The Vercel target uses npm run build and the API handler in api/core.js. Store runtime configuration in the host, outside the source tree.
