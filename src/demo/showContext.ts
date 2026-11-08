/**
 * npm run contexto [-- "pergunta"]: mostra a janela de contexto EXATA que o modelo recebe, depois de um turno
 * em que o colaborador informa o perfil. Sem chave de API (modelo e embedder locais).
 */
import { SETTINGS } from "../shared/settings.ts";
import { loadStaticModules } from "../context/moduleLoader.ts";
import { loadGlossary } from "../knowledge/glossary.ts";
import { ingestKnowledgeBase } from "../knowledge/ingest.ts";
import { VectorRepository } from "../knowledge/vectorRepository.ts";
import { createExtractiveLlm, createLocalEmbedder } from "../llm/localModels.ts";
import { MemoryRepository } from "../memory/memoryRepository.ts";
import { MemoryService } from "../memory/memoryService.ts";
import { createLocalSummarizer } from "../memory/summarizer.ts";
import { answer, type Deps } from "../execution/pipeline.ts";

const question = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || "Posso trabalhar de casa?";
const embedder = createLocalEmbedder();
const knowledge = new VectorRepository(":memory:");
await ingestKnowledgeBase(SETTINGS.knowledgeDir, knowledge, embedder);
const deps: Deps = {
  llm: createExtractiveLlm(),
  embedder,
  knowledge,
  memory: new MemoryService(new MemoryRepository(":memory:"), createLocalSummarizer()),
  modules: loadStaticModules(SETTINGS.contextDir),
  glossary: loadGlossary(`${SETTINGS.knowledgeDir}/glossario.json`),
};
const session = deps.memory.startSession("bruno");
await answer("bruno", session, "Oi, meu nome é Bruno e trabalho no pátio.", deps);
const result = await answer("bruno", session, question, deps);

console.log(`Turno anterior: "Oi, meu nome é Bruno e trabalho no pátio."\nPergunta: "${question}"\n`);
if (!result.contexto) {
  console.log(`O modelo não foi chamado (desfecho: ${result.desfecho}).`);
} else {
  console.log("Manifesto (tokens estimados por bloco):");
  for (const m of result.contexto.manifest) console.log(`  ${m.bloco.padEnd(32)} ${String(m.tokens).padStart(5)}  itens=${m.itens}${m.cortados ? ` cortados=${m.cortados}` : ""}`);
  console.log(`  ${"TOTAL".padEnd(32)} ${String(result.contexto.tokens).padStart(5)}\n`);
  result.contexto.messages.forEach((m, i) => console.log(`----- mensagem ${i + 1} (${m.role}) -----\n${m.content}\n`));
}
console.log(`----- resposta entregue -----\n${result.resposta}`);
