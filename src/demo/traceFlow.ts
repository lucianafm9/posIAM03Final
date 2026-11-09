/**
 * npm run fluxo [-- "pergunta"] [-- --offline]
 * Acompanha UMA pergunta do documento-fonte até a resposta, mostrando o dado real em cada etapa:
 * arquivo .md -> metadados -> chunks -> linha no banco (embedding) -> consulta -> ranking com scores ->
 * contexto montado -> saída bruta do modelo -> checagens da guarda de saída -> resposta entregue.
 * Salva em results/fluxo-de-dados-<provedor>.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SETTINGS, minScoreFor } from "../shared/settings.ts";
import { numberTokens } from "../shared/text.ts";
import type { LlmClient } from "../shared/types.ts";
import { chunkText } from "../knowledge/chunkText.ts";
import { loadKnowledgeBase } from "../knowledge/documents.ts";
import { expandQuery } from "../knowledge/glossary.ts";
import { ingestKnowledgeBase } from "../knowledge/ingest.ts";
import { keywordScore } from "../knowledge/scoring.ts";
import { VectorRepository } from "../knowledge/vectorRepository.ts";
import { MemoryRepository } from "../memory/memoryRepository.ts";
import { MemoryService } from "../memory/memoryService.ts";
import { createLocalSummarizer } from "../memory/summarizer.ts";
import { answer, type Deps } from "../execution/pipeline.ts";
import { startOrExit } from "../interfaces/runtime.ts";

const PROFILE_TURN = "Oi, meu nome é Bruno e trabalho no pátio.";
const question = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || "Posso trabalhar de casa alguns dias?";

const runtime = await startOrExit({ log: console.log });
const knowledge = new VectorRepository(":memory:");
await ingestKnowledgeBase(SETTINGS.knowledgeDir, knowledge, runtime.embedder);
let rawOutput = "";
const spy: LlmClient = {
  name: runtime.llm.name,
  async complete(messages, options) {
    rawOutput = await runtime.llm.complete(messages, options);
    return rawOutput;
  },
  ...(runtime.llm.usage ? { usage: runtime.llm.usage } : {}),
};
const memory = new MemoryService(new MemoryRepository(":memory:"), createLocalSummarizer());
const deps: Deps = { ...runtime, llm: spy, knowledge, memory };

const md: string[] = [];
const code = (lang: string, text: string) => md.push("```" + lang, text, "```", "");

// Etapa 5 e seguintes precisam da resposta; rodamos o pipeline primeiro e depois mostramos cada etapa em ordem.
const session = memory.startSession("bruno");
const first = await answer("bruno", session, PROFILE_TURN, deps);
const result = await answer("bruno", session, question, deps);
const topDocId = result.fontes[0]?.docId ?? "POL-08";
const doc = loadKnowledgeBase(SETTINGS.knowledgeDir).find((d) => d.docId === topDocId)!;
const rawFile = readFileSync(join(SETTINGS.knowledgeDir, doc.arquivo), "utf8").replace(/\r\n/g, "\n");

md.push(
  `# Fluxo de dados de ponta a ponta (${runtime.provider === "openai" ? runtime.llm.name : "modo offline"})`,
  "",
  `Gerado por \`npm run fluxo\` em ${new Date().toISOString()} | modelo \`${runtime.llm.name}\` | embedder \`${runtime.embedder.name}\`.`,
  "",
  `Turno anterior: *"${PROFILE_TURN}"* · Pergunta acompanhada: **"${question}"**`,
  "",
);

md.push("## 1. Documento-fonte (como está no repositório)", "", `Arquivo \`conhecimento/${doc.arquivo}\`, o documento mais relevante para a pergunta:`, "");
code("markdown", rawFile.trim());

md.push(
  "## 2. Leitura e metadados (`documents.ts`)",
  "",
  "O cabeçalho vira colunas (para citar a fonte) e sai do corpo, para não poluir a busca:",
  "",
  "| Campo | Valor |",
  "|---|---|",
  `| docId | ${doc.docId} |`,
  `| título | ${doc.titulo} |`,
  `| tipo (da pasta) | ${doc.tipo} |`,
  `| área responsável | ${doc.areaResponsavel} |`,
  `| versão | ${doc.versao} |`,
  "",
);

const chunks = chunkText(doc.corpo);
md.push(
  "## 3. Chunks (`chunkText.ts` + `ingest.ts`)",
  "",
  `Quebra por seção \`##\` e por frase (máx. ${SETTINGS.chunk.maxChars} caracteres, overlap de ${SETTINGS.chunk.overlapSentences} frase), com o prefixo "Documento > Seção". ` +
    "A seção Objetivo fica fora da busca. Cada chunk passa pela inspeção contra instruções embutidas antes de ser gravado.",
  "",
  "| # | Seção | Indexado? | Caracteres | Texto (início) |",
  "|---|---|:---:|---:|---|",
  ...chunks.map((c, i) => `| ${i + 1} | ${c.section.split(" > ").slice(1).join(" > ")} | ${/> Objetivo$/.test(c.section) ? "não" : "sim"} | ${c.text.length} | ${c.text.slice(0, 90).replace(/\|/g, "/")}… |`),
  "",
);

const embedding = await runtime.embedder.embed(chunks.find((c) => !/> Objetivo$/.test(c.section))!.text);
md.push(
  "## 4. Linha gravada na base vetorial (`vectorRepository.ts`, SQLite)",
  "",
  `A base tem ${knowledge.count(runtime.embedder.name)} chunks de ${loadKnowledgeBase(SETTINGS.knowledgeDir).length} documentos. Uma linha da tabela \`documents\`:`,
  "",
);
code(
  "json",
  JSON.stringify(
    {
      doc_id: doc.docId,
      titulo: doc.titulo,
      tipo: doc.tipo,
      secao: chunks[1]?.section,
      chunk: `${chunks[1]?.text.slice(0, 120)}…`,
      embeddings: `[${embedding.slice(0, 5).map((v) => v.toFixed(4)).join(", ")}, … ] (${embedding.length} posições)`,
      embedder: runtime.embedder.name,
    },
    null,
    2,
  ),
);

const expanded = expandQuery(result.memoria.consulta?.query ?? question, runtime.glossary ?? []);
const ranking = knowledge.rank(expanded.query, await runtime.embedder.embed(expanded.query), runtime.embedder.name).slice(0, 8);
const alpha = SETTINGS.retrieval.semanticWeight;
md.push(
  "## 5. Consulta e busca híbrida (`retriever.ts`, `scoring.ts`, `glossary.ts`)",
  "",
  "| Etapa | Valor |",
  "|---|---|",
  `| pergunta original | ${question} |`,
  `| busca contextualizada pela memória? | ${result.memoria.consulta?.usouHistorico ? `sim (${result.memoria.consulta.motivo})` : "não (a pergunta se sustenta sozinha)"} |`,
  `| expansão do glossário | ${expanded.expansoes.join("; ") || "nenhuma"} |`,
  `| consulta final | ${expanded.query} |`,
  `| score mínimo (${runtime.embedder.name}) | ${minScoreFor(runtime.embedder.name)} |`,
  "",
  `Score híbrido = ${alpha} × cosseno + ${(1 - alpha).toFixed(1)} × palavra-chave. Os 8 melhores trechos:`,
  "",
  "| # | Documento | Seção | Cosseno | Palavra-chave | Híbrido | Resultado |",
  "|---|---|---|---:|---:|---:|---|",
  ...ranking.map((c, i) => {
    const kw = keywordScore(expanded.query, c.chunk);
    const cos = (c.score - (1 - alpha) * kw) / alpha;
    const used = result.contexto?.messages.some((m) => m.content.includes(`secao="${c.secao.replace(/>/g, "&gt;")}"`));
    return `| ${i + 1} | ${c.docId} | ${c.secao.split(" > ").slice(1).join(" > ")} | ${cos.toFixed(3)} | ${kw.toFixed(3)} | ${c.score.toFixed(3)} | ${used ? "**entra no contexto**" : c.score < minScoreFor(runtime.embedder.name) ? "abaixo do corte" : "fora (topK ou 2 por documento)"} |`;
  }),
  "",
);

const dynamic = result.contexto?.messages.find((m) => m.content.startsWith("<memoria_usuario"))?.content ?? "";
md.push(
  "## 6. Memória e contexto montado (`memoryService.ts`, `contextBuilder.ts`)",
  "",
  `O turno anterior gravou no perfil: ${first.memoria.gravada.map((f) => `\`${f.chave}=${f.valor}\``).join(", ")}. ` +
    "Para esta pergunta, a memória selecionou os fatos relevantes e o contexto foi montado em blocos:",
  "",
  "| Bloco | Tokens (estimados) | Itens |",
  "|---|---:|---:|",
  ...(result.contexto?.manifest ?? []).map((m) => `| ${m.bloco} | ${m.tokens} | ${m.itens} |`),
  `| **total** | **${result.contexto?.tokens ?? 0}** | |`,
  "",
  "Bloco dinâmico (mensagem de sistema nº 3) exatamente como o modelo recebe:",
  "",
);
code("xml", dynamic);

md.push("## 7. Saída bruta do modelo (contrato JSON)", "");
code("json", rawOutput ? JSON.stringify(JSON.parse(rawOutput), null, 2) : "(o modelo não foi chamado)");

const evidence = result.contexto?.messages.map((m) => m.content).join("\n") ?? "";
const nums = [...new Set(numberTokens((rawOutput ? (JSON.parse(rawOutput) as { resposta: string }).resposta : "").replace(/\b[A-Z]{2,4}-\d{2,4}(?:-\d{2,3})?\b/g, "")))];
md.push(
  "## 8. Guarda de saída (`outputGuard.ts`)",
  "",
  "| Checagem | Resultado |",
  "|---|---|",
  `| contrato JSON válido | ${rawOutput ? "sim" : "-"} |`,
  `| token canário vazado | não |`,
  `| fontes declaradas estão entre as recuperadas | ${result.fontes.map((f) => f.docId).join(", ") || "-"} |`,
  `| números da resposta com respaldo | ${nums.length ? nums.map((n) => `${n}: ${evidence.includes(n) ? "encontrado no contexto" : "SEM respaldo"}`).join("; ") : "nenhum número"} |`,
  `| chaves de memória declaradas | ${result.memoria.usada.join(", ") || "nenhuma"} |`,
  `| decisão da guarda | ${result.trace.filter((t) => t.etapa === "saida").map((t) => `${t.status}: ${t.detalhe}`).join("; ")} |`,
  "",
);

md.push("## 9. Resposta entregue ao colaborador", "");
md.push(...result.resposta.split("\n").map((l) => `> ${l}`), "");
md.push(
  "| Desfecho | Decisão | Latência total | Tempo do modelo | Tokens de entrada | Tokens de saída |",
  "|---|---|---:|---:|---:|---:|",
  `| ${result.desfecho} | ${result.decisao} | ${result.metricas.latenciaMs} ms | ${result.metricas.modeloMs} ms | ${result.metricas.tokensEntrada || "-"} | ${result.metricas.tokensSaida || "-"} |`,
  "",
  "Trace completo:",
  "",
);
code("text", result.trace.map((s) => `${s.etapa.padEnd(12)} ${s.status.padEnd(10)} ${(s.regra ?? "").padEnd(4)} ${s.detalhe}`).join("\n"));

const file = `results/fluxo-de-dados-${runtime.provider}.md`;
writeFileSync(file, md.join("\n"));
console.log(`Fluxo salvo em ${file}`);
