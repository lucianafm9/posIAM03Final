import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Módulo estático de contexto: um arquivo .md versionado na pasta contexto/. */
export type StaticModule = { modulo: string; versao: string; ordem: number; conteudo: string; arquivo: string };

/**
 * Carrega os módulos de contexto. Cada arquivo tem um cabeçalho:
 *   ---
 *   modulo: <nome>
 *   versao: <versão>
 *   ordem: <posição>
 *   ---
 * O conteúdo pode ser revisado por quem não programa (produto, compliance) e é versionado no git.
 */
export function loadStaticModules(dir: string): StaticModule[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
      const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) throw new Error(`Módulo de contexto sem cabeçalho: ${file}`);
      const header = Object.fromEntries(
        match[1]!.split("\n").map((l) => {
          const [k, ...v] = l.split(":");
          return [k!.trim(), v.join(":").trim()];
        }),
      ) as Record<string, string>;
      if (!header.modulo || !header.versao) throw new Error(`Módulo ${file} sem "modulo" ou "versao".`);
      return { modulo: header.modulo, versao: header.versao, ordem: Number(header.ordem ?? 99), conteudo: match[2]!.trim(), arquivo: file };
    })
    .sort((a, b) => a.ordem - b.ordem);
}

export function moduleByName(modules: StaticModule[], name: string): StaticModule {
  const found = modules.find((m) => m.modulo === name);
  if (!found) throw new Error(`Módulo de contexto ausente: ${name}`);
  return found;
}
