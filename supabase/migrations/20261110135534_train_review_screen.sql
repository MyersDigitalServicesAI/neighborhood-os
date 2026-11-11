begin;
-- Bernoulli naive Bayes coefficients fitted on 38 synthetic patterns.
-- Reproduce using node tooling/train-review-screen.js. The score orders the queue only.
create or replace function neighborhood.screen(p_text text,p_affiliated boolean,p_duplicate boolean)
returns jsonb language sql immutable set search_path = '' as $$
  with features as (
    select p_affiliated as affiliation, p_duplicate as duplicate,
      p_text ~* '(paid (me|us)|discount.{0,30}review|in exchange|gift card|refund.{0,25}review)' as incentive,
      p_text ~* '(https?://|www\.|use (my|our) code|dm me|click here)' as promotion,
      p_text ~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[0-9]{3}[- .][0-9]{3}[- .][0-9]{4}|[0-9]{10})' as personal,
      p_text ~* '(kill (you|them|him|her)|hurt (you|them)|go die|home address)' as abuse,
      p_text ~ '(.)\1{6,}' as repetition
  )
  select jsonb_build_object('score',round((1/(1+exp(-(
    -1.421860 + 1.192138*affiliation::int + 1.945910*duplicate::int + 1.945910*incentive::int
      + 1.098612*promotion::int + 1.945910*personal::int + 1.498212*abuse::int + 0.980829*repetition::int
  ))))::numeric,3),'signals',to_jsonb(features)) from features
$$;
alter table neighborhood.reviews alter column model_version set default 'local-bernoulli-v2';
commit;
