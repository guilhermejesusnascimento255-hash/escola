# Portal Escola

Sistema escolar inspirado no fluxo de portais acadêmicos como o NSA. O projeto funciona no GitHub Pages e usa o Supabase para autenticação, banco de dados e criação segura de contas.

## O que já está pronto

- Login separado por permissões de aluno, professor e funcionário
- Cadastro e exclusão de alunos, professores e funcionários
- Cursos ADM, DS, RH, INFONET e EDIFICAÇÕES
- Turmas de 1º, 2º e 3º módulo nos períodos manhã, tarde e noite
- Lançamento, edição e exclusão de notas
- Registro, edição e exclusão de presença, falta e falta justificada
- Boletim e frequência individual do aluno
- Vínculos de professores com turma e disciplina
- Painéis diferentes para cada perfil
- Busca, filtros, tabelas responsivas e impressão de boletim
- Tema claro e escuro salvo no navegador
- Regras de segurança no banco (RLS)

## Estrutura dos arquivos

```text
projeto-escola/
├── index.html
├── styles.css
├── app.js
├── config.js
├── database.sql
├── .nojekyll
└── supabase/
    └── functions/
        └── manage-user/
            ├── index.ts
            └── deno.json
```

## 1. Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com), crie uma conta e clique em **New project**.
2. Escolha um nome, uma senha forte para o banco e a região mais próxima.
3. Aguarde o projeto terminar de ser criado.
4. No menu lateral, abra **SQL Editor** e clique em **New query**.
5. Copie todo o conteúdo do arquivo `database.sql`, cole no editor e clique em **Run**.

Esse script cria as tabelas, permissões, cursos, disciplinas e 45 turmas iniciais (5 cursos × 3 módulos × 3 períodos).

## 2. Criar o primeiro funcionário

O primeiro funcionário é criado manualmente porque ainda não existe ninguém autorizado a cadastrar as outras contas.

1. No Supabase, abra **Authentication > Users**.
2. Clique em **Add user > Create new user**.
3. Informe seu e-mail e uma senha com pelo menos 6 caracteres.
4. Marque a opção para confirmar o e-mail automaticamente e crie o usuário.
5. Copie o **UUID** desse usuário.
6. Volte ao **SQL Editor** e execute o código abaixo, trocando os valores indicados:

```sql
insert into public.profiles (id, full_name, email, role, status)
values (
  'COLE-AQUI-O-UUID',
  'Guilherme Jesus Nascimento',
  'SEU-EMAIL',
  'funcionario',
  'ativo'
);

insert into public.employees (profile_id, registration, job_title, department)
values (
  'COLE-AQUI-O-UUID',
  'FUNC-001',
  'Administrador do sistema',
  'Tecnologia'
);
```

## 3. Configurar a conexão do site

No Supabase, abra **Project Settings > API** e copie:

- **Project URL**
- **anon public key** ou **Publishable key**

Abra `config.js` e substitua os valores:

```js
window.ESCOLA_CONFIG = {
  supabaseUrl: "https://SEU-ID.supabase.co",
  supabaseAnonKey: "SUA-CHAVE-PUBLICA"
};
```

É normal a chave pública ficar no GitHub. A segurança é feita pelas regras RLS do `database.sql`. Nunca coloque a chave `service_role` no site ou no GitHub.

## 4. Publicar a função de cadastro

A função `manage-user` cria contas sem expor a chave administrativa. Para publicar, tenha o [Node.js](https://nodejs.org/) instalado e abra o terminal dentro da pasta do projeto.

```bash
npx supabase login
npx supabase link --project-ref SEU-PROJECT-REF
npx supabase functions deploy manage-user
```

O **project ref** é a parte inicial da URL do projeto. Exemplo: em `https://abcdefgh.supabase.co`, o project ref é `abcdefgh`.

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já são disponibilizadas automaticamente dentro da função pelo Supabase.

## 5. Colocar no GitHub Pages

1. Crie um repositório novo no GitHub.
2. Envie o conteúdo da pasta `projeto-escola` para a raiz do repositório. O `index.html` precisa ficar na raiz.
3. Abra **Settings > Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione a branch `main`, a pasta `/ (root)` e clique em **Save**.
6. Aguarde o GitHub mostrar o endereço publicado.

Depois, no Supabase, abra **Authentication > URL Configuration**:

- Em **Site URL**, coloque a URL do GitHub Pages.
- Em **Redirect URLs**, adicione a mesma URL terminando com `/**`.

Exemplo:

```text
https://seuusuario.github.io/seu-repositorio/**
```

## Como usar

1. Entre com a conta do primeiro funcionário.
2. Vá em **Pessoas** e cadastre alunos, professores e outros funcionários.
3. Vá em **Turmas** e, na seção de vínculos, relacione cada professor a uma turma e disciplina.
4. O professor poderá entrar, visualizar somente seus alunos vinculados, lançar notas e registrar frequência.
5. O aluno poderá entrar e consultar somente o próprio boletim e a própria frequência.

## Regras de acesso

| Perfil | Permissões principais |
| --- | --- |
| Aluno | Ver o próprio boletim e a própria frequência |
| Professor | Ver alunos das turmas vinculadas, lançar notas e fazer chamada |
| Funcionário | Gerenciar pessoas, turmas, vínculos, notas e frequência |

## Observações importantes

- Desative cadastro público em **Authentication > Providers > Email**, mantendo a opção de novos cadastros desligada. As contas devem ser criadas pelo portal.
- Para trocar o ano das turmas iniciais, altere o campo `school_year` pelo portal ou no banco.
- O arquivo `.nojekyll` evita que o GitHub Pages tente processar o projeto como Jekyll.
- Se o site mostrar a tela “Configuração necessária”, confira os dois valores de `config.js`.

