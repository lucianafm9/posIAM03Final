import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { DocType } from "../shared/types.ts";

export type KnowledgeDocument = {
  docId: string;
  titulo: string;
  tipo: DocType;
  versao: string;
  areaResponsavel: string;
  arquivo: string;
  corpo: string;
};

const FOLDER_TO_TYPE: Record<string, DocType> = {
  politicas: "politica",
  runbooks: "runbook",
  incidentes: "incidente",
  onboarding: "onboarding",
};

/**
 * Lê um documento da base. Convenção (reutilizável em outro domínio):
 *   # <ID> — <Título>
 *   Área responsável: ...
 *   Versão: ...
 *   ## Seção ...
 * Os metadados viram colunas (citáveis na resposta) e saem do corpo, para não poluir a busca.
 */
export function parseDocument(text: string, arquivo: string, tipo: DocType): KnowledgeDocument {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? basename(arquivo);
  const [rawId, ...rest] = heading.split(/\s+[—-]\s+/);
  const meta = (label: string) =>
    lines.find((l) => l.toLowerCase().startsWith(label.toLowerCase()))?.split(":").slice(1).join(":").trim() ?? "";

  const corpo = lines
    .filter((l) => !/^(Empresa|Área responsável|Versão):/i.test(l))
    .join("\n");

  return {
    docId: (rawId ?? heading).trim(),
    titulo: rest.join(" — ").trim() || heading,
    tipo,
    versao: meta("Versão"),
    areaResponsavel: meta("Área responsável"),
    arquivo,
    corpo,
  };
}

/** Carrega todos os .md de <dir>/<tipo>/; o tipo vem do nome da pasta. */
export function loadKnowledgeBase(dir: string): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];
  for (const folder of readdirSync(dir).sort()) {
    const tipo = FOLDER_TO_TYPE[folder];
    const path = join(dir, folder);
    if (!tipo || !statSync(path).isDirectory()) continue;
    for (const file of readdirSync(path).filter((f) => f.endsWith(".md")).sort()) {
      const full = join(path, file);
      docs.push(parseDocument(readFileSync(full, "utf8"), relative(dir, full).split(sep).join("/"), tipo));
    }
  }
  return docs;
}
