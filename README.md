# NeighborhoodOS

A mobile-first Northeast Ohio neighborhood app. The initial pilot areas are Old Brooklyn, Parma, Brook Park, and Lakewood. People choose and attest to their neighborhood. The app does not collect residential addresses or verify residency.

## Run the isolated demo

Use Node 24. Run the following from this directory.

    npm ci
    npm run dev

Open http://127.0.0.1:4173 and sign in with ava@neighborhood.test and local-fixture-pass. Other local accounts include jamal, luis, rina, devon, and taylor at neighborhood.test, all with the same fixture password. Luis owns a sample business. Rina and Devon are separate moderators. Taylor is in a different neighborhood. Data is discarded when the process exits. No local fixture accounts or companies are included in production builds.

    npm test
    npx playwright install chromium --only-shell
    npm run browser
    npm run build

For a specific system Chromium, set CHROMIUM_PATH. For local app testing against a dedicated hosted Supabase project, set LOCAL_FIXTURES=false and load the values from .env.example into the process environment. Keep OPEN_SIGNUPS=false until pilot enrollment is ready.

## App and privacy boundaries

- A confirmed Supabase identity and enrolled neighborhood membership are required for feeds, business directory, and messages. Profile enrollment starts invite-only. Community posts and directory entries are visible only within the selected neighborhood.
- Residents can recommend anyone and reply using a personal account. Business profiles and replies are free. Linking an owned profile automatically adds an affiliation disclosure. A person without a profile can disclose a relevant affiliation on the reply.
- One-to-one messages are visible in-app only to the two participants. Either participant can block future messages. Messages are stored in the database and are not end-to-end encrypted. Database operators retain infrastructure access.
- A private SQL dispatcher enforces authorization on every operation. Client roles cannot query the private tables. The web API uses secure HttpOnly session cookies, origin checks, bounded payloads, and operation-specific database rate limits.
- Reviews are screened inside PostgreSQL using a transparent Bernoulli naive Bayes classifier over signals such as matching review text, incentives, affiliation, promotional terms, possible private information, and potentially abusive language. The classifier is fitted on 38 synthetic signal patterns and ranks the queue. It has no calibration on real community reviews. Its output is a triage signal. Every initial publication or removal requires a human decision. Appeals require a different authorized moderator. The author can see the reason and appeal status.
- Verified Business is optional and costs $100/month when billing is enabled. Human approval requires written evidence from independent identity, public contact control, and applicable credential checks. Payment is possible only after approval. A badge is computed from unexpired approval and a current paid Stripe subscription. Website or category changes invalidate vetting. Neither checkout completion alone nor the synthetic fixture grants a badge in a live deployment.

## Pilot operator workflow

1. Use a dedicated Supabase project. Apply the tracked migrations in order. Keep the neighborhood schema outside the Data API's exposed schema list.
2. Set the deployed origin as Supabase Auth's Site URL. Add the exact callback URL with the query string from the application, /api/core?action=callback, to allowed redirects for each approved origin. Keep email confirmation on. Configure transactional SMTP, review sender and rate limits, and test sign-up, recovery, and expiry with controlled inboxes before opening enrollment. PKCE confirmation links are designed to be opened in the original browser.
3. Provision confirmed pilot accounts through the approved Auth enrollment process. Add each authorized auth.users UUID to neighborhood.pilot_access. Add only named staff UUIDs to neighborhood.staff with role moderator or admin. Assign at least two moderators before taking live reviews. Provision real accounts separately from test fixtures.
4. Keep APP_ORIGIN fixed in hosted environments. Use SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for standard access. Leave Stripe and the Supabase backend secret unset for a no-billing pilot. Enable real public enrollment only when both the app OPEN_SIGNUPS and the database neighborhood.launch_settings.public_enrollment gates are intentionally opened.
5. Start with a private cohort. Assign an operator for community reports, suspected review fraud, appeals, business vetting, and account-data requests. Publish a support contact and an approved retention policy. Define the identity and privacy escalation path before a public launch. Neighborhood membership is self-attested.
6. For Vercel, use a new NeighborhoodOS project, the checked-in Vite settings, and a private preview before a public deployment. Confirm the team plan permits the intended use. The GitHub copy should be a dedicated private repository. Keep provider credentials, hosted test passwords, and test session tokens out of source.

## Vetting procedure

Check the submitted legal name against an independent registry or an appropriate official alternative. Record the checked record, source, and date. Independently locate a public business contact and challenge control through that channel. Check license and insurance where applicable and record the source, dates, and outcome, or document why a credential is inapplicable. Record discrepancies before approving. Keep identity documents and sensitive records out of the application. Approval expires after one year. Revocation hides the badge immediately. The badge does not guarantee work quality.

## Billing activation

1. In Stripe test mode first, create a recurring USD 100.00 monthly price with a quantity of one. Configure the billing portal and set the test secret key, price ID, webhook signing secret, and dedicated Supabase backend secret in the host's protected runtime configuration. The app refuses billing unless these values and APP_ORIGIN are present.
2. Configure the webhook at /api/core?action=stripe-webhook. Subscribe to checkout.session.completed, checkout.session.expired, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, customer.subscription.paused, customer.subscription.resumed, invoice.paid, invoice.payment_failed, invoice.payment_action_required, invoice.voided, and invoice.marked_uncollectible.
3. Verify checkout retry, activation, cancellation, renewal, payment failure, delayed webhook delivery, recovery, and test-mode isolation before live billing. The app checks provider signatures, canonical subscription state, price, invoice, and checkout binding. Handle refunds and disputes operationally before accepting live payments. They do not automatically revoke the badge.
4. For a checkout reservation that never reaches Stripe or has an unrecoverable webhook failure, check Stripe for any session and subscription first. Only after confirming there is neither an active subscription nor an open checkout may an authorized database operator clear that business's checkout key.

## Private preview build

The npm run build:sites command packages the same application as a Worker for the owner-private review deployment. The Sites manifest is specific to that private preview. The Vercel target uses npm run build and the API handler in api/core.js. Store runtime configuration in the host, outside the source tree.
