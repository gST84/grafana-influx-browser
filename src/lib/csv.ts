import { labelAmong, unitOf, withUnit } from './series';
import { Series, SeriesValue } from './types';

export type CsvLayout = 'wide' | 'long';
export type CsvFormat = 'csv-eu' | 'csv';

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD HH:MM:SS" in the browser's timezone, which Excel reads as a date. */
export function formatLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatValue(v: SeriesValue | undefined, decimalComma: boolean): string {
  if (v == null) {
    return '';
  }
  if (typeof v === 'boolean') {
    return v ? '1' : '0';
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      return '';
    }
    const s = v.toFixed(9).replace(/\.?0+$/, ''); // drop float noise like 24.025000000000002
    return decimalComma ? s.replace('.', ',') : s;
  }
  return v;
}

function quote(cell: string, delimiter: string): string {
  return /["\r\n]/.test(cell) || cell.includes(delimiter) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(series: Series[], layout: CsvLayout, format: CsvFormat, timezone: string): string {
  const delimiter = format === 'csv-eu' ? ';' : ',';
  const decimalComma = format === 'csv-eu';
  const rows: string[][] = [];
  const timeCol = `time (${timezone})`;

  if (layout === 'long') {
    const tagKeys = [...new Set(series.flatMap((s) => Object.keys(s.tags)))].sort();
    rows.push([timeCol, 'measurement', 'field', ...tagKeys, 'value']);
    const all: Array<[number, Series, SeriesValue]> = [];
    for (const s of series) {
      s.times.forEach((t, i) => all.push([t, s, s.values[i]]));
    }
    all.sort((a, b) => a[0] - b[0]);
    for (const [t, s, v] of all) {
      rows.push([formatLocal(t), s.measurement, s.field, ...tagKeys.map((k) => s.tags[k] ?? ''), formatValue(v, decimalComma)]);
    }
  } else {
    rows.push([timeCol, ...series.map((s) => withUnit(`${s.measurement} · ${labelAmong(s, series)}`, unitOf(s)))]);
    const table = new Map<number, SeriesValue[]>();
    series.forEach((s, i) =>
      s.times.forEach((t, j) => {
        if (!table.has(t)) {
          table.set(t, new Array(series.length).fill(null));
        }
        table.get(t)![i] = s.values[j];
      })
    );
    for (const t of [...table.keys()].sort((a, b) => a - b)) {
      rows.push([formatLocal(t), ...table.get(t)!.map((v) => formatValue(v, decimalComma))]);
    }
  }
  // BOM so Excel detects UTF-8.
  return '﻿' + rows.map((r) => r.map((c) => quote(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}

export function saveFile(content: string, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
