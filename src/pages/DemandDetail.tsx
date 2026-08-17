import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Demand } from './Demand';
import { 
  ArrowLeft, Calendar, FileText, Settings, ShieldAlert, CheckCircle, 
  Clock, XCircle, Printer, Image as ImageIcon, Sparkles, Building, User
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

export default function DemandDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [demand, setDemand] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDemand() {
      if (!id) return;
      try {
        const ref = doc(db, 'demands', id);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setDemand({ id: snap.id, ...snap.data() });
        } else {
          toast.error("Demand not found.");
        }
      } catch (err) {
        console.error("Error loading demand details:", err);
        toast.error("Failed to load demand details.");
      } finally {
        setLoading(false);
      }
    }
    fetchDemand();
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-900 border-t-transparent"></div>
      </div>
    );
  }

  if (!demand) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl max-w-sm">
          <ShieldAlert className="text-rose-600 mx-auto mb-2" size={32} />
          <h2 className="text-sm font-black text-rose-950 uppercase tracking-wider">Demand Not Found</h2>
          <p className="text-xs text-rose-700/80 mt-1">
            The demand record you are looking for does not exist or has been deleted.
          </p>
          <button 
            onClick={() => navigate('/demand')} 
            className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'completed':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-100',
          icon: <CheckCircle size={14} className="text-emerald-600" />,
          label: 'Completed'
        };
      case 'rejected':
        return {
          bg: 'bg-rose-50 text-rose-700 border-rose-100',
          icon: <XCircle size={14} className="text-rose-600" />,
          label: 'Rejected'
        };
      default:
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-100',
          icon: <Clock size={14} className="text-amber-500" />,
          label: 'Pending'
        };
    }
  };

  const statusInfo = getStatusStyle(demand.status || 'pending');

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans print:bg-white print:p-0">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Navigation / Actions Bar */}
        <div className="flex justify-between items-center print:hidden">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-4 py-2.5 transition-all shadow-sm"
          >
            <ArrowLeft size={15} /> Back to List
          </button>
          
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-4 py-2.5 transition-all shadow-sm"
          >
            <Printer size={15} /> Print Detail
          </button>
        </div>

        {/* Demand Info Dashboard */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-12 print:border-none print:shadow-none">
          
          {/* Left / Top Side: Main details */}
          <div className="p-6 md:p-8 md:col-span-7 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-100">
            <div className="space-y-6">
              
              {/* Header with status */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-1">
                  <Sparkles size={11} /> Company Demand Detail
                </span>
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border text-xs font-black uppercase ${statusInfo.bg}`}>
                  {statusInfo.icon}
                  {statusInfo.label}
                </span>
              </div>

              {/* Description */}
              <div className="text-left">
                <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">
                  {demand.description || 'No Description Provided'}
                </h1>
                <p className="text-xs text-slate-400 mt-2 font-mono">
                  Demand ID: {demand.id}
                </p>
              </div>

              {/* Specs Grid */}
              <div className="grid grid-cols-2 gap-4 text-left border-y border-slate-100 py-6">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">PL Number</span>
                  <span className="text-sm font-bold text-slate-900 font-mono">{demand.plNo}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Part Number</span>
                  <span className="text-sm font-bold text-slate-900 font-mono">{demand.partNo || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Quantity Required</span>
                  <span className="text-sm font-black text-indigo-600">{demand.qty}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Demand Date</span>
                  <span className="text-sm font-bold text-slate-900">{demand.date}</span>
                </div>
              </div>

              {/* Secondary Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left text-xs bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Whether Use</span>
                  <span className="font-bold text-slate-800">{demand.whetherUse || 'N/A'}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Machine Association</span>
                  <span className="font-bold text-slate-800">{demand.machineName || 'None'}</span>
                </div>
                {demand.remarks && (
                  <div className="sm:col-span-2 space-y-1 border-t border-slate-100 pt-2 mt-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Remarks</span>
                    <span className="font-semibold text-slate-700 leading-relaxed block">{demand.remarks}</span>
                  </div>
                )}
                {demand.rejectReason && (
                  <div className="sm:col-span-2 space-y-1 border-t border-rose-100 bg-rose-50/30 p-2 rounded-lg pt-2 mt-2">
                    <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest block">Rejection Reason</span>
                    <span className="font-bold text-rose-800 leading-relaxed block">{demand.rejectReason}</span>
                  </div>
                )}
              </div>

              {/* Receipts History */}
              {demand.receivedQty ? (
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-left space-y-3 mt-4">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Receipt History</span>
                  <div className="grid grid-cols-2 gap-4 border-b border-slate-200/40 pb-3">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase block">Total Received</span>
                      <span className="text-sm font-black text-emerald-600">{demand.receivedQty} / {demand.qty}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase block">Latest Date</span>
                      <span className="text-sm font-bold text-slate-800">{demand.receivedDate || 'N/A'}</span>
                    </div>
                  </div>
                  {demand.receipts && demand.receipts.length > 0 ? (
                    <div>
                      <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1.5">Receipt Batches</span>
                      <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-1">
                        {demand.receipts.map((r: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center text-[11px] bg-white p-2 rounded-xl border border-slate-200/40 shadow-xs">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-800">Batch #{idx + 1}: <span className="text-emerald-600">{r.qty} pcs</span></span>
                              {r.remarks && <span className="text-[9px] text-slate-400 font-semibold">{r.remarks}</span>}
                            </div>
                            <span className="font-semibold text-slate-500 font-mono">{r.date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 font-medium">
                      Single batch receipt on {demand.receivedDate || 'unknown date'}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Operator / Submitter Info footer */}
            <div className="border-t border-slate-100 pt-6 mt-6 text-left flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold">
                <User size={18} />
              </div>
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Submitted By (माँगकर्ता)</span>
                {(() => {
                  const email = demand.createdByEmail || '';
                  const empName = demand.createdByEmployeeName || '';
                  const pfNo = demand.createdByPfNo || '';
                  const isEmployeeEmail = email.endsWith('@employee.billedapp.com');
                  const isAdmin = !email || !isEmployeeEmail || empName.toLowerCase().includes('admin') || empName.endsWith('@billedapp.com');

                  if (isAdmin) {
                    const adminName = empName && !empName.endsWith('@employee.billedapp.com') ? empName : (demand.createdByCompanyName ? `Admin (${demand.createdByCompanyName})` : 'Admin');
                    return (
                      <>
                        <p className="text-xs font-bold text-slate-800">{adminName}</p>
                        <p className="text-[10px] text-indigo-600 font-semibold font-mono">Administrator</p>
                      </>
                    );
                  }
                  return (
                    <>
                      <p className="text-xs font-bold text-slate-800">
                        {empName || email.replace('@employee.billedapp.com', '') || 'Employee'}
                      </p>
                      <p className="text-[10px] text-indigo-600 font-semibold font-mono">
                        {pfNo ? `ID/PF: ${pfNo}` : (email ? `ID: ${email.split('@')[0]}` : '')}
                      </p>
                    </>
                  );
                })()}
              </div>
            </div>

          </div>

          {/* Right / Bottom Side: Full-size image display */}
          <div className="p-6 md:p-8 md:col-span-5 bg-slate-50/30 flex flex-col justify-center items-center">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4 self-start">
              Uploaded Demand Image
            </span>
            {demand.imageUrl ? (
              <div className="relative group w-full bg-white rounded-2xl border border-slate-200 p-2 shadow-sm max-w-sm overflow-hidden">
                <img 
                  src={demand.imageUrl} 
                  alt={demand.description} 
                  referrerPolicy="no-referrer" 
                  className="w-full h-auto rounded-xl object-contain max-h-[400px]"
                />
              </div>
            ) : (
              <div className="py-20 border border-dashed border-slate-200 rounded-2xl w-full max-w-sm flex flex-col items-center justify-center text-slate-400 bg-white">
                <ImageIcon size={32} className="text-slate-300 mb-2" />
                <p className="text-xs font-bold">No Image Attachment</p>
                <p className="text-[10px] text-slate-400 mt-0.5">No image was uploaded with this demand.</p>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
