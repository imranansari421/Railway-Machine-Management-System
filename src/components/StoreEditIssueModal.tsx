import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Edit2, AlertCircle, RefreshCw, Send, Check } from 'lucide-react';
import { StoreIssueRecord } from './StoreItemHistoryModal';

interface StoreEditIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  issue: StoreIssueRecord | null;
  allMachines: string[];
  companiesList: string[];
  currentStoreStock?: number;
  onSave: (updatedData: {
    date: string;
    qty: number;
    targetType: 'machine' | 'company';
    targetMachine: string;
    targetCompany: string;
    receiverName: string;
    receiverDesignation: string;
    remarks: string;
  }) => Promise<void>;
  loading?: boolean;
}

export default function StoreEditIssueModal({
  isOpen,
  onClose,
  issue,
  allMachines,
  companiesList,
  currentStoreStock = 0,
  onSave,
  loading = false,
}: StoreEditIssueModalProps) {
  const [form, setForm] = useState({
    date: '',
    qty: '1',
    targetType: 'machine' as 'machine' | 'company',
    targetMachine: '',
    targetCompany: '',
    receiverName: '',
    receiverDesignation: '',
    remarks: ''
  });

  useEffect(() => {
    if (issue) {
      setForm({
        date: issue.date || '',
        qty: String(issue.qty || 1),
        targetType: issue.targetType || 'machine',
        targetMachine: issue.targetMachine || '',
        targetCompany: issue.targetCompany || '',
        receiverName: issue.receiverName || '',
        receiverDesignation: issue.receiverDesignation || '',
        remarks: issue.remarks || ''
      });
    }
  }, [issue]);

  if (!isOpen || !issue) return null;

  const parsedNewQty = parseFloat(form.qty) || 0;
  const oldQty = Number(issue.qty) || 0;
  const qtyDiff = parsedNewQty - oldQty; // >0 means additional items issued; <0 means returned to store
  const maxAllowableIncrease = currentStoreStock;
  const isExceedingStock = qtyDiff > 0 && qtyDiff > maxAllowableIncrease;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedNewQty <= 0) {
      alert("Issue quantity must be greater than 0.");
      return;
    }
    if (isExceedingStock) {
      alert(`Cannot increase issue quantity by ${qtyDiff}. Only ${currentStoreStock} ${issue.unit} available in Store stock.`);
      return;
    }
    const targetName = form.targetType === 'machine' ? form.targetMachine : form.targetCompany;
    if (!targetName.trim()) {
      alert(`Please select target ${form.targetType}.`);
      return;
    }

    await onSave({
      date: form.date,
      qty: parsedNewQty,
      targetType: form.targetType,
      targetMachine: form.targetType === 'machine' ? form.targetMachine : '',
      targetCompany: form.targetType === 'company' ? form.targetCompany : '',
      receiverName: form.receiverName.trim(),
      receiverDesignation: form.receiverDesignation.trim(),
      remarks: form.remarks.trim()
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl my-auto border border-slate-200"
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 border border-indigo-200 flex items-center justify-center text-indigo-700 shadow-xs">
              <Edit2 size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-slate-900">Edit Store Issue Record</h2>
                <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-md font-bold text-[10px]">
                  MAIN ADMIN ONLY
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Voucher: <strong className="font-mono text-indigo-600">{issue.issueNoteNo}</strong> • {issue.description}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Edit Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-left">
          {/* Item details info banner */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex justify-between items-center">
            <div>
              <span className="text-slate-500">Issued Item: </span>
              <strong className="text-slate-900">{issue.description}</strong>
              <div className="text-[11px] text-slate-400 font-mono">
                PL: {issue.plNo || '-'} | Part: {issue.partNo || '-'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-500">Store Available Stock</div>
              <div className="text-sm font-black text-indigo-700 font-mono">{currentStoreStock} {issue.unit}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Issue Date */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Issue Date *</label>
              <input
                type="date"
                required
                value={form.date}
                onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
              />
            </div>

            {/* Target Type */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Dispatch Target Type</label>
              <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, targetType: 'machine' }))}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${form.targetType === 'machine' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}
                >
                  Machine Dispatch
                </button>
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, targetType: 'company' }))}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${form.targetType === 'company' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}
                >
                  Company Transfer
                </button>
              </div>
            </div>
          </div>

          {/* Machine or Company Selection */}
          {form.targetType === 'machine' ? (
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Target Machine *</label>
              <select
                required
                value={form.targetMachine}
                onChange={e => setForm(prev => ({ ...prev, targetMachine: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
              >
                <option value="">-- Select Machine --</option>
                {allMachines.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Target Company *</label>
              <select
                required
                value={form.targetCompany}
                onChange={e => setForm(prev => ({ ...prev, targetCompany: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
              >
                <option value="">-- Select Company --</option>
                {companiesList.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {/* Issue Quantity & Live Stock Rebalancing Preview */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold uppercase text-slate-500">
                Issue Quantity ({issue.unit || 'Nos'}) *
              </label>
              <span className="text-[11px] text-slate-500 font-mono">
                Original Issued: <strong className="text-slate-800">{oldQty}</strong>
              </span>
            </div>
            <input
              type="number"
              step="any"
              required
              min={0.001}
              value={form.qty}
              onChange={e => setForm(prev => ({ ...prev, qty: e.target.value }))}
              className={`w-full px-3.5 py-2.5 border rounded-xl text-sm font-black focus:ring-2 outline-none transition-all ${
                isExceedingStock
                  ? 'border-rose-300 bg-rose-50 text-rose-800 focus:ring-rose-500/20 focus:border-rose-500'
                  : 'border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:ring-indigo-500/20 focus:border-indigo-500'
              }`}
            />

            {/* Live Stock Impact Notification */}
            <div className="text-xs p-2.5 rounded-xl border mt-1.5">
              {qtyDiff === 0 ? (
                <div className="text-slate-600 flex items-center gap-1.5 font-medium">
                  <Check size={14} className="text-slate-500" />
                  Quantity unchanged. No effect on current Store inventory stock.
                </div>
              ) : qtyDiff > 0 ? (
                <div className={`flex items-start gap-1.5 font-medium ${isExceedingStock ? 'text-rose-700' : 'text-amber-700'}`}>
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    Increasing issue by <strong className="font-bold">+{qtyDiff} {issue.unit}</strong> will deduct <strong className="font-bold">{qtyDiff} {issue.unit}</strong> from Store inventory.
                    {isExceedingStock && (
                      <p className="font-bold text-rose-600 mt-0.5">
                        Error: Only {currentStoreStock} {issue.unit} currently available in Store!
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-emerald-700 flex items-start gap-1.5 font-medium">
                  <Check size={14} className="shrink-0 mt-0.5" />
                  <div>
                    Decreasing issue by <strong className="font-bold">{Math.abs(qtyDiff)} {issue.unit}</strong> will return <strong className="font-bold">{Math.abs(qtyDiff)} {issue.unit}</strong> back to Store inventory stock.
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Receiver Name */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Receiver (Consignee) Name</label>
              <input
                type="text"
                placeholder="e.g. R. K. Sharma"
                value={form.receiverName}
                onChange={e => setForm(prev => ({ ...prev, receiverName: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
              />
            </div>

            {/* Receiver Designation */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Receiver Designation</label>
              <input
                type="text"
                placeholder="e.g. SSE/TM, JE"
                value={form.receiverDesignation}
                onChange={e => setForm(prev => ({ ...prev, receiverDesignation: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
              />
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Remarks / Reason</label>
            <textarea
              rows={2}
              placeholder="e.g. Issued for machine maintenance..."
              value={form.remarks}
              onChange={e => setForm(prev => ({ ...prev, remarks: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          {/* Modal Footer */}
          <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || isExceedingStock}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-1.5"
            >
              {loading ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Updating Record & Stock...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Update Issue & Adjust Stock
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
