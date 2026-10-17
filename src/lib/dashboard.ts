import { DataSourceRef } from '@grafana/schema';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { fluxOr, fluxStr, fluxTag } from './flux';
import {
  chartUnitText,
  grafanaUnit,
  stateTimelineFieldConfig,
  stateTimelineOptions,
  timeseriesFieldConfig,
  timeseriesOptions,
} from './panels';
import { chartGroups, unitTagKey, varyingTags } from './series';
import { DrawStyle, Naming, Series, Split } from './types';

const NAME_TAGS = ['friendly_name', 'name', 'alias', 'display_name', 'sensor_name', 'naam'];
const ID_TAGS = ['entity_id', 'sensor_id', 'device_id', 'sensor', 'device', 'id', 'topic'];

/** Flux expression that names a series from its tags, e.g. "PV vermogen (pv_power)". */
export function seriesNameExpr(measurement: string, series: Series[], naming: Naming, withField: boolean): string {
  const keys = [...new Set(series.flatMap((s) => Object.keys(s.tags)))];
  const find = (list: string[]) => list.map((n) => keys.find((k) => k.toLowerCase() === n)).find(Boolean);
  const nameTag = find(NAME_TAGS);
  const idTag = find(ID_TAGS);
  const [a, b] = naming === 'id' ? [idTag, nameTag] : [nameTag, idTag];
  let expr: string;
  if (naming === 'both' && a && b) {
    const A = fluxTag(a);
    const B = fluxTag(b);
    expr = `if exists ${A} and exists ${B} then ${A} + " (" + ${B} + ")" else if exists ${A} then ${A} else if exists ${B} then ${B} else r._field`;
  } else if (a || b) {
    const first = fluxTag((a ?? b)!);
    expr = `if exists ${first} then ${first} else r._field`;
  } else {
    // No name/id tags: use the tags that tell these series apart, else measurement + field.
    const vary = varyingTags(series);
    if (!vary.length) {
      return `${fluxStr(measurement + ' · ')} + r._field`;
    }
    expr = vary.map((k) => `(if exists ${fluxTag(k)} then ${fluxTag(k)} else "")`).join(' + " · " + ');
  }
  return withField ? `r._field + " · " + (${expr})` : expr;
}

export interface DashboardOptions {
  title: string;
  ds: DataSourceRef;
  bucket: string;
  series: Series[];
  /** Tag filters chosen per measurement. */
  tagFilters: Record<string, Record<string, string[]>>;
  split: Split;
  style: DrawStyle;
  fn: string;
  naming: Naming;
  time: { from: string; to: string };
}

function panelQuery(
  o: DashboardOptions,
  measurement: string,
  series: Series[],
  unit: string,
  withField: boolean,
  fn: string
): string {
  const fields = [...new Set(series.map((s) => s.field))];
  const conds = [`r._measurement == ${fluxStr(measurement)}`, fluxOr(fields.map((f) => `r._field == ${fluxStr(f)}`))];
  for (const [k, values] of Object.entries(o.tagFilters[measurement] ?? {})) {
    if (values.length) {
      conds.push(fluxOr(values.map((v) => `${fluxTag(k)} == ${fluxStr(v)}`)));
    }
  }
  const unitKey = series.map(unitTagKey).find(Boolean);
  if (unit && unitKey) {
    conds.push(`${fluxTag(unitKey)} == ${fluxStr(unit)}`);
  }
  if (o.split === 'series') {
    for (const [k, v] of Object.entries(series[0].tags)) {
      conds.push(`${fluxTag(k)} == ${fluxStr(v)}`);
    }
  }
  return [
    `from(bucket: ${fluxStr(o.bucket)})`,
    '  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)',
    `  |> filter(fn: (r) => ${conds.join(' and ')})`,
    `  |> aggregateWindow(every: v.windowPeriod, fn: ${fn}, createEmpty: false)`,
    `  |> map(fn: (r) => ({r with _field: ${seriesNameExpr(measurement, series, o.naming, withField)}}))`,
    '  |> keep(columns: ["_time", "_value", "_field"])',
  ].join('\n');
}

/** Dashboard model with panels that follow the browser's current view. */
export function buildDashboard(o: DashboardOptions) {
  type Panel = Record<string, unknown> & { type: string; rows: number };
  const panels: Panel[] = [];

  for (const g of chartGroups(o.series, o.split)) {
    const kinds: Record<string, Series[]> = { timeseries: [], 'state-timeline': [] };
    for (const s of g.series) {
      kinds[s.kind === 'number' ? 'timeseries' : 'state-timeline'].push(s);
    }
    for (const [type, series] of Object.entries(kinds)) {
      if (!series.length) {
        continue;
      }
      const byMeasurement = new Map<string, Series[]>();
      for (const s of series) {
        byMeasurement.set(s.measurement, [...(byMeasurement.get(s.measurement) ?? []), s]);
      }
      const withField = new Set(series.map((s) => s.field)).size > 1;
      const fn = type === 'timeseries' ? o.fn : 'last';
      const targets = [...byMeasurement].map(([m, ss], i) => ({
        refId: String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''),
        datasource: o.ds,
        query: panelQuery(o, m, ss, g.unit, withField, fn),
      }));
      const unit = grafanaUnit(chartUnitText(g.unit, [...byMeasurement.keys()]));
      panels.push({
        type,
        title: g.title,
        datasource: o.ds,
        targets,
        rows: series.length,
        ...(type === 'timeseries'
          ? { fieldConfig: timeseriesFieldConfig(unit, o.style), options: timeseriesOptions(series.length) }
          : { fieldConfig: stateTimelineFieldConfig(series), options: stateTimelineOptions }),
      });
    }
  }

  // Graphs first in two columns, full-width state timelines below them.
  panels.sort((a, b) => Number(a.type === 'state-timeline') - Number(b.type === 'state-timeline'));
  const graphs = panels.filter((p) => p.type === 'timeseries').length;
  let x = 0;
  let y = 0;
  let rowH = 0;
  const laidOut = panels.map(({ rows, ...p }, i) => {
    const full = graphs === 1 || p.type === 'state-timeline';
    const w = full ? 24 : 12;
    const h = p.type === 'state-timeline' ? Math.min(20, 3 + 2 * rows) : 9;
    if (x + w > 24) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const gridPos = { x, y, w, h };
    x += w;
    rowH = Math.max(rowH, h);
    return { ...p, id: i + 1, gridPos };
  });

  return {
    title: o.title,
    tags: ['influx-browser', o.bucket],
    timezone: 'browser',
    editable: true,
    schemaVersion: 39,
    time: o.time,
    templating: { list: [] },
    annotations: { list: [] },
    panels: laidOut,
  };
}

/** Same dashboard as a portable import file: the data source becomes an import input. */
export function toImportFile(dashboard: ReturnType<typeof buildDashboard>, dsUid: string) {
  const json = JSON.stringify(dashboard).split(JSON.stringify(dsUid)).join('"${DS_INFLUXDB}"');
  return {
    __inputs: [
      { name: 'DS_INFLUXDB', label: 'InfluxDB (Flux)', description: '', type: 'datasource', pluginId: 'influxdb', pluginName: 'InfluxDB' },
    ],
    __requires: [
      { type: 'datasource', id: 'influxdb', name: 'InfluxDB', version: '1.0.0' },
      { type: 'panel', id: 'timeseries', name: 'Time series', version: '' },
      { type: 'panel', id: 'state-timeline', name: 'State timeline', version: '' },
    ],
    ...JSON.parse(json),
    id: null,
    uid: null,
  };
}

/** Saves a new dashboard and returns its URL. */
export async function createDashboard(dashboard: ReturnType<typeof buildDashboard>, folderUid?: string): Promise<string> {
  const res = await lastValueFrom(
    getBackendSrv().fetch<{ url: string }>({
      url: '/api/dashboards/db',
      method: 'POST',
      data: { dashboard: { ...dashboard, id: null, uid: null }, folderUid: folderUid ?? '', overwrite: false },
      showErrorAlert: false,
    })
  );
  return res.data.url;
}
