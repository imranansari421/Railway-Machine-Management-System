import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { User } from 'firebase/auth';
import { findEmployeeForUser, EmployeeProfile } from '../utils/employee';
import PinGate from './PinGate';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { toast } from 'sonner';

interface ProtectedRouteProps {
  user: User | null;
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ user, children, requireAdmin = false }: ProtectedRouteProps) {
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
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
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
        }} 
      />
    );
  }

  if (requireAdmin) {
    const accessType = localStorage.getItem(`accessType_${user.uid}`) || 'limited';
    if (isEmployee && accessType !== 'full' && accessType !== 'admin-light') {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}

