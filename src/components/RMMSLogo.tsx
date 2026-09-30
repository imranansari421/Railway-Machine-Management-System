import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export interface RMMSLogoProps {
  variant?: 'full' | 'icon' | 'horizontal' | 'compact';
  size?: number | string;
  className?: string;
  showText?: boolean;
  animated?: boolean;
  customLogo?: string;
}

export const RMMSLogo: React.FC<RMMSLogoProps> = ({
  variant = 'full',
  size,
  className = '',
  showText = true,
  animated = false,
  customLogo,
}) => {
  const [appCustomLogo, setAppCustomLogo] = useState<string>(() => {
    return customLogo !== undefined ? customLogo : (localStorage.getItem('appLogo') || '');
  });

  useEffect(() => {
    if (customLogo !== undefined) {
      setAppCustomLogo(customLogo);
      return;
    }

    // Event listener for instant state broadcast
    const handleLogoUpdate = (e: any) => {
      setAppCustomLogo(e.detail || '');
    };
    window.addEventListener('app-logo-updated', handleLogoUpdate);

    // Live Firebase Snapshot listener for branding
    const unsubBranding = onSnapshot(doc(db, 'settings', 'app_branding'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.appLogo !== undefined) {
          setAppCustomLogo(data.appLogo || '');
          if (data.appLogo) {
            localStorage.setItem('appLogo', data.appLogo);
          } else {
            localStorage.removeItem('appLogo');
          }
        }
      }
    }, () => {});

    // Fallback listener for general settings
    const unsubGeneral = onSnapshot(doc(db, 'settings', 'general'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.appLogo !== undefined && !localStorage.getItem('appLogo')) {
          setAppCustomLogo(data.appLogo || '');
        }
      }
    }, () => {});

    return () => {
      window.removeEventListener('app-logo-updated', handleLogoUpdate);
      unsubBranding();
      unsubGeneral();
    };
  }, [customLogo]);

  // If a custom logo image is uploaded and active
  if (appCustomLogo) {
    if (variant === 'icon') {
      return (
        <img
          src={appCustomLogo}
          alt="App Logo"
          className={`object-contain ${className}`}
          style={size ? { width: size, height: size } : undefined}
        />
      );
    }

    return (
      <div className={`flex flex-col items-center justify-center text-center ${className}`}>
        <div className="flex items-center justify-center p-1">
          <img
            src={appCustomLogo}
            alt="App Logo"
            className="max-h-20 sm:max-h-24 max-w-full object-contain drop-shadow-xs"
            style={size ? { maxHeight: size } : undefined}
          />
        </div>
        {showText && (
          <div className="flex flex-col items-center justify-center w-full mt-2 select-none">
            {/* Golden Center Divider Line */}
            <div className="flex items-center justify-center gap-2 w-full my-1.5 px-4">
              <div className="w-1.5 h-1.5 rounded-full bg-[#0a2558] shrink-0" />
              <div className="h-0.5 flex-grow bg-[#0a2558] rounded" />
              <div className="h-1 w-12 bg-[#f59e0b] rounded-full" />
              <div className="h-0.5 flex-grow bg-[#0a2558] rounded" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#0a2558] shrink-0" />
            </div>

            {/* Subtitle 1 */}
            <div className="text-xs sm:text-sm font-black uppercase tracking-[0.2em] text-[#0a2558] font-sans">
              RAILWAY MACHINE
            </div>

            {/* Subtitle 2 */}
            <div className="flex items-center justify-center gap-2 w-full mt-0.5">
              <div className="h-0.5 flex-grow bg-[#f59e0b]" />
              <span className="text-[10px] sm:text-xs font-black uppercase tracking-[0.18em] text-[#f59e0b] px-2 whitespace-nowrap font-sans">
                MANAGEMENT SYSTEM
              </span>
              <div className="h-0.5 flex-grow bg-[#f59e0b]" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // If only the circular emblem icon is requested
  if (variant === 'icon') {
    return (
      <svg
        viewBox="0 0 500 500"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={size ? { width: size, height: size } : undefined}
      >
        <defs>
          <linearGradient id="gearNavyGrad" x1="50" y1="50" x2="350" y2="400" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1e4e96" />
            <stop offset="50%" stopColor="#0d2c68" />
            <stop offset="100%" stopColor="#071b42" />
          </linearGradient>

          <linearGradient id="gearGoldGrad" x1="320" y1="80" x2="480" y2="280" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>

          <linearGradient id="yellowArmGrad" x1="120" y1="120" x2="250" y2="350" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fde047" />
            <stop offset="40%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#ca8a04" />
          </linearGradient>

          <linearGradient id="cabBodyGrad" x1="220" y1="120" x2="400" y2="320" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="40%" stopColor="#f1f5f9" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>

          <linearGradient id="trackArcGrad" x1="60" y1="360" x2="450" y2="360" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0c2e68" />
            <stop offset="70%" stopColor="#12408b" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>

          <linearGradient id="trackGoldGlow" x1="80" y1="350" x2="400" y2="380" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="60%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#eab308" />
          </linearGradient>

          <filter id="logoShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.25" />
          </filter>
        </defs>

        <g id="EmblemGraphic" filter="url(#logoShadow)">
          {/* Outer Industrial Gear Cogwheel - Blue Section */}
          <path
            d="M 250,55 
               L 262,28 L 292,34 L 285,62 
               A 190 190 0 0 0 215,62 L 208,34 L 238,28 L 250,55 Z
               M 205,65 L 178,44 L 154,62 L 175,85 A 190 190 0 0 0 137,114 L 109,101 L 93,126 L 118,145
               A 190 190 0 0 0 94,180 L 65,176 L 57,206 L 86,217 A 190 190 0 0 0 86,260 L 57,271 L 65,301 L 94,297
               A 190 190 0 0 0 118,332 L 93,351 L 109,376 L 137,363 A 190 190 0 0 0 175,392 L 154,415 L 178,433 L 205,412"
            fill="none"
            stroke="url(#gearNavyGrad)"
            strokeWidth="32"
            strokeLinejoin="round"
          />

          {/* Solid Base Gear Teeth - Navy */}
          <path
            d="M 250,45
               C 136.8,45 45,136.8 45,250
               C 45,335.2 96.1,408.5 169.5,439.4
               L 182,398
               C 126.8,373.4 88,316.3 88,250
               C 88,160.5 160.5,88 250,88
               C 278.4,88 305.1,95.3 328.3,108.2
               L 348.6,71.5
               C 319.4,54.5 285.8,45 250,45 Z"
            fill="url(#gearNavyGrad)"
          />

          {/* Outer Gear Cogwheel - Gold / Amber Section (Top-Right / Right) */}
          <path
            d="M 250,45
               C 285.8,45 319.4,54.5 348.6,71.5
               L 328.3,108.2
               C 351.5,121.1 370.8,140.4 383.7,163.6
               L 420.4,143.3
               C 403.4,114.1 378.9,89.6 349.7,72.6
               L 370,36 L 398,54 L 380,88
               C 410.2,109 434.6,138.5 449.6,173.3
               L 483,161 L 491,192 L 456,206
               C 459.6,220.5 461.5,235.6 461.5,251
               C 461.5,263 460.3,274.7 458,286
               L 491,296 L 479,325 L 448,310
               C 437.5,338.4 418.8,363.3 394,382
               L 417,411 L 391,432 L 370,401
               C 353,413 334,422 313,428
               L 313,383
               C 362.3,371.4 401.3,332.4 413,283.1
               C 416.3,272.7 418,261.6 418,250
               C 418,157.2 342.8,82 250,82
               Z"
            fill="url(#gearGoldGrad)"
          />

          {/* Outer Gear Teeth details */}
          <path d="M 235,22 L 265,22 L 260,50 L 240,50 Z" fill="#0d2c68" />
          <path d="M 170,38 L 195,20 L 210,44 L 186,60 Z" fill="#0d2c68" />
          <path d="M 110,75 L 130,52 L 150,72 L 132,94 Z" fill="#0d2c68" />
          <path d="M 68,132 L 82,104 L 108,118 L 96,145 Z" fill="#0d2c68" />
          <path d="M 45,202 L 50,172 L 80,178 L 76,208 Z" fill="#0d2c68" />
          <path d="M 46,275 L 44,245 L 74,247 L 75,277 Z" fill="#0d2c68" />
          <path d="M 72,342 L 60,314 L 88,302 L 99,328 Z" fill="#0d2c68" />

          {/* Gold teeth */}
          <path d="M 330,30 L 358,45 L 344,72 L 318,58 Z" fill="#f59e0b" />
          <path d="M 390,75 L 415,95 L 395,120 L 372,100 Z" fill="#f59e0b" />
          <path d="M 435,138 L 455,165 L 430,185 L 410,160 Z" fill="#f59e0b" />
          <path d="M 458,212 L 472,242 L 442,254 L 430,225 Z" fill="#f59e0b" />
          <path d="M 452,288 L 460,320 L 430,328 L 422,298 Z" fill="#f59e0b" />

          {/* Inner Light Ring */}
          <circle cx="250" cy="250" r="162" fill="white" />

          {/* Railway Tracks & Sleeper Ties (In perspective) */}
          <g id="RailTracks">
            {/* Sleepers / Ties */}
            <path d="M 90,325 L 140,328 L 135,336 L 85,333 Z" fill="#1e293b" />
            <path d="M 125,340 L 185,344 L 180,353 L 120,349 Z" fill="#1e293b" />
            <path d="M 165,357 L 235,362 L 228,373 L 158,368 Z" fill="#1e293b" />
            <path d="M 210,378 L 290,384 L 282,397 L 202,391 Z" fill="#1e293b" />
            <path d="M 260,402 L 350,410 L 340,425 L 250,417 Z" fill="#1e293b" />
            <path d="M 315,430 L 415,440 L 402,458 L 302,448 Z" fill="#1e293b" />
            <path d="M 375,462 L 485,474 L 470,496 L 360,484 Z" fill="#1e293b" />

            {/* Left Rail (Curved perspective) */}
            <path
              d="M 75,320 C 130,335 230,385 350,480"
              stroke="#64748b"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M 75,318 C 130,333 230,383 350,478"
              stroke="#cbd5e1"
              strokeWidth="4"
              strokeLinecap="round"
            />

            {/* Right Rail */}
            <path
              d="M 155,330 C 230,360 340,410 460,490"
              stroke="#64748b"
              strokeWidth="11"
              strokeLinecap="round"
            />
            <path
              d="M 155,328 C 230,358 340,408 460,488"
              stroke="#cbd5e1"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </g>

          {/* Lower Dynamic Sweeping Crescent Swoosh */}
          <path
            d="M 50,285
               C 42,350 90,418 165,448
               C 240,478 335,475 425,435
               C 355,455 260,450 190,425
               C 120,400 75,350 72,295
               Z"
            fill="url(#trackArcGrad)"
          />
          <path
            d="M 72,305
               C 68,360 115,418 185,442
               C 260,466 348,460 415,432
               C 345,448 265,448 195,428
               C 130,408 90,365 85,315
               Z"
            fill="url(#trackGoldGlow)"
          />

          {/* ==================================================== */}
          {/* TRACK MACHINE LOCOMOTIVE (Centerpiece) */}
          {/* ==================================================== */}
          <g id="TrackMachine" transform="translate(0, 10)">
            {/* Machine Receding Train Coach/Rear Body */}
            <path
              d="M 85,275 L 195,215 L 225,210 L 225,305 L 85,320 Z"
              fill="#0a2558"
            />
            {/* Rear Roof */}
            <path
              d="M 85,275 L 105,245 L 210,195 L 195,215 Z"
              fill="#081e48"
            />
            {/* Rear Coach Yellow Windows Stripe */}
            <path
              d="M 92,270 L 190,218 L 190,248 L 92,298 Z"
              fill="#f59e0b"
            />
            {/* Rear Coach Windows */}
            <path d="M 98,272 L 115,264 L 115,286 L 98,294 Z" fill="#ffffff" />
            <path d="M 122,260 L 140,252 L 140,274 L 122,282 Z" fill="#ffffff" />
            <path d="M 147,248 L 165,240 L 165,262 L 147,270 Z" fill="#ffffff" />
            <path d="M 172,236 L 188,228 L 188,250 L 172,258 Z" fill="#ffffff" />

            {/* Heavy Hydraulic Tamping / Workhead Crane Arms (Yellow) */}
            <g id="TampingMechanism">
              {/* Hydraulic arm main beam */}
              <path
                d="M 160,205 L 245,160 L 260,180 L 180,230 Z"
                fill="url(#yellowArmGrad)"
                stroke="#0a2558"
                strokeWidth="3.5"
                strokeLinejoin="round"
              />
              {/* Articulated joint cylinder */}
              <circle cx="252" cy="170" r="14" fill="#ca8a04" stroke="#0a2558" strokeWidth="3.5" />
              <circle cx="252" cy="170" r="7" fill="#fde047" />

              {/* Vertical Hydraulic Tamping Unit */}
              <path
                d="M 245,175 L 220,295 L 200,290 L 230,170 Z"
                fill="url(#yellowArmGrad)"
                stroke="#0a2558"
                strokeWidth="3.5"
              />
              {/* Hydraulic Piston Rod */}
              <rect x="238" y="215" width="8" height="55" fill="#e2e8f0" stroke="#0a2558" strokeWidth="2.5" />

              {/* Secondary Tamping Tooling Head */}
              <path
                d="M 195,260 L 215,260 L 210,315 L 185,310 Z"
                fill="#eab308"
                stroke="#0a2558"
                strokeWidth="3"
              />
              <circle cx="205" cy="305" r="12" fill="#ca8a04" stroke="#0a2558" strokeWidth="3" />
              <circle cx="205" cy="305" r="6" fill="#fef08a" />
              <circle cx="165" cy="295" r="10" fill="#ca8a04" stroke="#0a2558" strokeWidth="3" />
            </g>

            {/* Main Locomotive Engine Cabin (Front & Side) */}
            {/* Side Cabin Wall (White / Silver with Navy Trim) */}
            <path
              d="M 215,190 L 285,145 L 305,145 L 300,295 L 215,295 Z"
              fill="url(#cabBodyGrad)"
              stroke="#0a2558"
              strokeWidth="4"
            />
            {/* Side Grille / Air Vents */}
            <path d="M 235,210 L 265,190 L 265,245 L 235,265 Z" fill="#0a2558" />
            <path d="M 238,220 L 262,204" stroke="#ffffff" strokeWidth="2.5" />
            <path d="M 238,232 L 262,216" stroke="#ffffff" strokeWidth="2.5" />
            <path d="M 238,244 L 262,228" stroke="#ffffff" strokeWidth="2.5" />
            <path d="M 238,256 L 262,240" stroke="#ffffff" strokeWidth="2.5" />

            {/* Cabin Roof */}
            <path
              d="M 285,145 L 340,110 L 400,140 L 305,145 Z"
              fill="#0d2c68"
              stroke="#0a2558"
              strokeWidth="4"
            />
            {/* Roof Horn / Safety Beacon */}
            <path d="M 335,108 L 348,102 L 358,110 L 342,114 Z" fill="#f59e0b" />
            <circle cx="345" cy="103" r="4" fill="#ef4444" />

            {/* Front Cabin Face */}
            <path
              d="M 305,145 L 400,140 L 450,230 L 455,305 L 300,295 Z"
              fill="#0d2c68"
              stroke="#0a2558"
              strokeWidth="4"
            />

            {/* Front Windshield (Dual Glass with reflection) */}
            {/* Left Glass */}
            <path
              d="M 315,155 L 365,150 L 362,210 L 312,215 Z"
              fill="#38bdf8"
              stroke="#071b42"
              strokeWidth="3"
            />
            <path d="M 320,160 L 345,158 L 325,210 L 315,210 Z" fill="#bae6fd" opacity="0.6" />

            {/* Right Glass */}
            <path
              d="M 375,149 L 418,144 L 435,200 L 372,209 Z"
              fill="#38bdf8"
              stroke="#071b42"
              strokeWidth="3"
            />
            <path d="M 380,154 L 402,150 L 388,204 L 375,204 Z" fill="#bae6fd" opacity="0.6" />

            {/* Yellow Accent Band below Windshield */}
            <path
              d="M 308,220 L 440,208 L 443,230 L 306,242 Z"
              fill="#f59e0b"
              stroke="#0a2558"
              strokeWidth="2.5"
            />

            {/* Handrails & Side Ladders */}
            <path d="M 275,195 L 275,285" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
            <path d="M 285,195 L 285,285" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
            <path d="M 275,220 L 285,220" stroke="#f59e0b" strokeWidth="3" />
            <path d="M 275,245 L 285,245" stroke="#f59e0b" strokeWidth="3" />
            <path d="M 275,270 L 285,270" stroke="#f59e0b" strokeWidth="3" />

            {/* Front Headlights / Dual Lamps */}
            <circle cx="330" cy="265" r="14" fill="#ffffff" stroke="#0a2558" strokeWidth="3.5" />
            <circle cx="330" cy="265" r="8" fill="#fef08a" />
            <circle cx="330" cy="265" r="4" fill="#ffffff" />

            <circle cx="435" cy="250" r="14" fill="#ffffff" stroke="#0a2558" strokeWidth="3.5" />
            <circle cx="435" cy="250" r="8" fill="#fef08a" />
            <circle cx="435" cy="250" r="4" fill="#ffffff" />

            {/* Heavy Front Buffer Beam / Cowcatcher with Black & Yellow Chevron Hazard Stripes */}
            <g id="HazardChevron">
              {/* Outer Plate */}
              <path
                d="M 295,295 L 460,305 L 415,375 L 270,355 Z"
                fill="#f59e0b"
                stroke="#0a2558"
                strokeWidth="4"
                strokeLinejoin="round"
              />

              {/* Clip path for hazard stripes */}
              <clipPath id="chevronClip">
                <path d="M 295,295 L 460,305 L 415,375 L 270,355 Z" />
              </clipPath>

              <g clipPath="url(#chevronClip)">
                {/* Black diagonal stripes */}
                <path d="M 280,280 L 320,280 L 270,390 L 230,390 Z" fill="#0a2558" />
                <path d="M 330,280 L 370,280 L 320,390 L 280,390 Z" fill="#0a2558" />
                <path d="M 380,280 L 420,280 L 370,390 L 330,390 Z" fill="#0a2558" />
                <path d="M 430,280 L 470,280 L 420,390 L 380,390 Z" fill="#0a2558" />
                <path d="M 480,280 L 520,280 L 470,390 L 430,390 Z" fill="#0a2558" />
              </g>

              {/* Front Buffer Cylinders / Couplers */}
              <path d="M 280,360 L 260,365 L 260,380 L 285,375 Z" fill="#0a2558" />
              <circle cx="255" cy="372" r="10" fill="#334155" stroke="#0a2558" strokeWidth="2.5" />

              <path d="M 430,370 L 450,372 L 448,388 L 425,385 Z" fill="#0a2558" />
              <circle cx="455" cy="380" r="10" fill="#334155" stroke="#0a2558" strokeWidth="2.5" />
            </g>

            {/* Wheels & Undercarriage Bogies */}
            <g id="BogieWheels">
              {/* Front Wheel 1 */}
              <circle cx="310" cy="380" r="14" fill="#1e293b" stroke="#0a2558" strokeWidth="3" />
              <circle cx="310" cy="380" r="6" fill="#f59e0b" />

              {/* Front Wheel 2 */}
              <circle cx="370" cy="392" r="15" fill="#1e293b" stroke="#0a2558" strokeWidth="3" />
              <circle cx="370" cy="392" r="7" fill="#f59e0b" />

              {/* Rear Bogie Wheel */}
              <circle cx="210" cy="340" r="13" fill="#1e293b" stroke="#0a2558" strokeWidth="3" />
              <circle cx="210" cy="340" r="6" fill="#f59e0b" />
            </g>
          </g>
        </g>
      </svg>
    );
  }

  // If horizontal layout is requested (Emblem on left + RMMS text on right)
  if (variant === 'horizontal') {
    return (
      <div className={`flex items-center gap-3.5 ${className}`}>
        <div className="shrink-0" style={{ width: size || 44, height: size || 44 }}>
          <RMMSLogo variant="icon" className="w-full h-full" />
        </div>
        {showText && (
          <div className="flex flex-col select-none leading-none">
            <div className="flex items-center gap-1.5">
              <span className="text-xl md:text-2xl font-black tracking-tight text-[#0a2558]">
                <span className="text-[#f59e0b]">R</span>MMS
              </span>
              <span className="text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 bg-amber-100 text-amber-900 rounded">
                Portal
              </span>
            </div>
            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider text-[#0a2558] mt-1">
              Railway Machine
            </span>
            <span className="text-[8px] md:text-[9px] font-bold uppercase tracking-widest text-[#f59e0b] mt-0.5">
              Management System
            </span>
          </div>
        )}
      </div>
    );
  }

  // Default: Full Vertical Emblem + Bold RMMS Typography
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      {/* Emblem SVG */}
      <div
        className="w-full max-w-[340px] aspect-square flex items-center justify-center"
        style={size ? { width: size, height: size } : undefined}
      >
        <RMMSLogo variant="icon" className="w-full h-full object-contain" />
      </div>

      {/* Typography Section (RMMS - RAILWAY MACHINE MANAGEMENT SYSTEM) */}
      {showText && (
        <div className="flex flex-col items-center text-center mt-2 select-none w-full max-w-[360px]">
          {/* Main RMMS Acronym with stylized yellow 'R' leg */}
          <div className="flex items-center justify-center tracking-tighter leading-none">
            <svg
              viewBox="0 0 380 90"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full max-w-[320px] h-auto drop-shadow-sm"
            >
              {/* R with yellow lightning/arrow leg */}
              <g id="LetterR">
                {/* Navy R upper body & stem */}
                <path
                  d="M 25,12 L 80,12 C 105,12 118,24 118,44 C 118,58 108,68 94,72 L 78,72 L 78,56 L 86,56 C 94,56 98,52 98,44 C 98,36 94,30 84,30 L 52,30 L 52,82 L 25,82 Z"
                  fill="#0a2558"
                />
                {/* Vibrant Golden Arrow Leg */}
                <path
                  d="M 54,42 L 84,42 L 125,84 L 88,84 Z"
                  fill="#f59e0b"
                />
                <path
                  d="M 54,42 L 74,42 L 105,74 L 88,74 Z"
                  fill="#fbbf24"
                />
              </g>

              {/* First M */}
              <g id="LetterM1">
                <path
                  d="M 124,12 L 150,12 L 176,55 L 202,12 L 228,12 L 228,82 L 205,82 L 205,38 L 184,72 L 168,72 L 147,38 L 147,82 L 124,82 Z"
                  fill="#0a2558"
                />
              </g>

              {/* Second M */}
              <g id="LetterM2">
                <path
                  d="M 235,12 L 261,12 L 287,55 L 313,12 L 339,12 L 339,82 L 316,82 L 316,38 L 295,72 L 279,72 L 258,38 L 258,82 L 235,82 Z"
                  fill="#0a2558"
                />
              </g>

              {/* Letter S */}
              <g id="LetterS">
                <path
                  d="M 350,22 C 358,15 372,12 390,12 C 418,12 432,24 432,40 C 432,54 420,60 398,64 L 382,67 C 374,68 370,71 370,75 C 370,79 375,82 386,82 C 398,82 410,77 418,70 L 430,84 C 420,93 404,98 386,98 C 360,98 344,86 344,70 C 344,56 358,49 378,45 L 396,42 C 404,40 408,37 408,33 C 408,29 402,26 392,26 C 382,26 370,30 362,36 Z"
                  fill="#0a2558"
                  transform="translate(-10, -5)"
                />
              </g>
            </svg>
          </div>

          {/* Golden Center Divider Line with flanking dots */}
          <div className="flex items-center justify-center gap-2 w-full my-1.5 px-4">
            <div className="w-2 h-2 rounded-full bg-[#0a2558] shrink-0" />
            <div className="h-1 flex-grow bg-[#0a2558] rounded" />
            <div className="h-1.5 w-16 bg-[#f59e0b] rounded-full" />
            <div className="h-1 flex-grow bg-[#0a2558] rounded" />
            <div className="w-2 h-2 rounded-full bg-[#0a2558] shrink-0" />
          </div>

          {/* Subtitle 1: RAILWAY MACHINE */}
          <div className="text-sm sm:text-base font-black uppercase tracking-[0.25em] text-[#0a2558] mt-1 font-sans">
            RAILWAY MACHINE
          </div>

          {/* Subtitle 2: MANAGEMENT SYSTEM with flanking yellow lines */}
          <div className="flex items-center justify-center gap-2 w-full mt-1">
            <div className="h-0.5 flex-grow bg-[#f59e0b]" />
            <span className="text-xs sm:text-sm font-black uppercase tracking-[0.2em] text-[#f59e0b] px-2 whitespace-nowrap font-sans">
              MANAGEMENT SYSTEM
            </span>
            <div className="h-0.5 flex-grow bg-[#f59e0b]" />
          </div>
        </div>
      )}
    </div>
  );
};

export default RMMSLogo;
