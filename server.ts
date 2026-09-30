import express from 'express';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';
import { PDFParse } from 'pdf-parse';
import { adaptiveFirewallMiddleware, registerDeceptiveLabyrinthRoutes } from './server/adaptiveFirewall.ts';

const app = express();

// Disable information leakage via X-Powered-By header
app.disable('x-powered-by');

// Security headers middleware (permits embedding in AI Studio preview iframe)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Defense-Mesh', 'RMMS-Quantum-Shield-v4.9');
  next();
});

// Standard cloud health check endpoints (bypass firewall for fast container probes)
app.get(['/healthz', '/health'], (req, res) => {
  res.status(200).send('OK');
});

// JSON body parser with size limit to support PDF uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Register Deceptive Honey-pot Labyrinth routes ("Idhar-Udhar Uljhana")
registerDeceptiveLabyrinthRoutes(app);

// Adaptive Honey-pot Tarpit Firewall (Stalls attackers, escalates defense on probe/exploit)
app.use(adaptiveFirewallMiddleware());

// In-Memory Rate Limiter for API endpoints
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

// Clean up stale rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);

function rateLimiter(limit: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown_ip';
    const key = `${ip}_${req.path}`;
    const now = Date.now();

    const record = rateLimitMap.get(String(key));
    if (!record || now > record.resetAt) {
      rateLimitMap.set(String(key), { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (record.count >= limit) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please wait a moment before trying again.'
      });
    }

    record.count++;
    next();
  };
}

// Cached SMTP Transporter instance for connection reuse across requests
let cachedTransporter: nodemailer.Transporter | null = null;
let lastTransporterConfigKey = '';

// Helper to create Nodemailer transporter lazily with connection pooling
function getSmtpTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST?.trim() || '';
  const port = parseInt(process.env.SMTP_PORT?.trim() || '587', 10);
  const user = process.env.SMTP_USER?.trim() || '';
  let pass = process.env.SMTP_PASS?.trim() || '';

  if (!user || !pass) {
    return null;
  }

  // Auto-remove spaces from Google App Password
  if (pass.replace(/\s+/g, '').length === 16 && (host.toLowerCase().includes('gmail') || user.toLowerCase().includes('@gmail.com') || !host)) {
    pass = pass.replace(/\s+/g, '');
  }

  const configKey = `${host}_${port}_${user}_${pass.slice(0, 4)}`;
  if (cachedTransporter && lastTransporterConfigKey === configKey) {
    return cachedTransporter;
  }

  const isGmail = host.toLowerCase().includes('gmail') || user.toLowerCase().includes('@gmail.com') || host === 'smtp.gmail.com' || !host;

  if (isGmail) {
    cachedTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: port === 465 ? 465 : 587,
      secure: port === 465,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: { rejectUnauthorized: false }
    });
  } else {
    cachedTransporter = nodemailer.createTransport({
      host: host || 'smtp.gmail.com',
      port,
      secure: port === 465,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: { rejectUnauthorized: false }
    });
  }

  lastTransporterConfigKey = configKey;
  return cachedTransporter;
}

// Helper to dispatch email with automatic reconnect retry on stale sockets
async function dispatchMailWithRetry(mailOptions: nodemailer.SendMailOptions): Promise<nodemailer.SentMessageInfo> {
  let transporter = getSmtpTransporter();
  if (!transporter) {
    throw new Error('SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) not configured in Server Secrets.');
  }

  try {
    return await transporter.sendMail(mailOptions);
  } catch (err: any) {
    console.warn('[SMTP Initial Send Warning, retrying with fresh connection]', err?.message || err);
    cachedTransporter = null;
    transporter = getSmtpTransporter();
    if (!transporter) throw err;
    return await transporter.sendMail(mailOptions);
  }
}

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Health check and SMTP config status
app.get('/api/health', (req, res) => {
  const hasHost = !!process.env.SMTP_HOST?.trim();
  const hasUser = !!process.env.SMTP_USER?.trim();
  const hasPass = !!process.env.SMTP_PASS?.trim();
  const hasFrom = !!process.env.FROM_EMAIL?.trim();

  res.json({
    status: 'ok',
    smtpConfigured: hasHost && hasUser && hasPass,
    smtpDetails: {
      hostPresent: hasHost,
      userPresent: hasUser,
      passPresent: hasPass,
      fromPresent: hasFrom,
      port: process.env.SMTP_PORT?.trim() || '587'
    }
  });
});

// API endpoint to send Real-Time OTP Email via SMTP (Rate limited: max 15 per minute)
app.post('/api/send-otp', rateLimiter(15, 60000), async (req, res) => {
  try {
    const { toEmail, toName, pfNo, otp, purpose, htmlContent, textContent, subject } = req.body;

    const cleanEmail = typeof toEmail === 'string' ? toEmail.trim().toLowerCase() : '';
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Valid recipient email address is required.' });
    }

    const cleanOtp = typeof otp === 'string' ? otp.trim() : '';
    if (!cleanOtp || cleanOtp.length < 4 || cleanOtp.length > 8) {
      return res.status(400).json({ success: false, error: 'Valid OTP code is required.' });
    }

    const fromEmail = process.env.FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim() || 'noreply@railway-portal.com';
    const emailSubject = subject || `${cleanOtp} is your verification code for ${purpose || 'Verification'}`;
    const emailBodyText = textContent || `Your OTP verification code is ${cleanOtp}. Valid for 10 minutes.`;

    const info = await dispatchMailWithRetry({
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

    return res.json({
      success: true,
      delivered: true,
      provider: 'SMTP Server',
      messageId: info.messageId
    });
  } catch (error: any) {
    console.error('[SMTP Live Dispatch Failed]', error?.message || error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to dispatch email via SMTP transporter. Please check credentials or retry.'
    });
  }
});

// API endpoint to send general notification / transaction email (Rate limited: max 30 per minute)
app.post('/api/send-email', rateLimiter(30, 60000), async (req, res) => {
  try {
    const { toEmail, toName, subject, htmlContent, textContent } = req.body;

    const cleanEmail = typeof toEmail === 'string' ? toEmail.trim().toLowerCase() : '';
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Valid recipient email is required.' });
    }

    const fromEmail = process.env.FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim() || 'noreply@railway-portal.com';
    const emailSubject = subject || 'RMMS System Notification';
    const emailBodyText = textContent || 'You have a new update from the Railway Machine Management System.';

    const info = await dispatchMailWithRetry({
      from: `"Railway Machine Management System" <${fromEmail}>`,
      to: cleanEmail,
      subject: emailSubject,
      text: emailBodyText,
      html: htmlContent || `<p>${emailBodyText}</p>`
    });

    return res.json({
      success: true,
      delivered: true,
      provider: 'SMTP Server',
      messageId: info.messageId
    });
  } catch (error: any) {
    console.error('[Notification Email Failed]', error?.message || error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to dispatch notification email.'
    });
  }
});

// API endpoint to send bulk notification emails in batch (Rate limited: max 10 requests per minute)
app.post('/api/send-bulk-email', rateLimiter(10, 60000), async (req, res) => {
  try {
    const { recipients, subject, htmlContent, textContent } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Recipients array is required.' });
    }

    // Safeguard max bulk batch size
    if (recipients.length > 50) {
      return res.status(400).json({ success: false, error: 'Bulk dispatch limit exceeded. Maximum 50 recipients per request.' });
    }

    const fromEmail = process.env.FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim() || 'noreply@railway-portal.com';
    const validRecipients = recipients.filter((r: any) => {
      const email = typeof r === 'string' ? r.trim().toLowerCase() : r?.email?.trim().toLowerCase();
      return email && EMAIL_REGEX.test(email) && !email.endsWith('@employee.billedapp.com');
    });

    if (validRecipients.length === 0) {
      return res.json({ success: true, count: 0, message: 'No valid external email recipients found to dispatch.' });
    }

    let successCount = 0;
    const errors: string[] = [];

    // Dispatch concurrently in batches
    for (const r of validRecipients) {
      const email = typeof r === 'string' ? r.trim().toLowerCase() : r.email?.trim().toLowerCase();

      try {
        await dispatchMailWithRetry({
          from: `"Railway Machine Management System" <${fromEmail}>`,
          to: email,
          subject: subject || 'RMMS System Notification',
          text: textContent || 'You have a new update from the Railway Machine Management System.',
          html: htmlContent || `<p>${textContent || 'System Notification'}</p>`
        });
        successCount++;
      } catch (err: any) {
        console.warn(`[Bulk Email Partial Error] ${email}:`, err?.message || err);
        errors.push(`${email}: Delivery failed`);
      }
    }

    return res.json({
      success: true,
      dispatched: successCount,
      total: validRecipients.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('[Bulk Notification Failed]', error?.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to execute bulk email dispatch.'
    });
  }
});

// Helper to extract critical spares from raw text if AI is unavailable or as local fallback
function extractSparesFromRawText(rawText: string, fileName?: string): { documentTitle: string; machineName: string; items: any[] } {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let documentTitle = fileName || 'Critical Spares List';
  let detectedMachine = '';
  const items: any[] = [];

  const machineKeywords = ['08-32', '09-3X', 'CSM', 'DUOMATIC', 'UNIMAT', 'BCM', 'MPT', 'DTE', 'UTV', 'FRM', 'RGM', 'BRM', 'Tamping'];

  // Look for machine name in top lines
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    for (const kw of machineKeywords) {
      if (lines[i].toUpperCase().includes(kw.toUpperCase())) {
        detectedMachine = kw;
        break;
      }
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/^(sl\.?\s*no|item|s\.no|description|pl\s*no|part\s*no|qty|page\s+\d+|indian\s+railways)/i.test(line)) {
      continue;
    }

    // Try finding PL Number (6 to 8 digits)
    const plMatch = line.match(/\b(29\d{6}|\d{8}|\d{7})\b/);
    const plNo = plMatch ? plMatch[1] : '';

    // Try finding quantity and unit (e.g., 2 Nos, 4 SET, 10 MTR, 1)
    const qtyMatch = line.match(/\b(\d+(?:\.\d+)?)\s*(nos|no|sets|set|mtr|mtrs|kg|kgs|ltr|ltrs|pkt|pkts|pcs|pc)\b/i) || line.match(/\b(\d{1,3})\b(?=\s*$)/);
    const requiredQty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;
    const unit = qtyMatch && qtyMatch[2] ? qtyMatch[2].toUpperCase() : 'Nos';

    // Try finding Part No (e.g. 10.12.34, EL-102, H-456, W-99)
    const partMatch = line.match(/\b([A-Z0-9]{2,}[-./][A-Z0-9.-]+)\b/i);
    const partNo = partMatch ? partMatch[1] : '';

    // Description is the rest of the cleaned line
    let desc = line
      .replace(plNo, '')
      .replace(partNo, '')
      .replace(qtyMatch ? qtyMatch[0] : '', '')
      .replace(/^\d+\s*[.)-]?\s*/, '') // remove leading S.No
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (desc.length < 3 && partNo) {
      desc = `Spare Part ${partNo}`;
    }

    if (desc.length >= 3 || partNo || plNo) {
      items.push({
        plNo,
        partNo: partNo || '',
        description: desc || partNo || `Critical Spare Item #${items.length + 1}`,
        requiredQty,
        unit: unit.length > 5 ? 'Nos' : unit,
        category: /tamp/i.test(desc) ? 'Tamping Unit' : /hyd/i.test(desc) ? 'Hydraulic System' : /elec|volt|amp/i.test(desc) ? 'Electrical & Electronics' : /eng|oil|filter/i.test(desc) ? 'Engine & Filters' : 'General',
        machineName: detectedMachine,
        remarks: 'Parsed from PDF'
      });
    }
  }

  return {
    documentTitle,
    machineName: detectedMachine,
    items
  };
}

// Helper to generate AI content with automatic model fallback & retry
async function generateWithFallback(ai: GoogleGenAI, requestPayload: any): Promise<any> {
  const candidateModels = ['gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
  let lastErr: any = null;

  for (const model of candidateModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          ...requestPayload,
          model
        });

        if (response && response.text) {
          return { response, modelUsed: model };
        }
      } catch (err: any) {
        lastErr = err;
        // Pause briefly on transient limits before retrying
        await new Promise(resolve => setTimeout(resolve, 600 * attempt));
      }
    }
  }

  throw lastErr || new Error('AI models momentarily busy.');
}

// API endpoint to analyze Critical Spares PDF using Gemini
app.post('/api/analyze-critical-spares-pdf', rateLimiter(30, 60000), async (req, res) => {
  try {
    const { pdfBase64, mimeType, fileName } = req.body;

    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return res.status(400).json({ success: false, error: 'PDF data in base64 format is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured in server environment secrets.'
      });
    }

    // Clean base64 string if it contains data URI prefix
    const cleanBase64 = pdfBase64.replace(/^data:[^;]+;base64,/, '');

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
    const effectiveMimeType = mimeType || 'application/pdf';

    const prompt = `You are an expert railway track machine engineer and store officer in Indian Railways.
Analyze this Critical Spare Parts document/PDF or table and extract ALL critical spare items into a structured list.

Rules:
1. Extract item description (name of part), part number / cat number / drawing number, PL number (if available), required / critical sanctioned quantity, unit of measurement, category / sub-assembly, and any remarks.
2. If required quantity is not explicitly stated in a row, estimate or default to 1. Ensure requiredQty is always a positive number.
3. Clean and normalize PL numbers and Part numbers.
4. Categorize parts into sensible railway machine categories (e.g., Tamping Unit, Hydraulic System, Engine & Filters, Electrical & Electronics, Pneumatic, Workhead, Brake & Transmission, Fasteners, General).
5. If the document specifies a target Machine (e.g. 08-32 CSM, 09-3X Dynamic, BCM, DUOMATIC, UNIMAT, MPT, DTE, UTV, FRM, RGM), extract it.

Return ONLY a JSON object conforming to this schema:
{
  "documentTitle": "Extracted title of the document or spare list",
  "machineName": "Machine name or model if mentioned in the header/document, otherwise empty string",
  "totalExtracted": 10,
  "items": [
    {
      "plNo": "PL Number (e.g. 29123456 or empty string)",
      "partNo": "Part No / Cat No / Drawing No (e.g. 10.12.34)",
      "description": "Item Name / Detailed Description",
      "requiredQty": 4,
      "unit": "Nos / Set / Mtr / Kg / Ltr / Pkt",
      "category": "Category / Subsystem",
      "machineName": "Machine name if specific to this row, else empty string",
      "remarks": "Any specification, OEM name, or notes"
    }
  ]
}`;

    let parsedData: any = null;
    let modelUsed = 'gemini-3.7-flash';

    try {
      const { response, modelUsed: used } = await generateWithFallback(ai, {
        contents: [
          {
            inlineData: {
              mimeType: effectiveMimeType,
              data: cleanBase64
            }
          },
          {
            text: prompt
          }
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      });

      modelUsed = used;
      const responseText = response.text || '{}';
      try {
        parsedData = JSON.parse(responseText);
      } catch {
        const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
        parsedData = JSON.parse(cleaned);
      }
    } catch {
      // If AI model is temporarily experiencing peak load, extract text directly from PDF
      try {
        const pdfBuffer = Buffer.from(cleanBase64, 'base64');
        const parser = new PDFParse({ data: pdfBuffer });
        const textResult = await parser.getText();
        const rawText = textResult?.text || '';

        if (rawText && rawText.trim().length > 20) {
          // Try sending compact raw text to AI model first
          try {
            const textResponse = await ai.models.generateContent({
              model: 'gemini-flash-latest',
              contents: [
                {
                  text: `${prompt}\n\nDocument Text Content:\n${rawText.slice(0, 30000)}`
                }
              ],
              config: {
                responseMimeType: 'application/json',
                temperature: 0.1
              }
            });
            const tText = textResponse.text || '{}';
            parsedData = JSON.parse(tText.replace(/```json\n?|\n?```/g, '').trim());
            modelUsed = 'gemini-flash-latest (Text Mode)';
          } catch {
            // Local regex extraction fallback
            parsedData = extractSparesFromRawText(rawText, fileName);
            modelUsed = 'PDF Smart Text Parser';
          }
        }
      } catch {
        // Fall through
      }
    }

    if (!parsedData || !Array.isArray(parsedData.items) || parsedData.items.length === 0) {
      // Last-resort fallback text extraction
      try {
        const pdfBuffer = Buffer.from(cleanBase64, 'base64');
        const parser = new PDFParse({ data: pdfBuffer });
        const textResult = await parser.getText();
        parsedData = extractSparesFromRawText(textResult?.text || '', fileName);
        modelUsed = 'PDF Smart Text Parser';
      } catch {
        // Return friendly response
      }
    }

    const items = Array.isArray(parsedData?.items) ? parsedData.items : [];

    return res.json({
      success: true,
      modelUsed,
      documentTitle: parsedData?.documentTitle || fileName || 'Critical Spares List',
      machineName: parsedData?.machineName || '',
      totalItems: items.length,
      items: items.map((it: any, idx: number) => ({
        tempId: `crit_${Date.now()}_${idx}`,
        plNo: String(it.plNo || '').trim(),
        partNo: String(it.partNo || '').trim(),
        description: String(it.description || '').trim(),
        requiredQty: Math.max(1, Number(it.requiredQty) || 1),
        unit: String(it.unit || 'Nos').trim(),
        category: String(it.category || 'General').trim(),
        machineName: String(it.machineName || parsedData?.machineName || '').trim(),
        remarks: String(it.remarks || '').trim()
      }))
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Unable to parse PDF document. Please ensure the document is clear or import via Excel/CSV.'
    });
  }
});

// Explicit JSON 404 for unhandled API routes (prevents fallback to HTML index.html)
app.all('/api/*all', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.path}`
  });
});

// Global API error handler ensuring JSON responses
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api')) {
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: err.message || 'Internal API processing error.'
    });
  }
  next(err);
});

// Process error safeguards
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Vite middleware and Server setup
async function startServer() {
  try {
    const distPath = path.join(process.cwd(), 'dist');
    const distHtmlExists = fs.existsSync(path.join(distPath, 'index.html'));
    const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE) || distHtmlExists;

    if (distHtmlExists) {
      app.use(express.static(distPath, { maxAge: '1d', index: false }));

      app.get('/', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });

      // In Express v5, catch-all is *all
      app.get('*all', (req, res, next) => {
        if (req.path.startsWith('/api')) {
          return next();
        }
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else if (!isProduction) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa'
      });
      app.use(vite.middlewares);
    } else {
      // Fallback for production if dist is not generated
      app.get('/', (req, res) => {
        res.status(200).send('RMMS Service Online');
      });
      app.get('*all', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.status(200).send('RMMS Service Online');
      });
    }

    if (!process.env.VERCEL) {
      const targetPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

      const primaryServer = app.listen(targetPort, '0.0.0.0', () => {
        console.log(`RMMS Server running on http://0.0.0.0:${targetPort} (mode: ${isProduction ? 'production' : 'development'})`);
      });
      primaryServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`Port ${targetPort} is already bound; existing listener active.`);
        } else {
          console.error(`Server error on port ${targetPort}:`, err);
        }
      });
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    if (!process.env.VERCEL) {
      const targetPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
      app.listen(targetPort, '0.0.0.0', () => {
        console.log(`Emergency fallback listener bound on port ${targetPort}`);
      });
    }
  }
}

// Only start the HTTP listener if running directly, not when imported as a serverless handler
if (!process.env.VERCEL) {
  startServer();
}

export default app;
