import { Problem } from './supabase.js';

// Photos live in a private Supabase Storage bucket that only the server's secret key can reach. The bucket is used
// once PHOTO_BUCKET is set (normally "photos"); until then photos keep going into the database as before.
const pathPattern = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function storageAdapter(env, request = fetch) {
  const origin = (env.SUPABASE_URL ?? '').replace(/\/$/,'');
  const secret = env.SUPABASE_SECRET_KEY;
  const bucket = env.PHOTO_BUCKET;
  const enabled = !!(origin && secret && bucket && /^[a-z0-9-]{3,63}$/.test(bucket));
  const headers = { apikey:secret, Authorization:'Bearer '+secret };
  async function call(path, init, timeout = 8000) {
    if (!enabled) throw new Problem(503,'Photo storage is not configured.');
    const response = await request(origin+'/storage/v1/'+path,{ ...init,headers:{ ...headers,...init.headers },signal:AbortSignal.timeout(timeout) });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Problem(502,'Photo storage is temporarily unavailable.');
      error.detail = response.status+' '+(data?.error ?? data?.message ?? '');
      throw error;
    }
    return data;
  }
  function checked(path) {
    if (!pathPattern.test(path ?? '')) throw new Problem(400,'Photo unavailable.');
    return path;
  }
  return {
    enabled,
    // Uploads bytes to path. The path holds the photo's id, so the file never changes and browsers may keep it.
    put: (path,bytes,mime,{ upsert = false } = {}) => call('object/'+bucket+'/'+checked(path),{
      method:'POST',body:bytes,
      headers:{ 'Content-Type':mime,'Cache-Control':'max-age=31536000','x-upsert':upsert ? 'true' : 'false' }
    },15000),
    // A link that works for `seconds` and then stops; it carries no account details.
    sign: async (path,seconds) => {
      const data = await call('object/sign/'+bucket+'/'+checked(path),{
        method:'POST',body:JSON.stringify({ expiresIn:seconds }),headers:{ 'Content-Type':'application/json' }
      });
      const signed = data?.signedURL ?? data?.signedUrl;
      if (typeof signed !== 'string' || !signed.startsWith('/')) throw new Problem(502,'Photo storage is temporarily unavailable.');
      return origin+'/storage/v1'+signed;
    },
    remove: (paths) => paths.length ? call('object/'+bucket,{
      method:'DELETE',body:JSON.stringify({ prefixes:paths.map(checked) }),headers:{ 'Content-Type':'application/json' }
    }) : Promise.resolve([])
  };
}

// The first bytes of each allowed type. A file that claims one type but holds another is refused.
export function photoBytes(mime, base64) {
  if (typeof base64 !== 'string' || base64.length < 80 || base64.length > 410000 || !/^[A-Za-z0-9+/\s]+={0,2}$/.test(base64)) {
    throw new Problem(400,'Photo is too large.');
  }
  let bytes;
  try { bytes = Uint8Array.from(atob(base64.replace(/\s/g,'')),(c) => c.charCodeAt(0)); }
  catch { throw new Problem(400,'That file is not a photo.'); }
  if (bytes.length < 64 || bytes.length > 300000) throw new Problem(400,'Photo is too large.');
  const starts = (...values) => values.every((value,index) => value === null || bytes[index] === value);
  const ok = mime === 'image/jpeg' ? starts(0xff,0xd8,0xff)
    : mime === 'image/png' ? starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)
    : mime === 'image/webp' ? starts(0x52,0x49,0x46,0x46,null,null,null,null,0x57,0x45,0x42,0x50)
    : false;
  if (!ok) throw new Problem(400,'That file is not a JPEG, PNG or WebP photo.');
  return bytes;
}

// The daily job: delete files whose photo rows are gone. Returns how many were removed.
export async function emptyPhotoTrash(database, storage, { rounds = 5 } = {}) {
  if (!storage.enabled) return {};
  let removed = 0;
  for (let round = 0; round < rounds; round++) {
    const paths = await database.photos({ op:'trash',limit:100 });
    if (!Array.isArray(paths) || !paths.length) break;
    await storage.remove(paths);
    removed += (await database.photos({ op:'emptied',paths }))?.emptied ?? 0;
    if (paths.length < 100) break;
  }
  return { photosRemoved:removed };
}
