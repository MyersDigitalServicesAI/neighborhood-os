// Fails when a database update in supabase/migrations hasn't been marked as applied to production in
// supabase/applied-in-production.txt. Run by CI on every pull request, so code that needs a newer
// database can't be merged before the database has it.
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../supabase/',import.meta.url);
const files = (await readdir(new URL('migrations/',root))).filter((f) => f.endsWith('.sql')).sort();
const listed = (await readFile(new URL('applied-in-production.txt',root),'utf8'))
  .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
const missing = files.filter((f) => !listed.includes(f));
const unknown = listed.filter((f) => !files.includes(f));

if (unknown.length) console.log('Listed as applied but not in supabase/migrations (check for typos):\n  '+unknown.join('\n  '));
if (missing.length) {
  console.log('Not yet applied to the production database:\n  '+missing.join('\n  '));
  console.log('\nApply them to production first, check them, then add each file name to supabase/applied-in-production.txt.');
  process.exit(1);
}
if (unknown.length) process.exit(1);
console.log('All '+files.length+' database updates are applied in production.');
