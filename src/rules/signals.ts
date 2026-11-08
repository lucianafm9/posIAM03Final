/**
 * Forma verificável das regras: sinais determinísticos aplicados sobre texto NORMALIZADO
 * (minúsculo, sem acentos, sem caracteres invisíveis; ver shared/text.ts), por isso escritos sem acentos.
 * A execução e a memória decidem QUANDO aplicá-los; aqui só se define O QUÊ.
 */

// ------------------------------------------------------------------ ENTRADA (mensagem do usuário)

/** R03: acidente, vazamento, incêndio ou pessoa em risco agora. */
export const EMERGENCY_SIGNALS: RegExp[] = [
  /\b(vazando|vazamento (agora|aqui|no|na)|esta vazando|cheiro forte de (gas|produto|combustivel))\b/,
  /\b(pegando fogo|incendio|fogo no|fogo na|explosao|explodiu|fumaca saindo)\b/,
  /\b(acidente|atropel\w*|tombou|caiu|esmagad\w*|prensad\w*)\b.{0,60}\b(ferid\w*|vitima|sangrando|machucad\w*|nao se mexe|desacordad\w*|inconsciente)\b/,
  /\b(ferid\w*|vitima|sangrando|machucad\w*|desmaiou|inconsciente|desacordad\w*)\b.{0,60}\b(patio|cais|gate|armazem|reach stacker|portainer|porteiner|portaineres|caminhao|empilhadeira|agora)\b/,
  /\b(alguem|colega|motorista|operador|trabalhador) (se )?(feriu|machucou|caiu|desmaiou|foi atropelad\w*)\b/,
  /\b(socorro|emergencia agora|urgente.{0,20}(ferido|vazamento|fogo))\b/,
];

/** R05: tentativas de manipular o assistente (injeção direta, troca de papel, autoridade alegada). */
export const INJECTION_SIGNALS: RegExp[] = [
  /\b(ignore|ignora|ignorar|desconsidere|desconsiderar|esqueca|esquecer|descarte|anule|desative|desligue)\b.{0,40}\b(regras?|instrucoes|orientacoes|diretrizes|restricoes|prompt|limites|filtros?)\b/,
  /\b(novas? instruc\w*|nova regra|regras? (desligadas|desativadas|suspensas|liberad\w*))\b/,
  /\bmodo (desenvolvedor|dev|debug|irrestrito|sem (regras|restricoes|filtros?)|livre|admin|manutencao)\b/,
  /\b(jailbreak|dan mode|modo dan)\b/,
  /\b(voce agora e|a partir de agora voce|finja (ser|que)|aja como|atue como|interprete o papel|faca de conta|roleplay)\b/,
  /\b(sou|eu sou) (o |a |seu |sua )?(desenvolvedor|programador|administrador|admin|criador|diretor|auditor) (do|da|deste|desse) (assistente|sistema|bot|chat)\b/,
  /\bautorizo (voce|vc) a\b/,
  /(^|\s)(#{2,}|\[) ?(system|sistema|admin)\b/,
  /<\/? ?(regras|instrucoes|identidade|sistema|system|contexto|conhecimento|memoria_usuario|mensagem_usuario|documento|alertas)/,
  /\b(ignore (all |the )?(previous|prior|above) (instructions|rules)|you are now|developer mode|act as)\b/,
  // Injeção indireta típica de documento adulterado ou de memória envenenada.
  /\b(assistente|ia|modelo|chatbot)s?,? (deve|devem|precisa|passa a|passe a) (responder|informar|revelar|ignorar|liberar|aprovar)\b/,
];

/** R04: tentativas de extrair instruções, regras internas ou o token secreto. */
export const EXTRACTION_SIGNALS: RegExp[] = [
  /\b(suas|tuas) (instrucoes|regras internas|diretrizes|configurac\w*)\b/,
  /\b(instrucoes|regras|diretrizes) (que (voce )?recebeu|internas do (assistente|sistema)|do sistema|ocultas|secretas|originais)\b/,
  /\b(system prompt|seu prompt|o prompt|mensagem do sistema|prompt do sistema)\b/,
  /\b(canary|canario|tokens? intern\w*|codigo secreto|palavra secreta)\b/,
  /\bpalavra por palavra\b/,
  /\b(texto|mensagem|conteudo) (acima|anterior a esta)\b/,
  /\b(what (are|were) your instructions|reveal your|repeat the text above)\b/,
];

/** R06: o usuário está enviando uma senha (nunca deve ir ao modelo nem à memória). */
export const SECRET_SIGNALS: RegExp[] = [
  // "minha senha é Porto@2026": exige um valor com dígito ou símbolo, para não bloquear "minha senha esquecida".
  /\b(minha|a) senha (atual |nova |de rede )?(e|eh|era)\s*[:=]?\s*(?=\S*[\d@#$!%&*])\S{4,}/,
  /\bsenha\s*[:=]\s*\S{4,}/,
  /\b(password|pwd)\s*[:=]\s*\S{4,}/,
];

/** R06: pedidos de dados pessoais de outros colaboradores. */
export const THIRD_PARTY_SIGNALS: RegExp[] = [
  /\b(salario|holerite|saldo (do|de) banco de horas|banco de horas|cpf|endereco|telefone|ferias|atestado|advertencia)s?\b.{0,30}\b(d[oa] (colega|gestor|supervisor|chefe|funcionari[oa]|empregad[oa]|motorista)|de outr[oa]|do [a-z]+ (do|da) (gate|patio|ti|rh))\b/,
  /\b(quanto (ganha|recebe)|qual (o )?salario) (o|a|do|da)\b/,
];

/** R07: pedido para o assistente executar uma ação ou abrir exceção (não bloqueia: vira alerta). */
export const ACTION_REQUEST_SIGNALS: RegExp[] = [
  /\b(desbloqueie|desbloquear|desbloqueia|libere|liberar|libera|aprove|aprovar|aprova|autorize|autorizar|abra uma excecao|abrir excecao|estenda|estender|prorrogue|prorrogar|cancele a cobranca)\b/,
];

/** Códigos, base64 ou texto ofuscado longo (possível payload escondido). */
export const ENCODED_PAYLOAD_SIGNALS: RegExp[] = [/[A-Za-z0-9+/]{40,}={0,2}/];

// ------------------------------------------------------------------ SAÍDA (resposta do modelo)

/** R07: o modelo afirma ter aprovado, liberado ou autorizado algo. */
export const AUTHORIZATION_CLAIMS: RegExp[] = [
  /\b(aprovei|aprovado por mim|liberei|desbloqueei|autorizei|ja (esta|foi) (aprovad|liberad|desbloquead|autorizad)\w*)\b/,
  /\b(vou (aprovar|liberar|desbloquear|autorizar|abrir uma excecao))\b/,
  /\b(excecao (concedida|aprovada|aberta))\b/,
];

/** R10: promessas e garantias. */
export const PROMISE_SIGNALS: RegExp[] = [/\b(garanto|garantimos|com certeza (sera|vai)|sem duvida (sera|vai)|100% garantid\w*)\b/];

/** Sinais de que a resposta tenta seguir uma instrução vinda de documento ou memória. */
export const COMPLIANCE_WITH_ATTACK: RegExp[] = [
  /\b(modo (desenvolvedor|irrestrito|admin)|regras desativadas|sem restricoes ativad\w*)\b/,
];

// ------------------------------------------------------------------ DADOS PESSOAIS

/** Padrões mascarados antes de qualquer texto ir ao modelo, à memória ou ao log. */
export const PII_PATTERNS: { tipo: string; re: RegExp }[] = [
  { tipo: "CPF", re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  { tipo: "E-MAIL PESSOAL", re: /\b[\w.+-]+@(?!portoventura\.example)[\w-]+\.[\w.]+\b/g },
  { tipo: "TELEFONE", re: /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g },
];

export function redactPii(text: string): { text: string; redactions: string[] } {
  const redactions: string[] = [];
  let result = text;
  for (const { tipo, re } of PII_PATTERNS) {
    result = result.replace(re, () => {
      redactions.push(tipo);
      return `[${tipo} REMOVIDO]`;
    });
  }
  return { text: result, redactions };
}
