-- Portal Escola — estrutura completa do banco de dados
-- Versão PT-BR
-- Execute este arquivo uma única vez em um projeto Supabase novo/vazio.

create extension if not exists pgcrypto;

-- ============================================================================
-- TABELAS PRINCIPAIS
-- ============================================================================

create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_completo text not null check (char_length(nome_completo) >= 3),
  email text not null unique,
  tipo_usuario text not null
    check (tipo_usuario in ('aluno', 'professor', 'funcionario')),
  situacao text not null default 'ativo'
    check (situacao in ('ativo', 'inativo')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);


create table if not exists public.cursos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  criado_em timestamptz not null default now()
);


create table if not exists public.turmas (
  id uuid primary key default gen_random_uuid(),

  curso_id uuid not null
    references public.cursos(id)
    on delete restrict,

  nome text not null,

  modulo smallint not null
    check (modulo between 1 and 3),

  turno text not null
    check (turno in ('manha', 'tarde', 'noite')),

  ano_letivo smallint not null
    check (ano_letivo between 2020 and 2100),

  sala text,

  criado_em timestamptz not null default now(),

  unique (
    curso_id,
    modulo,
    turno,
    ano_letivo
  )
);


create table if not exists public.alunos (
  id uuid primary key default gen_random_uuid(),

  perfil_id uuid not null unique
    references public.perfis(id)
    on delete cascade,

  matricula text not null unique,

  turma_id uuid
    references public.turmas(id)
    on delete set null,

  nome_responsavel text,

  data_nascimento date,

  criado_em timestamptz not null default now()
);


create table if not exists public.professores (
  id uuid primary key default gen_random_uuid(),

  perfil_id uuid not null unique
    references public.perfis(id)
    on delete cascade,

  matricula text not null unique,

  especialidade text,

  criado_em timestamptz not null default now()
);


create table if not exists public.funcionarios (
  id uuid primary key default gen_random_uuid(),

  perfil_id uuid not null unique
    references public.perfis(id)
    on delete cascade,

  matricula text not null unique,

  cargo text,

  departamento text,

  criado_em timestamptz not null default now()
);


create table if not exists public.disciplinas (
  id uuid primary key default gen_random_uuid(),

  curso_id uuid not null
    references public.cursos(id)
    on delete cascade,

  codigo text not null,

  nome text not null,

  carga_horaria smallint not null default 40
    check (carga_horaria > 0),

  criado_em timestamptz not null default now(),

  unique (
    curso_id,
    codigo
  )
);


create table if not exists public.atribuicoes_professores (
  id uuid primary key default gen_random_uuid(),

  -- O app trabalha com o ID de public.perfis.
  professor_id uuid not null
    references public.perfis(id)
    on delete cascade,

  turma_id uuid not null
    references public.turmas(id)
    on delete cascade,

  disciplina_id uuid not null
    references public.disciplinas(id)
    on delete cascade,

  criado_em timestamptz not null default now(),

  unique (
    professor_id,
    turma_id,
    disciplina_id
  )
);


create table if not exists public.notas (
  id uuid primary key default gen_random_uuid(),

  aluno_id uuid not null
    references public.alunos(id)
    on delete cascade,

  disciplina_id uuid not null
    references public.disciplinas(id)
    on delete cascade,

  professor_id uuid
    references public.perfis(id)
    on delete set null,

  bimestre smallint not null
    check (bimestre between 1 and 4),

  avaliacao text not null,

  nota numeric(4,2) not null
    check (nota between 0 and 10),

  peso numeric(4,2) not null default 1
    check (peso > 0),

  criado_em timestamptz not null default now(),

  atualizado_em timestamptz not null default now()
);


create table if not exists public.frequencia (
  id uuid primary key default gen_random_uuid(),

  aluno_id uuid not null
    references public.alunos(id)
    on delete cascade,

  disciplina_id uuid not null
    references public.disciplinas(id)
    on delete cascade,

  professor_id uuid
    references public.perfis(id)
    on delete set null,

  data_aula date not null,

  situacao text not null
    check (
      situacao in (
        'presente',
        'falta',
        'justificada'
      )
    ),

  observacoes text,

  criado_em timestamptz not null default now(),

  atualizado_em timestamptz not null default now(),

  unique (
    aluno_id,
    disciplina_id,
    data_aula
  )
);


-- ============================================================================
-- ÍNDICES
-- ============================================================================

create index if not exists idx_alunos_turma
on public.alunos(turma_id);


create index if not exists idx_atribuicoes_professor
on public.atribuicoes_professores(professor_id);


create index if not exists idx_atribuicoes_turma_disciplina
on public.atribuicoes_professores(
  turma_id,
  disciplina_id
);


create index if not exists idx_notas_aluno
on public.notas(aluno_id);


create index if not exists idx_notas_disciplina_bimestre
on public.notas(
  disciplina_id,
  bimestre
);


create index if not exists idx_frequencia_aluno_data
on public.frequencia(
  aluno_id,
  data_aula
);


-- ============================================================================
-- FUNÇÕES AUXILIARES DE SEGURANÇA
-- ============================================================================

create or replace function public.tipo_usuario_atual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tipo_usuario
  from public.perfis
  where id = auth.uid()
    and situacao = 'ativo'
  limit 1;
$$;


create or replace function public.eh_funcionario()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.perfis
    where id = auth.uid()
      and tipo_usuario = 'funcionario'
      and situacao = 'ativo'
  );
$$;


create or replace function public.eh_professor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.perfis
    where id = auth.uid()
      and tipo_usuario = 'professor'
      and situacao = 'ativo'
  );
$$;


create or replace function public.professor_tem_atribuicao(
  turma_alvo uuid,
  disciplina_alvo uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.eh_professor()
    and exists (
      select 1
      from public.atribuicoes_professores ap
      where ap.professor_id = auth.uid()
        and ap.turma_id = turma_alvo
        and ap.disciplina_id = disciplina_alvo
    );
$$;


create or replace function public.professor_pode_acessar_aluno(
  aluno_alvo uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.eh_professor()
    and exists (
      select 1
      from public.alunos a

      join public.atribuicoes_professores ap
        on ap.turma_id = a.turma_id

      where a.id = aluno_alvo
        and ap.professor_id = auth.uid()
    );
$$;


-- Permissões explícitas para funções utilizadas pelas policies

revoke all
on function public.tipo_usuario_atual()
from public;

grant execute
on function public.tipo_usuario_atual()
to authenticated;


revoke all
on function public.eh_funcionario()
from public;

grant execute
on function public.eh_funcionario()
to authenticated;


revoke all
on function public.eh_professor()
from public;

grant execute
on function public.eh_professor()
to authenticated;


revoke all
on function public.professor_tem_atribuicao(uuid, uuid)
from public;

grant execute
on function public.professor_tem_atribuicao(uuid, uuid)
to authenticated;


revoke all
on function public.professor_pode_acessar_aluno(uuid)
from public;

grant execute
on function public.professor_pode_acessar_aluno(uuid)
to authenticated;


-- ============================================================================
-- FUNÇÃO DE ATUALIZAÇÃO AUTOMÁTICA
-- ============================================================================

create or replace function public.definir_atualizado_em()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;


-- ============================================================================
-- VALIDAÇÃO DE ATRIBUIÇÕES
-- ============================================================================

create or replace function public.validar_atribuicao_professor()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  curso_turma uuid;
  curso_disciplina uuid;
  tipo_professor text;
begin

  select tipo_usuario
  into tipo_professor
  from public.perfis
  where id = new.professor_id;


  if tipo_professor is distinct from 'professor' then
    raise exception
      'O usuário selecionado precisa possuir o perfil de professor.';
  end if;


  select curso_id
  into curso_turma
  from public.turmas
  where id = new.turma_id;


  select curso_id
  into curso_disciplina
  from public.disciplinas
  where id = new.disciplina_id;


  if curso_turma is null then
    raise exception
      'A turma selecionada não foi encontrada.';
  end if;


  if curso_disciplina is null then
    raise exception
      'A disciplina selecionada não foi encontrada.';
  end if;


  if curso_turma is distinct from curso_disciplina then
    raise exception
      'A disciplina precisa pertencer ao mesmo curso da turma.';
  end if;


  return new;
end;
$$;


-- ============================================================================
-- VALIDAÇÃO DE NOTAS E FREQUÊNCIA
-- ============================================================================

create or replace function public.validar_disciplina_aluno()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  curso_turma uuid;
  curso_disciplina uuid;
begin

  select t.curso_id
  into curso_turma
  from public.alunos a

  join public.turmas t
    on t.id = a.turma_id

  where a.id = new.aluno_id;


  select curso_id
  into curso_disciplina
  from public.disciplinas
  where id = new.disciplina_id;


  if curso_turma is null then
    raise exception
      'O aluno precisa estar vinculado a uma turma.';
  end if;


  if curso_disciplina is null then
    raise exception
      'A disciplina selecionada não foi encontrada.';
  end if;


  if curso_turma is distinct from curso_disciplina then
    raise exception
      'A disciplina precisa pertencer ao curso do aluno.';
  end if;


  return new;
end;
$$;


-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Remove nomes antigos caso o banco tenha passado por tradução.

drop trigger if exists profiles_set_updated_at
on public.perfis;

drop trigger if exists perfis_definir_atualizado_em
on public.perfis;


create trigger perfis_definir_atualizado_em
before update
on public.perfis
for each row
execute function public.definir_atualizado_em();


drop trigger if exists grades_set_updated_at
on public.notas;

drop trigger if exists notas_definir_atualizado_em
on public.notas;


create trigger notas_definir_atualizado_em
before update
on public.notas
for each row
execute function public.definir_atualizado_em();


drop trigger if exists attendance_set_updated_at
on public.frequencia;

drop trigger if exists frequencia_definir_atualizado_em
on public.frequencia;


create trigger frequencia_definir_atualizado_em
before update
on public.frequencia
for each row
execute function public.definir_atualizado_em();


drop trigger if exists assignments_validate_course
on public.atribuicoes_professores;

drop trigger if exists atribuicoes_validar
on public.atribuicoes_professores;


create trigger atribuicoes_validar
before insert or update
on public.atribuicoes_professores
for each row
execute function public.validar_atribuicao_professor();


drop trigger if exists grades_validate_course
on public.notas;

drop trigger if exists notas_validar_disciplina
on public.notas;


create trigger notas_validar_disciplina
before insert or update
on public.notas
for each row
execute function public.validar_disciplina_aluno();


drop trigger if exists attendance_validate_course
on public.frequencia;

drop trigger if exists frequencia_validar_disciplina
on public.frequencia;


create trigger frequencia_validar_disciplina
before insert or update
on public.frequencia
for each row
execute function public.validar_disciplina_aluno();


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.perfis
enable row level security;

alter table public.cursos
enable row level security;

alter table public.turmas
enable row level security;

alter table public.alunos
enable row level security;

alter table public.professores
enable row level security;

alter table public.funcionarios
enable row level security;

alter table public.disciplinas
enable row level security;

alter table public.atribuicoes_professores
enable row level security;

alter table public.notas
enable row level security;

alter table public.frequencia
enable row level security;


-- ============================================================================
-- PERFIS
-- ============================================================================

-- Remove policy criada anteriormente durante nossa correção.
drop policy if exists "funcionario_visualiza_todos_perfis"
on public.perfis;


drop policy if exists "perfis_leitura_permitida"
on public.perfis;

create policy "perfis_leitura_permitida"
on public.perfis
for select
to authenticated
using (
  id = auth.uid()
  or public.eh_funcionario()
  or public.eh_professor()
);


drop policy if exists "perfis_funcionario_atualiza"
on public.perfis;

create policy "perfis_funcionario_atualiza"
on public.perfis
for update
to authenticated
using (
  public.eh_funcionario()
)
with check (
  public.eh_funcionario()
);


-- ============================================================================
-- CURSOS
-- ============================================================================

drop policy if exists "cursos_leitura_autenticados"
on public.cursos;

create policy "cursos_leitura_autenticados"
on public.cursos
for select
to authenticated
using (true);


drop policy if exists "cursos_funcionario_gerencia"
on public.cursos;

create policy "cursos_funcionario_gerencia"
on public.cursos
for all
to authenticated
using (
  public.eh_funcionario()
)
with check (
  public.eh_funcionario()
);


-- ============================================================================
-- TURMAS
-- ============================================================================

drop policy if exists "turmas_leitura_autenticados"
on public.turmas;

create policy "turmas_leitura_autenticados"
on public.turmas
for select
to authenticated
using (true);


drop policy if exists "turmas_funcionario_gerencia"
on public.turmas;

create policy "turmas_funcionario_gerencia"
on public.turmas
for all
to authenticated
using (
  public.eh_funcionario()
)
with check (
  public.eh_funcionario()
);


-- ============================================================================
-- DISCIPLINAS
-- ============================================================================

drop policy if exists "disciplinas_leitura_autenticados"
on public.disciplinas;

create policy "disciplinas_leitura_autenticados"
on public.disciplinas
for select
to authenticated
using (true);


drop policy if exists "disciplinas_funcionario_gerencia"
on public.disciplinas;

create policy "disciplinas_funcionario_gerencia"
on public.disciplinas
for all
to authenticated
using (
  public.eh_funcionario()
)
with check (
  public.eh_funcionario()
);


-- ============================================================================
-- ALUNOS
-- ============================================================================

drop policy if exists "funcionario_visualiza_alunos"
on public.alunos;


drop policy if exists "alunos_leitura_permitida"
on public.alunos;

create policy "alunos_leitura_permitida"
on public.alunos
for select
to authenticated
using (
  perfil_id = auth.uid()
  or public.eh_funcionario()
  or public.professor_pode_acessar_aluno(id)
);


drop policy if exists "alunos_funcionario_gerencia"
on public.alunos;

create policy "alunos_funcionario_gerencia"
on public.alunos
for all
to authenticated
using (
  public.eh_funcionario()
)
with check (
  public.eh_funcionario()
);


-- ============================================================================
-- PROFESSORES
-- ============================================================================

drop policy if exists "funcionario_visualiza_professores"
on public.professores;


drop policy if exists "professores_leitura_autenticados"
on public.professores;

create policy "professores_leitura_autenticados"
on public.professores
for select
to authenticated
using (true);


drop policy if exists "professores_funcionario_gerencia"
on public.professores;

create policy "professores_funcionario_gerencia"
on public.professores
for all
to authenticated
using (
  public.eh_funcionario()
)
with check (
  public.eh_funcionario()
);


-- ============================================================================
-- FUNCIONÁRIOS
-- ============================================================================

drop policy if exists "funcionario_visualiza_funcionarios"
on public.funcionarios;


drop policy if exists "funcionarios_proprio_ou_funcionario_leitura"
on public.funcionarios;

create policy "funcionarios_proprio_ou_funcionario_leitura"
on public.funcionarios
for select
to authenticated
using (
  perfil_id = auth.uid()
  or public.eh_funcionario()
);


drop policy if exists "funcionarios_funcionario_gerencia"
on public.funcionarios;

create policy "funcionarios_funcionario_gerencia"
on public.funcionarios
for all
to authenticated
using (
  public.eh_funcionario()
)
with check (
  public.eh_funcionario()
);


-- ============================================================================
-- ATRIBUIÇÕES DE PROFESSORES
-- ============================================================================

drop policy if exists "atribuicoes_leitura_permitida"
on public.atribuicoes_professores;

create policy "atribuicoes_leitura_permitida"
on public.atribuicoes_professores
for select
to authenticated
using (
  professor_id = auth.uid()
  or public.eh_funcionario()
);


drop policy if exists "atribuicoes_funcionario_gerencia"
on public.atribuicoes_professores;

create policy "atribuicoes_funcionario_gerencia"
on public.atribuicoes_professores
for all
to authenticated
using (
  public.eh_funcionario()
)
with check (
  public.eh_funcionario()
);


-- ============================================================================
-- NOTAS
-- ============================================================================

drop policy if exists "notas_leitura_permitida"
on public.notas;

create policy "notas_leitura_permitida"
on public.notas
for select
to authenticated
using (
  public.eh_funcionario()

  or exists (
    select 1
    from public.alunos a
    where a.id = aluno_id
      and a.perfil_id = auth.uid()
  )

  or exists (
    select 1
    from public.alunos a
    where a.id = aluno_id
      and public.professor_tem_atribuicao(
        a.turma_id,
        disciplina_id
      )
  )
);


drop policy if exists "notas_funcionario_professor_insere"
on public.notas;

create policy "notas_funcionario_professor_insere"
on public.notas
for insert
to authenticated
with check (
  public.eh_funcionario()

  or (
    professor_id = auth.uid()

    and exists (
      select 1
      from public.alunos a
      where a.id = aluno_id
        and public.professor_tem_atribuicao(
          a.turma_id,
          disciplina_id
        )
    )
  )
);


drop policy if exists "notas_funcionario_professor_atualiza"
on public.notas;

create policy "notas_funcionario_professor_atualiza"
on public.notas
for update
to authenticated
using (
  public.eh_funcionario()
  or professor_id = auth.uid()
)
with check (
  public.eh_funcionario()

  or (
    professor_id = auth.uid()

    and exists (
      select 1
      from public.alunos a
      where a.id = aluno_id
        and public.professor_tem_atribuicao(
          a.turma_id,
          disciplina_id
        )
    )
  )
);


drop policy if exists "notas_funcionario_professor_exclui"
on public.notas;

create policy "notas_funcionario_professor_exclui"
on public.notas
for delete
to authenticated
using (
  public.eh_funcionario()
  or professor_id = auth.uid()
);


-- ============================================================================
-- FREQUÊNCIA
-- ============================================================================

drop policy if exists "frequencia_leitura_permitida"
on public.frequencia;

create policy "frequencia_leitura_permitida"
on public.frequencia
for select
to authenticated
using (
  public.eh_funcionario()

  or exists (
    select 1
    from public.alunos a
    where a.id = aluno_id
      and a.perfil_id = auth.uid()
  )

  or exists (
    select 1
    from public.alunos a
    where a.id = aluno_id
      and public.professor_tem_atribuicao(
        a.turma_id,
        disciplina_id
      )
  )
);


drop policy if exists "frequencia_funcionario_professor_insere"
on public.frequencia;

create policy "frequencia_funcionario_professor_insere"
on public.frequencia
for insert
to authenticated
with check (
  public.eh_funcionario()

  or (
    professor_id = auth.uid()

    and exists (
      select 1
      from public.alunos a
      where a.id = aluno_id
        and public.professor_tem_atribuicao(
          a.turma_id,
          disciplina_id
        )
    )
  )
);


drop policy if exists "frequencia_funcionario_professor_atualiza"
on public.frequencia;

create policy "frequencia_funcionario_professor_atualiza"
on public.frequencia
for update
to authenticated
using (
  public.eh_funcionario()
  or professor_id = auth.uid()
)
with check (
  public.eh_funcionario()

  or (
    professor_id = auth.uid()

    and exists (
      select 1
      from public.alunos a
      where a.id = aluno_id
        and public.professor_tem_atribuicao(
          a.turma_id,
          disciplina_id
        )
    )
  )
);


drop policy if exists "frequencia_funcionario_professor_exclui"
on public.frequencia;

create policy "frequencia_funcionario_professor_exclui"
on public.frequencia
for delete
to authenticated
using (
  public.eh_funcionario()
  or professor_id = auth.uid()
);


-- ============================================================================
-- CURSOS INICIAIS
-- ============================================================================

insert into public.cursos (
  codigo,
  nome
)
values
  (
    'ADM',
    'Administração'
  ),
  (
    'DS',
    'Desenvolvimento de Sistemas'
  ),
  (
    'RH',
    'Recursos Humanos'
  ),
  (
    'INFONET',
    'Informática para Internet'
  ),
  (
    'EDIFICACOES',
    'Edificações'
  )
on conflict (codigo)
do update
set nome = excluded.nome;


-- ============================================================================
-- TURMAS INICIAIS
-- ============================================================================

insert into public.turmas (
  curso_id,
  nome,
  modulo,
  turno,
  ano_letivo
)

select
  c.id,

  c.codigo
    || ' '
    || m.modulo
    || ' — '
    || case s.turno
      when 'manha' then 'Manhã'
      when 'tarde' then 'Tarde'
      else 'Noite'
    end,

  m.modulo,

  s.turno,

  extract(year from current_date)::smallint

from public.cursos c

cross join (
  values
    (1),
    (2),
    (3)
) as m(modulo)

cross join (
  values
    ('manha'),
    ('tarde'),
    ('noite')
) as s(turno)

on conflict (
  curso_id,
  modulo,
  turno,
  ano_letivo
)
do nothing;


-- ============================================================================
-- DISCIPLINAS COMUNS
-- ============================================================================

insert into public.disciplinas (
  curso_id,
  codigo,
  nome,
  carga_horaria
)

select
  c.id,
  base.codigo,
  base.nome,
  base.carga_horaria

from public.cursos c

cross join (
  values

    (
      'PORT',
      'Língua Portuguesa',
      80
    ),

    (
      'MAT',
      'Matemática',
      80
    ),

    (
      'ING',
      'Inglês Instrumental',
      40
    )

) as base(
  codigo,
  nome,
  carga_horaria
)

on conflict (
  curso_id,
  codigo
)
do update
set
  nome = excluded.nome,
  carga_horaria = excluded.carga_horaria;


-- ============================================================================
-- DISCIPLINAS ESPECÍFICAS
-- ============================================================================

insert into public.disciplinas (
  curso_id,
  codigo,
  nome,
  carga_horaria
)

select
  c.id,
  base.codigo,
  base.nome,
  base.carga_horaria

from public.cursos c

join (
  values

    (
      'DS',
      'PW',
      'Programação Web',
      120
    ),

    (
      'DS',
      'BD',
      'Banco de Dados',
      120
    ),

    (
      'DS',
      'DSW',
      'Desenvolvimento de Sistemas',
      120
    ),

    (
      'ADM',
      'GEST',
      'Gestão Empresarial',
      120
    ),

    (
      'ADM',
      'MKT',
      'Marketing',
      80
    ),

    (
      'RH',
      'RHP',
      'Rotinas de Recursos Humanos',
      120
    ),

    (
      'RH',
      'PSI',
      'Psicologia Organizacional',
      80
    ),

    (
      'INFONET',
      'WD',
      'Web Design',
      120
    ),

    (
      'INFONET',
      'RC',
      'Redes de Computadores',
      80
    ),

    (
      'EDIFICACOES',
      'DES',
      'Desenho Técnico',
      120
    ),

    (
      'EDIFICACOES',
      'MATC',
      'Materiais de Construção',
      80
    )

) as base(
  codigo_curso,
  codigo,
  nome,
  carga_horaria
)

on base.codigo_curso = c.codigo

on conflict (
  curso_id,
  codigo
)
do update
set
  nome = excluded.nome,
  carga_horaria = excluded.carga_horaria;


-- ============================================================================
-- FIM
-- ============================================================================

-- Depois de criar o banco:
--
-- 1. Crie o primeiro usuário administrativo no Supabase Authentication.
--
-- 2. Insira o perfil correspondente em public.perfis com:
--
--    tipo_usuario = 'funcionario'
--    situacao = 'ativo'
--
-- 3. Insira também o registro correspondente em public.funcionarios.
--
-- Depois disso, o funcionário poderá utilizar o painel administrativo.