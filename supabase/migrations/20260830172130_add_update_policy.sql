create policy tenant_alert_access_update_member
on public.tenant_alert_access
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));
