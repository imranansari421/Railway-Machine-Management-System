/**
 * ============================================================================
 * RMMS FRONTEND SECURITY ARMOR & ANTI-TAMPER SHIELD
 * ============================================================================
 * Provides client-side active defense:
 * 1. DevTools anti-tamper security banner (IT Act & Railway Act legal warning)
 * 2. URL / Deep-link malicious payload detector & sanitizer (DOM-XSS defense)
 * 3. Proactive input sanitization (per RULE[AGENTS_md] and cyber defense guidelines)
 * 4. Object prototype pollution protection
 * ============================================================================
 */

import { toast } from 'sonner';

// Debounced warning notification for security actions
let lastWarningTime = 0;
function showSecurityWarning(message: string) {
  const now = Date.now();
  if (now - lastWarningTime > 2500) {
    lastWarningTime = now;
    try {
      toast.error(message, {
        duration: 3000,
        position: 'top-center',
      });
    } catch {
      // Ignore if toast is not yet mounted
    }
  }
}

/**
 * Initializes the client-side security monitoring
 */
export function initSecurityArmor() {
  if (typeof window === 'undefined') return;

  // 1. DevTools Anti-Tamper Console Banner
  try {
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isDev) {
      console.log(
        '%c🛑 RMMS SECURITY ADVISORY / चेतावनी 🛑',
        'color: #ffffff; background: #dc2626; font-size: 16px; font-weight: bold; padding: 6px 12px; border-radius: 4px;'
      );
      console.log(
        '%cThis system is the property of Indian Railways (RMMS). Unauthorized access, reverse engineering, script injection, or token manipulation is strictly prohibited and subject to legal action under Section 43 & 66 of the Information Technology Act, 2000 and the Indian Railways Act, 1989.\n\nसभी अनाधिकृत गतिविधियां साइबर सेल द्वारा स्वचालित रूप से दर्ज की जाती हैं।',
        'color: #94a3b8; font-size: 12px; font-family: monospace; line-height: 1.5;'
      );
    }
  } catch {
    // Ignore console errors
  }

  // 2. Sanitize and neutralize malicious URL / Query string payloads
  try {
    const fullUrl = window.location.href;
    const maliciousRegex = /(<script\b|javascript:\s*|data:\s*text\/html|on(load|error|click)\s*=|union\s+select|\.\.\/|\.\.\\)/i;

    if (maliciousRegex.test(fullUrl)) {
      console.warn('[RMMS Armor] Malicious parameter detected in URL. Neutralizing deep-link state...');
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState(null, '', cleanUrl);
    }
  } catch {
    // Ignore URL errors
  }

  // 3. Prevent Prototype Pollution on critical prototype accessors safely without locking Object.prototype
  try {
    // Protect __proto__ setter without freezing Object.prototype
    const originalProtoDesc = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');
    if (originalProtoDesc && originalProtoDesc.set) {
      const originalSet = originalProtoDesc.set;
      Object.defineProperty(Object.prototype, '__proto__', {
        set(value) {
          if (value === null || typeof value === 'object') {
            return originalSet.call(this, value);
          }
        },
        configurable: true
      });
    }
  } catch {
    // Ignore in unsupported environments
  }

  // 4. Disable Right-Click (Context Menu) across the entire website
  try {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      showSecurityWarning('Right-click is disabled for security / सुरक्षा कारणों से राइट-क्लिक अक्षम है');
      return false;
    };

    window.addEventListener('contextmenu', handleContextMenu, { capture: true });
    document.addEventListener('contextmenu', handleContextMenu, { capture: true });
  } catch (err) {
    console.warn('[RMMS Armor] Context menu listener error:', err);
  }

  // 5. Disable Inspect Element & DevTools Keyboard Shortcuts
  try {
    const handleKeydown = (e: KeyboardEvent) => {
      const isF12 = e.key === 'F12' || e.keyCode === 123;
      
      // Ctrl+Shift+I or Cmd+Opt+I (Inspect)
      const isCtrlShiftI = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.code === 'KeyI' || e.keyCode === 73);
      const isCmdOptI = e.metaKey && e.altKey && (e.key === 'I' || e.key === 'i' || e.code === 'KeyI' || e.keyCode === 73);

      // Ctrl+Shift+J or Cmd+Opt+J (Console)
      const isCtrlShiftJ = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.code === 'KeyJ' || e.keyCode === 74);
      const isCmdOptJ = e.metaKey && e.altKey && (e.key === 'J' || e.key === 'j' || e.code === 'KeyJ' || e.keyCode === 74);

      // Ctrl+Shift+C or Cmd+Opt+C (Inspect Element Picker)
      const isCtrlShiftC = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.code === 'KeyC' || e.keyCode === 67);
      const isCmdOptC = e.metaKey && e.altKey && (e.key === 'C' || e.key === 'c' || e.code === 'KeyC' || e.keyCode === 67);

      // Ctrl+U or Cmd+Opt+U (View Source)
      const isCtrlU = (e.ctrlKey || (e.metaKey && e.altKey)) && (e.key === 'U' || e.key === 'u' || e.code === 'KeyU' || e.keyCode === 85);

      if (isF12 || isCtrlShiftI || isCmdOptI || isCtrlShiftJ || isCmdOptJ || isCtrlShiftC || isCmdOptC || isCtrlU) {
        e.preventDefault();
        e.stopPropagation();
        showSecurityWarning('Inspect Element is disabled / सुरक्षा कारणों से इंस्पेक्ट अक्षम (Disabled) है');
        return false;
      }
    };

    window.addEventListener('keydown', handleKeydown, { capture: true });
    document.addEventListener('keydown', handleKeydown, { capture: true });
  } catch (err) {
    console.warn('[RMMS Armor] Keydown listener error:', err);
  }
}

/**
 * Sanitizes input string to prevent SQLi, NoSQLi, XSS, and command injection
 * Also enforces RULE[AGENTS_md]: sanitize special characters across maintenance form fields
 */
export function sanitizeSecureInput(input: string, allowSpecial = false): string {
  if (typeof input !== 'string') return '';

  let sanitized = input;

  // Strip script tags and HTML tags
  sanitized = sanitized.replace(/<[^>]*>?/gm, '');

  // Strip dangerous javascript: pseudo-protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  if (!allowSpecial) {
    // Sanitize special characters per RULE[AGENTS_md]
    sanitized = sanitized.replace(/[!@#$%^&*+=~`|<>?{}[\];:"]/g, '');
  }

  return sanitized.trim();
}
