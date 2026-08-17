import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendPasswordResetEmail, confirmPasswordReset } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, onSnapshot, getDocs, collection } from 'firebase/firestore';
import { LockOpen, Factory, Mail, Key, ShieldCheck, ArrowLeft, CheckCircle2, Loader2, Facebook, Instagram, Globe, Send, Calendar, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

type Step = 'verify' | 'password' | 'success';

export default function ForgotPassword() {
  const [step, setStep] = useState<Step>('verify');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [doj, setDoj] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

  React.useEffect(() => {
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

  const handleVerifyCredentials = async (e: React.FormEvent) => {
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

      if (matchedEmployee.accessType === 'admin-light') {
        setStep('password');
      } else {
        setStep('success');
      }
    } catch (err: any) {
      setError('Verification failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

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
      if (employeeData && employeeData.accessType === 'admin-light') {
        const { doc, updateDoc } = await import('firebase/firestore');
        const { hashPassword } = await import('../utils/crypto');
        const saltSource = employeeData.loginId || employeeData.id;
        const hashedNewPassword = await hashPassword(newPassword, saltSource);
        const empRef = doc(db, 'employees', employeeData.id);
        await updateDoc(empRef, {
          password: hashedNewPassword,
          firstTimeLogin: false,
        });
        toast.success('Your corporate password has been updated in Firestore!');
      } else {
        toast.success('Verification successful!');
      }
      setStep('success');
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
          <div className="mb-10 text-center">
            <motion.div 
              initial={{ rotate: -10, scale: 0.8 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded bg-surface-container-highest mb-6 shadow-inner"
            >
              <ShieldCheck className="text-primary" size={32} />
            </motion.div>
            <motion.h1 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-3xl font-extrabold tracking-tight text-on-surface mb-2"
            >
              {step === 'verify' ? 'Find Credentials' : 'Reset Password'}
            </motion.h1>
            <motion.p 
              key={step}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-on-surface-variant text-sm"
            >
              {step === 'verify' && 'Enter your Email, Company Name, and Date of Joining (DOJ) to find your credentials.'}
              {step === 'password' && 'Create a new secure password for your corporate account.'}
              {step === 'success' && 'Your credentials have been verified successfully.'}
            </motion.p>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-surface-container-lowest p-8 rounded-2xl shadow-2xl border border-outline-variant/10"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="bg-error-container text-on-error-container p-3 rounded-lg text-sm font-medium mb-6 overflow-hidden"
                  >
                    {error}
                  </motion.div>
                )}

                {step === 'verify' && (
                  <form onSubmit={handleVerifyCredentials} className="space-y-6">
                    {/* Email Input */}
                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="email">
                        Email Address
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant"
                          id="email"
                          placeholder="Enter your authorized email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Mail size={20} />
                        </div>
                      </div>
                    </div>

                    {/* Company Name Input */}
                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="companyName">
                        Company Name
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant"
                          id="companyName"
                          placeholder="Enter your Company Name"
                          type="text"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Building2 size={20} />
                        </div>
                      </div>
                    </div>

                    {/* Date of Joining (DOJ) Input */}
                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="doj">
                        Date of Joining (DOJ)
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-on-surface"
                          id="doj"
                          type="date"
                          value={doj}
                          onChange={(e) => setDoj(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors pointer-events-none">
                          <Calendar size={20} />
                        </div>
                      </div>
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
                      <span>{loading ? 'Finding Profile...' : 'Find Employee Profile'}</span>
                      {loading && <Loader2 className="animate-spin" size={20} />}
                    </motion.button>
                  </form>
                )}

                {step === 'password' && (
                  <form onSubmit={handleResetPassword} className="space-y-6">
                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="new-password">
                        New Password
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant"
                          id="new-password"
                          placeholder="Enter new password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Key size={20} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary ml-1" htmlFor="confirm-password">
                        Confirm New Password
                      </label>
                      <div className="relative group">
                        <input
                          className="w-full bg-surface-container-lowest border border-outline/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-outline-variant"
                          id="confirm-password"
                          placeholder="Confirm new password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                        />
                        <div className="absolute inset-y-0 right-3 flex items-center text-outline-variant group-focus-within:text-primary transition-colors">
                          <Key size={20} />
                        </div>
                      </div>
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
                      <span>{loading ? 'Updating...' : 'Save New Password'}</span>
                      {loading && <Loader2 className="animate-spin" size={20} />}
                    </motion.button>
                  </form>
                )}

                {step === 'success' && (
                  <div className="text-center py-4">
                    <motion.div 
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 10 }}
                      className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-6"
                    >
                      <CheckCircle2 className="text-green-600" size={32} />
                    </motion.div>
                    <h2 className="text-xl font-bold text-on-surface mb-4">Success!</h2>
                    <p className="text-on-surface-variant text-sm mb-8">
                      {employeeData?.accessType === 'admin-light' 
                        ? 'Your corporate password has been updated successfully. You can now use your new password to log in.'
                        : 'Your credentials have been successfully verified! Use your PF Number and Date of Birth to log in on the login page.'}
                    </p>
                    {employeeData && (
                      <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-4 mb-6 text-xs text-left text-slate-700 space-y-2">
                        <div className="text-center font-black text-indigo-950 border-b border-slate-200/50 pb-2 mb-2 uppercase tracking-wide">
                          Verified Candidate Profile
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
                          <span className="font-bold text-slate-500">Company Name:</span>
                          <span className="font-extrabold text-amber-800">{employeeData.companyName || 'N/A'}</span>
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
                      className="w-full bg-gradient-to-r from-indigo-900 to-blue-900 text-white font-bold py-4 rounded-xl shadow-xl transition-all"
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
        <p className="text-xs text-on-surface-variant font-medium">
          System version 1.4.0 | © {new Date().getFullYear()} Industrial Systems Group
        </p>
      </motion.footer>
    </div>
  );
}
