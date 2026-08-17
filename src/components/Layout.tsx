import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Package, ClipboardList, FileText, UserCircle, LogOut, Factory, Bell, CheckCheck, Trash2, X, MessageSquare, FolderOpen, Clock, Menu, Wrench, ArrowRightLeft, AlertTriangle, CalendarClock, UserCheck, Droplet, Mail, Building2, Cpu, Store } from 'lucide-react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, updateDoc, writeBatch, deleteDoc, getDocs, getDoc } from 'firebase/firestore';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { findEmployeeForUser } from '../utils/employee';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/inbox', label: 'Inbox', icon: Mail },
  { path: '/hr', label: 'HR', icon: Users },
  { path: '/contracts', label: 'Machine Contracts', icon: CalendarClock },
  { path: '/store', label: 'Store', icon: Store },
  { path: '/catalog', label: 'Inventory', icon: Package },
  { path: '/demand', label: 'Demand', icon: ClipboardList },
  { path: '/maintenance', label: 'Maintenance', icon: Wrench },
  { path: '/machine-movement', label: 'Machine Movement', icon: ArrowRightLeft },
  { path: '/break-down', label: 'Break Down/Failure', icon: AlertTriangle },
  { path: '/issue', label: 'Issue', icon: FileText },
  { path: '/report', label: 'Report', icon: FileText },
  { path: '/service-engineer-report', label: 'Services Engineer Report', icon: UserCheck },
  { path: '/consumption', label: 'Consumption', icon: Droplet },
  { path: '/messages', label: 'Messages', icon: MessageSquare },
  { path: '/todos', label: 'Folders', icon: FolderOpen },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [appTitle, setAppTitle] = useState(() => {
    return localStorage.getItem('appTitle') || "Active Engineers Railway";
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebarOpen');
    return saved !== null ? saved === 'true' : true;
  });

  const toggleSidebar = () => {
    setIsSidebarOpen(prev => {
      const next = !prev;
      localStorage.setItem('sidebarOpen', String(next));
      return next;
    });
  };

  const [timeLeft, setTimeLeft] = useState<number>(1800); // 30 minutes in seconds
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);
  const [modalTimeLeft, setModalTimeLeft] = useState(60);

  const handleLogout = async () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem('sessionExpiryTime');
      localStorage.setItem('sessionLoggedOut', Date.now().toString());
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleKeepWorking = () => {
    const newExpiry = (Date.now() + 30 * 60 * 1000).toString();
    localStorage.setItem('sessionExpiryTime', newExpiry);
    setTimeLeft(1800);
    setShowTimeoutModal(false);
  };

  // Core session checking function using absolute timestamps
  const checkSession = () => {
    if (!auth.currentUser) return;

    // 1. Check if another tab triggered logout
    const loggedOutSignal = localStorage.getItem('sessionLoggedOut');
    if (loggedOutSignal) {
      localStorage.removeItem('sessionExpiryTime');
      localStorage.removeItem('sessionLoggedOut');
      handleLogout();
      return;
    }

    const currentExpiryStr = localStorage.getItem('sessionExpiryTime');
    if (!currentExpiryStr) return;

    const expiryTime = parseInt(currentExpiryStr, 10);
    const now = Date.now();

    // If we are past the 30 min + 60 sec warning period, logout immediately
    if (now >= expiryTime + 60 * 1000) {
      localStorage.removeItem('sessionExpiryTime');
      handleLogout();
      return;
    }

    // If we are past the 30 min limit
    if (now >= expiryTime) {
      setShowTimeoutModal(true);
      // Calculate precise remaining warning seconds based on absolute timestamps
      const modalRemaining = Math.max(0, Math.ceil(((expiryTime + 60 * 1000) - now) / 1000));
      setModalTimeLeft(modalRemaining);
      setTimeLeft(0);

      if (modalRemaining <= 0) {
        localStorage.removeItem('sessionExpiryTime');
        handleLogout();
      }
    } else {
      // We are still within the 30 min session
      setShowTimeoutModal(false);
      const remaining = Math.max(0, Math.ceil((expiryTime - now) / 1000));
      setTimeLeft(remaining);
    }
  };

  // Run the session checking timer and activity focus listeners
  useEffect(() => {
    if (!auth.currentUser) return;

    // Clear any previous log out signals and initialize expiry if not set
    localStorage.removeItem('sessionLoggedOut');
    let expiry = localStorage.getItem('sessionExpiryTime');
    if (!expiry) {
      const newExpiry = (Date.now() + 30 * 60 * 1000).toString();
      localStorage.setItem('sessionExpiryTime', newExpiry);
    }

    // Run initial check
    checkSession();

    // Set up a standard 1-second interval
    const interval = setInterval(() => {
      checkSession();
    }, 1000);

    // Event listeners to run session checks immediately when tab is focused/visible
    const handleActivity = () => {
      checkSession();
    };

    window.addEventListener('visibilitychange', handleActivity);
    window.addEventListener('focus', handleActivity);
    window.addEventListener('pageshow', handleActivity);

    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleActivity);
      window.removeEventListener('focus', handleActivity);
      window.removeEventListener('pageshow', handleActivity);
    };
  }, [auth.currentUser, showTimeoutModal]);

  // Synchronize across multiple browser tabs using storage event
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'sessionExpiryTime' || e.key === 'sessionLoggedOut') {
        checkSession();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [accessType, setAccessType] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || 'limited' : 'limited';
  });
  const [layoutCompanyName, setLayoutCompanyName] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`companyName_${auth.currentUser.uid}`) || '' : '';
  });
  const [layoutMachineName, setLayoutMachineName] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`userMachineName_${auth.currentUser.uid}`) || '' : '';
  });

  const isAdminOrFullAccess = !isEmployee || accessType === 'full';

  const filteredNavItems = navItems.filter((item) => {
    if (item.path === '/contracts') {
      return !isEmployee; // Machine Contracts is strictly restricted to Primary ADMIN accounts
    }
    if (isEmployee) {
      if (item.path === '/hr') {
        return accessType === 'full' || accessType === 'admin-light';
      }
      if (item.path === '/store') {
        return accessType === 'full' || accessType === 'admin-light';
      }
    }
    return true;
  });

  const fetchProfilePhoto = async () => {
    if (!auth.currentUser) return;
    try {
      const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
      if (emp) {
        if (emp.photoUrl) {
          setPhotoUrl(emp.photoUrl);
        }
        setAccessType(emp.accessType || 'limited');
        localStorage.setItem(`accessType_${auth.currentUser.uid}`, emp.accessType || 'limited');
        if (emp.companyName) {
          setLayoutCompanyName(emp.companyName);
          localStorage.setItem(`companyName_${auth.currentUser.uid}`, emp.companyName);
        }
        if (emp.machineName) {
          setLayoutMachineName(emp.machineName);
          localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, emp.machineName);
        }
      }
    } catch (error) {
      console.error('Error loading layout profile photo:', error);
    }
  };

  useEffect(() => {
    const APP_TITLE = "RMMS - Railway Machine Management System";
    document.title = APP_TITLE;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.document.title = APP_TITLE;
      }
    } catch {
      // Ignore iframe CORS
    }
  }, [location.pathname]);

  useEffect(() => {
    fetchProfilePhoto();

    const handleProfileUpdate = () => {
      fetchProfilePhoto();
    };

    window.addEventListener('profile-updated', handleProfileUpdate);
    return () => {
      window.removeEventListener('profile-updated', handleProfileUpdate);
    };
  }, []);

  useEffect(() => {
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.appTitle) {
          setAppTitle(data.appTitle);
          localStorage.setItem('appTitle', data.appTitle);
        }
      }
    }, (error) => {
      console.warn("Failed to listen to general settings in Layout:", error);
    });

    return () => unsubscribeSettings();
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;

    const syncNotifications = async () => {
      const user = auth.currentUser;
      if (!user || !user.email) return;

      try {
        // Fetch current user's employee details first
        const empProfile = await findEmployeeForUser(user.uid, user.email);

        // 1. Sync employee-specific notifications that are targeted to this user's email but don't have their uid set yet
        const pendingSnap = await getDocs(
          query(
            collection(db, 'notifications'),
            where('targetEmail', '==', user.email),
            where('uid', '==', '')
          )
        );

        if (!pendingSnap.empty) {
          const batch = writeBatch(db);
          pendingSnap.docs.forEach((docSnap) => {
            batch.update(doc(db, 'notifications', docSnap.id), {
              uid: user.uid
            });
          });
          await batch.commit();
        }

        // 2. Fetch master / announcement notifications
        const [globalSnap, masterSnap] = await Promise.all([
          getDocs(query(collection(db, 'notifications'), where('target', '==', 'all'))),
          getDocs(query(collection(db, 'notifications'), where('isMaster', '==', true)))
        ]);

        const uniqueDocsMap = new Map<string, any>();
        globalSnap.docs.forEach(d => uniqueDocsMap.set(d.id, d.data()));
        masterSnap.docs.forEach(d => uniqueDocsMap.set(d.id, d.data()));

        if (uniqueDocsMap.size > 0) {
          // Fetch existing user-specific notifications that have a parentId
          const userNotificationsSnap = await getDocs(
            query(
              collection(db, 'notifications'),
              where('uid', '==', user.uid)
            )
          );

          const existingParentIds = new Set(
            userNotificationsSnap.docs
              .map(doc => doc.data().parentId)
              .filter(Boolean)
          );

          const batch = writeBatch(db);
          let needsCommit = false;

          uniqueDocsMap.forEach((data, docId) => {
            // If the user doesn't have a copy of this notification yet
            if (!existingParentIds.has(docId)) {
              
              // Skip if notification is older than 15 days and user is an employee
              const createdTime = new Date(data.createdAt).getTime();
              const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
              const isOld = createdTime < fifteenDaysAgo;
              if (isEmployee && isOld) {
                return;
              }

              // Determine targeting eligibility
              let matches = false;

              if (!isEmployee) {
                // Top-level admin sees everything
                matches = true;
              } else {
                // Current user is an employee. Retrieve their metadata:
                const empMachine = empProfile?.machineName || '';
                const empCompany = empProfile?.companyName || '';
                const empId = empProfile?.employeeId || '';
                const empAccessType = empProfile?.accessType || 'limited';

                if (data.createdByAccessType === 'full') {
                  // "Full access admin jab notification create kare to uska notifications only us machine ke employee ko show kare or admin light company, Admin ko show kare"
                  if (empMachine === data.createdByMachine || empAccessType === 'admin-light') {
                    matches = true;
                  }
                } else if (data.createdByAccessType === 'admin-light') {
                  // "aur admin light company create kare to us company me jitne bhe employee hai usko show kare or admin ko bhe"
                  if (empCompany === data.createdByCompany) {
                    if (!data.targetMachine || data.targetMachine === 'all' || empMachine === data.targetMachine) {
                      matches = true;
                    }
                  }
                } else {
                  // Created by Main Admin
                  // "admin create company, machine & employee wise notifications create kar sake"
                  const companyMatch = !data.targetCompany || data.targetCompany === 'all' || empCompany === data.targetCompany;
                  const machineMatch = !data.targetMachine || data.targetMachine === 'all' || empMachine === data.targetMachine;
                  const employeeMatch = !data.targetEmployeeId || data.targetEmployeeId === 'all' || empId === data.targetEmployeeId;

                  if (companyMatch && machineMatch && employeeMatch) {
                    matches = true;
                  }
                }
              }

              if (matches) {
                const newRef = doc(collection(db, 'notifications'));
                batch.set(newRef, {
                  uid: user.uid,
                  parentId: docId,
                  title: data.title,
                  message: data.message,
                  createdAt: data.createdAt,
                  read: false,
                  type: data.type || 'announcement'
                });
                needsCommit = true;
              }
            }
          });

          if (needsCommit) {
            await batch.commit();
          }
        }
      } catch (err) {
        console.error('Error syncing notifications for user:', err);
      }
    };

    syncNotifications();
  }, [isEmployee]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'notifications'),
      where('uid', '==', auth.currentUser.uid)
    );

    const unsubscribeNotifications = onSnapshot(q, async (snapshot) => {
      let list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
      
      // Filter out notifications older than 15 days for employees
      if (isEmployee) {
        const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
        list = list.filter((n: any) => {
          const createdTime = new Date(n.createdAt).getTime();
          return createdTime >= fifteenDaysAgo;
        });
      }

      const parentIds = Array.from(new Set(list.map((n: any) => n.parentId).filter(Boolean))) as string[];
      if (parentIds.length > 0) {
        try {
          const parentSnaps = await Promise.all(
            parentIds.map(id => getDoc(doc(db, 'notifications', id)).catch(() => null))
          );
          const existingParentIds = new Set(
            parentSnaps
              .filter((snap): snap is NonNullable<typeof snap> => !!snap && snap.exists())
              .map(snap => snap.id)
          );
          
          const filteredList = list.filter((n: any) => {
            if (n.parentId && !existingParentIds.has(n.parentId)) {
              deleteDoc(doc(db, 'notifications', n.id)).catch(() => {});
              return false;
            }
            return true;
          });
          
          filteredList.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setNotifications(filteredList);
        } catch (e) {
          console.error("Error filtering deleted parent notifications:", e);
          list.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setNotifications(list);
        }
      } else {
        list.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setNotifications(list);
      }
    }, (error) => {
      console.error("Error listening to notifications:", error);
    });

    return () => {
      unsubscribeNotifications();
    };
  }, [isEmployee]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const batch = writeBatch(db);
      notifications.forEach((n) => {
        if (!n.read) {
          batch.update(doc(db, 'notifications', n.id), { read: true });
        }
      });
      await batch.commit();
    } catch (err) {
      console.error("Error marking all as read:", err);
    }
  };

  const handleClearNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const notifRef = doc(db, 'notifications', id);
      const notifSnap = await getDoc(notifRef);
      if (notifSnap.exists()) {
        const notifData = notifSnap.data();
        const batch = writeBatch(db);
        
        batch.delete(notifRef);
        
        if (notifData.target === 'all') {
          const clonesSnap = await getDocs(
            query(collection(db, 'notifications'), where('parentId', '==', id))
          );
          clonesSnap.docs.forEach((cloneDoc) => {
            batch.delete(doc(db, 'notifications', cloneDoc.id));
          });
        }
        
        if (notifData.parentId) {
          batch.delete(doc(db, 'notifications', notifData.parentId));
          const clonesSnap = await getDocs(
            query(collection(db, 'notifications'), where('parentId', '==', notifData.parentId))
          );
          clonesSnap.docs.forEach((cloneDoc) => {
            batch.delete(doc(db, 'notifications', cloneDoc.id));
          });
        }
        
        await batch.commit();
      } else {
        await deleteDoc(notifRef);
      }
    } catch (err) {
      console.error("Error deleting notification:", err);
    }
  };

  const handleClearAll = async () => {
    try {
      const batch = writeBatch(db);
      for (const n of notifications) {
        batch.delete(doc(db, 'notifications', n.id));
        
        if (n.target === 'all') {
          const clonesSnap = await getDocs(
            query(collection(db, 'notifications'), where('parentId', '==', n.id))
          );
          clonesSnap.docs.forEach((cloneDoc) => {
            batch.delete(doc(db, 'notifications', cloneDoc.id));
          });
        }
        
        if (n.parentId) {
          batch.delete(doc(db, 'notifications', n.parentId));
          const clonesSnap = await getDocs(
            query(collection(db, 'notifications'), where('parentId', '==', n.parentId))
          );
          clonesSnap.docs.forEach((cloneDoc) => {
            batch.delete(doc(db, 'notifications', cloneDoc.id));
          });
        }
      }
      await batch.commit();
    } catch (err) {
      console.error("Error clearing notifications:", err);
    }
  };



  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top App Bar (Header) */}
      <motion.header 
        initial={{ y: -64 }}
        animate={{ y: 0 }}
        className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200/80 shadow-sm flex items-center justify-between px-4 md:px-6 z-50"
      >
        {/* Left Side: Toggle button + Logo + Title */}
        <div className="flex items-center gap-3">
          {/* Menu Hamburger Toggle Button */}
          <button
            onClick={toggleSidebar}
            className="p-2.5 text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded-xl transition-all focus:outline-none"
            title="Toggle Sidebar"
          >
            <Menu size={20} className="stroke-[2.5]" />
          </button>

          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <Factory className="text-indigo-600" size={18} />
            </div>
            {/* Title */}
            <span className="text-sm md:text-base font-black tracking-tight text-slate-900 select-none">
              {appTitle || "Railway Machine Management System"}
            </span>
          </div>
        </div>

        {/* Right Side: Timer, Notifications, Profile Settings, Logout */}
        <div className="flex items-center gap-4">
          
          {/* Countdown Timer */}
          {auth.currentUser && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200/60 rounded-xl text-amber-800" title="Session ends after this time">
              <Clock size={14} className="text-amber-600 animate-pulse shrink-0" />
              <span className="text-xs font-black font-mono tracking-wider">
                {formatTime(timeLeft)}
              </span>
            </div>
          )}

          {/* Notifications Trigger & Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className={cn(
                "p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-xl transition-all relative group",
                showNotifications ? "bg-slate-50 text-indigo-600" : ""
              )}
              title="Notifications"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-black flex items-center justify-center rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown (Flydown) */}
            <AnimatePresence>
              {showNotifications && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden z-50 flex flex-col max-h-[460px]"
                  >
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        Notifications
                        {unreadCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] rounded-full font-bold">
                            {unreadCount} new
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        {unreadCount > 0 && (
                          <button
                            onClick={handleMarkAllAsRead}
                            className="p-1.5 text-slate-400 hover:text-indigo-950 rounded hover:bg-slate-200 transition-colors"
                            title="Mark all as read"
                          >
                            <CheckCheck size={16} />
                          </button>
                        )}
                        {isAdminOrFullAccess && notifications.length > 0 && (
                          <button
                            onClick={handleClearAll}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-200 transition-colors"
                            title="Clear all notifications"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setShowNotifications(false)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 overflow-y-auto flex-grow max-h-[350px]">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => handleMarkAsRead(n.id)}
                          className={cn(
                            "p-4 cursor-pointer hover:bg-slate-50 transition-colors flex gap-3 relative group",
                            !n.read ? "bg-indigo-50/20" : ""
                          )}
                        >
                          <div className={cn(
                            "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                            !n.read ? "bg-indigo-600" : "bg-transparent"
                          )} />
                          <div className="flex-grow space-y-1">
                            <div className="flex items-center justify-between">
                              <span className={cn(
                                "text-xs font-bold",
                                n.type === 'approval' ? "text-emerald-700" :
                                n.type === 'rejection' ? "text-rose-700" : "text-slate-800"
                              )}>
                                {n.title}
                              </span>
                              <span className="text-[9px] font-medium text-slate-400">
                                {n.createdAt ? new Date(n.createdAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : ''}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 leading-normal">{n.message}</p>
                          </div>
                          {isAdminOrFullAccess && (
                            <button
                              onClick={(e) => handleClearNotification(n.id, e)}
                              className="absolute right-2 bottom-2 p-1 text-slate-300 hover:text-red-500 rounded hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all"
                              title="Delete"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))}

                      {notifications.length === 0 && (
                        <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                          <Bell size={32} className="text-slate-300 stroke-[1.5]" />
                          <p className="text-xs font-semibold">No notifications</p>
                          <p className="text-[10px]">We'll let you know when the admin reviews your profile.</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Profile Settings Link */}
          <Link
            to="/profile"
            className="flex items-center gap-2 p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-xl transition-all group"
            title="Profile Settings"
          >
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shrink-0">
              {photoUrl ? (
                <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <UserCircle size={20} className="text-slate-400" />
              )}
            </div>
            <span className="text-xs font-bold text-slate-700 hidden lg:inline max-w-[120px] truncate">
              Profile Settings
            </span>
          </Link>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl transition-all font-bold text-xs"
            title="Logout"
          >
            <LogOut size={14} className="shrink-0" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </motion.header>

      {/* Sidebar + Main Content Layout */}
      <div className="flex pt-16 min-h-[calc(100vh-4rem)] relative">
        
        {/* Left Sidebar */}
        <aside 
          className={cn(
            "fixed top-16 left-0 bottom-0 bg-slate-950 text-slate-100 flex flex-col justify-between py-6 px-3 z-40 border-r border-slate-900 transition-all duration-300 shadow-xl overflow-y-auto",
            isSidebarOpen ? "w-64 translate-x-0" : "w-0 -translate-x-full overflow-hidden p-0 border-r-0"
          )}
        >
          {/* Navigation stack */}
          <div className="flex flex-col gap-1.5 w-full">
            {filteredNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-bold text-sm transition-all relative group",
                    isActive
                      ? "text-white bg-indigo-600 shadow-lg shadow-indigo-600/30"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/40"
                  )}
                  title={item.label}
                >
                  <Icon size={18} className={isActive ? "text-white shrink-0" : "text-slate-400 group-hover:text-white shrink-0"} />
                  <span className="tracking-tight truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </aside>

        {/* Main Content Area */}
        <div 
          className={cn(
            "flex-grow min-h-screen flex flex-col transition-all duration-300 w-full",
            isSidebarOpen ? "md:pl-64" : "md:pl-0"
          )}
        >
          {/* If sidebar is open on mobile, render a subtle overlay backdrop to allow closing it */}
          {isSidebarOpen && (
            <div 
              className="fixed inset-0 bg-black/20 md:hidden z-30" 
              onClick={() => setIsSidebarOpen(false)}
            />
          )}

          <main className="flex-grow p-4 md:p-8 max-w-7xl mx-auto w-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>

          <footer className="w-full border-t border-slate-100 bg-white/50 backdrop-blur-sm py-4 flex flex-col sm:flex-row items-center justify-between px-4 md:px-8 gap-4 text-xs text-slate-500">
            <p className="font-semibold text-slate-400">System version 1.4.0 | © {new Date().getFullYear()} Railway Machinery. All rights reserved.</p>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-bold">System Engineered:</span>
              <div className="glitch-container">
                <span className="glitch-text text-indigo-600 font-black tracking-widest text-[11px]" data-text="Developed By IMRAN">
                  Developed By IMRAN
                </span>
              </div>
            </div>
          </footer>
        </div>

      </div>

      {/* Session Timeout Warning Modal */}
      <AnimatePresence>
        {showTimeoutModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
              onClick={handleLogout}
            />

            {/* Modal Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-6 md:p-8 shadow-2xl border border-slate-200 flex flex-col items-center text-center space-y-6 overflow-hidden z-10"
            >
              {/* Animated visual indicator */}
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center animate-pulse">
                  <Clock className="text-rose-600 stroke-[2.5]" size={30} />
                </div>
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500"></span>
                </span>
              </div>

              {/* Message block */}
              <div className="space-y-2">
                <h3 className="text-xl font-black text-slate-800 tracking-tight">
                  Session Timeout Warning
                </h3>
                <p className="text-xs text-rose-600 font-extrabold uppercase tracking-wider font-mono bg-rose-50 px-3 py-1.5 rounded-full inline-block">
                  Session will expire in {modalTimeLeft} seconds
                </p>
                <div className="text-xs text-slate-500 font-semibold leading-relaxed pt-2 space-y-1">
                  <p>Your session is about to expire due to inactivity.</p>
                  <p>Do you want to continue working?</p>
                  <div className="border-t border-slate-100 my-2 pt-2 text-[11px] text-slate-400 italic">
                    निष्क्रियता के कारण आपका सत्र समाप्त होने वाला है। क्या आप काम जारी रखना चाहते हैं?
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black rounded-xl transition-all border border-slate-200/50 hover:border-slate-300 active:scale-95"
                >
                  No, Logout (लॉगआउट करें)
                </button>
                <button
                  type="button"
                  onClick={handleKeepWorking}
                  className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/35 transition-all border border-indigo-700 active:scale-95 flex items-center justify-center gap-1.5"
                >
                  Yes, Continue (काम जारी रखें)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
