import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

export default async function handler(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: `Method ${req.method} not allowed.` });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { pdfBase64, mimeType, fileName } = body;

    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'PDF base64 data is required for analysis.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured in Vercel environment variables.'
      });
    }

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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: effectiveMimeType,
                data: cleanBase64
              }
            },
            {
              text: prompt
            }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const rawText = response.text || '{}';
    let parsed: any = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }

    return res.status(200).json({
      success: true,
      data: parsed
    });
  } catch (err: any) {
    console.error('[Vercel PDF Analysis Error]', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to analyze PDF file.'
    });
  }
}
