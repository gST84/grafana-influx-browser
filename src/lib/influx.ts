import { DataFrame, FieldType } from '@grafana/data';
import { DataSourceRef } from '@grafana/schema';
import { BackendDataSourceResponse, getBackendSrv, isFetchError, toDataQueryResponse } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { MeasurementSchema, FieldInfo, FieldKind } from './types';
import { fieldTypesQuery, measurementsQuery, tagKeysQuery, tagValuesQuery } from './flux';

export interface AbsRange {
  from: number;
  to: number;
}

const RESERVED = new Set(['_start', '_stop', '_measurement', '_field', '_time', '_value', 'result', 'table']);

/** Runs a Flux query through Grafana's InfluxDB data source (/api/ds/query). */
export async function runFlux(ds: DataSourceRef, query: string, range: AbsRange): Promise<DataFrame[]> {
  const body = {
    from: String(range.from),
    to: String(range.to),
    queries: [{ refId: 'A', datasource: ds, query, intervalMs: 1000, maxDataPoints: 100000 }],
  };
  let response;
  try {
    response = await lastValueFrom(
      getBackendSrv().fetch<BackendDataSourceResponse>({
        url: '/api/ds/query',
        method: 'POST',
        data: body,
        showErrorAlert: false,
      })
    );
  } catch (err) {
    if (isFetchError(err)) {
      const res = toDataQueryResponse({ data: err.data as BackendDataSourceResponse });
      throw new Error(res.errors?.[0]?.message || err.data?.message || err.statusText || 'Query mislukt');
    }
    throw err;
  }
  const res = toDataQueryResponse(response);
  if (res.errors?.length) {
    throw new Error(res.errors[0].message || 'Query mislukt');
  }
  return res.data as DataFrame[];
}

/** All string values of the "_value" column(s), e.g. from schema.* functions. */
function valueColumn(frames: DataFrame[]): string[] {
  const out: string[] = [];
  for (const frame of frames) {
    const field = frame.fields.find((f) => f.name === '_value') ?? frame.fields.find((f) => f.type === FieldType.string);
    for (const v of field?.values ?? []) {
      if (v != null) {
        out.push(String(v));
      }
    }
  }
  return out;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export async function listBuckets(ds: DataSourceRef, range: AbsRange): Promise<string[]> {
  const frames = await runFlux(ds, 'buckets()', range);
  const names = frames.flatMap((f) => f.fields.find((x) => x.name === 'name')?.values ?? []).map(String);
  // User buckets first, system buckets (_monitoring, _tasks) last.
  return [...new Set(names)].sort((a, b) => Number(a.startsWith('_')) - Number(b.startsWith('_')) || byName(a, b));
}

export async function listMeasurements(ds: DataSourceRef, bucket: string, range: AbsRange): Promise<string[]> {
  return [...new Set(valueColumn(await runFlux(ds, measurementsQuery(bucket), range)))].sort(byName);
}

export async function listTagValues(
  ds: DataSourceRef,
  bucket: string,
  measurement: string,
  tag: string,
  range: AbsRange
): Promise<string[]> {
  return [...new Set(valueColumn(await runFlux(ds, tagValuesQuery(bucket, measurement, tag), range)))].sort(byName);
}

function kindOf(type: FieldType): FieldKind {
  if (type === FieldType.number) {
    return 'number';
  }
  return type === FieldType.boolean ? 'boolean' : 'string';
}

export async function loadSchema(
  ds: DataSourceRef,
  bucket: string,
  measurement: string,
  range: AbsRange
): Promise<MeasurementSchema> {
  const [tagFrames, fieldFrames] = await Promise.all([
    runFlux(ds, tagKeysQuery(bucket, measurement), range),
    runFlux(ds, fieldTypesQuery(bucket, measurement), range),
  ]);
  const tags = [...new Set(valueColumn(tagFrames))].filter((t) => !RESERVED.has(t)).sort(byName);
  const fields = new Map<string, FieldKind>();
  for (const frame of fieldFrames) {
    for (const f of frame.fields) {
      if (f.type === FieldType.time) {
        continue;
      }
      // A field that is numeric in one series and text in another is treated as text.
      if (fields.get(f.name) !== 'string') {
        fields.set(f.name, kindOf(f.type));
      }
    }
  }
  const list: FieldInfo[] = [...fields].map(([name, type]) => ({ name, type })).sort((a, b) => byName(a.name, b.name));
  return { fields: list, tags };
}
