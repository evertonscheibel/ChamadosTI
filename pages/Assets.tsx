import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { AssetStatus, AssetType, Asset } from '../types';
import { Laptop, Box, Server, Disc, Plus, X } from 'lucide-react';

export const Assets: React.FC = () => {
  const { assets, addAsset, updateAsset } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

  // Form State
  const [formData, setFormData] = useState<Partial<Asset>>({
    name: '',
    type: AssetType.HARDWARE,
    status: AssetStatus.ACTIVE,
    location: '',
    purchaseDate: ''
  });

  const handleOpenModal = (asset?: Asset) => {
    if (asset) {
      setEditingAsset(asset);
      setFormData(asset);
    } else {
      setEditingAsset(null);
      setFormData({
        name: '',
        type: AssetType.HARDWARE,
        status: AssetStatus.ACTIVE,
        location: '',
        purchaseDate: new Date().toISOString().split('T')[0]
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.name || !formData.location) return; // Basic validation

    if (editingAsset) {
      updateAsset({ ...editingAsset, ...formData } as Asset);
    } else {
      const newAsset: Asset = {
        id: `a${Date.now()}`,
        name: formData.name || '',
        type: formData.type || AssetType.HARDWARE,
        status: formData.status || AssetStatus.ACTIVE,
        location: formData.location || '',
        purchaseDate: formData.purchaseDate || '',
      };
      addAsset(newAsset);
    }
    setIsModalOpen(false);
  };

  const getIcon = (type: AssetType) => {
    switch (type) {
      case AssetType.HARDWARE: return <Laptop className="w-5 h-5 text-blue-500" />;
      case AssetType.SERVER: return <Server className="w-5 h-5 text-indigo-500" />;
      case AssetType.SOFTWARE: return <Disc className="w-5 h-5 text-purple-500" />;
      default: return <Box className="w-5 h-5 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Inventário de Ativos</h1>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Novo Ativo
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-semibold text-slate-900">Nome</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Tipo</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Localização</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Status</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Data de Compra</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {assets.map((asset) => (
              <tr key={asset.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-3">
                  {getIcon(asset.type)}
                  {asset.name}
                </td>
                <td className="px-6 py-4">{asset.type}</td>
                <td className="px-6 py-4">{asset.location}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    asset.status === AssetStatus.ACTIVE ? 'bg-green-100 text-green-800' : 
                    asset.status === AssetStatus.MAINTENANCE ? 'bg-amber-100 text-amber-800' : 
                    'bg-red-100 text-red-800'
                  }`}>
                    {asset.status}
                  </span>
                </td>
                <td className="px-6 py-4">{asset.purchaseDate}</td>
                <td className="px-6 py-4">
                  <button 
                    onClick={() => handleOpenModal(asset)}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-900">{editingAsset ? 'Editar Ativo' : 'Adicionar Novo Ativo'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                <select 
                  value={formData.type} 
                  onChange={(e) => setFormData({...formData, type: e.target.value as AssetType})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.values(AssetType).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select 
                  value={formData.status} 
                  onChange={(e) => setFormData({...formData, status: e.target.value as AssetStatus})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.values(AssetStatus).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Localização</label>
                <input 
                  type="text" 
                  value={formData.location} 
                  onChange={(e) => setFormData({...formData, location: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data da Compra</label>
                <input 
                  type="date" 
                  value={formData.purchaseDate} 
                  onChange={(e) => setFormData({...formData, purchaseDate: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button 
                onClick={handleSave}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 mt-2"
              >
                Salvar Ativo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};