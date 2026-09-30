import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, ShieldCheck, Key, Lock, ArrowRight, CheckCircle2, RefreshCw, AlertCircle, X, Loader2, LogOut } from 'lucide-react';
import { doc, updateDoc, setDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { EmployeeProfile } from '../utils/employee';
import { sendOtp, verifyOtp, isPostEmailDeadline, EMAIL_DEADLINE } from '../utils/otp';
import { hashPassword } from '../utils/crypto';
import { toast } from 'sonner';

interface EmailVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: EmployeeProfile | null;
  onSuccess: (updatedEmail: string) => void;
  forceRequired?: boolean;
}

export default function EmailVerificationModal({
  isOpen,
  onClose,
  employee,
  onSuccess,
  forceRequired = false
}: EmailVerificationModalProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'input' | 'otp' | 'success'>('input');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState('');

  const isMandatory = forceRequired || isPostEmailDeadline();

  useEffect(() => {
    if (employee) {
      const initialEmail = employee.registeredEmail || (employee.email && !employee.email.endsWith('@employee.billedapp.com') ? employee.email : '');
      setEmailInput(initialEmail);
    } else if (auth.currentUser?.email && !auth.currentUser.email.endsWith('@employee.billedapp.com')) {
      setEmailInput(auth.currentUser.email);
    }
  }, [employee]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  const handleLogout = async () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem('sessionExpiryTime');
      localStorage.setItem('sessionLoggedOut', Date.now().toString());
      await signOut(auth);
      navigate('/login');
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');

    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!employee?.password && !passwordInput && isMandatory) {
      setError('Please set a strong password for your employee account.');
      return;
    }

    if (passwordInput && passwordInput !== confirmPasswordInput) {
      setError('Passwords do not match.');
      return;
    }

    if (passwordInput && passwordInput.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      // Check if email is already registered to another employee
      try {
        const qEmail = query(collection(db, 'employees'), where('email', '==', cleanEmail));
        const snapEmail = await getDocs(qEmail);
        const dupDoc1 = snapEmail.docs.find(d => d.id !== employee?.employeeId && d.data().status !== 'deleted');
        if (dupDoc1) {
          const dData = dupDoc1.data();
          setError(`This email is already registered to ${dData.name || 'another employee'} (PF: ${dData.pfNo || 'N/A'}). Ek email sirf ek employee ke liye allowed hai.`);
          setLoading(false);
          return;
        }

        const qReg = query(collection(db, 'employees'), where('registeredEmail', '==', cleanEmail));
        const snapReg = await getDocs(qReg);
        const dupDoc2 = snapReg.docs.find(d => d.id !== employee?.employeeId && d.data().status !== 'deleted');
        if (dupDoc2) {
          const dData = dupDoc2.data();
          setError(`This email is already registered to ${dData.name || 'another employee'} (PF: ${dData.pfNo || 'N/A'}). Ek email sirf ek employee ke liye allowed hai.`);
          setLoading(false);
          return;
        }
      } catch (checkErr) {
        console.warn("Could not check duplicate employee email:", checkErr);
      }

      const res = await sendOtp(cleanEmail, 'email_verification', {
        name: employee?.name || 'User',
        pfNo: employee?.pfNo || employee?.employeeId || 'N/A'
      });

      if (res.success) {
        setStep('otp');
        setResendCooldown(60);
      } else {
        setError(res.message);
      }
    } catch (err: any) {
      console.error('Error sending OTP:', err);
      setError('Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (otpInput.trim().length !== 6) {
      setError('Please enter the 6-digit OTP sent to your email.');
      return;
    }

    setLoading(true);
    try {
      const cleanEmail = emailInput.trim().toLowerCase();
      const verifyRes = await verifyOtp(cleanEmail, otpInput, 'email_verification');

      if (!verifyRes.success) {
        setError(verifyRes.message);
        setLoading(false);
        return;
      }

      // If valid OTP, update Firestore employee document
      if (employee?.employeeId) {
        const empRef = doc(db, 'employees', employee.employeeId);
        const updatePayload: Record<string, any> = {
          email: cleanEmail,
          registeredEmail: cleanEmail,
          isEmailVerified: true,
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString()
        };

        if (passwordInput) {
          const saltSource = (employee.pfNo || employee.employeeId).trim().toLowerCase();
          const hashedPass = await hashPassword(passwordInput, saltSource);
          updatePayload.password = hashedPass;
        }

        await updateDoc(empRef, updatePayload);
      }

      // Update current user doc in users collection
      if (auth.currentUser) {
        await setDoc(doc(db, 'users', auth.currentUser.uid), {
          email: cleanEmail,
          isEmailVerified: true,
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString()
        }, { merge: true });
        localStorage.setItem(`isEmailVerified_${auth.currentUser.uid}`, 'true');
      }

      // Update admin credentials if applicable
      try {
        const credsRef = doc(db, 'settings', 'admin_credentials');
        const credsSnap = await getDoc(credsRef);
        if (credsSnap.exists()) {
          await setDoc(credsRef, {
            isEmailVerified: true,
            emailVerified: true
          }, { merge: true });
        }
      } catch (e) {
        console.warn("Could not update admin_credentials email verified flag:", e);
      }

      window.dispatchEvent(new CustomEvent('profile-updated'));
      window.dispatchEvent(new CustomEvent('email-verified', { detail: { email: cleanEmail } }));

      setStep('success');
      toast.success('Email verified successfully!', {
        description: 'Your account is now fully verified and unlocked.'
      });

      setTimeout(() => {
        onSuccess(cleanEmail);
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('Error verifying OTP & updating profile:', err);
      setError('Failed to complete verification. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-indigo-100 flex flex-col my-8"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900 to-indigo-800 p-6 text-white relative">
          {!isMandatory && (
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-indigo-200 hover:text-white hover:bg-white/10 rounded-full transition-all"
              title="Skip for now"
            >
              <X size={18} />
            </button>
          )}

          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-indigo-500/20 border border-indigo-400/30 rounded-2xl text-indigo-200">
              <ShieldCheck size={24} />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded-full">
                {isMandatory ? 'Mandatory Verification' : 'Security Recommendation'}
              </span>
              <h3 className="text-lg font-black tracking-tight text-white mt-1">
                {step === 'otp' ? 'Enter Email OTP' : 'Update & Verify Email'}
              </h3>
            </div>
          </div>
          <p className="text-xs text-indigo-200/90 mt-1">
            {employee?.name} • PF No: {employee?.pfNo || 'N/A'}
          </p>
        </div>

        {/* Notice Banner */}
        <div className={`px-6 py-2.5 text-xs font-semibold flex items-center gap-2 ${
          isMandatory 
            ? 'bg-amber-500/10 text-amber-900 border-b border-amber-500/20'
            : 'bg-indigo-50 text-indigo-900 border-b border-indigo-100'
        }`}>
          <AlertCircle size={15} className="shrink-0 text-amber-600" />
          <span>
            {isMandatory ? (
              <strong>Strict Requirement:</strong>
            ) : (
              <span>Optional until <strong>31 Oct 2026</strong>. Required thereafter for Password & 2FA login.</span>
            )}
            {isMandatory && ' Email verification & Password login are now mandatory.'}
          </span>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold p-3 rounded-xl mb-4 flex items-center gap-2"
              >
                <AlertCircle size={16} className="shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {step === 'input' && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <Mail size={14} className="text-indigo-600" />
                  Your Active Email Address
                </label>
                <input
                  type="email"
                  placeholder="name@gmail.com"
                  className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-600/10 bg-slate-50/50 font-medium"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  We will send a 6-digit OTP to this email to verify ownership.
                </p>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
                    <Key size={14} className="text-indigo-600" />
                    Set Portal Password {employee?.password ? '(Optional Update)' : '(Recommended)'}
                  </label>
                  <input
                    type="password"
                    placeholder="Enter password (min 6 characters)"
                    className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-600/10 bg-slate-50/50 font-mono"
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                    required={isMandatory && !employee?.password}
                  />
                </div>

                {passwordInput && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      placeholder="Re-enter password"
                      className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-600/10 bg-slate-50/50 font-mono"
                      value={confirmPasswordInput}
                      onChange={e => setConfirmPasswordInput(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>

              <div className="pt-3 flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-gradient-to-r from-indigo-900 to-indigo-800 hover:from-indigo-800 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-900/10 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                  <span>Send Verification OTP</span>
                </button>

                {!isMandatory ? (
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-bold transition-all uppercase tracking-wider"
                  >
                    Skip for now (Valid until 31.08.2026)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full py-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 mt-1"
                  >
                    <LogOut size={13} />
                    <span>Log Out / Sign In with Another Account</span>
                  </button>
                )}
              </div>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleVerifyAndSubmit} className="space-y-4">
              <div className="text-center p-3 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                <p className="text-xs text-slate-600">
                  A 6-digit verification code was sent to:
                </p>
                <p className="text-sm font-bold text-indigo-900 mt-0.5 break-all">
                  {emailInput}
                </p>
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="text-[11px] text-indigo-600 font-bold hover:underline mt-1 inline-block"
                >
                  Change Email
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 text-center">
                  Enter 6-Digit OTP
                </label>
                <input
                  type="text"
                  maxLength={6}
                  pattern="\d*"
                  placeholder="••••••"
                  className="w-full text-center tracking-[1.2em] font-mono text-2xl border-2 border-slate-200 hover:border-slate-300 focus:border-indigo-600 rounded-2xl py-3.5 focus:ring-4 focus:ring-indigo-600/10 outline-none transition-all"
                  value={otpInput}
                  onChange={e => setOtpInput(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-slate-400">Didn't receive code?</span>
                <button
                  type="button"
                  onClick={() => handleSendOtp()}
                  disabled={resendCooldown > 0 || loading}
                  className="text-indigo-600 font-bold hover:underline disabled:opacity-50 flex items-center gap-1"
                >
                  <RefreshCw size={13} className={resendCooldown > 0 ? 'animate-spin' : ''} />
                  <span>{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend OTP'}</span>
                </button>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={loading || otpInput.length !== 6}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/10 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                  <span>Verify OTP & Save</span>
                </button>

                {!isMandatory ? (
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-2 text-slate-500 hover:text-slate-700 text-xs font-bold"
                  >
                    Skip for now
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full py-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 mt-1"
                  >
                    <LogOut size={13} />
                    <span>Log Out / Sign In with Another Account</span>
                  </button>
                )}
              </div>
            </form>
          )}

          {step === 'success' && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="py-8 text-center space-y-3"
            >
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 size={36} />
              </div>
              <h4 className="text-xl font-extrabold text-slate-800">Email Verified!</h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Your email <strong className="text-slate-700">{emailInput}</strong> has been registered and verified.
              </p>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
