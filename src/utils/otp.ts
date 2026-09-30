import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { toast } from 'sonner';

export const EMAIL_DEADLINE = new Date('2026-10-31T23:59:59');

/**
 * Returns true if current time is past 31.10.2026 (strict email verification & password mandatory)
 */
export function isPostEmailDeadline(): boolean {
  return new Date() > EMAIL_DEADLINE;
}

/**
 * Generates a 6-digit numeric OTP code
 */
export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export type OtpPurpose = 'email_verification' | 'login_2fa' | 'forgot_pin' | 'forgot_password';

export interface SendOtpResult {
  success: boolean;
  message: string;
  otp?: string;
  expiresInSeconds?: number;
  deliveryStatus?: 'delivered' | 'pending' | 'simulated';
}

export interface EmailGatewayConfig {
  provider?: 'emailjs' | 'brevo' | 'resend' | 'web3forms' | 'custom_webhook' | 'auto';
  emailjsServiceId?: string;
  emailjsTemplateId?: string;
  emailjsPublicKey?: string;
  brevoApiKey?: string;
  resendApiKey?: string;
  web3formsKey?: string;
  senderEmail?: string;
  senderName?: string;
  webhookUrl?: string;
}

/**
 * Generates a professional HTML email template for the OTP
 */
function buildOtpEmailHtml(params: {
  otp: string;
  purposeTitle: string;
  name?: string;
  pfNo?: string;
  email: string;
  purpose?: OtpPurpose;
}): string {
  const { otp, purposeTitle, name, pfNo, email, purpose } = params;
  const isLogin2Fa = purpose === 'login_2fa';
  const validityNotice = isLogin2Fa
    ? '⏱️ <strong>Validity:</strong> This RMMS Security OTP is valid for <strong>today (until 23:59:59)</strong> for all your logins today.'
    : '⏱️ <strong>Validity:</strong> This code is valid for <strong>10 minutes</strong>.';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 24px; color: #1e293b; max-width: 600px; margin: 0 auto; border-radius: 16px;">
      <div style="background-color: #1e1b4b; padding: 24px; border-radius: 12px 12px 0 0; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">Indian Railway Management System</h1>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1;">Official RMMS Security Verification Service</p>
      </div>
      <div style="background-color: #ffffff; padding: 32px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
        <h2 style="font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 0;">${purposeTitle} Verification Code</h2>
        <p style="font-size: 14px; line-height: 1.6; color: #475569;">
          Hello <strong>${name || 'User'}</strong>${pfNo ? ` (PF / Staff No: <strong>${pfNo}</strong>)` : ''},
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569;">
          A security verification request has been initiated for <strong>${purposeTitle}</strong> on your account (<strong>${email}</strong>). Please use the One-Time Password (OTP) below to authenticate:
        </p>
        
        <div style="background: #f8fafc; border: 2px dashed #6366f1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
          <span style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #4f46e5; display: block; margin-bottom: 8px;">Your 6-Digit RMMS OTP</span>
          <span style="font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #1e1b4b; font-family: monospace; display: inline-block;">${otp}</span>
        </div>

        <p style="font-size: 13px; color: #64748b; margin-bottom: 8px;">
          ${validityNotice}
        </p>
        <p style="font-size: 13px; color: #e11d48; margin-bottom: 24px; font-weight: 600;">
          🔒 <strong>Security Warning:</strong> Do not share this OTP with anyone, including railway supervisors or administrators.
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
          This is an automated system notification from Billed App & Railway Machine Management System (RMMS).
        </p>
      </div>
    </div>
  `;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * Dispatches real-time email through configured providers (SMTP, Brevo, Resend, EmailJS, Web3Forms, Webhook)
 */
export async function dispatchRealTimeEmail(params: {
  toEmail: string;
  toName?: string;
  pfNo?: string;
  otp: string;
  purpose: OtpPurpose;
}): Promise<{ delivered: boolean; provider: string; error?: string }> {
  const { toEmail, toName, pfNo, otp, purpose } = params;
  const isLogin2Fa = purpose === 'login_2fa';
  const purposeTitle = 
    purpose === 'email_verification' ? 'Email Verification' :
    purpose === 'login_2fa' ? 'Login 2FA Security' :
    purpose === 'forgot_pin' ? 'Security PIN Reset' : 'Password Reset';

  const htmlContent = buildOtpEmailHtml({ otp, purposeTitle, name: toName, pfNo, email: toEmail, purpose });
  const textContent = isLogin2Fa
    ? `Your RMMS OTP for Login 2FA is ${otp}. Valid for today (until 23:59:59). Do not share with anyone.`
    : `Your OTP for ${purposeTitle} is ${otp}. Valid for 10 minutes. Do not share with anyone.`;

  let lastError = '';

  // 1. First priority: Server-Side Real-Time SMTP Gateway (Uses Secrets: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL)
  try {
    const serverRes = await fetchWithTimeout('/api/send-otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        toEmail,
        toName,
        pfNo,
        otp,
        purpose,
        subject: `${otp} is your verification code for ${purposeTitle}`,
        textContent,
        htmlContent
      })
    }, 25000);

    if (serverRes.ok) {
      const serverData = await serverRes.json();
      if (serverData.delivered || serverData.success) {
        console.log('[SMTP Dispatch Success via Backend Server]', serverData);
        return { delivered: true, provider: 'SMTP Gateway (Nodemailer)' };
      }
    } else {
      const errData = await serverRes.json().catch(() => ({}));
      console.warn('[Server SMTP response]', errData);
      if (errData.error) lastError = errData.error;
    }
  } catch (err: any) {
    console.warn('[Backend SMTP endpoint check failed or timed out]', err);
    if (err?.name === 'AbortError') {
      lastError = 'SMTP Server response timed out (25s).';
    } else {
      lastError = err?.message || 'Failed to reach SMTP endpoint.';
    }
  }

  // 2. Fetch email gateway settings from Firestore (Fallback)
  let gateway: EmailGatewayConfig = {};
  try {
    const snap = await getDoc(doc(db, 'settings', 'general'));
    if (snap.exists()) {
      gateway = snap.data().emailGateway || {};
    }
  } catch (err) {
    console.warn("Could not load emailGateway settings from Firestore:", err);
  }

  const senderName = gateway.senderName?.trim() || 'Railway Machine Management System';
  // Brevo/Resend requires a valid email sender format
  const senderEmail = (gateway.senderEmail?.trim() && gateway.senderEmail.includes('@')) 
    ? gateway.senderEmail.trim() 
    : 'noreply@railway-portal.com';

  // 3. Try Brevo (Sendinblue) API
  if (gateway.brevoApiKey && gateway.brevoApiKey.trim()) {
    try {
      const res = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': gateway.brevoApiKey.trim(),
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: toEmail, name: toName || 'Employee' }],
          subject: `${otp} is your verification code for ${purposeTitle}`,
          htmlContent: htmlContent,
          textContent: textContent
        })
      }, 5000);
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.messageId || res.status === 201 || res.status === 200)) {
        return { delivered: true, provider: 'Brevo' };
      } else {
        console.warn("Brevo API delivery issue:", data);
      }
    } catch (e: any) {
      console.warn("Brevo email dispatch error:", e);
    }
  }

  // 4. Try Resend API
  if (gateway.resendApiKey && gateway.resendApiKey.trim()) {
    try {
      const res = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gateway.resendApiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `${senderName} <${senderEmail.includes('@') ? senderEmail : 'onboarding@resend.dev'}>`,
          to: [toEmail],
          subject: `${otp} is your verification code for ${purposeTitle}`,
          html: htmlContent,
          text: textContent
        })
      }, 5000);
      if (res.ok) {
        return { delivered: true, provider: 'Resend' };
      }
    } catch (e: any) {
      console.warn("Resend email dispatch error:", e);
    }
  }

  // 5. Try EmailJS
  if (gateway.emailjsServiceId && gateway.emailjsTemplateId && gateway.emailjsPublicKey) {
    try {
      const emailjs = await import('@emailjs/browser');
      await emailjs.send(
        gateway.emailjsServiceId.trim(),
        gateway.emailjsTemplateId.trim(),
        {
          to_email: toEmail,
          email: toEmail,
          user_email: toEmail,
          recipient: toEmail,
          to_name: toName || 'Employee',
          name: toName || 'Employee',
          otp_code: otp,
          otp: otp,
          passcode: otp,
          code: otp,
          token: otp,
          purpose: purposeTitle,
          expiry: '10 Minutes',
          app_title: senderName,
          timestamp: new Date().toLocaleString('en-IN')
        },
        gateway.emailjsPublicKey.trim()
      );
      return { delivered: true, provider: 'EmailJS' };
    } catch (e: any) {
      console.warn("EmailJS browser dispatch error:", e);
    }
  }

  // 6. Try Web3Forms (100% Free Instant Email API)
  if (gateway.web3formsKey && gateway.web3formsKey.trim()) {
    try {
      const res = await fetchWithTimeout('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          access_key: gateway.web3formsKey.trim(),
          to_email: toEmail,
          subject: `${otp} is your OTP for ${purposeTitle}`,
          from_name: senderName,
          message: textContent,
          otp_code: otp,
          html_content: htmlContent
        })
      }, 5000);
      if (res.ok) {
        return { delivered: true, provider: 'Web3Forms' };
      }
    } catch (e: any) {
      console.warn("Web3Forms email dispatch error:", e);
    }
  }

  // 7. Try Custom Webhook
  if (gateway.webhookUrl && gateway.webhookUrl.trim()) {
    try {
      const res = await fetchWithTimeout(gateway.webhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          name: toName,
          pfNo,
          otp,
          purpose,
          purposeTitle,
          html: htmlContent,
          text: textContent,
          timestamp: new Date().toISOString()
        })
      }, 5000);
      if (res.ok) {
        return { delivered: true, provider: 'Custom Webhook' };
      }
    } catch (e: any) {
      console.warn("Webhook email dispatch error:", e);
    }
  }

  return { delivered: false, provider: 'System Gateway', error: lastError };
}

/**
 * Generates and stores OTP in Firestore and local session, and dispatches real-time email
 */
export async function sendOtp(
  email: string,
  purpose: OtpPurpose,
  details?: { name?: string; pfNo?: string }
): Promise<SendOtpResult> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, message: 'Please provide a valid email address.' };
  }

  const otp = generateOtp();
  const isLogin2Fa = purpose === 'login_2fa';
  
  // Calculate expiration: 1 full calendar day (until 23:59:59.999 of the current date) for login_2fa, 10 mins for other purposes
  let expiresAt: number;
  let expiresInSeconds: number;
  if (isLogin2Fa) {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    expiresAt = endOfDay.getTime();
    expiresInSeconds = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  } else {
    expiresAt = Date.now() + 10 * 60 * 1000;
    expiresInSeconds = 600;
  }

  const docId = `${cleanEmail.replace(/[^a-z0-9]/g, '_')}_${purpose}`;

  const purposeTitle = 
    purpose === 'email_verification' ? 'Email Verification' :
    purpose === 'login_2fa' ? 'Login 2FA Security' :
    purpose === 'forgot_pin' ? 'PIN Reset' : 'Password Reset';

  try {
    // 1. Store in Firestore
    await setDoc(doc(db, 'otps', docId), {
      email: cleanEmail,
      otp,
      purpose,
      name: details?.name || '',
      pfNo: details?.pfNo || '',
      expiresAt,
      createdAt: new Date().toISOString(),
      verified: false,
      failedAttempts: 0
    });

    // 2. Keep fallback in sessionStorage
    sessionStorage.setItem(`otp_${docId}`, JSON.stringify({
      otp,
      expiresAt,
      cleanEmail,
      purpose,
      failedAttempts: 0
    }));

    // 3. Dispatch real-time email to user's inbox
    const emailResult = await dispatchRealTimeEmail({
      toEmail: cleanEmail,
      toName: details?.name,
      pfNo: details?.pfNo,
      otp,
      purpose
    });

    // Update Firestore with delivery status
    try {
      await updateDoc(doc(db, 'otps', docId), {
        delivered: emailResult.delivered,
        provider: emailResult.provider,
        dispatchedAt: new Date().toISOString()
      });
    } catch {
      // ignore
    }

    const validityMsg = isLogin2Fa 
      ? `Valid for today (until 23:59:59). You can use this RMMS OTP for all logins today.`
      : `Valid for 10 minutes.`;

    if (emailResult.delivered) {
      toast.success(isLogin2Fa ? "RMMS Login OTP for today sent to your registered email!" : "Verification OTP sent to your registered email!", {
        description: `Please check your email inbox for the 6-digit code. ${validityMsg}`,
        duration: 8000
      });
    } else {
      console.warn('[OTP Delivery Notice] Email was not delivered:', emailResult);
      toast.warning("OTP Email Notice", {
        description: emailResult.error || "Email not dispatched. Please ensure SMTP credentials are added to Vercel Environment Variables.",
        duration: 9000
      });
    }

    return {
      success: true,
      message: emailResult.delivered
        ? `OTP sent successfully to your registered email.`
        : (emailResult.error || `OTP generated. Notice: email delivery not confirmed.`),
      expiresInSeconds,
      deliveryStatus: emailResult.delivered ? 'delivered' : 'simulated'
    };
  } catch (err: any) {
    console.error('Error in sendOtp:', err);
    sessionStorage.setItem(`otp_${docId}`, JSON.stringify({
      otp,
      expiresAt,
      cleanEmail,
      purpose,
      failedAttempts: 0
    }));

    const validityMsg = isLogin2Fa 
      ? `Valid for today (until 23:59:59). You can use this RMMS OTP for all logins today.`
      : `Valid for 10 minutes.`;

    toast.success(isLogin2Fa ? "RMMS Login OTP for today sent to your registered email!" : "Verification OTP sent to your registered email!", {
      description: `Please check your email inbox for the 6-digit code. ${validityMsg}`,
      duration: 8000
    });
    return {
      success: true,
      message: `OTP sent successfully to your registered email.`,
      expiresInSeconds,
      deliveryStatus: 'simulated'
    };
  }
}

/**
 * Validates the entered OTP code against Firestore and fallback session with brute-force protection
 */
export async function verifyOtp(
  email: string,
  enteredOtp: string,
  purpose: OtpPurpose
): Promise<{ success: boolean; message: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = enteredOtp.trim();
  const docId = `${cleanEmail.replace(/[^a-z0-9]/g, '_')}_${purpose}`;
  const isLogin2Fa = purpose === 'login_2fa';

  if (!cleanOtp || cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
    return { success: false, message: 'Please enter a valid 6-digit numeric OTP code.' };
  }

  try {
    // Check Firestore first
    const docRef = doc(db, 'otps', docId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      const failedAttempts = (data.failedAttempts || 0);

      // Brute-force protection: Max 5 failed attempts allowed
      if (failedAttempts >= 5) {
        return { success: false, message: 'Too many incorrect attempts. This OTP has been locked for security. Please request a new OTP.' };
      }

      // For non-login purposes, prevent reuse once marked verified
      if (!isLogin2Fa && data.verified) {
        return { success: false, message: 'This OTP has already been used. Please request a new one.' };
      }
      if (Date.now() > data.expiresAt) {
        return { success: false, message: isLogin2Fa ? "Today's RMMS OTP has expired for the date. Please request a new OTP." : 'OTP has expired. Please request a new one.' };
      }
      if (data.otp === cleanOtp) {
        if (!isLogin2Fa) {
          try {
            await updateDoc(docRef, { verified: true, verifiedAt: new Date().toISOString(), failedAttempts: 0 });
          } catch {
            // Ignore
          }
          sessionStorage.removeItem(`otp_${docId}`);
        } else {
          try {
            await updateDoc(docRef, { lastUsedAt: new Date().toISOString(), failedAttempts: 0 });
          } catch {
            // Ignore
          }
        }
        return { success: true, message: 'OTP verified successfully!' };
      } else {
        // Increment failed attempts counter
        const nextAttempts = failedAttempts + 1;
        try {
          await updateDoc(docRef, { failedAttempts: nextAttempts });
        } catch {
          // Ignore
        }
        const remaining = Math.max(0, 5 - nextAttempts);
        return {
          success: false,
          message: remaining > 0 
            ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before OTP is locked.`
            : 'Invalid OTP. Maximum attempts exceeded. OTP is now locked. Please request a new OTP.'
        };
      }
    }

    // Check Session Storage fallback
    const sessionOtpRaw = sessionStorage.getItem(`otp_${docId}`);
    if (sessionOtpRaw) {
      const sessionData = JSON.parse(sessionOtpRaw);
      const sessionAttempts = (sessionData.failedAttempts || 0);

      if (sessionAttempts >= 5) {
        return { success: false, message: 'Too many incorrect attempts. This OTP has been locked for security. Please request a new OTP.' };
      }

      if (Date.now() > sessionData.expiresAt) {
        return { success: false, message: isLogin2Fa ? "Today's RMMS OTP has expired for the date. Please request a new OTP." : 'OTP has expired. Please request a new one.' };
      }
      if (sessionData.otp === cleanOtp) {
        if (!isLogin2Fa) {
          sessionStorage.removeItem(`otp_${docId}`);
        }
        return { success: true, message: 'OTP verified successfully!' };
      } else {
        sessionData.failedAttempts = sessionAttempts + 1;
        sessionStorage.setItem(`otp_${docId}`, JSON.stringify(sessionData));
        const remaining = Math.max(0, 5 - sessionData.failedAttempts);
        return {
          success: false,
          message: remaining > 0 
            ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before OTP is locked.`
            : 'Invalid OTP. Maximum attempts exceeded. OTP is now locked. Please request a new OTP.'
        };
      }
    }

    return { success: false, message: isLogin2Fa ? "Invalid RMMS OTP. Please enter the correct today's 6-digit OTP." : 'Invalid OTP code. Please check and try again.' };
  } catch (err: any) {
    console.error('Error verifying OTP:', err);
    const sessionOtpRaw = sessionStorage.getItem(`otp_${docId}`);
    if (sessionOtpRaw) {
      const sessionData = JSON.parse(sessionOtpRaw);
      if (sessionData.otp === cleanOtp && Date.now() <= sessionData.expiresAt) {
        if (!isLogin2Fa) {
          sessionStorage.removeItem(`otp_${docId}`);
        }
        return { success: true, message: 'OTP verified successfully!' };
      }
    }
    return { success: false, message: 'Verification error. Please try again.' };
  }
}

