/**
 * npm run evaluate:offline                 -> modelos locais, 1 execução, salva results/avaliacao-offline.json
 * npm run evaluate -- --runs 3             -> gpt-4o-mini + text-embedding-3-small + juiz LLM, salva results/avaliacao-openai.json
 * Opções: --modos completo,sem_memoria,contexto_longo,llm_puro   --sem-juiz   --casos K01,M03
 *
 * Compara a plataforma completa com versões sem partes dela (ablação):
 *   llm_puro     o "chatbot genérico": só o modelo, sem conhecimento, sem memória, sem regras em código;
 *   sem_memoria  RAG + regras + guardas, mas cada pergunta é isolada (sem perfil, sem janela, sem resumo);
 *   completo     a plataforma inteira.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { SETTINGS } from "../shared/settings.ts";
import type { Embedder, LlmClient } from "../shared/types.ts";
import { loadStaticModules } from "../context/moduleLoader.ts";
import { loadGlossary } from "../knowledge/glossary.ts";
import { ingestKnowledgeBase } from "../knowledge/ingest.ts";
import { VectorRepository } from "../knowledge/vectorRepository.ts";
import { createExtractiveLlm, createLocalEmbedder } from "../llm/localModels.ts";
import { createOpenAiClient, createOpenAiEmbedder, readApiKey } from "../llm/openaiClient.ts";
import { describeError } from "../llm/errors.ts";
import { MemoryRepository } from "../memory/memoryRepository.ts";
import { MemoryService } from "../memory/memoryService.ts";
import { createLlmSummarizer, createLocalSummarizer } from "../memory/summarizer.ts";
import type { Deps, PipelineMode } from "../execution/pipeline.ts";
import { CASES, type Categoria } from "./cases.ts";
import { runCase, summarize, type EvaluationFile, type RunRecord } from "./harness.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const offline = process.argv.includes("--offline");
  const apiKey = offline ? undefined : readApiKey();
  if (!offline && !apiKey) {
    console.error("OPENAI_API_KEY ausente: use npm run evaluate:offline ou configure o .env.");
    process.exit(1);
  }
  const runs = Number(arg("--runs") ?? 1);
  const modes = (arg("--modos")?.split(",") ?? ["llm_puro", "sem_memoria", "contexto_longo", "completo"]) as PipelineMode[];
  const only = arg("--casos")?.split(",");
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;

  const embedder: Embedder = apiKey ? createOpenAiEmbedder(apiKey) : createLocalEmbedder();
  const llm: LlmClient = apiKey ? createOpenAiClient(apiKey, process.env.OPENAI_MODEL || SETTINGS.defaultModel) : createExtractiveLlm();
  const judgeLlm = apiKey && !process.argv.includes("--sem-juiz") ? createOpenAiClient(apiKey, SETTINGS.defaultModel) : undefined;
  const knowledge = new VectorRepository(":memory:");
  await ingestKnowledgeBase(SETTINGS.knowledgeDir, knowledge, embedder);
  const modules = loadStaticModules(SETTINGS.contextDir);
  const glossary = loadGlossary(`${SETTINGS.knowledgeDir}/glossario.json`);

  const output: EvaluationFile = { geradoEm: new Date().toISOString(), provedor: apiKey ? "openai" : "offline", modelo: llm.name, embedder: embedder.name, runs, modos: {} };
  console.log(`Avaliação: ${cases.length} casos x ${runs} execução(ões) x modos ${modes.join(", ")} | ${llm.name} | embedder ${embedder.name}\n`);

  for (const mode of modes) {
    const results: { id: string; categoria: Categoria; descricao: string; critico: boolean; runs: RunRecord[] }[] = cases.map((c) => ({
      id: c.id,
      categoria: c.categoria,
      descricao: c.descricao,
      critico: c.critico ?? false,
      runs: [],
    }));
    for (let run = 1; run <= runs; run++) {
      const memory = new MemoryService(new MemoryRepository(":memory:"), apiKey ? createLlmSummarizer(llm) : createLocalSummarizer());
      const deps: Deps = { llm, embedder, knowledge, memory, modules, glossary, mode };
      for (const [i, c] of cases.entries()) {
        const record = await runCase(c, deps, `${c.id.toLowerCase()}-r${run}`, mode !== "llm_puro", mode === "completo" ? judgeLlm : undefined);
        results[i]!.runs.push(record);
        process.stdout.write(record.pass ? "." : "F");
      }
    }
    const resumo = summarize(results);
    output.modos[mode] = { resumo, casos: results };
    console.log(
      `\n${mode.padEnd(12)} acerto ${resumo.acerto}% | alucinação ${resumo.alucinacao}% | críticos seguros ${resumo.criticosSeguros}/${resumo.criticosTotal} | ` +
        `consistência ${resumo.consistencia}% | sem chamar o modelo ${resumo.semChamarModelo}%${resumo.juiz !== undefined ? ` | juiz ${resumo.juiz}%` : ""}` +
        ` | latência mediana ${resumo.operacao.latenciaMedianaMs} ms | US$ ${resumo.operacao.custoPorMilRespostasUsd}/mil respostas`,
    );
    for (const c of results) for (const r of c.runs.filter((x) => !x.pass)) console.log(`   ${c.id} ${r.desfecho}: ${r.falhas.join("; ")}`);
  }

  mkdirSync("results", { recursive: true });
  const file = `results/avaliacao-${output.provedor}.json`;
  writeFileSync(file, JSON.stringify(output, (_k, v) => (v instanceof RegExp ? v.source : v), 2));
  console.log(`\nResultados salvos em ${file}. Gere o relatório com: npm run report`);
}

try {
  await main();
} catch (error) {
  console.error(`\n[Erro na avaliação] ${describeError(error)}`);
  process.exit(1);
}
