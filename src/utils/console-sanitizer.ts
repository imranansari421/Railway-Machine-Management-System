/**
 * Global Console Sanitizer
 * Intercepts console logging methods to sanitize complex/circular structures
 * (such as native Firestore objects or minified SDK internal classes)
 * before they reach any environment-level serialization proxies.
 */

function sanitizeConsoleArgs(args: any[]): any[] {
  const seen = new WeakSet<any>();

  function clean(val: any, depth: number = 0): any {
    if (depth > 4) return '[Max Depth]';
    if (val === null || val === undefined) return val;

    const type = typeof val;
    if (type !== 'object' && type !== 'function') {
      return val;
    }

    if (type === 'function') {
      return `[Function: ${val.name || 'anonymous'}]`;
    }

    // It is an object
    try {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    } catch (_) {
      // If WeakSet fails (e.g., non-extensible objects in some JS runtimes)
      return '[Un-trackable Object]';
    }

    if (Array.isArray(val)) {
      const res = val.map(item => clean(item, depth + 1));
      return res;
    }

    if (val instanceof Error) {
      const cleanedErr: any = {
        name: val.name,
        message: val.message,
        stack: val.stack
      };
      // Copy any extra enumerable properties
      for (const k of Object.keys(val)) {
        try {
          cleanedErr[k] = clean((val as any)[k], depth + 1);
        } catch (_) {}
      }
      return cleanedErr;
    }

    // Safeguard for common native / library objects that we shouldn't deep-traverse
    const constructorName = val.constructor?.name;
    if (constructorName && (
      constructorName.includes('Firestore') ||
      constructorName.includes('Database') ||
      constructorName.includes('Reference') ||
      constructorName.includes('Query') ||
      constructorName.includes('Transaction') ||
      constructorName.includes('Snapshot') ||
      constructorName.includes('Auth') ||
      constructorName.includes('User') ||
      constructorName.includes('Window') ||
      constructorName.includes('Document') ||
      constructorName.includes('HTML') ||
      constructorName.startsWith('Y2') ||
      constructorName.startsWith('Ka')
    )) {
      return `[Native Object: ${constructorName}]`;
    }

    // Plain object copy
    const cleanedObj: any = {};
    const keys = Object.keys(val);
    for (const key of keys) {
      try {
        cleanedObj[key] = clean(val[key], depth + 1);
      } catch (e) {
        cleanedObj[key] = `[Error Reading Property: ${e instanceof Error ? e.message : String(e)}]`;
      }
    }
    return cleanedObj;
  }

  return args.map(arg => {
    try {
      return clean(arg);
    } catch (e) {
      return `[Sanitization Failed: ${e instanceof Error ? e.message : String(e)}]`;
    }
  });
}

const originalError = console.error;
const originalLog = console.log;
const originalWarn = console.warn;
const originalInfo = console.info;

function isHarmlessMessage(args: any[]): boolean {
  return args.some(arg => {
    if (!arg) return false;
    const str = typeof arg === 'string' ? arg : (() => { try { return JSON.stringify(arg); } catch (_) { return ''; } })();
    return str.includes('Detected an update time that is in the future') ||
           str.includes('update time that is in the future') ||
           str.includes('BloomFilter');
  });
}

console.error = function(...args: any[]) {
  if (isHarmlessMessage(args)) return;
  originalError.apply(console, sanitizeConsoleArgs(args));
};

console.log = function(...args: any[]) {
  originalLog.apply(console, sanitizeConsoleArgs(args));
};

console.warn = function(...args: any[]) {
  if (isHarmlessMessage(args)) return;
  originalWarn.apply(console, sanitizeConsoleArgs(args));
};

console.info = function(...args: any[]) {
  originalInfo.apply(console, sanitizeConsoleArgs(args));
};

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (
      event.message === 'Script error.' ||
      (event.filename && event.filename.includes('effectivecpmnetwork')) ||
      !event.filename
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      return true;
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    if (
      event.reason &&
      (event.reason.message === 'Script error.' || String(event.reason).includes('effectivecpmnetwork'))
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    }
  }, true);
}

export {};
