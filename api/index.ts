import type { Request, Response } from 'express';
import { getSmtpStatus } from './_smtp.js';

export default async function handler(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const smtp = getSmtpStatus();

  return res.status(200).json({
    status: 'ok',
    message: 'RMMS API Gateway running on Vercel Serverless',
    smtpConfigured: smtp.configured,
    endpoints: [
      '/api/health',
      '/api/send-otp',
      '/api/send-email',
      '/api/send-bulk-email',
      '/api/analyze-critical-spares-pdf'
    ]
  });
}
