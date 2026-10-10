-- Execute uma vez no SQL Editor do SEU projeto. Não inclui senhas nem dados.
-- O backend usa a chave secret/service_role; o navegador nunca acessa a tabela.
create table if not exists public.jarvis_private (
  id text primary key check (id in ('owner', 'sessions')),
  value jsonb not null,
  version bigint not null check (version > 0)
);
alter table public.jarvis_private enable row level security;
revoke all on public.jarvis_private from anon, authenticated;
grant select, insert, update, delete on public.jarvis_private to service_role;
-- Sem políticas de acesso público: chaves publishable/anon não podem ler dados.
