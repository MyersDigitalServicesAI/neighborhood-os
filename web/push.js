// Phone and desktop notifications for this device. The browser asks permission only after a tap on “Turn on”,
// never on page load, because a refused prompt can’t be asked again.
const laterKey = 'nh_push_later';

function keyBytes(base64) {
  const text = atob(base64.replaceAll('-','+').replaceAll('_','/') + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(text,(c)=>c.charCodeAt(0));
}
function iosBrowser() {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return apple && !matchMedia('(display-mode: standalone)').matches && !navigator.standalone;
}
export function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}
// 'off', 'on', 'blocked', 'install' (iPhone in Safari: add to the home screen first) or 'unsupported'.
export async function state() {
  if (!supported()) return iosBrowser() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}
export async function enable(publicKey,save) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = (await registration()) ?? await navigator.serviceWorker.register('/sw.js',{ scope:'/' });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key can’t be reused.
  const current = sub?.options?.applicationServerKey;
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))).replace(/=+$/,'') !==
      btoa(String.fromCharCode(...keyBytes(publicKey))).replace(/=+$/,'')) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:keyBytes(publicKey) });
  const { endpoint, keys } = sub.toJSON();
  try { await save({ endpoint, p256dh:keys.p256dh, auth:keys.auth }); }
  catch (error) { await sub.unsubscribe().catch(()=>{}); throw error; }
  return 'on';
}
export async function disable(remove) {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await remove({ endpoint:sub.endpoint }).catch(()=>{});
    await sub.unsubscribe();
  }
  return 'off';
}
export function snoozed() {
  try { return Date.now() - Number(localStorage.getItem(laterKey) ?? 0) < 21*86400000; } catch { return false; }
}
export function snooze() {
  try { localStorage.setItem(laterKey,String(Date.now())); } catch { /* Private browsing: the reminder simply shows again. */ }
}
