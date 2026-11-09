import type { AnswerResult, Deps, PipelineMode } from "../execution/pipeline.ts";
import { answer } from "../execution/pipeline.ts";
import type { LlmClient } from "../shared/types.ts";
import type { Categoria, TestCase } from "./cases.ts";
import { checkCase, type CaseCheck } from "./evaluator.ts";
import { judge, type JudgeVerdict } from "./judge.ts";

/** Trechos que o sistema recuperou para a resposta (o juiz precisa deles para julgar a fundamentação). */
function evidence(result: AnswerResult): string {
  const dynamic = result.contexto?.messages.find((m) => m.role === "system" && m.content.startsWith("<memoria_usuario"))?.content ?? "";
  return dynamic.match(/<conhecimento[^>]*>\n([\s\S]*?)\n<\/conhecimento>/)?.[1] ?? "";
}

/** Execução de um caso de comportamento e consolidação das métricas (usado pelo runEvaluation e pelo npm test). */
export type RunRecord = CaseCheck & {
  desfecho: AnswerResult["desfecho"];
  decisao: AnswerResult["decisao"];
  resposta: string;
  fontes: string[];
  memoriaUsada: string[];
  llmChamado: boolean;
  tokens: number;
  metricas: AnswerResult["metricas"];
  trace: string[];
  juiz?: JudgeVerdict;
};

/**
 * Preço de tabela do gpt-4o-mini usado na estimativa de custo (US$ por 1 milhão de tokens).
 * Conferir em platform.openai.com/pricing antes de usar o número numa decisão real.
 */
export const PRICE_PER_MILLION = { entrada: 0.15, saida: 0.6 };

export type ModeSummary = {
  execucoes: number;
  acerto: number;
  porCategoria: Record<Categoria, { acerto: number; total: number }>;
  alucinacao: number;
  criticosSeguros: number;
  criticosTotal: number;
  consistencia: number;
  semChamarModelo: number;
  tokensMedios: number;
  operacao: {
    latenciaMedianaMs: number;
    latenciaP95Ms: number;
    /** Latência das respostas decididas sem modelo (bloqueio, emergência, memória, sem documento). */
    latenciaSemModeloMs: number;
    tokensEntradaMedios: number;
    tokensSaidaMedios: number;
    /** Custo estimado de 1.000 respostas na mistura de perguntas da avaliação (US$). */
    custoPorMilRespostasUsd: number;
  };
  juiz?: number;
};

export type EvaluationFile = {
  geradoEm: string;
  provedor: "openai" | "offline";
  modelo: string;
  embedder: string;
  runs: number;
  modos: Partial<Record<PipelineMode, { resumo: ModeSummary; casos: { id: string; categoria: Categoria; descricao: string; critico: boolean; runs: RunRecord[] }[] }>>;
};

export async function runCase(testCase: TestCase, deps: Deps, userId: string, structured: boolean, judgeLlm?: LlmClient): Promise<RunRecord> {
  if (testCase.sessaoAnterior) {
    const previous = deps.memory.startSession(userId);
    for (const t of testCase.sessaoAnterior) await answer(userId, previous, t, deps);
  }
  const session = deps.memory.startSession(userId);
  for (const t of testCase.turnos ?? []) await answer(userId, session, t, deps);

  const poisoned = testCase.documentoAdulterado;
  if (poisoned) {
    deps.knowledge.insert({
      docId: poisoned.docId,
      titulo: poisoned.titulo,
      tipo: "politica",
      secao: `${poisoned.docId} — ${poisoned.titulo} > Free time`,
      chunk: poisoned.texto,
      embeddings: await deps.embedder.embed(poisoned.texto),
      embedder: deps.embedder.name,
    });
  }
  let result: AnswerResult;
  try {
    result = await answer(userId, session, testCase.mensagem, deps);
  } finally {
    if (poisoned) deps.knowledge.deleteDoc(poisoned.docId);
  }

  const check = checkCase(testCase, result, structured);
  return {
    ...check,
    desfecho: result.desfecho,
    decisao: result.decisao,
    resposta: result.resposta,
    fontes: result.fontes.map((f) => f.docId),
    memoriaUsada: result.memoria.usada,
    llmChamado: result.llmChamado,
    tokens: result.contexto?.tokens ?? 0,
    metricas: result.metricas,
    trace: result.trace.map((s) => `${s.etapa} ${s.status}${s.regra ? ` ${s.regra}` : ""}: ${s.detalhe}`),
    ...(judgeLlm ? { juiz: await judge(judgeLlm, testCase, result.resposta, evidence(result)) } : {}),
  };
}

export function summarize(cases: { categoria: Categoria; critico: boolean; runs: RunRecord[] }[]): ModeSummary {
  const all = cases.flatMap((c) => c.runs);
  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
  const porCategoria = {} as ModeSummary["porCategoria"];
  for (const cat of ["conhecimento", "memoria", "fora_da_base", "seguranca"] as Categoria[]) {
    const runs = cases.filter((c) => c.categoria === cat).flatMap((c) => c.runs);
    porCategoria[cat] = { acerto: pct(runs.filter((r) => r.pass).length, runs.length), total: runs.length };
  }
  const criticos = cases.filter((c) => c.critico).flatMap((c) => c.runs);
  const consistentes = cases.filter((c) => c.runs.every((r) => r.pass === c.runs[0]!.pass && r.desfecho === c.runs[0]!.desfecho)).length;
  const judged = all.filter((r) => r.juiz);
  const called = all.filter((r) => r.tokens > 0);
  const percentile = (values: number[], p: number) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  };
  const withModel = all.filter((r) => r.llmChamado);
  const withoutModel = all.filter((r) => !r.llmChamado);
  const sum = (f: (r: RunRecord) => number) => all.reduce((s, r) => s + f(r), 0);
  const costPerAnswer = all.length
    ? (sum((r) => r.metricas.tokensEntrada) * PRICE_PER_MILLION.entrada + sum((r) => r.metricas.tokensSaida) * PRICE_PER_MILLION.saida) / 1_000_000 / all.length
    : 0;
  return {
    execucoes: all.length,
    acerto: pct(all.filter((r) => r.pass).length, all.length),
    porCategoria,
    alucinacao: pct(all.filter((r) => r.alucinacao).length, all.length),
    criticosSeguros: criticos.filter((r) => r.seguro && r.pass).length,
    criticosTotal: criticos.length,
    consistencia: pct(consistentes, cases.length),
    semChamarModelo: pct(all.filter((r) => !r.llmChamado).length, all.length),
    tokensMedios: called.length ? Math.round(called.reduce((s, r) => s + r.tokens, 0) / called.length) : 0,
    operacao: {
      latenciaMedianaMs: percentile(withModel.map((r) => r.metricas.latenciaMs), 50),
      latenciaP95Ms: percentile(withModel.map((r) => r.metricas.latenciaMs), 95),
      latenciaSemModeloMs: percentile(withoutModel.map((r) => r.metricas.latenciaMs), 50),
      tokensEntradaMedios: withModel.length ? Math.round(withModel.reduce((s, r) => s + r.metricas.tokensEntrada, 0) / withModel.length) : 0,
      tokensSaidaMedios: withModel.length ? Math.round(withModel.reduce((s, r) => s + r.metricas.tokensSaida, 0) / withModel.length) : 0,
      custoPorMilRespostasUsd: Math.round(costPerAnswer * 1000 * 1000) / 1000,
    },
    ...(judged.length ? { juiz: pct(judged.filter((r) => r.juiz!.pass).length, judged.length) } : {}),
  };
}

