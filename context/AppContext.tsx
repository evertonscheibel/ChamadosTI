import React, { createContext, useContext, useState, useEffect } from 'react';
import { Ticket, Asset, Certificate, Article, TicketStatus, Priority, AssetStatus, AssetType, User, Bill, BillStatus } from '../types';

// Mock Data (Used only if localStorage is empty)
const MOCK_USERS: User[] = [
  { id: 'u0', name: 'Root User', email: 'root@itnexus.com', role: 'Admin', password: 'Root', avatar: 'https://ui-avatars.com/api/?name=Root+User&background=random' },
  { id: 'u1', name: 'Alice Admin', email: 'alice@itnexus.com', role: 'Admin', password: 'password123', avatar: 'https://ui-avatars.com/api/?name=Alice+Admin&background=random' },
  { id: 'u2', name: 'Roberto Tec', email: 'roberto@itnexus.com', role: 'Técnico', password: 'techpass', avatar: 'https://ui-avatars.com/api/?name=Roberto+Tec&background=random' },
  { id: 'u3', name: 'Carlos Usuário', email: 'carlos@cliente.com', role: 'Cliente', password: 'clientpass', avatar: 'https://ui-avatars.com/api/?name=Carlos+Usuario&background=random' },
];

const MOCK_ASSETS: Asset[] = [
  { id: 'a1', name: 'MacBook Pro 16"', type: AssetType.HARDWARE, status: AssetStatus.ACTIVE, location: 'Escritório SP', purchaseDate: '2023-01-15' },
  { id: 'a2', name: 'Servidor Dell PowerEdge', type: AssetType.SERVER, status: AssetStatus.ACTIVE, location: 'Sala de Servidores A', purchaseDate: '2022-05-20' },
  { id: 'a3', name: 'Adobe Creative Cloud', type: AssetType.SOFTWARE, status: AssetStatus.ACTIVE, location: 'Nuvem', purchaseDate: '2023-11-01' },
];

const MOCK_CERTIFICATES: Certificate[] = [
  { id: 'c1', name: 'SSL Wildcard *.empresa.com', issuer: 'DigiCert', issueDate: '2023-01-01', expiryDate: '2024-01-01', type: 'SSL' },
  { id: 'c2', name: 'Acesso Produção AWS', issuer: 'AWS', issueDate: '2023-06-15', expiryDate: '2025-06-15', type: 'Chave de Acesso' },
  { id: 'c3', name: 'Garantia Servidor Legacy', issuer: 'Dell', issueDate: '2020-03-10', expiryDate: '2023-03-10', type: 'Garantia' },
];

const MOCK_TICKETS: Ticket[] = [
  { 
    id: 't1', 
    title: 'Falha na Conexão VPN', 
    description: 'Não consigo conectar na VPN usando o novo cliente. Erro 404.', 
    requester: 'Carlos Usuário', 
    requesterEmail: 'carlos@cliente.com', // Added for consistency
    assignedTo: 'Roberto Tec',
    priority: Priority.HIGH, 
    status: TicketStatus.IN_PROGRESS, 
    category: 'Rede', 
    createdAt: '2023-10-25T09:00:00Z',
    comments: []
  },
  { 
    id: 't2', 
    title: 'Solicitação de Monitor', 
    description: 'Meu monitor secundário está piscando intermitentemente.', 
    requester: 'Alice Admin', 
    requesterEmail: 'alice@itnexus.com', // Added for consistency
    assignedTo: undefined,
    priority: Priority.LOW, 
    status: TicketStatus.NEW, 
    category: 'Hardware', 
    createdAt: '2023-10-26T10:30:00Z',
    comments: []
  },
];

const MOCK_ARTICLES: Article[] = [
  { id: 'kb1', title: 'Como Resetar Configuração da VPN', content: 'Passo 1: Abra as Configurações...', category: 'Rede', tags: ['vpn', 'remoto'], views: 150, author: 'Roberto Tec', lastUpdated: '2023-09-01' },
  { id: 'kb2', title: 'Solicitando Novo Hardware', content: 'Preencha o formulário RH-402...', category: 'Política', tags: ['hardware', 'rh'], views: 85, author: 'Alice Admin', lastUpdated: '2023-01-10' },
];

// New mock data for Bills
const MOCK_BILLS: Bill[] = [
  { id: 'b1', description: 'Licença Software Antivírus', value: 1200.00, dueDate: '2024-05-10', status: BillStatus.OPEN, supplier: 'Norton Corp', notes: 'Renovação anual' },
  { id: 'b2', description: 'Serviço de Cloud AWS', value: 3500.50, dueDate: '2024-04-20', status: BillStatus.OVERDUE, supplier: 'Amazon Web Services', notes: 'Uso mensal' },
  { id: 'b3', description: 'Manutenção de Servidores', value: 800.00, dueDate: '2024-03-01', status: BillStatus.PAID, supplier: 'Tech Solutions', notes: 'Contrato trimestral' },
  { id: 'b4', description: 'Licença Sistema ERP', value: 5000.00, dueDate: '2024-06-25', status: BillStatus.OPEN, supplier: 'SAP Brasil', notes: 'Licença anual para 50 usuários' },
  { id: 'b5', description: 'Consumo Energia Escritório', value: 750.00, dueDate: '2024-05-02', status: BillStatus.OPEN, supplier: 'Light S.A.', notes: 'Vencimento próximo' },
];

interface AppContextType {
  tickets: Ticket[];
  assets: Asset[];
  certificates: Certificate[];
  articles: Article[];
  users: User[];
  bills: Bill[];
  currentUser: User | null;
  addTicket: (ticket: Ticket) => void;
  updateTicketStatus: (id: string, status: TicketStatus) => void;
  updateTicket: (ticket: Ticket) => void;
  addAsset: (asset: Asset) => void;
  updateAsset: (asset: Asset) => void;
  addCertificate: (cert: Certificate) => void;
  updateCertificate: (cert: Certificate) => void;
  addArticle: (article: Article) => void;
  updateArticle: (article: Article) => void;
  addUser: (user: User) => void;
  updateUser: (user: User) => void;
  addBill: (bill: Bill) => void;
  updateBill: (bill: Bill) => void;
  login: (email: string, password: string) => boolean; // Updated login to accept password
  logout: () => void;
  registerAndLogin: (name: string, email: string, password: string, role?: User['role']) => boolean; // New function
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Helper to load from localStorage
const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  const stored = localStorage.getItem(key);
  try {
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (error) {
    console.error(`Error parsing localStorage key "${key}":`, error);
    return defaultValue;
  }
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tickets, setTickets] = useState<Ticket[]>(() => loadFromStorage('tickets', MOCK_TICKETS));
  const [assets, setAssets] = useState<Asset[]>(() => loadFromStorage('assets', MOCK_ASSETS));
  const [certificates, setCertificates] = useState<Certificate[]>(() => loadFromStorage('certificates', MOCK_CERTIFICATES));
  const [articles, setArticles] = useState<Article[]>(() => loadFromStorage('articles', MOCK_ARTICLES));
  const [users, setUsers] = useState<User[]>(() => loadFromStorage('users', MOCK_USERS));
  const [bills, setBills] = useState<Bill[]>(() => loadFromStorage('bills', MOCK_BILLS));
  const [currentUser, setCurrentUser] = useState<User | null>(() => loadFromStorage('currentUser', null));

  // Persist to localStorage whenever state changes
  useEffect(() => { localStorage.setItem('tickets', JSON.stringify(tickets)); }, [tickets]);
  useEffect(() => { localStorage.setItem('assets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('certificates', JSON.stringify(certificates)); }, [certificates]);
  useEffect(() => { localStorage.setItem('articles', JSON.stringify(articles)); }, [articles]);
  useEffect(() => { localStorage.setItem('users', JSON.stringify(users)); }, [users]);
  useEffect(() => { localStorage.setItem('bills', JSON.stringify(bills)); }, [bills]);
  useEffect(() => { 
    if (currentUser) {
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('currentUser');
    }
  }, [currentUser]);

  // Sync across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'tickets' && e.newValue) setTickets(JSON.parse(e.newValue));
      if (e.key === 'assets' && e.newValue) setAssets(JSON.parse(e.newValue));
      if (e.key === 'certificates' && e.newValue) setCertificates(JSON.parse(e.newValue));
      if (e.key === 'articles' && e.newValue) setArticles(JSON.parse(e.newValue));
      if (e.key === 'users' && e.newValue) setUsers(JSON.parse(e.newValue));
      if (e.key === 'bills' && e.newValue) setBills(JSON.parse(e.newValue));
      if (e.key === 'currentUser' && e.newValue !== null) { // Only update if newValue is not null
        setCurrentUser(JSON.parse(e.newValue));
      } else if (e.key === 'currentUser' && e.newValue === null) {
        setCurrentUser(null);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Auth
  const login = (email: string, password: string) => {
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (user) {
      setCurrentUser(user);
      return true;
    }
    return false;
  };

  const logout = () => {
    setCurrentUser(null);
  };

  const registerAndLogin = (name: string, email: string, password: string, role: User['role'] = 'Cliente') => {
    const newUser: User = {
      id: `u${Date.now()}`,
      name,
      email,
      password,
      role,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
    };
    setUsers(prev => [...prev, newUser]); // Add new user
    setCurrentUser(newUser); // Log in the new user immediately
    return true;
  };

  // Tickets
  const addTicket = (ticket: Ticket) => {
    setTickets((prev) => [ticket, ...prev]);
  };

  const updateTicketStatus = (id: string, status: TicketStatus) => {
    setTickets((prev) => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const updateTicket = (ticket: Ticket) => {
    setTickets((prev) => prev.map(t => t.id === ticket.id ? ticket : t));
  };

  // Assets
  const addAsset = (asset: Asset) => {
    setAssets(prev => [...prev, asset]);
  };

  const updateAsset = (asset: Asset) => {
    setAssets(prev => prev.map(a => a.id === asset.id ? asset : a));
  };

  // Certificates
  const addCertificate = (cert: Certificate) => {
    setCertificates(prev => [...prev, cert]);
  };

  const updateCertificate = (cert: Certificate) => {
    setCertificates(prev => prev.map(c => c.id === cert.id ? cert : c));
  };

  // Articles
  const addArticle = (article: Article) => {
    setArticles(prev => [article, ...prev]);
  };

  const updateArticle = (article: Article) => {
    setArticles(prev => prev.map(a => a.id === article.id ? article : a));
  };

  // Users
  const addUser = (user: User) => {
    setUsers(prev => [...prev, user]);
  };

  const updateUser = (user: User) => {
    setUsers(prev => prev.map(u => u.id === user.id ? u : u));
  };

  // Bills
  const addBill = (bill: Bill) => {
    setBills(prev => [...prev, bill]);
  };

  const updateBill = (bill: Bill) => {
    setBills(prev => prev.map(b => b.id === bill.id ? bill : b));
  };

  return (
    <AppContext.Provider value={{ 
      tickets, assets, certificates, articles, users, bills, currentUser,
      addTicket, updateTicketStatus, updateTicket,
      addAsset, updateAsset,
      addCertificate, updateCertificate,
      addArticle, updateArticle,
      addUser, updateUser,
      addBill, updateBill,
      login, logout,
      registerAndLogin // Provide the new function
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
};