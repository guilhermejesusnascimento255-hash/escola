import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.ESCOLA_CONFIG ?? {};
const isConfigured =
  config.supabaseUrl?.startsWith("https://") &&
  !config.supabaseUrl.includes("SEU-PROJETO") &&
  config.supabaseAnonKey &&
  !config.supabaseAnonKey.includes("SUA-CHAVE");

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const setupScreen = $("#setup-screen");
const authScreen = $("#auth-screen");
const appShell = $("#app-shell");

if (!isConfigured) {
  setupScreen.classList.remove("hidden");
  window.lucide?.createIcons();
} else {
  startApplication();
}

async function startApplication() {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  const state = {
    supabase,
    session: null,
    profile: null,
    currentView: "inicio",
    people: [],
    peopleCount: 0,
    courses: [],
    classes: [],
    subjects: [],
    students: [],
    teacherAssignments: [],
    grades: [],
    attendance: [],
    confirmCallback: null
  };

  bindStaticEvents(state);
  applySavedTheme();

  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (session) {
    await enterApp(state, session);
  } else {
    showAuth();
  }

  supabase.auth.onAuthStateChange(async (event, newSession) => {
    if (event === "SIGNED_OUT") {
      showAuth();
    }

    if (event === "PASSWORD_RECOVERY") {
      toast(
        "Recuperação iniciada",
        "Abra as configurações do Supabase para definir o fluxo de troca de senha.",
        "success"
      );
    }

    if (
      event === "SIGNED_IN" &&
      newSession &&
      newSession.user.id !== state.session?.user?.id
    ) {
      await enterApp(state, newSession);
    }
  });

  async function enterApp(currentState, session) {
    currentState.session = session;

    setLoading(true);

    const { data: profile, error } = await supabase
      .from("perfis")
      .select(
        "id, full_name:nome_completo, email, role:tipo_usuario, status:situacao"
      )
      .eq("id", session.user.id)
      .single();

    if (error || !profile) {
      setLoading(false);

      await supabase.auth.signOut();

      showAuth();

      setFormError(
        $("#login-error"),
        "Sua conta existe, mas o perfil escolar ainda não foi criado. Procure a secretaria."
      );

      return;
    }

    if (profile.status !== "ativo") {
      setLoading(false);

      await supabase.auth.signOut();

      showAuth();

      setFormError(
        $("#login-error"),
        "Este acesso está inativo. Procure a secretaria da escola."
      );

      return;
    }

    currentState.profile = profile;

    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");

    applyRolePermissions(profile.role);
    updateUserIdentity(profile);

    await loadAllData(currentState);

    navigateTo(currentState, "inicio");

    setLoading(false);
  }
}

function bindStaticEvents(state) {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = $("#login-button");
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;

    setFormError($("#login-error"), "");
    setButtonLoading(button, true, "Entrando...");

    const { error } =
      await state.supabase.auth.signInWithPassword({
        email,
        password
      });

    setButtonLoading(
      button,
      false,
      "Entrar no portal"
    );

    if (error) {
      setFormError(
        $("#login-error"),
        friendlyAuthError(error.message)
      );

      return;
    }

    if ($("#remember-email").checked) {
      localStorage.setItem(
        "escola-email",
        email
      );
    } else {
      localStorage.removeItem(
        "escola-email"
      );
    }
  });

  const savedEmail =
    localStorage.getItem(
      "escola-email"
    );

  if (savedEmail) {
    $("#login-email").value =
      savedEmail;

    $("#remember-email").checked =
      true;
  }

  $("#toggle-password").addEventListener(
    "click",
    () => {
      const input =
        $("#login-password");

      const showing =
        input.type === "text";

      input.type =
        showing
          ? "password"
          : "text";

      $("#toggle-password").innerHTML =
        `<i data-lucide="${
          showing
            ? "eye"
            : "eye-off"
        }"></i>`;

      refreshIcons();
    }
  );

  $("#forgot-password").addEventListener(
    "click",
    async () => {
      const email =
        $("#login-email")
          .value
          .trim();

      if (!email) {
        setFormError(
          $("#login-error"),
          "Digite seu e-mail para receber o link de recuperação."
        );

        $("#login-email").focus();

        return;
      }

      const { error } =
        await state.supabase.auth.resetPasswordForEmail(
          email,
          {
            redirectTo:
              `${location.origin}${location.pathname}`
          }
        );

      if (error) {
        setFormError(
          $("#login-error"),
          error.message
        );
      } else {
        toast(
          "Link enviado",
          "Confira a caixa de entrada e a pasta de spam.",
          "success"
        );
      }
    }
  );

  $$(".theme-toggle").forEach(
    (button) =>
      button.addEventListener(
        "click",
        toggleTheme
      )
  );

  $("#logout-button").addEventListener(
    "click",
    () =>
      state.supabase.auth.signOut()
  );

  $("#refresh-button").addEventListener(
    "click",
    async () => {
      setLoading(true);

      await loadAllData(state);

      setLoading(false);

      toast(
        "Dados atualizados",
        "As informações mais recentes foram carregadas.",
        "success"
      );
    }
  );

  $$(".nav-item").forEach(
    (item) =>
      item.addEventListener(
        "click",
        () =>
          navigateTo(
            state,
            item.dataset.view
          )
      )
  );

  $("#open-sidebar").addEventListener(
    "click",
    () =>
      $("#sidebar").classList.add(
        "open"
      )
  );

  $("#close-sidebar").addEventListener(
    "click",
    closeSidebar
  );

  $("#sidebar-overlay").addEventListener(
    "click",
    closeSidebar
  );

  $("#new-person-button").addEventListener(
    "click",
    () =>
      openDialog(
        "person-dialog"
      )
  );

  $("#new-class-button").addEventListener(
    "click",
    () => {
      $("#class-form").reset();

      $(
        "#class-form [name='school_year']"
      ).value =
        new Date().getFullYear();

      openDialog(
        "class-dialog"
      );
    }
  );

  $("#new-grade-button").addEventListener(
    "click",
    () =>
      openGradeDialog(
        state
      )
  );

  $("#new-attendance-button").addEventListener(
    "click",
    () =>
      openRollCall(
        state
      )
  );

  $("#attendance-back-button").addEventListener(
    "click",
    () =>
      navigateTo(
        state,
        "frequencia"
      )
  );

  $("#roll-call-class-select").addEventListener(
    "change",
    () => {
      updateRollCallSubjectSelect(
        state
      );

      renderRollCallRoster(
        state
      );
    }
  );

  $("#roll-call-subject-select").addEventListener(
    "change",
    () =>
      renderRollCallRoster(
        state
      )
  );

  $("#roll-call-date").addEventListener(
    "change",
    () =>
      renderRollCallRoster(
        state
      )
  );

  $("#mark-all-present-button").addEventListener(
    "click",
    () => {
      $$(".roll-call-row", $("#roll-call-list"))
        .forEach(
          (row) =>
            setRollCallRowStatus(
              row,
              "presente"
            )
        );

      updateRollCallCounters();
    }
  );

  $("#roll-call-list").addEventListener(
    "click",
    (event) => {
      const button =
        event.target.closest(
          "[data-roll-call-status]"
        );

      if (!button) {
        return;
      }

      setRollCallRowStatus(
        button.closest(
          ".roll-call-row"
        ),
        button.dataset
          .rollCallStatus
      );

      updateRollCallCounters();
    }
  );

  $("#roll-call-form").addEventListener(
    "submit",
    (event) =>
      submitRollCall(
        event,
        state
      )
  );

  $("#new-assignment-button").addEventListener(
    "click",
    () =>
      openAssignmentDialog(
        state
      )
  );

  $("#print-report-button").addEventListener(
    "click",
    () =>
      window.print()
  );

  $$(".modal-close").forEach(
    (button) =>
      button.addEventListener(
        "click",
        () =>
          button
            .closest("dialog")
            .close()
      )
  );

  $$("dialog.modal").forEach(
    (dialog) =>
      dialog.addEventListener(
        "click",
        (event) => {
          if (
            event.target === dialog
          ) {
            dialog.close();
          }
        }
      )
  );

  $("#person-form [name='role']")
    .addEventListener(
      "change",
      () =>
        updatePersonFields(
          state
        )
    );

  $("#person-form").addEventListener(
    "submit",
    (event) =>
      submitPerson(
        event,
        state
      )
  );
$("#access-form").addEventListener(
  "submit",
  (event) =>
    submitAccessChange(
      event,
      state
    )
);
  $("#class-form").addEventListener(
    "submit",
    (event) =>
      submitClass(
        event,
        state
      )
  );

  $("#grade-form").addEventListener(
    "submit",
    (event) =>
      submitGrade(
        event,
        state
      )
  );

  $("#attendance-form").addEventListener(
    "submit",
    (event) =>
      submitAttendance(
        event,
        state
      )
  );

  $("#assignment-form").addEventListener(
    "submit",
    (event) =>
      submitAssignment(
        event,
        state
      )
  );

  $("#people-search").addEventListener(
    "input",
    () =>
      renderPeople(
        state
      )
  );

  $("#people-role-filter").addEventListener(
    "change",
    () =>
      renderPeople(
        state
      )
  );

  $("#class-search").addEventListener(
    "input",
    () =>
      renderClasses(
        state
      )
  );

  $("#class-shift-filter").addEventListener(
    "change",
    () =>
      renderClasses(
        state
      )
  );

  $("#grade-class-filter").addEventListener(
    "change",
    () =>
      renderGrades(
        state
      )
  );

  $("#grade-term-filter").addEventListener(
    "change",
    () =>
      renderGrades(
        state
      )
  );

  $("#attendance-class-filter").addEventListener(
    "change",
    () =>
      renderAttendance(
        state
      )
  );

  $("#attendance-date-filter").addEventListener(
    "change",
    () =>
      renderAttendance(
        state
      )
  );

  $("#grade-student-select").addEventListener(
    "change",
    () =>
      updateSubjectSelectForStudent(
        state,
        "#grade-student-select",
        "#grade-subject-select"
      )
  );

  $("#attendance-student-select").addEventListener(
    "change",
    () =>
      updateSubjectSelectForStudent(
        state,
        "#attendance-student-select",
        "#attendance-subject-select"
      )
  );

  $("#assignment-class-select").addEventListener(
    "change",
    () =>
      updateAssignmentSubjectSelect(
        state
      )
  );

  $("#assignment-teacher-select").addEventListener(
    "change",
    () =>
      updateAssignmentSubjectSelect(
        state
      )
  );

  $("#confirm-cancel").addEventListener(
    "click",
    () =>
      $("#confirm-dialog").close()
  );

  $("#confirm-action").addEventListener(
    "click",
    async () => {
      const callback =
        state.confirmCallback;

      $("#confirm-dialog").close();

      state.confirmCallback =
        null;

      if (callback) {
        await callback();
      }
    }
  );

  document.addEventListener(
    "click",
    async (event) => {
      const navigateButton =
        event.target.closest(
          "[data-navigate]"
        );

      if (navigateButton) {
        navigateTo(
          state,
          navigateButton.dataset.navigate
        );
      }

      const deletePersonButton =
        event.target.closest(
          "[data-delete-person]"
        );

      if (deletePersonButton) {
        const person =
          state.people.find(
            (item) =>
              item.id ===
              deletePersonButton
                .dataset
                .deletePerson
          );

        confirmAction(
          state,
          `Excluir ${
            person?.full_name ??
            "esta pessoa"
          }?`,
          "A conta de acesso e todos os registros vinculados serão removidos.",
          () =>
            deletePerson(
              state,
              deletePersonButton
                .dataset
                .deletePerson
            )
        );
      }
const editAccessButton =
  event.target.closest(
    "[data-edit-access]"
  );

if (editAccessButton) {
  const person =
    state.people.find(
      (item) =>
        item.id ===
        editAccessButton.dataset.editAccess
    );

  if (person) {
    openAccessDialog(person);
  }
}
      const editGradeButton =
        event.target.closest(
          "[data-edit-grade]"
        );

      if (editGradeButton) {
        openGradeDialog(
          state,
          state.grades.find(
            (item) =>
              item.id ===
              editGradeButton
                .dataset
                .editGrade
          )
        );
      }

      const deleteGradeButton =
        event.target.closest(
          "[data-delete-grade]"
        );

      if (deleteGradeButton) {
        confirmAction(
          state,
          "Excluir esta nota?",
          "O lançamento será removido do boletim do aluno.",
          () =>
            deleteGrade(
              state,
              deleteGradeButton
                .dataset
                .deleteGrade
            )
        );
      }

      const editAttendanceButton =
        event.target.closest(
          "[data-edit-attendance]"
        );

      if (editAttendanceButton) {
        openAttendanceDialog(
          state,
          state.attendance.find(
            (item) =>
              item.id ===
              editAttendanceButton
                .dataset
                .editAttendance
          )
        );
      }

      const deleteAttendanceButton =
        event.target.closest(
          "[data-delete-attendance]"
        );

      if (
        deleteAttendanceButton
      ) {
        confirmAction(
          state,
          "Excluir este registro?",
          "A frequência do aluno será recalculada.",
          () =>
            deleteAttendance(
              state,
              deleteAttendanceButton
                .dataset
                .deleteAttendance
            )
        );
      }

      const deleteAssignmentButton =
        event.target.closest(
          "[data-delete-assignment]"
        );

      if (
        deleteAssignmentButton
      ) {
        confirmAction(
          state,
          "Remover este vínculo?",
          "O professor deixará de acessar essa turma e disciplina.",
          () =>
            deleteAssignment(
              state,
              deleteAssignmentButton
                .dataset
                .deleteAssignment
            )
        );
      }
    }
  );
}

async function loadAllData(state) {
  const {
    supabase,
    profile
  } = state;

  const [
    cursosR,
    turmasR,
    disciplinasR,
    perfisR,
    alunosR,
    professoresR,
    funcionariosR,
    notasR,
    frequenciaR,
    atribuicoesR
  ] =
    await Promise.all([
      supabase
        .from("cursos")
        .select(
          "id,codigo,nome"
        )
        .order("nome"),

      supabase
        .from("turmas")
        .select(
          "id,curso_id,nome,modulo,turno,ano_letivo,sala"
        )
        .order("nome"),

      supabase
        .from("disciplinas")
        .select(
          "id,curso_id,codigo,nome,carga_horaria"
        )
        .order("nome"),

      supabase
        .from("perfis")
        .select(
          "id,nome_completo,email,tipo_usuario,situacao"
        )
        .order(
          "nome_completo"
        ),

      supabase
        .from("alunos")
        .select(
          "id,perfil_id,matricula,turma_id,nome_responsavel,data_nascimento"
        )
        .order(
          "matricula"
        ),

      supabase
        .from("professores")
        .select(
          "id,perfil_id,matricula,especialidade"
        )
        .order(
          "matricula"
        ),

      supabase
        .from("funcionarios")
        .select(
          "id,perfil_id,matricula,cargo,departamento"
        )
        .order(
          "matricula"
        ),

      gradesQuery(
        supabase
      ),

      attendanceQuery(
        supabase
      ),

      supabase
        .from(
          "atribuicoes_professores"
        )
        .select(
          "id,professor_id,turma_id,disciplina_id,criado_em"
        )
        .order(
          "criado_em",
          {
            ascending: false
          }
        )
    ]);

  const results = {
    cursos: cursosR,
    turmas: turmasR,
    disciplinas: disciplinasR,
    perfis: perfisR,
    alunos: alunosR,
    professores: professoresR,
    funcionarios: funcionariosR,
    notas: notasR,
    frequencia: frequenciaR,
    atribuicoes: atribuicoesR
  };

  Object.entries(
    results
  ).forEach(
    ([name, result]) => {
      if (result.error) {
        console.error(
          `Erro ao carregar ${name}:`,
          result.error
        );
      }
    }
  );

  state.courses =
    (cursosR.data ?? [])
      .map(
        (x) => ({
                    id: x.id,
          code: x.codigo,
          name: x.nome
        })
      );

  const courseMap =
    new Map(
      state.courses.map(
        (x) => [
          x.id,
          x
        ]
      )
    );

  state.classes =
    (turmasR.data ?? [])
      .map(
        (x) => ({
          id: x.id,
          course_id:
            x.curso_id,
          name:
            x.nome,
          module:
            x.modulo,
          shift:
            x.turno,
          school_year:
            x.ano_letivo,
          room:
            x.sala,
          courses:
            courseMap.get(
              x.curso_id
            ) ??
            null
        })
      );

  const classMap =
    new Map(
      state.classes.map(
        (x) => [
          x.id,
          x
        ]
      )
    );

  state.subjects =
    (disciplinasR.data ?? [])
      .map(
        (x) => ({
          id: x.id,
          course_id:
            x.curso_id,
          code:
            x.codigo,
          name:
            x.nome,
          workload:
            x.carga_horaria
        })
      );

  const subjectMap =
    new Map(
      state.subjects.map(
        (x) => [
          x.id,
          x
        ]
      )
    );

  const peopleBase =
    (perfisR.data ?? [])
      .map(
        (x) => ({
          id: x.id,
          full_name:
            x.nome_completo,
          email:
            x.email,
          role:
            x.tipo_usuario,
          status:
            x.situacao
        })
      );

  const profileMap =
    new Map(
      peopleBase.map(
        (x) => [
          x.id,
          x
        ]
      )
    );

  if (
    profile?.id &&
    !profileMap.has(
      profile.id
    )
  ) {
    profileMap.set(
      profile.id,
      profile
    );
  }

  const registeredProfileIds =
    new Set(
      [
        ...(perfisR.data ?? [])
          .map(
            (x) =>
              x.id
          ),

        ...(alunosR.data ?? [])
          .map(
            (x) =>
              x.perfil_id
          ),

        ...(professoresR.data ?? [])
          .map(
            (x) =>
              x.perfil_id
          ),

        ...(funcionariosR.data ?? [])
          .map(
            (x) =>
              x.perfil_id
          ),

        profile?.id
      ]
        .filter(Boolean)
    );

  state.peopleCount =
    profile.role ===
    "funcionario"
      ? registeredProfileIds.size
      : 0;

  state.students =
    (alunosR.data ?? [])
      .map(
        (x) => ({
          id:
            x.id,
          profile_id:
            x.perfil_id,
          registration:
            x.matricula,
          class_id:
            x.turma_id,
          guardian_name:
            x.nome_responsavel,
          birth_date:
            x.data_nascimento,
          profiles:
            profileMap.get(
              x.perfil_id
            ) ??
            null,
          classes:
            classMap.get(
              x.turma_id
            ) ??
            null
        })
      );

  const studentMap =
    new Map(
      state.students.map(
        (x) => [
          x.id,
          x
        ]
      )
    );

  const teachers =
    (professoresR.data ?? [])
      .map(
        (x) => ({
          id:
            x.id,
          profile_id:
            x.perfil_id,
          registration:
            x.matricula,
          specialty:
            x.especialidade
        })
      );

  const employees =
    (funcionariosR.data ?? [])
      .map(
        (x) => ({
          id:
            x.id,
          profile_id:
            x.perfil_id,
          registration:
            x.matricula,
          job_title:
            x.cargo,
          department:
            x.departamento
        })
      );

  state.people =
    profile.role ===
    "funcionario"
      ? peopleBase.map(
          (p) => ({
            ...p,

            students:
              state.students.filter(
                (x) =>
                  x.profile_id ===
                  p.id
              ),

            teachers:
              teachers.filter(
                (x) =>
                  x.profile_id ===
                  p.id
              ),

            employees:
              employees.filter(
                (x) =>
                  x.profile_id ===
                  p.id
              )
          })
        )
      : [];

  state.grades =
    (notasR.data ?? [])
      .map(
        (x) => ({
          id:
            x.id,
          student_id:
            x.aluno_id,
          subject_id:
            x.disciplina_id,
          teacher_id:
            x.professor_id,
          term:
            x.bimestre,
          assessment:
            x.avaliacao,
          score:
            x.nota,
          weight:
            x.peso,
          created_at:
            x.criado_em,
          students:
            studentMap.get(
              x.aluno_id
            ) ??
            null,
          subjects:
            subjectMap.get(
              x.disciplina_id
            ) ??
            null
        })
      );

  state.attendance =
    (frequenciaR.data ?? [])
      .map(
        (x) => ({
          id:
            x.id,
          student_id:
            x.aluno_id,
          subject_id:
            x.disciplina_id,
          teacher_id:
            x.professor_id,
          attendance_date:
            x.data_aula,
          status:
            x.situacao,
          notes:
            x.observacoes,
          students:
            studentMap.get(
              x.aluno_id
            ) ??
            null,
          subjects:
            subjectMap.get(
              x.disciplina_id
            ) ??
            null
        })
      );

  state.teacherAssignments =
    (atribuicoesR.data ?? [])
      .map(
        (x) => ({
          id:
            x.id,
          teacher_id:
            x.professor_id,
          class_id:
            x.turma_id,
          subject_id:
            x.disciplina_id,
          profiles:
            profileMap.get(
              x.professor_id
            ) ??
            null,
          classes:
            classMap.get(
              x.turma_id
            ) ??
            null,
          subjects:
            subjectMap.get(
              x.disciplina_id
            ) ??
            null
        })
      );

  populateSelects(
    state
  );

  renderCurrentData(
    state
  );
}

function gradesQuery(supabase) {
  return supabase
    .from("notas")
    .select(
      "id,aluno_id,disciplina_id,professor_id,bimestre,avaliacao,nota,peso,criado_em"
    )
    .order(
      "criado_em",
      {
        ascending: false
      }
    );
}

function attendanceQuery(supabase) {
  return supabase
    .from("frequencia")
    .select(
      "id,aluno_id,disciplina_id,professor_id,data_aula,situacao,observacoes,criado_em"
    )
    .order(
      "data_aula",
      {
        ascending: false
      }
    );
}

function renderCurrentData(state) {
  renderDashboard(
    state
  );

  if (
    state.profile.role ===
    "funcionario"
  ) {
    renderPeople(
      state
    );

    renderAssignments(
      state
    );
  }

  if (
    state.profile.role !==
    "aluno"
  ) {
    renderClasses(
      state
    );

    renderGrades(
      state
    );

    renderAttendance(
      state
    );

    renderRollCallRoster(
      state
    );
  } else {
    renderReport(
      state
    );

    renderStudentAttendance(
      state
    );
  }

  refreshIcons();
}

function renderDashboard(state) {
  const {
    role,
    full_name
  } =
    state.profile;

  const firstName =
    full_name
      .split(" ")[0];

  $("#welcome-title").textContent =
    `Olá, ${firstName}!`;

  $("#today-label").textContent =
    new Intl.DateTimeFormat(
      "pt-BR",
      {
        weekday:
          "long",
        day:
          "2-digit",
        month:
          "long"
      }
    )
      .format(
        new Date()
      );

  $("#welcome-subtitle").textContent =
    role === "aluno"
      ? "Veja como estão suas notas e sua frequência."
      : role === "professor"
        ? "Confira seus lançamentos e turmas disponíveis."
        : "Acompanhe os principais números da escola.";

  const metrics =
    role === "aluno"
      ? studentMetrics(
          state
        )
      : managementMetrics(
          state
        );

  $("#metric-grid").innerHTML =
    metrics
      .map(
        metricCard
      )
      .join("");

  if (
    role === "aluno"
  ) {
    renderStudentPerformance(
      state
    );
  } else {
    renderManagementPerformance(
      state
    );
  }

  const actions =
    role === "aluno"
      ? [
          [
            "notebook-tabs",
            "Meu boletim",
            "Consultar médias",
            "boletim"
          ],
          [
            "calendar-check-2",
            "Minha frequência",
            "Ver presenças e faltas",
            "minha-frequencia"
          ]
        ]
      : role === "professor"
        ? [
            [
              "clipboard-pen-line",
              "Lançar nota",
              "Registrar uma avaliação",
              "notas"
            ],
            [
              "calendar-days",
              "Fazer chamada",
              "Registrar frequência",
              "frequencia"
            ],
            [
              "school",
              "Ver turmas",
              "Consultar alunos",
              "turmas"
            ]
          ]
        : [
            [
              "user-plus",
              "Cadastrar pessoa",
              "Criar um novo acesso",
              "pessoas"
            ],
            [
              "school",
              "Organizar turmas",
              "Cursos e períodos",
              "turmas"
            ],
            [
              "clipboard-pen-line",
              "Consultar notas",
              "Desempenho acadêmico",
              "notas"
            ]
          ];

  $("#quick-actions").innerHTML =
    actions
      .map(
        (
          [
            icon,
            title,
            detail,
            view
          ]
        ) =>
          `
            <button
              class="quick-action"
              type="button"
              data-navigate="${view}"
            >
              <span>
                <i data-lucide="${icon}"></i>
              </span>

              <span>
                <strong>
                  ${title}
                </strong>

                <small>
                  ${detail}
                </small>
              </span>
            </button>
          `
      )
      .join("");
}

function studentMetrics(state) {
  const scores =
    state.grades.map(
      (grade) =>
        Number(
          grade.score
        )
    );

  const average =
    scores.length
      ? scores.reduce(
          (
            sum,
            value
          ) =>
            sum +
            value,
          0
        ) /
        scores.length
      : 0;

  const total =
    state.attendance.length;

  const present =
    state.attendance
      .filter(
        (item) =>
          item.status ===
          "presente"
      )
      .length;

  const frequency =
    total
      ? (
          present /
          total
        ) *
        100
      : 0;

  const absences =
    state.attendance
      .filter(
        (item) =>
          item.status ===
          "falta"
      )
      .length;

  const className =
    state.students[0]
      ?.classes
      ?.name ??
    "Sem turma";

  return [
    {
      label:
        "Média geral",
      value:
        scores.length
          ? average
              .toFixed(1)
          : "—",
      icon:
        "chart-no-axes-combined",
      tone:
        ""
    },
    {
      label:
        "Frequência",
      value:
        total
          ? `${frequency.toFixed(0)}%`
          : "—",
      icon:
        "calendar-check",
      tone:
        "success"
    },
    {
      label:
        "Faltas",
      value:
        absences,
      icon:
        "calendar-x",
      tone:
        "warning"
    },
    {
      label:
        "Turma",
      value:
        className,
      icon:
        "school",
      tone:
        "purple"
    }
  ];
}

function managementMetrics(state) {
  const teacherStudents =
    state.profile.role ===
    "professor"
      ? getTeacherVisibleStudents(
          state
        )
      : state.students;

  const peopleCount =
    state.profile.role ===
    "funcionario"
      ? state.peopleCount
      : teacherStudents.length;

  const classCount =
    state.profile.role ===
    "professor"
      ? getTeacherClassIds(
          state
        ).size
      : state.classes.length;

  const today =
    isoDate(
      new Date()
    );

  const todayAttendance =
    state.attendance
      .filter(
        (item) =>
          item.attendance_date ===
          today
      )
      .length;

  return [
    {
      label:
        state.profile.role ===
        "funcionario"
          ? "Pessoas cadastradas"
          : "Alunos disponíveis",
      value:
        peopleCount,
      icon:
        "users",
      tone:
        ""
    },
    {
      label:
        "Turmas",
      value:
        classCount,
      icon:
        "school",
      tone:
        "purple"
    },
    {
      label:
        "Notas lançadas",
      value:
        state.grades.length,
      icon:
        "notebook-pen",
      tone:
        "success"
    },
    {
      label:
        "Chamadas hoje",
      value:
        todayAttendance,
      icon:
        "calendar-days",
      tone:
        "warning"
    }
  ];
}

function metricCard({
  label,
  value,
  icon,
  tone
}) {
  return `
    <article class="metric-card">
      <span class="metric-icon ${tone}">
        <i data-lucide="${icon}"></i>
      </span>

      <span class="metric-copy">
        <span>
          ${escapeHTML(label)}
        </span>

        <strong
          title="${escapeHTML(String(value))}"
        >
          ${escapeHTML(String(value))}
        </strong>
      </span>
    </article>
  `;
}

function renderStudentPerformance(state) {
  const grouped =
    groupBy(
      state.grades,
      (grade) =>
        grade.subjects
          ?.name ??
        "Disciplina"
    );

  const rows =
    Object.entries(
      grouped
    )
      .map(
        (
          [
            name,
            grades
          ]
        ) => {
          const average =
            grades.reduce(
              (
                sum,
                grade
              ) =>
                sum +
                Number(
                  grade.score
                ),
              0
            ) /
            grades.length;

          return {
            name,
            average
          };
        }
      )
      .sort(
        (
          a,
          b
        ) =>
          b.average -
          a.average
      )
      .slice(
        0,
        5
      );

  $("#performance-content").innerHTML =
    rows.length
      ? `
        <div class="performance-bars">
          ${
            rows
              .map(
                ({
                  name,
                  average
                }) =>
                  `
                    <div class="performance-row">
                      <span
                        title="${escapeHTML(name)}"
                      >
                        ${escapeHTML(name)}
                      </span>

                      <div class="progress-track">
                        <i
                          style="width:${Math.min(
                            100,
                            average * 10
                          )}%"
                        ></i>
                      </div>

                      <strong>
                        ${average.toFixed(1)}
                      </strong>
                    </div>
                  `
              )
              .join("")
          }
        </div>
      `
      : `
        <div class="performance-empty">
          <p>
            Suas notas aparecerão aqui depois do primeiro lançamento.
          </p>
        </div>
      `;
}

function renderManagementPerformance(state) {
  const courseCounts =
    state.classes.reduce(
      (
        acc,
        item
      ) => {
        const code =
          item.courses
            ?.code ??
          "Outro";

        acc[code] =
          (
            acc[code] ??
            0
          ) +
          1;

        return acc;
      },
      {}
    );

  const max =
    Math.max(
      ...Object.values(
        courseCounts
      ),
      1
    );

  const rows =
      Object.entries(
      courseCounts
    )
      .sort(
        (
          a,
          b
        ) =>
          b[1] -
          a[1]
      );

  $("#performance-content").innerHTML =
    rows.length
      ? `
        <div class="performance-bars">
          ${
            rows
              .map(
                (
                  [
                    name,
                    amount
                  ]
                ) =>
                  `
                    <div class="performance-row">
                      <span>
                        ${escapeHTML(name)}
                      </span>

                      <div class="progress-track">
                        <i
                          style="width:${
                            (
                              amount /
                              max
                            ) *
                            100
                          }%"
                        ></i>
                      </div>

                      <strong>
                        ${amount}
                      </strong>
                    </div>
                  `
              )
              .join("")
          }
        </div>
      `
      : `
        <div class="performance-empty">
          <p>
            Cadastre turmas para visualizar a distribuição dos cursos.
          </p>
        </div>
      `;
}

function renderPeople(state) {
  const query =
    normalize(
      $("#people-search").value
    );

  const role =
    $("#people-role-filter").value;

  const filtered =
    state.people.filter(
      (person) => {
        const specialized =
          getSpecializedProfile(
            person
          );

        const haystack =
          normalize(
            `${
              person.full_name
            } ${
              person.email
            } ${
              specialized?.registration ??
              ""
            }`
          );

        return (
          (
            role ===
              "todos" ||
            person.role ===
              role
          ) &&
          haystack.includes(
            query
          )
        );
      }
    );

  const body =
    $("#people-table-body");

  body.innerHTML =
    filtered
      .map(
        (person) => {
          const specialized =
            getSpecializedProfile(
              person
            );

          const place =
            person.role ===
            "aluno"
              ? specialized
                  ?.classes
                  ?.name
              : person.role ===
                  "professor"
                ? specialized
                    ?.specialty
                : `${
                    specialized
                      ?.job_title ??
                    "—"
                  }${
                    specialized
                      ?.department
                      ? ` · ${specialized.department}`
                      : ""
                  }`;

          return `
            <tr>
              <td>
                <div class="person-cell">
                  <span class="avatar">
                    ${initials(person.full_name)}
                  </span>

                  <span class="person-copy">
                    <strong>
                      ${escapeHTML(person.full_name)}
                    </strong>

                    <span>
                      ${escapeHTML(person.email)}
                    </span>
                  </span>
                </div>
              </td>

              <td>
                <span
                  class="pill role-pill role-${person.role}"
                >
                  ${escapeHTML(roleLabel(person.role))}
                </span>
              </td>

              <td>
                ${escapeHTML(
                  specialized
                    ?.registration ??
                  "—"
                )}
              </td>

              <td>
                ${escapeHTML(
                  place ??
                  "—"
                )}
              </td>

              <td>
                <span
                  class="status-badge ${
                    person.status ===
                    "ativo"
                      ? "status-success"
                      : "status-neutral"
                  }"
                >
                  ${
                    person.status ===
                    "ativo"
                      ? "Ativo"
                      : "Inativo"
                  }
                </span>
              </td>

              <td>
                <div class="table-actions">
                ${
  ["aluno", "professor"].includes(person.role)
    ? `
      <button
        class="table-action"
        type="button"
        data-edit-access="${person.id}"
        aria-label="Alterar acesso de ${escapeHTML(person.full_name)}"
        title="Alterar e-mail e senha"
      >
        <i data-lucide="key-round"></i>
      </button>
    `
    : ""
}
                  <button
                    class="table-action danger"
                    type="button"
                    data-delete-person="${person.id}"
                    aria-label="Excluir ${escapeHTML(person.full_name)}"
                  >
                    <i data-lucide="trash-2"></i>
                  </button>
                </div>
              </td>
            </tr>
          `;
        }
      )
      .join("");

  toggleEmpty(
    body,
    $("#people-empty"),
    filtered.length ===
      0
  );

  refreshIcons();
}

function renderClasses(state) {
  const query =
    normalize(
      $("#class-search").value
    );

  const shift =
    $("#class-shift-filter").value;

  const teacherClassIds =
    state.profile.role ===
    "professor"
      ? getTeacherClassIds(
          state
        )
      : null;

  const filtered =
    state.classes.filter(
      (item) =>
        (
          !teacherClassIds ||
          teacherClassIds.has(
            item.id
          )
        ) &&
        (
          shift ===
            "todos" ||
          item.shift ===
            shift
        ) &&
        normalize(
          `${
            item.name
          } ${
            item.courses
              ?.name
          } ${
            item.courses
              ?.code
          }`
        ).includes(
          query
        )
    );

  $("#class-grid").innerHTML =
    filtered
      .map(
        (item) => {
          const count =
            state.students
              .filter(
                (student) =>
                  student
                    .class_id ===
                  item.id
              )
              .length;

          return `
            <article class="class-card">
              <div class="class-card-top"></div>

              <div class="class-card-body">
                <div class="class-card-head">
                  <div>
                    <h3>
                      ${escapeHTML(item.name)}
                    </h3>

                    <p>
                      ${escapeHTML(
                        item.courses
                          ?.name ??
                        "Curso"
                      )}
                    </p>
                  </div>

                  <span class="pill role-aluno">
                    ${escapeHTML(
                      item.courses
                        ?.code ??
                      "—"
                    )}
                  </span>
                </div>

                <div class="class-meta">
                  <span>
                    <i data-lucide="clock-3"></i>
                    ${escapeHTML(
                      shiftLabel(
                        item.shift
                      )
                    )}
                  </span>

                  <span>
                    <i data-lucide="layers-3"></i>
                    ${item.module}º módulo
                  </span>

                  <span>
                    <i data-lucide="users"></i>
                    ${count}
                    aluno${
                      count === 1
                        ? ""
                        : "s"
                    }
                  </span>

                  <span>
                    <i data-lucide="map-pin"></i>
                    ${escapeHTML(
                      item.room ||
                      "Sala não definida"
                    )}
                  </span>
                </div>
              </div>
            </article>
          `;
        }
      )
      .join("");

  $("#class-empty")
    .classList
    .toggle(
      "hidden",
      filtered.length !==
        0
    );

  refreshIcons();
}

function renderAssignments(state) {
  const body =
    $("#assignments-table-body");

  body.innerHTML =
    state.teacherAssignments
      .map(
        (item) => `
          <tr>
            <td>
              ${escapeHTML(
                item.profiles
                  ?.full_name ??
                "Professor"
              )}
            </td>

            <td>
              ${escapeHTML(
                item.classes
                  ?.name ??
                "—"
              )}
            </td>

            <td>
              ${escapeHTML(
                item.subjects
                  ?.name ??
                "—"
              )}
            </td>

            <td>
              <div class="table-actions">
                <button
                  class="table-action danger"
                  type="button"
                  data-delete-assignment="${item.id}"
                  aria-label="Remover vínculo"
                >
                  <i data-lucide="unlink"></i>
                </button>
              </div>
            </td>
          </tr>
        `
      )
      .join("");

  body
    .closest(
      ".table-scroll"
    )
    .classList
    .toggle(
      "hidden",
      state
        .teacherAssignments
        .length ===
      0
    );

  $("#assignments-empty")
    .classList
    .toggle(
      "hidden",
      state
        .teacherAssignments
        .length !==
      0
    );

  refreshIcons();
}

function renderGrades(state) {
  const classId =
    $("#grade-class-filter").value;

  const term =
    $("#grade-term-filter").value;

  const filtered =
    state.grades.filter(
      (grade) =>
        (
          classId ===
            "todos" ||
          grade.students
            ?.class_id ===
            classId
        ) &&
        (
          term ===
            "todos" ||
          String(
            grade.term
          ) ===
            term
        )
    );

  const body =
    $("#grades-table-body");

  body.innerHTML =
    filtered
      .map(
        (grade) => `
          <tr>
            <td>
              ${escapeHTML(
                grade.students
                  ?.profiles
                  ?.full_name ??
                "Aluno"
              )}
            </td>

            <td>
              ${escapeHTML(
                grade.subjects
                  ?.name ??
                "—"
              )}
            </td>

            <td>
              ${escapeHTML(
                grade.assessment
              )}
            </td>

            <td>
              ${grade.term}º
            </td>

            <td>
              <span class="score">
                ${Number(
                  grade.score
                ).toFixed(1)}
              </span>
            </td>

            <td>
              <span
                class="status-badge ${
                  Number(
                    grade.score
                  ) >= 6
                    ? "status-success"
                    : "status-warning"
                }"
              >
                ${
                  Number(
                    grade.score
                  ) >= 6
                    ? "Na média"
                    : "Atenção"
                }
              </span>
            </td>

            <td>
              <div class="table-actions">
                <button
                  class="table-action"
                  type="button"
                  data-edit-grade="${grade.id}"
                  aria-label="Editar nota"
                >
                  <i data-lucide="pencil"></i>
                </button>

                <button
                  class="table-action danger"
                  type="button"
                  data-delete-grade="${grade.id}"
                  aria-label="Excluir nota"
                >
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </td>
          </tr>
        `
      )
      .join("");

  toggleEmpty(
    body,
    $("#grades-empty"),
    filtered.length ===
      0
  );

  refreshIcons();
}

function renderAttendance(state) {
  const classId =
    $("#attendance-class-filter").value;

  const date =
    $("#attendance-date-filter").value;

  const filtered =
    state.attendance.filter(
      (record) =>
        (
          classId ===
            "todos" ||
          record.students
            ?.class_id ===
            classId
        ) &&
        (
          !date ||
          record
            .attendance_date ===
            date
        )
    );

  const body =
    $("#attendance-table-body");

  body.innerHTML =
    filtered
      .map(
        (record) => `
          <tr>
            <td>
              ${formatDate(record.attendance_date)}
            </td>

            <td>
              ${escapeHTML(
                record.students
                  ?.profiles
                  ?.full_name ??
                "Aluno"
              )}
            </td>

            <td>
              ${escapeHTML(
                record.students
                  ?.classes
                  ?.name ??
                "—"
              )}
            </td>

            <td>
              ${escapeHTML(
                record.subjects
                  ?.name ??
                "—"
              )}
            </td>

            <td>
              <span
                class="status-badge ${attendanceTone(record.status)}"
              >
                ${escapeHTML(
                  attendanceLabel(
                    record.status
                  )
                )}
              </span>
            </td>

            <td>
              ${escapeHTML(
                record.notes ||
                "—"
              )}
            </td>

            <td>
              <div class="table-actions">
                <button
                  class="table-action"
                  type="button"
                  data-edit-attendance="${record.id}"
                  aria-label="Editar frequência"
                >
                  <i data-lucide="pencil"></i>
                </button>

                <button
                  class="table-action danger"
                  type="button"
                  data-delete-attendance="${record.id}"
                  aria-label="Excluir frequência"
                >
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </td>
          </tr>
        `
      )
      .join("");

  toggleEmpty(
    body,
    $("#attendance-empty"),
    filtered.length ===
      0
  );

  refreshIcons();
}

function renderReport(state) {
  const grouped =
    groupBy(
      state.grades,
      (grade) =>
        grade.subjects
          ?.name ??
        "Disciplina"
    );

  const rows =
    Object.entries(
      grouped
    )
      .map(
        (
          [
            subject,
            grades
          ]
        ) => {
          const terms =
            [
              1,
              2,
              3,
              4
            ]
              .map(
                (term) => {
                  const values =
                    grades
                      .filter(
                        (grade) =>
                          grade.term ===
                          term
                      )
                      .map(
                        (grade) =>
                          Number(
                            grade.score
                          )
                      );

                  return values.length
                    ? values.reduce(
                        (
                          sum,
                          value
                        ) =>
                          sum +
                          value,
                        0
                      ) /
                      values.length
                    : null;
                }
              );

          const valid =
            terms.filter(
              (value) =>
                value !==
                null
            );

          const average =
            valid.length
              ? valid.reduce(
                  (
                    sum,
                    value
                  ) =>
                    sum +
                    value,
                  0
                ) /
                valid.length
              : null;

          return {
            subject,
            terms,
            average
          };
        }
      )
      .sort(
        (
          a,
          b
        ) =>
          a.subject.localeCompare(
            b.subject
          )
      );

  const body =
    $("#report-table-body");

  body.innerHTML =
    rows
      .map(
        (row) => `
          <tr>
            <td>
              <strong>
                ${escapeHTML(row.subject)}
              </strong>
            </td>

            ${
              row.terms
                .map(
                  (value) => `
                    <td>
                      ${
                        value === null
                          ? "—"
                          : value.toFixed(1)
                      }
                    </td>
                  `
                )
                .join("")
            }

            <td>
              <span class="score">
                ${
                  row.average === null
                    ? "—"
                    : row.average.toFixed(1)
                }
              </span>
            </td>

            <td>
              ${
                row.average ===
                  null
                  ? "—"
                  : `
                    <span
                      class="status-badge ${
                        row.average >= 6
                          ? "status-success"
                          : "status-warning"
                      }"
                    >
                      ${
                        row.average >= 6
                          ? "Aprovado"
                          : "Em recuperação"
                      }
                    </span>
                  `
              }
            </td>
          </tr>
        `
      )
      .join("");

  toggleEmpty(
    body,
    $("#report-empty"),
    rows.length ===
      0
  );

  const averages =
    rows
      .map(
        (row) =>
          row.average
      )
      .filter(
        (value) =>
          value !==
          null
      );

  const general =
    averages.length
      ? averages.reduce(
          (
            sum,
            value
          ) =>
            sum +
            value,
          0
        ) /
        averages.length
      : null;

  $("#report-summary").innerHTML =
    [
      {
        label:
          "Média geral",
        value:
          general === null
            ? "—"
            : general
                .toFixed(1),
        icon:
          "chart-no-axes-combined",
        tone:
          ""
      },
      {
        label:
          "Disciplinas",
        value:
          rows.length,
        icon:
          "library-big",
        tone:
          "purple"
      },
      {
        label:
          "Situação",
        value:
          general === null
            ? "Aguardando"
            : general >= 6
              ? "Na média"
              : "Atenção",
        icon:
          general !== null &&
          general >= 6
            ? "circle-check"
            : "triangle-alert",
        tone:
          general !== null &&
          general >= 6
            ? "success"
            : "warning"
      }
    ]
      .map(
        metricCard
      )
      .join("");

  refreshIcons();
}

function renderStudentAttendance(state) {
  const grouped =
    groupBy(
      state.attendance,
      (record) =>
        record.subjects
          ?.name ??
        "Disciplina"
    );

  const cards =
      Object.entries(
      grouped
    )
      .map(
        (
          [
            subject,
            records
          ]
        ) => {
          const present =
            records
              .filter(
                (record) =>
                  record.status ===
                  "presente"
              )
              .length;

          const justified =
            records
              .filter(
                (record) =>
                  record.status ===
                  "justificada"
              )
              .length;

          const absences =
            records
              .filter(
                (record) =>
                  record.status ===
                  "falta"
              )
              .length;

          const frequency =
            records.length
              ? (
                  (
                    present +
                    justified
                  ) /
                  records.length
                ) *
                100
              : 0;

          return {
            subject,
            present,
            absences,
            justified,
            frequency
          };
        }
      );

  const all =
    state.attendance;

  const validPresence =
    all
      .filter(
        (record) =>
          record.status !==
          "falta"
      )
      .length;

  const totalFrequency =
    all.length
      ? (
          validPresence /
          all.length
        ) *
        100
      : 0;

  $("#student-attendance-summary").innerHTML =
    [
      {
        label:
          "Frequência geral",
        value:
          all.length
            ? `${totalFrequency.toFixed(1)}%`
            : "—",
        icon:
          "calendar-check",
        tone:
          "success"
      },
      {
        label:
          "Presenças",
        value:
          all
            .filter(
              (item) =>
                item.status ===
                "presente"
            )
            .length,
        icon:
          "circle-check",
        tone:
          ""
      },
      {
        label:
          "Faltas",
        value:
          all
            .filter(
              (item) =>
                item.status ===
                "falta"
            )
            .length,
        icon:
          "circle-x",
        tone:
          "warning"
      }
    ]
      .map(
        metricCard
      )
      .join("");

  $("#student-attendance-list").innerHTML =
    cards.length
      ? cards
          .map(
            (item) => `
              <article class="attendance-card">
                <div class="attendance-card-head">
                  <h3>
                    ${escapeHTML(item.subject)}
                  </h3>

                  <span
                    class="status-badge ${
                      item.frequency >= 75
                        ? "status-success"
                        : "status-danger"
                    }"
                  >
                    ${item.frequency.toFixed(1)}%
                  </span>
                </div>

                <div class="progress-track">
                  <i
                    style="
                      width:${item.frequency}%;
                      background:${
                        item.frequency >= 75
                          ? "var(--success)"
                          : "var(--danger)"
                      };
                    "
                  ></i>
                </div>

                <div class="attendance-card-meta">
                  <span>
                    ${item.present} presenças
                  </span>

                  <span>
                    ${item.absences} faltas${
                      item.justified
                        ? ` · ${item.justified} justificadas`
                        : ""
                    }
                  </span>
                </div>
              </article>
            `
          )
          .join("")
      : `
        <div class="table-card">
          <div class="empty-state">
            <i data-lucide="calendar-search"></i>

            <h3>
              Nenhuma frequência registrada
            </h3>

            <p>
              Os dados aparecerão após a primeira chamada.
            </p>
          </div>
        </div>
      `;

  refreshIcons();
}

function getTeacherClassIds(state) {
  if (
    state.profile?.role !==
    "professor"
  ) {
    return new Set(
      state.classes.map(
        (item) =>
          item.id
      )
    );
  }

  return new Set(
    state.teacherAssignments
      .filter(
        (item) =>
          item.teacher_id ===
          state.profile.id
      )
      .map(
        (item) =>
          item.class_id
      )
  );
}

function getTeacherVisibleStudents(state) {
  if (
    state.profile?.role !==
    "professor"
  ) {
    return state.students;
  }

  const classIds =
    getTeacherClassIds(
      state
    );

  return state.students
    .filter(
      (student) =>
        classIds.has(
          student.class_id
        )
    );
}

function teacherCanManageStudentSubject(
  state,
  studentId,
  subjectId
) {
  if (
    state.profile?.role !==
    "professor"
  ) {
    return true;
  }

  const student =
    state.students.find(
      (item) =>
        item.id ===
        studentId
    );

  if (!student) {
    return false;
  }

  return state.teacherAssignments.some(
    (item) =>
      item.teacher_id ===
        state.profile.id &&
      item.class_id ===
        student.class_id &&
      item.subject_id ===
        subjectId
  );
}

function setupTeacherSubjectSelect(state) {
  let field =
    $("#person-form [name='specialty']");

  if (!field) {
    return;
  }

  if (
    field.tagName !==
    "SELECT"
  ) {
    const select =
      document.createElement(
        "select"
      );

    select.name =
      "specialty";

    select.id =
      field.id ||
      "person-specialty-select";

    select.className =
      field.className;

    field.replaceWith(
      select
    );

    field =
      select;
  }

  const currentValue =
    field.value;

  const uniqueSubjects =
    [
      ...new Map(
        state.subjects
          .slice()
          .sort(
            (
              a,
              b
            ) =>
              a.name.localeCompare(
                b.name,
                "pt-BR"
              )
          )
          .map(
            (subject) => [
              normalize(
                subject.name
              ),
              subject.name
            ]
          )
      ).values()
    ];

  field.innerHTML =
    `<option value="">Selecione a matéria</option>${
      uniqueSubjects
        .map(
          (name) =>
            `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`
        )
        .join("")
    }`;

  if (
    uniqueSubjects.includes(
      currentValue
    )
  ) {
    field.value =
      currentValue;
  }

  field.required =
    $(
      "#person-form [name='role']"
    ).value ===
    "professor";
}

function updateAssignmentSubjectSelect(state) {
  const teacherId =
    $("#assignment-teacher-select").value;

  const classId =
    $("#assignment-class-select").value;

  const select =
    $("#assignment-subject-select");

  if (
    !teacherId ||
    !classId
  ) {
    select.innerHTML =
      `<option value="">Selecione professor e turma</option>`;

    select.disabled =
      true;

    return;
  }

  const teacher =
    state.people.find(
      (person) =>
        person.id ===
        teacherId
    );

  const specialty =
    getSpecializedProfile(
      teacher
    )?.specialty ??
    "";

  const schoolClass =
    state.classes.find(
      (item) =>
        item.id ===
        classId
    );

  const subjects =
    state.subjects.filter(
      (subject) =>
        subject.course_id ===
          schoolClass?.course_id &&
        normalize(
          subject.name
        ) ===
          normalize(
            specialty
          )
    );

  select.innerHTML =
    `<option value="">Selecione uma disciplina</option>${
      subjects
        .map(
          (subject) =>
            `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`
        )
        .join("")
    }`;

  select.disabled =
    subjects.length ===
    0;

  if (
    subjects.length ===
    1
  ) {
    select.value =
      subjects[0].id;
  }
}

function populateSelects(state) {
  const allClassOptions =
    state.classes
      .map(
        (item) =>
          `<option value="${item.id}">${escapeHTML(item.name)} — ${escapeHTML(
            shiftLabel(
              item.shift
            )
          )}</option>`
      )
      .join("");

  $("#person-class-select").innerHTML =
    `<option value="">Selecione uma turma</option>${allClassOptions}`;

  const teacherClassIds =
    getTeacherClassIds(
      state
    );

  const visibleClasses =
    state.profile?.role ===
    "professor"
      ? state.classes.filter(
          (item) =>
            teacherClassIds.has(
              item.id
            )
        )
      : state.classes;

  const visibleClassOptions =
    visibleClasses
      .map(
        (item) =>
          `<option value="${item.id}">${escapeHTML(item.name)} — ${escapeHTML(
            shiftLabel(
              item.shift
            )
          )}</option>`
      )
      .join("");

  $("#grade-class-filter").innerHTML =
    `<option value="todos">Todas as turmas</option>${visibleClassOptions}`;

  $("#attendance-class-filter").innerHTML =
    `<option value="todos">Todas as turmas</option>${visibleClassOptions}`;

  $("#roll-call-class-select").innerHTML =
    `<option value="">Selecione uma turma</option>${visibleClassOptions}`;

  $("#roll-call-subject-select").innerHTML =
    `<option value="">Selecione primeiro uma turma</option>`;

  $("#roll-call-subject-select").disabled =
    true;

  $("#class-course-select").innerHTML =
    `<option value="">Selecione um curso</option>${
      state.courses
        .map(
          (item) =>
            `<option value="${item.id}">${escapeHTML(item.code)} — ${escapeHTML(item.name)}</option>`
        )
        .join("")
    }`;

  const visibleStudents =
    getTeacherVisibleStudents(
      state
    );

  const studentOptions =
    visibleStudents
      .map(
        (student) =>
          `<option value="${student.id}">${escapeHTML(
            student.profiles
              ?.full_name ??
            student.registration
          )} — ${escapeHTML(
            student.classes
              ?.name ??
            "Sem turma"
          )}</option>`
      )
      .join("");

  $("#grade-student-select").innerHTML =
    `<option value="">Selecione um aluno</option>${studentOptions}`;

  $("#attendance-student-select").innerHTML =
    `<option value="">Selecione um aluno</option>${studentOptions}`;

  $("#grade-subject-select").innerHTML =
    `<option value="">Selecione primeiro um aluno</option>`;

  $("#grade-subject-select").disabled =
    true;

  $("#attendance-subject-select").innerHTML =
    `<option value="">Selecione primeiro um aluno</option>`;

  $("#attendance-subject-select").disabled =
    true;

  $("#assignment-class-select").innerHTML =
    `<option value="">Selecione uma turma</option>${allClassOptions}`;

  $("#assignment-subject-select").innerHTML =
    `<option value="">Selecione professor e turma</option>`;

  $("#assignment-subject-select").disabled =
    true;

  const teacherOptions =
    state.people
      .filter(
        (person) =>
          person.role ===
          "professor"
      )
      .map(
        (person) =>
          `<option value="${person.id}">${escapeHTML(person.full_name)}</option>`
      )
      .join("");

  $("#assignment-teacher-select").innerHTML =
    `<option value="">Selecione um professor</option>${teacherOptions}`;

  setupTeacherSubjectSelect(
    state
  );

  updatePersonFields(
    state
  );
}

async function submitPerson(event, state) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const button =
    $(
      "button[type='submit']",
      form
    );

  const values =
    Object.fromEntries(
      new FormData(
        form
      )
    );

  setFormError(
    $("#person-form-error"),
    ""
  );

  setButtonLoading(
    button,
    true,
    "Cadastrando..."
  );

  const {
    data,
    error
  } =
    await state.supabase.functions.invoke(
      "manage-user",
      {
        body: {
          action:
            "create",
          ...values
        }
      }
    );

  setButtonLoading(
    button,
    false,
    "Cadastrar pessoa"
  );

  if (
    error ||
    data?.error
  ) {
    setFormError(
      $("#person-form-error"),
      data?.error ??
      error?.message ??
      "Não foi possível cadastrar a pessoa."
    );

    return;
  }

  $("#person-dialog").close();

  form.reset();

  updatePersonFields(
    state
  );

  await loadAllData(
    state
  );

  toast(
    "Pessoa cadastrada",
    "A conta já pode acessar o portal.",
    "success"
  );
}

async function deletePerson(state, userId) {
  setLoading(
    true
  );

  const {
    data,
    error
  } =
    await state.supabase.functions.invoke(
      "manage-user",
      {
        body: {
          action:
            "delete",
          user_id:
            userId
        }
      }
    );

  setLoading(
    false
  );

  if (
    error ||
    data?.error
  ) {
    toast(
      "Não foi possível excluir",
      data?.error ??
      error?.message ??
      "Tente novamente.",
      "error"
    );

    return;
  }

  await loadAllData(
    state
  );

  toast(
    "Pessoa excluída",
    "A conta e os dados vinculados foram removidos.",
    "success"
  );
}
function openAccessDialog(person) {
  if (
    !["aluno", "professor"].includes(person.role)
  ) {
    return;
  }

  const form = $("#access-form");

  form.reset();

  form.elements.user_id.value = person.id;
  form.elements.email.value = person.email;

  $("#access-person-avatar").textContent =
    initials(person.full_name);

  $("#access-person-name").textContent =
    person.full_name;

  $("#access-person-role").textContent =
    roleLabel(person.role);

  setFormError(
    $("#access-form-error"),
    ""
  );

  openDialog("access-dialog");
}

async function submitAccessChange(event, state) {
  event.preventDefault();

  const form = event.currentTarget;

  const button = $(
    "button[type='submit']",
    form
  );

  const userId =
    form.elements.user_id.value;

  const email =
    form.elements.email.value
      .trim()
      .toLowerCase();

  const password =
    form.elements.password.value;

  const passwordConfirmation =
    form.elements.password_confirmation.value;

  setFormError(
    $("#access-form-error"),
    ""
  );

  if (
    password &&
    password.length < 6
  ) {
    setFormError(
      $("#access-form-error"),
      "A nova senha precisa ter pelo menos 6 caracteres."
    );

    return;
  }

  if (
    password !== passwordConfirmation
  ) {
    setFormError(
      $("#access-form-error"),
      "As duas senhas não são iguais."
    );

    return;
  }

  setButtonLoading(
    button,
    true,
    "Salvando..."
  );

  const {
    data,
    error
  } = await state.supabase.functions.invoke(
    "manage-user",
    {
      body: {
        action: "update_credentials",
        user_id: userId,
        email,
        password: password || undefined
      }
    }
  );

  setButtonLoading(
    button,
    false,
    "Salvar acesso"
  );

  if (
    error ||
    data?.error
  ) {
    const message =
      await getFunctionErrorMessage(
        error,
        data,
        "Não foi possível alterar o acesso."
      );

    setFormError(
      $("#access-form-error"),
      message
    );

    return;
  }

  $("#access-dialog").close();

  form.reset();

  await loadAllData(state);

  toast(
    "Acesso atualizado",
    data?.message ??
      "Os dados de acesso foram atualizados.",
    "success"
  );
}
async function submitClass(event, state) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const values =
    Object.fromEntries(
      new FormData(
        form
      )
    );

  const course =
    state.courses.find(
      (item) =>
        item.id ===
        values.course_id
    );

  const name =
    `${
      course?.code ??
      "TURMA"
    } ${
      values.module
    } — ${
      shiftLabel(
        values.shift
      )
    }`;

  setFormError(
    $("#class-form-error"),
    ""
  );

  const { error } =
    await state.supabase
      .from(
        "turmas"
      )
      .insert({
        curso_id:
          values.course_id,
        modulo:
          Number(
            values.module
          ),
        turno:
          values.shift,
        ano_letivo:
          Number(
            values.school_year
          ),
        sala:
          values.room ||
          null,
        nome:
          name
      });

  if (error) {
    setFormError(
      $("#class-form-error"),
      error.code ===
        "23505"
        ? "Essa turma já está cadastrada."
        : error.message
    );

    return;
  }

  $("#class-dialog").close();

  await loadAllData(
    state
  );

  toast(
    "Turma criada",
    `${name} foi adicionada ao sistema.`,
    "success"
  );
}

function openGradeDialog(state, grade = null) {
  const form =
    $("#grade-form");

  form.reset();

  setFormError(
    $("#grade-form-error"),
    ""
  );

  $("#grade-subject-select").innerHTML =
    `<option value="">Selecione primeiro um aluno</option>`;

  $("#grade-subject-select").disabled =
    true;

  if (grade) {
    form.id.value =
      grade.id;

    form.student_id.value =
      grade.student_id;

    updateSubjectSelectForStudent(
      state,
      "#grade-student-select",
      "#grade-subject-select"
    );

    form.subject_id.value =
      grade.subject_id;

    form.term.value =
      grade.term;

    form.score.value =
      grade.score;

    form.assessment.value =
      grade.assessment;

    $(
      "h2",
      $("#grade-dialog")
    ).textContent =
      "Editar nota";
  } else {
    form.id.value =
      "";

    $(
      "h2",
      $("#grade-dialog")
    ).textContent =
      "Lançar nota";
  }

  openDialog(
    "grade-dialog"
  );
}

async function submitGrade(event, state) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const values =
    Object.fromEntries(
      new FormData(
        form
      )
    );

  if (
    state.profile.role ===
      "professor" &&
    !teacherCanManageStudentSubject(
      state,
      values.student_id,
      values.subject_id
    )
  ) {
    setFormError(
      $("#grade-form-error"),
      "Você só pode lançar nota para alunos das suas turmas e na matéria atribuída a você."
    );

    return;
  }

  const payload = {
    aluno_id:
      values.student_id,

    disciplina_id:
      values.subject_id,

    bimestre:
      Number(
        values.term
      ),

    nota:
      Number(
        values.score
      ),

    avaliacao:
      values.assessment,

    professor_id:
      state.profile.id
  };

  setFormError(
    $("#grade-form-error"),
    ""
  );

  const query =
    values.id
      ? state.supabase
          .from(
            "notas"
          )
          .update(
            payload
          )
                    .eq(
            "id",
            values.id
          )
      : state.supabase
          .from(
            "notas"
          )
          .insert(
            payload
          );

  const { error } =
    await query;

  if (error) {
    setFormError(
      $("#grade-form-error"),
      error.message
    );

    return;
  }

  $("#grade-dialog").close();

  await loadAllData(
    state
  );

  toast(
    values.id
      ? "Nota atualizada"
      : "Nota lançada",
    "O boletim do aluno já foi atualizado.",
    "success"
  );
}

async function deleteGrade(state, id) {
  const { error } =
    await state.supabase
      .from(
        "notas"
      )
      .delete()
      .eq(
        "id",
        id
      );

  if (error) {
    toast(
      "Erro ao excluir",
      error.message,
      "error"
    );
  } else {
    await loadAllData(
      state
    );

    toast(
      "Nota excluída",
      "O boletim foi atualizado.",
      "success"
    );
  }
}

function getAllowedSubjectsForClass(
  state,
  classId
) {
  const schoolClass =
    state.classes.find(
      (item) =>
        item.id ===
        classId
    );

  if (!schoolClass) {
    return [];
  }

  let subjects =
    state.subjects.filter(
      (item) =>
        item.course_id ===
        schoolClass.course_id
    );

  if (
    state.profile?.role ===
    "professor"
  ) {
    const allowedIds =
      new Set(
        state.teacherAssignments
          .filter(
            (item) =>
              item.teacher_id ===
                state.profile.id &&
              item.class_id ===
                classId
          )
          .map(
            (item) =>
              item.subject_id
          )
      );

    subjects =
      subjects.filter(
        (item) =>
          allowedIds.has(
            item.id
          )
      );
  }

  return subjects.sort(
    (a, b) =>
      a.name.localeCompare(
        b.name,
        "pt-BR"
      )
  );
}

function openRollCall(state) {
  const form =
    $("#roll-call-form");

  const classSelect =
    $("#roll-call-class-select");

  const historyClass =
    $("#attendance-class-filter")
      .value;

  form.reset();

  $("#roll-call-date").value =
    isoDate(
      new Date()
    );

  setFormError(
    $("#roll-call-form-error"),
    ""
  );

  if (
    historyClass !==
      "todos" &&
    [...classSelect.options]
      .some(
        (option) =>
          option.value ===
          historyClass
      )
  ) {
    classSelect.value =
      historyClass;
  } else if (
    classSelect.options.length ===
    2
  ) {
    classSelect.selectedIndex =
      1;
  }

  updateRollCallSubjectSelect(
    state
  );

  renderRollCallRoster(
    state
  );

  navigateTo(
    state,
    "chamada"
  );
}

function updateRollCallSubjectSelect(state) {
  const classId =
    $("#roll-call-class-select")
      .value;

  const select =
    $("#roll-call-subject-select");

  const previousValue =
    select.value;

  const subjects =
    getAllowedSubjectsForClass(
      state,
      classId
    );

  if (!classId) {
    select.innerHTML =
      `<option value="">Selecione primeiro uma turma</option>`;

    select.disabled =
      true;

    return;
  }

  select.innerHTML =
    `<option value="">Selecione uma disciplina</option>${
      subjects
        .map(
          (subject) =>
            `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`
        )
        .join("")
    }`;

  select.disabled =
    subjects.length ===
    0;

  if (
    subjects.some(
      (subject) =>
        subject.id ===
        previousValue
    )
  ) {
    select.value =
      previousValue;
  } else if (
    subjects.length ===
    1
  ) {
    select.value =
      subjects[0].id;
  }
}

function renderRollCallRoster(state) {
  const classId =
    $("#roll-call-class-select")
      .value;

  const subjectId =
    $("#roll-call-subject-select")
      .value;

  const date =
    $("#roll-call-date")
      .value;

  const list =
    $("#roll-call-list");

  const empty =
    $("#roll-call-empty");

  const saveButton =
    $("#save-roll-call-button");

  const markAllButton =
    $("#mark-all-present-button");

  const schoolClass =
    state.classes.find(
      (item) =>
        item.id ===
        classId
    );

  const subject =
    getAllowedSubjectsForClass(
      state,
      classId
    ).find(
      (item) =>
        item.id ===
        subjectId
    );

  if (
    !schoolClass ||
    !subject ||
    !date
  ) {
    list.innerHTML =
      "";

    list.classList.add(
      "hidden"
    );

    empty.classList.remove(
      "hidden"
    );

    empty.innerHTML = `
      <i data-lucide="users"></i>
      <h3>Selecione os dados da aula</h3>
      <p>A lista completa da turma aparecerá aqui.</p>
    `;

    $("#roll-call-title").textContent =
      "Selecione turma, disciplina e data";

    saveButton.disabled =
      true;

    markAllButton.disabled =
      true;

    updateRollCallCounters();
    refreshIcons();
    return;
  }

  const students =
    state.students
      .filter(
        (student) =>
          student.class_id ===
          classId
      )
      .sort(
        (a, b) =>
          (
            a.profiles
              ?.full_name ??
            a.registration ??
            ""
          ).localeCompare(
            b.profiles
              ?.full_name ??
            b.registration ??
            "",
            "pt-BR"
          )
      );

  $("#roll-call-title").textContent =
    `${schoolClass.name} · ${subject.name}`;

  if (
    students.length ===
    0
  ) {
    list.innerHTML =
      "";

    list.classList.add(
      "hidden"
    );

    empty.classList.remove(
      "hidden"
    );

    empty.innerHTML = `
      <i data-lucide="user-x"></i>
      <h3>Nenhum aluno nesta turma</h3>
      <p>Cadastre ou vincule alunos antes de fazer a chamada.</p>
    `;

    saveButton.disabled =
      true;

    markAllButton.disabled =
      true;

    updateRollCallCounters();
    refreshIcons();
    return;
  }

  const existingByStudent =
    new Map(
      state.attendance
        .filter(
          (record) =>
            record.subject_id ===
              subjectId &&
            record.attendance_date ===
              date
        )
        .map(
          (record) => [
            record.student_id,
            record
          ]
        )
    );

  list.innerHTML =
    students
      .map(
        (student, index) => {
          const existing =
            existingByStudent.get(
              student.id
            );

          const status =
            existing?.status ===
            "presente"
              ? "presente"
              : existing
                ? "falta"
                : "presente";

          const name =
            student.profiles
              ?.full_name ??
            student.registration ??
            "Aluno";

          return `
            <div class="roll-call-row" data-student-id="${student.id}" data-status="${status}">
              <span class="roll-call-number">${String(index + 1).padStart(2, "0")}</span>

              <div class="roll-call-student">
                <strong>${escapeHTML(name)}</strong>
                <span>Matrícula: ${escapeHTML(student.registration ?? "Não informada")}</span>
              </div>

              <div class="roll-call-status" role="group" aria-label="Situação de ${escapeHTML(name)}">
                <button
                  class="attendance-choice present${status === "presente" ? " active" : ""}"
                  type="button"
                  data-roll-call-status="presente"
                  aria-pressed="${status === "presente"}"
                >
                  <i data-lucide="check"></i>
                  <span>Presente</span>
                </button>

                <button
                  class="attendance-choice absent${status === "falta" ? " active" : ""}"
                  type="button"
                  data-roll-call-status="falta"
                  aria-pressed="${status === "falta"}"
                >
                  <i data-lucide="x"></i>
                  <span>Faltou</span>
                </button>
              </div>
            </div>
          `;
        }
      )
      .join("");

  list.classList.remove(
    "hidden"
  );

  empty.classList.add(
    "hidden"
  );

  saveButton.disabled =
    false;

  markAllButton.disabled =
    false;

  setFormError(
    $("#roll-call-form-error"),
    ""
  );

  updateRollCallCounters();
  refreshIcons();
}

function setRollCallRowStatus(
  row,
  status
) {
  if (
    !row ||
    ![
      "presente",
      "falta"
    ].includes(
      status
    )
  ) {
    return;
  }

  row.dataset.status =
    status;

  $$(
    "[data-roll-call-status]",
    row
  ).forEach(
    (button) => {
      const active =
        button.dataset
          .rollCallStatus ===
        status;

      button.classList.toggle(
        "active",
        active
      );

      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    }
  );
}

function updateRollCallCounters() {
  const rows =
    $$(
      ".roll-call-row",
      $("#roll-call-list")
    );

  const present =
    rows.filter(
      (row) =>
        row.dataset.status ===
        "presente"
    ).length;

  $("#roll-call-total").textContent =
    rows.length;

  $("#roll-call-present").textContent =
    present;

  $("#roll-call-absent").textContent =
    rows.length -
    present;
}

async function submitRollCall(
  event,
  state
) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const button =
    $("#save-roll-call-button");

  const values =
    Object.fromEntries(
      new FormData(
        form
      )
    );

  const rows =
    $$(
      ".roll-call-row",
      $("#roll-call-list")
    );

  if (
    !values.class_id ||
    !values.subject_id ||
    !values.attendance_date ||
    rows.length ===
      0
  ) {
    setFormError(
      $("#roll-call-form-error"),
      "Selecione turma, disciplina e data antes de salvar a chamada."
    );

    return;
  }

  const unauthorized =
    state.profile.role ===
      "professor" &&
    rows.some(
      (row) =>
        !teacherCanManageStudentSubject(
          state,
          row.dataset
            .studentId,
          values.subject_id
        )
    );

  if (unauthorized) {
    setFormError(
      $("#roll-call-form-error"),
      "Você só pode fazer chamada nas turmas e matérias atribuídas a você."
    );

    return;
  }

  const existingByStudent =
    new Map(
      state.attendance
        .filter(
          (record) =>
            record.subject_id ===
              values.subject_id &&
            record.attendance_date ===
              values.attendance_date
        )
        .map(
          (record) => [
            record.student_id,
            record
          ]
        )
    );

  const payload =
    rows.map(
      (row) => ({
        aluno_id:
          row.dataset
            .studentId,

        disciplina_id:
          values.subject_id,

        data_aula:
          values.attendance_date,

        situacao:
          row.dataset.status,

        observacoes:
          existingByStudent.get(
            row.dataset
              .studentId
          )?.notes ??
          null,

        professor_id:
          state.profile.id
      })
    );

  setFormError(
    $("#roll-call-form-error"),
    ""
  );

  setButtonLoading(
    button,
    true,
    "Salvando..."
  );

  const { error } =
    await state.supabase
      .from(
        "frequencia"
      )
      .upsert(
        payload,
        {
          onConflict:
            "aluno_id,disciplina_id,data_aula"
        }
      );

  setButtonLoading(
    button,
    false,
    "Salvar chamada"
  );

  if (error) {
    setFormError(
      $("#roll-call-form-error"),
      error.message
    );

    return;
  }

  await loadAllData(
    state
  );

  $("#attendance-class-filter").value =
    values.class_id;

  $("#attendance-date-filter").value =
    values.attendance_date;

  renderAttendance(
    state
  );

  navigateTo(
    state,
    "frequencia"
  );

  toast(
    "Chamada salva",
    `${rows.length} alunos foram registrados de uma vez.`,
    "success"
  );
}

function openAttendanceDialog(
  state,
  record = null
) {
  const form =
    $("#attendance-form");

  form.reset();

  setFormError(
    $("#attendance-form-error"),
    ""
  );

  form.attendance_date.value =
    isoDate(
      new Date()
    );

  $("#attendance-subject-select").innerHTML =
    `<option value="">Selecione primeiro um aluno</option>`;

  $("#attendance-subject-select").disabled =
    true;

  if (record) {
    form.id.value =
      record.id;

    form.student_id.value =
      record.student_id;

    updateSubjectSelectForStudent(
      state,
      "#attendance-student-select",
      "#attendance-subject-select"
    );

    form.subject_id.value =
      record.subject_id;

    form.attendance_date.value =
      record.attendance_date;

    form.status.value =
      record.status;

    form.notes.value =
      record.notes ??
      "";

    $(
      "h2",
      $("#attendance-dialog")
    ).textContent =
      "Editar frequência";
  } else {
    form.id.value =
      "";

    $(
      "h2",
      $("#attendance-dialog")
    ).textContent =
      "Registrar frequência";
  }

  openDialog(
    "attendance-dialog"
  );
}

function openAssignmentDialog(state) {
  const form =
    $("#assignment-form");

  form.reset();

  setFormError(
    $("#assignment-form-error"),
    ""
  );

  $("#assignment-subject-select").innerHTML =
    `<option value="">Selecione professor e turma</option>`;

  $("#assignment-subject-select").disabled =
    true;

  openDialog(
    "assignment-dialog"
  );
}

function updateSubjectSelectForStudent(
  state,
  studentSelector,
  subjectSelector
) {
  const select =
    $(
      subjectSelector
    );

  const student =
    state.students.find(
      (item) =>
        item.id ===
        $(
          studentSelector
        ).value
    );

  if (!student) {
    select.innerHTML =
      `<option value="">Selecione primeiro um aluno</option>`;

    select.disabled =
      true;

    return;
  }

  const schoolClass =
    state.classes.find(
      (item) =>
        item.id ===
        student.class_id
    );

  fillSubjectSelect(
    state,
    select,
    schoolClass
      ?.course_id ??
      null,
    schoolClass
      ?.id ??
      null
  );
}

function updateSubjectSelectForClass(
  state,
  classSelector,
  subjectSelector
) {
  const schoolClass =
    state.classes.find(
      (item) =>
        item.id ===
        $(
          classSelector
        ).value
    );

  fillSubjectSelect(
    state,
    $(
      subjectSelector
    ),
    schoolClass
      ?.course_id ??
      null,
    schoolClass
      ?.id ??
      null
  );
}

function fillSubjectSelect(
  state,
  select,
  courseId,
  classId = null
) {
  if (!courseId) {
    select.innerHTML =
      `<option value="">Selecione primeiro um aluno</option>`;

    select.disabled =
      true;

    return;
  }

  let subjects =
    state.subjects
      .filter(
        (item) =>
          item.course_id ===
          courseId
      );

  if (
    state.profile?.role ===
      "professor" &&
    classId
  ) {
    const allowed =
      new Set(
        state.teacherAssignments
          .filter(
            (item) =>
              item.teacher_id ===
                state.profile.id &&
              item.class_id ===
                classId
          )
          .map(
            (item) =>
              item.subject_id
          )
      );

    subjects =
      subjects.filter(
        (item) =>
          allowed.has(
            item.id
          )
      );
  }

  select.innerHTML =
    `<option value="">Selecione uma disciplina</option>${
      subjects
        .map(
          (subject) =>
            `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`
        )
        .join("")
    }`;

  select.disabled =
    subjects.length ===
    0;
}

async function submitAttendance(event, state) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const values =
    Object.fromEntries(
      new FormData(
        form
      )
    );
      if (
    state.profile.role ===
      "professor" &&
    !teacherCanManageStudentSubject(
      state,
      values.student_id,
      values.subject_id
    )
  ) {
    setFormError(
      $("#attendance-form-error"),
      "Você só pode fazer chamada para alunos das suas turmas e na matéria atribuída a você."
    );

    return;
  }

  const payload = {
    aluno_id:
      values.student_id,

    disciplina_id:
      values.subject_id,

    data_aula:
      values.attendance_date,

    situacao:
      values.status,

    observacoes:
      values.notes ||
      null,

    professor_id:
      state.profile.id
  };

  setFormError(
    $("#attendance-form-error"),
    ""
  );

  const query =
    values.id
      ? state.supabase
          .from(
            "frequencia"
          )
          .update(
            payload
          )
          .eq(
            "id",
            values.id
          )
      : state.supabase
          .from(
            "frequencia"
          )
          .upsert(
            payload,
            {
              onConflict:
                "aluno_id,disciplina_id,data_aula"
            }
          );

  const { error } =
    await query;

  if (error) {
    setFormError(
      $("#attendance-form-error"),
      error.message
    );

    return;
  }

  $("#attendance-dialog").close();

  await loadAllData(
    state
  );

  toast(
    "Frequência salva",
    "O histórico do aluno já foi atualizado.",
    "success"
  );
}

async function deleteAttendance(state, id) {
  const { error } =
    await state.supabase
      .from(
        "frequencia"
      )
      .delete()
      .eq(
        "id",
        id
      );

  if (error) {
    toast(
      "Erro ao excluir",
      error.message,
      "error"
    );
  } else {
    await loadAllData(
      state
    );

    toast(
      "Registro excluído",
      "A frequência foi recalculada.",
      "success"
    );
  }
}

async function submitAssignment(event, state) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const values =
    Object.fromEntries(
      new FormData(
        form
      )
    );

  setFormError(
    $("#assignment-form-error"),
    ""
  );

  const { error } =
    await state.supabase
      .from(
        "atribuicoes_professores"
      )
      .insert({
        professor_id:
          values.teacher_id,

        turma_id:
          values.class_id,

        disciplina_id:
          values.subject_id
      });

  if (error) {
    setFormError(
      $("#assignment-form-error"),
      error.code ===
        "23505"
        ? "Este vínculo já existe."
        : error.message
    );

    return;
  }

  $("#assignment-dialog").close();

  form.reset();

  await loadAllData(
    state
  );

  toast(
    "Professor vinculado",
    "A turma e a disciplina já estão disponíveis no acesso dele.",
    "success"
  );
}

async function deleteAssignment(state, id) {
  const { error } =
    await state.supabase
      .from(
        "atribuicoes_professores"
      )
      .delete()
      .eq(
        "id",
        id
      );

  if (error) {
    toast(
      "Erro ao remover",
      error.message,
      "error"
    );
  } else {
    await loadAllData(
      state
    );

    toast(
      "Vínculo removido",
      "As permissões do professor foram atualizadas.",
      "success"
    );
  }
}

function navigateTo(state, view) {
  const target =
    $(
      `[data-view-panel="${view}"]`
    );

  const nav =
    $(
      `.nav-item[data-view="${view}"]`
    );

  if (
    !target ||
    nav?.classList.contains(
      "hidden"
    )
  ) {
    return;
  }

  state.currentView =
    view;

  $$(".view").forEach(
    (panel) =>
      panel.classList.toggle(
        "active",
        panel ===
          target
      )
  );

  $$(".nav-item").forEach(
    (item) =>
      item.classList.toggle(
        "active",
        item.dataset.view ===
          view
      )
  );

  const titles = {
    inicio: [
      "Portal acadêmico",
      "Visão geral"
    ],

    pessoas: [
      "Administração",
      "Pessoas"
    ],

    turmas: [
      "Gestão acadêmica",
      "Turmas"
    ],

    notas: [
      "Gestão acadêmica",
      "Notas"
    ],

    frequencia: [
      "Gestão acadêmica",
      "Frequência"
    ],

    chamada: [
      "Gestão acadêmica",
      "Fazer chamada"
    ],

    boletim: [
      "Área do aluno",
      "Meu boletim"
    ],

    "minha-frequencia": [
      "Área do aluno",
      "Minha frequência"
    ]
  };

  $("#page-kicker").textContent =
    titles[view]
      ?.[0] ??
    "Portal Escola";

  $("#page-title").textContent =
    titles[view]
      ?.[1] ??
    "Portal Escola";

  closeSidebar();

  window.scrollTo({
    top:
      0,
    behavior:
      "smooth"
  });
}

function applyRolePermissions(role) {
  $$("[data-roles]")
    .forEach(
      (element) => {
        const allowed =
          element
            .dataset
            .roles
            .split(",");

        element
          .classList
          .toggle(
            "hidden",
            !allowed.includes(
              role
            )
          );
      }
    );
}

function updateUserIdentity(profile) {
  const shortName =
    profile.full_name
      .split(" ")
      .slice(
        0,
        2
      )
      .join(" ");

  $("#sidebar-name").textContent =
    shortName;

  $("#sidebar-role").textContent =
    roleLabel(
      profile.role
    );

  $("#sidebar-avatar").textContent =
    initials(
      profile.full_name
    );

  $("#top-avatar").textContent =
    initials(
      profile.full_name
    );

  $("#top-avatar").title =
    profile.full_name;
}

function updatePersonFields(state = null) {
  const role =
    $("#person-form [name='role']").value;

  $$(".student-only").forEach(
    (element) =>
      element.classList.toggle(
        "hidden",
        role !==
          "aluno"
      )
  );

  $$(".teacher-only").forEach(
    (element) =>
      element.classList.toggle(
        "hidden",
        role !==
          "professor"
      )
  );

  $$(".employee-only").forEach(
    (element) =>
      element.classList.toggle(
        "hidden",
        role !==
          "funcionario"
      )
  );

  $("#person-class-select").required =
    role ===
    "aluno";

  const specialty =
    $("#person-form [name='specialty']");

  if (specialty) {
    specialty.required =
      role ===
      "professor";
  }

  if (
    state &&
    role ===
      "professor"
  ) {
    setupTeacherSubjectSelect(
      state
    );
  }
}

function showAuth() {
  appShell.classList.add(
    "hidden"
  );

  setupScreen.classList.add(
    "hidden"
  );

  authScreen.classList.remove(
    "hidden"
  );

  $("#login-password").value =
    "";

  refreshIcons();
}

function applySavedTheme() {
  const saved =
    localStorage.getItem(
      "escola-theme"
    );

  const theme =
    saved ||
    (
      matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches
        ? "dark"
        : "light"
    );

  document.documentElement.dataset.theme =
    theme;

  updateThemeIcons();
}

function toggleTheme() {
  const next =
    document.documentElement
      .dataset
      .theme ===
    "dark"
      ? "light"
      : "dark";

  document.documentElement.dataset.theme =
    next;

  localStorage.setItem(
    "escola-theme",
    next
  );

  updateThemeIcons();
}

function updateThemeIcons() {
  const icon =
    document.documentElement
      .dataset
      .theme ===
    "dark"
      ? "sun"
      : "moon";

  $$(".theme-toggle")
    .forEach(
      (button) => {
        button.innerHTML =
          `<i data-lucide="${icon}"></i>`;
      }
    );

  refreshIcons();
}

function confirmAction(
  state,
  title,
  message,
  callback
) {
  $("#confirm-title").textContent =
    title;

  $("#confirm-message").textContent =
    message;

  state.confirmCallback =
    callback;

  openDialog(
    "confirm-dialog"
  );
}

function openDialog(id) {
  const dialog =
    document.getElementById(
      id
    );

  if (
    !dialog.open
  ) {
    dialog.showModal();
  }

  refreshIcons();
}

function setLoading(active) {
  $("#loading-state")
    .classList
    .toggle(
      "hidden",
      !active
    );
}

function closeSidebar() {
  $("#sidebar")
    .classList
    .remove(
      "open"
    );
}

function setButtonLoading(
  button,
  active,
  text
) {
  button.disabled =
    active;

  const label =
    $(
      "span",
      button
    );

  if (label) {
    label.textContent =
      text;
  } else {
    button.textContent =
      text;
  }
}

function setFormError(
  element,
  message
) {
  element.textContent =
    message;

  element.classList.toggle(
    "hidden",
    !message
  );
}

function toggleEmpty(
  body,
  empty,
  isEmpty
) {
  body
    .closest(
      ".table-scroll"
    )
    .classList
    .toggle(
      "hidden",
      isEmpty
    );

  empty
    .classList
    .toggle(
      "hidden",
      !isEmpty
    );
}

function toast(
  title,
  message,
  type = "success"
) {
  const element =
    document.createElement(
      "div"
    );

  element.className =
    `toast ${type}`;

  element.innerHTML =
    `<i data-lucide="${
      type === "success"
        ? "circle-check"
        : "circle-alert"
    }"></i><span><strong>${escapeHTML(title)}</strong><span>${escapeHTML(message)}</span></span>`;

  $("#toast-region")
    .appendChild(
      element
    );

  refreshIcons();

  setTimeout(
    () =>
      element.remove(),
    4200
  );
}

function refreshIcons() {
  window.lucide?.createIcons({
    attrs: {
      "aria-hidden":
        "true"
    }
  });
}

function getSpecializedProfile(person) {
  return person.role ===
    "aluno"
      ? person.students
          ?.[0]
      : person.role ===
          "professor"
        ? person.teachers
            ?.[0]
        : person.employees
            ?.[0];
}

function groupBy(
  items,
  keyFn
) {
  return items.reduce(
    (
      groups,
      item
    ) => {
      const key =
        keyFn(
          item
        );

      (
        groups[key] ||=
        []
      ).push(
        item
      );

      return groups;
    },
    {}
  );
}

function initials(name = "") {
  return name
    .split(
      /\s+/
    )
    .filter(
      Boolean
    )
    .slice(
      0,
      2
    )
    .map(
      (word) =>
        word[0]
    )
    .join("")
    .toUpperCase();
}

function normalize(value = "") {
  return value
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

function roleLabel(role) {
  return {
    aluno:
      "Aluno",
    professor:
      "Professor",
    funcionario:
      "Funcionário"
  }[role] ??
  role;
}

function shiftLabel(shift) {
  return {
    manha:
      "Manhã",
    tarde:
      "Tarde",
    noite:
      "Noite"
  }[shift] ??
  shift;
}

function attendanceLabel(status) {
  return {
    presente:
      "Presente",
    falta:
      "Falta",
    justificada:
      "Justificada"
  }[status] ??
  status;
}

function attendanceTone(status) {
  return status ===
    "presente"
      ? "status-success"
      : status ===
          "justificada"
        ? "status-warning"
        : "status-danger";
}

function formatDate(value) {
  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      timeZone:
        "UTC"
    }
  ).format(
    new Date(
      `${value}T00:00:00Z`
    )
  );
}

function isoDate(date) {
  return date
    .toISOString()
    .slice(
      0,
      10
    );
}

function friendlyAuthError(message) {
  return /Invalid login credentials/i
    .test(
      message
    )
      ? "E-mail ou senha incorretos."
      : /Email not confirmed/i
          .test(
            message
          )
        ? "Confirme seu e-mail antes de entrar."
        : "Não foi possível entrar. Verifique os dados e tente novamente.";
}
async function getFunctionErrorMessage(
  error,
  data,
  fallback
) {
  if (data?.error) {
    return data.error;
  }

  const response = error?.context;

  if (response instanceof Response) {
    try {
      const payload = await response
        .clone()
        .json();

      if (payload?.error) {
        return payload.error;
      }
    } catch {
      // A resposta não continha JSON.
    }
  }

  return error?.message ?? fallback;
}
function escapeHTML(value = "") {
  return String(
    value
  ).replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&":
          "&amp;",
        "<":
          "&lt;",
        ">":
          "&gt;",
        "'":
          "&#39;",
        '"':
          "&quot;"
      })[char]
  );
}