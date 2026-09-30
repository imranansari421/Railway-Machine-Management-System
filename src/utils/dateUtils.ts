/**
 * Formats date values to Indian standard DD-MM-YYYY format (e.g. 01-07-2026 instead of 2026-07-01)
 */
export function formatDateToDDMMYYYY(val?: string | number | Date | null): string {
  if (val === null || val === undefined) return '';

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const dd = String(val.getDate()).padStart(2, '0');
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const yyyy = val.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  const str = String(val).trim();
  if (!str || str === 'N/A' || str === '-' || str === 'None' || str === 'Invalid Date') return str;

  // If already in DD-MM-YYYY format
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    return str;
  }

  // Handle YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    const yyyy = ymdMatch[1];
    const mm = ymdMatch[2].padStart(2, '0');
    const dd = ymdMatch[3].padStart(2, '0');
    return `${dd}-${mm}-${yyyy}`;
  }

  // Handle DD/MM/YYYY or DD.MM.YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/\.](\d{1,2})[/\.](\d{4})/);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0');
    const mm = dmyMatch[2].padStart(2, '0');
    const yyyy = dmyMatch[3];
    return `${dd}-${mm}-${yyyy}`;
  }

  // Check if string looks like an ISO timestamp number
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    const d = new Date(str.length === 10 ? num * 1000 : num);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    }
  }

  return str;
}
