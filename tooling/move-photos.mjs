// Copies photos whose bytes are still in the database into the photo bucket, then marks each one moved.
// Safe to run more than once: a photo is marked only after its file is in the bucket, and uploads overwrite.
//
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... PHOTO_BUCKET=photos node tooling/move-photos.mjs            (dry run)
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... PHOTO_BUCKET=photos node tooling/move-photos.mjs --run
//
// The bytes stay in the database until a later update drops them, so the move can be undone by clearing stored_at.
import { supabaseAdapter } from '../server/supabase.js';
import { photoBytes, storageAdapter } from '../server/storage.js';

export async function movePhotos({ database, storage, run = false, log = console.log, batch = 20 }) {
  if (!storage.enabled) throw new Error('Set SUPABASE_URL, SUPABASE_SECRET_KEY and PHOTO_BUCKET first.');
  const before = await database.photos({ op:'status' });
  log('Before: '+JSON.stringify(before));
  if (!run) {
    const sample = await database.photos({ op:'legacy',limit:batch });
    for (const photo of sample) log('Would move '+photo.id+' ('+photo.mime+') to '+target(photo));
    log(before.table_only+' photo(s) to move. Dry run: nothing was changed. Add --run to move them.');
    return { moved:0,failed:0,before };
  }
  let moved = 0;
  const failed = new Set();
  for (;;) {
    const photos = (await database.photos({ op:'legacy',limit:batch })).filter((photo) => !failed.has(photo.id));
    if (!photos.length) break;
    for (const photo of photos) {
      const path = target(photo);
      try {
        await storage.put(path,photoBytes(photo.mime,photo.data),photo.mime,{ upsert:true });
        await database.photos({ op:'moved',id:photo.id,path });
        moved++;
        log('Moved '+photo.id+' to '+path);
      } catch (error) {
        failed.add(photo.id);
        log('Could not move '+photo.id+': '+(error.detail ?? error.message));
      }
    }
  }
  const after = await database.photos({ op:'status' });
  log('After: '+JSON.stringify(after));
  return { moved,failed:failed.size,before,after };
}

function target(photo) {
  return photo.owner+'/'+photo.id+'.'+({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' })[photo.mime];
}

if (import.meta.url === 'file://'+process.argv[1]) {
  const env = process.env;
  const result = await movePhotos({ database:supabaseAdapter(env),storage:storageAdapter(env),run:process.argv.includes('--run') });
  process.exit(result.failed ? 1 : 0);
}
