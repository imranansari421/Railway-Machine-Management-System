import React, { useState, useEffect } from 'react';
import { 
  collection, addDoc, getDocs, query, where, doc, updateDoc, onSnapshot, arrayUnion, writeBatch, orderBy, deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { findEmployeeForUser, EmployeeProfile } from '../utils/employee';
import { SupportMessage, Reply } from '../types';
import { 
  MessageSquare, Send, KeyRound, ShieldAlert, Search, User as UserIcon, 
  Mail, Phone, Briefcase, Award, Loader2, CheckCircle, RefreshCw, 
  Trash2, Inbox, AlertCircle, ArrowLeft, MessageCircle, Upload, Camera, X
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export default function MessageCenter() {
  const [isEmployee, setIsEmployee] = useState(false);
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset PIN (Admin only)
  const [resetPfNo, setResetPfNo] = useState('');
  const [resettingPin, setResettingPin] = useState(false);

  // Tickets / Messages list
  const [tickets, setTickets] = useState<SupportMessage[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Ticket creation (Employee only)
  const [newTicketMessage, setNewTicketMessage] = useState('');
  const [newTicketImage, setNewTicketImage] = useState('');
  const [creatingTicket, setCreatingTicket] = useState(false);

  // Chat replies
  const [replyText, setReplyText] = useState('');
  const [replyImage, setReplyImage] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // Message deletion
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [deletingTicket, setDeletingTicket] = useState(false);

  const handleSupportImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isReply = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      toast.error('Only JPG, JPEG, and PNG formats are allowed.');
      return;
    }

    if (file.size > 50 * 1024) {
      toast.error('Image size must be less than 50KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (isReply) {
        setReplyImage(base64);
      } else {
        setNewTicketImage(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    async function checkRole() {
      if (!auth.currentUser) return;
      const isEmp = auth.currentUser.email?.endsWith('@employee.billedapp.com') || false;
      setIsEmployee(isEmp);

      if (isEmp) {
        try {
          const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
          setEmployee(emp);
        } catch (err) {
          console.error("Error loading employee profile:", err);
        }
      }
      setLoading(false);
    }
    checkRole();
  }, []);

  // Listen to tickets
  useEffect(() => {
    if (loading) return;

    setLoadingTickets(true);
    let q = query(collection(db, 'messages'));

    if (isEmployee) {
      if (auth.currentUser?.email) {
        q = query(collection(db, 'messages'), where('email', '==', auth.currentUser.email));
      }
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as SupportMessage)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setTickets(msgs);
      setLoadingTickets(false);

      if (selectedTicket) {
        const updated = msgs.find(t => t.id === selectedTicket.id);
        if (updated) setSelectedTicket(updated);
      }
    }, (err) => {
      console.error("Error fetching messages:", err);
      setLoadingTickets(false);
      handleFirestoreError(err, OperationType.LIST, 'messages');
    });

    return () => unsubscribe();
  }, [loading, isEmployee, employee]);

  // Admin PIN Reset
  const handleResetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPfNo.trim()) {
      toast.error("Please enter a PF Number.");
      return;
    }

    setResettingPin(true);
    try {
      const q = query(
        collection(db, 'employees'),
        where('pfNo', '==', resetPfNo.trim())
      );
      const querySnap = await getDocs(q);

      if (querySnap.empty) {
        // Try case-insensitive comparison manually if exact match fails
        const allEmpSnap = await getDocs(collection(db, 'employees'));
        let foundDocId = '';
        let foundName = '';
        
        allEmpSnap.forEach(d => {
          const data = d.data();
          if (data.pfNo?.trim().toLowerCase() === resetPfNo.trim().toLowerCase()) {
            foundDocId = d.id;
            foundName = data.name;
          }
        });

        if (foundDocId) {
          const empRef = doc(db, 'employees', foundDocId);
          await updateDoc(empRef, {
            pin: '',
            isPinCreated: false
          });

          toast.success(`PIN reset successfully for ${foundName}! They will be prompted to create a new PIN on next login.`);
          setResetPfNo('');
        } else {
          toast.error(`No employee found with PF Number: ${resetPfNo}`);
        }
      } else {
        const empDoc = querySnap.docs[0];
        const empRef = doc(db, 'employees', empDoc.id);
        await updateDoc(empRef, {
          pin: '',
          isPinCreated: false
        });

        toast.success(`PIN reset successfully for ${empDoc.data().name}! They will be prompted to create a new PIN on next login.`);
        setResetPfNo('');
      }
    } catch (error) {
      console.error("Error resetting PIN:", error);
      toast.error("Failed to reset PIN. Please check your network connection.");
      handleFirestoreError(error, OperationType.LIST, 'employees');
    } finally {
      setResettingPin(false);
    }
  };

  // Employee Create Ticket
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) {
      toast.error("Employee profile data is not fully loaded yet.");
      return;
    }
    if (!newTicketMessage.trim()) {
      toast.error("Please write a message before submitting.");
      return;
    }

    setCreatingTicket(true);
    try {
      await addDoc(collection(db, 'messages'), {
        employeeId: employee.employeeId,
        name: employee.name,
        pfNo: employee.pfNo || '',
        email: auth.currentUser?.email || employee.email || '',
        personalEmail: employee.email || '',
        mobile: employee.mobile || '',
        designation: employee.designation || '',
        message: newTicketMessage.trim(),
        imageUrl: newTicketImage || '',
        status: 'open',
        createdAt: new Date().toISOString(),
        replies: []
      });

      toast.success("Support ticket created in Message Center!");
      setNewTicketMessage('');
      setNewTicketImage('');
    } catch (error) {
      console.error("Error creating ticket:", error);
      toast.error("Failed to submit support request.");
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    } finally {
      setCreatingTicket(false);
    }
  };

  // Chat send reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || (!replyText.trim() && !replyImage)) return;

    setSendingReply(true);
    try {
      const senderName = isEmployee ? (employee?.name || 'Employee') : 'Super Admin';
      const senderType = isEmployee ? 'employee' : 'admin';

      const replyRef = doc(db, 'messages', selectedTicket.id);
      const newReply: Reply = {
        sender: senderType,
        senderName: senderName,
        text: replyText.trim(),
        imageUrl: replyImage || '',
        createdAt: new Date().toISOString()
      };

      const updates: any = {
        replies: arrayUnion(newReply)
      };

      // Auto-set status to 'responded' when Admin sends a reply
      if (!isEmployee) {
        updates.status = 'responded';
      }

      await updateDoc(replyRef, updates);
      setReplyText('');
      setReplyImage('');
    } catch (error) {
      console.error("Error sending message reply:", error);
      toast.error("Failed to send message.");
      handleFirestoreError(error, OperationType.UPDATE, `messages/${selectedTicket.id}`);
    } finally {
      setSendingReply(false);
    }
  };

  const handleUpdateStatus = async (ticket: SupportMessage, newStatus: 'open' | 'responded' | 'closed') => {
    try {
      await updateDoc(doc(db, 'messages', ticket.id), {
        status: newStatus
      });
      toast.success(`Ticket status updated to ${newStatus.toUpperCase()}`);
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status.");
      handleFirestoreError(error, OperationType.UPDATE, `messages/${ticket.id}`);
    }
  };

  const handleDeleteTicket = async (ticketId: string) => {
    if (isEmployee) {
      toast.error("Only Super Admin can delete messages.");
      return;
    }
    setDeletingTicket(true);
    try {
      await deleteDoc(doc(db, 'messages', ticketId));
      toast.success("Support message deleted successfully.");
      setSelectedTicket(null);
      setTicketToDelete(null);
    } catch (error) {
      console.error("Error deleting support message:", error);
      toast.error("Failed to delete support message.");
      handleFirestoreError(error, OperationType.DELETE, `messages/${ticketId}`);
    } finally {
      setDeletingTicket(false);
    }
  };

  const filteredTickets = tickets.filter(t => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      t.name?.toLowerCase().includes(query) ||
      t.pfNo?.toLowerCase().includes(query) ||
      t.message?.toLowerCase().includes(query) ||
      t.designation?.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-indigo-900" size={32} />
      </div>
    );
  }

  return (
    <>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-6xl mx-auto flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
      >
        <div className="flex-shrink-0 mb-4 space-y-4">
      <div className="flex justify-between items-center border-b border-slate-100 pb-4">
        <div>
          <h1 className="text-2xl font-black text-indigo-950 tracking-tight flex items-center gap-2">
            <MessageSquare size={26} className="text-indigo-600" /> Message Center
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {isEmployee 
              ? "Submit help inquiries, reset requests, and chat directly with Administrators."
              : "Manage and respond to employee help logs and security reset requests."
            }
          </p>
        </div>
      </div>

      {/* ADMIN UTILITY ROW */}
      {!isEmployee && (
        <div className="bg-gradient-to-r from-indigo-950 to-slate-900 rounded-2xl p-6 text-white border border-indigo-900 shadow-md">
          <h2 className="text-base font-black flex items-center gap-2">
            <KeyRound className="text-indigo-400 animate-pulse" size={18} /> Reset Employee Security PIN
          </h2>
          <p className="text-xs text-indigo-200/70 mt-1">
            Need to reset an employee's PIN? Enter their case-insensitive PF Number below. They will create a new PIN on next login.
          </p>
          <form onSubmit={handleResetPin} className="mt-4 flex flex-col sm:flex-row gap-3 max-w-xl">
            <input
              type="text"
              placeholder="Enter PF Number (e.g. MH/BAN/12345)"
              className="flex-1 bg-white/10 border border-indigo-700/50 hover:border-indigo-600 focus:border-white rounded-xl px-4 py-3 text-sm text-white font-semibold outline-none focus:ring-2 focus:ring-white/20 transition-all placeholder:text-indigo-300/60"
              value={resetPfNo}
              onChange={e => setResetPfNo(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={resettingPin}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow shadow-indigo-600/20"
            >
              {resettingPin ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
              <span>Reset PIN</span>
            </button>
          </form>
        </div>
      )}
      </div>

      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16">
      {/* MAIN LAYOUT SPLIT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: TICKETS LIST / CREATE TICKET */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Employee: Create Ticket Form */}
          {isEmployee && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-3">
                Create Support Message
              </h3>
              <form onSubmit={handleCreateTicket} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Message / Request Description
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Describe your issue or request (e.g. Please reset my ESIC account access or assist with PIN change.)"
                    className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-600/10 transition-all resize-none"
                    value={newTicketMessage}
                    onChange={e => setNewTicketMessage(e.target.value)}
                    required
                  />
                </div>

                {/* Ticket Image Attachment */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                    Attach Image (Optional)
                  </label>
                  {newTicketImage ? (
                    <div className="relative border border-slate-200 rounded-xl p-2 bg-slate-50 flex items-center gap-3">
                      <img src={newTicketImage} alt="Attachment Preview" className="w-12 h-12 rounded object-cover border border-slate-200" />
                      <div className="flex-1 min-w-0 text-left">
                        <span className="text-[10px] font-bold text-indigo-600 block">Image Attached</span>
                        <span className="text-[9px] text-slate-400 font-semibold block truncate">JPG/JPEG/PNG format</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewTicketImage('')}
                        className="p-1 text-slate-400 hover:text-red-500 rounded-full hover:bg-slate-100 transition-colors"
                        title="Remove attachment"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="relative border border-dashed border-slate-200 hover:border-indigo-500 rounded-xl p-3 text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-slate-50 flex flex-col items-center justify-center">
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png"
                        onChange={(e) => handleSupportImageUpload(e, false)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Camera size={16} className="text-indigo-500 mb-1" />
                      <p className="text-[10px] font-bold text-slate-700">Click to Upload Image</p>
                      <p className="text-[8px] text-slate-400 mt-0.5 font-semibold">Max 300kb (JPG, PNG)</p>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={creatingTicket}
                  className="w-full py-3 bg-indigo-900 hover:bg-indigo-800 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2"
                >
                  {creatingTicket ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                  <span>Submit to Message Center</span>
                </button>
              </form>
            </div>
          )}

          {/* Tickets List */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-[500px]">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                  {isEmployee ? "My Messages" : "All Messages"}
                </h3>
                <span className="bg-indigo-100 text-indigo-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                  {filteredTickets.length} Total
                </span>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, PF, description..."
                  className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 transition-all font-semibold"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loadingTickets ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="animate-spin text-indigo-600" size={24} />
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center text-xs">
                  <Inbox size={32} className="text-slate-300 mb-2" />
                  No messages found matching search.
                </div>
              ) : (
                filteredTickets.map((t) => {
                  const isSelected = selectedTicket?.id === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTicket(t)}
                      className={cn(
                        "p-4 text-left cursor-pointer transition-all border-l-4",
                        isSelected 
                          ? "bg-indigo-50/60 border-indigo-600" 
                          : "border-transparent hover:bg-slate-50/60"
                      )}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-black text-slate-800 truncate">{t.name}</h4>
                          <p className="text-[10px] text-indigo-600 font-bold mt-0.5">{t.designation} • PF: {t.pfNo || 'N/A'}</p>
                        </div>
                        <span className={cn(
                          "text-[8px] font-black uppercase px-2 py-0.5 rounded-full shrink-0",
                          t.status === 'closed'
                            ? "bg-rose-100 text-rose-700 font-extrabold"
                            : t.status === 'responded'
                            ? "bg-blue-100 text-blue-700 font-extrabold"
                            : "bg-amber-100 text-amber-700 font-extrabold"
                        )}>
                          {t.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 font-semibold mt-2 line-clamp-2 leading-relaxed">
                        {t.message}
                      </p>
                      <div className="flex justify-between items-center mt-3 text-[9px] text-slate-400 font-medium">
                        <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                        {t.replies && t.replies.length > 0 && (
                          <span className="flex items-center gap-1 text-indigo-600 font-bold">
                            <MessageCircle size={10} /> {t.replies.length} replies
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: ACTIVE CONVERSATION */}
        <div className="lg:col-span-7">
          <AnimatePresence mode="wait">
            {selectedTicket ? (
              <motion.div 
                key={selectedTicket.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col h-[650px] overflow-hidden"
              >
                {/* Header detail */}
                <div className="p-5 border-b border-slate-100 bg-slate-50/30 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-black">
                      {selectedTicket.name.charAt(0)}
                    </div>
                    <div className="text-left">
                      <h3 className="text-xs font-black text-slate-800">{selectedTicket.name}</h3>
                      <p className="text-[10px] text-slate-500 font-semibold">{selectedTicket.designation} • PF: {selectedTicket.pfNo || 'N/A'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {!isEmployee && (
                      <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/60">
                        {(['open', 'responded', 'closed'] as const).map((st) => {
                          const isActive = selectedTicket.status === st;
                          return (
                            <button
                              key={st}
                              type="button"
                              onClick={() => handleUpdateStatus(selectedTicket, st)}
                              className={cn(
                                "px-2.5 py-1 rounded-md text-[10px] font-black uppercase transition-all",
                                isActive
                                  ? st === 'closed'
                                    ? "bg-rose-600 text-white shadow-sm"
                                    : st === 'responded'
                                    ? "bg-blue-600 text-white shadow-sm"
                                    : "bg-amber-500 text-white shadow-sm"
                                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                              )}
                            >
                              {st === 'responded' ? 'RESPOND' : st}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <span className={cn(
                      "text-[10px] font-black uppercase px-2.5 py-1 rounded-full",
                      selectedTicket.status === 'closed'
                        ? "bg-rose-100 text-rose-700 font-extrabold"
                        : selectedTicket.status === 'responded'
                        ? "bg-blue-100 text-blue-700 font-extrabold"
                        : "bg-amber-100 text-amber-700 font-extrabold"
                    )}>
                      {selectedTicket.status}
                    </span>

                    {!isEmployee && (
                      <button
                        type="button"
                        onClick={() => setTicketToDelete(selectedTicket.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl border border-slate-200 hover:border-rose-100 transition-all flex items-center justify-center"
                        title="Delete Ticket"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Info Bar (Admin view only) */}
                {!isEmployee && (
                  <div className="bg-indigo-50/40 border-b border-indigo-100/30 p-4 grid grid-cols-2 gap-4 text-xs text-slate-600 text-left">
                    <div>
                      <span className="text-[9px] text-indigo-900/60 font-black uppercase">Email Contact</span>
                      <p className="font-bold text-slate-800 truncate">{selectedTicket.email?.replace('@employee.billedapp.com', '') || 'None'}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-indigo-900/60 font-black uppercase">Mobile No</span>
                      <p className="font-bold text-slate-800">{selectedTicket.mobile || 'None'}</p>
                    </div>
                  </div>
                )}

                {/* Conversation Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/20 text-left">
                  {/* Original message */}
                  <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm max-w-[85%]">
                    <span className="text-[9px] text-indigo-600 font-black uppercase tracking-wider block mb-1">
                      Submitted Message
                    </span>
                    <p className="text-xs text-slate-700 font-semibold leading-relaxed">
                      {selectedTicket.message}
                    </p>
                    {selectedTicket.imageUrl && (
                      <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 max-w-sm">
                        <a href={selectedTicket.imageUrl} target="_blank" rel="noopener noreferrer" className="block hover:opacity-90 transition-opacity">
                          <img src={selectedTicket.imageUrl} alt="Attached Support Asset" className="max-h-48 w-auto object-contain rounded-xl" />
                        </a>
                      </div>
                    )}
                    <span className="text-[9px] text-slate-400 font-medium block mt-1.5">
                      {new Date(selectedTicket.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {/* Replies thread */}
                  {selectedTicket.replies?.map((reply, idx) => {
                    const isAdminSender = reply.sender === 'admin';
                    const isSelf = isEmployee ? !isAdminSender : isAdminSender;
                    return (
                      <div 
                        key={idx}
                        className={cn(
                          "flex flex-col max-w-[80%] rounded-2xl p-3 shadow-sm",
                          isSelf 
                            ? "bg-indigo-900 text-white ml-auto" 
                            : "bg-white border border-slate-150 text-slate-800 mr-auto"
                        )}
                      >
                        <span className={cn(
                          "text-[9px] font-black mb-1",
                          isSelf ? "text-indigo-200" : "text-indigo-600/70"
                        )}>
                          {reply.senderName}
                        </span>
                        <p className="text-xs font-semibold leading-relaxed">{reply.text}</p>
                        {reply.imageUrl && (
                          <div className="mt-2 rounded-lg overflow-hidden border border-slate-200/20 bg-black/5 max-w-xs">
                            <a href={reply.imageUrl} target="_blank" rel="noopener noreferrer" className="block hover:opacity-90 transition-opacity">
                              <img src={reply.imageUrl} alt="Attached Reply Asset" className="max-h-40 w-auto object-contain rounded-lg" />
                            </a>
                          </div>
                        )}
                        <span className="text-[8px] text-slate-400 font-medium mt-1.5 self-end">
                          {new Date(reply.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Input Footer */}
                {isEmployee && selectedTicket.status === 'closed' ? (
                  <div className="p-5 border-t border-slate-100 bg-slate-50 flex items-center gap-2.5 text-xs text-slate-500 font-semibold justify-center">
                    <AlertCircle size={15} className="text-rose-500 shrink-0" />
                    <span>This support ticket has been closed. You can submit a new ticket on the left panel to request help.</span>
                  </div>
                ) : (
                  <div className="border-t border-slate-100 bg-white p-4 space-y-3">
                    {/* Attached reply image preview */}
                    {replyImage && (
                      <div className="relative border border-slate-200 rounded-xl p-2 bg-slate-50 flex items-center gap-3 max-w-xs">
                        <img src={replyImage} alt="Reply Attachment Preview" className="w-10 h-10 rounded object-cover border border-slate-200" />
                        <div className="flex-1 min-w-0 text-left">
                          <span className="text-[10px] font-bold text-indigo-600 block">Image Attached</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReplyImage('')}
                          className="p-1 text-slate-400 hover:text-red-500 rounded-full hover:bg-slate-100 transition-colors"
                          title="Remove attachment"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    <form onSubmit={handleSendReply} className="flex gap-3 items-center">
                      <div className="relative flex-1 flex items-center">
                        <input
                          type="text"
                          placeholder={
                            isEmployee 
                              ? "Type message to Administrators..." 
                              : selectedTicket.status === 'closed'
                              ? "This ticket is closed, but you can still send replies as Admin..."
                              : "Type reply to employee..."
                          }
                          className="w-full border border-slate-200 focus:border-indigo-600 rounded-xl pl-4 pr-10 py-3 text-xs font-semibold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-600/10 transition-all"
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          required={!replyImage}
                        />
                        <label className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-indigo-600 cursor-pointer rounded-lg hover:bg-slate-50 transition-all">
                          <input
                            type="file"
                            accept="image/jpeg,image/jpg,image/png"
                            onChange={(e) => handleSupportImageUpload(e, true)}
                            className="hidden"
                          />
                          <Camera size={16} />
                        </label>
                      </div>
                      <button
                        type="submit"
                        disabled={sendingReply || (!replyText.trim() && !replyImage)}
                        className="px-5 py-3 bg-indigo-900 hover:bg-indigo-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow"
                      >
                        {sendingReply ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                        <span>Send</span>
                      </button>
                    </form>
                  </div>
                )}

              </motion.div>
            ) : (
              <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-16 text-center h-[500px] flex flex-col justify-center items-center shadow-sm">
                <MessageCircle size={48} className="text-slate-300 mb-4 animate-bounce" />
                <h3 className="text-lg font-black text-slate-800">No Active Chat Selected</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
                  Click on any support request in the left list to view contact information, change statuses, and chat live in real-time.
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>

      </div>
      </div>

    </motion.div>

      {/* Delete Support Ticket Confirmation Modal */}
      <AnimatePresence>
        {ticketToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setTicketToDelete(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative bg-white rounded-3xl border border-slate-100 p-6 shadow-2xl max-w-md w-full overflow-hidden text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 mx-auto">
                <ShieldAlert size={24} />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-black text-slate-800">Delete Support Message?</h3>
                <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                  Are you sure you want to permanently delete this support request? This action is irreversible and will delete all chat history.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTicketToDelete(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingTicket}
                  onClick={() => handleDeleteTicket(ticketToDelete)}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/10"
                >
                  {deletingTicket ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  <span>{deletingTicket ? 'Deleting...' : 'Delete Permanently'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
