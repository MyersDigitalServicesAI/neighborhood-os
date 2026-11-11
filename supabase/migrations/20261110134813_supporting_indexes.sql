begin;
create index members_area on neighborhood.members(area_id);
create index appeals_resolver on neighborhood.appeals(resolved_by);
create index audit_actor on neighborhood.audit(actor);
create index reviews_reviewer on neighborhood.reviews(decided_by);
create index vetting_reviewer on neighborhood.vetting(reviewed_by);
commit;
