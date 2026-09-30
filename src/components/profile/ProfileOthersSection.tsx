import React, { useState, useRef } from 'react';
import { 
  Award, TrendingUp, TrendingDown, AlertTriangle, Stethoscope, Plus, Minus, 
  Trash2, PlusCircle, CheckCircle, Calendar, Building2, Eye, 
  FileText, X, Loader2, ArrowDownCircle, History, Clock, ShieldCheck,
  Download, UploadCloud, FileCheck, AlertCircle, ExternalLink,
  Edit3, RotateCcw, RefreshCw, Archive
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmployeeProfile, AwardRecord, PmeRecord } from '../../utils/employee';
import { getActivePmeDueStatus } from '../../utils/birthdayAndPmeService';
import { formatDateToDDMMYYYY } from '../../utils/dateUtils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { auth } from '../../firebase';

interface ProfileOthersSectionProps {
  profile: EmployeeProfile;
  isEmployee: boolean;
  canDelete?: boolean;
  isMasterAdmin?: boolean;
  isCompanyAdmin?: boolean;
  isZonalAdmin?: boolean;
  isDivisionalAdmin?: boolean;
  onSaveSubRecord: (type: 'pme' | 'award' | 'promotion' | 'demotion', data: any) => Promise<void>;
  onUpdateSubRecord?: (type: 'pme' | 'award', index: number, updatedData: any) => Promise<void>;
  onDeleteSubRecord: (type: 'pme' | 'award' | 'history', index: number) => Promise<void>;
  onRecoverSubRecord?: (record: any) => Promise<void>;
  onPermanentDeleteSubRecord?: (recordId: string) => Promise<void>;
}

export function ProfileOthersSection({
  profile,
  isEmployee,
  canDelete = false,
  isMasterAdmin = false,
  isCompanyAdmin = false,
  isZonalAdmin = false,
  isDivisionalAdmin = false,
  onSaveSubRecord,
  onUpdateSubRecord,
  onDeleteSubRecord,
  onRecoverSubRecord,
  onPermanentDeleteSubRecord,
}: ProfileOthersSectionProps) {
  // Role & permission logic:
  // "abhi bhe profile ke Other ke section me entry hua item ko delete aur edit karne ka option show kar raha hai wah only Master Admin ke account me show kare other kisi ke account me show n kare"
  const isStrictMasterAdmin = Boolean(
    isMasterAdmin &&
    (auth.currentUser?.email === 'imranansari399605@gmail.com' || (
      !isEmployee &&
      !auth.currentUser?.email?.endsWith('@employee.billedapp.com') &&
      localStorage.getItem(`loginPortal_${auth.currentUser?.uid}`) === 'admin' &&
      !isCompanyAdmin &&
      !isZonalAdmin &&
      !isDivisionalAdmin &&
      !profile.employeeId
    ))
  );

  const canEditItem = isStrictMasterAdmin;
  const canDeleteItem = isStrictMasterAdmin;
  const canManageAdminRecords = isStrictMasterAdmin;
  const canManageAwards = isStrictMasterAdmin;
  const canDeletePme = isStrictMasterAdmin;
  const canEditData = isStrictMasterAdmin;

  // Expandable row states
  const [expanded, setExpanded] = useState<{
    award: boolean;
    promotion: boolean;
    demotion: boolean;
    pme: boolean;
  }>({
    award: false,
    promotion: false,
    demotion: false,
    pme: true, // Default PME expanded so employee can see/add their PME right away
  });

  const toggleSection = (key: 'award' | 'promotion' | 'demotion' | 'pme') => {
    setExpanded(prev => {
      const isCurrentlyOpen = !!prev[key];
      if (isCurrentlyOpen) {
        // If clicking on already open section (-), close it so it becomes (+)
        return {
          award: false,
          promotion: false,
          demotion: false,
          pme: false,
        };
      } else {
        // When clicking (+), close all other open sections (they become +) and open this one (-)
        return {
          award: false,
          promotion: false,
          demotion: false,
          pme: false,
          [key]: true,
        };
      }
    });
  };

  // Modal open & edit states
  const [showAwardModal, setShowAwardModal] = useState(false);
  const [editingAwardIndex, setEditingAwardIndex] = useState<number | null>(null);

  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [showDemotionModal, setShowDemotionModal] = useState(false);

  const [showPmeModal, setShowPmeModal] = useState(false);
  const [editingPmeIndex, setEditingPmeIndex] = useState<number | null>(null);
  const [savingSubRecord, setSavingSubRecord] = useState(false);

  // Active PME Due Status Check
  const pmeStatus = getActivePmeDueStatus(profile.pmeRecords);

  // PDF Preview State & Helpers (Fix Chrome Blocking PDF in iframe)
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewRawUrl, setPreviewRawUrl] = useState<string | null>(null);
  const [previewPdfTitle, setPreviewPdfTitle] = useState<string>('PME Certificate PDF');
  const activeBlobUrlRef = useRef<string | null>(null);
  const pmePdfInputRef = useRef<HTMLInputElement | null>(null);

  const dataUrlToBlob = (dataUrl: string): Blob => {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const handleOpenPdfPreview = (rawUrl: string, title: string) => {
    if (activeBlobUrlRef.current) {
      try {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      } catch (e) {
        // ignore
      }
      activeBlobUrlRef.current = null;
    }

    setPreviewRawUrl(rawUrl);
    setPreviewPdfTitle(title);

    let finalUrl = rawUrl;
    if (rawUrl.startsWith('data:')) {
      try {
        const blob = dataUrlToBlob(rawUrl);
        const bUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = bUrl;
        finalUrl = bUrl;
      } catch (err) {
        console.error('Error creating blob from data URL:', err);
      }
    }
    setPreviewBlobUrl(finalUrl);
  };

  const handleClosePdfPreview = () => {
    if (activeBlobUrlRef.current) {
      try {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      } catch (e) {
        // ignore
      }
      activeBlobUrlRef.current = null;
    }
    setPreviewBlobUrl(null);
    setPreviewRawUrl(null);
  };

  const handleOpenInNewTab = () => {
    const targetUrl = previewBlobUrl || previewRawUrl;
    if (!targetUrl) return;
    try {
      window.open(targetUrl, '_blank');
    } catch (e) {
      console.error('Failed to open PDF in new tab:', e);
    }
  };

  const handleDownloadPdf = () => {
    const targetUrl = previewBlobUrl || previewRawUrl;
    if (!targetUrl) return;
    try {
      const a = document.createElement('a');
      a.href = targetUrl;
      a.download = previewPdfTitle.endsWith('.pdf') ? previewPdfTitle : `${previewPdfTitle}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error('Failed to download PDF:', e);
    }
  };

  // Form states
  const [awardForm, setAwardForm] = useState({
    title: '',
    givenBy: '',
    date: new Date().toISOString().split('T')[0],
    category: '',
    certificateNo: '',
    remarks: '',
  });

  const [promotionForm, setPromotionForm] = useState({
    oldDesignation: profile.designation || '',
    newDesignation: '',
    updatedAt: new Date().toISOString().split('T')[0],
    orderNo: '',
    remarks: '',
  });

  const [demotionForm, setDemotionForm] = useState({
    oldDesignation: profile.designation || '',
    newDesignation: '',
    updatedAt: new Date().toISOString().split('T')[0],
    orderNo: '',
    reason: '',
    remarks: '',
  });

  const [pmeForm, setPmeForm] = useState<{
    examDate: string;
    dueDate: string;
    medicalCategory: string;
    otherMedicalCategory: string;
    fitnessStatus: string;
    hospitalName: string;
    doctorName: string;
    certificateNo: string;
    remarks: string;
    pdfUrl?: string;
    pdfFileName?: string;
    pdfFileSize?: number;
  }>({
    examDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    medicalCategory: 'A-1',
    otherMedicalCategory: '',
    fitnessStatus: 'Fit',
    hospitalName: 'Divisional Railway Hospital',
    doctorName: '',
    certificateNo: '',
    remarks: '',
    pdfUrl: '',
    pdfFileName: '',
    pdfFileSize: 0,
  });

  // PDF Upload Handler with 1MB validation
  const handlePmePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF format is supported (केवल PDF फाइल मान्य है).');
      if (pmePdfInputRef.current) pmePdfInputRef.current.value = '';
      return;
    }

    const MAX_SIZE = 1024 * 1024; // 1 MB
    if (file.size > MAX_SIZE) {
      toast.error(`PDF size must be 1MB or less (अधिकतम 1MB). Current size: ${(file.size / 1024 / 1024).toFixed(2)} MB.`);
      if (pmePdfInputRef.current) pmePdfInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPmeForm(prev => ({
          ...prev,
          pdfUrl: reader.result as string,
          pdfFileName: file.name,
          pdfFileSize: file.size,
        }));
        toast.success(`PDF uploaded successfully: ${file.name} (${Math.round(file.size / 1024)} KB)`);
      }
    };
    reader.onerror = () => {
      toast.error('Failed to read the PDF file.');
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePmePdf = () => {
    setPmeForm(prev => ({
      ...prev,
      pdfUrl: '',
      pdfFileName: '',
      pdfFileSize: 0,
    }));
    if (pmePdfInputRef.current) pmePdfInputRef.current.value = '';
  };

  // Open Modal helpers for Add vs Edit
  const handleOpenAddAward = () => {
    setEditingAwardIndex(null);
    setAwardForm({
      title: '',
      givenBy: '',
      date: new Date().toISOString().split('T')[0],
      category: '',
      certificateNo: '',
      remarks: '',
    });
    setShowAwardModal(true);
  };

  const handleOpenEditAward = (index: number, item: AwardRecord) => {
    setEditingAwardIndex(index);
    setAwardForm({
      title: item.title || '',
      givenBy: item.givenBy || '',
      date: item.date || new Date().toISOString().split('T')[0],
      category: item.category || '',
      certificateNo: item.certificateNo || '',
      remarks: item.remarks || '',
    });
    setShowAwardModal(true);
  };

  const handleOpenAddPme = () => {
    setEditingPmeIndex(null);
    setPmeForm({
      examDate: new Date().toISOString().split('T')[0],
      dueDate: '',
      medicalCategory: 'A-1',
      otherMedicalCategory: '',
      fitnessStatus: 'Fit',
      hospitalName: 'Divisional Railway Hospital',
      doctorName: '',
      certificateNo: '',
      remarks: '',
      pdfUrl: '',
      pdfFileName: '',
      pdfFileSize: 0,
    });
    if (pmePdfInputRef.current) pmePdfInputRef.current.value = '';
    setShowPmeModal(true);
  };

  const handleOpenEditPme = (index: number, item: PmeRecord) => {
    setEditingPmeIndex(index);
    const isOther = item.medicalCategory?.startsWith('Other') || 
                    (!['A-1', 'A-2', 'A-3', 'B-1', 'B-2', 'C-1', 'C-2'].includes(item.medicalCategory));
    const otherVal = isOther 
      ? (item.otherMedicalCategory || (item.medicalCategory?.includes(' - ') ? item.medicalCategory.split(' - ')[1] : item.medicalCategory))
      : '';

    setPmeForm({
      examDate: item.examDate || new Date().toISOString().split('T')[0],
      dueDate: item.dueDate || item.nextDueDate || '',
      medicalCategory: isOther ? 'Other' : (item.medicalCategory || 'A-1'),
      otherMedicalCategory: otherVal || '',
      fitnessStatus: item.fitnessStatus || 'Fit',
      hospitalName: item.hospitalName || 'Divisional Railway Hospital',
      doctorName: item.doctorName || '',
      certificateNo: item.certificateNo || item.memoNo || '',
      remarks: item.remarks || '',
      pdfUrl: item.pdfUrl || '',
      pdfFileName: item.pdfFileName || '',
      pdfFileSize: item.pdfFileSize || 0,
    });
    if (pmePdfInputRef.current) pmePdfInputRef.current.value = '';
    setShowPmeModal(true);
  };

  // Filtered lists
  const awardsList: AwardRecord[] = profile.awards || [];
  const promotionList = (profile.designationHistory || []).filter(h => h.type === 'promotion');
  const demotionList = (profile.designationHistory || []).filter(h => h.type === 'demotion');
  const pmeList: PmeRecord[] = profile.pmeRecords || [];

  // Handlers for Submissions
  const handleSubmitAward = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (!awardForm.title.trim()) {
      toast.error('Award title is required.');
      return;
    }
    setSavingSubRecord(true);
    try {
      if (editingAwardIndex !== null && onUpdateSubRecord) {
        await onUpdateSubRecord('award', editingAwardIndex, awardForm);
      } else {
        await onSaveSubRecord('award', awardForm);
      }
      setAwardForm({
        title: '',
        givenBy: '',
        date: new Date().toISOString().split('T')[0],
        category: '',
        certificateNo: '',
        remarks: '',
      });
      setEditingAwardIndex(null);
      setShowAwardModal(false);
      setExpanded(prev => ({ ...prev, award: true }));
    } finally {
      setSavingSubRecord(false);
    }
  };

  const handleSubmitPromotion = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (!promotionForm.newDesignation.trim()) {
      toast.error('Promoted designation is required.');
      return;
    }
    setSavingSubRecord(true);
    try {
      await onSaveSubRecord('promotion', promotionForm);
      setPromotionForm({
        oldDesignation: promotionForm.newDesignation,
        newDesignation: '',
        updatedAt: new Date().toISOString().split('T')[0],
        orderNo: '',
        remarks: '',
      });
      setShowPromotionModal(false);
      setExpanded(prev => ({ ...prev, promotion: true }));
    } finally {
      setSavingSubRecord(false);
    }
  };

  const handleSubmitDemotion = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (!demotionForm.newDesignation.trim()) {
      toast.error('New designation is required.');
      return;
    }
    setSavingSubRecord(true);
    try {
      await onSaveSubRecord('demotion', demotionForm);
      setDemotionForm({
        oldDesignation: demotionForm.newDesignation,
        newDesignation: '',
        updatedAt: new Date().toISOString().split('T')[0],
        orderNo: '',
        reason: '',
        remarks: '',
      });
      setShowDemotionModal(false);
      setExpanded(prev => ({ ...prev, demotion: true }));
    } finally {
      setSavingSubRecord(false);
    }
  };

  const handleSubmitPme = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (!pmeForm.examDate) {
      toast.error('Examination Date is required.');
      return;
    }
    if (pmeForm.medicalCategory === 'Other' && !pmeForm.otherMedicalCategory.trim()) {
      toast.error('Please specify the Medical Category / Specialist (चिकित्सा श्रेणी / विशेषज्ञ विवरण भरें).');
      return;
    }
    setSavingSubRecord(true);
    try {
      const recordToSave = {
        ...pmeForm,
        medicalCategory: pmeForm.medicalCategory === 'Other'
          ? `Other - ${pmeForm.otherMedicalCategory.trim()}`
          : pmeForm.medicalCategory,
      };
      if (editingPmeIndex !== null && onUpdateSubRecord) {
        await onUpdateSubRecord('pme', editingPmeIndex, recordToSave);
      } else {
        await onSaveSubRecord('pme', recordToSave);
      }
      setPmeForm({
        examDate: new Date().toISOString().split('T')[0],
        dueDate: '',
        medicalCategory: 'A-1',
        otherMedicalCategory: '',
        fitnessStatus: 'Fit',
        hospitalName: 'Divisional Railway Hospital',
        doctorName: '',
        certificateNo: '',
        remarks: '',
        pdfUrl: '',
        pdfFileName: '',
        pdfFileSize: 0,
      });
      if (pmePdfInputRef.current) pmePdfInputRef.current.value = '';
      setEditingPmeIndex(null);
      setShowPmeModal(false);
      setExpanded(prev => ({ ...prev, pme: true }));
    } finally {
      setSavingSubRecord(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-black uppercase text-slate-800 tracking-wider flex items-center gap-2">
            <span>Career History & Others</span>
            <span className="text-slate-400 font-normal lowercase">(पुरस्कार, पदोन्नति, पदावनति एवं PME)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Click the <span className="font-bold text-indigo-600">+</span> icon on any row to expand details, view records, or add new entries.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* ============================================================== */}
        {/* 1. AWARD ROW */}
        {/* ============================================================== */}
        <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-xs transition-all duration-200">
          <div 
            onClick={() => toggleSection('award')}
            className={cn(
              "p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none transition-colors",
              expanded.award ? "bg-amber-50/50 border-b border-amber-100" : "hover:bg-slate-50/80"
            )}
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-amber-100/80 text-amber-700 flex items-center justify-center shrink-0 shadow-xs">
                <Award size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h4 className="text-sm font-black text-slate-900 tracking-wide">Award & Honors</h4>
                  <span className="text-xs font-semibold text-slate-500 hidden sm:inline">(पुरस्कार एवं सम्मान)</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 font-mono">
                    {awardsList.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Railway medals, general manager awards, citations, and official honors.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSection('award');
                }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer",
                  expanded.award ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
                aria-label={expanded.award ? "Collapse award details" : "Expand award details"}
              >
                {expanded.award ? <Minus size={16} /> : <Plus size={16} />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {expanded.award && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 sm:p-6 bg-slate-50/40 space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                  <h5 className="text-xs font-black uppercase text-amber-900 tracking-wider">
                    Award Details & Records (पुरस्कार विवरण)
                  </h5>
                  {awardsList.length > 0 && canManageAwards && (
                    <button
                      type="button"
                      onClick={handleOpenAddAward}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all shadow-xs"
                    >
                      <Plus size={14} /> Add Award
                    </button>
                  )}
                </div>

                {awardsList.length === 0 ? (
                  <div className="p-6 text-center bg-white rounded-xl border border-dashed border-slate-200">
                    <Award size={28} className="mx-auto text-amber-400 mb-2 opacity-80" />
                    <p className="text-xs font-bold text-slate-700">No awards recorded yet</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {canManageAwards 
                        ? 'Click below to record an award, certificate, or commendation.'
                        : 'Official awards and honors are conferred and recorded by administration.'}
                    </p>
                    {canManageAwards && (
                      <button
                        type="button"
                        onClick={handleOpenAddAward}
                        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-all shadow-xs"
                      >
                        <Plus size={14} /> Add Award Record
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {awardsList.map((item, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs relative group">
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex items-center gap-2">
                            <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600 border border-amber-100">
                              <Award size={16} />
                            </span>
                            <div>
                              <h6 className="text-xs font-black text-slate-900 leading-snug">{item.title}</h6>
                              {item.category && (
                                <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                  {item.category}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {canEditData && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditAward(idx, item)}
                                className="text-slate-400 hover:text-amber-600 p-1 rounded transition-colors"
                                title="Edit Award (संपादित करें)"
                              >
                                <Edit3 size={14} />
                              </button>
                            )}
                            {canManageAwards && (
                              <button
                                type="button"
                                onClick={() => onDeleteSubRecord('award', idx)}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                                title="Remove Award"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-2.5 pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-slate-400 text-[10px] block">Issued By:</span>
                            <span className="font-semibold text-slate-700">{item.givenBy || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 text-[10px] block">Award Date:</span>
                            <span className="font-semibold text-slate-700">{formatDateToDDMMYYYY(item.date) || 'N/A'}</span>
                          </div>
                          {item.certificateNo && (
                            <div className="col-span-2">
                              <span className="text-slate-400 text-[10px] block">Certificate/Ref No:</span>
                              <span className="font-mono font-semibold text-indigo-700 bg-indigo-50/50 px-1.5 py-0.5 rounded text-[10px]">
                                {item.certificateNo}
                              </span>
                            </div>
                          )}
                          {item.remarks && (
                            <div className="col-span-2 mt-1 bg-slate-50 p-2 rounded text-slate-600 text-[11px] italic">
                              "{item.remarks}"
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ============================================================== */}
        {/* 2. PROMOTION ROW */}
        {/* ============================================================== */}
        <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-xs transition-all duration-200">
          <div 
            onClick={() => toggleSection('promotion')}
            className={cn(
              "p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none transition-colors",
              expanded.promotion ? "bg-emerald-50/50 border-b border-emerald-100" : "hover:bg-slate-50/80"
            )}
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center shrink-0 shadow-xs">
                <TrendingUp size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h4 className="text-sm font-black text-slate-900 tracking-wide">Promotion</h4>
                  <span className="text-xs font-semibold text-slate-500 hidden sm:inline">(पदोन्नति विवरण)</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 font-mono">
                    {promotionList.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Designation elevation, grade pay enhancement, and official promotion orders.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSection('promotion');
                }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer",
                  expanded.promotion ? "bg-emerald-200 text-emerald-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
                aria-label={expanded.promotion ? "Collapse promotion details" : "Expand promotion details"}
              >
                {expanded.promotion ? <Minus size={16} /> : <Plus size={16} />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {expanded.promotion && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 sm:p-6 bg-slate-50/40 space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                  <h5 className="text-xs font-black uppercase text-emerald-900 tracking-wider">
                    Promotion Records & Progression (पदोन्नति इतिहास)
                  </h5>
                  {promotionList.length > 0 && canManageAdminRecords && (
                    <button
                      type="button"
                      onClick={() => setShowPromotionModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs"
                    >
                      <Plus size={14} /> Add Promotion
                    </button>
                  )}
                </div>

                {promotionList.length === 0 ? (
                  <div className="p-6 text-center bg-white rounded-xl border border-dashed border-slate-200">
                    <TrendingUp size={28} className="mx-auto text-emerald-400 mb-2 opacity-80" />
                    <p className="text-xs font-bold text-slate-700">No promotion records found</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {canManageAdminRecords 
                        ? 'Click below to record a promotion with order details.'
                        : 'Official promotions and career progression are recorded by administration.'}
                    </p>
                    {canManageAdminRecords && (
                      <button
                        type="button"
                        onClick={() => setShowPromotionModal(true)}
                        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all shadow-xs"
                      >
                        <Plus size={14} /> Add Promotion Record
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {promotionList.map((item, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs relative">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="p-1 rounded-md bg-emerald-50 text-emerald-700 font-black text-xs">
                              {item.oldDesignation}
                            </span>
                            <span className="text-emerald-500 font-bold">➔</span>
                            <span className="p-1 rounded-md bg-emerald-100 text-emerald-900 font-black text-xs">
                              {item.newDesignation}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] font-semibold text-slate-500">
                              Effective: <strong className="text-slate-800">{formatDateToDDMMYYYY(item.updatedAt) || 'N/A'}</strong>
                            </span>
                            {canManageAdminRecords && (
                              <button
                                type="button"
                                onClick={() => {
                                  const originalIdx = (profile.designationHistory || []).indexOf(item);
                                  if (originalIdx !== -1) onDeleteSubRecord('history', originalIdx);
                                }}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                                title="Remove Record"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        {(item.orderNo || item.remarks) && (
                          <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-4 text-[11px]">
                            {item.orderNo && (
                              <div>
                                <span className="text-slate-400 text-[10px]">Order No: </span>
                                <span className="font-mono font-semibold text-indigo-700 bg-indigo-50/60 px-1.5 py-0.5 rounded text-[10px]">
                                  {item.orderNo}
                                </span>
                              </div>
                            )}
                            {item.remarks && (
                              <div className="text-slate-600 text-[11px]">
                                <span className="text-slate-400 text-[10px]">Remarks: </span>
                                {item.remarks}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ============================================================== */}
        {/* 3. DEMOTION ROW */}
        {/* ============================================================== */}
        <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-xs transition-all duration-200">
          <div 
            onClick={() => toggleSection('demotion')}
            className={cn(
              "p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none transition-colors",
              expanded.demotion ? "bg-rose-50/50 border-b border-rose-100" : "hover:bg-slate-50/80"
            )}
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-100/80 text-rose-700 flex items-center justify-center shrink-0 shadow-xs">
                <TrendingDown size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h4 className="text-sm font-black text-slate-900 tracking-wide">Demotion</h4>
                  <span className="text-xs font-semibold text-slate-500 hidden sm:inline">(पदावनति विवरण)</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 font-mono">
                    {demotionList.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Administrative reversion, disciplinary adjustments, or designation downgrades.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSection('demotion');
                }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer",
                  expanded.demotion ? "bg-rose-200 text-rose-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
                aria-label={expanded.demotion ? "Collapse demotion details" : "Expand demotion details"}
              >
                {expanded.demotion ? <Minus size={16} /> : <Plus size={16} />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {expanded.demotion && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 sm:p-6 bg-slate-50/40 space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                  <h5 className="text-xs font-black uppercase text-rose-900 tracking-wider">
                    Demotion Records (पदावनति विवरण)
                  </h5>
                  {demotionList.length > 0 && canManageAdminRecords && (
                    <button
                      type="button"
                      onClick={() => setShowDemotionModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-xs"
                    >
                      <Plus size={14} /> Add Demotion
                    </button>
                  )}
                </div>

                {demotionList.length === 0 ? (
                  <div className="p-6 text-center bg-white rounded-xl border border-dashed border-slate-200">
                    <CheckCircle size={28} className="mx-auto text-emerald-500 mb-2 opacity-80" />
                    <p className="text-xs font-bold text-slate-700">No demotion records found</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Clean service career record with no adverse demotions recorded.</p>
                    {canManageAdminRecords && (
                      <button
                        type="button"
                        onClick={() => setShowDemotionModal(true)}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
                      >
                        <Plus size={13} /> Record Entry (If applicable)
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {demotionList.map((item, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-rose-200/80 shadow-2xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="p-1 rounded-md bg-slate-100 text-slate-700 font-black text-xs">
                              {item.oldDesignation}
                            </span>
                            <span className="text-rose-500 font-bold">➔</span>
                            <span className="p-1 rounded-md bg-rose-100 text-rose-900 font-black text-xs">
                              {item.newDesignation}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] font-semibold text-slate-500">
                              Order Date: <strong className="text-slate-800">{formatDateToDDMMYYYY(item.updatedAt) || 'N/A'}</strong>
                            </span>
                            {canManageAdminRecords && (
                              <button
                                type="button"
                                onClick={() => {
                                  const originalIdx = (profile.designationHistory || []).indexOf(item);
                                  if (originalIdx !== -1) onDeleteSubRecord('history', originalIdx);
                                }}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                                title="Remove Record"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        {(item.orderNo || item.reason || item.remarks) && (
                          <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-4 text-[11px]">
                            {item.orderNo && (
                              <div>
                                <span className="text-slate-400 text-[10px]">Order No: </span>
                                <span className="font-mono font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded text-[10px]">
                                  {item.orderNo}
                                </span>
                              </div>
                            )}
                            {item.reason && (
                              <div className="text-slate-700">
                                <span className="text-slate-400 text-[10px]">Reason: </span>
                                <strong>{item.reason}</strong>
                              </div>
                            )}
                            {item.remarks && (
                              <div className="text-slate-500 italic">
                                ({item.remarks})
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ============================================================== */}
        {/* 4. PME - PERIODIC MEDICAL EXAMINATION ROW */}
        {/* ============================================================== */}
        <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-xs transition-all duration-200">
          <div 
            onClick={() => toggleSection('pme')}
            className={cn(
              "p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none transition-colors",
              expanded.pme ? "bg-cyan-50/50 border-b border-cyan-100" : "hover:bg-slate-50/80"
            )}
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-cyan-100/80 text-cyan-700 flex items-center justify-center shrink-0 shadow-xs">
                <Stethoscope size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h4 className="text-sm font-black text-slate-900 tracking-wide">
                    Periodic Medical Examination (PME)
                  </h4>
                  <span className="text-xs font-semibold text-slate-500 hidden sm:inline">(आवधिक चिकित्सा परीक्षण)</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-100 text-cyan-800 font-mono">
                    {pmeList.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Medical category fitness, vision certification, CMS memos, and next due dates.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSection('pme');
                }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer",
                  expanded.pme ? "bg-cyan-200 text-cyan-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
                aria-label={expanded.pme ? "Collapse PME details" : "Expand PME details"}
              >
                {expanded.pme ? <Minus size={16} /> : <Plus size={16} />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {expanded.pme && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 sm:p-6 bg-slate-50/40 space-y-4"
              >
                {/* PME Due Warning Notice if PME is Due */}
                {pmeStatus.isDue && (
                  <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-3 text-rose-900 shadow-2xs">
                    <div className="flex items-center gap-2.5">
                      <AlertCircle size={20} className="text-rose-600 shrink-0 animate-pulse" />
                      <div>
                        <p className="text-xs font-black text-rose-900">
                          🚨 PME Due Notice (आवधिक चिकित्सा परीक्षा नियत है): Scheduled on {formatDateToDDMMYYYY(pmeStatus.dueDate)}
                        </p>
                        <p className="text-[11px] text-rose-700 font-medium mt-0.5">
                          {pmeStatus.daysRemaining !== undefined && pmeStatus.daysRemaining <= 0
                            ? 'Your Periodic Medical Examination is currently due/overdue. Please attend checkup as per Indian Railways safety norms.'
                            : `Your Periodic Medical Examination is due in ${pmeStatus.daysRemaining} days. Please report to Railway Hospital.`}
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white shrink-0">
                      Due Notice
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                  <h5 className="text-xs font-black uppercase text-cyan-950 tracking-wider">
                    Periodic Medical Examination (PME) Records (PME विवरण)
                  </h5>
                  {pmeList.length > 0 && (
                    <button
                      type="button"
                      onClick={handleOpenAddPme}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-700 hover:to-indigo-700 text-white text-xs font-bold transition-all shadow-xs"
                    >
                      <Plus size={14} /> Add My PME (PME जोड़ें)
                    </button>
                  )}
                </div>

                {pmeList.length === 0 ? (
                  <div className="p-8 text-center bg-white rounded-xl border border-dashed border-cyan-200">
                    <Stethoscope size={32} className="mx-auto text-cyan-500 mb-2 opacity-80" />
                    <h5 className="text-xs font-black text-slate-800">No PME records submitted yet</h5>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                      Whenever you undergo your Periodic Medical Examination at Railway Hospital, click the button below to record your examination date, fitness category, and memo details.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenAddPme}
                      className="mt-3.5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-700 hover:to-indigo-700 text-white text-xs font-bold transition-all shadow-md shadow-cyan-600/20"
                    >
                      <Plus size={15} /> + Add My PME (अपना PME विवरण जोड़ें)
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pmeList.map((item, idx) => (
                      <div key={idx} className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/90 shadow-2xs">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-black font-mono bg-cyan-100 text-cyan-900 border border-cyan-200">
                                Category: {item.medicalCategory}
                              </span>

                              <span className={cn(
                                "px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center gap-1",
                                item.fitnessStatus === 'Fit' ? "bg-emerald-100 text-emerald-800 border border-emerald-200" :
                                item.fitnessStatus === 'Fit with Glasses' ? "bg-amber-100 text-amber-800 border border-amber-200" :
                                "bg-rose-100 text-rose-800 border border-rose-200"
                              )}>
                                {item.fitnessStatus === 'Fit' && <CheckCircle size={12} />}
                                {item.fitnessStatus === 'Fit with Glasses' && <Eye size={12} />}
                                {item.fitnessStatus !== 'Fit' && item.fitnessStatus !== 'Fit with Glasses' && <AlertTriangle size={12} />}
                                <span>{item.fitnessStatus}</span>
                              </span>

                              {item.certificateNo && (
                                <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                  Memo: {item.certificateNo}
                                </span>
                              )}

                              {item.pdfUrl && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleOpenPdfPreview(
                                      item.pdfUrl!,
                                      item.pdfFileName || `PME Memo ${item.certificateNo || item.examDate}`
                                    );
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors shadow-2xs cursor-pointer"
                                  title="View Uploaded PDF Document"
                                >
                                  <FileText size={12} />
                                  <span>View Memo PDF</span>
                                </button>
                              )}
                            </div>

                            <p className="text-xs text-slate-800 font-bold mt-1">
                              {item.hospitalName || 'Railway Hospital / Health Unit'}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="text-left sm:text-right text-[11px]">
                              <span className="text-slate-400 block text-[10px]">Examined On</span>
                              <strong className="text-slate-800">{formatDateToDDMMYYYY(item.examDate) || 'N/A'}</strong>
                              {item.dueDate && (
                                <span className="block text-[10px] text-amber-700 font-semibold mt-0.5">
                                  Next Due: {formatDateToDDMMYYYY(item.dueDate)}
                                </span>
                              )}
                            </div>
                            {canEditData && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditPme(idx, item)}
                                className="text-slate-400 hover:text-cyan-600 p-1.5 rounded transition-colors self-start"
                                title="Edit PME Record (संपादित करें)"
                              >
                                <Edit3 size={15} />
                              </button>
                            )}
                            {canDeletePme && (
                              <button
                                type="button"
                                onClick={() => onDeleteSubRecord('pme', idx)}
                                className="text-slate-400 hover:text-rose-600 p-1.5 rounded transition-colors self-start"
                                title="Delete PME Record"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>

                        {(item.doctorName || item.remarks) && (
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                            {item.doctorName && (
                              <div className="text-slate-600">
                                <span className="text-slate-400 text-[10px] block">Examining Doctor:</span>
                                <span className="font-semibold text-slate-800">{item.doctorName}</span>
                              </div>
                            )}
                            {item.remarks && (
                              <div className="text-slate-600 flex-1">
                                <span className="text-slate-400 text-[10px] block">Doctor's Remarks / Power:</span>
                                <span className="italic text-slate-700">{item.remarks}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ============================================================== */}
        {/* 5. PREVIOUS EMPLOYMENT RECORDS (Read-only if available) */}
        {/* ============================================================== */}
        {profile.employmentHistory && profile.employmentHistory.length > 0 && (
          <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-black uppercase text-amber-900 tracking-wider flex items-center gap-2">
              <History size={16} className="text-amber-600" /> Previous Employment Records (PF-Matched)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {profile.employmentHistory.map((history, hIdx) => (
                <div key={hIdx} className="bg-amber-50/40 p-3.5 rounded-xl border border-amber-200/40 flex justify-between items-center">
                  <div>
                    <p className="text-xs font-black text-amber-950">{history.companyName}</p>
                    <p className="text-[11px] text-slate-600 font-semibold mt-0.5">{history.designation}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded font-bold block mb-1">
                      Left
                    </span>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {formatDateToDDMMYYYY(history.doj)} to {formatDateToDDMMYYYY(history.leftDate) || 'Present'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* MODAL: ADD AWARD */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showAwardModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 max-w-4xl w-full overflow-hidden my-8"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-amber-50/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-amber-100 text-amber-700">
                    <Award size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">
                      {editingAwardIndex !== null
                        ? 'Edit Award & Honors (पुरस्कार एवं सम्मान संपादित करें)'
                        : 'Add Award & Honors (पुरस्कार एवं सम्मान जोड़ें)'}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {editingAwardIndex !== null
                        ? 'पुरस्कार, प्रशस्ति पत्र एवं सम्मान विवरण को अपडेट करें'
                        : 'पुरस्कार, प्रशस्ति पत्र एवं सम्मान विवरण दर्ज करें'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAwardModal(false);
                    setEditingAwardIndex(null);
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div 
                className="p-6 space-y-4"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                    e.preventDefault();
                    handleSubmitAward(e);
                  }
                }}
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-700">Award Title (पुरस्कार का नाम) *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. General Manager Safety Award 2024"
                      value={awardForm.title}
                      onChange={e => setAwardForm({ ...awardForm, title: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Category / Level (श्रेणी / स्तर)</label>
                    <input
                      type="text"
                      placeholder="e.g. Zonal / Divisional / Ministry"
                      value={awardForm.category}
                      onChange={e => setAwardForm({ ...awardForm, category: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Issued By / Authority (प्रदानकर्ता)</label>
                    <input
                      type="text"
                      placeholder="e.g. GM, West Central Railway"
                      value={awardForm.givenBy}
                      onChange={e => setAwardForm({ ...awardForm, givenBy: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Award Date (प्राप्ति तिथि)</label>
                    <input
                      type="date"
                      value={awardForm.date}
                      onChange={e => setAwardForm({ ...awardForm, date: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Certificate / Citation No.</label>
                    <input
                      type="text"
                      placeholder="e.g. WCR/AWD/2024/45"
                      value={awardForm.certificateNo}
                      onChange={e => setAwardForm({ ...awardForm, certificateNo: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-3">
                    <label className="text-xs font-bold text-slate-700">Remarks / Citation Description (प्रशस्ति पत्र विवरण)</label>
                    <textarea
                      rows={2}
                      placeholder="Details about the contribution or work for which the award was conferred..."
                      value={awardForm.remarks}
                      onChange={e => setAwardForm({ ...awardForm, remarks: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAwardModal(false);
                      setEditingAwardIndex(null);
                    }}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitAward}
                    disabled={savingSubRecord}
                    className="px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    {savingSubRecord ? <Loader2 size={14} className="animate-spin" /> : <Award size={14} />}
                    <span>{editingAwardIndex !== null ? 'Update Award Record' : 'Save Award Record'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============================================================== */}
      {/* MODAL: ADD PROMOTION */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showPromotionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 max-w-4xl w-full overflow-hidden my-8"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-emerald-50/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                    <TrendingUp size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Add Promotion Record (पदोन्नति रिकॉर्ड जोड़ें)</h3>
                    <p className="text-[11px] text-slate-500">पदोन्नति, नया पद एवं कार्यालय आदेश विवरण दर्ज करें</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPromotionModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div 
                className="p-6 space-y-4"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                    e.preventDefault();
                    handleSubmitPromotion(e);
                  }
                }}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Previous / Current Designation (वर्तमान पद)</label>
                    <input
                      type="text"
                      placeholder="e.g. Technician Gr. II"
                      value={promotionForm.oldDesignation}
                      onChange={e => setPromotionForm({ ...promotionForm, oldDesignation: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Promoted Designation (पदोन्नत नया पद) *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Technician Gr. I"
                      value={promotionForm.newDesignation}
                      onChange={e => setPromotionForm({ ...promotionForm, newDesignation: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Effective Date (पदोन्नति प्रभावी तिथि) *</label>
                    <input
                      type="date"
                      value={promotionForm.updatedAt}
                      onChange={e => setPromotionForm({ ...promotionForm, updatedAt: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Office Order / Memo No. (कार्यालय आदेश संख्या)</label>
                    <input
                      type="text"
                      placeholder="e.g. WCR/P/HQ/PROM/2024"
                      value={promotionForm.orderNo}
                      onChange={e => setPromotionForm({ ...promotionForm, orderNo: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-700">Remarks / Pay Level (टिप्पणी / वेतन स्तर)</label>
                    <input
                      type="text"
                      placeholder="e.g. Level-5 / Grade Pay 2800 / Matrix Cell 3"
                      value={promotionForm.remarks}
                      onChange={e => setPromotionForm({ ...promotionForm, remarks: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowPromotionModal(false)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitPromotion}
                    disabled={savingSubRecord}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    {savingSubRecord ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                    <span>Save Promotion Record</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============================================================== */}
      {/* MODAL: ADD DEMOTION */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showDemotionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 max-w-4xl w-full overflow-hidden my-8"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-rose-50/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-rose-100 text-rose-700">
                    <TrendingDown size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Add Demotion Record (पदावनति विवरण दर्ज करें)</h3>
                    <p className="text-[11px] text-slate-500">प्रशासनिक या अनुशासनात्मक पदावनति आदेश विवरण</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDemotionModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div 
                className="p-6 space-y-4"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                    e.preventDefault();
                    handleSubmitDemotion(e);
                  }
                }}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Previous Designation (पूर्व पद)</label>
                    <input
                      type="text"
                      placeholder="e.g. Senior Section Engineer"
                      value={demotionForm.oldDesignation}
                      onChange={e => setDemotionForm({ ...demotionForm, oldDesignation: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">New Designation (पदावनत नया पद) *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Junior Engineer"
                      value={demotionForm.newDesignation}
                      onChange={e => setDemotionForm({ ...demotionForm, newDesignation: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Effective Date (प्रभावी तिथि) *</label>
                    <input
                      type="date"
                      value={demotionForm.updatedAt}
                      onChange={e => setDemotionForm({ ...demotionForm, updatedAt: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Order / Case No. (आदेश / प्रकरण संख्या)</label>
                    <input
                      type="text"
                      placeholder="e.g. ADM/DISC/2024/09"
                      value={demotionForm.orderNo}
                      onChange={e => setDemotionForm({ ...demotionForm, orderNo: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-700">Reason / Reference (पदावनति का कारण / संदर्भ)</label>
                    <input
                      type="text"
                      placeholder="e.g. Administrative restructuring / Disciplinary action"
                      value={demotionForm.reason}
                      onChange={e => setDemotionForm({ ...demotionForm, reason: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-700">Remarks (टिप्पणी)</label>
                    <textarea
                      rows={2}
                      placeholder="Additional context or official remarks..."
                      value={demotionForm.remarks}
                      onChange={e => setDemotionForm({ ...demotionForm, remarks: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 resize-none"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowDemotionModal(false)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitDemotion}
                    disabled={savingSubRecord}
                    className="px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    {savingSubRecord ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                    <span>Save Demotion Record</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============================================================== */}
      {/* MODAL: ADD PME (PERIODIC MEDICAL EXAMINATION) */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showPmeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-4xl lg:max-w-5xl w-full overflow-hidden my-6"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-cyan-50/80">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-cyan-100 text-cyan-700">
                    <Stethoscope size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900">
                      {editingPmeIndex !== null
                        ? 'Edit PME Record (आवधिक चिकित्सा परीक्षण विवरण संपादित करें)'
                        : 'Add PME Record (आवधिक चिकित्सा परीक्षण विवरण दर्ज करें)'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {editingPmeIndex !== null
                        ? 'PME फिटनेस, चिकित्सा श्रेणी एवं सर्टिफिकेट PDF विवरण अपडेट करें'
                        : 'Periodic Medical Examination Fitness, Medical Category & Certificate PDF'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPmeModal(false);
                    setEditingPmeIndex(null);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div 
                className="p-6 sm:p-7 space-y-5"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'file') {
                    e.preventDefault();
                    handleSubmitPme(e);
                  }
                }}
              >
                {/* Row 1: Dates & Medical Category */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Calendar size={13} className="text-cyan-600" />
                      <span>Examination Date (परीक्षण तिथि) *</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={pmeForm.examDate}
                      onChange={e => setPmeForm({ ...pmeForm, examDate: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Clock size={13} className="text-amber-600" />
                      <span>Next Due Date (अगली नियत तिथि)</span>
                    </label>
                    <input
                      type="date"
                      value={pmeForm.dueDate}
                      onChange={e => setPmeForm({ ...pmeForm, dueDate: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <ShieldCheck size={13} className="text-indigo-600" />
                      <span>Medical Category (चिकित्सा श्रेणी) *</span>
                    </label>
                    <select
                      value={pmeForm.medicalCategory}
                      onChange={e => setPmeForm({ ...pmeForm, medicalCategory: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-white"
                    >
                      <option value="A-1">A-1 (Running / Track Machine Operator)</option>
                      <option value="A-2">A-2 (Safety / Station Master / Shunting)</option>
                      <option value="A-3">A-3 (Loco / Workshop / Maintenance)</option>
                      <option value="B-1">B-1 (Electrical / Mechanical Maintenance)</option>
                      <option value="B-2">B-2 (Technical Supervisors / Depot)</option>
                      <option value="C-1">C-1 (Clerical / Office / Store)</option>
                      <option value="C-2">C-2 (Administrative Staff)</option>
                      <option value="Other">Other / Specialist (अन्य / विशेषज्ञ)</option>
                    </select>
                  </div>
                </div>

                {/* Conditional Field: Other / Specialist Medical Category */}
                {pmeForm.medicalCategory === 'Other' && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-cyan-50/70 border border-cyan-200 rounded-xl space-y-1.5"
                  >
                    <label className="text-xs font-bold text-cyan-900 flex items-center gap-1.5">
                      <Stethoscope size={14} className="text-cyan-700" />
                      <span>Specify Other / Specialist Medical Category (चिकित्सा श्रेणी / विशेषज्ञ विवरण लिखें) *</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Eye Specialist Certification (A-1 Relaxed / B-1 Special / Cardiology Fit)"
                      value={pmeForm.otherMedicalCategory}
                      onChange={e => setPmeForm({ ...pmeForm, otherMedicalCategory: e.target.value })}
                      className="w-full border border-cyan-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 bg-white outline-none focus:ring-2 focus:ring-cyan-600/20 focus:border-cyan-600"
                    />
                    <p className="text-[11px] text-cyan-700">
                      When Other / Specialist is selected, please specify the exact category or special recommendation.
                    </p>
                  </motion.div>
                )}

                {/* Row 2: Fitness Status, Hospital & Doctor */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <CheckCircle size={13} className="text-emerald-600" />
                      <span>Fitness Status (योग्यता स्थिति) *</span>
                    </label>
                    <select
                      value={pmeForm.fitnessStatus}
                      onChange={e => setPmeForm({ ...pmeForm, fitnessStatus: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-white"
                    >
                      <option value="Fit">Fit (पूर्णतः योग्य)</option>
                      <option value="Fit with Glasses">Fit with Glasses (चश्मे के साथ योग्य)</option>
                      <option value="Temporarily Unfit">Temporarily Unfit (अस्थायी अयोग्य)</option>
                      <option value="Unfit">Unfit (अयोग्य)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-500" />
                      <span>Hospital / Health Unit Name (अस्पताल का नाम)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Divisional Railway Hospital Jabalpur"
                      value={pmeForm.hospitalName}
                      onChange={e => setPmeForm({ ...pmeForm, hospitalName: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Examining Doctor / CMS Name (परीक्षणकर्ता चिकित्सक)</label>
                    <input
                      type="text"
                      placeholder="e.g. Dr. A. K. Verma, ACMS / CMS"
                      value={pmeForm.doctorName}
                      onChange={e => setPmeForm({ ...pmeForm, doctorName: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                    />
                  </div>
                </div>

                {/* Row 3: Certificate Memo No. and PDF Upload & View */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Fitness Memo / Certificate No. (मेमो / प्रमाण पत्र संख्या)</label>
                    <input
                      type="text"
                      placeholder="e.g. MED/FIT/PME/2024/782"
                      value={pmeForm.certificateNo}
                      onChange={e => setPmeForm({ ...pmeForm, certificateNo: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                    />
                  </div>

                  {/* PDF Upload Option (Up to 1MB) with View before Save */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <FileText size={13} className="text-indigo-600" />
                        <span>PME Certificate PDF (प्रमाण पत्र पीडीएफ - अधिकतम 1MB)</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">Max 1 MB</span>
                    </label>

                    <input
                      ref={pmePdfInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={handlePmePdfUpload}
                      className="hidden"
                    />

                    {pmeForm.pdfUrl ? (
                      <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800 shrink-0">
                            <FileCheck size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-emerald-950 truncate max-w-[200px] sm:max-w-xs">
                              {pmeForm.pdfFileName || 'PME_Certificate.pdf'}
                            </p>
                            <p className="text-[10px] text-emerald-700 font-semibold">
                              {pmeForm.pdfFileSize ? `${Math.round(pmeForm.pdfFileSize / 1024)} KB` : 'Ready to save'} • Ready for verification
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {/* View PDF Before Save Button */}
                          <button
                            type="button"
                            onClick={() => {
                              if (pmeForm.pdfUrl) {
                                handleOpenPdfPreview(pmeForm.pdfUrl, pmeForm.pdfFileName || 'PME Certificate Preview');
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                            title="Preview PDF Document Before Saving"
                          >
                            <Eye size={13} />
                            <span>View PDF (देखें)</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleRemovePmePdf}
                            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Remove uploaded PDF"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => pmePdfInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-slate-300 hover:border-cyan-500 hover:bg-cyan-50/30 rounded-xl p-3 text-center transition-all flex items-center justify-center gap-2 group cursor-pointer"
                      >
                        <UploadCloud size={18} className="text-slate-400 group-hover:text-cyan-600 transition-colors" />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-cyan-900">
                          Upload PME PDF (अधिकतम 1 MB)
                        </span>
                        <span className="text-[10px] text-slate-400">(.pdf only)</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Row 4: Remarks / Vision Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Doctor Remarks / Glasses Power / Vision Notes (डॉक्टर की टिप्पणी / दृष्टि विवरण)</label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Distance Vision: 6/6 with glasses; Near Vision: D-0.6; Fit for track machine operations."
                    value={pmeForm.remarks}
                    onChange={e => setPmeForm({ ...pmeForm, remarks: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 resize-none"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div className="text-[11px] text-slate-400">
                    {pmeForm.pdfUrl && (
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle size={12} /> PDF Attached (Save से पहले view करें)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowPmeModal(false);
                        setEditingPmeIndex(null);
                      }}
                      className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitPme}
                      disabled={savingSubRecord}
                      className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-cyan-600/20 disabled:opacity-50"
                    >
                      {savingSubRecord ? <Loader2 size={15} className="animate-spin" /> : <Stethoscope size={15} />}
                      <span>
                        {editingPmeIndex !== null
                          ? 'Update PME Record (PME अपडेट करें)'
                          : 'Save PME Record (PME सुरक्षित करें)'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============================================================== */}
      {/* FULL PDF PREVIEW MODAL */}
      {/* ============================================================== */}
      <AnimatePresence>
        {previewBlobUrl && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl lg:max-w-5xl w-full overflow-hidden flex flex-col max-h-[92vh]"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">{previewPdfTitle}</h3>
                    <p className="text-[11px] text-slate-500">PME Certificate / Medical Fitness Document Preview</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenInNewTab}
                    className="p-1.5 rounded-lg text-slate-700 hover:text-indigo-600 hover:bg-slate-100 text-xs font-bold inline-flex items-center gap-1.5 border border-slate-200 px-2.5 transition-colors cursor-pointer"
                    title="Open in new browser tab"
                  >
                    <ExternalLink size={14} />
                    <span>Open in New Tab</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    className="p-1.5 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-800 text-xs font-bold inline-flex items-center gap-1.5 border border-indigo-200 px-2.5 transition-colors cursor-pointer"
                    title="Download PDF"
                  >
                    <Download size={14} />
                    <span>Download</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClosePdfPreview}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="p-4 flex-1 bg-slate-100 min-h-[460px] flex flex-col">
                {/* Fallback Notice Bar */}
                <div className="mb-3 bg-amber-50 border border-amber-200/80 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs text-amber-950">
                  <div className="flex items-center gap-2">
                    <span className="text-base">💡</span>
                    <p className="font-semibold text-amber-900">
                      Chrome Security Note: If Chrome restricts embedded in-frame PDF preview, click to open directly in a new tab or download:
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleOpenInNewTab}
                      className="px-3 py-1.5 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg text-xs font-bold text-amber-900 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                    >
                      <ExternalLink size={13} />
                      <span>Open in Tab</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Download size={13} />
                      <span>Download</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 w-full bg-white rounded-xl border border-slate-200 overflow-hidden shadow-inner flex flex-col min-h-[500px]">
                  <object
                    data={`${previewBlobUrl}#toolbar=1&navpanes=0`}
                    type="application/pdf"
                    className="w-full h-full min-h-[500px] flex-1"
                  >
                    <iframe
                      src={`${previewBlobUrl}#toolbar=1`}
                      className="w-full h-full min-h-[500px] border-0"
                      title="PDF Preview"
                    />
                  </object>
                </div>
              </div>

              <div className="px-6 py-3 border-t border-slate-100 bg-white flex justify-end">
                <button
                  type="button"
                  onClick={handleClosePdfPreview}
                  className="px-5 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Close Preview (बंद करें)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
