/**
 * Memória de longo prazo (perfil do colaborador).
 *
 * Decisão de projeto: a extração é DETERMINÍSTICA e restrita a uma lista fechada de chaves (R09).
 * Um extrator por LLM pegaria mais variações de frase, mas abriria a porta para "memória envenenada"
 * (o usuário fazer o assistente guardar uma regra falsa ou uma instrução). Aqui, o que não cabe numa
 * chave permitida é rejeitado e auditado.
 */
import type { ProfileFact } from "../shared/types.ts";
import { matchesAny, normalize } from "../shared/text.ts";
import { INJECTION_SIGNALS, PII_PATTERNS, SECRET_SIGNALS } from "../rules/signals.ts";

type FactSchema = {
  chave: string;
  descricao: string;
  /** Recebe o texto normalizado (sem acento, minúsculo) e o original; devolve o valor ou undefined. */
  extrair: (norm: string, original: string) => string | undefined;
  /** Assuntos em que o fato é relevante; null = sempre relevante (fatos curtos de identificação). */
  assuntos: RegExp | null;
};

const AREAS: Record<string, { valor: string; tipo: "operacional" | "administrativa" }> = {
  gate: { valor: "Operações de Gate", tipo: "operacional" },
  portaria: { valor: "Operações de Gate", tipo: "operacional" },
  patio: { valor: "Pátio", tipo: "operacional" },
  cais: { valor: "Cais", tipo: "operacional" },
  armazem: { valor: "Armazém", tipo: "operacional" },
  manutencao: { valor: "Manutenção", tipo: "operacional" },
  "patio imo": { valor: "Pátio IMO", tipo: "operacional" },
  faturamento: { valor: "Comercial e Faturamento", tipo: "administrativa" },
  comercial: { valor: "Comercial e Faturamento", tipo: "administrativa" },
  ti: { valor: "TI", tipo: "administrativa" },
  tecnologia: { valor: "TI", tipo: "administrativa" },
  rh: { valor: "RH", tipo: "administrativa" },
  "recursos humanos": { valor: "RH", tipo: "administrativa" },
  financeiro: { valor: "Financeiro", tipo: "administrativa" },
  ssma: { valor: "SSMA", tipo: "administrativa" },
  qualidade: { valor: "Qualidade Operacional", tipo: "administrativa" },
  "seguranca patrimonial": { valor: "Segurança Patrimonial", tipo: "operacional" },
};

const AREA_KEYS = Object.keys(AREAS).sort((a, b) => b.length - a.length).join("|");
const AREA_RE = new RegExp(`\\b(?:trabalho|atuo|sou|estou|fico|entrei)\\s+(?:no|na|da|do|em|para o|para a)\\s+(?:area d[aeo]\\s+|setor d[aeo]\\s+|equipe d[aeo]\\s+)?(${AREA_KEYS})\\b`);

const CARGOS = "operador(?:a)?|conferente|analista|supervisor(?:a)?|assistente|tecnic[oa]|estagiari[oa]|gestor(?:a)?|coordenador(?:a)?|motorista|vigilante|brigadista|engenheir[oa]";

function capitalize(text: string): string {
  return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export const FACT_SCHEMA: readonly FactSchema[] = [
  {
    chave: "nome",
    descricao: "como o colaborador quer ser chamado",
    extrair: (_norm, original) => {
      const m = original.match(/\b(?:meu nome [ée]|me chamo|pode me chamar de)\s+([\p{L}]{2,20})/iu);
      return m ? capitalize(m[1]!.toLowerCase()) : undefined;
    },
    assuntos: null,
  },
  {
    chave: "area",
    descricao: "área ou setor onde trabalha",
    extrair: (norm) => {
      const m = norm.match(AREA_RE);
      return m ? AREAS[m[1]!]!.valor : undefined;
    },
    assuntos: null,
  },
  {
    chave: "tipo_area",
    descricao: "área operacional ou administrativa (deriva da área ou é dita pelo usuário)",
    extrair: (norm) => {
      const explicit = norm.match(/\barea (operacional|administrativa)\b/);
      if (explicit) return explicit[1];
      const m = norm.match(AREA_RE);
      return m ? AREAS[m[1]!]!.tipo : undefined;
    },
    assuntos: /\b(hibrid\w*|remot\w*|home ?office|de casa|jornada|turno|escala|horario|epis?|equipamentos? de protecao|patio|trabalhar)\b/,
  },
  {
    chave: "cargo",
    descricao: "função exercida",
    extrair: (norm) => {
      const m = norm.match(new RegExp(`\\bsou (?:o |a |um |uma )?(${CARGOS})(?: de ([a-z]+(?: [a-z]+)?))?\\b`));
      if (!m) return undefined;
      return m[2] && !/^(experiencia|area|setor)/.test(m[2]) ? `${m[1]} de ${m[2]}` : m[1];
    },
    assuntos: null,
  },
  {
    chave: "turno",
    descricao: "turno de trabalho informado",
    extrair: (norm) => {
      const m = norm.match(/\bturno (?:d[ao]s? )?(\d{1,2})\s*h?\s*(?:as|a|-|ate)\s*(\d{1,2})\s*h?\b/);
      if (m) return `${m[1]!.padStart(2, "0")}h-${m[2]!.padStart(2, "0")}h`;
      const p = norm.match(/\bturno d[ae] (madrugada|manha|tarde|noite)\b/);
      return p ? `turno da ${p[1]!.replace("manha", "manhã")}` : undefined;
    },
    assuntos: /\b(turno|jornada|escala|horario|troca|folga|6x1|hora extra|banco de horas)\b/,
  },
  {
    chave: "vinculo",
    descricao: "empregado próprio ou terceirizado",
    extrair: (norm) => {
      if (/\b(sou|como) (um |uma )?(terceirizad[oa]|prestador(a)? de servico)\b/.test(norm)) return "terceirizado";
      if (/\b(empregad[oa] propri[oa]|sou clt|contratad[oa] diret[oa])\b/.test(norm)) return "empregado próprio";
      return undefined;
    },
    assuntos: /\b(credencia\w*|aso|acesso|catraca|integracao|segunda via|desconto|reembolso|beneficio\w*)\b/,
  },
  {
    chave: "experiencia",
    descricao: "se está no período de experiência (informado pelo usuário)",
    extrair: (norm) =>
      /\b(sou nov[oa] (aqui|na empresa|no porto|no terminal)?|acabei de (entrar|ser contratad[oa])|entrei (ontem|hoje|semana passada|mes passado|ha \d+ dias)|(estou|to) (no periodo de |em )?experiencia|minha primeira semana|primeiro dia)\b/.test(
        norm,
      )
        ? "em período de experiência"
        : undefined,
    assuntos: /\b(hibrid\w*|remot\w*|home ?office|de casa|experiencia|beneficio\w*|vale|plano de saude|integracao|treinamento\w*|trilha|primeir[oa]|ferias|credencia\w*)\b/,
  },
  {
    chave: "preferencia_formato",
    descricao: "como prefere receber as respostas",
    extrair: (norm) => {
      const m = norm.match(/\bprefiro (respostas? )?(curtas?|resumidas?|em topicos|detalhadas?|passo a passo)\b/);
      return m ? m[2]!.replace("topicos", "tópicos") : undefined;
    },
    assuntos: null,
  },
];

export const ALLOWED_KEYS = FACT_SCHEMA.map((f) => f.chave);

export type Extraction = {
  gravar: ProfileFact[];
  rejeitados: { trecho: string; motivo: string }[];
};

/** Pedido explícito para guardar algo ("memorize que...", "lembre que..."). */
const REMEMBER_REQUEST = /\b(memorize|memoriza|lembre(?:-se)?|lembra|guarde|guarda|anote|anota|grave|salve|registre)\b(?: (?:de |isso|para sempre))?\s*(?:que|:)\s*(.+)$/;

/**
 * Extrai fatos de perfil de uma mensagem JÁ MASCARADA (sem CPF, telefone ou e-mail pessoal).
 * Regras de gravação (R05, R06, R09):
 * - só chaves da lista fechada FACT_SCHEMA;
 * - nada que pareça senha, documento ou instrução;
 * - pedidos de "memorize que <regra da empresa>" são rejeitados: fatos da empresa vêm dos documentos.
 */
export function extractFacts(maskedText: string): Extraction {
  const norm = normalize(maskedText);
  const rejeitados: Extraction["rejeitados"] = [];

  if (matchesAny(maskedText, SECRET_SIGNALS)) {
    return { gravar: [], rejeitados: [{ trecho: "[senha]", motivo: "R06: senhas nunca são guardadas" }] };
  }

  const gravar: ProfileFact[] = [];
  for (const schema of FACT_SCHEMA) {
    const valor = schema.extrair(norm, maskedText);
    if (!valor) continue;
    if (PII_PATTERNS.some((p) => new RegExp(p.re.source).test(valor)) || /removido/i.test(valor)) {
      rejeitados.push({ trecho: schema.chave, motivo: "R06: valor contém dado pessoal sensível" });
      continue;
    }
    gravar.push({ chave: schema.chave, valor });
  }

  const remember = norm.match(REMEMBER_REQUEST);
  if (remember) {
    const pedido = remember[2]!.trim();
    const coberto = FACT_SCHEMA.some((s) => s.extrair(pedido, pedido) !== undefined);
    if (!coberto) {
      const motivo = matchesAny(pedido, INJECTION_SIGNALS)
        ? "R05: a memória não aceita instruções"
        : "R09: a memória só guarda dados de perfil; regras e fatos da empresa vêm dos documentos oficiais";
      rejeitados.push({ trecho: pedido.slice(0, 80), motivo });
    }
  }

  return { gravar, rejeitados };
}

export type RelevantFact = ProfileFact & { motivo: string };

/**
 * Seleciona os fatos relevantes para ESTA pergunta (memória relevante, não memória total):
 * identificação curta sempre entra; os demais só quando o assunto da pergunta casa com o do fato.
 */
export function selectRelevantFacts(facts: ProfileFact[], question: string, max: number): RelevantFact[] {
  const norm = normalize(question);
  const selected: RelevantFact[] = [];
  for (const schema of FACT_SCHEMA) {
    const fact = facts.find((f) => f.chave === schema.chave);
    if (!fact) continue;
    if (schema.assuntos === null) selected.push({ ...fact, motivo: "identificação (sempre)" });
    else {
      const hit = norm.match(schema.assuntos);
      if (hit) selected.push({ ...fact, motivo: `assunto da pergunta: "${hit[0]}"` });
    }
  }
  return selected.slice(0, max);
}
