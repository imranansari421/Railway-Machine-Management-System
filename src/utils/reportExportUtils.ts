import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { toast } from 'sonner';

export interface ReportPdfConfig {
  title: string;
  subtitle?: string;
  filterSummary?: string;
  headers: string[];
  rows: (string | number)[][];
  filename?: string;
  orientation?: 'landscape' | 'portrait';
  columnStyles?: Record<number, any>;
}

export function exportReportToPdf({
  title,
  subtitle,
  filterSummary,
  headers,
  rows,
  filename,
  orientation = 'landscape',
  columnStyles,
}: ReportPdfConfig) {
  try {
    const doc = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Top Header Banner
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 24, 'F');

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('RAILWAY MACHINE MANAGEMENT SYSTEM (RMMS)', 14, 10);

    // Subtitle / Report Name
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(226, 232, 240); // slate-200
    doc.text(`${title.toUpperCase()} ${subtitle ? `— ${subtitle}` : ''}`, 14, 16);

    // Metadata: Timestamp & Record Count
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // slate-400
    const metaText = `Generated: ${format(new Date(), 'dd-MM-yyyy HH:mm')} | Total Records: ${rows.length}`;
    doc.text(metaText, pageWidth - 14, 16, { align: 'right' });

    // Filter Summary Bar (if present)
    let startY = 27;
    if (filterSummary) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105); // slate-600
      doc.text(`Active Filters: ${filterSummary}`, 14, startY);
      startY += 5;
    }

    // Determine font size and padding dynamically based on column count
    const numCols = headers.length;
    const dynamicFontSize = numCols > 11 ? 6.2 : numCols > 8 ? 7 : 8;
    const dynamicHeaderSize = numCols > 11 ? 6.8 : numCols > 8 ? 7.5 : 8.5;
    const dynamicPadding = numCols > 11 ? 1.2 : 1.8;

    // AutoTable column styles resolution
    const resolvedColumnStyles: Record<number, any> = columnStyles ? { ...columnStyles } : {};
    headers.forEach((h, idx) => {
      const hLower = (h || '').toLowerCase().trim();
      if (!resolvedColumnStyles[idx]) {
        if (idx === 0 && (hLower === 'sr.' || hLower === 's.no' || hLower === 'sl' || hLower === 'sl.no' || hLower === '#')) {
          resolvedColumnStyles[idx] = { halign: 'center', cellWidth: 10 };
        } else if (hLower.includes('date') || hLower.includes('period') || hLower.includes('visit')) {
          resolvedColumnStyles[idx] = { halign: 'center', cellWidth: 48, minCellWidth: 48, fontStyle: 'bold' };
        }
      }
    });

    // AutoTable
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: startY,
      margin: { left: 8, right: 8, bottom: 16 },
      theme: 'grid',
      styles: {
        fontSize: dynamicFontSize,
        cellPadding: dynamicPadding,
        textColor: [30, 41, 59],
        overflow: 'linebreak',
        lineWidth: 0.15,
        lineColor: [203, 213, 225], // slate-300 visible grid lines
        valign: 'middle',
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: dynamicHeaderSize,
        halign: 'center',
        valign: 'middle',
        lineWidth: 0.15,
        lineColor: [51, 65, 85],
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      tableLineColor: [148, 163, 184], // slate-400 crisp outer border
      tableLineWidth: 0.2,
      columnStyles: resolvedColumnStyles,
      didDrawPage: (data) => {
        // Footer Page Number
        const str = `Page ${data.pageNumber} of ${(doc as any).internal.getNumberOfPages()}`;
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(str, pageWidth - 14, pageHeight - 8, { align: 'right' });

        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text('Confidential — RMMS Official Operating Records', 14, pageHeight - 8);
      },
    });

    const safeFilename = filename || `RMMS_${title.replace(/[\s/]+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(safeFilename);
    toast.success('PDF report exported successfully!');
  } catch (err) {
    console.error('PDF export error:', err);
    toast.error('Failed to export PDF report.');
  }
}

export function exportReportToExcel(
  data: Record<string, any>[],
  sheetName: string,
  filename?: string
) {
  try {
    if (!data || data.length === 0) {
      toast.warning('No records available to export.');
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));

    // Auto column widths based on headers and sample row lengths
    const colKeys = Object.keys(data[0] || {});
    worksheet['!cols'] = colKeys.map(key => {
      let maxLen = key.length;
      const sampleSize = Math.min(data.length, 100);
      for (let i = 0; i < sampleSize; i++) {
        const valStr = String(data[i][key] ?? '');
        if (valStr.length > maxLen) maxLen = Math.min(valStr.length, 60);
      }
      return { wch: Math.max(maxLen + 3, 14) };
    });

    const safeFilename = filename || `RMMS_${sheetName.replace(/[\s/]+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(workbook, safeFilename);
    toast.success('Excel report exported successfully!');
  } catch (err) {
    console.error('Excel export error:', err);
    toast.error('Failed to export Excel report.');
  }
}
