import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { AlertOctagon, CheckCircle2, Shield, Plus, X } from 'lucide-react';
import { Certificate } from '../types';

export const Certificates: React.FC = () => {
  const { certificates, addCertificate, updateCertificate } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCert, setEditingCert] = useState<Certificate | null>(null);

  const [formData, setFormData] = useState<Partial<Certificate>>({
    name: '',
    issuer: '',
    issueDate: '',
    expiryDate: '',
    type: 'SSL'
  });

  const getDaysRemaining = (expiry: string) => {
    const today = new Date();
    const exp = new Date(expiry);
    const diff = exp.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 3600 * 24));
  };

  const handleOpenModal = (cert?: Certificate) => {
    if (cert) {
      setEditingCert(cert);
      setFormData(cert);
    } else {
      setEditingCert(null);
      setFormData({
        name: '',
        issuer: '',
        issueDate: new Date().toISOString().split('T')[0],
        expiryDate: '',
        type: 'SSL'
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.name || !formData.expiryDate) return;

    if (editingCert) {
      updateCertificate({ ...editingCert, ...formData } as Certificate);
    } else {
      addCertificate({
        id: `c${Date.now()}`,
        name: formData.name || '',
        issuer: formData.issuer || '',
        issueDate: formData.issueDate || '',
        expiryDate: formData.expiryDate || '',
        type: formData.type || 'SSL',
      });
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Gerenciador de Certificados</h1>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Novo Certificado
        </button>
      </div>

      <div className="grid gap-4">
        {certificates.map((cert) => {
          const daysLeft = getDaysRemaining(cert.expiryDate);
          const isExpired = daysLeft < 0;
          const isWarning = daysLeft < 30 && !isExpired;

          return (
            <div key={cert.id} className={`bg-white p-6 rounded-xl border ${isExpired ? 'border-red-200' : isWarning ? 'border-amber-200' : 'border-slate-200'} shadow-sm flex items-center justify-between`}>
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${isExpired ? 'bg-red-100' : isWarning ? 'bg-amber-100' : 'bg-green-100'}`}>
                  <Shield className={`w-6 h-6 ${isExpired ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-green-600'}`} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{cert.name}</h3>
                  <p className="text-sm text-slate-500">Emissor: {cert.issuer} • Tipo: {cert.type}</p>
                </div>
              </div>

              <div className="flex items-center gap-8">
                <div className="text-right">
                  <p className="text-xs text-slate-500 uppercase font-semibold">Expira em</p>
                  <p className={`font-medium ${isExpired ? 'text-red-600' : 'text-slate-900'}`}>{cert.expiryDate}</p>
                </div>
                <div className="text-right w-32">
                  <p className="text-xs text-slate-500 uppercase font-semibold">Status</p>
                  {isExpired ? (
                    <span className="flex items-center justify-end gap-1 text-red-600 font-bold">
                       <AlertOctagon className="w-4 h-4" /> Expirado
                    </span>
                  ) : (
                    <span className={`flex items-center justify-end gap-1 font-bold ${isWarning ? 'text-amber-600' : 'text-green-600'}`}>
                        {isWarning ? <AlertOctagon className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                        {daysLeft} Dias
                    </span>
                  )}
                </div>
                <button 
                  onClick={() => handleOpenModal(cert)}
                  className={`px-3 py-1.5 text-xs font-medium rounded ${isExpired || isWarning ? 'bg-slate-900 text-white hover:bg-slate-700' : 'text-slate-600 border border-slate-300 hover:bg-slate-50'}`}
                >
                    {isExpired || isWarning ? 'Renovar/Editar' : 'Detalhes'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-900">{editingCert ? 'Editar Certificado' : 'Novo Certificado'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Certificado</label>
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Emissor</label>
                <input 
                  type="text" 
                  value={formData.issuer} 
                  onChange={(e) => setFormData({...formData, issuer: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Emissão</label>
                    <input 
                      type="date" 
                      value={formData.issueDate} 
                      onChange={(e) => setFormData({...formData, issueDate: e.target.value})}
                      className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Expiração</label>
                    <input 
                      type="date" 
                      value={formData.expiryDate} 
                      onChange={(e) => setFormData({...formData, expiryDate: e.target.value})}
                      className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
              </div>
               <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                <select 
                  value={formData.type} 
                  onChange={(e) => setFormData({...formData, type: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="SSL">SSL</option>
                  <option value="License">Licença</option>
                  <option value="Warranty">Garantia</option>
                  <option value="Access Key">Chave de Acesso</option>
                </select>
              </div>

              <button 
                onClick={handleSave}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 mt-2"
              >
                Salvar Certificado
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};