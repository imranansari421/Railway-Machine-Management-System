import React, { useState, useEffect } from 'react';
import { 
  collection, addDoc, getDocs, query, where, doc, updateDoc, onSnapshot, arrayUnion 
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { User, signOut } from 'firebase/auth';
import { EmployeeProfile } from '../utils/employee';
import { SupportMessage, Reply } from '../types';
import { 
  Lock, Unlock, ShieldAlert, KeyRound, MessageSquare, Send, 
  Loader2, User as UserIcon, Mail, Phone, Briefcase, Award, 
  ArrowLeft, CheckCircle, RefreshCw, MessageCircle, AlertCircle, LogOut
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { hashPin, isHashedPin } from '../utils/crypto';

interface PinGateProps {
  user: User;
  employee: EmployeeProfile | null;
  onVerified: () => void;
}

export default function PinGate({ user, employee, onVerified }: PinGateProps) {
  const [view, setView] = useState<'entry' | 'setup' | 'forgot' | 'chat'>('entry');
  
  // PIN Verification / Entry states
  const [enteredPin, setEnteredPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  
  // PIN Setup states
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [settingUp, setSettingUp] = useState(false);
  
  // Forgot PIN form states
  const [forgotMessage, setForgotMessage] = useState('Please reset my PIN.');
  const [sendingMessage, setSendingMessage] = useState(false);
  
  // Chat / Ticket history states
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<SupportMessage | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // If employee doesn't have a PIN created, force setup view
  useEffect(() => {
    if (employee && (!employee.pin || !employee.isPinCreated)) {
      setView('setup');
    } else {
      setView('entry');
    }
  }, [employee]);

  // Fetch Message Center Tickets for the employee
  const fetchMessages = () => {
    if (!user?.email) return;
    setLoadingMessages(true);
    
    const q = query(collection(db, 'messages'), where('email', '==', user.email));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgsList = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      } as SupportMessage)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setMessages(msgsList);
      setLoadingMessages(false);
      
      // Keep selected message in sync with database updates
      if (selectedMessage) {
        const updatedSelected = msgsList.find(m => m.id === selectedMessage.id);
        if (updatedSelected) {
          setSelectedMessage(updatedSelected);
        }
      }
    }, (err) => {
      console.error("Error listening to messages:", err);
      setLoadingMessages(false);
      handleFirestoreError(err, OperationType.LIST, 'messages');
    });

    return unsubscribe;
  };

  useEffect(() => {
    if (view === 'chat' || view === 'forgot') {
      const unsub = fetchMessages();
      return () => {
        if (unsub) unsub();
      };
    }
  }, [view, employee]);

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) {
      toast.error("Employee data not loaded yet.");
      return;
    }
    if (enteredPin.length !== 6 || !/^\d+$/.test(enteredPin)) {
      toast.error("Please enter a valid 6-digit numeric PIN.");
      return;
    }

    setVerifying(true);
    try {
      // Direct comparison with employee PIN
      // Note: We also fetch the freshest copy from DB just in case admin reset it recently
      const empSnap = await getDocs(query(collection(db, 'employees'), where('pfNo', '==', employee.pfNo || '')));
      if (empSnap.empty) {
        toast.error("Employee record not found.");
        setVerifying(false);
        return;
      }
      const freshDoc = empSnap.docs[0];
      const freshData = freshDoc.data();
      const freshDocId = freshDoc.id;
      
      if (!freshData.isPinCreated) {
        // Hups! It was reset by admin in the meantime!
        toast.info("Your PIN was reset by Admin. Please create a new PIN.");
        setView('setup');
        setVerifying(false);
        return;
      }

      const isStoredHashed = isHashedPin(freshData.pin);
      let isValid = false;

      if (isStoredHashed) {
        const hashedEntered = await hashPin(enteredPin, freshDocId);
        isValid = freshData.pin === hashedEntered;
      } else {
        // Legacy plain text check for smooth migration
        isValid = freshData.pin === enteredPin;

        if (isValid) {
          // Migrate plain text to secure salted hash seamlessly
          try {
            const hashedMigrated = await hashPin(enteredPin, freshDocId);
            const empRef = doc(db, 'employees', freshDocId);
            await updateDoc(empRef, {
              pin: hashedMigrated
            });
            console.log("PIN successfully migrated to salted hash.");
          } catch (migrateErr) {
            console.error("Failed to migrate PIN to salted hash:", migrateErr);
          }
        }
      }

      if (isValid) {
        toast.success("PIN verified successfully!");
        onVerified();
      } else {
        toast.error("Invalid PIN code. Please try again or click Forgot PIN.");
      }
    } catch (error) {
      console.error("Error verifying PIN:", error);
      toast.error("Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleSetupPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee?.employeeId) {
      toast.error("Employee record is missing.");
      return;
    }
    if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
      toast.error("PIN must be exactly 6 digits (numbers only).");
      return;
    }
    if (newPin !== confirmPin) {
      toast.error("PINs do not match!");
      return;
    }

    setSettingUp(true);
    try {
      // Securely hash the new PIN with salt before saving to Firestore
      const hashedNewPin = await hashPin(newPin, employee.employeeId);
      
      // Update employee record
      const empRef = doc(db, 'employees', employee.employeeId);
      await updateDoc(empRef, {
        pin: hashedNewPin,
        isPinCreated: true
      });

      toast.success("Security PIN created successfully!");
      onVerified();
    } catch (error) {
      console.error("Error saving PIN:", error);
      toast.error("Failed to set PIN. Please try again.");
    } finally {
      setSettingUp(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) {
      toast.error("Employee record is missing.");
      return;
    }
    if (!forgotMessage.trim()) {
      toast.error("Please write a message before submitting.");
      return;
    }

    setSendingMessage(true);
    try {
      await addDoc(collection(db, 'messages'), {
        employeeId: employee.employeeId,
        name: employee.name,
        pfNo: employee.pfNo || '',
        email: user.email || employee.email || '',
        personalEmail: employee.email || '',
        mobile: employee.mobile || '',
        designation: employee.designation || '',
        message: forgotMessage.trim(),
        status: 'open',
        createdAt: new Date().toISOString(),
        replies: []
      });

      toast.success("Your request has been submitted to Admin Message Center!");
      setForgotMessage('Please reset my PIN.');
      setView('chat');
    } catch (error) {
      console.error("Error submitting support message:", error);
      toast.error("Failed to submit request.");
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMessage || !replyText.trim() || !employee) return;

    setSendingReply(true);
    try {
      const msgRef = doc(db, 'messages', selectedMessage.id);
      const newReply: Reply = {
        sender: 'employee',
        senderName: employee.name,
        text: replyText.trim(),
        createdAt: new Date().toISOString()
      };

      await updateDoc(msgRef, {
        replies: arrayUnion(newReply)
      });

      setReplyText('');
    } catch (error) {
      console.error("Error sending reply:", error);
      toast.error("Failed to send reply.");
      handleFirestoreError(error, OperationType.UPDATE, `messages/${selectedMessage.id}`);
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div id="pin-gate-container" className="min-h-screen w-full flex items-center justify-center bg-slate-900/95 p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col my-8">
        
        {/* Top Header Card */}
        <div className="bg-gradient-to-r from-indigo-900 to-indigo-800 p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-600/10 rounded-full blur-xl transform -translate-x-4 translate-y-8" />
          
          <div className="flex justify-between items-start">
            <div className="space-y-1.5">
              <span className="bg-indigo-500/20 border border-indigo-500/30 text-indigo-200 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full">
                Security Gate
              </span>
              <h2 className="text-xl font-black tracking-tight mt-2">
                {view === 'setup' && 'Create Security PIN'}
                {view === 'entry' && 'Enter Security PIN'}
                {view === 'forgot' && 'Message Center'}
                {view === 'chat' && 'Message Status & Chat'}
              </h2>
              <p className="text-xs text-indigo-200/80">
                {employee?.name} • PF: {employee?.pfNo || 'N/A'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="p-3 bg-indigo-500/15 rounded-2xl border border-indigo-400/20 text-indigo-300">
                {view === 'setup' && <KeyRound size={24} />}
                {view === 'entry' && <Lock size={24} />}
                {(view === 'forgot' || view === 'chat') && <MessageSquare size={24} />}
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await signOut(auth);
                    toast.success("Logged out successfully");
                  } catch (err) {
                    console.error("Logout failed:", err);
                    toast.error("Logout failed");
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-sm hover:shadow-rose-600/20 hover:scale-105 active:scale-95"
              >
                <LogOut size={11} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>

        {/* Dynamic Screens */}
        <div className="p-6 sm:p-8 flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait">
            
            {/* SCREEN 1: PIN ENTRY */}
            {view === 'entry' && (
              <motion.form 
                key="entry"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                onSubmit={handleVerifyPin}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <p className="text-slate-600 text-sm">
                    Please enter your 6-digit security PIN to unlock and enter the employee portal.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <Lock size={12} /> Security PIN
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    pattern="\d*"
                    placeholder="••••••"
                    className="w-full text-center tracking-[1.5em] font-mono text-2xl border-2 border-slate-200 hover:border-slate-300 focus:border-indigo-600 rounded-2xl py-4 focus:ring-4 focus:ring-indigo-600/10 outline-none transition-all placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-300"
                    value={enteredPin}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '');
                      setEnteredPin(val);
                    }}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={verifying}
                  className="w-full py-4 bg-indigo-900 hover:bg-indigo-800 text-white font-bold rounded-2xl transition-all transform active:scale-98 flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/10"
                >
                  {verifying ? <Loader2 className="animate-spin" size={18} /> : <Unlock size={18} />}
                  <span>Verify PIN & Enter Portal</span>
                </button>

                <div className="flex flex-col items-center gap-2.5 pt-4 border-t border-slate-100 text-xs">
                  <button
                    type="button"
                    onClick={() => setView('forgot')}
                    className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline"
                  >
                    Forgot Security PIN? Submit Reset Request
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('chat')}
                    className="text-slate-500 hover:text-slate-700 font-semibold hover:underline flex items-center gap-1.5"
                  >
                    <MessageCircle size={14} /> View message history & chats
                  </button>
                </div>
              </motion.form>
            )}

            {/* SCREEN 2: PIN SETUP (FIRST TIME) */}
            {view === 'setup' && (
              <motion.form 
                key="setup"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                onSubmit={handleSetupPin}
                className="space-y-5"
              >
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3">
                  <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={18} />
                  <div className="text-xs text-amber-800 font-medium leading-relaxed">
                    <span className="font-bold">First Time Login / Reset.</span> You are required to create a unique 6-digit security PIN before logging into your account.
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <KeyRound size={12} /> New 6-Digit PIN
                    </label>
                    <input
                      type="password"
                      maxLength={6}
                      pattern="\d*"
                      placeholder="••••••"
                      className="w-full text-center tracking-[1.5em] font-mono text-xl border border-slate-200 hover:border-slate-300 focus:border-indigo-600 rounded-2xl py-3 outline-none transition-all placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-300"
                      value={newPin}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        setNewPin(val);
                      }}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <CheckCircle size={12} /> Confirm New PIN
                    </label>
                    <input
                      type="password"
                      maxLength={6}
                      pattern="\d*"
                      placeholder="••••••"
                      className="w-full text-center tracking-[1.5em] font-mono text-xl border border-slate-200 hover:border-slate-300 focus:border-indigo-600 rounded-2xl py-3 outline-none transition-all placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-300"
                      value={confirmPin}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        setConfirmPin(val);
                      }}
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={settingUp}
                  className="w-full py-4 bg-gradient-to-r from-indigo-900 to-indigo-800 hover:from-indigo-950 hover:to-indigo-800 text-white font-bold rounded-2xl transition-all transform active:scale-98 flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/15"
                >
                  {settingUp ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}
                  <span>Create PIN & Login</span>
                </button>
              </motion.form>
            )}

            {/* SCREEN 3: FORGOT PIN FORM */}
            {view === 'forgot' && (
              <motion.form 
                key="forgot"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                onSubmit={handleForgotSubmit}
                className="space-y-5"
              >
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <button 
                    type="button" 
                    onClick={() => setView('entry')} 
                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Back to Verify PIN
                  </span>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                  Forgot your security PIN? Complete this form to auto-send a PIN reset request to the Admin. You can track status and chat here.
                </p>

                {/* Read-only details */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Name</span>
                    <p className="font-bold text-slate-800">{employee?.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">PF Number</span>
                    <p className="font-bold text-slate-800">{employee?.pfNo}</p>
                  </div>
                  <div className="space-y-0.5 col-span-2 border-t border-slate-200/40 pt-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Designation</span>
                    <p className="font-bold text-slate-800">{employee?.designation}</p>
                  </div>
                  <div className="space-y-0.5 col-span-2 border-t border-slate-200/40 pt-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Contact Info</span>
                    <p className="font-semibold text-slate-700">{employee?.email?.replace('@employee.billedapp.com', '')} | {employee?.mobile}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <MessageSquare size={12} /> Message to Admin
                  </label>
                  <textarea
                    rows={3}
                    className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-600/10 transition-all resize-none"
                    value={forgotMessage}
                    onChange={e => setForgotMessage(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={sendingMessage}
                  className="w-full py-3.5 bg-indigo-900 hover:bg-indigo-800 text-white font-bold rounded-2xl transition-all transform active:scale-98 flex items-center justify-center gap-2 shadow-md shadow-indigo-900/10"
                >
                  {sendingMessage ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  <span>Send Reset Request</span>
                </button>
              </motion.form>
            )}

            {/* SCREEN 4: CHAT / TICKETS HISTORY */}
            {view === 'chat' && (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-5"
              >
                {!selectedMessage ? (
                  <>
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                      <button 
                        type="button" 
                        onClick={() => setView('entry')} 
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Back to Security Gate
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-black text-slate-700 uppercase tracking-wide">Support Requests</h4>
                      <button 
                        onClick={fetchMessages} 
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-indigo-600 transition-all"
                        title="Reload"
                      >
                        <RefreshCw size={14} className={loadingMessages ? "animate-spin" : ""} />
                      </button>
                    </div>

                    {loadingMessages ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="animate-spin text-indigo-600" size={24} />
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">
                        <MessageCircle size={32} className="mx-auto text-slate-300 mb-2" />
                        No support messages submitted yet.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {messages.map((m) => (
                          <div 
                            key={m.id}
                            onClick={() => setSelectedMessage(m)}
                            className="bg-slate-50 hover:bg-slate-100 border border-slate-100 hover:border-slate-200 p-4 rounded-xl cursor-pointer transition-all flex justify-between items-center"
                          >
                            <div className="space-y-1 text-left flex-1 min-w-0 pr-3">
                              <p className="text-xs font-bold text-slate-800 truncate">{m.message}</p>
                              <span className="text-[9px] text-slate-400 font-medium">
                                {new Date(m.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <span className={cn(
                              "text-[9px] font-black uppercase px-2 py-0.5 rounded-full shrink-0",
                              m.status === 'closed' 
                                ? "bg-rose-100 text-rose-700 font-extrabold" 
                                : m.status === 'responded'
                                ? "bg-blue-100 text-blue-700 font-extrabold"
                                : "bg-amber-100 text-amber-700 font-extrabold"
                            )}>
                              {m.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  // INDIVIDUAL TICKET CHAT SCREEN
                  <div className="flex flex-col h-[350px]">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-3">
                      <button 
                        type="button" 
                        onClick={() => setSelectedMessage(null)} 
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <div className="text-left flex-1 min-w-0">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">Ticket Chat</span>
                        <h4 className="text-xs font-black text-slate-800 truncate">{selectedMessage.message}</h4>
                      </div>
                      <span className={cn(
                        "text-[9px] font-black uppercase px-2.5 py-1 rounded-full",
                        selectedMessage.status === 'closed' 
                          ? "bg-rose-100 text-rose-700 font-extrabold" 
                          : selectedMessage.status === 'responded'
                          ? "bg-blue-100 text-blue-700 font-extrabold"
                          : "bg-amber-100 text-amber-700 font-extrabold"
                      )}>
                        {selectedMessage.status}
                      </span>
                    </div>

                    {/* Chat Messages Log */}
                    <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs mb-3 text-left">
                      {/* Original Ticket Description */}
                      <div className="bg-slate-100/70 border border-slate-100 rounded-2xl p-3">
                        <p className="text-[9px] font-black uppercase text-indigo-900 tracking-wider mb-1">Original Issue Message</p>
                        <p className="text-slate-700 font-semibold">{selectedMessage.message}</p>
                        <span className="text-[9px] text-slate-400 font-medium mt-1 block">
                          {new Date(selectedMessage.createdAt).toLocaleString()}
                        </span>
                      </div>

                      {/* Conversation Loop */}
                      {selectedMessage.replies?.map((reply, index) => {
                        const isAdminSender = reply.sender === 'admin';
                        return (
                          <div 
                            key={index}
                            className={cn(
                              "flex flex-col max-w-[85%] rounded-2xl p-3 shadow-sm",
                              isAdminSender 
                                ? "bg-indigo-50 border border-indigo-100 text-indigo-950 ml-auto" 
                                : "bg-slate-50 border border-slate-200/60 text-slate-800 mr-auto"
                            )}
                          >
                            <span className="text-[9px] font-black text-indigo-600/70 mb-0.5">
                              {isAdminSender ? reply.senderName : 'You'}
                            </span>
                            <p className="font-semibold leading-relaxed">{reply.text}</p>
                            <span className="text-[8px] text-slate-400 font-medium mt-1 self-end">
                              {new Date(reply.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Chat Reply Field */}
                    {selectedMessage.status === 'closed' ? (
                      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-500 rounded-xl p-3 text-[11px] font-bold text-center justify-center mt-3">
                        <AlertCircle size={14} className="text-slate-400 shrink-0" />
                        <span>This ticket is closed. You cannot send replies. Please submit a new request.</span>
                      </div>
                    ) : (
                      <form onSubmit={handleSendReply} className="flex gap-2 border-t border-slate-100 pt-3">
                        <input
                          type="text"
                          placeholder="Type reply to admin..."
                          className="flex-1 border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-2 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-600/10 transition-all"
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          required
                        />
                        <button
                          type="submit"
                          disabled={sendingReply || !replyText.trim()}
                          className="p-2.5 bg-indigo-900 hover:bg-indigo-800 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow"
                        >
                          {sendingReply ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
