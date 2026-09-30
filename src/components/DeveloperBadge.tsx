import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface DeveloperBadgeProps {
  className?: string;
  height?: number | string;
  href?: string;
  onClick?: () => void;
  imageSrc?: string;
}

export const DeveloperBadge: React.FC<DeveloperBadgeProps> = ({ 
  className = '', 
  height = 32,
  href,
  onClick,
  imageSrc
}) => {
  const [customImage, setCustomImage] = useState<string>(() => {
    return imageSrc || localStorage.getItem('footerImage') || '';
  });

  useEffect(() => {
    if (imageSrc !== undefined) {
      setCustomImage(imageSrc);
      return;
    }

    // Listen to branding doc for footer image
    const unsub = onSnapshot(doc(db, 'settings', 'app_branding'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.footerImage !== undefined) {
          setCustomImage(data.footerImage || '');
          if (data.footerImage) {
            localStorage.setItem('footerImage', data.footerImage);
          } else {
            localStorage.removeItem('footerImage');
          }
        }
      }
    }, (err) => {
      console.warn("Error listening to footerImage:", err);
    });

    const handleCustomUpdate = (e: any) => {
      if (e?.detail !== undefined) {
        setCustomImage(e.detail);
      }
    };

    window.addEventListener('footer-image-updated', handleCustomUpdate);

    return () => {
      unsub();
      window.removeEventListener('footer-image-updated', handleCustomUpdate);
    };
  }, [imageSrc]);

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick();
    } else if (href && href !== '#') {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  const isClickable = Boolean(onClick || (href && href !== '#'));

  return (
    <span 
      className={`inline-flex items-center select-none group transition-all duration-300 ${
        isClickable ? 'cursor-pointer hover:scale-105 active:scale-95' : ''
      } ${className}`}
      onClick={isClickable ? handleClick : undefined}
      title={href && href !== '#' ? `Developed By IMRAN - Click to visit website (${href})` : "Developed By IMRAN"}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleClick(e as any);
        }
      }}
    >
      {customImage ? (
        <img 
          src={customImage} 
          alt="Developer Footer Badge" 
          style={{ height, width: 'auto', maxHeight: '100%' }}
          className="max-w-[280px] object-contain drop-shadow-[0_2px_12px_rgba(0,180,255,0.45)] transition-all duration-300 group-hover:drop-shadow-[0_4px_20px_rgba(0,220,255,0.8)]" 
        />
      ) : (
        <svg 
          viewBox="0 0 780 230" 
          style={{ height, width: 'auto', maxHeight: '100%' }}
          className="drop-shadow-[0_2px_12px_rgba(0,180,255,0.45)] transition-all duration-300 group-hover:drop-shadow-[0_4px_20px_rgba(0,220,255,0.8)]"
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
        <defs>
          {/* Main Dark Gradient */}
          <linearGradient id="badgeDarkBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#020b1a" />
            <stop offset="35%" stopColor="#051735" />
            <stop offset="70%" stopColor="#030f24" />
            <stop offset="100%" stopColor="#010612" />
          </linearGradient>

          {/* Neon Cyan Border */}
          <linearGradient id="neonCyanBorder" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffb703" />
            <stop offset="15%" stopColor="#00f0ff" />
            <stop offset="55%" stopColor="#0077ff" />
            <stop offset="85%" stopColor="#00f5ff" />
            <stop offset="100%" stopColor="#0055ff" />
          </linearGradient>

          {/* Gold Yellow Gradient */}
          <linearGradient id="goldYellow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff3b0" />
            <stop offset="30%" stopColor="#ffc300" />
            <stop offset="70%" stopColor="#ff9100" />
            <stop offset="100%" stopColor="#d46b08" />
          </linearGradient>

          {/* Avatar Outer Ring Gradient */}
          <linearGradient id="avatarRingBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00f5ff" />
            <stop offset="40%" stopColor="#0099ff" />
            <stop offset="80%" stopColor="#0033cc" />
            <stop offset="100%" stopColor="#001155" />
          </linearGradient>

          {/* Avatar Left Crescent Gold Ring */}
          <linearGradient id="avatarRingGold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffe600" />
            <stop offset="50%" stopColor="#ff9900" />
            <stop offset="100%" stopColor="#cc6600" />
          </linearGradient>

          {/* IMRAN Text Metallic Gradient */}
          <linearGradient id="imranTextGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="20%" stopColor="#d5f5ff" />
            <stop offset="55%" stopColor="#38bdf8" />
            <stop offset="85%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#034694" />
          </linearGradient>

          {/* Laptop Screen Gradient */}
          <linearGradient id="laptopScreenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#03152d" />
            <stop offset="100%" stopColor="#020914" />
          </linearGradient>

          {/* Glow Filters */}
          <filter id="badgeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="softGlow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ========================================================= */}
        {/* 1. RIGHT SIDE GEAR (Golden Cogwheel behind laptop)       */}
        {/* ========================================================= */}
        <g transform="translate(680, 85)" opacity="0.95">
          <circle cx="0" cy="0" r="32" fill="url(#goldYellow)" stroke="#b35900" strokeWidth="2" />
          {/* Gear teeth */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
            <rect 
              key={i} 
              x="-6" 
              y="-38" 
              width="12" 
              height="12" 
              rx="2" 
              fill="url(#goldYellow)" 
              stroke="#b35900" 
              strokeWidth="1.5" 
              transform={`rotate(${angle})`} 
            />
          ))}
          <circle cx="0" cy="0" r="14" fill="#030e24" stroke="url(#goldYellow)" strokeWidth="2.5" />
        </g>

        {/* ========================================================= */}
        {/* 2. MAIN HORIZONTAL BADGE BODY & FRAME                     */}
        {/* ========================================================= */}
        {/* Right Arrow Base */}
        <path 
          d="M 640 92 L 735 125 L 755 145 L 735 165 L 640 198 Z" 
          fill="#0066ff" 
          stroke="#00f5ff" 
          strokeWidth="3" 
          filter="url(#softGlow)"
        />
        {/* Triple Chevron Arrow in the right tip */}
        <path d="M 700 134 L 712 145 L 700 156" stroke="#ffcc00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 714 134 L 726 145 L 714 156" stroke="#ffcc00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 728 134 L 740 145 L 728 156" stroke="#ffcc00" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Main Badge Body Outer Plate */}
        <path 
          d="M 210 52 
             L 245 42 
             L 645 42 
             C 660 42, 672 52, 676 66 
             L 700 142 
             C 704 155, 695 168, 680 170 
             L 240 170 
             C 220 170, 205 158, 200 140 
             L 190 95 
             C 188 80, 196 60, 210 52 Z" 
          fill="url(#badgeDarkBg)" 
          stroke="url(#neonCyanBorder)" 
          strokeWidth="3.5" 
        />

        {/* Golden Chamfer Highlight on top-left of badge */}
        <path 
          d="M 230 48 L 260 42 L 310 42" 
          stroke="url(#goldYellow)" 
          strokeWidth="4" 
          strokeLinecap="round" 
          filter="url(#softGlow)"
        />

        {/* ========================================================= */}
        {/* 3. GOLDEN CROWN (Top Center above Developed By)           */}
        {/* ========================================================= */}
        <g transform="translate(528, 28)">
          <path 
            d="M 0 24 
               L 5 4 
               L 16 16 
               L 26 0 
               L 36 16 
               L 47 4 
               L 52 24 
               Z" 
            fill="url(#goldYellow)" 
            stroke="#994d00" 
            strokeWidth="1.5"
            filter="url(#softGlow)"
          />
          {/* Jewels on crown tips */}
          <circle cx="5" cy="4" r="2.5" fill="#ffffff" />
          <circle cx="26" cy="0" r="3" fill="#ffffff" />
          <circle cx="47" cy="4" r="2.5" fill="#ffffff" />
          <circle cx="26" cy="18" r="2" fill="#ff0044" />
        </g>

        {/* ========================================================= */}
        {/* 4. CODE ICON & "Developed By" SCRIPT TEXT                */}
        {/* ========================================================= */}
        {/* Cyan Code Badge </ > on the left */}
        <g transform="translate(262, 58)">
          <rect x="0" y="0" width="38" height="28" rx="7" fill="#021d3a" stroke="#00e5ff" strokeWidth="2" filter="url(#softGlow)" />
          {/* < / > code text */}
          <path d="M 12 14 L 8 9 M 12 14 L 8 19" stroke="#00f0ff" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 20 8 L 17 20" stroke="#00f0ff" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 25 14 L 29 9 M 25 14 L 29 19" stroke="#00f0ff" strokeWidth="2.5" strokeLinecap="round" />
        </g>

        {/* "Developed By" Calligraphy / Script Style Text */}
        <text 
          x="312" 
          y="80" 
          fill="#ffffff" 
          fontFamily="'Brush Script MT', 'Dancing Script', 'Pacifico', cursive, sans-serif" 
          fontSize="36" 
          fontWeight="bold" 
          fontStyle="italic"
          letterSpacing="1"
          filter="drop-shadow(0 2px 4px rgba(0,0,0,0.8))"
        >
          Developed By
        </text>

        {/* Golden Circuit Line extending from Developed By to Right */}
        <line x1="545" y1="72" x2="600" y2="72" stroke="#ffb700" strokeWidth="3" strokeLinecap="round" />
        <circle cx="602" cy="72" r="3.5" fill="#ffea00" />
        <line x1="262" y1="94" x2="300" y2="94" stroke="#00d4ff" strokeWidth="2" strokeLinecap="round" />
        <circle cx="302" cy="94" r="2.5" fill="#00d4ff" />

        {/* ========================================================= */}
        {/* 5. "IMRAN" BOLD 3D METALLIC FUTURISTIC TYPOGRAPHY        */}
        {/* ========================================================= */}
        {/* Dynamic Golden Swoop / Ribbon behind & wrapping IMRAN */}
        <path 
          d="M 250 162 
             C 280 100, 310 140, 420 138 
             C 500 136, 560 110, 580 138 
             C 590 152, 570 164, 530 166 
             L 260 166 Z" 
          fill="url(#goldYellow)" 
          opacity="0.9"
        />

        {/* IMRAN Main Text (Heavy Italic 3D) */}
        <text 
          x="272" 
          y="152" 
          fill="url(#imranTextGrad)" 
          fontFamily="'Arial Black', 'Impact', 'Trebuchet MS', sans-serif" 
          fontSize="64" 
          fontWeight="900" 
          fontStyle="italic" 
          letterSpacing="3" 
          stroke="#031838" 
          strokeWidth="2.5" 
          filter="drop-shadow(0 6px 12px rgba(0,0,0,0.8))"
        >
          IMRAN
        </text>

        {/* Golden Front Ribbon Swoop arc over the letters */}
        <path 
          d="M 500 152 Q 545 130 575 142" 
          stroke="url(#goldYellow)" 
          strokeWidth="6" 
          strokeLinecap="round" 
          fill="none" 
          filter="url(#softGlow)"
        />

        {/* ========================================================= */}
        {/* 6. FUTURISTIC LAPTOP (Right Side with Code on Screen)    */}
        {/* ========================================================= */}
        <g transform="translate(565, 82)">
          {/* Laptop Screen Body */}
          <polygon 
            points="30,0 120,5 110,75 18,68" 
            fill="url(#laptopScreenGrad)" 
            stroke="#00e5ff" 
            strokeWidth="2.5" 
            filter="url(#softGlow)"
          />
          {/* Screen Inner Glare */}
          <polygon 
            points="34,4 116,9 107,70 23,64" 
            fill="#011226" 
          />
          
          {/* Code Syntax Highlight Lines on Screen */}
          <line x1="38" y1="14" x2="68" y2="16" stroke="#00f5ff" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="72" y1="16" x2="92" y2="17" stroke="#ffb700" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="36" y1="22" x2="56" y2="23" stroke="#00ff88" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="60" y1="23" x2="82" y2="24" stroke="#ff0077" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="34" y1="30" x2="60" y2="31" stroke="#00d4ff" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="32" y1="38" x2="52" y2="39" stroke="#ffb700" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="30" y1="46" x2="65" y2="47" stroke="#00ff88" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="28" y1="54" x2="58" y2="55" stroke="#00f5ff" strokeWidth="2.5" strokeLinecap="round" />

          {/* Central </ > on screen */}
          <g transform="translate(68, 30)">
            <circle cx="16" cy="16" r="14" fill="#003366" stroke="#00f5ff" strokeWidth="1.5" />
            <path d="M 12 16 L 9 12 M 12 16 L 9 20" stroke="#00f0ff" strokeWidth="2" strokeLinecap="round" />
            <path d="M 17 11 L 15 21" stroke="#00f0ff" strokeWidth="2" strokeLinecap="round" />
            <path d="M 20 16 L 23 12 M 20 16 L 23 20" stroke="#00f0ff" strokeWidth="2" strokeLinecap="round" />
          </g>

          {/* Laptop Base / Keyboard */}
          <polygon 
            points="18,68 110,75 125,92 0,84" 
            fill="#021c3d" 
            stroke="#0099ff" 
            strokeWidth="2" 
          />
          {/* Keyboard Surface with Grid lines */}
          <polygon points="16,71 106,77 118,88 6,82" fill="#042754" />
          <line x1="12" y1="76" x2="110" y2="82" stroke="#00e5ff" strokeWidth="1" opacity="0.6" />
          <line x1="10" y1="80" x2="114" y2="86" stroke="#00e5ff" strokeWidth="1" opacity="0.6" />
          {/* Trackpad */}
          <polygon points="50,83 75,85 73,88 48,86" fill="#00d4ff" opacity="0.8" />
        </g>

        {/* ========================================================= */}
        {/* 7. BOTTOM ACCENT NEON STRIP & LENS FLARE                 */}
        {/* ========================================================= */}
        <path 
          d="M 240 172 L 670 172" 
          stroke="url(#neonCyanBorder)" 
          strokeWidth="4" 
          strokeLinecap="round" 
        />
        <path 
          d="M 260 176 L 460 176" 
          stroke="url(#goldYellow)" 
          strokeWidth="3" 
          strokeLinecap="round" 
        />

        {/* Center Blue Light Sparkle / Lens Flare */}
        <g transform="translate(480, 172)">
          <circle cx="0" cy="0" r="10" fill="#ffffff" filter="url(#badgeGlow)" />
          <line x1="-35" y1="0" x2="35" y2="0" stroke="#00f5ff" strokeWidth="3" filter="url(#softGlow)" />
          <line x1="0" y1="-12" x2="0" y2="12" stroke="#ffffff" strokeWidth="2.5" />
          <circle cx="0" cy="0" r="3" fill="#ffffff" />
        </g>

        {/* ========================================================= */}
        {/* 8. AVATAR DISC (Leftmost Circular Emblem with Character) */}
        {/* ========================================================= */}
        <g transform="translate(115, 115)">
          {/* Left Gold Crescent Outer Ring */}
          <path 
            d="M -70 -70 C -125 -10, -125 70, -65 105 C -75 90, -85 45, -75 0 C -70 -35, -55 -60, -70 -70 Z" 
            fill="url(#avatarRingGold)" 
            stroke="#994d00" 
            strokeWidth="2" 
            filter="url(#softGlow)" 
          />

          {/* Outer Glowing Cyan Ring Disc */}
          <circle 
            cx="0" 
            cy="0" 
            r="94" 
            fill="#020d22" 
            stroke="url(#avatarRingBlue)" 
            strokeWidth="9" 
            filter="url(#badgeGlow)" 
          />

          {/* Inner Accent Ring */}
          <circle 
            cx="0" 
            cy="0" 
            r="84" 
            fill="#031633" 
            stroke="#00ffff" 
            strokeWidth="3" 
          />

          {/* Clip path for Avatar Illustration */}
          <clipPath id="avatarClip">
            <circle cx="0" cy="0" r="82" />
          </clipPath>

          {/* Avatar Graphic Inside Circle */}
          <g clipPath="url(#avatarClip)">
            {/* Radial Background behind character */}
            <circle cx="0" cy="0" r="82" fill="#020e24" />
            <circle cx="0" cy="10" r="55" fill="#0284c7" opacity="0.4" filter="url(#badgeGlow)" />

            {/* Character Group */}
            <g transform="translate(0, 5)">
              {/* Hoodie & Shoulders */}
              {/* Black Jacket Base */}
              <path 
                d="M -80 75 
                   C -75 25, -50 0, -25 -10 
                   L 25 -10 
                   C 50 0, 75 25, 80 75 
                   Z" 
                fill="#050b14" 
              />
              {/* Blue Neon Trim on Hoodie */}
              <path 
                d="M -60 75 
                   C -55 35, -35 12, -18 2 
                   L -10 75 
                   Z" 
                fill="#0077cc" 
              />
              <path 
                d="M 60 75 
                   C 55 35, 35 12, 18 2 
                   L 10 75 
                   Z" 
                fill="#0077cc" 
              />
              {/* Inner Collar & Shirt */}
              <polygon points="-12,5 12,5 0,35" fill="#ffffff" />
              <polygon points="-8,7 8,7 0,32" fill="#00f0ff" />

              {/* Neck & Chin */}
              <path 
                d="M -16 -12 
                   L 16 -12 
                   L 12 10 
                   C 12 18, -12 18, -12 10 
                   Z" 
                fill="#ffdfba" 
              />

              {/* Head / Face Shape */}
              <path 
                d="M -28 -35 
                   C -28 -10, -22 15, 0 18 
                   C 22 15, 28 -10, 28 -35 
                   C 28 -55, -28 -55, -28 -35 
                   Z" 
                fill="#ffdfba" 
              />

              {/* Stylish Beard & Stubble */}
              <path 
                d="M -24 -15 
                   C -20 12, -10 18, 0 18 
                   C 10 18, 20 12, 24 -15 
                   L 26 -10 
                   C 22 15, 12 21, 0 21 
                   C -12 21, -22 15, -26 -10 
                   Z" 
                fill="#09131f" 
              />
              {/* Mustache */}
              <path d="M -10 4 C -4 2, 4 2, 10 4 C 5 7, -5 7, -10 4 Z" fill="#09131f" />

              {/* Sunglasses (Cool Black Shades with Blue Glare) */}
              <g transform="translate(0, -20)">
                {/* Left Lens Frame */}
                <path 
                  d="M -26 -6 L -4 -6 C -4 4, -10 12, -24 10 C -27 7, -27 -2, -26 -6 Z" 
                  fill="#030810" 
                  stroke="#00ffff" 
                  strokeWidth="1.5" 
                />
                {/* Right Lens Frame */}
                <path 
                  d="M 4 -6 L 26 -6 C 27 -2, 27 7, 24 10 C 10 12, 4 4, 4 -6 Z" 
                  fill="#030810" 
                  stroke="#00ffff" 
                  strokeWidth="1.5" 
                />
                {/* Bridge */}
                <rect x="-4" y="-5" width="8" height="2.5" fill="#00ffff" />
                {/* Cyan Glare on Sunglasses */}
                <path d="M -22 -3 L -10 7" stroke="#00ffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
                <path d="M 8 -3 L 20 7" stroke="#00ffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
              </g>

              {/* Cool Spiky Hair with Cyan Neon Highlights */}
              {/* Hair Base */}
              <path 
                d="M -30 -35 
                   C -38 -55, -25 -72, -5 -75 
                   C 15 -78, 38 -65, 32 -40 
                   C 36 -48, 30 -60, 20 -66 
                   C 5 -72, -15 -68, -25 -52 
                   Z" 
                fill="#060e1a" 
              />
              {/* Spikes */}
              <path 
                d="M -28 -38 
                   L -36 -52 L -26 -50 
                   L -32 -65 L -18 -58 
                   L -20 -74 L -6 -64 
                   L -2 -80 L 10 -68 
                   L 18 -76 L 24 -62 
                   L 34 -58 L 28 -44 
                   L 33 -34 L 25 -32 
                   Z" 
                fill="#091424" 
              />
              {/* Neon Cyan Highlights on Hair tips */}
              <path d="M -30 -50 L -25 -60" stroke="#00f0ff" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M -18 -66 L -10 -72" stroke="#00f0ff" strokeWidth="3" strokeLinecap="round" />
              <path d="M -2 -74 L 6 -66" stroke="#00f0ff" strokeWidth="3" strokeLinecap="round" />
              <path d="M 14 -72 L 20 -60" stroke="#00f0ff" strokeWidth="2.5" strokeLinecap="round" />
            </g>
          </g>
        </g>
      </svg>
      )}
    </span>
  );
};
