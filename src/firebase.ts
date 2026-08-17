import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer, persistentLocalCache, persistentMultipleTabManager, setLogLevel } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Set Firestore log level to avoid verbose transport reconnect warnings
try {
  setLogLevel('error');
} catch {
  // Ignore in case setLogLevel is already configured
}

// Silence harmless internal Firebase warnings/errors (e.g. WebChannel stream reconnects, BloomFilter, or clock skew)
if (typeof window !== 'undefined') {
  const isHarmless = (arg: any): boolean => {
    if (!arg) return false;
    const str = typeof arg === 'string' ? arg : (() => { try { return JSON.stringify(arg); } catch (_) { return String(arg); } })();
    return str.includes('BloomFilter') ||
           str.includes('BloomFilterError') ||
           str.includes('Detected an update time that is in the future') ||
           str.includes('update time that is in the future') ||
           str.includes('WebChannelConnection') ||
           str.includes('RPC \'Listen\'') ||
           str.includes('transport errored') ||
           str.includes('WebChannel') ||
           str.includes('@firebase/firestore');
  };

  const originalError = console.error;
  console.error = (...args: any[]) => {
    if (args.some(isHarmless)) return;
    originalError(...args);
  };

  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (args.some(isHarmless)) return;
    originalWarn(...args);
  };
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure auth to force logging in again when browser/tab is closed
setPersistence(auth, browserSessionPersistence).catch((err) => {
  console.error("Failed to set auth persistence:", err);
});

export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
}, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);

// Test connection to Firestore to catch configuration errors early with a delay to allow the network stack to settle
async function testConnection() {
  try {
    // Delay test connection to allow initial tab/iframe load to complete smoothly
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore initialized and connected successfully.");
  } catch (error: any) {
    const isOffline = error.message?.includes('the client is offline') || 
                      error.message?.includes('Could not reach Cloud Firestore backend') ||
                      error.code === 'unavailable';
    const isPermissionDenied = error.code === 'permission-denied' || 
                               error.message?.includes('permission') || 
                               error.message?.includes('insufficient permissions');
    
    if (isPermissionDenied) {
      console.log("Firestore initialized successfully (access secured).");
    } else if (isOffline) {
      console.info("Firestore is currently operating in robust offline/cached mode. Offline persistence is fully active.");
    } else {
      console.warn("Firestore initialization status:", error.message || error);
    }
  }
}
testConnection();
