import { SETTINGS } from "../src/shared/settings.ts";
import type { LlmClient } from "../src/shared/types.ts";
import { loadStaticModules } from "../src/context/moduleLoader.ts";
import { loadGlossary } from "../src/knowledge/glossary.ts";
import { ingestKnowledgeBase } from "../src/knowledge/ingest.ts";
import { VectorRepository } from "../src/knowledge/vectorRepository.ts";
import { createExtractiveLlm, createLocalEmbedder } from "../src/llm/localModels.ts";
import { MemoryRepository } from "../src/memory/memoryRepository.ts";
import { MemoryService } from "../src/memory/memoryService.ts";
import { createLocalSummarizer } from "../src/memory/summarizer.ts";
import type { Deps, PipelineMode } from "../src/execution/pipeline.ts";

const embedder = createLocalEmbedder();
let knowledge: VectorRepository | undefined;

/** Base de conhecimento real (pasta conhecimento/), ingerida uma vez por processo com o embedder local. */
export async function sharedKnowledge(): Promise<VectorRepository> {
  if (!knowledge) {
    knowledge = new VectorRepository(":memory:");
    await ingestKnowledgeBase(SETTINGS.knowledgeDir, knowledge, embedder);
  }
  return knowledge;
}

export function freshMemory(): MemoryService {
  return new MemoryService(new MemoryRepository(":memory:"), createLocalSummarizer());
}

/** Dependências offline do pipeline, com memória nova a cada chamada. */
export async function offlineDeps(llm: LlmClient = createExtractiveLlm(), mode: PipelineMode = "completo"): Promise<Deps> {
  return {
    llm,
    embedder,
    knowledge: await sharedKnowledge(),
    memory: freshMemory(),
    modules: loadStaticModules(SETTINGS.contextDir),
    glossary: loadGlossary(`${SETTINGS.knowledgeDir}/glossario.json`),
    mode,
  };
}

export { embedder };
