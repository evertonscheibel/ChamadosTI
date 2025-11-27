import { GoogleGenAI } from "@google/genai";
import { Ticket, Asset, Certificate } from "../types";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getGeminiInsight = async (prompt: string): Promise<string> => {
  if (!process.env.API_KEY) return "Chave de API não configurada.";
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "Nenhum insight gerado.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Falha ao gerar insight devido a um erro.";
  }
};

export const analyzeTicketWithAI = async (ticket: Ticket): Promise<string> => {
    const prompt = `
      Você é um especialista sênior em suporte de TI. Analise este chamado:
      Título: ${ticket.title}
      Descrição: ${ticket.description}
      Prioridade: ${ticket.priority}
      Categoria: ${ticket.category}
      
      Forneça um plano de ação conciso de 3 passos para resolver este problema. 
      RESPONDA EM PORTUGUÊS DO BRASIL.
    `;
    return await getGeminiInsight(prompt);
};

export const checkCertificateRisks = async (certs: Certificate[]): Promise<string> => {
  const certList = certs.map(c => `${c.name} expira em ${c.expiryDate}`).join('\n');
  const prompt = `
    Analise esta lista de certificados e suas datas de expiração. 
    Identifique quais são riscos críticos (expirando dentro de 30 dias a partir de hoje ${new Date().toISOString()}) 
    e sugira uma estratégia de priorização para renovação.
    Lista:
    ${certList}

    RESPONDA EM PORTUGUÊS DO BRASIL, de forma resumida.
  `;
  return await getGeminiInsight(prompt);
};

export const suggestKBArticle = async (query: string): Promise<string> => {
  const prompt = `
    Um usuário está pesquisando na Base de Conhecimento de TI por: "${query}".
    Sugira 3 títulos de artigos potenciais que melhor resolveriam o problema deles.
    Retorne apenas os títulos como uma lista com marcadores.
    RESPONDA EM PORTUGUÊS DO BRASIL.
  `;
  return await getGeminiInsight(prompt);
};