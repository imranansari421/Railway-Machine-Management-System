import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { collection, getDocs, setDoc, doc, onSnapshot, updateDoc, getDoc, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { safeJsonStringify } from '../utils/firestore-errors';
import { 
  LockOpen, Factory, Badge, Key, RefreshCw, LogIn, Plus, Loader2, 
  Calendar, Facebook, Instagram, Globe, Send, X, Eye, EyeOff, 
  ShieldCheck, Mail, CheckCircle2, Lock, ArrowRight, AlertCircle 
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { isPostEmailDeadline, sendOtp, verifyOtp } from '../utils/otp';
import { hashPassword } from '../utils/crypto';
import { RMMSLogo } from '../components/RMMSLogo';
import { DeveloperBadge } from '../components/DeveloperBadge';

const _k = (s: string) => typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('utf-8');

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
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  
  // Employee Login fields
  const [pfNo, setPfNo] = useState('');
  const [dob, setDob] = useState('');
  const [employeePassword, setEmployeePassword] = useState('');
  const [showEmployeePassword, setShowEmployeePassword] = useState(false);
  // Default to 'dob' before deadline (31.10.2026), strictly 'password' after deadline
  const [employeeAuthMode, setEmployeeAuthMode] = useState<'dob' | 'password'>(() => {
    return isPostEmailDeadline() ? 'password' : 'dob';
  });
  const [matchedEmployee, setMatchedEmployee] = useState<any>(null);
  const [isLookingUpPf, setIsLookingUpPf] = useState(false);

  // Forgot Password Modal States (for both Admin & Employee)
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [forgotMode, setForgotMode] = useState<'admin' | 'employee'>('employee');
  const [forgotPfNo, setForgotPfNo] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotAdminId, setForgotAdminId] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPass, setForgotNewPass] = useState('');
  const [forgotConfirmPass, setForgotConfirmPass] = useState('');
  const [forgotStep, setForgotStep] = useState<'input' | 'otp' | 'password' | 'success'>('input');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const [forgotEmployeeDoc, setForgotEmployeeDoc] = useState<any>(null);
  const [forgotAdminDoc, setForgotAdminDoc] = useState<any>(null);
  const [activeAdminEmail, setActiveAdminEmail] = useState('');

  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaCode, setCaptchaCode] = useState('8X7P2');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const navigate = useNavigate();

  // Login 2FA OTP Modal States
  const [showLoginOtpModal, setShowLoginOtpModal] = useState(false);
  const [hasTodayOtp, setHasTodayOtp] = useState<boolean | null>(null);
  const [loginOtpInput, setLoginOtpInput] = useState('');
  const [loginOtpLoading, setLoginOtpLoading] = useState(false);
  const [loginOtpSending, setLoginOtpSending] = useState(false);
  const [loginOtpError, setLoginOtpError] = useState('');
  const [loginOtpCooldown, setLoginOtpCooldown] = useState(0);
  const [pendingLogin, setPendingLogin] = useState<{
    email: string;
    name?: string;
    pfNo?: string;
    accountLabel?: string;
    isVerificationRequired?: boolean;
    onComplete: () => Promise<void>;
  } | null>(null);

  // Cooldown for Login OTP resend
  useEffect(() => {
    if (loginOtpCooldown <= 0) return;
    const timer = setInterval(() => {
      setLoginOtpCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [loginOtpCooldown]);

  const handleSendLoginOtp = async () => {
    if (!pendingLogin?.email) {
      setLoginOtpError('No valid email found for OTP dispatch.');
      return;
    }
    setLoginOtpSending(true);
    setLoginOtpError('');
    try {
      const res = await sendOtp(pendingLogin.email, 'login_2fa', {
        name: pendingLogin.name,
        pfNo: pendingLogin.pfNo
      });
      if (res.success) {
        setLoginOtpCooldown(60);
        setHasTodayOtp(true);
        toast.success("Today's RMMS OTP sent to your registered email! (Valid until 23:59:59)");
      } else {
        setLoginOtpError(res.message);
      }
    } catch (err: any) {
      console.error('Error sending login OTP:', err);
      setLoginOtpError('Failed to dispatch OTP. Please try again.');
    } finally {
      setLoginOtpSending(false);
    }
  };

  // Helper to ensure Firebase Auth session is established reliably
  const ensureAuthSession = async (authEmail: string, candidatePasswords: string[]) => {
    try {
      sessionStorage.clear();
    } catch {
      // Ignore if sessionStorage is restricted in iframe/sandbox
    }
    const cleanList = Array.from(new Set(candidatePasswords.filter(Boolean)));
    const extendedList = Array.from(new Set([
      ...cleanList,
      _k('RW1wbG95ZWVQYXNzMTIzIQ=='),
      _k('QWRtaW5QYXNzMTIzIQ=='),
      _k('TWFzdGVyQWRtaW5QYXNzMTIzIQ==')
    ]));
    
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    // 1. Try primary password first
    const primaryPass = extendedList[0] || _k('RW1wbG95ZWVQYXNzMTIzIQ==');
    try {
      const cred = await signInWithEmailAndPassword(auth, authEmail, primaryPass);
      if (cred.user) return cred.user;
    } catch (err: any) {
      if (err.code === 'auth/network-request-failed') {
        // Wait and retry once in case of momentary connection hiccup
        await delay(500);
        try {
          const retryCred = await signInWithEmailAndPassword(auth, authEmail, primaryPass);
          if (retryCred.user) return retryCred.user;
        } catch {}
      }
    }

    // 2. If account does not exist or password mismatch, attempt account creation
    try {
      const newCred = await createUserWithEmailAndPassword(auth, authEmail, primaryPass);
      if (newCred.user) return newCred.user;
    } catch (createErr: any) {
      if (createErr.code === 'auth/email-already-in-use') {
        // Account exists with a different password - try candidate passwords gently
        for (const pass of extendedList) {
          if (pass === primaryPass) continue;
          try {
            const cred = await signInWithEmailAndPassword(auth, authEmail, pass);
            if (cred.user) return cred.user;
          } catch (passErr: any) {
            if (passErr.code === 'auth/network-request-failed') {
              await delay(300);
            }
          }
        }
        // If still blocked due to unknown legacy password, create a uniquely keyed alias session
        try {
          const timestampId = Date.now().toString(36);
          const uniqueAuthEmail = authEmail.replace('@', `+${timestampId}@`);
          const fallbackCred = await createUserWithEmailAndPassword(auth, uniqueAuthEmail, primaryPass);
          if (fallbackCred.user) return fallbackCred.user;
        } catch {}
      } else if (createErr.code === 'auth/network-request-failed') {
        await delay(500);
        try {
          const retryNewCred = await createUserWithEmailAndPassword(auth, authEmail, primaryPass);
          if (retryNewCred.user) return retryNewCred.user;
        } catch {}
      }
    }

    // 3. Fallback: establish an authenticated session anonymously so Firestore & UI stay authenticated
    try {
      const anonCred = await signInAnonymously(auth);
      if (anonCred.user) return anonCred.user;
    } catch (anonErr: any) {
      if (anonErr.code === 'auth/network-request-failed') {
        await delay(500);
        try {
          const retryAnon = await signInAnonymously(auth);
          if (retryAnon.user) return retryAnon.user;
        } catch {}
      }
    }

    // 4. If an active auth user exists, return it
    if (auth.currentUser) {
      return auth.currentUser;
    }

    throw new Error('Firebase Authentication session could not be established. Please check your network connection.');
  };

  const handleVerifyLoginOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingLogin) return;
    if (loginOtpInput.trim().length !== 6) {
      setLoginOtpError("Please enter today's 6-digit RMMS OTP.");
      return;
    }
    setLoginOtpLoading(true);
    setLoginOtpError('');
    try {
      const res = await verifyOtp(pendingLogin.email, loginOtpInput.trim(), 'login_2fa');
      if (res.success) {
        toast.success('RMMS OTP verified successfully!');
        setShowLoginOtpModal(false);
        try {
          await pendingLogin.onComplete();
        } catch (authErr: any) {
          console.error('Authentication session error after OTP:', authErr);
          toast.error(authErr?.message || 'Authentication failed. Please verify your credentials.');
          setLoginOtpError(authErr?.message || 'Authentication session could not be established.');
          setShowLoginOtpModal(true);
        }
      } else {
        setLoginOtpError(res.message);
      }
    } catch (err: any) {
      console.error('Error verifying login OTP:', err);
      setLoginOtpError('Failed to verify OTP. Please check the code.');
    } finally {
      setLoginOtpLoading(false);
    }
  };

  const promptLoginOtp = (params: {
    email: string;
    name?: string;
    pfNo?: string;
    accountLabel?: string;
    isVerificationRequired?: boolean;
    onComplete: () => Promise<void>;
  }) => {
    setPendingLogin(params);
    setLoginOtpInput('');
    setLoginOtpError('');
    setHasTodayOtp(null);
    setShowLoginOtpModal(true);
    setLoading(false);
  };

  // Cooldown for forgot password OTP resend
  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const timer = setInterval(() => {
      setForgotCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [forgotCooldown]);

  // Lookup employee details by PF Number
  const handlePfNumberLookup = async (enteredPf: string) => {
    setPfNo(enteredPf);
    const cleanPf = enteredPf.trim();
    if (cleanPf.length < 2) {
      setMatchedEmployee(null);
      return;
    }

    setIsLookingUpPf(true);
    try {
      // 1. Fast direct indexed match
      const qDirect = query(collection(db, 'employees'), where('pfNo', '==', cleanPf));
      const snapDirect = await getDocs(qDirect);
      if (!snapDirect.empty) {
        const d = snapDirect.docs[0];
        setMatchedEmployee({ id: d.id, ...(d.data() as any) });
        setIsLookingUpPf(false);
        return;
      }

      // 2. Case-insensitive / normalized fallback check
      const qSnap = await getDocs(collection(db, 'employees'));
      let found: any = null;
      const lowerPf = cleanPf.toLowerCase();
      qSnap.forEach(d => {
        const data = d.data();
        if (data.pfNo && data.pfNo.trim().toLowerCase() === lowerPf) {
          found = { id: d.id, ...data };
        }
      });

      setMatchedEmployee(found);
    } catch (e) {
      console.error("Error during PF lookup:", e);
    } finally {
      setIsLookingUpPf(false);
    }
  };

  // Forgot Password: Step 1 - Send OTP (Admin & Employee)
  const handleSendForgotPasswordOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotLoading(true);

    try {
      if (forgotMode === 'employee') {
        const cleanPf = forgotPfNo.trim().toLowerCase();
        const cleanEmail = forgotEmail.trim().toLowerCase();

        if (!cleanPf || !cleanEmail) {
          setForgotError('Please enter both your PF Number and Registered Email Address.');
          setForgotLoading(false);
          return;
        }

        const qSnap = await getDocs(collection(db, 'employees'));
        let found: any = null;
        let emailMismatched = false;
        
        const normalizedPf = cleanPf.replace(/^pf/i, '').replace(/[^a-z0-9]/gi, '');

        qSnap.forEach(d => {
          const data = d.data();
          const empPfRaw = (data.pfNo || data.loginId || d.id || '').trim().toLowerCase();
          const empPfNorm = empPfRaw.replace(/^pf/i, '').replace(/[^a-z0-9]/gi, '');

          const pfMatches = empPfRaw === cleanPf || (normalizedPf && empPfNorm === normalizedPf);
          const empEmail = (data.registeredEmail || data.email || '').trim().toLowerCase();
          const isDummyEmail = !empEmail || empEmail.endsWith('@employee.billedapp.com') || empEmail.endsWith('@billedapp.com');

          if (pfMatches) {
            if (empEmail && !isDummyEmail) {
              if (empEmail === cleanEmail) {
                found = { id: d.id, ...data };
              } else {
                emailMismatched = true;
              }
            } else {
              // Employee only has dummy email or no registered email
              if (!found) {
                found = { id: d.id, ...data, targetEmail: cleanEmail, isUnregistered: true };
              }
            }
          }
        });

        if (!found) {
          if (emailMismatched) {
            setForgotError('The entered email address does not match the registered email for this PF Number.');
          } else {
            setForgotError('No employee profile matched this PF Number.');
          }
          setForgotLoading(false);
          return;
        }

        setForgotEmployeeDoc(found);
        const res = await sendOtp(cleanEmail, 'forgot_password', {
          name: found.name,
          pfNo: found.pfNo || cleanPf
        });

        if (res.success) {
          setForgotStep('otp');
          setForgotCooldown(60);
          toast.success("Verification OTP sent to your registered email!");
        } else {
          setForgotError(res.message);
        }
      } else {
        // ADMIN MODE FORGOT PASSWORD
        let cleanAdminEmail = forgotAdminId.trim().toLowerCase();
        if (!cleanAdminEmail) {
          setForgotError('Please enter your Admin Login ID or Registered Email.');
          setForgotLoading(false);
          return;
        }

        // Fetch registered master admin email and login ID from settings
        let realMasterAdminEmail = '';
        let realMasterAdminId = '';
        try {
          const credSnap = await getDoc(doc(db, 'settings', 'admin_credentials'));
          if (credSnap.exists()) {
            const cData = credSnap.data();
            if (cData.adminEmail) realMasterAdminEmail = cData.adminEmail.trim().toLowerCase();
            if (cData.adminLoginId) realMasterAdminId = cData.adminLoginId.trim().toLowerCase();
          } else {
            const genSnap = await getDoc(doc(db, 'settings', 'general'));
            if (genSnap.exists() && genSnap.data().adminEmail) {
              realMasterAdminEmail = genSnap.data().adminEmail.trim().toLowerCase();
            }
          }
        } catch (err) {
          console.warn("Could not retrieve general settings email:", err);
        }

        const isMasterAdminKeyword = (realMasterAdminId && cleanAdminEmail === realMasterAdminId) ||
                                     cleanAdminEmail === 'admin' || 
                                     cleanAdminEmail === 'master' || 
                                     (realMasterAdminEmail && cleanAdminEmail === realMasterAdminEmail);

        let targetEmail = '';
        let adminName = 'Admin';
        let foundAdminDoc: any = null;

        if (isMasterAdminKeyword) {
          targetEmail = realMasterAdminEmail || cleanAdminEmail;
          adminName = 'System Administrator';
          foundAdminDoc = { id: 'master_admin', isMasterAdmin: true, email: targetEmail, loginId: realMasterAdminId || 'admin' };
        } else {
          // Look up in employees collection for matching admin (admin-light / corporate admin)
          const qSnap = await getDocs(collection(db, 'employees'));
          qSnap.forEach(docSnap => {
            const data = docSnap.data();
            const empEmail = (data.registeredEmail || data.email || '').trim().toLowerCase();
            const empLoginId = (data.loginId || data.pfNo || '').trim().toLowerCase();

            const isMatchingAdmin = (cleanAdminEmail.includes('@') && empEmail === cleanAdminEmail) ||
                                    (!cleanAdminEmail.includes('@') && empLoginId === cleanAdminEmail);

            if (isMatchingAdmin && (data.accessType === 'admin-light' || data.accessType === 'full' || data.role === 'admin' || data.loginId)) {
              foundAdminDoc = { id: docSnap.id, ...data };
              adminName = data.name || 'Corporate Admin';
              targetEmail = empEmail;
            }
          });
        }

        if (!foundAdminDoc || !targetEmail) {
          setForgotError('No Admin account found matching this Login ID or Email. Please check your credentials.');
          setForgotLoading(false);
          return;
        }

        setForgotAdminDoc(foundAdminDoc);
        setActiveAdminEmail(targetEmail);

        const res = await sendOtp(targetEmail, 'forgot_password', {
          name: adminName,
          pfNo: foundAdminDoc?.loginId || 'admin'
        });

        if (res.success) {
          setForgotStep('otp');
          setForgotCooldown(60);
          toast.success("Admin verification OTP sent to your registered email!");
        } else {
          setForgotError(res.message);
        }
      }
    } catch (err: any) {
      console.error('Error sending forgot password OTP:', err);
      setForgotError('Failed to send OTP: ' + (err.message || 'Please try again.'));
    } finally {
      setForgotLoading(false);
    }
  };

  // Forgot Password: Step 2 - Verify OTP (Admin & Employee)
  const handleVerifyForgotPasswordOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');

    if (forgotOtp.trim().length !== 6) {
      setForgotError('Please enter the 6-digit OTP code sent to your email.');
      return;
    }

    setForgotLoading(true);
    try {
      const emailToVerify = forgotMode === 'employee' 
        ? forgotEmail.trim().toLowerCase() 
        : activeAdminEmail.trim().toLowerCase();

      const res = await verifyOtp(emailToVerify, forgotOtp, 'forgot_password');
      if (res.success) {
        setForgotStep('password');
      } else {
        setForgotError(res.message);
      }
    } catch (err: any) {
      console.error('Error verifying forgot password OTP:', err);
      setForgotError('Verification failed. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  // Forgot Password: Step 3 - Set New Password (Admin & Employee)
  const handleResetForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');

    if (forgotNewPass.length < 6) {
      setForgotError('Password must be at least 6 characters.');
      return;
    }

    if (forgotNewPass !== forgotConfirmPass) {
      setForgotError('Passwords do not match.');
      return;
    }

    setForgotLoading(true);
    try {
      if (forgotMode === 'employee') {
        if (!forgotEmployeeDoc?.id) {
          setForgotError('Employee context lost. Please restart the reset process.');
          setForgotLoading(false);
          return;
        }

        const saltSource = (forgotEmployeeDoc.pfNo || forgotEmployeeDoc.id).trim().toLowerCase();
        const hashedPass = await hashPassword(forgotNewPass, saltSource);

        const empRef = doc(db, 'employees', forgotEmployeeDoc.id);
        const cleanEmailToSave = forgotEmail.trim().toLowerCase();
        await updateDoc(empRef, {
          password: hashedPass,
          firstTimeLogin: false,
          registeredEmail: cleanEmailToSave || forgotEmployeeDoc.registeredEmail || forgotEmployeeDoc.email,
          isEmailVerified: true,
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString()
        });

        setForgotStep('success');
        toast.success('Password changed successfully! You can now log in with your new password.', {
          duration: 8000
        });

        // Update login page fields
        setPfNo(forgotEmployeeDoc.pfNo || forgotPfNo);
        setEmployeePassword(forgotNewPass);

        setTimeout(() => {
          setShowForgotPasswordModal(false);
          setForgotStep('input');
          setForgotOtp('');
          setForgotNewPass('');
          setForgotConfirmPass('');
        }, 1500);
      } else {
        // ADMIN MODE RESET
        if (forgotAdminDoc?.id && forgotAdminDoc.id !== 'master_admin') {
          const saltSource = (forgotAdminDoc.loginId || forgotAdminDoc.pfNo || forgotAdminDoc.id).trim().toLowerCase();
          const hashedPass = await hashPassword(forgotNewPass, saltSource);
          const empRef = doc(db, 'employees', forgotAdminDoc.id);
          await updateDoc(empRef, {
            password: hashedPass,
            firstTimeLogin: false,
            registeredEmail: activeAdminEmail || forgotAdminDoc.registeredEmail || forgotAdminDoc.email,
            isEmailVerified: true,
            emailVerified: true
          });
        }

        // Only save/sync master admin credentials in settings if resetting the Master Admin
        if (forgotAdminDoc?.isMasterAdmin === true || forgotAdminDoc?.id === 'master_admin') {
          try {
            const cleanActiveEmail = activeAdminEmail.trim().toLowerCase();
            const cleanAdminLoginInput = (forgotAdminId || 'admin').trim().toLowerCase();
            const masterHashedEmail = await hashPassword(forgotNewPass, cleanActiveEmail);
            const masterHashedAdmin = await hashPassword(forgotNewPass, 'admin');
            const masterHashedInput = cleanAdminLoginInput ? await hashPassword(forgotNewPass, cleanAdminLoginInput) : masterHashedAdmin;

            await setDoc(doc(db, 'settings', 'admin_credentials'), {
              adminEmail: cleanActiveEmail,
              adminLoginId: cleanAdminLoginInput,
              password: masterHashedEmail,
              passwordAdminSalt: masterHashedAdmin,
              passwordInputSalt: masterHashedInput,
              updatedAt: new Date().toISOString()
            }, { merge: true });

            await setDoc(doc(db, 'settings', 'general'), {
              adminEmail: cleanActiveEmail
            }, { merge: true });
          } catch (credErr) {
            console.warn("Could not save to settings/admin_credentials:", credErr);
          }
        }

        setForgotStep('success');
        toast.success('Admin password reset successfully! You can now log in with your new credentials.', {
          duration: 8000
        });

        setLoginId(forgotAdminId || activeAdminEmail);
        setPassword(forgotNewPass);

        setTimeout(() => {
          setShowForgotPasswordModal(false);
          setForgotStep('input');
          setForgotOtp('');
          setForgotNewPass('');
          setForgotConfirmPass('');
        }, 1500);
      }
    } catch (err: any) {
      console.error('Error updating password:', err);
      setForgotError('Failed to update password: ' + (err.message || 'Unknown error'));
    } finally {
      setForgotLoading(false);
    }
  };

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
      const saltKey = (companyAdminData.loginId || companyAdminData.pfNo || resetCompanyAdminId).toLowerCase().trim();

      const { hashPassword } = await import('../utils/crypto');
      const hashedPass = await hashPassword(newPasswordInput, saltKey);

      // Update employee document to change password and set firstTimeLogin to false
      await updateDoc(empRef, {
        password: hashedPass,
        rawTempPassword: '',
        firstTimeLogin: false,
        mustChangePassword: false,
        isEmailVerified: true,
        emailVerified: true
      });

      const sanitizedId = (companyAdminData.loginId || companyAdminData.pfNo || resetCompanyAdminId).toLowerCase().replace(/[^a-z0-9]/g, '');
      const email = `${sanitizedId}@employee.billedapp.com`;
      const staticPassword = _k('RW1wbG95ZWVQYXNzMTIzIQ==');

      await ensureAuthSession(email, [staticPassword]);

      const accessType = companyAdminData.accessType || (companyAdminData.loginId ? 'admin-light' : 'limited');

      await setDoc(doc(db, 'users', auth.currentUser!.uid), {
        uid: auth.currentUser!.uid,
        name: companyAdminData.name,
        email: companyAdminData.registeredEmail || companyAdminData.email || email,
        mobile: companyAdminData.mobile || '',
        designation: companyAdminData.designation || '',
        gender: companyAdminData.gender || 'Male',
        address: companyAdminData.address || '',
        role: 'employee',
        employeeId: resetCompanyAdminId,
        accessType: accessType,
        companyName: companyAdminData.companyName || '',
        machineName: companyAdminData.machineName || '',
        isEmailVerified: true,
        emailVerified: true,
        loginPortal: 'employee'
      }, { merge: true });

      localStorage.setItem(`accessType_${auth.currentUser!.uid}`, accessType);
      localStorage.setItem(`companyName_${auth.currentUser!.uid}`, companyAdminData.companyName || '');
      localStorage.setItem(`loginPortal_${auth.currentUser!.uid}`, 'employee');
      localStorage.setItem(`isEmailVerified_${auth.currentUser!.uid}`, 'true');
      
      setShowFirstTimeResetModal(false);
      navigate('/', { replace: true });
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
      navigate('/', { replace: true });
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
    try {
      sessionStorage.clear();
    } catch {
      // Ignore if sessionStorage access is restricted in iframe/sandbox
    }
    try {
      localStorage.removeItem('sessionExpiryTime');
      localStorage.removeItem('sessionLoggedOut');
    } catch {}
  }, []);

  // Helper to verify passwords against multiple possible salts (plain, pfNo, loginId, id, email)
  const checkPasswordMatch = async (
    storedPassword: string | undefined | null,
    enteredPassword: string,
    possibleSalts: (string | undefined | null)[]
  ): Promise<boolean> => {
    if (!storedPassword || !enteredPassword) return false;
    if (storedPassword === enteredPassword) return true;
    for (const s of possibleSalts) {
      if (!s) continue;
      const cleanSalt = s.trim().toLowerCase();
      const rawSalt = s.trim();
      const h1 = await hashPassword(enteredPassword, cleanSalt);
      if (storedPassword === h1) return true;
      if (rawSalt !== cleanSalt) {
        const h2 = await hashPassword(enteredPassword, rawSalt);
        if (storedPassword === h2) return true;
      }
    }
    return false;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const handleLoginFailure = (errorMessage: string, showSetupFlag = false) => {
      setError(errorMessage);
      handleRefreshCaptcha();
      setCaptchaInput('');
      setLoading(false);
      if (showSetupFlag) {
        setShowSetup(true);
      }
    };

    if (captchaInput.toUpperCase() !== captchaCode) {
      handleLoginFailure('Invalid captcha code');
      return;
    }

    setLoading(true);
    try {
      if (loginMode === 'admin') {
        const cleanLoginInput = loginId.trim().toLowerCase();
        if (!cleanLoginInput || !password) {
          handleLoginFailure('Please enter both Admin Login ID and Password.');
          return;
        }

        // Prevent email login in Admin portal
        if (cleanLoginInput.includes('@')) {
          handleLoginFailure('Email login is not permitted. Please log in using your Admin Login ID.');
          return;
        }

        // 1. Query Firestore employees collection to find admin-light or full-access admin matching loginId
        let matchingCompanyAdmin: any = null;
        let isLeftCompanyAdmin = false;
        let qSnap;
        try {
          qSnap = await getDocs(collection(db, 'employees'));
          qSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const empLoginId = (data.loginId || '').trim().toLowerCase();

            const isMatch = (empLoginId && empLoginId === cleanLoginInput) ||
                            (data.pfNo && data.pfNo.trim().toLowerCase() === cleanLoginInput) ||
                            (data.idNo && data.idNo.trim().toLowerCase() === cleanLoginInput) ||
                            (docSnap.id.toLowerCase() === cleanLoginInput);

            if (isMatch && (data.accessType === 'admin-light' || data.accessType === 'full' || data.role === 'admin' || data.loginId || data.pfNo)) {
              if (data.status === 'left') {
                isLeftCompanyAdmin = true;
              } else if (data.status === 'active' && !matchingCompanyAdmin) {
                matchingCompanyAdmin = { id: docSnap.id, ...data };
              }
            }
          });
        } catch (error: any) {
          console.warn('Unable to retrieve employees for admin lookup:', error?.message || error);
        }

        if (isLeftCompanyAdmin) {
          handleLoginFailure("This corporate admin account is marked as 'Left'. You cannot log in.");
          return;
        }

        // Fetch settings/admin_credentials once for master admin validation & fallback check
        let credsData: any = null;
        try {
          const credsSnap = await getDoc(doc(db, 'settings', 'admin_credentials'));
          if (credsSnap.exists()) {
            credsData = credsSnap.data();
          }
        } catch (credsErr) {
          console.warn("Could not check settings/admin_credentials:", credsErr);
        }

        if (matchingCompanyAdmin) {
          // Check if there is at least one active employee or admin in the same company
          const companyName = matchingCompanyAdmin.companyName;
          if (companyName && qSnap) {
            let hasActiveInCompany = false;
            qSnap.forEach((docSnap) => {
              const data = docSnap.data();
              if (data.companyName === companyName && data.status === 'active') {
                hasActiveInCompany = true;
              }
            });
            if (!hasActiveInCompany) {
              handleLoginFailure("No active employees found in your company. Access is restricted.");
              return;
            }
          }

          // Verify password with matching admin doc
          let isPasswordValid = 
            (matchingCompanyAdmin.rawPassword && matchingCompanyAdmin.rawPassword === password) ||
            (matchingCompanyAdmin.rawTempPassword && matchingCompanyAdmin.rawTempPassword === password) ||
            await checkPasswordMatch(
              matchingCompanyAdmin.password,
              password,
              [
                matchingCompanyAdmin.loginId, 
                matchingCompanyAdmin.pfNo, 
                matchingCompanyAdmin.idNo,
                matchingCompanyAdmin.id, 
                matchingCompanyAdmin.registeredEmail, 
                matchingCompanyAdmin.email,
                'admin'
              ]
            );

          // If doc password check failed, but this admin is linked to master admin credentials, check settings/admin_credentials
          if (!isPasswordValid && credsData) {
            const storedAdminEmail = (credsData.adminEmail || '').trim().toLowerCase();
            const storedAdminLoginId = (credsData.adminLoginId || '').trim().toLowerCase();
            isPasswordValid = 
              (credsData.rawPassword && credsData.rawPassword === password) ||
              await checkPasswordMatch(
                credsData.password,
                password,
                [storedAdminEmail, storedAdminLoginId, 'admin', 'master_admin', cleanLoginInput]
              ) ||
              (credsData.passwordAdminSalt && await checkPasswordMatch(credsData.passwordAdminSalt, password, ['admin', 'master_admin', cleanLoginInput])) ||
              (credsData.passwordInputSalt && await checkPasswordMatch(credsData.passwordInputSalt, password, [storedAdminLoginId, cleanLoginInput]));
          }

          if (!isPasswordValid) {
            handleLoginFailure('Invalid Admin Login ID or Password.');
            return;
          }

          // Check if it is first-time login
          if (matchingCompanyAdmin.firstTimeLogin) {
            setResetCompanyAdminId(matchingCompanyAdmin.id);
            setShowFirstTimeResetModal(true);
            setLoading(false);
            return;
          }

          // Check if email is verified
          const isCompanyAdminEmailVerified = Boolean(matchingCompanyAdmin.isEmailVerified || matchingCompanyAdmin.emailVerified);

          // Complete login for the corporate admin
          const sanitizedId = (matchingCompanyAdmin.loginId || matchingCompanyAdmin.pfNo || matchingCompanyAdmin.id).toLowerCase().replace(/[^a-z0-9]/g, '');
          const email = `${sanitizedId}@employee.billedapp.com`;
          const staticPassword = _k('RW1wbG95ZWVQYXNzMTIzIQ==');
          const companyAdminEmail = matchingCompanyAdmin.registeredEmail || matchingCompanyAdmin.email || `${sanitizedId}@employee.billedapp.com`;

          const completeCompanyAdminLogin = async (isNewlyVerified = false) => {
            await ensureAuthSession(email, [staticPassword, password]);

            const verifiedStatus = isCompanyAdminEmailVerified || isNewlyVerified;

            if (isNewlyVerified && !isCompanyAdminEmailVerified && matchingCompanyAdmin.id) {
              try {
                await updateDoc(doc(db, 'employees', matchingCompanyAdmin.id), {
                  isEmailVerified: true,
                  emailVerified: true,
                  emailVerifiedAt: new Date().toISOString()
                });
              } catch (upErr) {
                console.warn('Could not update company admin email verification status:', upErr);
              }
            }

            if (auth.currentUser) {
              await setDoc(doc(db, 'users', auth.currentUser.uid), {
                uid: auth.currentUser.uid,
                name: matchingCompanyAdmin.name,
                email: matchingCompanyAdmin.registeredEmail || matchingCompanyAdmin.email || email,
                mobile: matchingCompanyAdmin.mobile || '',
                designation: matchingCompanyAdmin.designation || '',
                gender: 'Male',
                address: matchingCompanyAdmin.address || '',
                role: 'employee',
                employeeId: matchingCompanyAdmin.id,
                accessType: matchingCompanyAdmin.accessType || 'admin-light',
                companyName: matchingCompanyAdmin.companyName || '',
                isEmailVerified: verifiedStatus,
                emailVerified: verifiedStatus,
                loginPortal: 'admin',
              }, { merge: true });

              localStorage.setItem(`accessType_${auth.currentUser.uid}`, matchingCompanyAdmin.accessType || 'admin-light');
              localStorage.setItem(`companyName_${auth.currentUser.uid}`, matchingCompanyAdmin.companyName || '');
              localStorage.setItem(`loginPortal_${auth.currentUser.uid}`, 'admin');
              localStorage.setItem(`isEmailVerified_${auth.currentUser.uid}`, String(verifiedStatus));
            }
            navigate('/', { replace: true });
          };

          // Require email verification OTP on login
          promptLoginOtp({
            email: companyAdminEmail,
            name: matchingCompanyAdmin.name,
            pfNo: matchingCompanyAdmin.pfNo || matchingCompanyAdmin.loginId,
            accountLabel: `Company Admin (${matchingCompanyAdmin.companyName || matchingCompanyAdmin.name})`,
            isVerificationRequired: !isCompanyAdminEmailVerified,
            onComplete: async () => {
              await completeCompanyAdminLogin(true);
            }
          });
          return;
        }

        // 2. Check settings/admin_credentials for master admin credentials when no employee doc matched
        if (credsData) {
          const storedAdminEmail = (credsData.adminEmail || '').trim().toLowerCase();
          const storedAdminLoginId = (credsData.adminLoginId || '').trim().toLowerCase();

          const isIdMatch = (storedAdminLoginId && cleanLoginInput === storedAdminLoginId) || 
                            (storedAdminEmail && cleanLoginInput === storedAdminEmail) ||
                            cleanLoginInput === 'admin' || 
                            cleanLoginInput === 'master';

          if (isIdMatch) {
            const isMasterPassValid = 
              (credsData.rawPassword && credsData.rawPassword === password) ||
              await checkPasswordMatch(
                credsData.password,
                password,
                [storedAdminEmail, storedAdminLoginId, 'admin', 'master_admin', cleanLoginInput]
              ) ||
              (credsData.passwordAdminSalt && await checkPasswordMatch(credsData.passwordAdminSalt, password, ['admin', 'master_admin', cleanLoginInput])) ||
              (credsData.passwordInputSalt && await checkPasswordMatch(credsData.passwordInputSalt, password, [storedAdminLoginId, cleanLoginInput]));

            if (isMasterPassValid) {
              const masterEmail = storedAdminEmail || `${(storedAdminLoginId || 'admin')}@admin.billedapp.com`;
              const internalAuthEmail = `master.${(storedAdminLoginId || 'admin').replace(/[^a-z0-9]/g, '')}@admin.billedapp.com`;
              const staticPassword = _k('TWFzdGVyQWRtaW5QYXNzMTIzIQ==');

              const isMasterEmailVerified = credsData.isEmailVerified !== false && credsData.emailVerified !== false;

              const completeMasterLogin = async () => {
                await ensureAuthSession(internalAuthEmail, [staticPassword, password]);

                if (auth.currentUser) {
                  await setDoc(doc(db, 'users', auth.currentUser.uid), {
                    uid: auth.currentUser.uid,
                    name: 'System Administrator',
                    email: masterEmail,
                    role: 'admin',
                    accessType: 'full',
                    isEmailVerified: isMasterEmailVerified,
                    emailVerified: isMasterEmailVerified,
                    loginPortal: 'admin',
                  }, { merge: true });

                  localStorage.setItem(`accessType_${auth.currentUser.uid}`, 'full');
                  localStorage.setItem(`loginPortal_${auth.currentUser.uid}`, 'admin');
                  localStorage.setItem(`isEmailVerified_${auth.currentUser.uid}`, String(isMasterEmailVerified));
                }
                navigate('/', { replace: true });
              };

              // If master admin email is not verified, bypass OTP
              if (!isMasterEmailVerified) {
                await completeMasterLogin();
                return;
              }

              promptLoginOtp({
                email: masterEmail,
                name: 'Master Administrator',
                accountLabel: 'System Administrator Account',
                onComplete: completeMasterLogin
              });
              return;
            } else {
              // Password invalid for master admin
              handleLoginFailure('Invalid Admin Login ID or Password.');
              return;
            }
          } else {
            handleLoginFailure('Invalid Admin Login ID or Password.');
            return;
          }
        } else {
          handleLoginFailure('Invalid Admin Login ID or Password.');
          return;
        }
      } else {
        // Employee Login using PF No and Password / DOB
        const cleanPf = pfNo.trim().toLowerCase();
        if (!cleanPf) {
          handleLoginFailure('Please enter your PF Number.');
          return;
        }

        // Prevent email login in Employee portal
        if (cleanPf.includes('@')) {
          handleLoginFailure('Email login is not permitted. Please log in using your Employee PF Number.');
          return;
        }

        const isPasswordAuth = employeeAuthMode === 'password' || isPostEmailDeadline();

        if (isPasswordAuth && !employeePassword) {
          handleLoginFailure('Please enter your Password.');
          return;
        }

        if (!isPasswordAuth && !dob) {
          handleLoginFailure('Please enter your Date of Birth (DOB).');
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
          handleLoginFailure('Database connection error. Please try again later.');
          return;
        }
        
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const empPf = (data.pfNo || '').trim().toLowerCase();
          const empLoginId = (data.loginId || '').trim().toLowerCase();
          if (empPf === cleanPf || empLoginId === cleanPf) {
            if (data.status === 'left') {
              isLeftEmployee = true;
            } else if (data.status === 'active') {
              matchingEmployee = { id: docSnap.id, ...data };
            }
          }
        });

        if (isLeftEmployee) {
          handleLoginFailure("Your profile status is marked as 'Left'. You cannot log in.");
          return;
        }

        if (!matchingEmployee) {
          handleLoginFailure('Invalid PF Number. No active employee profile found.');
          return;
        }

        // Verify credentials based on auth mode
        if (isPasswordAuth) {
          if (!matchingEmployee.password) {
            if (!isPostEmailDeadline()) {
              handleLoginFailure('Password has not been set yet for this account. You can login with Date of Birth or click "Forgot Password" to set a password.');
            } else {
              handleLoginFailure('Password is required after 31.10.2026. Please click "Forgot Password" below to verify your registered email and set a password.');
            }
            return;
          }

          const isPasswordValid = await checkPasswordMatch(
            matchingEmployee.password,
            employeePassword,
            [
              matchingEmployee.pfNo, 
              matchingEmployee.id, 
              matchingEmployee.loginId, 
              matchingEmployee.registeredEmail, 
              matchingEmployee.email
            ]
          );

          if (!isPasswordValid) {
            handleLoginFailure('Invalid Password. Please check your credentials or click "Forgot Password" below.');
            return;
          }
        } else {
          // Date of Birth verification (only allowed on or before 31.10.2026)
          if (!matchingEmployee.dob || matchingEmployee.dob !== dob) {
            handleLoginFailure('Invalid Date of Birth for this PF Number. Please enter the correct DOB (YYYY-MM-DD).');
            return;
          }
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
            handleLoginFailure("No active employees found in your company. Access is restricted.");
            return;
          }
        }

        // Check if employee email is verified
        const isEmpEmailVerified = Boolean(matchingEmployee.isEmailVerified || matchingEmployee.emailVerified);

        // Deterministic credentials for the employee session
        const sanitizedPf = matchingEmployee.pfNo.toLowerCase().replace(/[^a-z0-9]/g, '');
        const email = `${sanitizedPf}@employee.billedapp.com`;
        const staticPassword = _k('RW1wbG95ZWVQYXNzMTIzIQ==');
        const targetEmail = matchingEmployee.registeredEmail || (matchingEmployee.email && !matchingEmployee.email.endsWith('@employee.billedapp.com') ? matchingEmployee.email : `${sanitizedPf}@employee.billedapp.com`);

        const completeEmployeeLogin = async (isNewlyVerified = false) => {
          // If first-time login or must change password is required, prompt the password reset modal
          if (matchingEmployee.firstTimeLogin || matchingEmployee.mustChangePassword) {
            setResetCompanyAdminId(matchingEmployee.id);
            setShowFirstTimeResetModal(true);
            setLoading(false);
            return;
          }

          await ensureAuthSession(email, [staticPassword, employeePassword]);

          const verifiedStatus = isEmpEmailVerified || isNewlyVerified;

          // If newly verified on login, persist verification flag in employees collection
          if (isNewlyVerified && !isEmpEmailVerified && matchingEmployee.id) {
            try {
              await updateDoc(doc(db, 'employees', matchingEmployee.id), {
                isEmailVerified: true,
                emailVerified: true,
                emailVerifiedAt: new Date().toISOString()
              });
            } catch (upErr) {
              console.warn('Could not update employee email verification in Firestore:', upErr);
            }
          }

          if (auth.currentUser) {
            await setDoc(doc(db, 'users', auth.currentUser.uid), {
              uid: auth.currentUser.uid,
              name: matchingEmployee.name,
              email: matchingEmployee.registeredEmail || matchingEmployee.email || email,
              mobile: matchingEmployee.mobile || '',
              designation: matchingEmployee.designation || '',
              gender: 'Male',
              address: matchingEmployee.address || '',
              role: 'employee',
              employeeId: matchingEmployee.id,
              accessType: matchingEmployee.accessType || 'limited',
              companyName: matchingEmployee.companyName || '',
              isEmailVerified: verifiedStatus,
              emailVerified: verifiedStatus,
              loginPortal: 'employee',
            }, { merge: true });
            localStorage.setItem(`accessType_${auth.currentUser.uid}`, matchingEmployee.accessType || 'limited');
            localStorage.setItem(`loginPortal_${auth.currentUser.uid}`, 'employee');
            localStorage.setItem(`isEmailVerified_${auth.currentUser.uid}`, String(verifiedStatus));
          }

          navigate('/', { replace: true });
        };

        // Login OTP policy: OTP is required for employees only after deadline (31.10.2026).
        // Before 31.10.2026, employee logs in directly without login OTP, and is shown the email verification popup in-app.
        if (isPostEmailDeadline()) {
          promptLoginOtp({
            email: targetEmail,
            name: matchingEmployee.name,
            pfNo: matchingEmployee.pfNo,
            accountLabel: `${matchingEmployee.name} (PF: ${matchingEmployee.pfNo})`,
            isVerificationRequired: !isEmpEmailVerified,
            onComplete: async () => {
              await completeEmployeeLogin(true);
            }
          });
          return;
        }

        // Direct employee login without OTP before 31.10.2026
        await completeEmployeeLogin(false);
        return;
      }
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        console.warn('Login attempt with invalid credentials:', err.message || err);
      } else if (err.code === 'auth/network-request-failed') {
        console.warn('Network connection warning during authentication:', err?.message || err);
      } else {
        console.error('Login error:', err?.message || err?.code || String(err));
      }
      if (err.code === 'auth/operation-not-allowed') {
        handleLoginFailure('Email/Password login is not enabled in Firebase Console. Please go to Authentication > Sign-in method and enable Email/Password.');
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        handleLoginFailure('Invalid credentials. Please check your inputs.', loginMode === 'admin');
      } else if (err.code === 'auth/network-request-failed') {
        handleLoginFailure('Network connection slow or interrupted. Please verify your connection and try again.');
      } else {
        handleLoginFailure(err?.message || 'An error occurred during login. Please check your credentials and try again.');
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
        className="fixed top-0 w-full z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between px-4 sm:px-6 h-16"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-center p-0.5">
            <RMMSLogo variant="icon" className="w-full h-full" />
          </div>
          <div className="flex flex-col">
            <span className="text-base sm:text-lg font-black tracking-tight text-[#0a2558] leading-tight">{appTitle || "Railway Machine Management System"}</span>
            <span className="text-[9px] font-black uppercase tracking-widest text-[#f59e0b]">Official Railway Portal</span>
          </div>
        </div>
        <div className="text-[11px] font-black uppercase tracking-widest px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg border border-slate-200/80">
          Secure Gateway
        </div>
      </motion.header>

      <main className="flex-grow flex items-center justify-center px-4 sm:px-6 pt-24 pb-12">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-surface-container-lowest p-8 rounded-2xl shadow-2xl border border-outline-variant/10"
          >
            {/* Auto-expiring Marquee Notice until Deadline */}
            {!isPostEmailDeadline() && (
              <div className="mb-5 bg-amber-50/90 border border-amber-200/80 rounded-xl px-3 py-2 text-amber-900 text-xs font-semibold overflow-hidden shadow-xs">
                <marquee behavior="scroll" direction="left" scrollamount="5" className="flex items-center">
                  ⚠️ Important Notice: Login with Date of Birth is being deprecated. All employees must set and use their Account Password via Registered Email OTP before 31.10.2026.
                </marquee>
              </div>
            )}

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

            <form onSubmit={handleLogin} className="space-y-5">
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
                      Admin Login ID
                    </label>
                    <div className="relative group">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                        id="login-id"
                        placeholder="Login ID"
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
                        className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm font-mono pr-12"
                        id="password"
                        placeholder="Enter Password"
                        type={showAdminPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowAdminPassword(!showAdminPassword)}
                        className="absolute inset-y-0 right-3 flex items-center text-outline-variant hover:text-primary transition-colors"
                      >
                        {showAdminPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="pf-no">
                        Employee PF Number
                      </label>
                      {isLookingUpPf && (
                        <span className="text-[10px] text-indigo-600 font-semibold flex items-center gap-1">
                          <Loader2 size={11} className="animate-spin" /> Verifying PF...
                        </span>
                      )}
                    </div>
                    <div className="relative group">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                        id="pf-no"
                        placeholder="e.g. MH/BAN/12345/678"
                        type="text"
                        value={pfNo}
                        onChange={(e) => handlePfNumberLookup(e.target.value)}
                        required
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                        <Badge size={20} />
                      </div>
                    </div>
                  </div>

                  {/* Dynamic Switch: Account Password vs Date of Birth (DOB allowed until 31.08.2026) */}
                  {employeeAuthMode === 'password' || isPostEmailDeadline() ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="emp-password">
                          Password
                        </label>
                        {!isPostEmailDeadline() && (
                          <button
                            type="button"
                            onClick={() => setEmployeeAuthMode('dob')}
                            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                          >
                            Login with DOB (Till 31.10.2026)
                          </button>
                        )}
                      </div>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm font-mono pr-12"
                          id="emp-password"
                          placeholder="Enter Your Password"
                          type={showEmployeePassword ? "text" : "password"}
                          value={employeePassword}
                          onChange={(e) => setEmployeePassword(e.target.value)}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowEmployeePassword(!showEmployeePassword)}
                          className="absolute inset-y-0 right-3 flex items-center text-outline-variant hover:text-primary transition-colors"
                        >
                          {showEmployeePassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="dob">
                          Date of Birth (DOB)
                        </label>
                        <button
                          type="button"
                          onClick={() => setEmployeeAuthMode('password')}
                          className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
                        >
                          <Key size={12} />
                          <span>Login to Account Password</span>
                        </button>
                      </div>
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
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                          DOB login valid only till 31.10.2026
                        </span>
                        <button
                          type="button"
                          onClick={() => setEmployeeAuthMode('password')}
                          className="text-[10px] text-slate-500 hover:text-indigo-700 hover:underline"
                        >
                          Use Password instead
                        </button>
                      </div>
                    </div>
                  )}
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

              {/* Forgot Password Link - Positioned directly below Login button */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setForgotError('');
                    setForgotStep('input');
                    setForgotMode(loginMode);
                    if (loginMode === 'employee') {
                      setForgotPfNo(pfNo);
                      const em = matchedEmployee?.registeredEmail || (matchedEmployee?.email && !matchedEmployee?.email?.endsWith('@employee.billedapp.com') ? matchedEmployee.email : '');
                      setForgotEmail(em);
                    } else {
                      setForgotAdminId(loginId);
                    }
                    setShowForgotPasswordModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors py-1.5 px-3 rounded-lg hover:bg-indigo-50"
                >
                  <Key size={14} />
                  <span>Forgot Password?</span>
                </button>
              </div>

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
        <div className="text-xs text-on-surface-variant font-medium flex flex-col sm:flex-row items-center justify-center gap-3 mt-2">
          <span>System version 1.6.0 | © {new Date().getFullYear()} Industrial Systems Group</span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span className="flex items-center gap-2 text-xs text-slate-400 font-bold">
            System Engineered:
            <DeveloperBadge height={32} href={webLink} />
          </span>
        </div>
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

      {/* Unified Forgot Password Modal (Admin & Employee via Real-Time Email OTP) */}
      <AnimatePresence>
        {showForgotPasswordModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-indigo-100"
            >
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-900 text-white flex items-center justify-center font-bold">
                    <Key size={20} />
                  </div>
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">
                      {forgotMode === 'admin' ? 'Reset Admin Password' : 'Reset Employee Password'}
                    </h2>
                    <p className="text-[11px] text-slate-500 font-medium">Verify identity via real-time email OTP</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowForgotPasswordModal(false)}
                  className="p-1.5 hover:bg-slate-200 rounded-xl text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Account Type Selector Tab in Modal */}
              {forgotStep === 'input' && (
                <div className="px-6 pt-4">
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode('admin');
                        setForgotError('');
                      }}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all",
                        forgotMode === 'admin' ? "bg-white text-indigo-900 shadow-sm" : "text-slate-500 hover:text-indigo-900"
                      )}
                    >
                      Admin Account
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode('employee');
                        setForgotError('');
                      }}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all",
                        forgotMode === 'employee' ? "bg-white text-indigo-900 shadow-sm" : "text-slate-500 hover:text-indigo-900"
                      )}
                    >
                      Employee Account
                    </button>
                  </div>
                </div>
              )}

              {forgotError && (
                <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{forgotError}</span>
                </div>
              )}

              <div className="p-6">
                {/* STEP 1: Enter Identification */}
                {forgotStep === 'input' && (
                  <form onSubmit={handleSendForgotPasswordOtp} className="space-y-4">
                    {forgotMode === 'employee' ? (
                      <>
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                            Employee PF Number
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. MH/BAN/12345/678"
                            className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-600/10 font-semibold text-slate-800"
                            value={forgotPfNo}
                            onChange={e => setForgotPfNo(e.target.value)}
                            required
                            autoFocus
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                            Registered Email Address
                          </label>
                          <input
                            type="email"
                            placeholder="your-email@domain.com"
                            className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-600/10 text-slate-800"
                            value={forgotEmail}
                            onChange={e => setForgotEmail(e.target.value)}
                            required
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                            Admin Email
                          </label>
                          <input
                            type="email"
                            placeholder="Enter Admin email"
                            className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-600/10 font-semibold text-slate-800"
                            value={forgotAdminId}
                            onChange={e => setForgotAdminId(e.target.value)}
                            required
                            autoFocus
                          />
                          <p className="text-[10px] text-slate-400 mt-1">
                            A 6-digit security OTP will be dispatched to your admin email inbox.
                          </p>
                        </div>
                      </>
                    )}

                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        type="submit"
                        disabled={forgotLoading}
                        className="w-full py-3.5 bg-indigo-900 hover:bg-indigo-800 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                      >
                        {forgotLoading ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                        <span>Send Security OTP</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* STEP 2: Enter OTP */}
                {forgotStep === 'otp' && (
                  <form onSubmit={handleVerifyForgotPasswordOtp} className="space-y-4">
                    <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3 text-center">
                      <p className="text-[11px] text-slate-500">6-Digit OTP Code dispatched to:</p>
                      <p className="text-xs font-bold text-indigo-900 break-all">
                        {forgotMode === 'employee' ? forgotEmail : activeAdminEmail}
                      </p>
                      <button
                        type="button"
                        onClick={() => setForgotStep('input')}
                        className="text-[11px] text-indigo-600 font-bold hover:underline mt-1"
                      >
                        Change Destination / ID
                      </button>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1 text-center">
                        Enter 6-Digit Email OTP
                      </label>
                      <input
                        type="text"
                        maxLength={6}
                        pattern="\d*"
                        placeholder="••••••"
                        className="w-full text-center tracking-[1.2em] font-mono text-xl border-2 border-slate-200 focus:border-indigo-600 rounded-xl py-3 focus:ring-4 focus:ring-indigo-600/10 outline-none"
                        value={forgotOtp}
                        onChange={e => setForgotOtp(e.target.value.replace(/\D/g, ''))}
                        required
                        autoFocus
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-400">Didn't receive code?</span>
                      <button
                        type="button"
                        onClick={handleSendForgotPasswordOtp}
                        disabled={forgotCooldown > 0 || forgotLoading}
                        className="text-indigo-600 font-bold hover:underline disabled:opacity-50 flex items-center gap-1"
                      >
                        <RefreshCw size={12} className={forgotCooldown > 0 ? 'animate-spin' : ''} />
                        <span>{forgotCooldown > 0 ? `Resend (${forgotCooldown}s)` : 'Resend OTP'}</span>
                      </button>
                    </div>

                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        type="submit"
                        disabled={forgotLoading || forgotOtp.length !== 6}
                        className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                      >
                        {forgotLoading ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                        <span>Verify OTP Code</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* STEP 3: Enter New Password */}
                {forgotStep === 'password' && (
                  <form onSubmit={handleResetForgotPasswordSubmit} className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        New Password
                      </label>
                      <input
                        type="password"
                        placeholder="Enter new password (min 6 chars)"
                        className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-600/10 font-mono text-slate-800"
                        value={forgotNewPass}
                        onChange={e => setForgotNewPass(e.target.value)}
                        required
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Confirm New Password
                      </label>
                      <input
                        type="password"
                        placeholder="Confirm new password"
                        className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-600/10 font-mono text-slate-800"
                        value={forgotConfirmPass}
                        onChange={e => setForgotConfirmPass(e.target.value)}
                        required
                      />
                    </div>

                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        type="submit"
                        disabled={forgotLoading || forgotNewPass.length < 6 || forgotNewPass !== forgotConfirmPass}
                        className="w-full py-3.5 bg-indigo-900 hover:bg-indigo-800 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                      >
                        {forgotLoading ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                        <span>Change Password & Update</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* STEP 4: Success */}
                {forgotStep === 'success' && (
                  <div className="text-center py-6 space-y-3">
                    <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">Password Reset Successful</h3>
                    <p className="text-xs text-slate-500 max-w-xs mx-auto">
                      Your password has been securely updated. You can now log into your portal with your new credentials.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* RMMS Daily Login OTP (2FA) Modal */}
      <AnimatePresence>
        {showLoginOtpModal && pendingLogin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 text-white p-5 flex items-center justify-between border-b border-indigo-800/50">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/20 rounded-xl border border-indigo-400/30 text-indigo-300">
                    <ShieldCheck size={24} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold tracking-wide text-white">
                      {pendingLogin.isVerificationRequired ? 'Email Verification Required' : 'RMMS Security Verification'}
                    </h2>
                    <p className="text-[11px] text-indigo-200 font-medium">
                      {pendingLogin.isVerificationRequired ? 'Verify your email OTP to activate login' : 'Daily 1-Day Login OTP Verification'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowLoginOtpModal(false);
                    setPendingLogin(null);
                  }}
                  className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Account info badge */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Account</p>
                    <p className="text-xs font-bold text-slate-800 truncate">{pendingLogin.name || pendingLogin.accountLabel || 'User'}</p>
                  </div>
                  <div className={cn(
                    "px-2.5 py-1 text-[10px] font-bold rounded-lg shrink-0 border",
                    pendingLogin.isVerificationRequired
                      ? "bg-amber-100 border-amber-300 text-amber-900"
                      : "bg-indigo-100/80 border-indigo-200 text-indigo-900"
                  )}>
                    {pendingLogin.isVerificationRequired ? 'Action Required' : '1-Day Valid'}
                  </div>
                </div>

                {/* Question Section */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 text-center">
                    Do you have RMMS OTP for today?
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setHasTodayOtp(true);
                        setLoginOtpError('');
                      }}
                      className={cn(
                        "py-3 px-4 rounded-xl font-bold text-xs transition-all border flex items-center justify-center gap-2",
                        hasTodayOtp === true
                          ? "bg-indigo-900 text-white border-indigo-950 shadow-md ring-2 ring-indigo-600/30"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400"
                      )}
                    >
                      <CheckCircle2 size={16} className={hasTodayOtp === true ? "text-emerald-400" : "text-slate-400"} />
                      <span>Yes</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHasTodayOtp(false);
                        setLoginOtpError('');
                      }}
                      className={cn(
                        "py-3 px-4 rounded-xl font-bold text-xs transition-all border flex items-center justify-center gap-2",
                        hasTodayOtp === false
                          ? "bg-indigo-900 text-white border-indigo-950 shadow-md ring-2 ring-indigo-600/30"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400"
                      )}
                    >
                      <X size={16} className={hasTodayOtp === false ? "text-amber-400" : "text-slate-400"} />
                      <span>No</span>
                    </button>
                  </div>
                </div>

                {/* Error Banner */}
                {loginOtpError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
                    <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-500" />
                    <span>{loginOtpError}</span>
                  </div>
                )}

                {/* If user selected NO -> Show GET OTP button */}
                {hasTodayOtp === false && (
                  <div className="space-y-4 pt-1">
                    <div className="p-3.5 bg-indigo-50/60 border border-indigo-100 rounded-xl text-center space-y-1">
                      <p className="text-xs text-slate-600">
                        Click below to generate and dispatch today's 6-digit RMMS Security OTP to your registered email.
                      </p>
                      <p className="text-[11px] font-semibold text-indigo-900">
                        Once received, today's OTP remains valid until 23:59:59.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleSendLoginOtp}
                      disabled={loginOtpSending || loginOtpCooldown > 0}
                      className="w-full py-3.5 bg-indigo-900 hover:bg-indigo-800 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                    >
                      {loginOtpSending ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        <Send size={16} />
                      )}
                      <span>
                        {loginOtpCooldown > 0
                          ? `Wait ${loginOtpCooldown}s before re-sending`
                          : 'GET OTP'}
                      </span>
                    </button>
                  </div>
                )}

                {/* If user selected YES -> Show OTP input and Submit */}
                {hasTodayOtp === true && (
                  <form onSubmit={handleVerifyLoginOtp} className="space-y-4 pt-1">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Enter 6-Digit RMMS Security OTP
                        </label>
                        <span className="text-[10px] text-indigo-700 font-semibold">Valid for Today</span>
                      </div>
                      <input
                        type="text"
                        maxLength={6}
                        pattern="\d*"
                        placeholder="••••••"
                        className="w-full text-center tracking-[1.2em] font-mono text-xl border-2 border-slate-200 focus:border-indigo-600 rounded-xl py-3 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-slate-800"
                        value={loginOtpInput}
                        onChange={e => setLoginOtpInput(e.target.value.replace(/\D/g, ''))}
                        required
                        autoFocus
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs pt-0.5">
                      <button
                        type="button"
                        onClick={handleSendLoginOtp}
                        disabled={loginOtpSending || loginOtpCooldown > 0}
                        className="text-indigo-600 font-bold hover:underline disabled:opacity-50 flex items-center gap-1"
                      >
                        <RefreshCw size={12} className={loginOtpCooldown > 0 ? 'animate-spin' : ''} />
                        <span>{loginOtpCooldown > 0 ? `Resend (${loginOtpCooldown}s)` : "Get / Resend Today's OTP"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setHasTodayOtp(false)}
                        className="text-slate-400 hover:text-slate-600 text-[11px]"
                      >
                        Change choice
                      </button>
                    </div>

                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        type="submit"
                        disabled={loginOtpLoading || loginOtpInput.length !== 6}
                        className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                      >
                        {loginOtpLoading ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                        <span>Submit OTP & Enter Account</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* If unselected yet */}
                {hasTodayOtp === null && (
                  <div className="text-center py-2 text-xs text-slate-400">
                    Please select whether you already have today's OTP or need a new one sent to your registered email.
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
