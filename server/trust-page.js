// The public Trust page at /trust: how Nabora verifies neighbors and businesses, how reviews work and are moderated, how
// the paid vetting badge works, and how we fight fraud. Plain language for neighbors, mapped to the FTC rules in
// docs/trust-framework.md. Server-rendered like /events, /food and /trees.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const trustUpdated = 'November 25, 2026';

const section = (id,eyebrow,title,body) => '<section id="'+id+'"><p class="eyebrow">'+esc(eyebrow)+'</p><h2>'+esc(title)+'</h2>'+body+'</section>';
const list = (items) => '<ul class="tips">'+items.map((i)=>'<li>'+i+'</li>').join('')+'</ul>';

export function trustPage(origin) {
  const title = 'Trust & verification on Nabora';
  const description = 'How Nabora verifies neighbors and businesses, keeps reviews honest, discloses the paid vetting badge, and fights fraud and scams.';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>'+esc(title)+' · Nabora</title><meta name="description" content="'+esc(description)+'">'+
    '<link rel="canonical" href="'+esc(origin)+'/trust"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon-32.png" type="image/png">'+
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/events.css">'+
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Nabora"><meta property="og:title" content="'+esc(title)+'">'+
    '<meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(origin)+'/trust"><meta property="og:image" content="'+esc(origin)+'/og.jpg"></head><body>'+
    '<header class="top"><a class="brand" href="/"><img src="/logo-mark.png" alt="" width="34" height="31">Nabora</a><nav><a href="/events">Events</a><a href="/#login">Sign in</a><a class="join" href="/#signup">Join free</a></nav></header>'+
    '<main class="trust"><p class="eyebrow">TRUST &amp; VERIFICATION</p><h1>'+esc(title)+'</h1>'+
    '<p class="lede">A neighborhood app only works if you can believe what you read on it. Here is exactly how we check people, businesses and reviews, what we will never do, and what each badge does and does not mean.</p>'+
    '<nav class="spans" aria-label="On this page"><a href="#neighbors">Verified neighbors</a><a href="#reviews">Reviews</a><a href="#vetting">Vetted badge</a><a href="#businesses">Business pledge</a><a href="#fraud">Fraud</a><a href="#safety">Staying safe</a></nav>'+

    section('neighbors','PEOPLE','Verified neighbors',
      '<p class="note">Everyone starts with a confirmed email. A <strong>Verified neighbor</strong> badge means one of these happened:</p>'+
      list(['<strong>Postcard:</strong> we mail a one-time code to your address. We delete the address as soon as the card is mailed, and the code when you enter it. We keep only that you verified, and when.',
        '<strong>Two vouches:</strong> two already-verified neighbors from your neighborhood, or one next to it, confirm they know you live there. Each person can vouch for at most 5 neighbors every 30 days, and a vouch can’t be withdrawn after it verifies someone, so vouching is taken seriously.',
        '<strong>Check-in:</strong> you scanned a code at a Nabora community event, run by a host we trust.'])+
      '<p class="note">We don’t ask for your ID, Social Security number or a selfie, and we never keep a file on where you live. The badge means a real neighbor, not that we vouch for everything they say.</p>')+

    section('reviews','RECOMMENDATIONS','How reviews work',
      list(['<strong>Firsthand only.</strong> Every reviewer confirms they are describing their own experience.',
        '<strong>No paid or rewarded reviews.</strong> Every reviewer confirms nobody paid them or offered them anything for the review or for what it says.',
        '<strong>Connections are labeled.</strong> If you work there, are family or a friend of the owner or staff, or got a discount or something free, you say so and the review shows it. If you own a competing business in the same neighborhood, we add the label automatically.',
        '<strong>A person checks every review</strong> before it appears. Software flags things like brand-new accounts, copied text, private information and a sudden burst of reviews, so a moderator looks harder. Software never publishes or removes anything by itself.',
        '<strong>Owners can’t review or moderate their own business.</strong> Moderators can’t decide on reviews they wrote or for businesses they own.'])+
      '<h3>We never remove a review for being negative</h3>'+
      '<p class="note">A review is removed only if it breaks one of these rules, applied the same way to 1-star and 5-star reviews: not a firsthand experience, a hidden connection to the business, paid or rewarded, private information, harassment or threats, hate or discrimination, sexual or violent content, spam or advertising, not about this business, illegal content, or a duplicate. The moderator records which rule and why, and the author is told. Authors can appeal, and a <em>different</em> moderator decides the appeal.</p>'+
      '<p class="note">Each business page shows how many reviews have been removed and the count of every star rating, low ones included. We show reviews newest first, and a business can’t pay to change that order.</p>')+

    section('vetting','BUSINESSES','What the Vetted Business badge means',
      '<p class="note">Any business can list on Nabora for free. <strong>Vetting is optional and paid:</strong> a one-time $250 review by a Nabora staff member, which we sometimes waive. Next to every badge you’ll see “paid check” so this is never hidden.</p>'+
      list(['<strong>What we check:</strong> the business’s legal identity, that it controls its public contact (website or phone), and applicable licenses and insurance.',
        '<strong>What it doesn’t mean:</strong> it is not a guarantee of workmanship, and it is not an endorsement of prices or results. Neighbor reviews tell you how the work actually went.',
        '<strong>Paying buys the check, nothing else.</strong> It never changes reviews, ratings, or where a business appears. The business directory is alphabetical.',
        '<strong>It can be lost.</strong> Vetting is rechecked yearly, and ends if a business changes its contact details or category, or breaks the pledge below.',
        '<strong>Who checks:</strong> the founder and staff the founder chooses. Staff can’t vet a business they own. The one exception is the founder’s own business, and any such decision is flagged in our records.']))+

    section('businesses','BUSINESSES','The business integrity pledge',
      '<p class="note">Every business agrees to this before it lists or applies for vetting:</p>'+
      list(['We won’t pay, discount or reward anyone for a review, or only for a good one.',
        'We won’t ask employees, family or friends to review us unless they clearly disclose the connection.',
        'We won’t write reviews of ourselves or fake reviews of competitors, or buy them from anyone.',
        'We won’t threaten, sue without basis, or pressure anyone to change or remove an honest review, and our contracts won’t forbid honest reviews.',
        'We’ll answer criticism in public replies, not by going after the reviewer.'])+
      '<p class="note">Breaking it can mean removed reviews, a lost badge, or removal from Nabora. If you see this happening, report it with the flag on a review or post.</p>')+

    section('fraud','INTEGRITY','How we fight fraud',
      list(['<strong>Fake accounts:</strong> confirmed email for everyone, rate limits on posting, reviews, invites and vouches, and verification that requires real local ties.',
        '<strong>Review rings:</strong> copied text is matched across reviews; bursts of reviews for one business, reviews from brand-new or unverified accounts, and competitor reviews are flagged for a closer look.',
        '<strong>Vouch abuse:</strong> limited vouches per person, only from verified neighbors nearby, and they can’t be undone once used.',
        '<strong>Scams:</strong> messages that mention gift cards, wire transfers, overpayment or phone codes show a safety warning.',
        '<strong>Accountability:</strong> every moderation, vetting and verification decision is logged with who made it and why.']))+

    section('safety','YOU','Staying safe',
      list(['Never pay with gift cards, wire transfers or crypto, and never share a code texted to your phone.',
        'Meet in a public place for sales, and see the item before you pay.',
        'Be wary of anyone who wants to move the conversation off Nabora right away.',
        'Use the flag on any post, reply or review to report it. Block anyone from the conversation screen.']))+

    '<p class="sources">Our review rules follow the Federal Trade Commission’s Trade Regulation Rule on the Use of Consumer Reviews and Testimonials (16 CFR Part 465), its Guides Concerning the Use of Endorsements and Testimonials (16 CFR Part 255), and the Consumer Review Fairness Act. Updated '+esc(trustUpdated)+'. Questions or a concern about a review or business? Use the flag in the app.</p>'+
    '</main><footer><a href="/">Nabora</a> · <a href="/events">Events</a> · <a href="/food">Local food</a> · <a href="/#standards">Community standards</a> · <a href="/#privacy">Privacy</a></footer></body></html>';
}
