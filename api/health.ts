import type { Request, Response } from 'express';
import { getSmtpStatus } from './_smtp.js';

export default function handler(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const smtpDetails = getSmtpStatus();

  return res.status(200).json({
    status: 'ok',
    environment: process.env.VERCEL ? 'vercel' : 'node',
    smtpConfigured: smtpDetails.configured,
    smtpDetails: {
      hostPresent: smtpDetails.hostPresent,
      userPresent: smtpDetails.userPresent,
      passPresent: smtpDetails.passPresent,
      fromPresent: smtpDetails.fromPresent,
      port: smtpDetails.port
    },
    message: smtpDetails.configured
      ? 'SMTP credentials are fully configured.'
      : 'SMTP credentials missing. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and FROM_EMAIL in Vercel Environment Variables.'
  });
}
