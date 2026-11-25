# Nabora trust & verification framework

Internal companion to the public page at **nabora.us/trust**. Last updated November 25, 2026.

> This is a product and compliance framework, not legal advice. Have an Ohio attorney who handles FTC advertising
> matters review it before the paid badge or reviews scale up.

## 1. Principles

1. **Verify people without keeping a file on them.** Prove someone lives nearby, then delete the evidence.
2. **Every review is a human decision under fixed, content-neutral rules.** Software flags reviews, and people decide.
3. **Money buys a check, never trust.** Paid vetting is labeled as paid everywhere it appears, and never touches reviews or ranking.
4. **Disclose connections automatically where we can, and require disclosure everywhere else.**
5. **Everything is logged and appealable.** Every decision records who made it, why, and under which rule. Removals get a second pair of eyes on appeal.

## 2. Regulatory map

| Rule | What it requires | How Nabora complies | Where in code |
|---|---|---|---|
| **16 CFR 465.2**: fake or false reviews | Don't create, buy, procure or spread reviews that misrepresent who wrote them or their experience | Firsthand attestation; duplicate-text matching; human publication | `submit_review` (core), `screen()`, `dispatch15` |
| **465.4**: buying positive or negative reviews | No compensation conditioned on sentiment | Reviewer attests "nobody paid or offered me anything"; incentive phrases flagged; "Paid or rewarded" is a removal rule; business pledge | `dispatch15` (`no_incentive`), `screen()` |
| **465.5**: insider reviews | Officers and managers can't solicit reviews from staff or relatives without clear disclosure | Relationship disclosure (employee, family, friend, discount, competitor) shown on the review; pledge bans undisclosed insider solicitation; owners can't review their own business | `reviews.relationship`, `reviewCard` |
| **465.6**: company-controlled review sites | Don't claim independence for a site you control that reviews your own category | Nabora doesn't sell services it reviews; the founder's own business, if listed, is labeled like any other (see gap G2) | n/a |
| **465.7**: review suppression | No threats or intimidation; don't misrepresent displayed reviews as all reviews when some are suppressed for rating or sentiment | Removal requires a named, content-neutral rule; "negative" is impossible; page shows every star count and the number removed; pledge bans threats | `dispatch15` (`removal_category`), `ratingBreakdown` |
| **465.8**: misuse of fake social-media indicators | Don't buy fake followers or views | Nabora shows no vanity metrics for sale; counts come from real accounts only | n/a |
| **16 CFR 255** (Endorsement Guides, 2023): material connections | Clearly and conspicuously disclose connections a significant minority wouldn't expect | Relationship labels on reviews and replies ("affiliated"); "paid check" shown beside every Vetted badge | `ui.verified()`, reply `affiliated` |
| **FTC Act §5**: certifications and seals | A badge must not imply an independent evaluation that didn't happen; paid seals must say so | Badge criteria published; "paid check" note; no workmanship guarantee claimed; badge expires and can be revoked | `/trust#vetting`, `badge()` |
| **Consumer Review Fairness Act** (15 U.S.C. §45b) | Form contracts can't bar or penalize honest reviews | Pledge: business contracts won't forbid honest reviews; Nabora's own terms never restrict honest reviews | `/trust#businesses` |

## 3. Identity verification tiers

| Tier | How | What we keep | Shown as |
|---|---|---|---|
| 0. Account | Email confirmation (PKCE) | Email | (nothing) |
| 1. Member | Chose a neighborhood and attested residency | Name and neighborhood | Neighborhood on profile |
| 2. Verified neighbor | **Postcard** code, **two vouches** from verified neighbors in the same or a bordering area, or **event check-in** | Only the fact, the date and the method; addresses are deleted when the card is mailed | "Verified neighbor" |
| 3. Vetted business | Staff check of legal identity, control of the public contact, and applicable license or insurance; optional $250 fee, sometimes waived | Evidence notes in the vetting record | "Vetted Business · paid check" |
| Staff | Admin or moderator role assigned by the founder | Audit log of every decision | n/a |

**Vouch safeguards:** 5 vouches per voucher per 30 days; vouchers must be verified and nearby; a vouch can't be withdrawn once it verifies someone; vouches are audited.

## 4. Review integrity pipeline

1. **Submit:** firsthand attestation, no-incentive attestation, relationship (optional; a competitor connection is detected automatically).
2. **Screen (software, never final):**
   - Signals: `affiliation`, `duplicate`, `incentive`, `promotion`, `personal`, `abuse`, `repetition`, `new_account` (<7 days), `unverified`, `burst` (3+ reviews for one business in 24h), `competitor`.
   - Combined on the log-odds scale into a priority score.
3. **Human decision:** publish, or remove under one of 11 rules: not firsthand, undisclosed connection, incentivized, personal info, harassment, hate, sexual or violent, spam, off-topic, illegal, duplicate.
   - A reason is shown to the author.
   - The moderator can't be the author or the business owner.
4. **Appeal:** decided by a *different* moderator.
5. **Display:** newest first; all star counts; number removed; connection labels; "Verified neighbor" on verified authors.

**Moderator guidance:** judge the words, never the rating. A rude but honest 1-star review stays up unless it hits a listed rule. Remove only the part of a review that breaks a rule when the product allows editing. Until it does, remove the review and tell the author they can resubmit without the problem part.

## 5. Anti-fraud controls

| Threat | Control | Status |
|---|---|---|
| Sock-puppet accounts | Email confirmation, rate limits (`limit_action`), local verification tiers | Live |
| Review rings or brigading | Duplicate-text fingerprinting, burst flag, new-account and unverified flags, human review | Live (burst and account flags new in this release) |
| Competitor sabotage | Automatic competitor label and flag | New |
| Paid or bought reviews | Attestation, incentive-phrase detection, pledge, removal rule | New (attestation, pledge) |
| Vouch collusion | Caps, locality, irreversibility, audit | Live |
| Marketplace and message scams | Scam-phrase warning in conversations; blocking; reporting | New (warning) |
| Badge misuse | Expiry, revocation on contact or category change, published criteria, "paid check" note | Live + new note |
| Insider moderation | Can't moderate own reviews or businesses; independent appeals; audit log | Live |

## 6. Business integrity pledge (required to list or apply for vetting)

The same text appears at `/trust#businesses` and on the forms. It is stored as `businesses.pledged_at`.

## 7. Audit findings (November 25, 2026)

**Already strong:**
- Firsthand attestation, affiliation flag, screening model and human-only publication.
- Written reasons, independent appeals and audit logging.
- Owners can't review or moderate themselves.
- Alphabetical directory, so payment doesn't buy ranking.
- Vouch caps.
- Address deletion after verification.

**Gaps fixed in this release:**
- G1: Removals didn't record a rule, so we couldn't show they were rating-neutral (465.7). Now a removal requires a named rule, and "negative" is rejected.
- G3: Reviews had no explicit no-incentive attestation (465.4). Added.
- G4: A connection was a yes/no checkbox with no type, and competitors weren't detected (465.5, Part 255). Added relationship types and automatic competitor detection.
- G5: The paid badge didn't disclose payment where it appears (§5 seals). Added the "paid check" note.
- G6: Business pages didn't show the rating distribution or removals. Added.
- G7: There was no business pledge. Added and required.
- G8: There was no scam warning in messages. Added.
- G9: There were no fraud signals for new or unverified accounts or review bursts. Added.

**Open gaps (decide or build next):**
- **G2: Self-vetting.** The platform owner can approve their own business. It's audited, but it's a "selfie seal" risk under FTC certification guidance. Recommendation: require a second person to approve the founder's own business, or don't badge it.
- **G10:** Existing businesses have no pledge on record (`pledged_at` is null). Prompt owners to accept it on their next visit, and hide the badge until they do.
- **G11:** There's no partial redaction of reviews. The product removes a whole review rather than only the part that breaks a rule.
- **G12:** The transparency report isn't automated. Publish quarterly counts of reviews submitted, published and removed by rule, appeals, and badge revocations.
- **G13:** There's no reporting path aimed at businesses. Users can report a review or post, but there's no "report this business for review manipulation" button.
- **G14:** Phone or device signals (e.g. disposable-email and VoIP detection) are deliberately not collected, for privacy. Revisit only if fraud appears.
- **G15:** Terms of Service and the privacy notice should restate the pledge, the CRFA protections and the review rules.

## 8. How this goes beyond typical neighborhood apps

Public descriptions of Nextdoor indicate:
- Address verification by postcard, phone or billing address.
- Recommendations shown mainly as "faves".
- Businesses can buy advertising.

Verify current Nextdoor practices before making any public comparison. Nabora's differences:

- **Written reviews checked by a person**, with published, content-neutral removal rules, a removal count on every business, and independent appeals.
- **Typed disclosure of connections**, including automatic competitor labels.
- **A paid badge that says it's paid**, has published criteria, expires, and never affects ranking. There are no ads in the feed.
- **Verification without retained personal documents** (addresses deleted after mailing), plus community vouching and event check-ins.
- **A public trust page** that explains all of the above in plain language.

## 9. Operating cadence

- **Weekly:** clear the moderation queue (aim for under 48 hours); review signal-heavy items first.
- **Monthly:** sample 10 published and 10 removed reviews for consistency; check vouch patterns.
- **Quarterly:** publish the transparency report (G12); re-read FTC guidance for updates; review badge revocations.
- **On any FTC or state rule change:** update `/trust`, this document and the moderation rules together.

## Sources

- FTC, *Trade Regulation Rule on the Use of Consumer Reviews and Testimonials*, 16 CFR Part 465 (final rule Aug. 2024, effective Oct. 21, 2024): https://www.federalregister.gov/documents/2024/08/22/2024-18519/trade-regulation-rule-on-the-use-of-consumer-reviews-and-testimonials
- FTC, *Consumer Reviews and Testimonials Rule: Questions and Answers*: https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers
- FTC, *Guides Concerning the Use of Endorsements and Testimonials in Advertising*, 16 CFR Part 255 (revised July 2023): https://www.federalregister.gov/documents/2023/07/26/2023-14795/guides-concerning-the-use-of-endorsements-and-testimonials-in-advertising
- FTC, *Endorsement Guides: What People Are Asking*: https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking
- FTC Green Guides on certifications and seals, 16 CFR 260.6 (principles applied by analogy to badges): https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-260/section-260.6
- Consumer Review Fairness Act of 2016, 15 U.S.C. §45b
