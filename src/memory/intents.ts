import { normalize } from "../shared/text.ts";

/** Pedidos sobre a própria memória (transparência e direito de eliminação, LGPD art. 18). */
export type MemoryIntent = "ver_memoria" | "apagar_memoria" | undefined;

export function detectMemoryIntent(text: string): MemoryIntent {
  const norm = normalize(text);
  if (/^\/esquecer\b/.test(norm) || /\b(esqueca|apague|apaga|delete|remova|exclua)\b.{0,25}\b(meus dados|tudo sobre mim|o que (voce )?sabe sobre mim|minha memoria|meu perfil)\b/.test(norm)) {
    return "apagar_memoria";
  }
  if (/^\/memoria\b/.test(norm) || /\b(o que (voce )?(sabe|guardou|lembra) (sobre|de) mim|quais dados (voce )?(tem|guardou)|meus dados guardados|mostre? (a )?minha memoria)\b/.test(norm)) {
    return "ver_memoria";
  }
  return undefined;
}
