import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TicketStatus, Priority } from '../types';
import { AlertCircle, CheckCircle2, Clock, ShieldAlert, Sparkles } from 'lucide-react';
import { checkCertificateRisks } from '../services/geminiService';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

const StatCard = ({ title, value, icon: Icon, color }: { title: string, value: string | number, icon: any, color: string }) => (
  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
    <div>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <h3 className="text-2xl font-bold mt-1 text-slate-900">{value}</h3>
    </div>
    <div className={`p-3 rounded-lg ${color} bg-opacity-10`}>
      <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
    </div>
  </div>
);

export const Dashboard: React.FC = () => {
  const { tickets, certificates, assets } = useApp();
  const [aiInsight, setAiInsight] = useState<string>("");
  const [loadingAi, setLoadingAi] = useState(false);

  const openTickets = tickets.filter(t => t.status !== TicketStatus.RESOLVED).length;
  const criticalTickets = tickets.filter(t => t.priority === Priority.CRITICAL && t.status !== TicketStatus.RESOLVED).length;
  const expiringCerts = certificates.filter(c => {
    const expiry = new Date(c.expiryDate);
    const now = new Date();
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 30 && diffDays >= 0;
  }).length;
  const activeAssets = assets.filter(a => a.status === 'Ativo').length;

  const statusData = [
    { name: 'Novo', value: tickets.filter(t => t.status === TicketStatus.NEW).length },
    { name: 'Em Andamento', value: tickets.filter(t => t.status === TicketStatus.IN_PROGRESS).length },
    { name: 'Revisão', value: tickets.filter(t => t.status === TicketStatus.IN_REVIEW).length },
    { name: 'Resolvido', value: tickets.filter(t => t.status === TicketStatus.RESOLVED).length },
  ];

  const handleAiAnalysis = async () => {
    setLoadingAi(true);
    const insight = await checkCertificateRisks(certificates);
    setAiInsight(insight);
    setLoadingAi(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Visão Geral do Painel</h1>
          <p className="text-slate-500">Bem-vindo de volta, aqui está o resumo de hoje.</p>
        </div>
        <button 
          onClick={handleAiAnalysis}
          disabled={loadingAi}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:opacity-90 transition disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          {loadingAi ? 'Analisando...' : 'Análise de Risco IA'}
        </button>
      </div>

      {aiInsight && (
        <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg">
          <h4 className="font-semibold text-purple-800 flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4" /> Insight Gemini
          </h4>
          <p className="text-sm text-purple-700 whitespace-pre-line">{aiInsight}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Chamados Abertos" value={openTickets} icon={AlertCircle} color="bg-blue-600" />
        <StatCard title="Tickets Críticos" value={criticalTickets} icon={ShieldAlert} color="bg-red-600" />
        <StatCard title="Certs. Expirando" value={expiringCerts} icon={Clock} color="bg-amber-500" />
        <StatCard title="Ativos Ativos" value={activeAssets} icon={CheckCircle2} color="bg-green-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Status dos Chamados</h3>
          <div className="h-64">
             <ResponsiveContainer width="100%" height="100%">
               <PieChart>
                 <Pie
                   data={statusData}
                   cx="50%"
                   cy="50%"
                   innerRadius={60}
                   outerRadius={80}
                   fill="#8884d8"
                   paddingAngle={5}
                   dataKey="value"
                 >
                   {statusData.map((entry, index) => (
                     <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                   ))}
                 </Pie>
                 <Tooltip />
               </PieChart>
             </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-4 flex-wrap">
            {statusData.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2 text-sm text-slate-600">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                {entry.name} ({entry.value})
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Volume Semanal</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { name: 'Seg', tickets: 12 },
                  { name: 'Ter', tickets: 19 },
                  { name: 'Qua', tickets: 15 },
                  { name: 'Qui', tickets: 22 },
                  { name: 'Sex', tickets: 18 },
                  { name: 'Sáb', tickets: 5 },
                  { name: 'Dom', tickets: 3 },
                ]}
              >
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="tickets" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};