// The small page behind the digest's "Stop the weekly digest" link.
const esc = (value = '') => String(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function unsubscribePage(state,token) {
  const body = {
    ask:'<h1>Stop the weekly digest?</h1><p>You’ll still get emails about replies, messages and safety alerts. You can turn the digest back on any time under Account.</p>'+
      '<form method="post" action="/api/core?action=unsubscribe&amp;t='+esc(encodeURIComponent(token))+'"><button class="join" type="submit">Stop the weekly digest</button></form>',
    done:'<h1>Done. No more weekly digest.</h1><p>You’ll still get emails about replies, messages and safety alerts. Changed your mind? Turn it back on under <a href="/#account">Account</a>.</p>',
    invalid:'<h1>This link didn’t work</h1><p>It may be old or copied incompletely. Sign in and change your email settings under <a href="/#account">Account</a>.</p>'
  }[state];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<meta name="robots" content="noindex"><title>Weekly digest · Nabora</title><link rel="stylesheet" href="/events.css"></head>'+
    '<body><main class="offline"><img src="/icon-192.png" alt="" width="72" height="72">'+body+'</main></body></html>';
}
