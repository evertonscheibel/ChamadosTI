import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { TicketStatus, Priority, Ticket } from '../types';
import { Plus, MessageSquare, X } from 'lucide-react';
import { analyzeTicketWithAI } from '../services/geminiService';

export const TicketBoard: React.FC = () => {
  const { tickets, updateTicketStatus, addTicket, users } = useApp();
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string>("");

  // New Ticket Form State
  const [newTicketData, setNewTicketData] = useState<Partial<Ticket>>({
      title: '',
      description: '',
      requester: '',
      requesterEmail: '', // Added requesterEmail
      priority: Priority.MEDIUM,
      category: 'Geral',
      assignedTo: ''
  });

  // Simple Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, ticketId: string) => {
    e.dataTransfer.setData('ticketId', ticketId);
  };

  const handleDrop = (e: React.DragEvent, status: TicketStatus) => {
    e.preventDefault();
    const ticketId = e.dataTransfer.getData('ticketId');
    if (ticketId) updateTicketStatus(ticketId, status);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleAiAssist = async (ticket: Ticket) => {
      setAiSuggestion("Pensando...");
      const result = await analyzeTicketWithAI(ticket);
      setAiSuggestion(result);
  };

  const handleCreateTicket = () => {
      if(!newTicketData.title || !newTicketData.description || !newTicketData.requester || !newTicketData.requesterEmail) return;

      const ticket: Ticket = {
          id: `t${Date.now()}`,
          title: newTicketData.title || 'Sem Título',
          description: newTicketData.description || '',
          requester: newTicketData.requester || 'Anônimo',
          requesterEmail: newTicketData.requesterEmail || '', // Store requesterEmail
          priority: newTicketData.priority || Priority.MEDIUM,
          status: TicketStatus.NEW,
          category: newTicketData.category || 'Geral',
          createdAt: new Date().toISOString(),
          assignedTo: newTicketData.assignedTo,
          comments: []
      };

      addTicket(ticket);
      setIsNewTicketModalOpen(false);
      setNewTicketData({
          title: '',
          description: '',
          requester: '',
          requesterEmail: '',
          priority: Priority.MEDIUM,
          category: 'Geral',
          assignedTo: ''
      });
  };

  const KanbanColumn = ({ status, title }: { status: TicketStatus; title: string }) => {
    const colTickets = tickets.filter((t) => t.status === status);
    return (
      <div 
        className="flex-1 bg-slate-100 rounded-xl p-4 min-w-[300px]"
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, status)}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-700">{title}</h3>
          <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-full font-medium">{colTickets.length}</span>
        </div>
        <div className="space-y-3">
          {colTickets.map((ticket) => (
            <div
              key={ticket.id}
              draggable
              onDragStart={(e) => handleDragStart(e, ticket.id)}
              onClick={() => { setSelectedTicket(ticket); setAiSuggestion(""); }}
              className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start mb-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  ticket.priority === Priority.CRITICAL ? 'bg-red-100 text-red-700' :
                  ticket.priority === Priority.HIGH ? 'bg-orange-100 text-orange-700' :
                  'bg-blue-100 text-blue-700'
                }`}>{ticket.priority}</span>
                <span className="text-xs text-slate-400">#{ticket.id}</span>
              </div>
              <h4 className="font-medium text-slate-900 mb-1">{ticket.title}</h4>
              <p className="text-xs text-slate-500 line-clamp-2">{ticket.description}</p>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <img src={`https://picsum.photos/seed/${ticket.requester}/24/24`} className="w-6 h-6 rounded-full" alt="avatar" />
                    <span className="text-xs text-slate-500">{ticket.requester}</span>
                </div>
                <div className="flex items-center gap-1 text-slate-400 text-xs">
                    <MessageSquare className="w-3 h-3" />
                    <span>{ticket.comments.length}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Quadro de Chamados</h1>
        <div className="flex gap-3">
            <div className="bg-white rounded-lg p-1 border border-slate-200 flex">
                <button 
                    onClick={() => setViewMode('kanban')}
                    className={`px-3 py-1.5 text-sm font-medium rounded ${viewMode === 'kanban' ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}
                >Kanban</button>
                <button 
                    onClick={() => setViewMode('list')}
                    className={`px-3 py-1.5 text-sm font-medium rounded ${viewMode === 'list' ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}
                >Lista</button>
            </div>
            <button 
                onClick={() => setIsNewTicketModalOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"
            >
                <Plus className="w-4 h-4" /> Novo Chamado
            </button>
        </div>
      </div>

      {viewMode === 'kanban' ? (
        <div className="flex gap-6 overflow-x-auto pb-4 flex-1">
          <KanbanColumn status={TicketStatus.NEW} title="Novo" />
          <KanbanColumn status={TicketStatus.IN_PROGRESS} title="Em Andamento" />
          <KanbanColumn status={TicketStatus.IN_REVIEW} title="Em Revisão" />
          <KanbanColumn status={TicketStatus.RESOLVED} title="Resolvido" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                        <th className="px-6 py-4 font-semibold text-slate-900">ID</th>
                        <th className="px-6 py-4 font-semibold text-slate-900">Assunto</th>
                        <th className="px-6 py-4 font-semibold text-slate-900">Solicitante</th>
                        <th className="px-6 py-4 font-semibold text-slate-900">Prioridade</th>
                        <th className="px-6 py-4 font-semibold text-slate-900">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {tickets.map(t => (
                        <tr key={t.id} onClick={() => { setSelectedTicket(t); setAiSuggestion(""); }} className="hover:bg-slate-50 cursor-pointer">
                            <td className="px-6 py-4">#{t.id}</td>
                            <td className="px-6 py-4 font-medium text-slate-900">{t.title}</td>
                            <td className="px-6 py-4">{t.requester}</td>
                            <td className="px-6 py-4">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    t.priority === Priority.CRITICAL ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                                }`}>
                                    {t.priority}
                                </span>
                            </td>
                            <td className="px-6 py-4">{t.status}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                <div className="p-6 border-b border-slate-100 flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-slate-400 text-sm">#{selectedTicket.id}</span>
                            <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">{selectedTicket.category}</span>
                        </div>
                        <h2 className="text-xl font-bold text-slate-900">{selectedTicket.title}</h2>
                    </div>
                    <button onClick={() => setSelectedTicket(null)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="p-6 space-y-6 flex-1">
                    <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label className="text-xs text-slate-500 uppercase font-semibold">Prioridade</label>
                            <p className="font-medium text-slate-800">{selectedTicket.priority}</p>
                         </div>
                         <div>
                            <label className="text-xs text-slate-500 uppercase font-semibold">Atribuído a</label>
                            <p className="font-medium text-slate-800">{selectedTicket.assignedTo || 'Não atribuído'}</p>
                         </div>
                    </div>
                    
                    <div>
                        <label className="text-xs text-slate-500 uppercase font-semibold">Descrição</label>
                        <p className="mt-1 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
                            {selectedTicket.description}
                        </p>
                    </div>

                    {/* AI Section */}
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                        <div className="flex justify-between items-center mb-2">
                             <h3 className="font-semibold text-indigo-900 flex items-center gap-2">
                                <span className="text-lg">✨</span> Agente IA
                             </h3>
                             <button 
                                onClick={() => handleAiAssist(selectedTicket)}
                                className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700"
                             >
                                Gerar Plano de Solução
                             </button>
                        </div>
                        {aiSuggestion ? (
                            <div className="text-sm text-indigo-800 whitespace-pre-wrap font-mono bg-white/50 p-2 rounded">
                                {aiSuggestion}
                            </div>
                        ) : (
                            <p className="text-xs text-indigo-600 italic">Clique para analisar este chamado e sugerir próximos passos.</p>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end gap-2">
                    <button onClick={() => setSelectedTicket(null)} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium">Fechar</button>
                    <button onClick={() => { updateTicketStatus(selectedTicket.id, TicketStatus.RESOLVED); setSelectedTicket(null); }} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">Marcar como Resolvido</button>
                </div>
            </div>
        </div>
      )}

      {/* New Ticket Modal */}
      {isNewTicketModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-lg p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-900">Novo Chamado</h2>
                    <button onClick={() => setIsNewTicketModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Título</label>
                        <input 
                            type="text" 
                            className="bg-white text-slate-900 placeholder:text-slate-400 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Resumo do problema"
                            value={newTicketData.title}
                            onChange={(e) => setNewTicketData({...newTicketData, title: e.target.value})}
                        />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Solicitante</label>
                            <input 
                                type="text"
                                className="bg-white text-slate-900 placeholder:text-slate-400 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                                placeholder="Nome do usuário"
                                value={newTicketData.requester}
                                onChange={(e) => setNewTicketData({...newTicketData, requester: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Email do Solicitante</label>
                            <input 
                                type="email"
                                className="bg-white text-slate-900 placeholder:text-slate-400 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                                placeholder="email@exemplo.com"
                                value={newTicketData.requesterEmail}
                                onChange={(e) => setNewTicketData({...newTicketData, requesterEmail: e.target.value})}
                            />
                        </div>
                    </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                            <select 
                                className="bg-white text-slate-900 placeholder:text-slate-400 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={newTicketData.category}
                                onChange={(e) => setNewTicketData({...newTicketData, category: e.target.value})}
                            >
                                <option value="Hardware">Hardware</option>
                                <option value="Software">Software</option>
                                <option value="Rede">Rede</option>
                                <option value="Acesso">Acesso</option>
                                <option value="Geral">Geral</option>
                            </select>
                        </div>
                         <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Atribuir a</label>
                            <select 
                                className="bg-white text-slate-900 placeholder:text-slate-400 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={newTicketData.assignedTo}
                                onChange={(e) => setNewTicketData({...newTicketData, assignedTo: e.target.value})}
                            >
                                <option value="">Sem atribuição</option>
                                {users.filter(u => u.role !== 'Cliente').map(u => (
                                    <option key={u.id} value={u.name}>{u.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    
                    <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Prioridade</label>
                            <select 
                                className="bg-white text-slate-900 placeholder:text-slate-400 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={newTicketData.priority}
                                onChange={(e) => setNewTicketData({...newTicketData, priority: e.target.value as Priority})}
                            >
                                {Object.values(Priority).map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Descrição Detalhada</label>
                        <textarea 
                            rows={4}
                            className="bg-white text-slate-900 placeholder:text-slate-400 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Descreva o incidente..."
                            value={newTicketData.description}
                            onChange={(e) => setNewTicketData({...newTicketData, description: e.target.value})}
                        />
                    </div>

                    <div className="pt-2 flex gap-3">
                         <button 
                            onClick={() => setIsNewTicketModalOpen(false)}
                            className="flex-1 py-2 text-slate-600 hover:bg-slate-50 rounded-lg font-medium"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={handleCreateTicket}
                            className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700"
                        >
                            Criar Chamado
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};