import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Search, Book, Plus, X } from 'lucide-react';
import { Article } from '../types';

export const KnowledgeBase: React.FC = () => {
  const { articles, addArticle, updateArticle } = useApp();
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);

  const [formData, setFormData] = useState<Partial<Article>>({
    title: '',
    content: '',
    category: '',
    tags: [],
  });
  const [tagInput, setTagInput] = useState('');

  const filtered = articles.filter(a => 
    a.title.toLowerCase().includes(search.toLowerCase()) || 
    a.content.toLowerCase().includes(search.toLowerCase()) ||
    a.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  const handleOpenModal = (article?: Article) => {
    if (article) {
      setEditingArticle(article);
      setFormData(article);
      setTagInput('');
    } else {
      setEditingArticle(null);
      setFormData({
        title: '',
        content: '',
        category: '',
        tags: [],
      });
      setTagInput('');
    }
    setIsModalOpen(true);
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags?.includes(tagInput.trim())) {
      setFormData(prev => ({ ...prev, tags: [...(prev.tags || []), tagInput.trim()] }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({ ...prev, tags: prev.tags?.filter(t => t !== tagToRemove) }));
  };

  const handleSave = () => {
    if (!formData.title || !formData.content) return;

    if (editingArticle) {
        updateArticle({ ...editingArticle, ...formData, lastUpdated: new Date().toISOString().split('T')[0] } as Article);
    } else {
        addArticle({
            id: `kb${Date.now()}`,
            title: formData.title || '',
            content: formData.content || '',
            category: formData.category || 'Geral',
            tags: formData.tags || [],
            views: 0,
            author: 'Você', // Em um app real, pegaria do usuário logado
            lastUpdated: new Date().toISOString().split('T')[0]
        });
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="text-center py-10 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl text-white relative">
        <h1 className="text-3xl font-bold mb-4">Como podemos ajudar você?</h1>
        <div className="max-w-xl mx-auto relative px-4">
          <Search className="absolute left-8 top-3.5 text-slate-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Pesquise por artigos, guias ou soluções..." 
            className="bg-white text-slate-900 w-full pl-12 pr-4 py-3 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/30"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button 
            onClick={() => handleOpenModal()}
            className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 text-white p-2 rounded-lg flex items-center gap-2 text-sm backdrop-blur-sm"
        >
            <Plus className="w-4 h-4" /> Novo Artigo
        </button>
      </div>

      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Artigos Populares</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(article => (
            <div 
                key={article.id} 
                onClick={() => handleOpenModal(article)}
                className="bg-white p-6 rounded-xl border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer group shadow-sm"
            >
              <div className="flex justify-between items-start">
                 <h3 className="font-bold text-lg text-slate-900 group-hover:text-blue-600 transition-colors">{article.title}</h3>
                 <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">{article.category}</span>
              </div>
              <p className="text-slate-500 mt-2 line-clamp-2 text-sm">{article.content}</p>
              <div className="mt-4 flex items-center gap-2">
                {article.tags.map(tag => (
                   <span key={tag} className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">#{tag}</span>
                ))}
              </div>
              <div className="mt-4 text-xs text-slate-400 flex items-center gap-1">
                 <Book className="w-3 h-3" />
                 <span>{article.views} leituras • Atualizado em {article.lastUpdated}</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-slate-500 col-span-2 text-center py-8">Nenhum artigo encontrado.</p>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-900">{editingArticle ? 'Editar Artigo' : 'Novo Artigo'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Título</label>
                <input 
                  type="text" 
                  value={formData.title} 
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Como configurar VPN"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                <input 
                  type="text" 
                  value={formData.category} 
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Rede, Hardware..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Conteúdo</label>
                <textarea 
                  rows={8}
                  value={formData.content} 
                  onChange={(e) => setFormData({...formData, content: e.target.value})}
                  className="bg-white text-slate-900 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="Escreva o conteúdo do artigo aqui..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                <div className="flex gap-2 mb-2">
                    <input 
                        type="text" 
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        className="bg-white text-slate-900 flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nova tag"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    />
                    <button onClick={handleAddTag} className="bg-slate-200 px-3 rounded-lg text-sm font-medium hover:bg-slate-300">Add</button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {formData.tags?.map(tag => (
                        <span key={tag} className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                            #{tag}
                            <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                        </span>
                    ))}
                </div>
              </div>

              <button 
                onClick={handleSave}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 mt-2"
              >
                Salvar Artigo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};