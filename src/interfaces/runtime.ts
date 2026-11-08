import { SETTINGS } from "../shared/settings.ts";
import type { Embedder, LlmClient } from "../shared/types.ts";
import { loadStaticModules, type StaticModule } from "../context/moduleLoader.ts";
import { loadGlossary } from "../knowledge/glossary.ts";
import { ingestKnowledgeBase } from "../knowledge/ingest.ts";
import { VectorRepository } from "../knowledge/vectorRepository.ts";
import { createExtractiveLlm, createLocalEmbedder } from "../llm/localModels.ts";
import { createOpenAiClient, createOpenAiEmbedder, readApiKey } from "../llm/openaiClient.ts";
import { describeError } from "../llm/errors.ts";
import { MemoryRepository } from "../memory/memoryRepository.ts";
import { MemoryService } from "../memory/memoryService.ts";
import { createLlmSummarizer, createLocalSummarizer } from "../memory/summarizer.ts";
import type { Deps } from "../execution/pipeline.ts";

/** Erro de inicialização com mensagem pronta para o usuário (sem stack trace). */
export class StartupError extends Error {}

/** Executa a inicialização de um comando e, se falhar, mostra só a causa e sai com código 1. */
export async function startOrExit(options: RuntimeOptions = {}): Promise<Runtime> {
  try {
    return await createRuntime(options);
  } catch (error) {
    console.error(`[Erro] ${error instanceof StartupError ? error.message : describeError(error)}`);
    process.exit(1);
  }
}

export type Runtime =Deps & { mode: "completo"; provider: "openai" | "offline"; modules: StaticModule[] };

export type RuntimeOptions = { offline?: boolean; knowledgeFile?: string; memoryFile?: string; log?: (text: string) => void };

/**
 * Composição (injeção de dependências): é o ÚNICO lugar que conhece as implementações concretas.
 * Com OPENAI_API_KEY usa gpt-4o-mini + text-embedding-3-small; com --offline (ou sem chave) usa os modelos locais.
 * Se a base vetorial não tiver vetores deste embedder, ingere a pasta conhecimento/.
 */
export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const offline = options.offline ?? process.argv.includes("--offline");
  const apiKey = offline ? undefined : readApiKey();
  const embedder: Embedder = apiKey ? createOpenAiEmbedder(apiKey) : createLocalEmbedder();
  const llm: LlmClient = apiKey ? createOpenAiClient(apiKey, process.env.OPENAI_MODEL || SETTINGS.defaultModel) : createExtractiveLlm();
  const knowledge = new VectorRepository(options.knowledgeFile ?? SETTINGS.databaseFile);
  const memory = new MemoryService(
    new MemoryRepository(options.memoryFile ?? "data/memoria.db"),
    apiKey ? createLlmSummarizer(llm) : createLocalSummarizer(),
  );

  if (knowledge.count(embedder.name) === 0) {
    options.log?.(`[Base vetorial vazia para o embedder "${embedder.name}": ingerindo ${SETTINGS.knowledgeDir}/...]`);
    try {
      await ingestKnowledgeBase(SETTINGS.knowledgeDir, knowledge, embedder);
    } catch (error) {
      throw new StartupError(`Não foi possível montar a base de conhecimento: ${describeError(error)} Sem chave válida, use --offline.`);
    }
  }

  return { llm, embedder, knowledge, memory, modules: loadStaticModules(SETTINGS.contextDir), glossary: loadGlossary(`${SETTINGS.knowledgeDir}/glossario.json`), mode: "completo", provider: apiKey ? "openai" : "offline" };
}
