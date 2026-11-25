begin;

-- Trust and verification framework (see docs/trust-framework.md and the public /trust page).
--
-- Reviews (FTC Consumer Reviews and Testimonials Rule, 16 CFR Part 465; Endorsement Guides, 16 CFR Part 255):
--   * Reviewers say what kind of connection they have to the business, and confirm nobody paid or offered them anything.
--     Owning a business in the same category and neighborhood is disclosed automatically as a competitor connection.
--   * Fraud signals the moderators see: brand-new account, unverified account, a burst of reviews for one business.
--   * A removal must name one content-neutral rule it broke. "Negative" is never a reason, so ratings can't decide what
--     neighbors see (16 CFR 465.7). The business page shows every star rating's count and how many reviews were removed.
-- Businesses: creating a profile or applying for vetting requires the integrity pledge (no paid, incentivized or insider
--   reviews without disclosure, no threats to get reviews removed). The paid vetting badge is disclosed as paid in the app.

alter table neighborhood.reviews add column relationship text
  check (relationship is null or relationship in ('employee','family','friend','competitor','discount','other'));
alter table neighborhood.reviews add column no_incentive boolean not null default false;
alter table neighborhood.reviews add column removal_category text
  check (removal_category is null or removal_category in ('not_firsthand','undisclosed_connection','incentivized','personal_info',
    'harassment','hate','sexual_or_violent','spam','off_topic','illegal','duplicate'));
alter table neighborhood.businesses add column pledged_at timestamptz;

create function neighborhood.dispatch15(op text,d jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  me neighborhood.members%rowtype;
  biz neighborhood.businesses%rowtype;
  result jsonb;
  item uuid := nullif(d->>'id','')::uuid;
  kind text;
  extra jsonb;
  rev neighborhood.reviews%rowtype;
begin
  if op not in ('submit_review','decide_review','business','create_business','apply_vetting') then
    return neighborhood.dispatch14(op,d);
  end if;
  select * into me from neighborhood.members m where m.id = actor;

  if op = 'submit_review' then
    if d->>'no_incentive' is distinct from 'true' then
      raise exception 'Confirm that nobody paid you or offered you anything for this review.';
    end if;
    kind := nullif(d->>'relationship','');
    if kind is not null and kind not in ('employee','family','friend','discount','other') then
      raise exception 'Choose how you’re connected to this business.';
    end if;
    select * into biz from neighborhood.businesses b where b.id = item;
    -- Owning a business in the same category and neighborhood is a connection readers should know about.
    if found and kind is null and exists(select 1 from neighborhood.businesses o where o.owner_id = actor and o.id <> biz.id
        and o.category = biz.category and o.area_id = biz.area_id) then
      kind := 'competitor';
    end if;
    if kind is null and (d->>'affiliated')::boolean is true then kind := 'other'; end if;
    -- Counted before this review is saved: three or more for one business in a day already is a burst.
    extra := jsonb_build_object(
      'new_account',me.created_at > now() - interval '7 days',
      'unverified',me.verified_at is null,
      'burst',(select count(*) from neighborhood.reviews r where r.business_id = item and r.created_at > now() - interval '24 hours') >= 3,
      'competitor',coalesce(kind = 'competitor',false));
    result := neighborhood.dispatch14(op,d || jsonb_build_object('affiliated',(kind is not null)::text));
    update neighborhood.reviews r set relationship = kind, no_incentive = true, signals = r.signals || extra,
      -- Added on the log-odds scale, so the screening model's ordering is kept and the score stays between 0 and 1.
      score = round((1/(1+exp(-(ln(greatest(least(r.score,0.999),0.001)/(1-greatest(least(r.score,0.999),0.001)))
        + 0.6*(extra->>'new_account')::boolean::int + 0.4*(extra->>'unverified')::boolean::int
        + 1.2*(extra->>'burst')::boolean::int + 1.0*(extra->>'competitor')::boolean::int))))::numeric,3)
      where r.id = (result->>'id')::uuid;
    return result;
  elsif op = 'decide_review' then
    -- A removal names the rule it broke. A low rating or criticism is never a rule.
    if d->>'action' = 'removed' and coalesce(d->>'category','') not in ('not_firsthand','undisclosed_connection','incentivized',
        'personal_info','harassment','hate','sexual_or_violent','spam','off_topic','illegal','duplicate') then
      raise exception 'Choose which review rule this breaks. Reviews are never removed for being negative.';
    end if;
    result := neighborhood.dispatch14(op,d);
    update neighborhood.reviews set removal_category = case when d->>'action' = 'removed' then d->>'category' end where id = item;
    update neighborhood.audit a set details = a.details || jsonb_build_object('category',d->>'category')
      where a.id = (select max(x.id) from neighborhood.audit x where x.action = 'decide_review' and x.subject = item);
    return result;
  elsif op in ('create_business','apply_vetting') then
    if d->>'pledge' is distinct from 'true' then
      raise exception 'Agree to the business integrity pledge to continue.';
    end if;
    result := neighborhood.dispatch14(op,d);
    update neighborhood.businesses set pledged_at = coalesce(pledged_at,now())
      where id = coalesce((result->>'id')::uuid,item) and owner_id = actor;
    return result;
  end if;

  -- business: add each review's disclosed connection, the full star breakdown and how many reviews were removed.
  result := neighborhood.dispatch14(op,d);
  if jsonb_typeof(result) <> 'object' or jsonb_typeof(result->'reviews') <> 'array' then return result; end if;
  return result || jsonb_build_object(
    'reviews',(select coalesce(jsonb_agg(e.value || jsonb_build_object('relationship',r.relationship) order by e.ordinality),'[]'::jsonb)
      from jsonb_array_elements(result->'reviews') with ordinality e left join neighborhood.reviews r on r.id = (e.value->>'id')::uuid),
    'breakdown',(select jsonb_object_agg(s.n,(select count(*) from neighborhood.reviews r where r.business_id = item and r.status = 'published' and r.rating = s.n))
      from generate_series(1,5) s(n)),
    'removed_count',(select count(*) from neighborhood.reviews r where r.business_id = item and r.status = 'removed'),
    'pledged',(select b.pledged_at is not null from neighborhood.businesses b where b.id = item));
end
$$;

revoke all on all tables in schema neighborhood from public, anon, authenticated, service_role;
revoke all on function neighborhood.dispatch15(text,jsonb),neighborhood.dispatch14(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function neighborhood.dispatch15(text,jsonb) to authenticated;
create or replace function public.neighborhood_app(op text,d jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when op = 'map' then neighborhood.map_summary() else neighborhood.dispatch15(op,d) end
$$;
commit;
