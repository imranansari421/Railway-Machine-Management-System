import React from 'react';
import { motion } from 'motion/react';

interface TrackMachineLoaderProps {
  label?: string;
  subLabel?: string;
  message?: string;
  subMessage?: string;
  size?: 'sm' | 'md' | 'lg' | 'fullscreen';
  theme?: 'dark' | 'light' | 'auto';
}

export const TrackMachineLoader: React.FC<TrackMachineLoaderProps> = ({
  label,
  subLabel,
  message,
  subMessage,
  size = 'md',
  theme = 'auto'
}) => {
  const displayLabel = label || message || 'Loading Track Machine Data...';
  const displaySubLabel = subLabel || subMessage || 'Please wait while system synchronizes records';
  const isFullscreen = size === 'fullscreen';
  const isSm = size === 'sm';
  const isLg = size === 'lg' || isFullscreen;

  const isDark = theme === 'dark';

  const machineWidth = isSm ? 130 : isLg ? 230 : 180;
  const machineHeight = isSm ? 65 : isLg ? 105 : 85;

  const content = (
    <div className="flex flex-col items-center justify-center p-4 sm:p-6 text-center select-none">
      {/* Animated Track Machine Illustration */}
      <div className="relative flex flex-col items-center">
        {/* Track Machine Graphic Container */}
        <motion.div
          animate={{ y: [0, -2.5, 0, -2, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          className="relative z-10"
        >
          <svg
            width={machineWidth}
            height={machineHeight}
            viewBox="0 0 220 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-lg"
          >
            {/* Top Safety Beacon / Flashing Light */}
            <motion.circle
              cx="45"
              cy="12"
              r="4"
              fill="#ef4444"
              animate={{ opacity: [1, 0.2, 1, 0.4, 1], scale: [1, 1.25, 1, 1.2, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
            <motion.circle
              cx="175"
              cy="12"
              r="4"
              fill="#f59e0b"
              animate={{ opacity: [0.3, 1, 0.3, 1, 0.3], scale: [1, 1.25, 1, 1.2, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />

            {/* Exhaust Pipe & Animated Smoke */}
            <rect x="75" y="8" width="6" height="12" fill="#475569" rx="1" />
            <motion.circle
              cx="78"
              cy="5"
              r="3"
              fill={isDark ? "#94a3b8" : "#64748b"}
              animate={{ y: [-2, -14], x: [-1, -6], opacity: [0.85, 0], scale: [0.8, 1.8] }}
              transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.circle
              cx="78"
              cy="5"
              r="2.5"
              fill={isDark ? "#cbd5e1" : "#94a3b8"}
              animate={{ y: [-2, -16], x: [0, -9], opacity: [0.7, 0], scale: [0.6, 2] }}
              transition={{ duration: 1, delay: 0.5, repeat: Infinity, ease: "easeOut" }}
            />

            {/* Main Upper Cabin / Body - Railway Yellow */}
            <path
              d="M 25 20 L 195 20 C 198 20 200 22 200 25 L 202 65 C 202 67 200 69 198 69 L 22 69 C 20 69 18 67 18 65 L 20 25 C 20 22 22 20 25 20 Z"
              fill="#eab308"
              stroke="#ca8a04"
              strokeWidth="2"
            />

            {/* Cabin Accent Stripe */}
            <rect x="18" y="42" width="184" height="6" fill="#1e3a8a" />

            {/* Front & Rear Windows */}
            {/* Front Left Cab Window */}
            <rect x="26" y="26" width="22" height="13" rx="2" fill="#0284c7" stroke="#0369a1" strokeWidth="1" />
            <rect x="28" y="28" width="8" height="9" rx="1" fill="#7dd3fc" opacity="0.75" />

            {/* Middle Windows */}
            <rect x="54" y="26" width="18" height="13" rx="2" fill="#0284c7" stroke="#0369a1" strokeWidth="1" />
            <rect x="76" y="26" width="18" height="13" rx="2" fill="#0284c7" stroke="#0369a1" strokeWidth="1" />
            <rect x="126" y="26" width="18" height="13" rx="2" fill="#0284c7" stroke="#0369a1" strokeWidth="1" />
            <rect x="148" y="26" width="18" height="13" rx="2" fill="#0284c7" stroke="#0369a1" strokeWidth="1" />

            {/* Rear Right Cab Window */}
            <rect x="172" y="26" width="22" height="13" rx="2" fill="#0284c7" stroke="#0369a1" strokeWidth="1" />
            <rect x="174" y="28" width="8" height="9" rx="1" fill="#7dd3fc" opacity="0.75" />

            {/* Central Equipment / Ventilation Louvers */}
            <rect x="98" y="24" width="24" height="16" rx="2" fill="#334155" />
            <line x1="102" y1="28" x2="118" y2="28" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="102" y1="32" x2="118" y2="32" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="102" y1="36" x2="118" y2="36" stroke="#94a3b8" strokeWidth="1.5" />

            {/* Machine Identification / Indian Railways Logo Plate */}
            <rect x="24" y="52" width="42" height="12" rx="2" fill="#0f172a" />
            <text x="45" y="60.5" fontSize="7" fontWeight="bold" fill="#f8fafc" textAnchor="middle" fontFamily="sans-serif">
              IR - RMMS
            </text>

            <rect x="154" y="52" width="42" height="12" rx="2" fill="#0f172a" />
            <text x="175" y="60.5" fontSize="7" fontWeight="bold" fill="#facc15" textAnchor="middle" fontFamily="sans-serif">
              TAMPING
            </text>

            {/* Center Tamping Unit Mechanical Assembly */}
            <g>
              <rect x="94" y="50" width="32" height="18" fill="#1e293b" rx="2" stroke="#475569" strokeWidth="1" />
              {/* Animated Tamping Tines (moving up and down) */}
              <motion.g
                animate={{ y: [0, 5, 0, 4, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
              >
                <rect x="100" y="68" width="4" height="14" fill="#64748b" rx="1" />
                <polygon points="100,82 104,82 102,86" fill="#334155" />

                <rect x="116" y="68" width="4" height="14" fill="#64748b" rx="1" />
                <polygon points="116,82 120,82 118,86" fill="#334155" />
              </motion.g>
            </g>

            {/* Heavy Machine Chassis & Underframe */}
            <rect x="12" y="68" width="196" height="8" rx="2" fill="#0f172a" />
            <rect x="10" y="70" width="8" height="5" rx="1" fill="#e2e8f0" />
            <rect x="202" y="70" width="8" height="5" rx="1" fill="#e2e8f0" />

            {/* Front Bogie & Wheels */}
            <rect x="28" y="75" width="48" height="4" fill="#334155" rx="1" />
            {/* Wheel 1 */}
            <g className="origin-[38px_82px]">
              <motion.g
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: "38px 82px" }}
              >
                <circle cx="38" cy="82" r="9" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
                <circle cx="38" cy="82" r="3" fill="#94a3b8" />
                <line x1="38" y1="73" x2="38" y2="91" stroke="#94a3b8" strokeWidth="1.5" />
                <line x1="29" y1="82" x2="47" y2="82" stroke="#94a3b8" strokeWidth="1.5" />
              </motion.g>
            </g>
            {/* Wheel 2 */}
            <g className="origin-[66px_82px]">
              <motion.g
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: "66px 82px" }}
              >
                <circle cx="66" cy="82" r="9" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
                <circle cx="66" cy="82" r="3" fill="#94a3b8" />
                <line x1="66" y1="73" x2="66" y2="91" stroke="#94a3b8" strokeWidth="1.5" />
                <line x1="57" y1="82" x2="75" y2="82" stroke="#94a3b8" strokeWidth="1.5" />
              </motion.g>
            </g>

            {/* Rear Bogie & Wheels */}
            <rect x="144" y="75" width="48" height="4" fill="#334155" rx="1" />
            {/* Wheel 3 */}
            <g className="origin-[154px_82px]">
              <motion.g
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: "154px 82px" }}
              >
                <circle cx="154" cy="82" r="9" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
                <circle cx="154" cy="82" r="3" fill="#94a3b8" />
                <line x1="154" y1="73" x2="154" y2="91" stroke="#94a3b8" strokeWidth="1.5" />
                <line x1="145" y1="82" x2="163" y2="82" stroke="#94a3b8" strokeWidth="1.5" />
              </motion.g>
            </g>
            {/* Wheel 4 */}
            <g className="origin-[182px_82px]">
              <motion.g
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: "182px 82px" }}
              >
                <circle cx="182" cy="82" r="9" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
                <circle cx="182" cy="82" r="3" fill="#94a3b8" />
                <line x1="182" y1="73" x2="182" y2="91" stroke="#94a3b8" strokeWidth="1.5" />
                <line x1="173" y1="82" x2="191" y2="82" stroke="#94a3b8" strokeWidth="1.5" />
              </motion.g>
            </g>
          </svg>
        </motion.div>

        {/* Animated Railway Track & Ties / Sleepers */}
        <div className="relative w-full max-w-[250px] -mt-1 overflow-hidden">
          {/* Steel Rail Line */}
          <div className="w-full h-1.5 bg-slate-700 rounded-full shadow-inner"></div>

          {/* Sliding Sleepers / Track Ties */}
          <div className="relative h-2 w-full overflow-hidden mt-0.5">
            <motion.div
              className="flex gap-4 w-[200%]"
              animate={{ x: [0, -32] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            >
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="w-2.5 h-2 bg-amber-950 rounded-xs flex-shrink-0 shadow-xs border-t border-amber-700/60" />
              ))}
            </motion.div>
          </div>

          {/* Gravel / Ballast Bed */}
          <div className={`w-full h-1 rounded-full opacity-60 mt-0.5 ${isDark ? 'bg-slate-700' : 'bg-slate-300'}`} />
        </div>
      </div>

      {/* Dynamic Text & Progress Pulse */}
      {(displayLabel || displaySubLabel) && (
        <div className="mt-4 space-y-1">
          {displayLabel && (
            <motion.h4
              animate={{ opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              className={`text-xs sm:text-sm font-black uppercase tracking-wider ${
                isDark ? 'text-slate-100' : 'text-slate-800'
              }`}
            >
              {displayLabel}
            </motion.h4>
          )}
          {displaySubLabel && (
            <p className={`text-[11px] font-medium max-w-xs ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}>
              {displaySubLabel}
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs">
        <div className="bg-white/95 border border-slate-200/80 rounded-2xl shadow-xl p-4 sm:p-6 max-w-sm mx-4">
          {content}
        </div>
      </div>
    );
  }

  return content;
};

export default TrackMachineLoader;
