import { auth } from '../firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function safeJsonStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';

  const seen = new WeakSet<any>();

  function clean(val: any, depth: number = 0): any {
    if (depth > 5) return '[Max Depth Reached]';
    if (val === null) return null;
    if (val === undefined) return undefined;
    
    const type = typeof val;
    if (type === 'string' || type === 'number' || type === 'boolean') {
      return val;
    }
    if (type === 'function') return '[Function]';
    if (type === 'symbol') return '[Symbol]';
    if (type === 'bigint') return val.toString();

    if (type === 'object') {
      try {
        if (seen.has(val)) {
          return '[Circular]';
        }
        seen.add(val);
      } catch (_) {
        return '[Un-trackable Object]';
      }

      if (Array.isArray(val)) {
        const cleanedArray = val.map(item => clean(item, depth + 1));
        return cleanedArray;
      }

      if (val instanceof Error) {
        const cleanedErr: any = {
          name: val.name,
          message: val.message,
          stack: val.stack
        };
        for (const k of Object.keys(val)) {
          try {
            cleanedErr[k] = clean((val as any)[k], depth + 1);
          } catch (_) {}
        }
        return cleanedErr;
      }

      // Safeguard against deep traversing native classes/objects
      const constructorName = val.constructor?.name;
      if (constructorName && (
        constructorName.startsWith('Y2') || 
        constructorName.startsWith('Ka') || 
        constructorName.includes('Firestore') || 
        constructorName.includes('Database') || 
        constructorName.includes('Reference') || 
        constructorName.includes('Query') ||
        constructorName.includes('Transaction') ||
        constructorName.includes('Window') ||
        constructorName.includes('Document') ||
        constructorName.includes('HTML')
      )) {
        return `[Native/Firebase Object: ${constructorName}]`;
      }

      const cleanedObj: any = {};
      const keys = Object.keys(val);
      for (const key of keys) {
        try {
          cleanedObj[key] = clean(val[key], depth + 1);
        } catch (e) {
          cleanedObj[key] = `[Unreadable: ${e instanceof Error ? e.message : String(e)}]`;
        }
      }
      return cleanedObj;
    }

    return '[Unknown Type]';
  }

  try {
    const cleaned = clean(obj);
    return JSON.stringify(cleaned);
  } catch (err) {
    return `[Serialization Failed: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', safeJsonStringify(errInfo));
  throw new Error(safeJsonStringify(errInfo));
}
