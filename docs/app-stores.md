# Nabora in the app stores

Nabora is a web app. The Android app is a Trusted Web Activity (TWA): Chrome shows nabora.us full screen inside a
Play Store app, with no browser bar. Every website deploy updates the app, so you only resubmit to Google to
change the icon, name or version. The iOS app comes later (Capacitor plus a cloud Mac build); see the end.

## 1. Turn on notifications (one time, about 2 minutes)

Notifications need a key pair. The public key goes to browsers; the private key signs each notice.

1. On any computer with Node.js, or in Vercel's or StackBlitz's web terminal, run:
   `npx web-push@3.6.7 generate-vapid-keys`
2. In Vercel → **neighborhood-os-prod** → Settings → Environment Variables, add (Production only):
   - `VAPID_PUBLIC_KEY`: the Public Key line. Type: Plain.
   - `VAPID_PRIVATE_KEY`: the Private Key line. Type: **Sensitive**.
3. Redeploy production. The Account page now shows **Notifications**, and the feed offers them once.

Never change these keys after launch: every phone that signed up would silently stop getting notices.

## 2. Company developer accounts (start now; approval takes days)

1. **D-U-N-S number** (free): request one for Myers Digital Services at dnb.com, under "D-U-N-S Number" →
   "Get a D-U-N-S Number". The legal name and address must match your state business filing exactly. It takes 5–14 days.
   Apple has a faster D-U-N-S lookup and request form inside its enrollment flow; use that instead.
2. **Google Play Console** (one-time $25): play.google.com/console → choose **Organization**. You'll need the
   D-U-N-S number, a business website (nabora.us), and a business phone and email. Organization accounts skip the
   "12 testers for 14 days" rule that new personal accounts must pass.
3. **Apple Developer Program** ($99/year): developer.apple.com/programs/enroll → **Organization**. Apple calls to
   verify that you can legally sign for the company.

## 3. Build the Android app (no Mac or Android Studio needed)

Use **PWABuilder** (free, run by Microsoft). It builds a signed Play package from nabora.us in about a minute:

1. Go to pwabuilder.com, enter `https://nabora.us`, and choose **Package for stores → Android → Google Play**.
2. Open **Options** and use the values in `android/twa-manifest.json`:
   - Package ID: `us.nabora.app` (this can never change once published)
   - App name: `Nabora`; Launcher name: `Nabora`
   - Version: `1.0.0`; Version code: `1`
   - Host: `nabora.us`; Start URL: `/#feed`
   - Theme color `#194633`; Background `#f6f5ee`; Navigation color `#194633`
   - Display: standalone; Orientation: portrait
   - Notification delegation: **on** (Android shows Nabora's notices as native app notifications)
   - Fallback: Custom Tabs
   - Signing key: **Create new**. Use "Myers Digital Services" as the organization and Cleveland, OH, US as the location.
3. Download the zip. It contains:
   - `Nabora.aab`: the file you upload to Play.
   - `signing.keystore` and `signing-key-info.txt`: **your upload key and its passwords.** Store both in a
     password manager and a second backup. Never commit them or email them.
   - `assetlinks.json`: has the SHA-256 fingerprint of your upload key.

## 4. Link the app to nabora.us (removes the browser bar)

Android only opens the app full screen if nabora.us/.well-known/assetlinks.json lists the app's signing keys.
Nabora serves that file from an environment variable, so no code change is needed:

1. In Play Console → your app → **Test and release → App integrity → App signing**, copy the
   **SHA-256 certificate fingerprint** from both the "App signing key" and the "Upload key" sections.
2. In Vercel, set `ANDROID_CERT_SHA256` (Plain, Production) to both fingerprints, comma-separated,
   for example `AB:CD:...:EF,12:34:...:56`. Redeploy.
3. Check that https://nabora.us/.well-known/assetlinks.json shows both, then reopen the installed app. The address bar
   should be gone. If it still shows, clear Chrome's data on the phone or wait an hour; Android caches the check.

The Play signing key is the one that matters for real installs. Without it, people who download from the store
see a browser bar at the top of the app.

## 5. Play Store listing

Play Console → **Create app** → name "Nabora", App, Free. Then fill in the "Set up your app" checklist:

- **Category:** Social. **Tags:** Community, Local, Events.
- **Short description (80 characters max):**
  `Your Cleveland neighborhood: local feed, events, safety alerts and farmers markets.`
- **Full description:**
  > Nabora brings Cleveland and Northeast Ohio neighbors together. No ads in your feed, no strangers from across the
  > state, no outrage algorithm.
  >
  > • Your neighborhood feed: discussions, recommendations, lost and found, polls and things for sale
  > • Safety alerts from neighbors on your block, sent to your phone
  > • Every library program and ward community meeting near you, updated weekly
  > • Farmers markets, farm stands, CSAs and community gardens, including where SNAP/EBT is accepted
  > • A neighborhood guide to parks, rec centers, libraries and local services
  > • Local businesses vetted by people, not paid placement
  > • Verified residents: neighbors vouch for each other or check in at community events
  >
  > Built in Cleveland for all 34 city neighborhoods and the suburbs around them.
- **Privacy policy URL:** `https://nabora.us/#privacy`
- **App access:** reviewers need a login. Create a reviewer account in a real neighborhood (an Admin invite),
  and give the email and password in "Instructions".
- **Ads:** No. **Content rating:** fill in the questionnaire. It's a social app where users talk to each other and share
  photos. Expect Teen.
- **Target audience:** 18 and over. Choosing ages under 13 brings in the Families policy; don't.
- **Data safety:** collected data is email address, name, approximate location (neighborhood), photos,
  user-generated posts and messages, and in-app actions. All of it is sent over HTTPS, users can delete their account in
  the app (Account → Delete my account), and nothing is sold or shared for advertising. Payments for business vetting go
  through Stripe.
- **Graphics:** a 512×512 icon (`public/icon-512.png`); a 1024×500 feature graphic; 2–8 phone screenshots
  at 1080×1920 or larger (the feed, events, a safety alert, local food, the guide, the map).
- **Release:** start with **Internal testing** (you plus up to 100 testers by email, live in minutes). Then
  Production, which Google reviews in about 1–7 days for a new account.

## 6. Updating the app later

Website changes need nothing; the app always loads the live site. Only rebuild in PWABuilder, with the **same
signing key** and a higher version code, when the name, icon, colors or package settings change.

## 7. iOS (after Apple approves the company account)

Apple rejects plain website wrappers (guideline 4.2), so the iOS app uses Capacitor with native features: Apple
push notifications, native share and camera, and Sign in with Apple only if a Google or Facebook login is ever added.
Builds run on Codemagic's cloud Macs, so no Mac is needed. This comes in a later change.
