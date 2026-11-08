/** Registro do que cada etapa decidiu: base da auditoria, do modo --trace e do relatório de avaliação. */
export type TraceStatus = "ok" | "alerta" | "bloqueado" | "info";

export type TraceStep = { etapa: string; status: TraceStatus; regra?: string; detalhe: string };

export class Trace {
  readonly steps: TraceStep[] = [];

  add(etapa: string, status: TraceStatus, detalhe: string, regra?: string): void {
    this.steps.push({ etapa, status, detalhe, ...(regra ? { regra } : {}) });
  }
}

export function formatTrace(steps: TraceStep[]): string {
  return steps.map((s) => `  ${s.etapa.padEnd(12)} ${s.status.padEnd(10)} ${(s.regra ?? "").padEnd(4)} ${s.detalhe}`).join("\n");
}
