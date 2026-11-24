-- Surgery Unit OS · 0010 link each uploaded photo/document to the staff member who uploaded it.
-- Rollback: alter table public.documents drop constraint documents_created_by_fkey;
alter table public.documents
  add constraint documents_created_by_fkey foreign key (created_by) references public.staff(user_id);
create index if not exists documents_created_by_idx on public.documents (created_by);
