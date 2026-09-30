import React, { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { X, Save, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export interface EditFieldConfig {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime-local' | 'select' | 'textarea';
  options?: string[];
  placeholder?: string;
  required?: boolean;
}

interface Props {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  recordId: string;
  collectionName: string;
  fields: EditFieldConfig[];
  initialData: Record<string, any>;
  onClose: () => void;
  onSaveSuccess?: () => void;
}

export default function EditReportRecordModal({
  isOpen,
  title,
  subtitle,
  recordId,
  collectionName,
  fields,
  initialData,
  onClose,
  onSaveSuccess,
}: Props) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const init: Record<string, any> = {};
      fields.forEach((f) => {
        init[f.key] = initialData[f.key] !== undefined ? initialData[f.key] : '';
      });
      setFormData(init);
      setError(null);
    }
  }, [isOpen, initialData, fields]);

  if (!isOpen) return null;

  const handleChange = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (!recordId) {
        throw new Error('Record ID is missing');
      }

      // Format types
      const updatePayload: Record<string, any> = {};
      fields.forEach((f) => {
        const val = formData[f.key];
        if (f.type === 'number') {
          updatePayload[f.key] = val === '' ? 0 : Number(val);
        } else {
          updatePayload[f.key] = val !== undefined ? val : '';
        }
      });

      if (collectionName === 'employees') {
        if (updatePayload.leftDate !== undefined) {
          updatePayload.doe = updatePayload.leftDate;
          updatePayload.exitDate = updatePayload.leftDate;
        }
      }

      updatePayload.updatedAt = new Date().toISOString();

      await updateDoc(doc(db, collectionName, recordId), updatePayload);

      toast.success('Record updated successfully');
      if (onSaveSuccess) onSaveSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to update record:', err);
      setError(err?.message || 'Failed to update record');
      toast.error('Failed to update record: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-200">
                Master Admin
              </span>
              <h3 className="text-base font-black text-slate-800">{title}</h3>
            </div>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700">
              <AlertCircle size={16} className="shrink-0 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {fields.map((f) => {
              const isFullSpan = f.type === 'textarea' || f.key === 'subjectOrDetails' || f.key === 'workDone' || f.key === 'reason' || f.key === 'remedialAction';
              return (
                <div key={f.key} className={isFullSpan ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
                    {f.label} {f.required && <span className="text-rose-500">*</span>}
                  </label>

                  {f.type === 'select' ? (
                    <select
                      value={formData[f.key] || ''}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-slate-50 font-medium"
                      required={f.required}
                    >
                      {f.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={formData[f.key] || ''}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-slate-50 font-medium"
                      required={f.required}
                    />
                  ) : (
                    <input
                      type={f.type || 'text'}
                      value={formData[f.key] !== undefined ? formData[f.key] : ''}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-slate-50 font-medium"
                      required={f.required}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-2 text-[11px] text-slate-400 font-mono">
            Document ID: {recordId} • Collection: {collectionName}
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
