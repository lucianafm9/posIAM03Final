import type { AnswerResult, Deps, PipelineMode } from "../execution/pipeline.ts";
import { answer } from "../execution/pipeline.ts";
import type { LlmClient } from "../shared/types.ts";
import type { Categoria, TestCase } from "./cases.ts";
import { checkCase, type CaseCheck } from "./evaluator.ts";
import { judge, type JudgeVerdict } from "./judge.ts";

/** Execução de um caso de comportamento e consolidação das métricas (usado pelo runEvaluation e pelo npm test). */
export type RunRecord = CaseCheck & {
  desfecho: AnswerResult["desfecho"];
  decisao: AnswerResult["decisao"];
  resposta: string;
  fontes: string[];
  memoriaUsada: string[];
  llmChamado: boolean;
  tokens: number;
  trace: string[];
  juiz?: JudgeVerdict;
};

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
    trace: result.trace.map((s) => `${s.etapa} ${s.status}${s.regra ? ` ${s.regra}` : ""}: ${s.detalhe}`),
    ...(judgeLlm ? { juiz: await judge(judgeLlm, testCase, result.resposta) } : {}),
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
    ...(judged.length ? { juiz: pct(judged.filter((r) => r.juiz!.pass).length, judged.length) } : {}),
  };
}

