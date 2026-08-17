import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

// Helper to convert numbers to English words
export function numberToWords(num: number): string {
  if (num === 0) return 'Zero';
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + inWords(n % 100) : '');
    if (n < 100000) return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + inWords(n % 1000) : '');
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + inWords(n % 100000) : '');
    return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + inWords(n % 10000000) : '');
  }

  const integerPart = Math.floor(Math.abs(num));
  const words = integerPart === 0 ? 'Zero' : inWords(integerPart);
  const decimalStr = (Math.abs(num) % 1).toFixed(3).substring(2).replace(/0+$/, '');
  
  if (decimalStr.length > 0) {
    const digitWords = decimalStr.split('').map(d => {
      const digit = parseInt(d, 10);
      return a[digit] || 'Zero';
    }).join(' ');
    return `Only ${words} Point ${digitWords}`.trim();
  }

  return `Only ${words}`.trim();
}

export interface IssueVoucherData {
  issueNoteNo: string;
  date: string;
  plNo?: string;
  partNo?: string;
  description?: string;
  qty: number;
  unit?: string;
  rate?: number;
  totalValue?: number;
  issuingDepot?: string;
  subDepot?: string;
  ward?: string;
  category?: string;
  demandRefNo?: string;
  demandDate?: string;
  signMake?: string;
  allocationNo?: string;
  consigneeDepot?: string;
  consigneeCode?: string;
  actualIssueDate?: string;
  remarks?: string;
  machineName?: string;
  companyName?: string;
  issuedTo?: string;
  issuedBy?: string;
  issuingMachine?: string;
  officerName?: string;
  officerDesignation?: string;
  zone?: string;
  customLogo?: string;
}

export interface DemandVoucherData {
  demandNo: string;
  date: string;
  plNo?: string;
  partNo?: string;
  description?: string;
  qty: number;
  unit?: string;
  demandingDepot?: string;
  subDepot?: string;
  consigneeCode?: string;
  allocationNo?: string;
  issuingDepot?: string;
  issuingMachine?: string;
  remarks?: string;
  machineName?: string;
  companyName?: string;
  forwardedTo?: string;
  forwardedBy?: string;
  status?: string;
  zone?: string;
  division?: string;
  isCompanyDemand?: boolean;
  issuedItems?: Array<{
    issuingDepot: string;
    issueNoteDetails: string;
    qty: number;
    type: string;
    rate: number;
    value: number;
    gatePass: string;
    remarks: string;
    voucherNo: string;
  }>;
  customLogo?: string;
}

/**
 * High quality Indian Railways Red Emblem Logo SVG string for top-center placement in PDFs
 */
export function getRailwayLogoSVG(size: number = 64): string {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display: block; margin: 0 auto; user-select: none;">
      <!-- Solid Red Base Circle -->
      <circle cx="50" cy="50" r="49" fill="#da251d" />
      
      <!-- Outer White Boundary Rings -->
      <circle cx="50" cy="50" r="47" fill="none" stroke="#ffffff" stroke-width="1.2" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#ffffff" stroke-width="1.2" />

      <!-- Horizontal Track Lines -->
      <g stroke="#ffffff" stroke-width="0.8" opacity="0.85">
        <line x1="22" y1="38" x2="78" y2="38" />
        <line x1="20" y1="42" x2="80" y2="42" />
        <line x1="19" y1="46" x2="81" y2="46" />
        <line x1="19" y1="50" x2="81" y2="50" />
        <line x1="19" y1="54" x2="81" y2="54" />
        <line x1="20" y1="58" x2="80" y2="58" />
        <line x1="22" y1="62" x2="78" y2="62" />
      </g>

      <!-- Streamlined Train Engine -->
      <path d="M 26 71 L 34 64 L 40 40 C 45 33, 55 33, 60 40 L 66 64 L 74 71 Z" fill="#da251d" stroke="#ffffff" stroke-width="1.2" />
      <line x1="34" y1="64" x2="66" y2="64" stroke="#ffffff" stroke-width="1" />
      <line x1="36" y1="67" x2="64" y2="67" stroke="#ffffff" stroke-width="1" />
      <line x1="38" y1="70" x2="62" y2="70" stroke="#ffffff" stroke-width="1" />

      <!-- Central Boiler Shield (Ashoka Emblem) -->
      <circle cx="50" cy="50" r="11" fill="#da251d" stroke="#ffffff" stroke-width="1.2" />
      <circle cx="50" cy="50" r="9.5" fill="none" stroke="#ffffff" stroke-width="0.6" />
      <g fill="#ffffff">
        <path d="M 48 43.5 Q 50 42 52 43.5 L 52.5 46 L 47.5 46 Z" />
        <rect x="48.5" y="46.5" width="3" height="4" rx="0.5" />
        <circle cx="50" cy="52" r="1.5" fill="none" stroke="#ffffff" stroke-width="0.5" />
        <path d="M 46.5 54.5 L 53.5 54.5 L 52.5 56 L 47.5 56 Z" />
      </g>

      <!-- Top Arc Text: INDIAN RAILWAYS (Rotated individual letters) -->
      <g fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="6.5px" text-anchor="middle">
        <text transform="translate(50,50) rotate(-135) translate(0,-40)">I</text>
        <text transform="translate(50,50) rotate(-128) translate(0,-40)">N</text>
        <text transform="translate(50,50) rotate(-121) translate(0,-40)">D</text>
        <text transform="translate(50,50) rotate(-115) translate(0,-40)">I</text>
        <text transform="translate(50,50) rotate(-109) translate(0,-40)">A</text>
        <text transform="translate(50,50) rotate(-102) translate(0,-40)">N</text>
        <text transform="translate(50,50) rotate(-95) translate(0,-40)"> </text>
        <text transform="translate(50,50) rotate(-88) translate(0,-40)">R</text>
        <text transform="translate(50,50) rotate(-81) translate(0,-40)">A</text>
        <text transform="translate(50,50) rotate(-74) translate(0,-40)">I</text>
        <text transform="translate(50,50) rotate(-68) translate(0,-40)">L</text>
        <text transform="translate(50,50) rotate(-61) translate(0,-40)">W</text>
        <text transform="translate(50,50) rotate(-53) translate(0,-40)">A</text>
        <text transform="translate(50,50) rotate(-46) translate(0,-40)">Y</text>
        <text transform="translate(50,50) rotate(-40) translate(0,-40)">S</text>
      </g>

      <!-- Bottom Arc Text: भारतीय रेल -->
      <g fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="6.2px" text-anchor="middle">
        <text transform="translate(50,50) rotate(135) translate(0,42) rotate(180)">भा</text>
        <text transform="translate(50,50) rotate(123) translate(0,42) rotate(180)">र</text>
        <text transform="translate(50,50) rotate(113) translate(0,42) rotate(180)">ती</text>
        <text transform="translate(50,50) rotate(103) translate(0,42) rotate(180)">य</text>
        <text transform="translate(50,50) rotate(93) translate(0,42) rotate(180)"> </text>
        <text transform="translate(50,50) rotate(83) translate(0,42) rotate(180)">रे</text>
        <text transform="translate(50,50) rotate(71) translate(0,42) rotate(180)">ल</text>
      </g>

      <!-- Border Stars -->
      <g fill="#ffffff">
        <polygon points="50,92 51,94.5 53.5,94.5 51.5,96 52.2,98.5 50,97 47.8,98.5 48.5,96 46.5,94.5 49,94.5" />
        <polygon points="40,90.5 41,93 43.5,93 41.5,94.5 42.2,97 40,95.5 37.8,97 38.5,94.5 36.5,93 39,93" />
        <polygon points="60,90.5 61,93 63.5,93 61.5,94.5 62.2,97 60,95.5 57.8,97 58.5,94.5 56.5,93 59,93" />
        <polygon points="30,86 31,88.5 33.5,88.5 31.5,90 32.2,92.5 30,91 27.8,92.5 28.5,90 26.5,88.5 29,88.5" />
        <polygon points="70,86 71,88.5 73.5,88.5 71.5,90 72.2,92.5 70,91 67.8,92.5 68.5,90 66.5,88.5 69,88.5" />
        <polygon points="21,79 22,81.5 24.5,81.5 22.5,83 23.2,85.5 21,84 18.8,85.5 19.5,83 17.5,81.5 20,81.5" />
        <polygon points="79,79 80,81.5 82.5,81.5 80.5,83 81.2,85.5 79,84 76.8,85.5 77.5,83 75.5,81.5 78,81.5" />
      </g>
    </svg>
  `;
}

/**
 * Custom Logo HTML for Demand & Issue Vouchers
 */
export function getDemandLogoHTML(size: number = 68, customLogoUrl?: string): string {
  const logoUrl = customLogoUrl || (typeof window !== 'undefined' ? localStorage.getItem('demandLogo') : null);
  if (logoUrl && logoUrl.trim() !== '') {
    return `
      <div style="display: flex; justify-content: center; align-items: center; margin: 0 auto; text-align: center;">
        <img src="${logoUrl}" alt="Demand Logo" style="height: ${size}px; width: auto; max-width: 180px; object-fit: contain; display: block; margin: 0 auto;" />
      </div>
    `;
  }
  return `
    <div style="display: flex; justify-content: center; align-items: center; margin: 0 auto; text-align: center;">
      ${getRailwayLogoSVG(size)}
    </div>
  `;
}

/**
 * Generate Issue Note PDF (Supplied Materials Voucher - Form S.S.-9)
 */
export async function generateIssueNotePDF(data: IssueVoucherData, download: boolean = true) {
  let customLogo = data.customLogo || (typeof window !== 'undefined' ? localStorage.getItem('demandLogo') : '');
  if (!customLogo && typeof window !== 'undefined') {
    try {
      const docSnap = await getDoc(doc(db, 'settings', 'general'));
      if (docSnap.exists() && docSnap.data().demandLogo) {
        customLogo = docSnap.data().demandLogo;
        localStorage.setItem('demandLogo', customLogo!);
      }
    } catch (e) {
      console.warn('Could not fetch demand logo from settings:', e);
    }
  }

  const zoneName = data.zone || 'South East Central Railway';
  const qtyFormatted = `${(data.qty || 0).toFixed(3)} ${data.unit || 'Number'}`;
  const qtyWords = numberToWords(Math.round(data.qty || 1)) + ` ${data.unit || 'Number'}`;
  const rateNum = data.rate || 0;
  const valNum = data.totalValue || (data.qty * rateNum);
  const rateFormatted = `Rs. ${rateNum.toFixed(2)} per ${data.unit || 'Number'}`;
  const valFormatted = `Rs. ${valNum.toFixed(2)}`;
  const valInWords = numberToWords(Math.round(valNum)) + ' Rupees Only';

  const allocationText = (data.allocationNo && data.allocationNo !== 'OPERATIONAL ALLOCATION') ? data.allocationNo : '-';

  const htmlContent = `
    <div id="issue-pdf-container" style="width: 794px; padding: 25px; background: #ffffff; font-family: 'Arial', sans-serif; color: #111827; box-sizing: border-box; line-height: 1.2;">
      <!-- Top Center Railway Logo & Header -->
      <div style="text-align: center; margin-bottom: 12px;">
        <div style="margin-bottom: 6px; display: flex; justify-content: center;">
          ${getDemandLogoHTML(68, customLogo)}
        </div>
        <h1 style="font-size: 20px; font-weight: 800; margin: 0; color: #000000; letter-spacing: 0.5px; text-transform: uppercase;">${zoneName}</h1>
        <div style="font-size: 11px; font-weight: bold; color: #374151; margin-top: 2px;">भारतीय रेल • INDIAN RAILWAYS</div>
      </div>

      <!-- Main Document Title -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 8px;">
        <div>
          <div style="font-size: 14px; font-weight: bold; color: #000;">सप्लाई की गई सामग्री</div>
          <div style="font-size: 13px; font-weight: 800; color: #000; letter-spacing: 0.5px;">MATERIALS SUPPLIED</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 11px; font-weight: bold;">एस. एस -९ /(एस -१५ ३१ )</div>
          <div style="font-size: 11px; font-weight: bold;">S.S-9/(S-1531)</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 11px; font-weight: bold; color: #b91c1c;">Issue-To User Depot (Consignee)</div>
        </div>
      </div>

      <!-- Voucher Type Banner -->
      <div style="background-color: #fef08a; border: 1px solid #eab308; text-align: center; font-weight: 800; font-size: 14px; padding: 4px; margin-bottom: 10px; color: #000;">
        इशू नोट / ISSUE NOTE
      </div>

      <!-- Main Form Grid Table -->
      <table style="width: 100%; border-collapse: collapse; border: 1.5px solid #000; font-size: 10px; text-align: center;">
        <tbody>
          <!-- Row 1 -->
          <tr>
            <td style="border: 1px solid #000; padding: 5px; width: 25%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">जारीकर्ता डिपो / शॉप</div>
              <div style="font-size: 9px; font-weight: bold;">ISSUING DEPOT / SHOP</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 3px; color: #000;">
                ${(data.issuingDepot || data.issuingMachine || data.machineName || 'Depot').replace(/^SSE\/TM\//i, '').replace(/^SSE\//i, '')}
              </div>
            </td>
            <td style="border: 1px solid #000; padding: 5px; width: 25%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">सब-डिपो / SUB-DEPOT</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 3px;">
                ${data.subDepot || (data.machineName ? `${data.machineName}` : '-')}
              </div>
            </td>
            <td style="border: 1px solid #000; padding: 5px; width: 15%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">वार्ड/WARD</div>
              <div style="font-size: 10px; font-weight: bold; margin-top: 3px;">${data.ward || '01'}</div>
            </td>
            <td style="border: 1px solid #000; padding: 5px; width: 20%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">इशू नोट नं० / Issue Note No.</div>
              <div style="font-size: 12px; font-weight: 800; margin-top: 3px; color: #000;">${data.issueNoteNo}</div>
            </td>
            <td style="border: 1px solid #000; padding: 5px; width: 15%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">तारीख / DATE</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 3px;">${data.date}</div>
            </td>
          </tr>

          <!-- Row 2 -->
          <tr>
            <td style="border: 1px solid #000; padding: 5px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">मूल सूची सं० PL NO.</div>
              <div style="font-size: 12px; font-weight: 800; margin-top: 3px; color: #000;">${data.plNo || 'N/A'}</div>
            </td>
            <td style="border: 1px solid #000; padding: 5px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">श्रेणी / CATEGORY</div>
              <div style="font-size: 10px; font-weight: bold; margin-top: 3px;">${data.category || 'General'}</div>
            </td>
            <td style="border: 1px solid #000; padding: 5px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">इकाई / UNIT</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 3px;">${data.unit || 'Number'}</div>
            </td>
            <td colspan="2" style="border: 1px solid #000; padding: 5px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">माँग/पत्र/संदर्भ सं० / Demand/Ref No. & DATE</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 3px;">${data.demandRefNo || 'REQ-' + data.issueNoteNo.slice(-6)} dt. ${data.demandDate || data.date}</div>
            </td>
          </tr>

          <!-- Row 3 -->
          <tr>
            <td style="border: 1px solid #000; padding: 5px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">मात्रा / QTY.</div>
              <div style="font-size: 12px; font-weight: 800; margin-top: 3px;">${qtyFormatted}</div>
            </td>
            <td style="border: 1px solid #000; padding: 5px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px;">चिह्न / SIGN</div>
              <div style="font-size: 10px; font-weight: bold; margin-top: 3px;">${data.signMake || 'OEM'}</div>
            </td>
            <td colspan="3" style="border: 1px solid #000; padding: 5px; text-align: left; vertical-align: top;">
              <div style="font-size: 9px;">मात्रा शब्दों में / QTY IN WORDS: <strong style="font-size: 11px;">${qtyWords}</strong></div>
              <div style="font-size: 9px; margin-top: 3px;">दर / Rate: <strong style="font-size: 11px;">${rateFormatted}</strong></div>
            </td>
          </tr>

          <!-- Row 4: Description & Value -->
          <tr>
            <td colspan="2" style="border: 1px solid #000; padding: 6px; text-align: left; vertical-align: top;">
              <div style="font-size: 9px; font-weight: bold;">विवरण / DESCRIPTION:</div>
              <div style="font-size: 12px; font-weight: 800; margin-top: 4px; color: #000;">${data.description || 'N/A'}</div>
              ${data.partNo ? `<div style="font-size: 10px; font-weight: bold; margin-top: 2px;">Part No: ${data.partNo}</div>` : ''}
            </td>
            <td colspan="3" style="border: 1px solid #000; padding: 6px; text-align: left; vertical-align: top;">
              <div style="font-size: 9px; font-weight: bold;">मूल्य / Value: <strong style="font-size: 13px; color: #000;">${valFormatted}</strong></div>
              <div style="font-size: 9px; font-style: italic; margin-top: 3px;">(${valInWords})</div>
            </td>
          </tr>

          <!-- Row 5: Allocation & Consignee -->
          <tr>
            <td colspan="2" style="border: 1px solid #000; padding: 5px; text-align: left; vertical-align: top;">
              <div style="font-size: 9px;">विनिधान / Allocation No.</div>
              <div style="font-size: 10px; font-weight: bold; margin-top: 3px;">${allocationText}</div>
            </td>
            <td colspan="3" style="border: 1px solid #000; padding: 5px; text-align: left; vertical-align: top;">
              <div style="font-size: 9px;">जारीकर्ता / प्रेषिती ISSUED BY / CONSIGNEE</div>
              <div style="font-size: 11px; font-weight: 800; color: #000; margin-top: 3px;">${data.issuedBy || data.officerName || data.issuingDepot || data.consigneeDepot || (data.issuedTo ? `Issued to ${data.issuedTo}` : 'Consignee Officer')}</div>
            </td>
          </tr>

          <!-- Row 6: Actual Issue Date -->
          <tr>
            <td colspan="5" style="border: 1px solid #000; padding: 5px; text-align: left; vertical-align: top;">
              <div style="font-size: 9px;">सामान जारी करने की वास्तविक तिथि / Actual Date of Issue : <strong style="font-size: 11px;">${data.actualIssueDate || data.date}</strong></div>
            </td>
          </tr>

          <!-- Row 7: Remarks -->
          <tr>
            <td style="border: 1px solid #000; padding: 6px; text-align: left; vertical-align: top;">
              <div style="font-size: 9px;">विशेष विवरण /</div>
              <div style="font-size: 9px; font-weight: bold;">Remarks</div>
            </td>
            <td colspan="4" style="border: 1px solid #000; padding: 6px; text-align: left; vertical-align: top;">
              <div style="font-size: 11px; font-weight: bold; color: #000;">
                ${data.machineName ? `Issue to Machine ${data.machineName}` : (data.companyName ? `Issue to Company ${data.companyName}` : 'Direct Issue')}
              </div>
              <div style="font-size: 10px; margin-top: 4px;">Details of above quantity of <strong>${qtyFormatted}</strong> issued from Stock Books.</div>
              ${data.remarks ? `<div style="font-size: 10px; margin-top: 4px; font-style: italic;">Note: ${data.remarks}</div>` : ''}
            </td>
          </tr>

          <!-- Row 8: Dispatch Details -->
          <tr>
            <td style="border: 1px solid #000; padding: 5px; text-align: left; vertical-align: top;">
              <div style="font-size: 9px;">सुपुर्दगी विवरण / Dispatch Details</div>
            </td>
            <td colspan="4" style="border: 1px solid #000; padding: 5px; text-align: left; vertical-align: top; font-weight: bold;">
              HAND DELIVERY / ISSUED DIRECTLY
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Signatures Footer -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; padding: 0 10px;">
        <div style="text-align: center; width: 30%;">
          <div style="height: 35px;"></div>
          <div style="font-size: 10px; font-weight: bold; border-top: 1px dashed #000; padding-top: 4px;">फोरमैन / FOREMAN</div>
        </div>
        <div style="text-align: center; width: 35%;">
          <div style="font-size: 11px; font-weight: 800; color: #000;">${data.officerName || data.issuedBy || 'DEPOT OFFICIAL'}</div>
          <div style="font-size: 10px; font-weight: bold; margin-top: 2px;">${data.officerDesignation || ''}</div>
          <div style="font-size: 10px; font-weight: bold; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px;">डिपा/शॉप अधिकारी / DEPOT/SHOP OFFICIAL</div>
        </div>
        <div style="text-align: center; width: 30%;">
          <div style="height: 35px;"></div>
          <div style="font-size: 10px; font-weight: bold; border-top: 1px dashed #000; padding-top: 4px;">प्राप्तकर्ता अधिकारी / RECEIVING OFFICER</div>
        </div>
      </div>

      <!-- Verification Seal Box -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 25px; border-top: 1px solid #e5e7eb; padding-top: 10px;">
        <div style="border: 1.5px solid #16a34a; background: #f0fdf4; padding: 6px 12px; border-radius: 6px; font-size: 10px; color: #166534;">
          <div>Digitally Generated Voucher</div>
          <div>Date: ${data.date}</div>
        </div>
        <div style="text-align: right; font-size: 10px; color: #4b5563;">
          <div style="font-weight: bold;">सामग्री की पावती का विवरण / Acknowledgement Details:</div>
          <div style="color: #d97706; font-weight: 800;">System Logged</div>
        </div>
      </div>
    </div>
  `;

  return renderAndDownloadPDF(htmlContent, `Issue_Note_${data.issueNoteNo}.pdf`, download);
}

/**
 * Generate Requisition (Demand) PDF - Form S.S.-9 / Demand Note
 */
export async function generateDemandPDF(data: DemandVoucherData, download: boolean = true) {
  let customLogo = data.customLogo || (typeof window !== 'undefined' ? localStorage.getItem('demandLogo') : '');
  if (!customLogo && typeof window !== 'undefined') {
    try {
      const docSnap = await getDoc(doc(db, 'settings', 'general'));
      if (docSnap.exists() && docSnap.data().demandLogo) {
        customLogo = docSnap.data().demandLogo;
        localStorage.setItem('demandLogo', customLogo!);
      }
    } catch (e) {
      console.warn('Could not fetch demand logo from settings:', e);
    }
  }

  const zoneName = data.zone || 'South East Central Railway';
  const qtyFormatted = `${(data.qty || 0).toFixed(3)} ${data.unit || 'Number'}`;
  const qtyWords = numberToWords(Math.round(data.qty || 1)) + ` ${data.unit || 'Number'}`;

  // Demanding Depot logic: Machine or Company Administrator
  let demandingDepotText = data.demandingDepot;
  if (!demandingDepotText) {
    if (data.isCompanyDemand || data.companyName) {
      demandingDepotText = `Company Administrator (${data.companyName || 'Registered Company'})`;
    } else if (data.machineName) {
      demandingDepotText = `Machine: ${data.machineName}`;
    } else {
      demandingDepotText = 'SSE/TM/Line/Raipur';
    }
  }

  // Sub-depot details: Show the machine that demanded it
  let subDepotText = data.subDepot;
  if (!subDepotText) {
    if (data.machineName) {
      subDepotText = `${data.machineName}`;
    } else if (data.companyName) {
      subDepotText = `${data.companyName}`;
    } else {
      subDepotText = '-';
    }
  }

  // Issuing Depot details: Show who is issuing the item or machine
  let issuingDepotText = data.issuingDepot || data.issuingMachine;
  if (!issuingDepotText) {
    if (data.forwardedTo) {
      issuingDepotText = `${data.forwardedTo}`;
    } else {
      issuingDepotText = '-';
    }
  }

  const allocationText = (data.allocationNo && data.allocationNo !== 'OPERATIONAL ALLOCATION') ? data.allocationNo : '-';

  // Authority / Administrator name for company demand
  const demandedByName = (data.isCompanyDemand || data.companyName) 
    ? `Company Administrator (${data.companyName || 'Admin'})` 
    : (data.forwardedBy || 'Demand Initiator');

  const htmlContent = `
    <div id="demand-pdf-container" style="width: 794px; padding: 25px; background: #ffffff; font-family: 'Arial', sans-serif; color: #111827; box-sizing: border-box; line-height: 1.2;">
      <!-- Top Center Logo Header -->
      <div style="text-align: center; margin-bottom: 12px;">
        <div style="margin-bottom: 6px; display: flex; justify-content: center;">
          ${getDemandLogoHTML(68, customLogo)}
        </div>
        <h1 style="font-size: 19px; font-weight: 800; margin: 0; color: #000000; letter-spacing: 0.5px; text-transform: uppercase;">${zoneName}</h1>
        <div style="font-size: 11px; font-weight: bold; color: #374151; margin-top: 2px;">माँगी गई सामग्री / MATERIALS DEMANDED</div>
      </div>

      <!-- Section Title Banner & Status -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 10px;">
        <div style="flex: 1; background-color: #fef08a; border: 1.5px solid #ca8a04; text-align: center; font-weight: 900; font-size: 15px; padding: 6px; color: #000;">
          माँग पत्र / Requisition (Demand)
        </div>
        <div style="border: 2px solid #16a34a; background: #f0fdf4; color: #166534; font-size: 14px; font-weight: 900; padding: 6px 14px; border-radius: 4px; text-transform: uppercase; white-space: nowrap;">
          ${data.status ? data.status.toUpperCase() : 'PENDING'}
        </div>
      </div>

      <!-- Demand Main Details Table -->
      <table style="width: 100%; border-collapse: collapse; border: 1.5px solid #000; font-size: 11px; text-align: center;">
        <tbody>
          <!-- Row 1 -->
          <tr>
            <td style="border: 1px solid #000; padding: 6px; width: 30%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">माँगकर्ता डिपो / शॉप</div>
              <div style="font-size: 10px; font-weight: bold;">Demanding Depot / Shop</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 3px; color: #000;">${demandingDepotText}</div>
            </td>
            <td style="border: 1px solid #000; padding: 6px; width: 25%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">सब-डिपो / Sub-Depot</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 3px;">${subDepotText}</div>
            </td>
            <td style="border: 1px solid #000; padding: 6px; width: 25%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">माँग-पत्र संख्या / Demand No.</div>
              <div style="font-size: 12px; font-weight: 800; margin-top: 3px; color: #1e3a8a;">${data.demandNo}</div>
            </td>
            <td style="border: 1px solid #000; padding: 6px; width: 20%; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">तारीख / Date</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 3px;">${data.date}</div>
            </td>
          </tr>

          <!-- Row 2 -->
          <tr>
            <td style="border: 1px solid #000; padding: 6px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">मूल्य सूची सं० /आइटम कोड</div>
              <div style="font-size: 10px; font-weight: bold;">PL No. / Item Code</div>
              <div style="font-size: 12px; font-weight: 800; margin-top: 3px; color: #000;">${data.plNo || 'N/A'}</div>
            </td>
            <td colspan="3" style="border: 1px solid #000; padding: 6px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">विवरण / Description</div>
              <div style="font-size: 12px; font-weight: 800; margin-top: 3px; color: #000;">${data.description || 'N/A'}</div>
              ${data.partNo ? `<div style="font-size: 10px; font-weight: bold; margin-top: 2px;">Part No: ${data.partNo}</div>` : ''}
            </td>
          </tr>

          <!-- Row 3 -->
          <tr>
            <td style="border: 1px solid #000; padding: 6px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">मात्रा / Qty.</div>
              <div style="font-size: 13px; font-weight: 800; margin-top: 3px; color: #000;">${qtyFormatted}</div>
            </td>
            <td colspan="3" style="border: 1px solid #000; padding: 6px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">मात्रा शब्दों में / Quantity in Words</div>
              <div style="font-size: 12px; font-weight: 800; margin-top: 3px; color: #000;">${qtyWords}</div>
            </td>
          </tr>

          <!-- Row 4 -->
          <tr>
            <td style="border: 1px solid #000; padding: 6px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">इकाई / Unit</div>
              <div style="font-size: 11px; font-weight: bold; margin-top: 2px;">${data.unit || '01 Number'}</div>
            </td>
            <td style="border: 1px solid #000; padding: 6px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">विनिधान सं० / Allocation No.</div>
              <div style="font-size: 10px; font-weight: bold; margin-top: 2px;">${allocationText}</div>
            </td>
            <td colspan="2" style="border: 1px solid #000; padding: 6px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">जारीकर्ता डिपो/शॉप कोड/प्रेषिती Issuing Depot/Shop Code/Consignee</div>
              <div style="font-size: 11px; font-weight: 800; margin-top: 2px; color: #000;">${issuingDepotText}</div>
            </td>
          </tr>

          <!-- Row 5: Remarks -->
          <tr>
            <td colspan="4" style="border: 1px solid #000; padding: 6px; vertical-align: top; text-align: left;">
              <div style="font-size: 9px; color: #4b5563;">विशेष विवरण / Remarks & Machine Details</div>
              <div style="font-size: 11px; font-weight: bold; margin-top: 2px; color: #000;">
                ${data.machineName ? `Machine Name: ${data.machineName}` : ''} 
                ${data.companyName ? `| Company: ${data.companyName}` : ''} 
                ${data.remarks ? `| Note: ${data.remarks}` : ''}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Signatures Footer -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 25px; padding: 0 10px;">
        <div style="text-align: center; width: 32%;">
          <div style="font-size: 11px; font-weight: bold; color: #111827;">${demandedByName}</div>
          <div style="font-size: 10px; font-weight: bold; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px;">माँगकर्ता अधिकारी / Demand Initiator</div>
        </div>
        <div style="text-align: center; width: 33%;">
          <div style="font-size: 11px; font-weight: 800; color: #000;">${data.forwardedTo || 'Controlling Officer'}</div>
          <div style="font-size: 10px; font-weight: bold; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px;">डिपो/शॉप अधिकारी / Depot/Shop Official</div>
        </div>
        <div style="text-align: center; width: 30%;">
          <div style="height: 20px;"></div>
          <div style="font-size: 10px; font-weight: bold; border-top: 1px dashed #000; padding-top: 4px;">नियंत्रक अधिकारी / Controlling Officer</div>
        </div>
      </div>

      <!-- Present Status & Details Section -->
      <div style="margin-top: 20px; border-top: 2px solid #000; padding-top: 10px;">
        <div style="font-size: 12px; font-weight: 800; color: #1e3a8a; margin-bottom: 6px;">
          माँग-पत्र की वर्तमान स्थिति / Present Status of Demand (Demand No: ${data.demandNo})
        </div>
        <div style="font-size: 11px; font-weight: bold; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 4px 8px; border-radius: 4px; display: inline-block;">
          Status: ${data.status ? data.status.toUpperCase() : 'FORWARDED / PROCESSING'}
        </div>
      </div>

      <!-- Issued Items Summary Table -->
      <div style="margin-top: 12px;">
        <div style="font-size: 12px; font-weight: 800; color: #1e3a8a; margin-bottom: 6px;">
          जारी की गई सामग्री का विवरण / Details of Items Issued
        </div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 9px; text-align: center;">
          <thead>
            <tr style="background: #f3f4f6; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 4px;">जारीकर्ता डिपो / Issuing Depot</th>
              <th style="border: 1px solid #000; padding: 4px;">इशू नोट का विवरण / Issue Note Details</th>
              <th style="border: 1px solid #000; padding: 4px;">मात्रा / Qty</th>
              <th style="border: 1px solid #000; padding: 4px;">इशू का प्रकार / Type</th>
              <th style="border: 1px solid #000; padding: 4px;">इशू रेट / Rate</th>
              <th style="border: 1px solid #000; padding: 4px;">इशू वैल्यू / Value</th>
              <th style="border: 1px solid #000; padding: 4px;">टिप्पणी / Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${
              data.issuedItems && data.issuedItems.length > 0
                ? data.issuedItems.map(item => `
                  <tr>
                    <td style="border: 1px solid #000; padding: 4px;">${item.issuingDepot}</td>
                    <td style="border: 1px solid #000; padding: 4px;">${item.issueNoteDetails}</td>
                    <td style="border: 1px solid #000; padding: 4px; font-weight: bold;">${item.qty}</td>
                    <td style="border: 1px solid #000; padding: 4px;">${item.type}</td>
                    <td style="border: 1px solid #000; padding: 4px;">Rs. ${item.rate}</td>
                    <td style="border: 1px solid #000; padding: 4px; font-weight: bold;">Rs. ${item.value}</td>
                    <td style="border: 1px solid #000; padding: 4px;">${item.remarks}</td>
                  </tr>
                `).join('')
                : `
                  <tr>
                    <td colspan="7" style="border: 1px solid #000; padding: 8px; font-style: italic; color: #6b7280;">
                      Demand Logged & Forwarded - Issue Note Pending
                    </td>
                  </tr>
                `
            }
          </tbody>
        </table>
      </div>

      <!-- Footer Stamp -->
      <div style="margin-top: 18px; text-align: right; font-size: 9px; color: #6b7280; font-style: italic;">
        Computerized Demand Voucher • ${zoneName}
      </div>
    </div>
  `;

  return renderAndDownloadPDF(htmlContent, `Demand_Voucher_${data.demandNo}.pdf`, download);
}

async function prepareSVGsForCanvas(container: HTMLElement) {
  const svgs = Array.from(container.querySelectorAll('svg'));
  for (const svg of svgs) {
    try {
      const w = parseFloat(svg.getAttribute('width') || '68') || 68;
      const h = parseFloat(svg.getAttribute('height') || '68') || 68;
      
      const scale = 3;
      const width = Math.round(w * scale);
      const height = Math.round(h * scale);

      const xml = new XMLSerializer().serializeToString(svg);
      const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = svgUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.drawImage(img, 0, 0, width, height);
        const pngDataUrl = canvas.toDataURL('image/png');

        const pngImg = document.createElement('img');
        pngImg.src = pngDataUrl;
        pngImg.style.width = `${w}px`;
        pngImg.style.height = `${h}px`;
        pngImg.style.display = 'block';
        pngImg.style.margin = '0 auto';
        pngImg.style.objectFit = 'contain';

        if (svg.parentNode) {
          svg.parentNode.replaceChild(pngImg, svg);
        }
      }
    } catch (e) {
      console.warn('SVG conversion error:', e);
    }
  }
}

/**
 * Common HTML to Canvas + jsPDF converter
 */
async function renderAndDownloadPDF(htmlString: string, fileName: string, download: boolean = true) {
  // Create off-screen container in DOM flow to ensure proper layout and rendering
  const tempDiv = document.createElement('div');
  tempDiv.style.position = 'absolute';
  tempDiv.style.left = '0';
  tempDiv.style.top = '0';
  tempDiv.style.opacity = '0.01';
  tempDiv.style.pointerEvents = 'none';
  tempDiv.style.zIndex = '-1';
  tempDiv.style.width = '210mm';
  tempDiv.innerHTML = htmlString;
  document.body.appendChild(tempDiv);

  try {
    // Pre-convert any inline SVG logos into crisp Base64 PNGs for 100% html2canvas compatibility
    await prepareSVGsForCanvas(tempDiv);

    // Ensure all images are fully loaded before rendering
    const allImgs = Array.from(tempDiv.querySelectorAll('img'));
    await Promise.all(
      allImgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      })
    );

    const targetEl = tempDiv.firstElementChild as HTMLElement;
    if (!targetEl) throw new Error('Failed to create render target');

    const onCloneHandler = (clonedDoc: Document) => {
      try {
        // Strip CSS filters that crash html2canvas parser
        const allEls = clonedDoc.querySelectorAll('*');
        allEls.forEach((el) => {
          if (el instanceof HTMLElement || el instanceof SVGElement) {
            if (el.style.filter) el.style.filter = 'none';
            if (el.style.backdropFilter) el.style.backdropFilter = 'none';
          }
        });
        // Convert textPaths in SVGs to plain text nodes to avoid SVG textPath parsing crashes
        const textPaths = clonedDoc.querySelectorAll('textPath');
        textPaths.forEach((tp) => {
          try {
            const textVal = tp.textContent || '';
            const parent = tp.parentElement;
            if (parent) {
              parent.textContent = textVal;
              parent.setAttribute('text-anchor', 'middle');
            }
          } catch (innerE) {
            console.warn('textPath cleanup error:', innerE);
          }
        });
      } catch (cloneErr) {
        console.warn('onclone handler warning:', cloneErr);
      }
    };

    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(targetEl, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: onCloneHandler
      });
    } catch (firstErr) {
      console.warn('html2canvas scale 2 failed, retrying scale 1.2:', firstErr);
      canvas = await html2canvas(targetEl, {
        scale: 1.2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: onCloneHandler
      });
    }

    let imgData: string;
    try {
      imgData = canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('toDataURL PNG failed, falling back to JPEG:', e);
      imgData = canvas.toDataURL('image/jpeg', 0.95);
    }

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, Math.min(imgHeight, pageHeight));

    if (download) {
      pdf.save(fileName);
    } else {
      // Open in new tab for print
      try {
        const blob = pdf.output('blob');
        const blobUrl = URL.createObjectURL(blob);
        const newWin = window.open(blobUrl, '_blank');
        if (!newWin) {
          // If popup blocked, fallback to saving
          pdf.save(fileName);
        }
      } catch (winErr) {
        console.warn('Window open failed, falling back to save:', winErr);
        pdf.save(fileName);
      }
    }

    return pdf;
  } catch (err) {
    console.error('Error generating PDF voucher:', err);
    throw err;
  } finally {
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
  }
}
