export const services = [
  {
    id: "holerite",
    title: "Holerite e pagamentos",
    description: "Solicite uma segunda via ou tire dúvidas sobre sua folha.",
    icon: "receipt",
    group: "Documentos e pagamentos",
    hint: "Informe o mês e o ano de referência e descreva o que precisa.",
    fields: ["Mês de referência"],
  },
  {
    id: "ferias",
    title: "Férias",
    description:
      "Consulte seu período ou solicite orientações para programação.",
    icon: "sun",
    group: "Sua jornada",
    hint: "Informe o período desejado. O RH irá orientar você sobre a programação.",
    fields: ["Período desejado"],
  },
  {
    id: "ponto",
    title: "Ponto e jornada",
    description: "Esclareça marcações, horas e ocorrências do seu ponto.",
    icon: "clock",
    group: "Sua jornada",
    hint: "Informe a data da ocorrência e os horários envolvidos.",
    fields: ["Data da ocorrência"],
  },
  {
    id: "beneficios",
    title: "Benefícios",
    description:
      "Tire dúvidas sobre transporte, alimentação e outros benefícios.",
    icon: "heart",
    group: "Benefícios e cadastro",
    hint: "Informe qual benefício e descreva sua solicitação.",
    fields: ["Benefício"],
  },
  {
    id: "declaracoes",
    title: "Declarações e documentos",
    description: "Peça uma declaração de vínculo ou outro documento do RH.",
    icon: "file",
    group: "Documentos e pagamentos",
    hint: "Descreva o documento necessário e a finalidade.",
    fields: ["Documento solicitado"],
  },
  {
    id: "cadastro",
    title: "Atualização cadastral",
    description:
      "Solicite orientações para atualizar seus dados e dependentes.",
    icon: "user",
    group: "Benefícios e cadastro",
    hint: "Informe quais dados deseja atualizar. Anexe apenas os documentos necessários.",
    fields: ["Dados a atualizar"],
  },
  {
    id: "atestado",
    title: "Atestados e afastamentos",
    description: "Encaminhe documentos e acompanhe a orientação do RH.",
    icon: "shield",
    group: "Sua jornada",
    hint: "Informe o período do afastamento e anexe o documento, se necessário.",
    fields: ["Período do afastamento"],
  },
  {
    id: "outros",
    title: "Fale com o RH",
    description: "Não encontrou o serviço? Conte para nós como podemos ajudar.",
    icon: "message",
    group: "Outros assuntos",
    hint: "Descreva sua solicitação com os detalhes necessários para o atendimento.",
    fields: [],
  },
];
export const statuses = [
  "Recebida",
  "Em atendimento",
  "Aguardando colaborador",
  "Concluída",
];
// Fonte única das dúvidas frequentes: usada pela página de Ajuda (Help, em
// CentralApp.tsx) e pelo sincronizador do RAG (knowledge-sync.mjs), para não
// manter o mesmo conteúdo duplicado em dois lugares.
export const faq = [
  [
    "Como faço uma solicitação?",
    "Entre com seu CPF e senha, escolha o serviço, preencha as informações e envie. Um protocolo será gerado para acompanhar o atendimento.",
  ],
  [
    "Onde acompanho a resposta do RH?",
    "Em Minhas solicitações, abra o protocolo. Você verá o status, as respostas, os documentos e o histórico do atendimento.",
  ],
  [
    "Posso enviar documentos?",
    "Sim. Você pode anexar até 3 arquivos PDF, JPG ou PNG por envio, com tamanho total de até 5 MB. Envie somente os documentos necessários para o assunto.",
  ],
  [
    "Solicitar férias significa que o período está aprovado?",
    "A solicitação inicia o atendimento. Aguarde a orientação e a confirmação do RH conforme o processo da empresa.",
  ],
  [
    "Como obtenho meu primeiro acesso?",
    "Seu cadastro e a liberação de acesso precisam ser confirmados pelo RH. Procure a equipe da sua unidade para receber as orientações.",
  ],
];
