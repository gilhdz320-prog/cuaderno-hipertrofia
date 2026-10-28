-- Cuaderno · esquema mínimo para sincronizar perfiles
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- Cada fila es un perfil completo (programa, cargas, registros) en JSONB.

create table if not exists public.profiles (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Atleta',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles (user_id);
create index if not exists profiles_updated_idx on public.profiles (updated_at desc);

-- Nadie ve los datos de otro: acceso solo a las filas propias.
alter table public.profiles enable row level security;

drop policy if exists "own rows" on public.profiles;
create policy "own rows" on public.profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Mantener updated_at al día en cada escritura (por si el cliente no lo manda).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
