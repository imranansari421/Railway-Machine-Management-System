/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './firebase';
import { Toaster } from 'sonner';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import HR from './pages/HR';
import Catalog from './pages/Catalog';
import Demand from './pages/Demand';
import DemandDetail from './pages/DemandDetail';
import Issue from './pages/Issue';
import Report from './pages/Report';
import Profile from './pages/Profile';
import MessageCenter from './pages/MessageCenter';
import Folders from './pages/Folders';
import Maintenance from './pages/Maintenance';
import MachineMovement from './pages/MachineMovement';
import BreakDown from './pages/BreakDown';
import ServiceEngineerReport from './pages/ServiceEngineerReport';
import Consumption from './pages/Consumption';
import Inbox from './pages/Inbox';
import Requisition from './pages/Requisition';
import Contracts from './pages/Contracts';
import Store from './pages/Store';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const APP_TITLE = "RMMS - Railway Machine Management System";
    document.title = APP_TITLE;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.document.title = APP_TITLE;
      }
    } catch {
      // Ignore iframe CORS
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/" /> : <ForgotPassword />} />
        <Route
          path="/"
          element={
            <ProtectedRoute user={user}>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="hr" element={<ProtectedRoute user={user} requireAdmin><HR /></ProtectedRoute>} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="demand" element={<Demand />} />
          <Route path="requisition" element={<Requisition />} />
          <Route path="contracts" element={<ProtectedRoute user={user} requireAdmin><Contracts /></ProtectedRoute>} />
          <Route path="store" element={<Store />} />
          <Route path="issue" element={<Issue />} />
          <Route path="report" element={<Report />} />
          <Route path="profile" element={<Profile />} />
          <Route path="messages" element={<MessageCenter />} />
          <Route path="todos" element={<Folders />} />
          <Route path="maintenance" element={<Maintenance />} />
          <Route path="machine-movement" element={<MachineMovement />} />
          <Route path="break-down" element={<BreakDown />} />
          <Route path="service-engineer-report" element={<ServiceEngineerReport />} />
          <Route path="consumption" element={<Consumption />} />
          <Route path="inbox" element={<Inbox />} />
        </Route>
        <Route path="/demand-detail/:id" element={<ProtectedRoute user={user}><DemandDetail /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}
