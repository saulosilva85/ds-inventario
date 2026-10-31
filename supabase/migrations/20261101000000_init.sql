-- DS Inventário — migração inicial (fase 1)
-- Modelo multi-tenant: toda tabela de negócio tem organization_id e RLS ativa.
-- Escrita de dados de coleta (scan_runs, resources, resource_changes) é feita
-- APENAS pelos workers com a service role; usuários só leem.
-- STATUS: escrita sem execução em banco real. Validar com `supabase db reset`
-- e com os testes de isolamento antes de qualquer uso.

-- ---------------------------------------------------------------- tipos
create type public.org_role as enum ('owner', 'admin', 'viewer');
create type public.cloud_provider as enum ('aws', 'gcp');
create type public.connection_status as enum ('pending', 'active', 'error', 'paused');
create type public.scan_status as enum ('queued', 'running', 'succeeded', 'partial', 'failed');
create type public.change_kind as enum ('created', 'changed', 'removed');

-- -------------------------------------------------------------- tabelas
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 120),
  plan_code   text not null default 'inicial'
              check (plan_code in ('inicial', 'profissional', 'empresarial')),
  created_at  timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            public.org_role not null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.cloud_connections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider        public.cloud_provider not null,
  display_name    text not null check (length(btrim(display_name)) between 1 and 120),
  -- ID da conta AWS (12 dígitos) ou ID do projeto GCP
  account_ref     text not null,
  -- AWS: role assumida pelo worker. External ID único por conexão.
  role_arn        text,
  external_id     text,
  status          public.connection_status not null default 'pending',
  last_checked_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  unique (organization_id, provider, account_ref),
  unique (external_id),
  constraint aws_requires_role check (
    provider <> 'aws' or (role_arn is not null and external_id is not null)
  )
);
create index cloud_connections_org_idx on public.cloud_connections (organization_id);

create table public.scan_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connection_id   uuid not null references public.cloud_connections (id) on delete cascade,
  status          public.scan_status not null default 'queued',
  started_at      timestamptz,
  finished_at     timestamptz,
  created_count   integer not null default 0,
  changed_count   integer not null default 0,
  removed_count   integer not null default 0,
  error           text
);
create index scan_runs_connection_idx on public.scan_runs (connection_id, started_at desc);
create index scan_runs_org_idx on public.scan_runs (organization_id);

create table public.resources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connection_id   uuid not null references public.cloud_connections (id) on delete cascade,
  provider        public.cloud_provider not null,
  account_ref     text not null,
  region          text not null,
  category        text not null check (category in ('compute', 'storage', 'database', 'network')),
  type            text not null,
  native_id       text not null,
  name            text,
  state           text,
  tags            jsonb not null default '{}'::jsonb,
  config          jsonb not null default '{}'::jsonb,
  config_hash     text not null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  removed_at      timestamptz,
  unique (connection_id, region, type, native_id)
);
create index resources_org_filter_idx on public.resources (organization_id, provider, region, category);
create index resources_active_idx on public.resources (organization_id) where removed_at is null;

create table public.resource_changes (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  resource_id     uuid not null references public.resources (id) on delete cascade,
  scan_run_id     uuid references public.scan_runs (id) on delete set null,
  kind            public.change_kind not null,
  diff            jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);
create index resource_changes_org_idx on public.resource_changes (organization_id, occurred_at desc);
create index resource_changes_resource_idx on public.resource_changes (resource_id, occurred_at desc);

create table public.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null,
  target          text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (organization_id, created_at desc);

-- --------------------------------------------------- funções auxiliares
-- security definer evita recursão de RLS ao consultar memberships.
create function public.is_org_member(org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create function public.has_org_role(org uuid, roles public.org_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

-- Criação de organização: o usuário autenticado vira owner.
create function public.create_organization(org_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;
  insert into public.organizations (name) values (org_name) returning id into new_id;
  insert into public.memberships (organization_id, user_id, role)
  values (new_id, (select auth.uid()), 'owner');
  return new_id;
end;
$$;

revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;
revoke all on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
revoke all on function public.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- -------------------------------------------------------------------- RLS
alter table public.organizations      enable row level security;
alter table public.memberships        enable row level security;
alter table public.cloud_connections  enable row level security;
alter table public.scan_runs          enable row level security;
alter table public.resources          enable row level security;
alter table public.resource_changes   enable row level security;
alter table public.audit_log          enable row level security;

revoke all on all tables in schema public from anon;

-- Leitura: qualquer membro da organização.
create policy organizations_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy memberships_select on public.memberships
  for select to authenticated using (public.is_org_member(organization_id));
create policy scan_runs_select on public.scan_runs
  for select to authenticated using (public.is_org_member(organization_id));
create policy resources_select on public.resources
  for select to authenticated using (public.is_org_member(organization_id));
create policy resource_changes_select on public.resource_changes
  for select to authenticated using (public.is_org_member(organization_id));

-- Conexões: leitura para membros; escrita para owner/admin.
create policy cloud_connections_select on public.cloud_connections
  for select to authenticated using (public.is_org_member(organization_id));
create policy cloud_connections_insert on public.cloud_connections
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
create policy cloud_connections_update on public.cloud_connections
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
create policy cloud_connections_delete on public.cloud_connections
  for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Auditoria: somente owner/admin leem; escrita só pela service role.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Organizations/memberships/scan_runs/resources/resource_changes: sem políticas
-- de escrita para usuários => escrita negada. Workers usam a service role.
