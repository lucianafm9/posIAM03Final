import { existsSync, readFileSync } from "node:fs";
import { normalize } from "../shared/text.ts";

export type Glossary = { padrao: RegExp; expansao: string }[];

/**
 * Glossário do domínio (conhecimento/glossario.json): liga o vocabulário do colaborador ("de casa", "crachá")
 * ao vocabulário dos documentos ("trabalho híbrido", "credencial"). Só expande a CONSULTA de busca;
 * o texto enviado ao modelo continua sendo a pergunta original.
 */
export function loadGlossary(file: string): Glossary {
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  return Object.entries(data)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => ({ padrao: new RegExp(`\\b(?:${k})`), expansao: v }));
}

export function expandQuery(query: string, glossary: Glossary): { query: string; expansoes: string[] } {
  const norm = normalize(query);
  const expansoes = glossary.filter((g) => g.padrao.test(norm)).map((g) => g.expansao);
  return { query: expansoes.length ? `${query} ${expansoes.join(" ")}` : query, expansoes };
}
