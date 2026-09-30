import React, { useRef, useState } from 'react';
import { X, Printer, Download, Sparkles, Award, PartyPopper, Mail, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { RMMSLogo } from './RMMSLogo';
import { EmployeeProfile } from '../utils/employee';
import { sendEmployeeBirthdayCertificateNow, resolveEmployeeRealEmail } from '../utils/birthdayAndPmeService';

interface BirthdayCertificateModalProps {
  profile: EmployeeProfile;
  isOpen: boolean;
  onClose: () => void;
}

export function BirthdayCertificateModal({
  profile,
  isOpen,
  onClose
}: BirthdayCertificateModalProps) {
  const certificateRef = useRef<HTMLDivElement>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  if (!isOpen) return null;

  const realEmail = resolveEmployeeRealEmail(profile);

  const todayDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const handlePrint = () => {
    window.print();
  };

  const handleSendEmail = async () => {
    setSendingEmail(true);
    try {
      const res = await sendEmployeeBirthdayCertificateNow(profile);
      if (res.success) {
        setEmailSent(true);
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to dispatch certificate email.');
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in">
      <div className="relative w-full max-w-3xl my-6 bg-white rounded-3xl shadow-2xl border border-amber-200 overflow-hidden">
        
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-700 text-white shadow-md">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-xl">
              <PartyPopper size={20} className="text-yellow-200 animate-bounce" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-wide">
                Official Birthday Celebration Certificate
              </h3>
              <p className="text-xs text-amber-100 font-medium">
                भारतीय रेल • जन्मदिन सम्मान प्रमाण पत्र
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-all shadow-xs"
              title="Print Certificate"
            >
              <Printer size={15} />
              <span className="hidden sm:inline">Print / Save PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-white/20 text-white transition-colors"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Certificate Container (Optimized for Screen & Print) */}
        <div className="p-6 sm:p-10 bg-slate-50 flex justify-center">
          <div
            ref={certificateRef}
            id="printable-birthday-certificate"
            className="w-full max-w-2xl bg-white border-8 border-double border-amber-500/80 rounded-2xl p-6 sm:p-10 text-center shadow-lg relative overflow-hidden print:border-amber-600 print:shadow-none print:m-0"
          >
            {/* Watermark Crest Background */}
            <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none select-none">
              <span className="text-[180px] font-serif font-bold text-amber-900">IR</span>
            </div>

            {/* Corner Decorative Ornaments */}
            <div className="absolute top-3 left-3 text-amber-600 font-serif text-xl select-none">✦</div>
            <div className="absolute top-3 right-3 text-amber-600 font-serif text-xl select-none">✦</div>
            <div className="absolute bottom-3 left-3 text-amber-600 font-serif text-xl select-none">✦</div>
            <div className="absolute bottom-3 right-3 text-amber-600 font-serif text-xl select-none">✦</div>

            {/* Header / Crest */}
            <div className="flex flex-col items-center mb-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 border-2 border-amber-300 p-2 shadow-xs flex items-center justify-center mb-2">
                <RMMSLogo variant="icon" className="w-full h-full object-contain" />
              </div>
              <span className="text-xs font-black uppercase tracking-widest text-slate-800">
                INDIAN RAILWAYS • भारतीय रेल
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                Railway Machine Management System (RMMS)
              </span>
            </div>

            {/* Certificate Title */}
            <div className="my-3">
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-amber-900 font-serif">
                Certificate of Birthday Celebration
              </h1>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mt-0.5">
                जन्मदिन अभिनंदन एवं सम्मान प्रमाण पत्र
              </p>
              <div className="w-24 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent mx-auto mt-2" />
            </div>

            {/* Employee Photo Frame */}
            <div className="my-5 flex flex-col items-center">
              <div className="relative group">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-amber-500 shadow-md overflow-hidden bg-slate-100 flex items-center justify-center">
                  {profile.photoUrl ? (
                    <img
                      src={profile.photoUrl}
                      alt={profile.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-3xl text-amber-600 font-bold">👤</div>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white text-[11px] p-1 rounded-full shadow">
                  <Sparkles size={14} />
                </div>
              </div>
            </div>

            {/* Recipient Details */}
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Presented with heartfelt congratulations and appreciation to:
            </p>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mb-1">
              {profile.name || 'Respected Employee'}
            </h2>
            <div className="inline-flex flex-wrap items-center justify-center gap-1.5 text-xs sm:text-sm font-bold text-indigo-700 bg-indigo-50/80 px-3 py-1 rounded-full border border-indigo-100 mb-4">
              <span>{profile.designation || 'Railway Personnel'}</span>
              {profile.machineName && (
                <>
                  <span>•</span>
                  <span>Machine: {profile.machineName}</span>
                </>
              )}
              {profile.division && (
                <>
                  <span>•</span>
                  <span>Div: {profile.division}</span>
                </>
              )}
            </div>

            {/* Message Body */}
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed max-w-xl mx-auto italic font-medium my-4 px-4 bg-amber-50/60 py-3 rounded-xl border border-amber-100/80">
              "On the occasion of your Birthday today ({todayDate}), we extend our warmest wishes for radiant health, joy, and grand success. Your invaluable service and steadfast dedication to railway track operations and maintenance keep the nation on track."
            </p>

            {/* Footer / Signatures */}
            <div className="mt-8 pt-4 border-t border-slate-200 grid grid-cols-3 items-end text-left text-xs">
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-400">Date of Honor</span>
                <span className="font-bold text-slate-800">{todayDate}</span>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center text-amber-800 shadow-xs font-bold text-xs">
                  ★ SEAL ★
                </div>
              </div>
              <div className="text-right">
                <span className="block text-[10px] uppercase font-bold text-slate-400">Authorized by</span>
                <span className="font-black text-slate-900">RMMS Administration</span>
                <span className="block text-[9px] text-slate-500">Personnel & Operations Wing</span>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Bottom Actions */}
        <div className="flex flex-wrap items-center justify-between px-6 py-4 bg-white border-t border-slate-100 gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <Sparkles size={14} className="text-amber-500 shrink-0" />
            <span>
              {realEmail ? `Registered email: ${realEmail}` : 'Digital Certificate generated automatically by RMMS on your Date of Birth'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {realEmail && (
              <button
                type="button"
                disabled={sendingEmail}
                onClick={handleSendEmail}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-black transition-all shadow-xs flex items-center gap-1.5"
              >
                {sendingEmail ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : emailSent ? (
                  <>
                    <CheckCircle2 size={14} className="text-amber-100" />
                    <span>Email Sent!</span>
                  </>
                ) : (
                  <>
                    <Mail size={14} />
                    <span>Send to My Email</span>
                  </>
                )}
              </button>
            )}
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-2"
            >
              <Printer size={14} />
              <span>Print / Download Certificate</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
