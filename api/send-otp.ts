import type { Request, Response } from 'express';
import { createSmtpTransporter, getSmtpStatus } from './_smtp.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: Request, res: Response) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed. Please use POST.`
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { toEmail, toName, pfNo, otp, purpose, htmlContent, textContent, subject } = body;

    const cleanEmail = typeof toEmail === 'string' ? toEmail.trim().toLowerCase() : '';
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Valid recipient email address is required.'
      });
    }

    if (cleanEmail.endsWith('@employee.billedapp.com')) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send OTP to dummy placeholder email. Please verify/update the employee email with a valid personal or railway email address.'
      });
    }

    const cleanOtp = typeof otp === 'string' ? otp.trim() : '';
    if (!cleanOtp || cleanOtp.length < 4 || cleanOtp.length > 8) {
      return res.status(400).json({
        success: false,
        error: 'Valid 4-8 digit OTP code is required.'
      });
    }

    const transporter = createSmtpTransporter();

    if (!transporter) {
      const status = getSmtpStatus();
      console.warn('[Vercel OTP Endpoint] SMTP secrets missing in environment variables:', status);
      return res.status(503).json({
        success: false,
        error: 'SMTP credentials (SMTP_USER, SMTP_PASS) not configured in Vercel Environment Variables. Please add SMTP_USER and SMTP_PASS in Vercel Project Settings > Environment Variables.'
      });
    }

    const fromEmail = process.env.FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim() || 'noreply@railway-portal.com';
    const emailSubject = subject || `${cleanOtp} is your verification code for ${purpose || 'Verification'}`;
    const emailBodyText = textContent || `Your OTP verification code is ${cleanOtp}. Valid for 10 minutes.`;

    const info = await transporter.sendMail({
      from: `"Railway Machine Management System" <${fromEmail}>`,
      to: cleanEmail,
      subject: emailSubject,
      text: emailBodyText,
      html: htmlContent || `<div style="font-family: Arial, sans-serif; padding: 20px;">
        <div style="background-color: #1e1b4b; padding: 16px 20px; border-radius: 8px; color: #ffffff; text-align: center; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 18px; text-transform: uppercase;">Indian Railway Management System</h1>
        </div>
        <h2>Security Verification Code</h2>
        <p>Hello <strong>${toName || 'Employee'}</strong>${pfNo ? ` (PF: ${pfNo})` : ''},</p>
        <p>Your verification code for <strong>${purpose || 'Authentication'}</strong> is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e1b4b; margin: 20px 0;">${cleanOtp}</div>
        <p>This code is valid for 10 minutes. Do not share it with anyone.</p>
      </div>`
    });

    console.log(`[Vercel SMTP Live Dispatch Success] Sent OTP to ${cleanEmail}, messageId: ${info.messageId}`);

    return res.status(200).json({
      success: true,
      delivered: true,
      provider: 'SMTP Server',
      messageId: info.messageId
    });
  } catch (error: any) {
    console.error('[Vercel SMTP Dispatch Failed]', error?.message || error);
    return res.status(500).json({
      success: false,
      error: `Failed to dispatch email via SMTP: ${error?.message || 'Connection error'}`
    });
  }
}
