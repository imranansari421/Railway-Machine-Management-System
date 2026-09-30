import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, onSnapshot, getDocs, collection, updateDoc } from 'firebase/firestore';
import { 
  LockOpen, Factory, Mail, Key, ShieldCheck, ArrowLeft, CheckCircle2, 
  Loader2, Facebook, Instagram, Globe, Send, Calendar, Building2, 
  RefreshCw, Badge, ArrowRight, AlertCircle 
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { sendOtp, verifyOtp } from '../utils/otp';
import { hashPassword } from '../utils/crypto';
import { DeveloperBadge } from '../components/DeveloperBadge';

type ResetMethod = 'otp' | 'company';
type Step = 'input' | 'otp' | 'password' | 'success';

export default function ForgotPassword() {
  const [method, setMethod] = useState<ResetMethod>('otp');
  const [step, setStep] = useState<Step>('input');
  
  // OTP Reset Form states
  const [pfNo, setPfNo] = useState('');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);

  // Company verification states
  const [companyName, setCompanyName] = useState('');
  const [doj, setDoj] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [employeeData, setEmployeeData] = useState<any>(null);
  const navigate = useNavigate();

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

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldown]);

  // Method 1: Send OTP to Registered Email
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanPf = pfNo.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanPf || !cleanEmail) {
      setError('Please enter both PF Number and your Registered Email Address.');
      return;
    }

    setLoading(true);
    try {
      const qSnap = await getDocs(collection(db, 'employees'));
      let matchedEmployee: any = null;
      
      const normalizedPf = cleanPf.replace(/^pf/i, '').replace(/[^a-z0-9]/gi, '');

      let emailMismatched = false;

      qSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const empPfRaw = (data.pfNo || data.loginId || docSnap.id || '').trim().toLowerCase();
        const empPfNorm = empPfRaw.replace(/^pf/i, '').replace(/[^a-z0-9]/gi, '');
        
        const pfMatches = empPfRaw === cleanPf || 
                          (normalizedPf && empPfNorm === normalizedPf);

        const empEmail = (data.registeredEmail || data.email || '').trim().toLowerCase();
        const isDummyEmail = !empEmail || empEmail.endsWith('@employee.billedapp.com') || empEmail.endsWith('@billedapp.com');

        if (pfMatches) {
          if (empEmail && !isDummyEmail) {
            if (empEmail === cleanEmail) {
              matchedEmployee = { id: docSnap.id, ...data };
            } else {
              emailMismatched = true;
            }
          } else {
            // Employee only has dummy email or no registered email
            if (!matchedEmployee) {
              matchedEmployee = { id: docSnap.id, ...data, targetEmail: cleanEmail, isUnregisteredEmail: true };
            }
          }
        }
      });

      if (!matchedEmployee) {
        if (emailMismatched) {
          setError('The entered email address does not match the registered email for this PF Number. Please enter your correct registered email or use Company Verification.');
        } else {
          setError('No employee profile found matching this PF Number. Please check your PF Number or use Company Verification.');
        }
        setLoading(false);
        return;
      }

      setEmployeeData(matchedEmployee);
      const res = await sendOtp(cleanEmail, 'forgot_password', {
        name: matchedEmployee.name,
        pfNo: matchedEmployee.pfNo || matchedEmployee.loginId || cleanPf
      });

      if (res.success) {
        setStep('otp');
        setOtpCooldown(60);
        toast.success('Verification OTP sent to your registered email address.');
      } else {
        setError(res.message);
      }
    } catch (err: any) {
      setError('Failed to send OTP: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  // Method 1: Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (otpCode.trim().length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await verifyOtp(cleanEmail, otpCode, 'forgot_password');
      if (res.success) {
        setStep('password');
      } else {
        setError(res.message);
      }
    } catch (err: any) {
      setError('Verification failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  // Method 2: Company verification (DOJ + Company Name + Email)
  const handleVerifyCompanyCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEmployeeData(null);

    if (!email.trim() || !companyName.trim() || !doj) {
      setError('Please fill in Email, Company Name, and Date of Joining.');
      return;
    }

    setLoading(true);
    try {
      const qSnap = await getDocs(collection(db, 'employees'));
      let matchedEmployee: any = null;
      qSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const matchesEmail = data.email && data.email.trim().toLowerCase() === email.trim().toLowerCase();
        const matchesCompany = data.companyName && data.companyName.trim().toLowerCase() === companyName.trim().toLowerCase();
        const matchesDoj = data.doj && data.doj === doj;

        if (matchesEmail && matchesCompany && matchesDoj) {
          matchedEmployee = { id: docSnap.id, ...data };
        }
      });

      if (!matchedEmployee) {
        setError('No employee profile matches the entered Email, Company Name, and Date of Joining.');
        setLoading(false);
        return;
      }

      setEmployeeData(matchedEmployee);
      toast.success('Credentials verified successfully!');
      setStep('password');
    } catch (err: any) {
      setError('Verification failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Final Step: Save New Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    try {
      if (employeeData) {
        const saltSource = (employeeData.pfNo || employeeData.loginId || employeeData.id).trim().toLowerCase();
        const hashedNewPassword = await hashPassword(newPassword, saltSource);
        const empRef = doc(db, 'employees', employeeData.id);
        
        const cleanEmailToSave = email.trim().toLowerCase();
        await updateDoc(empRef, {
          password: hashedNewPassword,
          rawTempPassword: '',
          firstTimeLogin: false,
          mustChangePassword: false,
          registeredEmail: cleanEmailToSave || employeeData.registeredEmail || employeeData.email,
          isEmailVerified: true,
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString()
        });

        if (employeeData.isMasterAdmin === true || employeeData.role === 'admin' || employeeData.loginId === 'admin' || employeeData.loginId === 'master') {
          try {
            const { setDoc } = await import('firebase/firestore');
            const adminEmailToSave = cleanEmailToSave || employeeData.registeredEmail || employeeData.email || '';
            const masterHashedEmail = adminEmailToSave ? await hashPassword(newPassword, adminEmailToSave) : '';
            const masterHashedAdmin = await hashPassword(newPassword, 'admin');
            const masterHashedInput = await hashPassword(newPassword, saltSource);

            await setDoc(doc(db, 'settings', 'admin_credentials'), {
              adminEmail: adminEmailToSave,
              adminLoginId: (employeeData.loginId || employeeData.pfNo || 'admin').trim().toLowerCase(),
              password: masterHashedEmail,
              passwordAdminSalt: masterHashedAdmin,
              passwordInputSalt: masterHashedInput,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          } catch (credErr) {
            console.warn("Could not save to settings/admin_credentials:", credErr);
          }
        }

        toast.success('Your password has been updated securely in the system!');
        setStep('success');
      } else {
        setError('Session expired. Please restart the reset process.');
      }
    } catch (err: any) {
      setError('Failed to reset password: ' + err.message);
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
        <button 
          onClick={() => navigate('/login')}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-secondary hover:text-primary transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Login
        </button>
      </motion.header>

      <main className="flex-grow flex items-center justify-center px-6 pt-20 pb-10">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="mb-8 text-center">
            <motion.div 
              initial={{ rotate: -10, scale: 0.8 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-900 text-white mb-4 shadow-lg"
            >
              <ShieldCheck size={32} />
            </motion.div>
            <motion.h1 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-2xl font-extrabold tracking-tight text-on-surface mb-1"
            >
              {step === 'input' && 'Account Recovery'}
              {step === 'otp' && 'Verify Email OTP'}
              {step === 'password' && 'Set New Password'}
              {step === 'success' && 'Reset Complete'}
            </motion.h1>
            <motion.p 
              key={step}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-on-surface-variant text-xs"
            >
              {step === 'input' && 'Verify your identity via registered email OTP to securely reset your password.'}
              {step === 'otp' && 'Enter the 6-digit OTP code sent to your registered email address.'}
              {step === 'password' && 'Create a new password for your employee account.'}
              {step === 'success' && 'Your account password has been successfully updated.'}
            </motion.p>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-surface-container-lowest p-7 rounded-3xl shadow-2xl border border-outline-variant/10"
          >
            {/* Reset Method Tabs (Only on initial input step) */}
            {step === 'input' && (
              <div className="flex bg-slate-100 p-1 rounded-xl mb-6 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => { setMethod('otp'); setError(''); }}
                  className={cn(
                    "flex-1 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5",
                    method === 'otp' ? "bg-white text-indigo-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <Mail size={13} />
                  <span>Email OTP Reset</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMethod('company'); setError(''); }}
                  className={cn(
                    "flex-1 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5",
                    method === 'company' ? "bg-white text-indigo-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <Building2 size={13} />
                  <span>Company Details</span>
                </button>
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={`${step}-${method}`}
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.2 }}
              >
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="bg-rose-50 text-rose-700 p-3 rounded-xl text-xs font-semibold mb-5 flex items-start gap-2 border border-rose-200"
                  >
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </motion.div>
                )}

                {/* STEP 1A: OTP Method Input */}
                {step === 'input' && method === 'otp' && (
                  <form onSubmit={handleSendOtp} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="pf-no">
                        Employee PF Number
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm font-semibold"
                          id="pf-no"
                          placeholder="e.g. MH/BAN/12345/678"
                          type="text"
                          value={pfNo}
                          onChange={(e) => setPfNo(e.target.value)}
                          required
                          autoFocus
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Badge size={18} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="email">
                        Registered Email Address
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                          id="email"
                          placeholder="your-email@domain.com"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Mail size={18} />
                        </div>
                      </div>
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={cn(
                        "w-full bg-gradient-to-r from-indigo-900 to-blue-900 text-white font-bold py-3.5 rounded-xl shadow-xl flex items-center justify-center gap-2 transition-all text-sm",
                        loading && "opacity-70 cursor-not-allowed"
                      )}
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                      <span>{loading ? 'Sending OTP...' : 'Send Reset Code to Email'}</span>
                    </motion.button>
                  </form>
                )}

                {/* STEP 1B: Company Verification Method Input */}
                {step === 'input' && method === 'company' && (
                  <form onSubmit={handleVerifyCompanyCredentials} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="company-email">
                        Email Address
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                          id="company-email"
                          placeholder="Enter your authorized email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Mail size={18} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="companyName">
                        Company Name
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm"
                          id="companyName"
                          placeholder="Enter your Company Name"
                          type="text"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Building2 size={18} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="doj">
                        Date of Joining (DOJ)
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                          id="doj"
                          type="date"
                          value={doj}
                          onChange={(e) => setDoj(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors pointer-events-none">
                          <Calendar size={18} />
                        </div>
                      </div>
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={cn(
                        "w-full bg-gradient-to-r from-indigo-900 to-blue-900 text-white font-bold py-3.5 rounded-xl shadow-xl flex items-center justify-center gap-2 transition-all text-sm",
                        loading && "opacity-70 cursor-not-allowed"
                      )}
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                      <span>{loading ? 'Verifying...' : 'Verify Company Profile'}</span>
                    </motion.button>
                  </form>
                )}

                {/* STEP 2: Verify OTP */}
                {step === 'otp' && (
                  <form onSubmit={handleVerifyOtp} className="space-y-4">
                    <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3 text-center">
                      <p className="text-[11px] text-slate-500">6-Digit Code sent to:</p>
                      <p className="text-xs font-bold text-indigo-900 break-all">{email}</p>
                      <button
                        type="button"
                        onClick={() => setStep('input')}
                        className="text-[11px] text-indigo-600 font-bold hover:underline mt-1"
                      >
                        Change Email / PF
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
                        value={otpCode}
                        onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        required
                        autoFocus
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-400">Didn't receive code?</span>
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={otpCooldown > 0 || loading}
                        className="text-indigo-600 font-bold hover:underline disabled:opacity-50 flex items-center gap-1"
                      >
                        <RefreshCw size={12} className={otpCooldown > 0 ? 'animate-spin' : ''} />
                        <span>{otpCooldown > 0 ? `Resend (${otpCooldown}s)` : 'Resend OTP'}</span>
                      </button>
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={cn(
                        "w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl shadow-xl flex items-center justify-center gap-2 transition-all text-sm",
                        (loading || otpCode.length !== 6) && "opacity-70 cursor-not-allowed"
                      )}
                      type="submit"
                      disabled={loading || otpCode.length !== 6}
                    >
                      {loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                      <span>Verify Code</span>
                    </motion.button>
                  </form>
                )}

                {/* STEP 3: Enter New Password */}
                {step === 'password' && (
                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="new-password">
                        New Password
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm font-mono"
                          id="new-password"
                          placeholder="Enter new password (min 6 chars)"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          autoFocus
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Key size={18} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="confirm-password">
                        Confirm New Password
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant text-sm font-mono"
                          id="confirm-password"
                          placeholder="Confirm new password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Key size={18} />
                        </div>
                      </div>
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={cn(
                        "w-full bg-gradient-to-r from-indigo-900 to-blue-900 text-white font-bold py-3.5 rounded-xl shadow-xl flex items-center justify-center gap-2 transition-all text-sm",
                        (loading || newPassword.length < 6 || newPassword !== confirmPassword) && "opacity-70 cursor-not-allowed"
                      )}
                      type="submit"
                      disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}
                    >
                      {loading ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                      <span>{loading ? 'Updating...' : 'Save New Password'}</span>
                    </motion.button>
                  </form>
                )}

                {/* STEP 4: Success */}
                {step === 'success' && (
                  <div className="text-center py-4">
                    <motion.div 
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 10 }}
                      className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mb-4"
                    >
                      <CheckCircle2 size={32} />
                    </motion.div>
                    <h2 className="text-xl font-bold text-on-surface mb-2">Password Reset Successful</h2>
                    <p className="text-on-surface-variant text-xs mb-6 leading-relaxed">
                      Your password has been securely updated. You can now log into your account using your PF Number and new password.
                    </p>

                    {employeeData && (
                      <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 mb-6 text-xs text-left text-slate-700 space-y-2">
                        <div className="text-center font-black text-indigo-950 border-b border-slate-200/50 pb-2 mb-2 uppercase tracking-wide">
                          Verified Employee Profile
                        </div>
                        <div className="flex justify-between">
                          <span className="font-bold text-slate-500">Name:</span>
                          <span className="font-extrabold text-slate-800">{employeeData.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-bold text-slate-500">PF Number:</span>
                          <span className="font-mono font-extrabold text-slate-800">{employeeData.pfNo}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-bold text-slate-500">Email:</span>
                          <span className="font-semibold text-slate-800">{employeeData.email?.replace('@employee.billedapp.com', '')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-bold text-slate-500">Designation:</span>
                          <span className="font-bold text-indigo-800">{employeeData.designation || 'N/A'}</span>
                        </div>
                      </div>
                    )}

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => navigate('/login')}
                      className="w-full bg-gradient-to-r from-indigo-900 to-blue-900 text-white font-bold py-3.5 rounded-xl shadow-xl transition-all text-sm"
                    >
                      Go to Login
                    </motion.button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
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
    </div>
  );
}
