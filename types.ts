// Enums
export enum Priority {
  LOW = 'Baixa',
  MEDIUM = 'Média',
  HIGH = 'Alta',
  CRITICAL = 'Crítica',
}

export enum TicketStatus {
  NEW = 'Novo',
  IN_PROGRESS = 'Em Progresso',
  IN_REVIEW = 'Em Revisão',
  RESOLVED = 'Resolvido',
}

export enum AssetStatus {
  ACTIVE = 'Ativo',
  MAINTENANCE = 'Manutenção',
  DISPOSED = 'Descartado',
  STORAGE = 'Estoque',
}

export enum AssetType {
  HARDWARE = 'Hardware',
  SOFTWARE = 'Software',
  PERIPHERAL = 'Periférico',
  SERVER = 'Servidor',
}

// New enum for Bill Status
export enum BillStatus {
  OPEN = 'Aberto',
  PAID = 'Pago',
  OVERDUE = 'Atrasado',
}

// Interfaces
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Técnico' | 'Cliente';
  avatar?: string;
  password?: string;
}

export interface Comment {
  id: string;
  userId: string;
  text: string;
  timestamp: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  requester: string;
  requesterEmail?: string; // Added for client portal email
  assignedTo?: string; // User ID
  priority: Priority;
  status: TicketStatus;
  category: string;
  createdAt: string;
  assetId?: string;
  comments: Comment[];
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  status: AssetStatus;
  location: string;
  purchaseDate: string;
  assignedTo?: string;
  specs?: string;
}

export interface Certificate {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  type: string; // e.g., SSL, License, Warranty
  linkedAssetId?: string;
}

export interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  views: number;
  author: string;
  lastUpdated: string;
}

// New interface for Bill
export interface Bill {
  id: string;
  description: string;
  value: number;
  dueDate: string;
  status: BillStatus;
  supplier: string;
  notes?: string; // Added for observations
}

export interface KpiData {
  openTickets: number;
  resolvedTickets: number;
  avgResolutionTimeHours: number;
  customerSatisfaction: number; // 0-5
}