import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { User } from '../types';
import { Plus, X, User as UserIcon, Shield, Briefcase } from 'lucide-react';

export const Users: React.FC = () => {
  const { users, addUser, updateUser } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<Partial<User>>({
    name: '',
    email: '',
    role: 'Técnico',
  });

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData(user);
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        email: '',
        role: 'Técnico',
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.name || !formData.email) return;

    if (editingUser) {
      updateUser({ ...editingUser, ...formData } as User);
    } else {
      addUser({
        id: `u${Date.now()}`,
        name: formData.name || '',
        email: formData.email || '',
        role: formData.role as any,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.name || '')}&background=random`
      });
    }
    setIsModalOpen(false);
  };

  const getRoleBadge = (role: string) => {
      switch(role) {
          case 'Admin': return <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full flex items-center gap-1"><Shield className="w-3 h-3" /> Admin</span>;
          case 'Técnico': return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center gap-1"><Briefcase className="w-3 h-3" /> Técnico</span>;
          default: return <span className="bg-slate-100 text-slate-800 text-xs px-2 py-1 rounded-full flex items-center gap-1"><UserIcon className="w-3 h-3" /> Cliente</span>;
      }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Gerenciamento de Usuários</h1>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Novo Usuário
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-semibold text-slate-900">Usuário</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Email</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Função</th>
              <th className="px-6 py-4 font-semibold text-slate-900">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-3">
                  <img src={user.avatar || `https://ui-avatars.com/api/?name=${user.name}`} alt="" className="w-8 h-8 rounded-full" />
                  {user.name}
                </td>
                <td className="px-6 py-4">{user.email}</td>
                <td className="px-6 py-4">
                  {getRoleBadge(user.role)}
                </td>
                <td className="px-6 py-4">
                  <button 
                    onClick={() => handleOpenModal(user)}
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
              <h2 className="text-xl font-bold text-slate-900">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input 
                  type="email" 
                  value={formData.email} 
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Função</label>
                <select 
                  value={formData.role} 
                  onChange={(e) => setFormData({...formData, role: e.target.value as any})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Técnico">Técnico</option>
                  <option value="Admin">Admin</option>
                  <option value="Cliente">Cliente</option>
                </select>
              </div>
              
              <button 
                onClick={handleSave}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 mt-2"
              >
                Salvar Usuário
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};