import { DataFrame, FieldType } from '@grafana/data';
import { FieldKind, Series, SeriesValue, Split } from './types';

/** Converts frames from the Grafana Flux data source (name = measurement, field = _field, labels = tags). */
export function framesToSeries(frames: DataFrame[]): Series[] {
  const out: Series[] = [];
  for (const frame of frames) {
    const time = frame.fields.find((f) => f.type === FieldType.time);
    if (!time) {
      continue;
    }
    for (const f of frame.fields) {
      if (f === time) {
        continue;
      }
      const labels = { ...(f.labels ?? {}) };
      const measurement = labels._measurement ?? frame.name ?? '';
      delete labels._measurement;
      delete labels._field;
      const kind: FieldKind = f.type === FieldType.number ? 'number' : f.type === FieldType.boolean ? 'boolean' : 'string';
      out.push({
        measurement,
        field: f.name,
        tags: labels,
        kind,
        times: [...time.values] as number[],
        values: [...f.values] as SeriesValue[],
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.measurement.localeCompare(b.measurement) ||
      a.field.localeCompare(b.field) ||
      JSON.stringify(Object.entries(a.tags).sort()).localeCompare(JSON.stringify(Object.entries(b.tags).sort()))
  );
}

export const seriesKey = (s: Series) => JSON.stringify([s.measurement, s.field, Object.entries(s.tags).sort()]);

// The unit is stored as a string tag; recognise the usual names for it.
export const UNIT_TAGS = new Set(['unit', 'units', 'unit_of_measurement', 'uom', 'eenheid']);

export function unitTagKey(s: Series): string | undefined {
  return Object.keys(s.tags).find((k) => UNIT_TAGS.has(k.toLowerCase()));
}

export function unitOf(s: Series): string {
  const k = unitTagKey(s);
  return k ? s.tags[k] : '';
}

export const withUnit = (text: string, unit: string) => (unit ? `${text} (${unit})` : text);

/** Tags whose value differs between the given series (the unit tag excluded). */
export function varyingTags(series: Series[]): string[] {
  const keys = new Set(series.flatMap((s) => Object.keys(s.tags)));
  return [...keys]
    .filter((k) => !UNIT_TAGS.has(k.toLowerCase()) && new Set(series.map((s) => s.tags[k])).size > 1)
    .sort();
}

const NAME_LIKE = new Set(['entity_id', 'friendly_name']);

export function shortLabel(s: Series, tags: string[], withField: boolean): string {
  const parts: string[] = [];
  for (const k of tags) {
    if (s.tags[k] != null) {
      parts.push(NAME_LIKE.has(k) ? s.tags[k] : `${k}=${s.tags[k]}`);
    }
  }
  if (withField || !parts.length) {
    parts.unshift(s.field);
  }
  return parts.join(' · ');
}

/** Label of a series among all loaded series (only tags that vary within its measurement). */
export function labelAmong(s: Series, all: Series[]): string {
  const peers = all.filter((p) => p.measurement === s.measurement);
  return shortLabel(s, varyingTags(peers), new Set(peers.map((p) => p.field)).size > 1);
}

export interface ChartGroup {
  key: string;
  title: string;
  unit: string;
  series: Series[];
}

/** Splits series into charts. Every split keeps a single unit per chart: never a second y-axis. */
export function chartGroups(series: Series[], split: Split): ChartGroup[] {
  const groups = new Map<string, ChartGroup>();
  for (const s of series) {
    const unit = unitOf(s);
    let key: string;
    let title: string;
    if (split === 'measurement') {
      key = JSON.stringify([s.measurement, unit]);
      title = withUnit(s.measurement, unit);
    } else if (split === 'field') {
      key = JSON.stringify([s.measurement, s.field, unit]);
      title = withUnit(`${s.measurement} · ${s.field}`, unit);
    } else {
      key = seriesKey(s);
      title = withUnit(`${s.measurement} · ${labelAmong(s, series)}`, unit);
    }
    if (!groups.has(key)) {
      groups.set(key, { key, title, unit, series: [] });
    }
    groups.get(key)!.series.push(s);
  }
  return [...groups.values()];
}

export const isTextSeries = (s: Series) => s.kind === 'string';
