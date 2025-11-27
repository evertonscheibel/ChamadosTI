import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { TicketBoard } from './pages/TicketBoard';
import { Assets } from './pages/Assets';
import { Certificates } from './pages/Certificates';
import { Reports } from './pages/Reports';
import { KnowledgeBase } from './pages/KnowledgeBase';
import { Users } from './pages/Users';
import { ClientPortal } from './pages/ClientPortal';
import { Login } from './pages/Login';
import { Bills } from './pages/Bills'; // Import the new Bills page

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useApp();
  return currentUser ? <>{children}</> : <Navigate to="/login" replace />;
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/portal" element={<ClientPortal />} />
          
          {/* Protected Routes */}
          <Route path="/*" element={
            <PrivateRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/tickets" element={<TicketBoard />} />
                  <Route path="/assets" element={<Assets />} />
                  <Route path="/certificates" element={<Certificates />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/knowledge-base" element={<KnowledgeBase />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/bills" element={<Bills />} /> {/* Add the Bills route */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </PrivateRoute>
          } />
        </Routes>
      </HashRouter>
    </AppProvider>
  );
};

export default App;