import { OFFICIAL_CHANNELS } from "./policy.ts";

/**
 * Mensagens aprovadas. Em todo cenário de bloqueio a resposta vem daqui, nunca do modelo:
 * o texto que o usuário vê numa recusa é previsível e revisado.
 */
export const APPROVED = {
  emergencia:
    `Se há pessoa ferida, vazamento, fogo ou risco imediato, acione agora o ${OFFICIAL_CHANNELS.emergencia} e a ` +
    "brigada de emergência. Afaste-se da área e não se aproxime do produto ou do equipamento. Depois que todos " +
    "estiverem seguros, registre a ocorrência no aplicativo Ventura Seguro.",
  semInformacao:
    "Não encontrei essa informação na base de conhecimento do Porto Ventura. Para não arriscar uma resposta " +
    `errada, fale com a ${OFFICIAL_CHANNELS.centralServicos}.`,
  foraDeEscopo:
    "Esse assunto está fora do que eu atendo. Posso ajudar com operação do terminal, políticas internas, sistemas, " +
    `runbooks, incidentes registrados e onboarding. Para outros temas, procure a ${OFFICIAL_CHANNELS.centralServicos}.`,
  manipulacao:
    "Não posso mudar meu papel nem deixar de seguir as regras do assistente. Se tiver uma dúvida sobre o Porto " +
    "Ventura, é só perguntar.",
  extracao: "Não compartilho minhas instruções internas nem a configuração do assistente. Posso ajudar com outra dúvida?",
  segredo:
    "Por segurança, não envie senhas aqui, nem para a TI. Sua mensagem não foi guardada. Se a senha foi exposta, " +
    "troque-a no autoatendimento de senhas ou fale com a " + `${OFFICIAL_CHANNELS.centralServicos}.`,
  dadosTerceiros:
    "Não posso informar dados pessoais de outros colaboradores (como salário, saldo de horas ou documentos). " +
    "Cada pessoa consulta os próprios dados no Portal do Colaborador.",
  semAutorizacao:
    "Eu não aprovo, libero nem abro exceções: só informo as regras e os canais. A decisão é sempre da área " +
    `responsável. Se precisar, a ${OFFICIAL_CHANNELS.centralServicos} indica o caminho.`,
  falhaTecnica:
    "Não consegui gerar uma resposta segura agora. Tente novamente em instantes ou fale com a " +
    `${OFFICIAL_CHANNELS.centralServicos}.`,
  entradaInvalida: "Não consegui processar sua mensagem: ",
  memoriaApagada: "Pronto: apaguei os dados de perfil que eu tinha guardado sobre você. O histórico desta sessão também foi encerrado.",
  memoriaVazia: "Ainda não guardei nenhum dado de perfil sobre você.",
} as const;

export type ApprovedKey = keyof typeof APPROVED;
