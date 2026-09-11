import { withSupabase } from "npm:@supabase/server@^1";
console.info("manage-user iniciado");
export default {
  fetch: withSupabase({
    auth: "user"
  }, async (req, ctx)=>{
    try {
      const body = await req.json();
      // =====================================================
      // VERIFICA QUEM ESTÁ CHAMANDO A FUNÇÃO
      // =====================================================
      const callerId = ctx.userClaims?.sub ?? ctx.userClaims?.id;
      if (!callerId) {
        return Response.json({
          error: "Usuário não autenticado."
        }, {
          status: 401
        });
      }
      // =====================================================
      // VERIFICA SE É FUNCIONÁRIO
      // =====================================================
      const { data: perfil, error: perfilErro } = await ctx.supabaseAdmin.from("perfis").select("id, tipo_usuario, situacao").eq("id", callerId).single();
      if (perfilErro || !perfil) {
        console.error("Erro ao localizar perfil:", perfilErro);
        return Response.json({
          error: "Não foi possível verificar seu perfil."
        }, {
          status: 403
        });
      }
      if (perfil.tipo_usuario !== "funcionario") {
        return Response.json({
          error: "Você não possui permissão para gerenciar usuários."
        }, {
          status: 403
        });
      }
      if (perfil.situacao !== "ativo") {
        return Response.json({
          error: "Seu acesso administrativo está inativo."
        }, {
          status: 403
        });
      }
      // =====================================================
// ALTERAR E-MAIL E/OU SENHA
// =====================================================
if (body.action === "update_credentials") {
  const userId =
    typeof body.user_id === "string"
      ? body.user_id.trim()
      : "";

  const novoEmail =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";

  const novaSenha =
    typeof body.password === "string"
      ? body.password
      : "";

  if (!userId) {
    return Response.json(
      {
        error: "ID do usuário não informado."
      },
      {
        status: 400
      }
    );
  }

  if (
    !novoEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail)
  ) {
    return Response.json(
      {
        error: "Informe um e-mail válido."
      },
      {
        status: 400
      }
    );
  }

  if (novaSenha && novaSenha.length < 6) {
    return Response.json(
      {
        error: "A nova senha deve possuir no mínimo 6 caracteres."
      },
      {
        status: 400
      }
    );
  }

  const {
    data: perfilAlvo,
    error: perfilAlvoErro
  } = await ctx.supabaseAdmin
    .from("perfis")
    .select("id, email, tipo_usuario")
    .eq("id", userId)
    .maybeSingle();

  if (perfilAlvoErro || !perfilAlvo) {
    return Response.json(
      {
        error: "O aluno ou professor selecionado não foi encontrado."
      },
      {
        status: 404
      }
    );
  }

  if (
    !["aluno", "professor"].includes(
      perfilAlvo.tipo_usuario
    )
  ) {
    return Response.json(
      {
        error: "Só é permitido alterar o acesso de alunos e professores."
      },
      {
        status: 403
      }
    );
  }

  const emailMudou =
    novoEmail !== perfilAlvo.email.toLowerCase();

  if (emailMudou) {
    const {
      data: donoDoEmail,
      error: verificarEmailErro
    } = await ctx.supabaseAdmin
      .from("perfis")
      .select("id")
      .eq("email", novoEmail)
      .neq("id", userId)
      .maybeSingle();

    if (verificarEmailErro) {
      console.error(
        "Erro ao verificar novo e-mail:",
        verificarEmailErro
      );

      return Response.json(
        {
          error: "Não foi possível verificar o novo e-mail."
        },
        {
          status: 400
        }
      );
    }

    if (donoDoEmail) {
      return Response.json(
        {
          error: "Este e-mail já está sendo usado por outra pessoa."
        },
        {
          status: 409
        }
      );
    }
  }

  const atualizacoes: {
    email?: string;
    email_confirm?: boolean;
    password?: string;
  } = {};

  if (emailMudou) {
    atualizacoes.email = novoEmail;
    atualizacoes.email_confirm = true;
  }

  if (novaSenha) {
    atualizacoes.password = novaSenha;
  }

  if (Object.keys(atualizacoes).length === 0) {
    return Response.json({
      success: true,
      changed: false,
      message: "Nenhuma alteração foi necessária."
    });
  }

  const {
    error: atualizarAuthErro
  } = await ctx.supabaseAdmin.auth.admin.updateUserById(
    userId,
    atualizacoes
  );

  if (atualizarAuthErro) {
    console.error(
      "Erro ao atualizar Authentication:",
      atualizarAuthErro
    );

    let mensagem = atualizarAuthErro.message;

    if (
      /already registered|already exists/i.test(
        mensagem
      )
    ) {
      mensagem = "Já existe uma conta com este e-mail.";
    }

    return Response.json(
      {
        error: mensagem
      },
      {
        status: 400
      }
    );
  }

  if (emailMudou) {
    const {
      error: atualizarPerfilErro
    } = await ctx.supabaseAdmin
      .from("perfis")
      .update({
        email: novoEmail
      })
      .eq("id", userId);

    if (atualizarPerfilErro) {
      console.error(
        "Erro ao atualizar perfil:",
        atualizarPerfilErro
      );

      // Volta o e-mail do Authentication caso o perfil falhe.
      await ctx.supabaseAdmin.auth.admin.updateUserById(
        userId,
        {
          email: perfilAlvo.email,
          email_confirm: true
        }
      );

      return Response.json(
        {
          error: "Não foi possível atualizar o e-mail do perfil."
        },
        {
          status: 400
        }
      );
    }
  }

  return Response.json({
    success: true,
    changed: true,
    message:
      emailMudou && novaSenha
        ? "E-mail e senha atualizados com sucesso."
        : emailMudou
          ? "E-mail atualizado com sucesso."
          : "Senha atualizada com sucesso."
  });
}
      // =====================================================
      // EXCLUIR PESSOA
      // =====================================================
      if (body.action === "delete") {
        if (!body.user_id) {
          return Response.json({
            error: "ID do usuário não informado."
          }, {
            status: 400
          });
        }
        // Impede o funcionário de excluir a própria conta
        if (body.user_id === callerId) {
          return Response.json({
            error: "Você não pode excluir sua própria conta."
          }, {
            status: 400
          });
        }
        const { error: deleteError } = await ctx.supabaseAdmin.auth.admin.deleteUser(body.user_id);
        if (deleteError) {
          console.error("Erro ao excluir usuário:", deleteError);
          return Response.json({
            error: deleteError.message
          }, {
            status: 400
          });
        }
        return Response.json({
          success: true,
          message: "Pessoa excluída com sucesso."
        });
      }
      // =====================================================
      // CRIAR PESSOA
      // =====================================================
      if (body.action !== "create") {
        return Response.json({
          error: "Ação inválida."
        }, {
          status: 400
        });
      }
      const { full_name, email, password, role, registration, class_id, specialty, job_title, department } = body;
      // =====================================================
      // VALIDAÇÕES
      // =====================================================
      if (!full_name?.trim()) {
        return Response.json({
          error: "Informe o nome completo."
        }, {
          status: 400
        });
      }
      if (!email?.trim()) {
        return Response.json({
          error: "Informe o e-mail."
        }, {
          status: 400
        });
      }
      if (!password) {
        return Response.json({
          error: "Informe a senha inicial."
        }, {
          status: 400
        });
      }
      if (password.length < 6) {
        return Response.json({
          error: "A senha deve possuir no mínimo 6 caracteres."
        }, {
          status: 400
        });
      }
      if (!role || ![
        "aluno",
        "professor",
        "funcionario"
      ].includes(role)) {
        return Response.json({
          error: "Selecione um perfil válido."
        }, {
          status: 400
        });
      }
      if (!registration?.trim()) {
        return Response.json({
          error: "Informe a matrícula."
        }, {
          status: 400
        });
      }
      if (role === "aluno" && !class_id) {
        return Response.json({
          error: "Selecione uma turma para o aluno."
        }, {
          status: 400
        });
      }
      // =====================================================
      // CRIAR USUÁRIO NO SUPABASE AUTH
      // =====================================================
      const { data: authData, error: authError } = await ctx.supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: {
          nome_completo: full_name.trim(),
          tipo_usuario: role
        }
      });
      if (authError) {
        console.error("Erro no Authentication:", authError);
        let mensagem = authError.message;
        if (/already registered|already exists/i.test(mensagem)) {
          mensagem = "Já existe uma conta com este e-mail.";
        }
        return Response.json({
          error: mensagem
        }, {
          status: 400
        });
      }
      if (!authData.user) {
        return Response.json({
          error: "O usuário não foi criado."
        }, {
          status: 500
        });
      }
      const novoUsuarioId = authData.user.id;
      try {
        // ===================================================
        // PERFIL GERAL
        // ===================================================
        const { error: inserirPerfilErro } = await ctx.supabaseAdmin.from("perfis").insert({
          id: novoUsuarioId,
          nome_completo: full_name.trim(),
          email: email.trim().toLowerCase(),
          tipo_usuario: role,
          situacao: "ativo"
        });
        if (inserirPerfilErro) {
          throw inserirPerfilErro;
        }
        // ===================================================
        // ALUNO
        // ===================================================
        if (role === "aluno") {
          const { error: alunoErro } = await ctx.supabaseAdmin.from("alunos").insert({
            perfil_id: novoUsuarioId,
            matricula: registration.trim(),
            turma_id: class_id
          });
          if (alunoErro) {
            throw alunoErro;
          }
        }
        // ===================================================
        // PROFESSOR
        // ===================================================
        if (role === "professor") {
          const { error: professorErro } = await ctx.supabaseAdmin.from("professores").insert({
            perfil_id: novoUsuarioId,
            matricula: registration.trim(),
            especialidade: specialty?.trim() || null
          });
          if (professorErro) {
            throw professorErro;
          }
        }
        // ===================================================
        // FUNCIONÁRIO
        // ===================================================
        if (role === "funcionario") {
          const { error: funcionarioErro } = await ctx.supabaseAdmin.from("funcionarios").insert({
            perfil_id: novoUsuarioId,
            matricula: registration.trim(),
            cargo: job_title?.trim() || null,
            departamento: department?.trim() || null
          });
          if (funcionarioErro) {
            throw funcionarioErro;
          }
        }
        // ===================================================
        // SUCESSO
        // ===================================================
        return Response.json({
          success: true,
          message: "Pessoa cadastrada com sucesso.",
          user_id: novoUsuarioId
        });
      } catch (databaseError) {
        console.error("Erro ao gravar no banco:", databaseError);
        // Se deu erro no banco, remove também
        // o usuário criado no Authentication.
        await ctx.supabaseAdmin.auth.admin.deleteUser(novoUsuarioId);
        const message = databaseError instanceof Error ? databaseError.message : "Erro ao cadastrar os dados da pessoa.";
        return Response.json({
          error: message
        }, {
          status: 400
        });
      }
    } catch (error) {
      console.error("Erro na função manage-user:", error);
      return Response.json({
        error: error instanceof Error ? error.message : "Erro interno do servidor."
      }, {
        status: 500
      });
    }
  })
};
