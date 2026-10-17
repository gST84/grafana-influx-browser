import { QuerySelection } from './types';

export const DURATION_RE = /^(\d+(ns|us|ms|mo|s|m|h|d|w|y))+$/;
export const NUMERIC_FNS = ['mean', 'median', 'sum', 'min', 'max', 'spread', 'stddev'];
export const AGG_FNS = [...NUMERIC_FNS, 'last', 'first', 'count'];
const TZ_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;

/** The Grafana InfluxDB data source fills in these variables from the request's time range. */
const RANGE = 'range(start: v.timeRangeStart, stop: v.timeRangeStop)';

export function fluxStr(v: string): string {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$\{/g, '\\${') + '"';
}

export function fluxTag(key: string): string {
  return key === '_field' ? 'r._field' : `r[${fluxStr(key)}]`;
}

export function fluxOr(conds: string[]): string {
  return conds.length === 1 ? conds[0] : `(${conds.join(' or ')})`;
}

export function measurementsQuery(bucket: string): string {
  return `import "influxdata/influxdb/schema"\nschema.measurements(bucket: ${fluxStr(bucket)}, start: v.timeRangeStart, stop: v.timeRangeStop)`;
}

export function tagKeysQuery(bucket: string, measurement: string): string {
  return (
    'import "influxdata/influxdb/schema"\n' +
    `schema.measurementTagKeys(bucket: ${fluxStr(bucket)}, measurement: ${fluxStr(measurement)}, start: v.timeRangeStart, stop: v.timeRangeStop)`
  );
}

export function tagValuesQuery(bucket: string, measurement: string, tag: string): string {
  return (
    'import "influxdata/influxdb/schema"\n' +
    `schema.measurementTagValues(bucket: ${fluxStr(bucket)}, measurement: ${fluxStr(measurement)}, tag: ${fluxStr(tag)}, start: v.timeRangeStart, stop: v.timeRangeStop)`
  );
}

/** last() per series is pushed down to the storage engine and reveals each field's type. */
export function fieldTypesQuery(bucket: string, measurement: string): string {
  return `from(bucket: ${fluxStr(bucket)})\n  |> ${RANGE}\n  |> filter(fn: (r) => r._measurement == ${fluxStr(measurement)})\n  |> last()`;
}

/**
 * Boolean filter expression for the selections.
 * numeric=true keeps only numeric fields, false only text/boolean fields, undefined all.
 */
export function selectionFilter(selections: QuerySelection[], numeric?: boolean): string | null {
  const parts: string[] = [];
  for (const sel of selections) {
    const fields = sel.fields
      .filter((f) => numeric === undefined || numeric === (f.type === 'number'))
      .map((f) => f.name);
    if (!fields.length) {
      continue;
    }
    const cond = [`r._measurement == ${fluxStr(sel.measurement)}`, fluxOr(fields.map((f) => `r._field == ${fluxStr(f)}`))];
    for (const [tag, values] of Object.entries(sel.tags)) {
      if (values.length) {
        cond.push(fluxOr(values.map((v) => `${fluxTag(tag)} == ${fluxStr(v)}`)));
      }
    }
    parts.push(`(${cond.join(' and ')})`);
  }
  return parts.length ? parts.join(' or ') : null;
}

export interface DataQueryOptions {
  bucket: string;
  selections: QuerySelection[];
  /** Flux duration, or "none" for raw data. */
  window: string;
  fn: string;
  timezone?: string;
}

/**
 * Data query for the selections. Numeric aggregates fail on strings and booleans,
 * so those fields are aggregated with last() in a separate pipe.
 */
export function dataQuery({ bucket, selections, window, fn, timezone }: DataQueryOptions): string {
  if (window !== 'none' && !DURATION_RE.test(window)) {
    throw new Error(`Ongeldige duur: ${window}`);
  }
  if (!AGG_FNS.includes(fn)) {
    throw new Error(`Onbekende functie: ${fn}`);
  }
  const tz = timezone && TZ_RE.test(timezone) ? timezone : 'UTC';
  const header = `import "timezone"\noption location = timezone.location(name: ${fluxStr(tz)})\n\n`;
  const base = `from(bucket: ${fluxStr(bucket)})\n  |> ${RANGE}`;
  const agg = (f: string) =>
    window === 'none' ? '' : `\n  |> aggregateWindow(every: ${window}, fn: ${f}, createEmpty: false, timeSrc: "_start")`;

  if (window === 'none' || !NUMERIC_FNS.includes(fn)) {
    const flt = selectionFilter(selections);
    if (!flt) {
      throw new Error('Kies minstens één value');
    }
    return `${header}${base}\n  |> filter(fn: (r) => ${flt})${agg(fn)}`;
  }

  const pipes: Array<[string, string]> = [];
  const num = selectionFilter(selections, true);
  const other = selectionFilter(selections, false);
  if (num) {
    pipes.push(['num', `${base}\n  |> filter(fn: (r) => ${num})${agg(fn)}`]);
  }
  if (other) {
    pipes.push(['other', `${base}\n  |> filter(fn: (r) => ${other})${agg('last')}`]);
  }
  if (!pipes.length) {
    throw new Error('Kies minstens één value');
  }
  if (pipes.length === 1) {
    return header + pipes[0][1];
  }
  return `${header}${pipes.map(([n, p]) => `${n} = ${p}`).join('\n\n')}\n\nunion(tables: [num, other])`;
}

const NICE_WINDOWS: Array<[number, string]> = [
  [1, '1s'], [5, '5s'], [10, '10s'], [30, '30s'], [60, '1m'], [120, '2m'], [300, '5m'], [600, '10m'],
  [900, '15m'], [1800, '30m'], [3600, '1h'], [7200, '2h'], [10800, '3h'], [21600, '6h'], [43200, '12h'],
  [86400, '1d'], [172800, '2d'], [604800, '7d'], [2592000, '30d'],
];

/** A "nice" aggregateWindow giving about `points` points per series. */
export function autoWindow(fromMs: number, toMs: number, points = 1000): string {
  const target = (toMs - fromMs) / 1000 / Math.max(points, 1);
  return (NICE_WINDOWS.find(([s]) => s >= target) ?? NICE_WINDOWS[NICE_WINDOWS.length - 1])[1];
}

const DUR_MS: Record<string, number> = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };

/** Duration in ms, or null when it has no fixed length (months, years). */
export function durationMs(d: string): number | null {
  let ms = 0;
  for (const [, n, u] of d.matchAll(/(\d+)(ns|us|ms|mo|s|m|h|d|w|y)/g)) {
    if (!(u in DUR_MS)) {
      return null;
    }
    ms += Number(n) * DUR_MS[u];
  }
  return ms || null;
}
