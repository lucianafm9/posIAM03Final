import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { RULES } from "../src/rules/policy.ts";

/** Quem pode importar quem: a separação de responsabilidades é verificada, não só documentada. */
const ALLOWED: Record<string, string[]> = {
  shared: [],
  rules: ["shared"],
  llm: ["shared"],
  knowledge: ["shared", "rules", "llm", "interfaces"], // interfaces: só os scripts de CLI (runIngest, ragDebug)
  memory: ["shared", "rules"],
  context: ["shared", "rules"],
  execution: ["shared", "rules", "context", "knowledge", "memory", "llm"],
  interfaces: ["shared", "rules", "context", "knowledge", "memory", "llm", "execution"],
  evaluation: ["shared", "rules", "context", "knowledge", "memory", "llm", "execution"],
  demo: ["shared", "rules", "context", "knowledge", "memory", "llm", "execution", "interfaces"],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("camadas: cada pasta só importa as camadas permitidas", () => {
  const violations: string[] = [];
  for (const layer of Object.keys(ALLOWED)) {
    for (const file of files(join("src", layer))) {
      const scripts = /runIngest|ragDebug/.test(file);
      for (const [, target] of readFileSync(file, "utf8").matchAll(/from "\.\.\/([a-z]+)\//g)) {
        if (target === "interfaces" && layer === "knowledge" && !scripts) violations.push(`${file} -> ${target}`);
        else if (!ALLOWED[layer]!.includes(target!)) violations.push(`${file} -> ${target}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("regras: IDs únicos e toda regra CRÍTICA tem pelo menos dois pontos de enforcement", () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  for (const r of RULES.filter((x) => x.prioridade === "CRITICA")) assert.ok(r.enforcement.length >= 2, r.id);
});

test("regras: toda regra citada no código existe na política", () => {
  const ids = new Set(RULES.map((r) => r.id));
  const cited = files("src").flatMap((f) => [...readFileSync(f, "utf8").matchAll(/"(R\d{2})"/g)].map((m) => m[1]!));
  assert.deepEqual([...new Set(cited)].filter((id) => !ids.has(id)), []);
});

test("nenhuma chave de API no repositório", () => {
  const all = [...files("src"), ...files("tests"), ".env.example"];
  for (const f of all) assert.doesNotMatch(readFileSync(f, "utf8"), /sk-[A-Za-z0-9_-]{20,}/, f);
  assert.equal(readFileSync(".env.example", "utf8").split("\n")[0], "OPENAI_API_KEY=OPENAI_API_KEY");
});
