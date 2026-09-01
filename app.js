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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const state = {
    supabase,
    session: null,
    profile: null,
    currentView: "inicio",
    people: [],
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

  const { data: { session } } = await supabase.auth.getSession();
  if (session) await enterApp(state, session);
  else showAuth();

  supabase.auth.onAuthStateChange(async (event, newSession) => {
    if (event === "SIGNED_OUT") showAuth();
    if (event === "PASSWORD_RECOVERY") toast("Recuperação iniciada", "Abra as configurações do Supabase para definir o fluxo de troca de senha.", "success");
    if (event === "SIGNED_IN" && newSession && newSession.user.id !== state.session?.user?.id) {
      await enterApp(state, newSession);
    }
  });

  async function enterApp(currentState, session) {
    currentState.session = session;
    setLoading(true);
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, status")
      .eq("id", session.user.id)
      .single();

    if (error || !profile) {
      setLoading(false);
      await supabase.auth.signOut();
      showAuth();
      setFormError($("#login-error"), "Sua conta existe, mas o perfil escolar ainda não foi criado. Procure a secretaria.");
      return;
    }
    if (profile.status !== "ativo") {
      setLoading(false);
      await supabase.auth.signOut();
      showAuth();
      setFormError($("#login-error"), "Este acesso está inativo. Procure a secretaria da escola.");
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

    const { error } = await state.supabase.auth.signInWithPassword({ email, password });
    setButtonLoading(button, false, "Entrar no portal");
    if (error) {
      setFormError($("#login-error"), friendlyAuthError(error.message));
      return;
    }
    if ($("#remember-email").checked) localStorage.setItem("escola-email", email);
    else localStorage.removeItem("escola-email");
  });

  const savedEmail = localStorage.getItem("escola-email");
  if (savedEmail) {
    $("#login-email").value = savedEmail;
    $("#remember-email").checked = true;
  }

  $("#toggle-password").addEventListener("click", () => {
    const input = $("#login-password");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    $("#toggle-password").innerHTML = `<i data-lucide="${showing ? "eye" : "eye-off"}"></i>`;
    refreshIcons();
  });

  $("#forgot-password").addEventListener("click", async () => {
    const email = $("#login-email").value.trim();
    if (!email) {
      setFormError($("#login-error"), "Digite seu e-mail para receber o link de recuperação.");
      $("#login-email").focus();
      return;
    }
    const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname}`
    });
    if (error) setFormError($("#login-error"), error.message);
    else toast("Link enviado", "Confira a caixa de entrada e a pasta de spam.", "success");
  });

  $$(".theme-toggle").forEach((button) => button.addEventListener("click", toggleTheme));
  $("#logout-button").addEventListener("click", () => state.supabase.auth.signOut());
  $("#refresh-button").addEventListener("click", async () => {
    setLoading(true);
    await loadAllData(state);
    setLoading(false);
    toast("Dados atualizados", "As informações mais recentes foram carregadas.", "success");
  });

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => navigateTo(state, item.dataset.view)));
  $("#open-sidebar").addEventListener("click", () => $("#sidebar").classList.add("open"));
  $("#close-sidebar").addEventListener("click", closeSidebar);
  $("#sidebar-overlay").addEventListener("click", closeSidebar);

  $("#new-person-button").addEventListener("click", () => openDialog("person-dialog"));
  $("#new-class-button").addEventListener("click", () => {
    $("#class-form").reset();
    $("#class-form [name='school_year']").value = new Date().getFullYear();
    openDialog("class-dialog");
  });
  $("#new-grade-button").addEventListener("click", () => openGradeDialog(state));
  $("#new-attendance-button").addEventListener("click", () => openAttendanceDialog(state));
  $("#new-assignment-button").addEventListener("click", () => openAssignmentDialog(state));
  $("#print-report-button").addEventListener("click", () => window.print());

  $$(".modal-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $$("dialog.modal").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));

  $("#person-form [name='role']").addEventListener("change", updatePersonFields);
  $("#person-form").addEventListener("submit", (event) => submitPerson(event, state));
  $("#class-form").addEventListener("submit", (event) => submitClass(event, state));
  $("#grade-form").addEventListener("submit", (event) => submitGrade(event, state));
  $("#attendance-form").addEventListener("submit", (event) => submitAttendance(event, state));
  $("#assignment-form").addEventListener("submit", (event) => submitAssignment(event, state));

  $("#people-search").addEventListener("input", () => renderPeople(state));
  $("#people-role-filter").addEventListener("change", () => renderPeople(state));
  $("#class-search").addEventListener("input", () => renderClasses(state));
  $("#class-shift-filter").addEventListener("change", () => renderClasses(state));
  $("#grade-class-filter").addEventListener("change", () => renderGrades(state));
  $("#grade-term-filter").addEventListener("change", () => renderGrades(state));
  $("#attendance-class-filter").addEventListener("change", () => renderAttendance(state));
  $("#attendance-date-filter").addEventListener("change", () => renderAttendance(state));
  $("#grade-student-select").addEventListener("change", () => updateSubjectSelectForStudent(state, "#grade-student-select", "#grade-subject-select"));
  $("#attendance-student-select").addEventListener("change", () => updateSubjectSelectForStudent(state, "#attendance-student-select", "#attendance-subject-select"));
  $("#assignment-class-select").addEventListener("change", () => updateSubjectSelectForClass(state, "#assignment-class-select", "#assignment-subject-select"));

  $("#confirm-cancel").addEventListener("click", () => $("#confirm-dialog").close());
  $("#confirm-action").addEventListener("click", async () => {
    const callback = state.confirmCallback;
    $("#confirm-dialog").close();
    state.confirmCallback = null;
    if (callback) await callback();
  });

  document.addEventListener("click", async (event) => {
    const navigateButton = event.target.closest("[data-navigate]");
    if (navigateButton) navigateTo(state, navigateButton.dataset.navigate);

    const deletePersonButton = event.target.closest("[data-delete-person]");
    if (deletePersonButton) {
      const person = state.people.find((item) => item.id === deletePersonButton.dataset.deletePerson);
      confirmAction(state, `Excluir ${person?.full_name ?? "esta pessoa"}?`, "A conta de acesso e todos os registros vinculados serão removidos.", () => deletePerson(state, deletePersonButton.dataset.deletePerson));
    }

    const editGradeButton = event.target.closest("[data-edit-grade]");
    if (editGradeButton) openGradeDialog(state, state.grades.find((item) => item.id === editGradeButton.dataset.editGrade));
    const deleteGradeButton = event.target.closest("[data-delete-grade]");
    if (deleteGradeButton) confirmAction(state, "Excluir esta nota?", "O lançamento será removido do boletim do aluno.", () => deleteGrade(state, deleteGradeButton.dataset.deleteGrade));

    const editAttendanceButton = event.target.closest("[data-edit-attendance]");
    if (editAttendanceButton) openAttendanceDialog(state, state.attendance.find((item) => item.id === editAttendanceButton.dataset.editAttendance));
    const deleteAttendanceButton = event.target.closest("[data-delete-attendance]");
    if (deleteAttendanceButton) confirmAction(state, "Excluir este registro?", "A frequência do aluno será recalculada.", () => deleteAttendance(state, deleteAttendanceButton.dataset.deleteAttendance));
    const deleteAssignmentButton = event.target.closest("[data-delete-assignment]");
    if (deleteAssignmentButton) confirmAction(state, "Remover este vínculo?", "O professor deixará de acessar essa turma e disciplina.", () => deleteAssignment(state, deleteAssignmentButton.dataset.deleteAssignment));
  });
}

async function loadAllData(state) {
  const { supabase, profile } = state;
  const commonRequests = [
    supabase.from("courses").select("id, code, name").order("name"),
    supabase.from("classes").select("id, name, module, shift, school_year, room, course_id, courses(code, name)").order("name"),
    supabase.from("subjects").select("id, name, code, course_id").order("name")
  ];
  const [coursesResult, classesResult, subjectsResult] = await Promise.all(commonRequests);
  state.courses = coursesResult.data ?? [];
  state.classes = classesResult.data ?? [];
  state.subjects = subjectsResult.data ?? [];

  if (profile.role === "funcionario") {
    const [peopleResult, studentsResult, gradesResult, attendanceResult, assignmentsResult] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role, status, students(id, registration, class_id, classes(name)), teachers(id, registration, specialty), employees(id, registration, job_title, department)").order("full_name"),
      supabase.from("students").select("id, profile_id, class_id, registration, profiles(full_name, email), classes(name, shift, courses(code))").order("registration"),
      gradesQuery(supabase),
      attendanceQuery(supabase),
      supabase.from("teacher_assignments").select("id, teacher_id, class_id, subject_id, profiles!teacher_assignments_teacher_id_fkey(full_name), classes(name), subjects(name)").order("created_at", { ascending: false })
    ]);
    state.people = peopleResult.data ?? [];
    state.students = studentsResult.data ?? [];
    state.grades = gradesResult.data ?? [];
    state.attendance = attendanceResult.data ?? [];
    state.teacherAssignments = assignmentsResult.data ?? [];
  } else if (profile.role === "professor") {
    const [studentsResult, gradesResult, attendanceResult, assignmentsResult] = await Promise.all([
      supabase.from("students").select("id, profile_id, class_id, registration, profiles(full_name, email), classes(name, shift, courses(code))").order("registration"),
      gradesQuery(supabase),
      attendanceQuery(supabase),
      supabase.from("teacher_assignments").select("id, teacher_id, class_id, subject_id").eq("teacher_id", profile.id)
    ]);
    state.students = studentsResult.data ?? [];
    state.grades = gradesResult.data ?? [];
    state.attendance = attendanceResult.data ?? [];
    state.teacherAssignments = assignmentsResult.data ?? [];
  } else {
    const { data: student } = await supabase.from("students").select("id, profile_id, class_id, registration, profiles(full_name, email), classes(name, shift, module, courses(code, name))").eq("profile_id", profile.id).maybeSingle();
    state.students = student ? [student] : [];
    if (student) {
      const [gradesResult, attendanceResult] = await Promise.all([
        gradesQuery(supabase).eq("student_id", student.id),
        attendanceQuery(supabase).eq("student_id", student.id)
      ]);
      state.grades = gradesResult.data ?? [];
      state.attendance = attendanceResult.data ?? [];
    }
  }

  populateSelects(state);
  renderCurrentData(state);
}

function gradesQuery(supabase) {
  return supabase.from("grades").select("id, student_id, subject_id, teacher_id, term, assessment, score, weight, created_at, students(class_id, profiles(full_name), classes(name)), subjects(name, code)").order("created_at", { ascending: false });
}

function attendanceQuery(supabase) {
  return supabase.from("attendance").select("id, student_id, subject_id, teacher_id, attendance_date, status, notes, students(class_id, profiles(full_name), classes(name)), subjects(name, code)").order("attendance_date", { ascending: false });
}

function renderCurrentData(state) {
  renderDashboard(state);
  if (state.profile.role === "funcionario") {
    renderPeople(state);
    renderAssignments(state);
  }
  if (state.profile.role !== "aluno") {
    renderClasses(state);
    renderGrades(state);
    renderAttendance(state);
  } else {
    renderReport(state);
    renderStudentAttendance(state);
  }
  refreshIcons();
}

function renderDashboard(state) {
  const { role, full_name } = state.profile;
  const firstName = full_name.split(" ")[0];
  $("#welcome-title").textContent = `Olá, ${firstName}!`;
  $("#today-label").textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());
  $("#welcome-subtitle").textContent = role === "aluno" ? "Veja como estão suas notas e sua frequência." : role === "professor" ? "Confira seus lançamentos e turmas disponíveis." : "Acompanhe os principais números da escola.";

  const metrics = role === "aluno" ? studentMetrics(state) : managementMetrics(state);
  $("#metric-grid").innerHTML = metrics.map(metricCard).join("");

  if (role === "aluno") renderStudentPerformance(state);
  else renderManagementPerformance(state);

  const actions = role === "aluno"
    ? [
        ["notebook-tabs", "Meu boletim", "Consultar médias", "boletim"],
        ["calendar-check-2", "Minha frequência", "Ver presenças e faltas", "minha-frequencia"]
      ]
    : role === "professor"
      ? [
          ["clipboard-pen-line", "Lançar nota", "Registrar uma avaliação", "notas"],
          ["calendar-days", "Fazer chamada", "Registrar frequência", "frequencia"],
          ["school", "Ver turmas", "Consultar alunos", "turmas"]
        ]
      : [
          ["user-plus", "Cadastrar pessoa", "Criar um novo acesso", "pessoas"],
          ["school", "Organizar turmas", "Cursos e períodos", "turmas"],
          ["clipboard-pen-line", "Consultar notas", "Desempenho acadêmico", "notas"]
        ];
  $("#quick-actions").innerHTML = actions.map(([icon, title, detail, view]) => `<button class="quick-action" type="button" data-navigate="${view}"><span><i data-lucide="${icon}"></i></span><span><strong>${title}</strong><small>${detail}</small></span></button>`).join("");
}

function studentMetrics(state) {
  const scores = state.grades.map((grade) => Number(grade.score));
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const total = state.attendance.length;
  const present = state.attendance.filter((item) => item.status === "presente").length;
  const frequency = total ? (present / total) * 100 : 0;
  const absences = state.attendance.filter((item) => item.status === "falta").length;
  const className = state.students[0]?.classes?.name ?? "Sem turma";
  return [
    { label: "Média geral", value: scores.length ? average.toFixed(1) : "—", icon: "chart-no-axes-combined", tone: "" },
    { label: "Frequência", value: total ? `${frequency.toFixed(0)}%` : "—", icon: "calendar-check", tone: "success" },
    { label: "Faltas", value: absences, icon: "calendar-x", tone: "warning" },
    { label: "Turma", value: className, icon: "school", tone: "purple" }
  ];
}

function managementMetrics(state) {
  const peopleCount = state.profile.role === "funcionario" ? state.people.length : state.students.length;
  const today = isoDate(new Date());
  const todayAttendance = state.attendance.filter((item) => item.attendance_date === today).length;
  return [
    { label: state.profile.role === "funcionario" ? "Pessoas cadastradas" : "Alunos disponíveis", value: peopleCount, icon: "users", tone: "" },
    { label: "Turmas", value: state.classes.length, icon: "school", tone: "purple" },
    { label: "Notas lançadas", value: state.grades.length, icon: "notebook-pen", tone: "success" },
    { label: "Chamadas hoje", value: todayAttendance, icon: "calendar-days", tone: "warning" }
  ];
}

function metricCard({ label, value, icon, tone }) {
  return `<article class="metric-card"><span class="metric-icon ${tone}"><i data-lucide="${icon}"></i></span><span class="metric-copy"><span>${escapeHTML(label)}</span><strong title="${escapeHTML(String(value))}">${escapeHTML(String(value))}</strong></span></article>`;
}

function renderStudentPerformance(state) {
  const grouped = groupBy(state.grades, (grade) => grade.subjects?.name ?? "Disciplina");
  const rows = Object.entries(grouped).map(([name, grades]) => {
    const average = grades.reduce((sum, grade) => sum + Number(grade.score), 0) / grades.length;
    return { name, average };
  }).sort((a, b) => b.average - a.average).slice(0, 5);
  $("#performance-content").innerHTML = rows.length ? `<div class="performance-bars">${rows.map(({ name, average }) => `<div class="performance-row"><span title="${escapeHTML(name)}">${escapeHTML(name)}</span><div class="progress-track"><i style="width:${Math.min(100, average * 10)}%"></i></div><strong>${average.toFixed(1)}</strong></div>`).join("")}</div>` : `<div class="performance-empty"><p>Suas notas aparecerão aqui depois do primeiro lançamento.</p></div>`;
}

function renderManagementPerformance(state) {
  const courseCounts = state.classes.reduce((acc, item) => {
    const code = item.courses?.code ?? "Outro";
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});
  const max = Math.max(...Object.values(courseCounts), 1);
  const rows = Object.entries(courseCounts).sort((a, b) => b[1] - a[1]);
  $("#performance-content").innerHTML = rows.length ? `<div class="performance-bars">${rows.map(([name, amount]) => `<div class="performance-row"><span>${escapeHTML(name)}</span><div class="progress-track"><i style="width:${(amount / max) * 100}%"></i></div><strong>${amount}</strong></div>`).join("")}</div>` : `<div class="performance-empty"><p>Cadastre turmas para visualizar a distribuição dos cursos.</p></div>`;
}

function renderPeople(state) {
  const query = normalize($("#people-search").value);
  const role = $("#people-role-filter").value;
  const filtered = state.people.filter((person) => {
    const specialized = getSpecializedProfile(person);
    const haystack = normalize(`${person.full_name} ${person.email} ${specialized?.registration ?? ""}`);
    return (role === "todos" || person.role === role) && haystack.includes(query);
  });
  const body = $("#people-table-body");
  body.innerHTML = filtered.map((person) => {
    const specialized = getSpecializedProfile(person);
    const place = person.role === "aluno" ? specialized?.classes?.name : person.role === "professor" ? specialized?.specialty : `${specialized?.job_title ?? "—"}${specialized?.department ? ` · ${specialized.department}` : ""}`;
    return `<tr><td><div class="person-cell"><span class="avatar">${initials(person.full_name)}</span><span class="person-copy"><strong>${escapeHTML(person.full_name)}</strong><span>${escapeHTML(person.email)}</span></span></div></td><td><span class="pill role-pill role-${person.role}">${escapeHTML(roleLabel(person.role))}</span></td><td>${escapeHTML(specialized?.registration ?? "—")}</td><td>${escapeHTML(place ?? "—")}</td><td><span class="status-badge ${person.status === "ativo" ? "status-success" : "status-neutral"}">${person.status === "ativo" ? "Ativo" : "Inativo"}</span></td><td><div class="table-actions"><button class="table-action danger" type="button" data-delete-person="${person.id}" aria-label="Excluir ${escapeHTML(person.full_name)}"><i data-lucide="trash-2"></i></button></div></td></tr>`;
  }).join("");
  toggleEmpty(body, $("#people-empty"), filtered.length === 0);
  refreshIcons();
}

function renderClasses(state) {
  const query = normalize($("#class-search").value);
  const shift = $("#class-shift-filter").value;
  const filtered = state.classes.filter((item) => (shift === "todos" || item.shift === shift) && normalize(`${item.name} ${item.courses?.name} ${item.courses?.code}`).includes(query));
  $("#class-grid").innerHTML = filtered.map((item) => {
    const count = state.students.filter((student) => student.class_id === item.id).length;
    return `<article class="class-card"><div class="class-card-top"></div><div class="class-card-body"><div class="class-card-head"><div><h3>${escapeHTML(item.name)}</h3><p>${escapeHTML(item.courses?.name ?? "Curso")}</p></div><span class="pill role-aluno">${escapeHTML(item.courses?.code ?? "—")}</span></div><div class="class-meta"><span><i data-lucide="clock-3"></i>${escapeHTML(shiftLabel(item.shift))}</span><span><i data-lucide="layers-3"></i>${item.module}º módulo</span><span><i data-lucide="users"></i>${count} aluno${count === 1 ? "" : "s"}</span><span><i data-lucide="map-pin"></i>${escapeHTML(item.room || "Sala não definida")}</span></div></div></article>`;
  }).join("");
  $("#class-empty").classList.toggle("hidden", filtered.length !== 0);
  refreshIcons();
}

function renderAssignments(state) {
  const body = $("#assignments-table-body");
  body.innerHTML = state.teacherAssignments.map((item) => `<tr><td>${escapeHTML(item.profiles?.full_name ?? "Professor")}</td><td>${escapeHTML(item.classes?.name ?? "—")}</td><td>${escapeHTML(item.subjects?.name ?? "—")}</td><td><div class="table-actions"><button class="table-action danger" type="button" data-delete-assignment="${item.id}" aria-label="Remover vínculo"><i data-lucide="unlink"></i></button></div></td></tr>`).join("");
  body.closest(".table-scroll").classList.toggle("hidden", state.teacherAssignments.length === 0);
  $("#assignments-empty").classList.toggle("hidden", state.teacherAssignments.length !== 0);
  refreshIcons();
}

function renderGrades(state) {
  const classId = $("#grade-class-filter").value;
  const term = $("#grade-term-filter").value;
  const filtered = state.grades.filter((grade) => (classId === "todos" || grade.students?.class_id === classId) && (term === "todos" || String(grade.term) === term));
  const body = $("#grades-table-body");
  body.innerHTML = filtered.map((grade) => `<tr><td>${escapeHTML(grade.students?.profiles?.full_name ?? "Aluno")}</td><td>${escapeHTML(grade.subjects?.name ?? "—")}</td><td>${escapeHTML(grade.assessment)}</td><td>${grade.term}º</td><td><span class="score">${Number(grade.score).toFixed(1)}</span></td><td><span class="status-badge ${Number(grade.score) >= 6 ? "status-success" : "status-warning"}">${Number(grade.score) >= 6 ? "Na média" : "Atenção"}</span></td><td><div class="table-actions"><button class="table-action" type="button" data-edit-grade="${grade.id}" aria-label="Editar nota"><i data-lucide="pencil"></i></button><button class="table-action danger" type="button" data-delete-grade="${grade.id}" aria-label="Excluir nota"><i data-lucide="trash-2"></i></button></div></td></tr>`).join("");
  toggleEmpty(body, $("#grades-empty"), filtered.length === 0);
  refreshIcons();
}

function renderAttendance(state) {
  const classId = $("#attendance-class-filter").value;
  const date = $("#attendance-date-filter").value;
  const filtered = state.attendance.filter((record) => (classId === "todos" || record.students?.class_id === classId) && (!date || record.attendance_date === date));
  const body = $("#attendance-table-body");
  body.innerHTML = filtered.map((record) => `<tr><td>${formatDate(record.attendance_date)}</td><td>${escapeHTML(record.students?.profiles?.full_name ?? "Aluno")}</td><td>${escapeHTML(record.students?.classes?.name ?? "—")}</td><td>${escapeHTML(record.subjects?.name ?? "—")}</td><td><span class="status-badge ${attendanceTone(record.status)}">${escapeHTML(attendanceLabel(record.status))}</span></td><td>${escapeHTML(record.notes || "—")}</td><td><div class="table-actions"><button class="table-action" type="button" data-edit-attendance="${record.id}" aria-label="Editar frequência"><i data-lucide="pencil"></i></button><button class="table-action danger" type="button" data-delete-attendance="${record.id}" aria-label="Excluir frequência"><i data-lucide="trash-2"></i></button></div></td></tr>`).join("");
  toggleEmpty(body, $("#attendance-empty"), filtered.length === 0);
  refreshIcons();
}

function renderReport(state) {
  const grouped = groupBy(state.grades, (grade) => grade.subjects?.name ?? "Disciplina");
  const rows = Object.entries(grouped).map(([subject, grades]) => {
    const terms = [1, 2, 3, 4].map((term) => {
      const values = grades.filter((grade) => grade.term === term).map((grade) => Number(grade.score));
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    });
    const valid = terms.filter((value) => value !== null);
    const average = valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
    return { subject, terms, average };
  }).sort((a, b) => a.subject.localeCompare(b.subject));

  const body = $("#report-table-body");
  body.innerHTML = rows.map((row) => `<tr><td><strong>${escapeHTML(row.subject)}</strong></td>${row.terms.map((value) => `<td>${value === null ? "—" : value.toFixed(1)}</td>`).join("")}<td><span class="score">${row.average === null ? "—" : row.average.toFixed(1)}</span></td><td>${row.average === null ? "—" : `<span class="status-badge ${row.average >= 6 ? "status-success" : "status-warning"}">${row.average >= 6 ? "Aprovado" : "Em recuperação"}</span>`}</td></tr>`).join("");
  toggleEmpty(body, $("#report-empty"), rows.length === 0);

  const averages = rows.map((row) => row.average).filter((value) => value !== null);
  const general = averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null;
  $("#report-summary").innerHTML = [
    { label: "Média geral", value: general === null ? "—" : general.toFixed(1), icon: "chart-no-axes-combined", tone: "" },
    { label: "Disciplinas", value: rows.length, icon: "library-big", tone: "purple" },
    { label: "Situação", value: general === null ? "Aguardando" : general >= 6 ? "Na média" : "Atenção", icon: general !== null && general >= 6 ? "circle-check" : "triangle-alert", tone: general !== null && general >= 6 ? "success" : "warning" }
  ].map(metricCard).join("");
  refreshIcons();
}

function renderStudentAttendance(state) {
  const grouped = groupBy(state.attendance, (record) => record.subjects?.name ?? "Disciplina");
  const cards = Object.entries(grouped).map(([subject, records]) => {
    const present = records.filter((record) => record.status === "presente").length;
    const justified = records.filter((record) => record.status === "justificada").length;
    const absences = records.filter((record) => record.status === "falta").length;
    const frequency = records.length ? ((present + justified) / records.length) * 100 : 0;
    return { subject, present, absences, justified, frequency };
  });
  const all = state.attendance;
  const validPresence = all.filter((record) => record.status !== "falta").length;
  const totalFrequency = all.length ? (validPresence / all.length) * 100 : 0;
  $("#student-attendance-summary").innerHTML = [
    { label: "Frequência geral", value: all.length ? `${totalFrequency.toFixed(1)}%` : "—", icon: "calendar-check", tone: "success" },
    { label: "Presenças", value: all.filter((item) => item.status === "presente").length, icon: "circle-check", tone: "" },
    { label: "Faltas", value: all.filter((item) => item.status === "falta").length, icon: "circle-x", tone: "warning" }
  ].map(metricCard).join("");
  $("#student-attendance-list").innerHTML = cards.length ? cards.map((item) => `<article class="attendance-card"><div class="attendance-card-head"><h3>${escapeHTML(item.subject)}</h3><span class="status-badge ${item.frequency >= 75 ? "status-success" : "status-danger"}">${item.frequency.toFixed(1)}%</span></div><div class="progress-track"><i style="width:${item.frequency}%;background:${item.frequency >= 75 ? "var(--success)" : "var(--danger)"}"></i></div><div class="attendance-card-meta"><span>${item.present} presenças</span><span>${item.absences} faltas${item.justified ? ` · ${item.justified} justificadas` : ""}</span></div></article>`).join("") : `<div class="table-card"><div class="empty-state"><i data-lucide="calendar-search"></i><h3>Nenhuma frequência registrada</h3><p>Os dados aparecerão após a primeira chamada.</p></div></div>`;
  refreshIcons();
}

function populateSelects(state) {
  const classOptions = state.classes.map((item) => `<option value="${item.id}">${escapeHTML(item.name)} — ${escapeHTML(shiftLabel(item.shift))}</option>`).join("");
  $("#person-class-select").innerHTML = `<option value="">Selecione uma turma</option>${classOptions}`;
  $("#grade-class-filter").innerHTML = `<option value="todos">Todas as turmas</option>${classOptions}`;
  $("#attendance-class-filter").innerHTML = `<option value="todos">Todas as turmas</option>${classOptions}`;
  $("#class-course-select").innerHTML = `<option value="">Selecione um curso</option>${state.courses.map((item) => `<option value="${item.id}">${escapeHTML(item.code)} — ${escapeHTML(item.name)}</option>`).join("")}`;

  const studentOptions = state.students.map((student) => `<option value="${student.id}">${escapeHTML(student.profiles?.full_name ?? student.registration)} — ${escapeHTML(student.classes?.name ?? "Sem turma")}</option>`).join("");
  $("#grade-student-select").innerHTML = `<option value="">Selecione um aluno</option>${studentOptions}`;
  $("#attendance-student-select").innerHTML = `<option value="">Selecione um aluno</option>${studentOptions}`;
  const subjectOptions = state.subjects.map((subject) => `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`).join("");
  $("#grade-subject-select").innerHTML = `<option value="">Selecione uma disciplina</option>${subjectOptions}`;
  $("#attendance-subject-select").innerHTML = `<option value="">Selecione uma disciplina</option>${subjectOptions}`;
  $("#assignment-class-select").innerHTML = `<option value="">Selecione uma turma</option>${classOptions}`;
  $("#assignment-subject-select").innerHTML = `<option value="">Selecione uma disciplina</option>${subjectOptions}`;
  const teacherOptions = state.people.filter((person) => person.role === "professor").map((person) => `<option value="${person.id}">${escapeHTML(person.full_name)}</option>`).join("");
  $("#assignment-teacher-select").innerHTML = `<option value="">Selecione um professor</option>${teacherOptions}`;
}

async function submitPerson(event, state) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  const values = Object.fromEntries(new FormData(form));
  setFormError($("#person-form-error"), "");
  setButtonLoading(button, true, "Cadastrando...");
  const { data, error } = await state.supabase.functions.invoke("manage-user", { body: { action: "create", ...values } });
  setButtonLoading(button, false, "Cadastrar pessoa");
  if (error || data?.error) {
    setFormError($("#person-form-error"), data?.error ?? error?.message ?? "Não foi possível cadastrar a pessoa.");
    return;
  }
  $("#person-dialog").close();
  form.reset();
  updatePersonFields();
  await loadAllData(state);
  toast("Pessoa cadastrada", "A conta já pode acessar o portal.", "success");
}

async function deletePerson(state, userId) {
  setLoading(true);
  const { data, error } = await state.supabase.functions.invoke("manage-user", { body: { action: "delete", user_id: userId } });
  setLoading(false);
  if (error || data?.error) {
    toast("Não foi possível excluir", data?.error ?? error?.message ?? "Tente novamente.", "error");
    return;
  }
  await loadAllData(state);
  toast("Pessoa excluída", "A conta e os dados vinculados foram removidos.", "success");
}

async function submitClass(event, state) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const course = state.courses.find((item) => item.id === values.course_id);
  const name = `${course?.code ?? "TURMA"} ${values.module} — ${shiftLabel(values.shift)}`;
  setFormError($("#class-form-error"), "");
  const { error } = await state.supabase.from("classes").insert({ ...values, module: Number(values.module), school_year: Number(values.school_year), name });
  if (error) {
    setFormError($("#class-form-error"), error.code === "23505" ? "Essa turma já está cadastrada." : error.message);
    return;
  }
  $("#class-dialog").close();
  await loadAllData(state);
  toast("Turma criada", `${name} foi adicionada ao sistema.`, "success");
}

function openGradeDialog(state, grade = null) {
  const form = $("#grade-form");
  form.reset();
  setFormError($("#grade-form-error"), "");
  if (grade) {
    form.id.value = grade.id;
    form.student_id.value = grade.student_id;
    updateSubjectSelectForStudent(state, "#grade-student-select", "#grade-subject-select");
    form.subject_id.value = grade.subject_id;
    form.term.value = grade.term;
    form.score.value = grade.score;
    form.assessment.value = grade.assessment;
    $("h2", $("#grade-dialog")).textContent = "Editar nota";
  } else {
    form.id.value = "";
    $("h2", $("#grade-dialog")).textContent = "Lançar nota";
  }
  openDialog("grade-dialog");
}

async function submitGrade(event, state) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const payload = { student_id: values.student_id, subject_id: values.subject_id, term: Number(values.term), score: Number(values.score), assessment: values.assessment, teacher_id: state.profile.id };
  setFormError($("#grade-form-error"), "");
  const query = values.id ? state.supabase.from("grades").update(payload).eq("id", values.id) : state.supabase.from("grades").insert(payload);
  const { error } = await query;
  if (error) {
    setFormError($("#grade-form-error"), error.message);
    return;
  }
  $("#grade-dialog").close();
  await loadAllData(state);
  toast(values.id ? "Nota atualizada" : "Nota lançada", "O boletim do aluno já foi atualizado.", "success");
}

async function deleteGrade(state, id) {
  const { error } = await state.supabase.from("grades").delete().eq("id", id);
  if (error) toast("Erro ao excluir", error.message, "error");
  else {
    await loadAllData(state);
    toast("Nota excluída", "O boletim foi atualizado.", "success");
  }
}

function openAttendanceDialog(state, record = null) {
  const form = $("#attendance-form");
  form.reset();
  setFormError($("#attendance-form-error"), "");
  form.attendance_date.value = isoDate(new Date());
  if (record) {
    form.id.value = record.id;
    form.student_id.value = record.student_id;
    updateSubjectSelectForStudent(state, "#attendance-student-select", "#attendance-subject-select");
    form.subject_id.value = record.subject_id;
    form.attendance_date.value = record.attendance_date;
    form.status.value = record.status;
    form.notes.value = record.notes ?? "";
    $("h2", $("#attendance-dialog")).textContent = "Editar frequência";
  } else {
    form.id.value = "";
    $("h2", $("#attendance-dialog")).textContent = "Registrar frequência";
  }
  openDialog("attendance-dialog");
}

function openAssignmentDialog(state) {
  const form = $("#assignment-form");
  form.reset();
  setFormError($("#assignment-form-error"), "");
  fillSubjectSelect(state, $("#assignment-subject-select"), null);
  openDialog("assignment-dialog");
}

function updateSubjectSelectForStudent(state, studentSelector, subjectSelector) {
  const student = state.students.find((item) => item.id === $(studentSelector).value);
  const schoolClass = state.classes.find((item) => item.id === student?.class_id);
  fillSubjectSelect(state, $(subjectSelector), schoolClass?.course_id ?? null, schoolClass?.id ?? null);
}

function updateSubjectSelectForClass(state, classSelector, subjectSelector) {
  const schoolClass = state.classes.find((item) => item.id === $(classSelector).value);
  fillSubjectSelect(state, $(subjectSelector), schoolClass?.course_id ?? null, schoolClass?.id ?? null);
}

function fillSubjectSelect(state, select, courseId, classId = null) {
  let subjects = courseId ? state.subjects.filter((item) => item.course_id === courseId) : state.subjects;
  if (state.profile?.role === "professor" && classId) {
    const allowed = new Set(state.teacherAssignments.filter((item) => item.class_id === classId).map((item) => item.subject_id));
    subjects = subjects.filter((item) => allowed.has(item.id));
  }
  select.innerHTML = `<option value="">Selecione uma disciplina</option>${subjects.map((subject) => `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`).join("")}`;
}

async function submitAttendance(event, state) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const payload = { student_id: values.student_id, subject_id: values.subject_id, attendance_date: values.attendance_date, status: values.status, notes: values.notes || null, teacher_id: state.profile.id };
  setFormError($("#attendance-form-error"), "");
  const query = values.id ? state.supabase.from("attendance").update(payload).eq("id", values.id) : state.supabase.from("attendance").upsert(payload, { onConflict: "student_id,subject_id,attendance_date" });
  const { error } = await query;
  if (error) {
    setFormError($("#attendance-form-error"), error.message);
    return;
  }
  $("#attendance-dialog").close();
  await loadAllData(state);
  toast("Frequência salva", "O histórico do aluno já foi atualizado.", "success");
}

async function deleteAttendance(state, id) {
  const { error } = await state.supabase.from("attendance").delete().eq("id", id);
  if (error) toast("Erro ao excluir", error.message, "error");
  else {
    await loadAllData(state);
    toast("Registro excluído", "A frequência foi recalculada.", "success");
  }
}

async function submitAssignment(event, state) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  setFormError($("#assignment-form-error"), "");
  const { error } = await state.supabase.from("teacher_assignments").insert(values);
  if (error) {
    setFormError($("#assignment-form-error"), error.code === "23505" ? "Este vínculo já existe." : error.message);
    return;
  }
  $("#assignment-dialog").close();
  form.reset();
  await loadAllData(state);
  toast("Professor vinculado", "A turma e a disciplina já estão disponíveis no acesso dele.", "success");
}

async function deleteAssignment(state, id) {
  const { error } = await state.supabase.from("teacher_assignments").delete().eq("id", id);
  if (error) toast("Erro ao remover", error.message, "error");
  else {
    await loadAllData(state);
    toast("Vínculo removido", "As permissões do professor foram atualizadas.", "success");
  }
}

function navigateTo(state, view) {
  const target = $(`[data-view-panel="${view}"]`);
  const nav = $(`.nav-item[data-view="${view}"]`);
  if (!target || nav?.classList.contains("hidden")) return;
  state.currentView = view;
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel === target));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const titles = {
    inicio: ["Portal acadêmico", "Visão geral"], pessoas: ["Administração", "Pessoas"], turmas: ["Gestão acadêmica", "Turmas"], notas: ["Gestão acadêmica", "Notas"], frequencia: ["Gestão acadêmica", "Frequência"], boletim: ["Área do aluno", "Meu boletim"], "minha-frequencia": ["Área do aluno", "Minha frequência"]
  };
  $("#page-kicker").textContent = titles[view]?.[0] ?? "Portal Escola";
  $("#page-title").textContent = titles[view]?.[1] ?? "Portal Escola";
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyRolePermissions(role) {
  $$('[data-roles]').forEach((element) => {
    const allowed = element.dataset.roles.split(",");
    element.classList.toggle("hidden", !allowed.includes(role));
  });
}

function updateUserIdentity(profile) {
  const shortName = profile.full_name.split(" ").slice(0, 2).join(" ");
  $("#sidebar-name").textContent = shortName;
  $("#sidebar-role").textContent = roleLabel(profile.role);
  $("#sidebar-avatar").textContent = initials(profile.full_name);
  $("#top-avatar").textContent = initials(profile.full_name);
  $("#top-avatar").title = profile.full_name;
}

function updatePersonFields() {
  const role = $("#person-form [name='role']").value;
  $$(".student-only").forEach((element) => element.classList.toggle("hidden", role !== "aluno"));
  $$(".teacher-only").forEach((element) => element.classList.toggle("hidden", role !== "professor"));
  $$(".employee-only").forEach((element) => element.classList.toggle("hidden", role !== "funcionario"));
  $("#person-class-select").required = role === "aluno";
}

function showAuth() {
  appShell.classList.add("hidden");
  setupScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  $("#login-password").value = "";
  refreshIcons();
}

function applySavedTheme() {
  const saved = localStorage.getItem("escola-theme");
  const theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  updateThemeIcons();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("escola-theme", next);
  updateThemeIcons();
}

function updateThemeIcons() {
  const icon = document.documentElement.dataset.theme === "dark" ? "sun" : "moon";
  $$(".theme-toggle").forEach((button) => { button.innerHTML = `<i data-lucide="${icon}"></i>`; });
  refreshIcons();
}

function confirmAction(state, title, message, callback) {
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  state.confirmCallback = callback;
  openDialog("confirm-dialog");
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
  refreshIcons();
}

function setLoading(active) { $("#loading-state").classList.toggle("hidden", !active); }
function closeSidebar() { $("#sidebar").classList.remove("open"); }

function setButtonLoading(button, active, text) {
  button.disabled = active;
  const label = $("span", button);
  if (label) label.textContent = text;
  else button.textContent = text;
}

function setFormError(element, message) {
  element.textContent = message;
  element.classList.toggle("hidden", !message);
}

function toggleEmpty(body, empty, isEmpty) {
  body.closest(".table-scroll").classList.toggle("hidden", isEmpty);
  empty.classList.toggle("hidden", !isEmpty);
}

function toast(title, message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.innerHTML = `<i data-lucide="${type === "success" ? "circle-check" : "circle-alert"}"></i><span><strong>${escapeHTML(title)}</strong><span>${escapeHTML(message)}</span></span>`;
  $("#toast-region").appendChild(element);
  refreshIcons();
  setTimeout(() => element.remove(), 4200);
}

function refreshIcons() { window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } }); }
function getSpecializedProfile(person) { return person.role === "aluno" ? person.students?.[0] : person.role === "professor" ? person.teachers?.[0] : person.employees?.[0]; }
function groupBy(items, keyFn) { return items.reduce((groups, item) => { const key = keyFn(item); (groups[key] ||= []).push(item); return groups; }, {}); }
function initials(name = "") { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase(); }
function normalize(value = "") { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function roleLabel(role) { return ({ aluno: "Aluno", professor: "Professor", funcionario: "Funcionário" })[role] ?? role; }
function shiftLabel(shift) { return ({ manha: "Manhã", tarde: "Tarde", noite: "Noite" })[shift] ?? shift; }
function attendanceLabel(status) { return ({ presente: "Presente", falta: "Falta", justificada: "Justificada" })[status] ?? status; }
function attendanceTone(status) { return status === "presente" ? "status-success" : status === "justificada" ? "status-warning" : "status-danger"; }
function formatDate(value) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function friendlyAuthError(message) { return /Invalid login credentials/i.test(message) ? "E-mail ou senha incorretos." : /Email not confirmed/i.test(message) ? "Confirme seu e-mail antes de entrar." : "Não foi possível entrar. Verifique os dados e tente novamente."; }
function escapeHTML(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
