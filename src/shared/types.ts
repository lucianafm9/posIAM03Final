export type Role = "system" | "user" | "assistant";

export type Message = {
  role: Role;
  content: string;
};

export type CompleteOptions = {
  json?: boolean;
  temperature?: number;
};

/** Contrato mínimo do provedor de LLM: permite trocar o modelo (OpenAI, local, roteirizado) sem mudar o pipeline. */
export type LlmClient = {
  readonly name: string;
  complete(messages: Message[], options?: CompleteOptions): Promise<string>;
};

/** Gera o vetor (embedding) de um texto. */
export type Embedder = {
  readonly name: string;
  embed(text: string): Promise<number[]>;
};

/** Decisão declarada pelo assistente no contrato de saída. */
export const DECISIONS = ["RESPONDER", "RECUSAR", "ENCAMINHAR"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Contrato de saída que o modelo deve devolver (JSON). */
export type Envelope = {
  decisao: Decision;
  fontes: string[];
  memoria_usada: string[];
  resposta: string;
};

/** Tipos de documento da base de conhecimento (uma pasta por tipo). */
export const DOC_TYPES = ["politica", "runbook", "incidente", "onboarding"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Trecho recuperado da base de conhecimento. */
export type RetrievedChunk = {
  id: number;
  docId: string;
  titulo: string;
  tipo: DocType;
  secao: string;
  chunk: string;
  score: number;
};

/** Fato de perfil guardado na memória de longo prazo. */
export type ProfileFact = {
  chave: string;
  valor: string;
  atualizadoEm?: string;
};
