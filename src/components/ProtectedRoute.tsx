import React, { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { User } from 'firebase/auth';
import { findEmployeeForUser, EmployeeProfile } from '../utils/employee';
import PinGate from './PinGate';
import { TrackMachineLoader } from './TrackMachineLoader';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { toast } from 'sonner';

interface ProtectedRouteProps {
  user: User | null;
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireStoreAccess?: boolean;
  requireMasterAdmin?: boolean;
}

export default function ProtectedRoute({ user, children, requireAdmin = false, requireStoreAccess = false, requireMasterAdmin = false }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const [isPinVerified, setIsPinVerified] = useState<boolean>(() => {
    if (!user) return false;
    return sessionStorage.getItem(`pin_verified_${user.uid}`) === 'true';
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);

  useEffect(() => {
    async function checkEmployee() {
      if (!user) {
        setLoading(false);
        return;
      }
      
      const isEmployeeEmail = user.email?.endsWith('@employee.billedapp.com');
      if (!isEmployeeEmail) {
        // Admins don't need PIN
        setLoading(false);
        return;
      }

      try {
        const emp = await findEmployeeForUser(user.uid, user.email);
        if (emp) {
          if (emp.status === 'left') {
            toast.error("Your profile has been marked as 'Left'. Logging out.");
            await auth.signOut();
            return;
          }
          if (emp.companyName) {
            const q = query(
              collection(db, 'employees'),
              where('companyName', '==', emp.companyName),
              where('status', '==', 'active')
            );
            const snap = await getDocs(q);
            if (snap.empty) {
              toast.error("No active members found in your company. Access restricted.");
              await auth.signOut();
              return;
            }
          }
        }
        setEmployee(emp);
      } catch (error) {
        console.error('Error checking employee PIN:', error);
      } finally {
        setLoading(false);
      }
    }
    
    checkEmployee();
  }, [user, isPinVerified]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isEmployee = user.email?.endsWith('@employee.billedapp.com');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <TrackMachineLoader 
          message="Authorizing Railway Portal Access..." 
          subMessage="Verifying credentials & station assignments"
          theme="dark" 
          size="lg" 
        />
      </div>
    );
  }

  // If the user is an employee and has not verified their PIN, show PinGate
  if (isEmployee && !isPinVerified) {
    return (
      <PinGate 
        user={user} 
        employee={employee} 
        onVerified={() => {
          sessionStorage.setItem(`pin_verified_${user.uid}`, 'true');
          setIsPinVerified(true);
          navigate('/', { replace: true });
        }} 
      />
    );
  }

  if (requireMasterAdmin) {
    const accessType = localStorage.getItem(`accessType_${user.uid}`) || employee?.accessType || 'limited';
    const loginPortal = localStorage.getItem(`loginPortal_${user.uid}`) || '';
    const isMaster = user.email === 'imranansari399605@gmail.com' || (
      !isEmployee && 
      loginPortal !== 'employee' && 
      !employee?.employeeId && 
      accessType !== 'admin-light' && 
      accessType !== 'zonal-admin' && 
      accessType !== 'divisional-admin'
    );
    if (!isMaster) {
      toast.error('Access restricted. The Recycle Bin & Data Recovery Vault is exclusively restricted to Master Admin.');
      return <Navigate to="/" replace />;
    }
  }

  if (requireAdmin) {
    const accessType = localStorage.getItem(`accessType_${user.uid}`) || 'limited';
    if (isEmployee && accessType !== 'full' && accessType !== 'admin-light' && accessType !== 'divisional-admin' && accessType !== 'zonal-admin') {
      return <Navigate to="/" replace />;
    }
  }

  if (requireStoreAccess) {
    const accessType = localStorage.getItem(`accessType_${user.uid}`) || employee?.accessType || 'limited';
    const loginPortal = localStorage.getItem(`loginPortal_${user.uid}`) || '';
    const effectiveAccess = employee?.accessType || accessType;
    // Store access: Strictly allowed only for Master Admin (!isEmployee) and Company Admin (effectiveAccess === 'admin-light').
    // Strictly forbidden for zonal admin, divisional admin, full admin, and regular employees.
    if ((loginPortal === 'employee' || isEmployee) && effectiveAccess !== 'admin-light') {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}

