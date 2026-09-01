-- Portal Escola — estrutura completa do banco de dados
-- Execute este arquivo uma única vez no SQL Editor do Supabase.

create extension if not exists pgcrypto;

-- Tabelas principais ---------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) >= 3),
  email text not null unique,
  role text not null check (role in ('aluno', 'professor', 'funcionario')),
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  name text not null,
  module smallint not null check (module between 1 and 3),
  shift text not null check (shift in ('manha', 'tarde', 'noite')),
  school_year smallint not null check (school_year between 2020 and 2100),
  room text,
  created_at timestamptz not null default now(),
  unique (course_id, module, shift, school_year)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  registration text not null unique,
  class_id uuid references public.classes(id) on delete set null,
  guardian_name text,
  birth_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  registration text not null unique,
  specialty text,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  registration text not null unique,
  job_title text,
  department text,
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  code text not null,
  name text not null,
  workload smallint not null default 40 check (workload > 0),
  created_at timestamptz not null default now(),
  unique (course_id, code)
);

create table if not exists public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teacher_id, class_id, subject_id)
);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid references public.profiles(id) on delete set null,
  term smallint not null check (term between 1 and 4),
  assessment text not null,
  score numeric(4,2) not null check (score between 0 and 10),
  weight numeric(4,2) not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid references public.profiles(id) on delete set null,
  attendance_date date not null,
  status text not null check (status in ('presente', 'falta', 'justificada')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject_id, attendance_date)
);

create index if not exists idx_students_class on public.students(class_id);
create index if not exists idx_assignments_teacher on public.teacher_assignments(teacher_id);
create index if not exists idx_assignments_class_subject on public.teacher_assignments(class_id, subject_id);
create index if not exists idx_grades_student on public.grades(student_id);
create index if not exists idx_grades_subject_term on public.grades(subject_id, term);
create index if not exists idx_attendance_student_date on public.attendance(student_id, attendance_date);

-- Funções auxiliares de segurança ------------------------------------------

create or replace function public.current_school_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_school_employee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'funcionario' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.teacher_has_assignment(target_class uuid, target_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.teacher_id = auth.uid()
      and ta.class_id = target_class
      and ta.subject_id = target_subject
  );
$$;

create or replace function public.teacher_can_access_student(target_student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    join public.teacher_assignments ta on ta.class_id = s.class_id
    where s.id = target_student and ta.teacher_id = auth.uid()
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_assignment_course()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  class_course uuid;
  subject_course uuid;
begin
  select course_id into class_course from public.classes where id = new.class_id;
  select course_id into subject_course from public.subjects where id = new.subject_id;
  if class_course is distinct from subject_course then
    raise exception 'A disciplina precisa pertencer ao mesmo curso da turma.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_student_subject()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  class_course uuid;
  subject_course uuid;
begin
  select c.course_id into class_course
  from public.students s
  join public.classes c on c.id = s.class_id
  where s.id = new.student_id;
  select course_id into subject_course from public.subjects where id = new.subject_id;
  if class_course is null or class_course is distinct from subject_course then
    raise exception 'A disciplina precisa pertencer ao curso do aluno.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists grades_set_updated_at on public.grades;
create trigger grades_set_updated_at before update on public.grades for each row execute function public.set_updated_at();
drop trigger if exists attendance_set_updated_at on public.attendance;
create trigger attendance_set_updated_at before update on public.attendance for each row execute function public.set_updated_at();
drop trigger if exists assignments_validate_course on public.teacher_assignments;
create trigger assignments_validate_course before insert or update on public.teacher_assignments for each row execute function public.validate_assignment_course();
drop trigger if exists grades_validate_course on public.grades;
create trigger grades_validate_course before insert or update on public.grades for each row execute function public.validate_student_subject();
drop trigger if exists attendance_validate_course on public.attendance;
create trigger attendance_validate_course before insert or update on public.attendance for each row execute function public.validate_student_subject();

-- Row Level Security --------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.teachers enable row level security;
alter table public.employees enable row level security;
alter table public.subjects enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.grades enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "profiles_select_allowed" on public.profiles;
create policy "profiles_select_allowed" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_school_employee() or public.current_school_role() = 'professor');

drop policy if exists "profiles_staff_update" on public.profiles;
create policy "profiles_staff_update" on public.profiles for update to authenticated
using (public.is_school_employee()) with check (public.is_school_employee());

drop policy if exists "courses_authenticated_read" on public.courses;
create policy "courses_authenticated_read" on public.courses for select to authenticated using (true);
drop policy if exists "courses_staff_manage" on public.courses;
create policy "courses_staff_manage" on public.courses for all to authenticated using (public.is_school_employee()) with check (public.is_school_employee());

drop policy if exists "classes_authenticated_read" on public.classes;
create policy "classes_authenticated_read" on public.classes for select to authenticated using (true);
drop policy if exists "classes_staff_manage" on public.classes;
create policy "classes_staff_manage" on public.classes for all to authenticated using (public.is_school_employee()) with check (public.is_school_employee());

drop policy if exists "subjects_authenticated_read" on public.subjects;
create policy "subjects_authenticated_read" on public.subjects for select to authenticated using (true);
drop policy if exists "subjects_staff_manage" on public.subjects;
create policy "subjects_staff_manage" on public.subjects for all to authenticated using (public.is_school_employee()) with check (public.is_school_employee());

drop policy if exists "students_select_allowed" on public.students;
create policy "students_select_allowed" on public.students for select to authenticated
using (profile_id = auth.uid() or public.is_school_employee() or public.teacher_can_access_student(id));
drop policy if exists "students_staff_manage" on public.students;
create policy "students_staff_manage" on public.students for all to authenticated using (public.is_school_employee()) with check (public.is_school_employee());

drop policy if exists "teachers_authenticated_read" on public.teachers;
create policy "teachers_authenticated_read" on public.teachers for select to authenticated using (true);
drop policy if exists "teachers_staff_manage" on public.teachers;
create policy "teachers_staff_manage" on public.teachers for all to authenticated using (public.is_school_employee()) with check (public.is_school_employee());

drop policy if exists "employees_self_or_staff_read" on public.employees;
create policy "employees_self_or_staff_read" on public.employees for select to authenticated using (profile_id = auth.uid() or public.is_school_employee());
drop policy if exists "employees_staff_manage" on public.employees;
create policy "employees_staff_manage" on public.employees for all to authenticated using (public.is_school_employee()) with check (public.is_school_employee());

drop policy if exists "assignments_allowed_read" on public.teacher_assignments;
create policy "assignments_allowed_read" on public.teacher_assignments for select to authenticated
using (teacher_id = auth.uid() or public.is_school_employee());
drop policy if exists "assignments_staff_manage" on public.teacher_assignments;
create policy "assignments_staff_manage" on public.teacher_assignments for all to authenticated using (public.is_school_employee()) with check (public.is_school_employee());

drop policy if exists "grades_allowed_read" on public.grades;
create policy "grades_allowed_read" on public.grades for select to authenticated
using (
  public.is_school_employee()
  or exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid())
  or exists (select 1 from public.students s where s.id = student_id and public.teacher_has_assignment(s.class_id, subject_id))
);
drop policy if exists "grades_staff_or_teacher_insert" on public.grades;
create policy "grades_staff_or_teacher_insert" on public.grades for insert to authenticated
with check (
  public.is_school_employee()
  or exists (select 1 from public.students s where s.id = student_id and public.teacher_has_assignment(s.class_id, subject_id))
);
drop policy if exists "grades_staff_or_teacher_update" on public.grades;
create policy "grades_staff_or_teacher_update" on public.grades for update to authenticated
using (public.is_school_employee() or teacher_id = auth.uid())
with check (
  public.is_school_employee()
  or (teacher_id = auth.uid() and exists (select 1 from public.students s where s.id = student_id and public.teacher_has_assignment(s.class_id, subject_id)))
);
drop policy if exists "grades_staff_or_teacher_delete" on public.grades;
create policy "grades_staff_or_teacher_delete" on public.grades for delete to authenticated
using (public.is_school_employee() or teacher_id = auth.uid());

drop policy if exists "attendance_allowed_read" on public.attendance;
create policy "attendance_allowed_read" on public.attendance for select to authenticated
using (
  public.is_school_employee()
  or exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid())
  or exists (select 1 from public.students s where s.id = student_id and public.teacher_has_assignment(s.class_id, subject_id))
);
drop policy if exists "attendance_staff_or_teacher_insert" on public.attendance;
create policy "attendance_staff_or_teacher_insert" on public.attendance for insert to authenticated
with check (
  public.is_school_employee()
  or exists (select 1 from public.students s where s.id = student_id and public.teacher_has_assignment(s.class_id, subject_id))
);
drop policy if exists "attendance_staff_or_teacher_update" on public.attendance;
create policy "attendance_staff_or_teacher_update" on public.attendance for update to authenticated
using (public.is_school_employee() or teacher_id = auth.uid())
with check (
  public.is_school_employee()
  or (teacher_id = auth.uid() and exists (select 1 from public.students s where s.id = student_id and public.teacher_has_assignment(s.class_id, subject_id)))
);
drop policy if exists "attendance_staff_or_teacher_delete" on public.attendance;
create policy "attendance_staff_or_teacher_delete" on public.attendance for delete to authenticated
using (public.is_school_employee() or teacher_id = auth.uid());

-- Cursos, turmas e disciplinas iniciais ------------------------------------

insert into public.courses (code, name) values
  ('ADM', 'Administração'),
  ('DS', 'Desenvolvimento de Sistemas'),
  ('RH', 'Recursos Humanos'),
  ('INFONET', 'Informática para Internet'),
  ('EDIFICACOES', 'Edificações')
on conflict (code) do update set name = excluded.name;

insert into public.classes (course_id, name, module, shift, school_year)
select
  c.id,
  c.code || ' ' || m.module || ' — ' || case s.shift when 'manha' then 'Manhã' when 'tarde' then 'Tarde' else 'Noite' end,
  m.module,
  s.shift,
  extract(year from current_date)::smallint
from public.courses c
cross join (values (1), (2), (3)) as m(module)
cross join (values ('manha'), ('tarde'), ('noite')) as s(shift)
on conflict (course_id, module, shift, school_year) do nothing;

insert into public.subjects (course_id, code, name, workload)
select c.id, seed.code, seed.name, seed.workload
from public.courses c
cross join (values
  ('PORT', 'Língua Portuguesa', 80),
  ('MAT', 'Matemática', 80),
  ('ING', 'Inglês Instrumental', 40)
) as seed(code, name, workload)
on conflict (course_id, code) do nothing;

insert into public.subjects (course_id, code, name, workload)
select c.id, seed.code, seed.name, seed.workload
from public.courses c
join (values
  ('DS', 'PW', 'Programação Web', 120),
  ('DS', 'BD', 'Banco de Dados', 120),
  ('DS', 'DSW', 'Desenvolvimento de Sistemas', 120),
  ('ADM', 'GEST', 'Gestão Empresarial', 120),
  ('ADM', 'MKT', 'Marketing', 80),
  ('RH', 'RHP', 'Rotinas de Recursos Humanos', 120),
  ('RH', 'PSI', 'Psicologia Organizacional', 80),
  ('INFONET', 'WD', 'Web Design', 120),
  ('INFONET', 'RC', 'Redes de Computadores', 80),
  ('EDIFICACOES', 'DES', 'Desenho Técnico', 120),
  ('EDIFICACOES', 'MATC', 'Materiais de Construção', 80)
) as seed(course_code, code, name, workload) on seed.course_code = c.code
on conflict (course_id, code) do nothing;

-- IMPORTANTE: depois de executar este arquivo, siga o passo "Primeiro
-- funcionário" do README.md para liberar o primeiro acesso administrativo.
