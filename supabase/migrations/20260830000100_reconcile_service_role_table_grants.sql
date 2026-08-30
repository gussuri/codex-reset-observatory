-- Keep fresh local databases aligned with the existing Production service_role ACL.
grant all privileges on table public.regular_reset_events,
  public.reset_display_names
to service_role;
