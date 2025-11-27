import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Ticket, Server, FileBadge, BookOpen, BarChart3, Users, Menu, X, ExternalLink, LogOut, Wallet } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface SidebarItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ to, icon: Icon, label }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
        isActive
          ? 'bg-blue-600 text-white'
          : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`
    }
  >
    <Icon className="w-5 h-5" />
    <span>{label}</span>
  </NavLink>
);

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const { currentUser, logout } = useApp();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!currentUser) return null;

  // Menu configuration based on Roles
  const menuItems = [
    { to: "/", icon: LayoutDashboard, label: "Painel (Dashboard)", roles: ['Admin', 'Técnico'] },
    { to: "/tickets", icon: Ticket, label: "Chamados", roles: ['Admin', 'Técnico'] },
    { to: "/assets", icon: Server, label: "Ativos", roles: ['Admin', 'Técnico'] },
    { to: "/certificates", icon: FileBadge, label: "Certificados", roles: ['Admin', 'Técnico'] },
    { to: "/knowledge-base", icon: BookOpen, label: "Base de Conhecimento", roles: ['Admin', 'Técnico'] },
    { to: "/bills", icon: Wallet, label: "Boletos a Pagar", roles: ['Admin'] }, // Only Admin sees Boletos
    { to: "/users", icon: Users, label: "Usuários", roles: ['Admin'] }, // Only Admin sees Users
    { to: "/reports", icon: BarChart3, label: "Relatórios", roles: ['Admin', 'Técnico'] },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-200 ease-in-out flex flex-col`}>
        <div className="flex items-center justify-between h-16 px-6 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2 font-bold text-xl">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <span className="text-white">N</span>
            </div>
            IT Nexus
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
          {menuItems
            .filter(item => item.roles.includes(currentUser.role))
            .map((item) => (
              <SidebarItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
            ))}
            
            {/* Divider */}
            <div className="my-4 border-t border-slate-800"></div>

            <a 
              href="#/portal" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg text-emerald-400 hover:bg-slate-800 hover:text-emerald-300 transition-colors"
            >
               <ExternalLink className="w-5 h-5" />
               <span>Portal do Cliente</span>
            </a>
        </nav>

        <div className="p-4 border-t border-slate-800 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-center gap-3">
                <img src={currentUser.avatar} alt="User" className="w-10 h-10 rounded-full bg-slate-700" />
                <div>
                  <p className="text-sm font-medium truncate w-24">{currentUser.name}</p>
                  <p className="text-xs text-slate-500">{currentUser.role}</p>
                </div>
             </div>
             <button onClick={handleLogout} className="text-slate-400 hover:text-red-400" title="Sair">
               <LogOut className="w-5 h-5" />
             </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200">
           <div className="font-bold text-lg text-slate-800">IT Nexus</div>
           <button onClick={() => setIsMobileMenuOpen(true)} className="text-slate-600">
             <Menu className="w-6 h-6" />
           </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
};