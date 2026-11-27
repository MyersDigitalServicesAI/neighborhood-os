begin;

-- Photos move out of the database into a private Supabase Storage bucket, "photos".
-- Phase one (this file):
--   * neighborhood.images keeps one row per photo: owner, type, and who may see it are still decided here. The bytes
--     go to the bucket at `path` (owner/id.ext). `data` becomes optional; a row has bytes in the table, in the bucket,
--     or (while moving) both. `stored_at` is set once the bucket has the file, and from then on the bucket copy wins.
--   * reserve_image: the server asks for a row (same checks as upload_image: confirmed member, 20 an hour, 400 in all),
--     uploads the bytes with the secret key, then confirms with neighborhood_photos {op:'stored'}. A row that is never
--     confirmed can't be attached to a post or business and is swept after a day.
--   * image: same access rule as before. A photo in the bucket returns its path instead of its bytes, and the server
--     answers with a short-lived signed link.
--   * Deleting a row (for example when an account is deleted) queues its file in photo_trash. The daily job deletes
--     queued files from the bucket.
--   * upload_image (bytes in the table) keeps working, so the app runs before and after the code that uses the bucket
--     is turned on. tooling/move-photos.mjs copies existing photos into the bucket.
-- Phase two (a later file, once every row has stored_at): drop `data` and upload_image.

alter table neighborhood.images alter column data drop not null;
alter table neighborhood.images
  add column path text unique check (path is null or path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  add column stored_at timestamptz,
  add constraint images_has_bytes check (data is not null or path is not null),
  add constraint images_stored_has_path check (stored_at is null or path is not null);
create index images_unstored on neighborhood.images(created_at) where stored_at is null and data is null;

create table neighborhood.photo_trash (
  path text primary key,
  created_at timestamptz not null default now()
);
alter table neighborhood.photo_trash enable row level security;

create function neighborhood.trash_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.path is not null then
    insert into neighborhood.photo_trash(path) values(old.path) on conflict do nothing;
  end if;
  return old;
end
$$;
create trigger images_trash after delete on neighborhood.images for each row execute function neighborhood.trash_photo();

-- The bucket. Supabase has a storage schema; the local test database does not, so this only runs where it exists.
-- Private, with no policies: only the server's secret key can read or write it.
do $$
begin
  if exists(select 1 from pg_namespace where nspname = 'storage')
      and exists(select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('photos','photos',false,300000,array['image/jpeg','image/png','image/webp'])
      on conflict (id) do update set public = false,file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;

create function neighborhood.dispatch20(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  me neighborhood.members%rowtype;
  img neighborhood.images%rowtype;
  item uuid;
  ext text;
  result jsonb;
begin
  -- A photo still being uploaded can't be attached to anything yet.
  if jsonb_typeof(d) = 'object' and nullif(d->>'image','') is not null and exists(select 1 from neighborhood.images i
      where i.id::text = d->>'image' and i.data is null and i.stored_at is null) then
    raise exception 'That photo is still uploading. Try again.' using errcode = 'P0001';
  end if;
  if op not in ('reserve_image','image') then
    return neighborhood.dispatch19(op,d);
  end if;

  if op = 'image' then
    -- The older dispatcher applies the access rule and returns null when the photo isn't visible to this member.
    result := neighborhood.dispatch19(op,d);
    if result is null then return null; end if;
    select * into img from neighborhood.images i where i.id = nullif(d->>'id','')::uuid;
    if img.stored_at is not null then
      return jsonb_build_object('mime',img.mime,'path',img.path);
    end if;
    return result;
  end if;

  -- reserve_image
  if actor is null or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null) then
    raise exception 'Sign in with a confirmed email first.' using errcode = '42501';
  end if;
  select * into me from neighborhood.members m where m.id = actor;
  if me.id is null then raise exception 'Choose your neighborhood first.' using errcode = '42501'; end if;
  ext := case d->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if ext is null then raise exception 'Choose a JPEG, PNG or WebP photo.' using errcode = 'P0001'; end if;
  perform neighborhood.limit_action(actor,'upload_image',20);
  if (select count(*) from neighborhood.images i where i.owner_id = actor) >= 400 then
    raise exception 'Photo limit reached.' using errcode = 'P0001';
  end if;
  item := gen_random_uuid();
  insert into neighborhood.images(id,owner_id,mime,path) values(item,actor,d->>'mime',actor::text || '/' || item::text || '.' || ext);
  return jsonb_build_object('id',item,'path',actor::text || '/' || item::text || '.' || ext);
end
$$;

-- Server-only photo housekeeping, called with the secret key.
--   stored  {id}        the bucket has the file for a reserved row
--   legacy  {limit}     photos whose bytes are only in the table, for tooling/move-photos.mjs
--   moved   {id,path}   a legacy photo was copied to the bucket at path
--   trash   {limit}     files to delete from the bucket; also sweeps reservations never confirmed within a day
--   emptied {paths}     those files are gone from the bucket
--   status  {}          counts, to check the move
create function neighborhood.photos(d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  img neighborhood.images%rowtype;
  ext text;
  n integer;
begin
  if d is null or jsonb_typeof(d) <> 'object' then raise exception 'Invalid request.' using errcode = '22023'; end if;
  case d->>'op'
  when 'stored' then
    update neighborhood.images i set stored_at = now()
      where i.id = nullif(d->>'id','')::uuid and i.path is not null and i.stored_at is null returning * into img;
    if img.id is null then raise exception 'Photo unavailable.' using errcode = 'P0001'; end if;
    return jsonb_build_object('id',img.id,'ok',true);
  when 'legacy' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'owner',i.owner_id,'mime',i.mime,'path',i.path,
        'data',translate(encode(i.data,'base64'),E'\n','')) order by i.created_at,i.id),'[]'::jsonb)
      from (select * from neighborhood.images i where i.stored_at is null and i.data is not null
        order by i.created_at,i.id limit least(greatest(coalesce((d->>'limit')::integer,10),1),50)) i);
  when 'moved' then
    select * into img from neighborhood.images i where i.id = nullif(d->>'id','')::uuid and i.data is not null;
    if img.id is null then raise exception 'Photo unavailable.' using errcode = 'P0001'; end if;
    ext := case img.mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
    if d->>'path' is distinct from img.owner_id::text || '/' || img.id::text || '.' || ext then
      raise exception 'Path does not match the photo.' using errcode = 'P0001';
    end if;
    update neighborhood.images i set path = d->>'path',stored_at = coalesce(i.stored_at,now()) where i.id = img.id;
    return jsonb_build_object('id',img.id,'ok',true);
  when 'trash' then
    delete from neighborhood.images i where i.stored_at is null and i.data is null and i.created_at < now() - interval '1 day'
      and not exists(select 1 from neighborhood.posts x where x.image_id = i.id)
      and not exists(select 1 from neighborhood.businesses z where z.image_id = i.id);
    return (select coalesce(jsonb_agg(t.path order by t.created_at),'[]'::jsonb)
      from (select * from neighborhood.photo_trash t order by t.created_at
        limit least(greatest(coalesce((d->>'limit')::integer,100),1),1000)) t);
  when 'emptied' then
    if jsonb_typeof(d->'paths') <> 'array' then raise exception 'Invalid request.' using errcode = '22023'; end if;
    delete from neighborhood.photo_trash t where t.path in (select jsonb_array_elements_text(d->'paths'));
    get diagnostics n = row_count;
    return jsonb_build_object('emptied',n);
  when 'status' then
    return (select jsonb_build_object('total',count(*),'in_bucket',count(*) filter (where i.stored_at is not null),
      'table_only',count(*) filter (where i.stored_at is null and i.data is not null),
      'uploading',count(*) filter (where i.stored_at is null and i.data is null),
      'trash',(select count(*) from neighborhood.photo_trash)) from neighborhood.images i);
  else
    raise exception 'Invalid request.' using errcode = '22023';
  end case;
end
$$;
create function public.neighborhood_photos(d jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select neighborhood.photos(d) $$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch20(text,jsonb),neighborhood.dispatch19(text,jsonb),neighborhood.photos(jsonb),
  neighborhood.trash_photo(),public.neighborhood_photos(jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch20(text,jsonb) to authenticated;
grant execute on function neighborhood.photos(jsonb),public.neighborhood_photos(jsonb) to service_role;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch20(op,d) end
$$;
commit;
