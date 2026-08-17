import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, getDocs, setDoc, doc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { safeJsonStringify } from '../utils/firestore-errors';
import { LockOpen, Factory, Badge, Key, RefreshCw, LogIn, Plus, Loader2, Calendar, Facebook, Instagram, Globe, Send, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', safeJsonStringify(errInfo));
  throw new Error(safeJsonStringify(errInfo));
}

export default function Login() {
  const [loginMode, setLoginMode] = useState<'admin' | 'employee'>('admin');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  
  // Employee Login fields
  const [pfNo, setPfNo] = useState('');
  const [dob, setDob] = useState('');

  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaCode, setCaptchaCode] = useState('8X7P2');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const navigate = useNavigate();

  // First-time reset company admin states
  const [showFirstTimeResetModal, setShowFirstTimeResetModal] = useState(false);
  const [resetCompanyAdminId, setResetCompanyAdminId] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');

  const handleFirstTimeResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newPasswordInput || !confirmPasswordInput) {
      setError('Please fill in both password fields.');
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      // Fetch that company admin first to get the loginId for salting
      const empRef = doc(db, 'employees', resetCompanyAdminId);
      const docSnap = await getDoc(empRef);
      if (!docSnap.exists()) {
        setError('Employee not found.');
        setLoading(false);
        return;
      }
      const companyAdminData = docSnap.data();
      const loginIdClean = companyAdminData.loginId || '';

      const { hashPassword } = await import('../utils/crypto');
      const hashedPass = await hashPassword(newPasswordInput, loginIdClean);

      // Update employee document to change password and set firstTimeLogin to false
      await updateDoc(empRef, {
        password: hashedPass,
        firstTimeLogin: false
      });

      const sanitizedId = loginIdClean.toLowerCase().replace(/[^a-z0-9]/g, '');
      const email = `${sanitizedId}@employee.billedapp.com`;
      const staticPassword = 'EmployeePass123!';

        try {
          sessionStorage.clear();
          await signInWithEmailAndPassword(auth, email, staticPassword);
        } catch (err: any) {
          if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
            await createUserWithEmailAndPassword(auth, email, staticPassword);
          } else {
            throw err;
          }
        }

        await setDoc(doc(db, 'users', auth.currentUser!.uid), {
          uid: auth.currentUser!.uid,
          name: companyAdminData.name,
          email: companyAdminData.email || email,
          mobile: companyAdminData.mobile || '',
          designation: companyAdminData.designation || '',
          gender: 'Male',
          address: companyAdminData.address || '',
          role: 'employee',
          employeeId: resetCompanyAdminId,
          accessType: 'admin-light',
          companyName: companyAdminData.companyName || '',
        }, { merge: true });

        localStorage.setItem(`accessType_${auth.currentUser!.uid}`, 'admin-light');
        localStorage.setItem(`companyName_${auth.currentUser!.uid}`, companyAdminData.companyName || '');
        
        setShowFirstTimeResetModal(false);
        navigate('/');
    } catch (err) {
      console.error("Error resetting first-time password:", err);
      setError("Failed to update password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const [appTitle, setAppTitle] = useState(() => {
    return localStorage.getItem('appTitle') || "Active Engineers Railway";
  });

  const [fbLink, setFbLink] = useState("https://www.facebook.com/share/19u6U4CPNy/");
  const [igLink, setIgLink] = useState("https://www.instagram.com/imran_ansari000_?igsh=MTRqdGpuNDc2OHV1bA==");
  const [webLink, setWebLink] = useState("#");
  const [tgLink, setTgLink] = useState("https://t.me/+0LJ53SSjdXFmZDk1");

  useEffect(() => {
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.appTitle) {
          setAppTitle(data.appTitle);
          localStorage.setItem('appTitle', data.appTitle);
        }
        if (data.fbLink !== undefined) setFbLink(data.fbLink);
        if (data.igLink !== undefined) setIgLink(data.igLink);
        if (data.webLink !== undefined) setWebLink(data.webLink);
        if (data.tgLink !== undefined) setTgLink(data.tgLink);
      }
    }, (error) => {
      console.warn("Failed to listen to general settings:", error);
    });

    return () => unsubscribeSettings();
  }, []);

  const handleRefreshCaptcha = () => {
    setIsRefreshing(true);
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCaptchaCode(code);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleSetupAdmin = async () => {
    if (!loginId || !password) {
      setError('Please enter Login ID and Password to setup admin.');
      return;
    }
    setLoading(true);
    try {
      const email = loginId.includes('@') ? loginId : `${loginId}@billedapp.com`;
      await createUserWithEmailAndPassword(auth, email, password);
      navigate('/');
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('This admin account already exists. Please log in using your correct password.');
      } else {
        console.error('Setup error:', err);
        setError('Failed to setup admin: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleRefreshCaptcha();
    sessionStorage.clear();
    localStorage.removeItem('sessionExpiryTime');
    localStorage.removeItem('sessionLoggedOut');
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (captchaInput.toUpperCase() !== captchaCode) {
      setError('Invalid captcha code');
      handleRefreshCaptcha();
      setCaptchaInput('');
      return;
    }

    setLoading(true);
    try {
      if (loginMode === 'admin') {
        // Query Firestore employees collection to see if there is an admin-light company login matching this ID
        let matchingCompanyAdmin: any = null;
        let isLeftCompanyAdmin = false;
        let qSnap;
        try {
          qSnap = await getDocs(collection(db, 'employees'));
          qSnap.forEach((docSnap) => {
            const data = docSnap.data();
            if (
              data.loginId &&
              data.loginId.trim().toLowerCase() === loginId.trim().toLowerCase() &&
              data.accessType === 'admin-light'
            ) {
              if (data.status === 'left') {
                isLeftCompanyAdmin = true;
              } else if (data.status === 'active') {
                matchingCompanyAdmin = { id: docSnap.id, ...data };
              }
            }
          });
        } catch (error: any) {
          console.warn('Unable to retrieve employees for admin-light lookup, proceeding with standard admin login:', error?.message || error);
        }

        if (isLeftCompanyAdmin) {
          setError("This corporate admin account is marked as 'Left'. You cannot log in.");
          setLoading(false);
          return;
        }

        if (matchingCompanyAdmin) {
          // Check if there is at least one active employee or admin in the same company
          const companyName = matchingCompanyAdmin.companyName;
          if (companyName) {
            let hasActiveInCompany = false;
            if (qSnap) {
              qSnap.forEach((docSnap) => {
                const data = docSnap.data();
                if (data.companyName === companyName && data.status === 'active') {
                  hasActiveInCompany = true;
                }
              });
            }
            if (!hasActiveInCompany) {
              setError("No active employees found in your company. Access is restricted.");
              setLoading(false);
              return;
            }
          }

          // Verify password
          const { hashPassword, isHashedPassword } = await import('../utils/crypto');
          let isPasswordValid = false;
          let needsPasswordMigration = false;
          const saltSource = (matchingCompanyAdmin.loginId || matchingCompanyAdmin.id).trim().toLowerCase();
          if (isHashedPassword(matchingCompanyAdmin.password)) {
            const hashedInput = await hashPassword(password, saltSource);
            isPasswordValid = (matchingCompanyAdmin.password === hashedInput);
          } else {
            isPasswordValid = (matchingCompanyAdmin.password === password);
            if (isPasswordValid) {
              needsPasswordMigration = true;
            }
          }

          if (!isPasswordValid) {
            setError('Invalid login ID or password.');
            setLoading(false);
            return;
          }

          // Check if it is first-time login
          if (matchingCompanyAdmin.firstTimeLogin) {
            setResetCompanyAdminId(matchingCompanyAdmin.id);
            setShowFirstTimeResetModal(true);
            setLoading(false);
            return;
          }

          // Complete login for the company admin
          const sanitizedId = matchingCompanyAdmin.loginId.toLowerCase().replace(/[^a-z0-9]/g, '');
          const email = `${sanitizedId}@employee.billedapp.com`;
          const staticPassword = 'EmployeePass123!';

          try {
            sessionStorage.clear();
            await signInWithEmailAndPassword(auth, email, staticPassword);
          } catch (err: any) {
            if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
              await createUserWithEmailAndPassword(auth, email, staticPassword);
            } else {
              throw err;
            }
          }

          if (needsPasswordMigration) {
            // Auto-migrate to secure salted hash now that user is authenticated
            try {
              const hashedPass = await hashPassword(password, saltSource);
              await updateDoc(doc(db, 'employees', matchingCompanyAdmin.id), {
                password: hashedPass
              });
              matchingCompanyAdmin.password = hashedPass;
              console.log("Corporate password successfully migrated to salted hash.");
            } catch (migrateErr) {
              console.warn("Unable to migrate corporate password to salted hash:", migrateErr);
            }
          }

          await setDoc(doc(db, 'users', auth.currentUser!.uid), {
            uid: auth.currentUser!.uid,
            name: matchingCompanyAdmin.name,
            email: matchingCompanyAdmin.email || email,
            mobile: matchingCompanyAdmin.mobile || '',
            designation: matchingCompanyAdmin.designation || '',
            gender: 'Male',
            address: matchingCompanyAdmin.address || '',
            role: 'employee',
            employeeId: matchingCompanyAdmin.id,
            accessType: 'admin-light',
            companyName: matchingCompanyAdmin.companyName || '',
          }, { merge: true });

          localStorage.setItem(`accessType_${auth.currentUser!.uid}`, 'admin-light');
          localStorage.setItem(`companyName_${auth.currentUser!.uid}`, matchingCompanyAdmin.companyName || '');
          navigate('/');
          setLoading(false);
          return;
        }

        // Use loginId as email if it contains '@', otherwise append domain (Standard Master Admin)
        const email = loginId.includes('@') ? loginId : `${loginId}@billedapp.com`;
        await signInWithEmailAndPassword(auth, email, password);
        navigate('/');
      } else {
        // Employee Login using PF No and DOB
        if (!pfNo || !dob) {
          setError('Please enter both PF Number and Date of Birth (DOB).');
          setLoading(false);
          return;
        }

        // Query Firestore employees collection to find a match
        let matchingEmployee: any = null;
        let isLeftEmployee = false;
        let querySnapshot;
        try {
          querySnapshot = await getDocs(collection(db, 'employees'));
        } catch (error: any) {
          console.error("Employee list query failed during login:", error?.message || error);
          setError('Database connection error. Please try again later.');
          setLoading(false);
          return;
        }
        
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (
            data.pfNo?.trim().toLowerCase() === pfNo.trim().toLowerCase() &&
            data.dob === dob
          ) {
            if (data.status === 'left') {
              isLeftEmployee = true;
            } else if (data.status === 'active') {
              matchingEmployee = { id: doc.id, ...data };
            }
          }
        });

        if (isLeftEmployee) {
          setError("Your profile status is marked as 'Left'. You cannot log in.");
          setLoading(false);
          return;
        }

        if (!matchingEmployee) {
          setError('Invalid PF Number or Date of Birth. Please check your credentials or contact Admin.');
          setLoading(false);
          return;
        }

        // Check if there is at least one active employee or admin in the same company
        const companyName = matchingEmployee.companyName;
        if (companyName) {
          let hasActiveInCompany = false;
          querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.companyName === companyName && data.status === 'active') {
              hasActiveInCompany = true;
            }
          });
          if (!hasActiveInCompany) {
            setError("No active employees found in your company. Access is restricted.");
            setLoading(false);
            return;
          }
        }

        // Deterministic credentials for the employee session
        const sanitizedPf = matchingEmployee.pfNo.toLowerCase().replace(/[^a-z0-9]/g, '');
        const email = `${sanitizedPf}@employee.billedapp.com`;
        const staticPassword = 'EmployeePass123!';

        try {
          sessionStorage.clear();
          await signInWithEmailAndPassword(auth, email, staticPassword);
          if (auth.currentUser) {
            await setDoc(doc(db, 'users', auth.currentUser.uid), {
              uid: auth.currentUser.uid,
              name: matchingEmployee.name,
              email: matchingEmployee.email || email,
              mobile: matchingEmployee.mobile || '',
              designation: matchingEmployee.designation || '',
              gender: 'Male',
              address: matchingEmployee.address || '',
              role: 'employee',
              employeeId: matchingEmployee.id,
              accessType: matchingEmployee.accessType || 'limited',
            }, { merge: true });
            localStorage.setItem(`accessType_${auth.currentUser.uid}`, matchingEmployee.accessType || 'limited');
          }
          navigate('/');
        } catch (err: any) {
          if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
            // User does not exist in Firebase Auth yet, auto-create
            try {
              await createUserWithEmailAndPassword(auth, email, staticPassword);
            } catch (createErr: any) {
              if (createErr.code === 'auth/email-already-in-use') {
                throw new Error("This employee account is already registered but login failed. Please verify your credentials or contact Admin to reset.");
              } else {
                throw createErr;
              }
            }

            // Also create/merge user profile in users collection
            try {
              await setDoc(doc(db, 'users', auth.currentUser!.uid), {
                uid: auth.currentUser!.uid,
                name: matchingEmployee.name,
                email: matchingEmployee.email || email,
                mobile: matchingEmployee.mobile || '',
                designation: matchingEmployee.designation || '',
                gender: 'Male',
                address: matchingEmployee.address || '',
                role: 'employee',
                employeeId: matchingEmployee.id,
                accessType: matchingEmployee.accessType || 'limited',
              }, { merge: true });
              localStorage.setItem(`accessType_${auth.currentUser!.uid}`, matchingEmployee.accessType || 'limited');
            } catch (error) {
              handleFirestoreError(error, OperationType.WRITE, 'users');
            }

            navigate('/');
          } else {
            throw err;
          }
        }
      }
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        console.warn('Login attempt with invalid credentials:', err.message || err);
      } else {
        console.error('Login error:', err?.message || err?.code || String(err));
      }
      if (err.code === 'auth/operation-not-allowed') {
        setError('Email/Password login is not enabled in Firebase Console. Please go to Authentication > Sign-in method and enable Email/Password.');
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Invalid credentials. Please check your inputs.');
        if (loginMode === 'admin') {
          setShowSetup(true);
        }
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error: Unable to reach Firebase. Please check your internet connection or ensure your browser is not blocking the request.');
      } else {
        setError('An error occurred during login. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface font-body text-on-surface flex flex-col mesh-background overflow-hidden">
      <motion.header 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100 }}
        className="fixed top-0 w-full z-50 bg-slate-50 border-b border-slate-200/50 flex items-center justify-between px-6 h-16"
      >
        <div className="flex items-center gap-2">
          <Factory className="text-indigo-900" size={24} />
          <span className="text-xl font-bold tracking-tighter text-indigo-900">{appTitle}</span>
        </div>
        <div className="text-xs font-bold uppercase tracking-widest text-secondary">
          Secure Gateway
        </div>
      </motion.header>

      <main className="flex-grow flex items-center justify-center px-6 pt-20 pb-10">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="mb-10 text-center">
            <motion.div 
              initial={{ rotate: -10, scale: 0.8 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded bg-surface-container-highest mb-6 shadow-inner"
            >
              <LockOpen className="text-primary" size={32} />
            </motion.div>
            <motion.h1 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-3xl font-extrabold tracking-tight text-on-surface mb-2"
            >
              Industrial Portal
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-on-surface-variant text-sm"
            >
              Authorized personnel only. Please verify your credentials to access the billing infrastructure.
            </motion.p>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-surface-container-lowest p-8 rounded-2xl shadow-2xl border border-outline-variant/10"
          >
            {/* Login Mode Toggle */}
            <div className="flex bg-slate-100 p-1 rounded-xl mb-6">
              <button
                type="button"
                onClick={() => {
                  setLoginMode('admin');
                  setError('');
                }}
                className={cn(
                  "flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
                  loginMode === 'admin' 
                    ? "bg-white text-indigo-900 shadow-sm font-black" 
                    : "text-slate-500 hover:text-indigo-900"
                )}
              >
                Admin Gateway
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginMode('employee');
                  setError('');
                }}
                className={cn(
                  "flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
                  loginMode === 'employee' 
                    ? "bg-white text-indigo-900 shadow-sm font-black" 
                    : "text-slate-500 hover:text-indigo-900"
                )}
              >
                Employee Portal
              </button>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              <AnimatePresence mode="wait">
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-error-container text-on-error-container p-3 rounded-lg text-sm font-medium overflow-hidden"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
              
              {loginMode === 'admin' ? (
                <>
                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="login-id">
                      Login ID
                    </label>
                    <div className="relative group">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                        id="login-id"
                        placeholder="Login Id"
                        type="text"
                        value={loginId}
                        onChange={(e) => setLoginId(e.target.value)}
                        required
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                        <Badge size={20} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="password">
                      Password
                    </label>
                    <div className="relative group">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                        id="password"
                        placeholder="Enter Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                        <Key size={20} />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="pf-no">
                      PF Number
                    </label>
                    <div className="relative group">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                        id="pf-no"
                        placeholder="e.g. MH/BAN/12345/678"
                        type="text"
                        value={pfNo}
                        onChange={(e) => setPfNo(e.target.value)}
                        required
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                        <Badge size={20} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="dob">
                      Date of Birth (DOB)
                    </label>
                    <div className="relative group">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                        id="dob"
                        type="date"
                        value={dob}
                        onChange={(e) => setDob(e.target.value)}
                        required
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                        <Calendar size={20} />
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/10">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary mb-3 ml-1">
                  Verification Required
                </label>
                <div className="flex items-center gap-4 mb-3">
                  <div className="flex-grow h-12 bg-white flex items-center justify-center rounded-lg border border-outline-variant/20 relative overflow-hidden shadow-inner">
                    <motion.span 
                      key={captchaCode}
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="text-xl font-black tracking-[0.4em] italic text-primary select-none pointer-events-none"
                    >
                      {captchaCode}
                    </motion.span>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9, rotate: 180 }}
                    className="p-3 text-secondary hover:text-primary transition-all bg-white rounded-lg border border-outline-variant/20 shadow-sm"
                    type="button"
                    onClick={handleRefreshCaptcha}
                  >
                    <RefreshCw className={cn("transition-transform duration-500", isRefreshing && "rotate-180")} size={20} />
                  </motion.button>
                </div>
                <input
                  className="w-full bg-surface-container-lowest border border-outline/20 rounded-lg px-4 py-2 text-sm text-on-surface focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  placeholder="Enter the code above"
                  type="text"
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  required
                />
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "w-full bg-gradient-to-r from-indigo-900 to-blue-900 text-white font-bold py-4 rounded-xl shadow-xl flex items-center justify-center gap-2 transition-all",
                  loading && "opacity-70 cursor-not-allowed"
                )}
                type="submit"
                disabled={loading}
              >
                <span>{loading ? 'Logging in...' : 'Login'}</span>
                {loading ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
              </motion.button>

              <AnimatePresence>
                {showSetup && loginMode === 'admin' && (
                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    type="button"
                    onClick={handleSetupAdmin}
                    disabled={loading}
                    className="w-full bg-surface-container-high text-on-surface font-bold py-3 rounded-xl border border-outline/20 hover:bg-surface-container-highest transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus size={18} />
                    <span>Setup Admin Account</span>
                  </motion.button>
                )}
              </AnimatePresence>

              <div className="text-center space-y-2">
                <Link 
                  to="/forgot-password"
                  className="block text-[11px] font-bold uppercase tracking-widest text-secondary hover:text-primary transition-colors"
                >
                  Forgot your credentials?
                </Link>
              </div>
            </form>
          </motion.div>


        </motion.div>
      </main>

      <motion.footer 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="p-6 text-center space-y-4"
      >
        <div className="flex justify-center items-center gap-6 text-on-surface-variant">
          {fbLink && fbLink !== "#" && (
            <a 
              href={fbLink} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="hover:text-indigo-600 transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="Facebook"
            >
              <Facebook size={16} />
              <span className="hidden sm:inline">Facebook</span>
            </a>
          )}
          {igLink && igLink !== "#" && (
            <a 
              href={igLink} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="hover:text-pink-600 transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="Instagram"
            >
              <Instagram size={16} />
              <span className="hidden sm:inline">Instagram</span>
            </a>
          )}
          {webLink && (
            <a 
              href={webLink} 
              target={webLink === "#" ? undefined : "_blank"} 
              rel="noopener noreferrer" 
              className="hover:text-emerald-600 transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="Website"
            >
              <Globe size={16} />
              <span className="hidden sm:inline">Website</span>
            </a>
          )}
          {tgLink && tgLink !== "#" && (
            <a 
              href={tgLink} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="hover:text-blue-500 transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="Telegram"
            >
              <Send size={15} />
              <span className="hidden sm:inline">Telegram</span>
            </a>
          )}
        </div>
        <p className="text-xs text-on-surface-variant font-medium flex flex-col sm:flex-row items-center justify-center gap-2 mt-2">
          <span>System version 1.4.0 | © {new Date().getFullYear()} Industrial Systems Group</span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
            System Engineered:
            <span className="glitch-container">
              <span className="glitch-text text-indigo-600 font-black tracking-widest text-[11px]" data-text="Developed By IMRAN">
                Developed By IMRAN
              </span>
            </span>
          </span>
        </p>
      </motion.footer>

      {/* First-time Company Admin Password Reset Modal */}
      <AnimatePresence>
        {showFirstTimeResetModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-indigo-100"
            >
              <div className="p-6 border-b border-slate-100 bg-slate-50 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 mb-3">
                  <Key size={24} />
                </div>
                <h2 className="text-xl font-extrabold text-slate-800">Password Reset Required</h2>
                <p className="text-xs text-slate-500 font-semibold mt-1">This is your first-time login. For security reasons, you must set a new strong password before proceeding.</p>
              </div>

              <form onSubmit={handleFirstTimeResetSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">New Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full border border-slate-200 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm focus:outline-none bg-white font-mono"
                    value={newPasswordInput}
                    onChange={e => setNewPasswordInput(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full border border-slate-200 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm focus:outline-none bg-white font-mono"
                    value={confirmPasswordInput}
                    onChange={e => setConfirmPasswordInput(e.target.value)}
                    required
                  />
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-800 hover:from-indigo-700 hover:to-indigo-900 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/10 transition-all flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : null}
                    Update Password & Login
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFirstTimeResetModal(false)}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-all text-xs uppercase tracking-wider"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
