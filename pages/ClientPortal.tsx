import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { TicketStatus, Priority, Ticket } from '../types';
import { Send, CheckCircle, Loader2 } from 'lucide-react';

export const ClientPortal: React.FC = () => {
  const { addTicket } = useApp();
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
      name: '',
      email: '',
      title: '',
      description: '',
      category: 'Geral',
      priority: Priority.MEDIUM
  });

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!formData.name || !formData.title || !formData.description || !formData.email) {
          alert('Por favor, preencha todos os campos obrigatórios.');
          return;
      }
      
      setIsSubmitting(true);

      // Simulate a small network delay for better UX
      await new Promise(resolve => setTimeout(resolve, 800));

      const newTicket: Ticket = {
          id: `t${Date.now()}`,
          title: formData.title,
          description: formData.description, // Corrected to only be the description
          requester: formData.name,
          requesterEmail: formData.email, // Assign email to the new requesterEmail field
          priority: formData.priority,
          status: TicketStatus.NEW,
          category: formData.category,
          createdAt: new Date().toISOString(),
          assignedTo: undefined,
          comments: []
      };

      addTicket(newTicket);
      setSubmitted(true);
      setIsSubmitting(false);
  };

  if (submitted) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center animate-fade-in-up">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Chamado Recebido!</h1>
                <p className="text-slate-600 mb-6">Recebemos sua solicitação com sucesso. Nossa equipe de suporte entrará em contato em breve pelo email fornecido.</p>
                <button 
                    onClick={() => { setSubmitted(false); setFormData({ name: '', email: '', title: '', description: '', category: 'Geral', priority: Priority.MEDIUM }); }}
                    className="text-blue-600 font-medium hover:underline"
                >
                    Abrir novo chamado
                </button>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="mb-8 text-center">
            <div className="flex items-center justify-center gap-2 font-bold text-2xl text-slate-900 mb-2">
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                    <span className="text-white">N</span>
                </div>
                IT Nexus
            </div>
            <p className="text-slate-500">Portal de Suporte ao Cliente</p>
        </div>

        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
            <div className="bg-blue-600 p-6 text-white">
                <h2 className="text-xl font-bold">Abrir Novo Chamado</h2>
                <p className="text-blue-100 text-sm mt-1">Descreva seu problema abaixo e nós ajudaremos você.</p>
            </div>
            
            <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Seu Nome</label>
                        <input 
                            required
                            type="text" 
                            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Nome completo"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Email de Contato</label>
                        <input 
                            required
                            type="email" 
                            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="seu@email.com"
                            value={formData.email}
                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Assunto</label>
                    <input 
                        required
                        type="text" 
                        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Resumo curto do problema"
                        value={formData.title}
                        onChange={(e) => setFormData({...formData, title: e.target.value})}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                        <select 
                            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formData.category}
                            onChange={(e) => setFormData({...formData, category: e.target.value})}
                        >
                            <option value="Hardware">Hardware (Equipamentos)</option>
                            <option value="Software">Software (Programas)</option>
                            <option value="Rede">Rede / Internet</option>
                            <option value="Acesso">Login / Senha</option>
                            <option value="Geral">Outros</option>
                        </select>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Urgência</label>
                        <select 
                            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formData.priority}
                            onChange={(e) => setFormData({...formData, priority: e.target.value as Priority})}
                        >
                            <option value={Priority.LOW}>Baixa - Pode aguardar</option>
                            <option value={Priority.MEDIUM}>Média - Impacta trabalho</option>
                            <option value={Priority.HIGH}>Alta - Bloqueia trabalho</option>
                            <option value={Priority.CRITICAL}>Crítica - Sistema parado</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Descrição Detalhada</label>
                    <textarea 
                        required
                        rows={5}
                        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Por favor, forneça o máximo de detalhes possível..."
                        value={formData.description}
                        onChange={(e) => setFormData({...formData, description: e.target.value})}
                    />
                </div>

                <div className="pt-2">
                    <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                        {isSubmitting ? 'Enviando Chamado...' : 'Enviar Chamado'}
                    </button>
                </div>
            </form>
        </div>
        
        <p className="mt-8 text-sm text-slate-400">© 2024 IT Nexus Service Management</p>
    </div>
  );
};