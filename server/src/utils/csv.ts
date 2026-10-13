/**
 * CSV encoding (RFC 4180) with spreadsheet formula-injection protection: text cells that begin
 * with =, +, -, @, tab or carriage return are prefixed with an apostrophe so Excel / Power BI /
 * Sheets treat them as text. Numbers, booleans and dates are written as plain values.
 */
const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  let s = String(value);
  if (DANGEROUS.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // UTF-8 BOM so Excel opens ₹ and non-ASCII names correctly; Power BI ignores it.
  return '﻿' + csvRow(headers) + rows.map(csvRow).join('');
}
