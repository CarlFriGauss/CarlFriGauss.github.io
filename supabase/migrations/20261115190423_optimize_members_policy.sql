alter policy members_read on public.members
using (id = (select auth.uid()) or (select private.is_owner()));
