/** npm run report: gera results/resultados-avaliacao.md a partir de results/avaliacao-*.json. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CASES } from "./cases.ts";
import type { EvaluationFile, ModeSummary } from "./harness.ts";

const MODE_LABEL: Record<string, string> = {
  llm_puro: "LLM puro (sem plataforma)",
  sem_memoria: "RAG + regras, sem memória",
  contexto_longo: "Contexto longo (toda a base, sem busca)",
  completo: "Plataforma completa",
};

function load(file: string): EvaluationFile | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as EvaluationFile) : undefined;
}

function summaryTable(data: EvaluationFile): string[] {
  const rows = Object.entries(data.modos) as [string, { resumo: ModeSummary }][];
  const judge = rows.some(([, m]) => m.resumo.juiz !== undefined);
  return [
    `| Configuração | Acerto | Conhecimento | Memória | Fora da base | Segurança | Alucinação | Críticos seguros | Consistência | Sem chamar o modelo | Tokens médios${judge ? " | Juiz LLM" : ""} |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:${judge ? "|---:" : ""}|`,
    ...rows.map(([mode, { resumo: r }]) =>
      [
        MODE_LABEL[mode] ?? mode,
        `${r.acerto}%`,
        `${r.porCategoria.conhecimento.acerto}%`,
        `${r.porCategoria.memoria.acerto}%`,
        `${r.porCategoria.fora_da_base.acerto}%`,
        `${r.porCategoria.seguranca.acerto}%`,
        `${r.alucinacao}%`,
        `${r.criticosSeguros}/${r.criticosTotal}`,
        `${r.consistencia}%`,
        `${r.semChamarModelo}%`,
        String(r.tokensMedios),
        ...(judge ? [r.juiz !== undefined ? `${r.juiz}%` : "-"] : []),
      ].join(" | "),
    ).map((l) => `| ${l} |`),
  ];
}

function caseMatrix(data: EvaluationFile): string[] {
  const modes = Object.keys(data.modos);
  const lines = [`| Caso | Categoria | O que testa | ${modes.map((m) => MODE_LABEL[m] ?? m).join(" | ")} |`, `|---|---|---|${modes.map(() => ":---:").join("|")}|`];
  for (const c of CASES) {
    const cells = modes.map((m) => {
      const runs = data.modos[m as keyof typeof data.modos]?.casos.find((x) => x.id === c.id)?.runs ?? [];
      const ok = runs.filter((r) => r.pass).length;
      return runs.length === 1 ? (ok ? "✔" : "✘") : `${ok}/${runs.length}`;
    });
    lines.push(`| ${c.id}${c.critico ? " *" : ""} | ${c.categoria} | ${c.descricao} | ${cells.join(" | ")} |`);
  }
  return lines;
}

function operationTable(data: EvaluationFile): string[] {
  const rows = Object.entries(data.modos) as [string, { resumo: ModeSummary }][];
  return [
    "| Configuração | Latência mediana (com modelo) | Latência p95 | Latência sem modelo | Tokens de entrada | Tokens de saída | Custo estimado / mil respostas |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...rows.map(([mode, { resumo: r }]) => {
      const o = r.operacao;
      if (!o) return `| ${MODE_LABEL[mode] ?? mode} | - | - | - | - | - | - |`;
      return `| ${MODE_LABEL[mode] ?? mode} | ${o.latenciaMedianaMs} ms | ${o.latenciaP95Ms} ms | ${o.latenciaSemModeloMs} ms | ${o.tokensEntradaMedios} | ${o.tokensSaidaMedios} | US$ ${o.custoPorMilRespostasUsd.toFixed(3)} |`;
    }),
  ];
}

function details(data: EvaluationFile): string[] {
  const full = data.modos.completo;
  if (!full) return [];
  const lines = ["| Caso | Desfecho | Fontes | Memória usada | Modelo chamado | Resultado |", "|---|---|---|---|:---:|---|"];
  for (const c of full.casos) {
    const r = c.runs[0]!;
    lines.push(
      `| ${c.id} | ${r.desfecho} | ${r.fontes.join(", ") || "-"} | ${r.memoriaUsada.join(", ") || "-"} | ${r.llmChamado ? "sim" : "não"} | ${r.pass ? "ok" : r.falhas.join("; ").replace(/\|/g, "\\|")}${r.juiz ? ` (juiz: ${r.juiz.pass ? "aprovou" : `reprovou: ${r.juiz.motivo.replace(/\|/g, "/")}`})` : ""} |`,
    );
  }
  return lines;
}

function failures(data: EvaluationFile): string[] {
  const out: string[] = [];
  for (const [mode, m] of Object.entries(data.modos)) {
    for (const c of m!.casos) {
      for (const [i, r] of c.runs.entries()) {
        if (r.pass && !(r.juiz && !r.juiz.pass)) continue;
        out.push(`- **${MODE_LABEL[mode] ?? mode} / ${c.id}${c.runs.length > 1 ? ` (execução ${i + 1})` : ""}**: ${r.pass ? "verificação ok" : r.falhas.join("; ")}${r.juiz && !r.juiz.pass ? `; juiz: ${r.juiz.motivo}` : ""}`);
        out.push(`  > ${r.resposta.split("\n\nFontes:")[0]!.replace(/\n/g, " ").slice(0, 280)}`);
      }
    }
  }
  return out.length ? out : ["Nenhuma falha."];
}

function section(title: string, data: EvaluationFile | undefined, note: string): string[] {
  if (!data) return [`## ${title}`, "", "Ainda não executada. Rode `npm run evaluate -- --runs 3` com uma OPENAI_API_KEY válida e depois `npm run report`.", ""];
  return [
    `## ${title}`,
    "",
    `Gerado em ${data.geradoEm} | modelo \`${data.modelo}\` | embedder \`${data.embedder}\` | ${CASES.length} casos x ${data.runs} execução(ões) por configuração.`,
    "",
    note,
    "",
    "### Resumo por configuração",
    "",
    ...summaryTable(data),
    "",
    "### Operação (latência, tokens reais e custo)",
    "",
    ...operationTable(data),
    "",
    "Custo com o preço de tabela do gpt-4o-mini configurado em `PRICE_PER_MILLION` (harness.ts); os embeddings da busca não entram na conta (custo desprezível).",
    "",
    "### Resultado caso a caso (* = crítico)",
    "",
    ...caseMatrix(data),
    "",
    "### Detalhe da plataforma completa",
    "",
    ...details(data),
    "",
    "### Falhas e respostas correspondentes",
    "",
    ...failures(data),
    "",
  ];
}

const offline = load("results/avaliacao-offline.json");
const openai = load("results/avaliacao-openai.json");
const md = [
  "# Resultados da avaliação de comportamento (gerado)",
  "",
  "Arquivo gerado por `npm run report`. A análise interpretativa está em [docs/06-relatorio-avaliacao.md](../docs/06-relatorio-avaliacao.md).",
  "",
  "Métricas: **acerto** = casos com o comportamento esperado; **alucinação** = número sem respaldo na base ou resposta a pergunta fora da base;",
  "**críticos seguros** = casos críticos sem nenhuma violação; **consistência** = casos com o mesmo resultado e o mesmo desfecho em todas as execuções;",
  "**sem chamar o modelo** = respostas decididas de forma determinística (bloqueio, emergência, memória, sem documento).",
  "",
  ...section("Com o modelo real (gpt-4o-mini)", openai, "Juiz LLM aplicado só na plataforma completa, com a rubrica de cada caso."),
  ...section(
    "Offline (modelo extrativo local, embedder por hashing)",
    offline,
    "O modelo local só copia frases dos documentos injetados, por isso nunca inventa: na configuração **LLM puro** ele não tem documento e recusa tudo. Essa linha serve para conferir o fluxo; a comparação com um LLM que alucina está na seção do modelo real.",
  ),
];
writeFileSync("results/resultados-avaliacao.md", md.join("\n"));
console.log("Relatório salvo em results/resultados-avaliacao.md");
