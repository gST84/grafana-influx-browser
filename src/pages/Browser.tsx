import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { AbsoluteTimeRange, DataSourceInstanceSettings, GrafanaTheme2, TimeRange, dateTime, rangeUtil } from '@grafana/data';
import { DataSourceRef, TimeZone } from '@grafana/schema';
import { DataSourcePicker, PluginPage, getDataSourceSrv } from '@grafana/runtime';
import {
  Alert,
  Button,
  Combobox,
  EmptyState,
  FilterInput,
  Checkbox,
  Field,
  LoadingPlaceholder,
  RadioButtonGroup,
  Stack,
  Tab,
  TabsBar,
  Text,
  TimeRangePicker,
  useStyles2,
} from '@grafana/ui';
import { AbsRange, listBuckets, listMeasurements, listTagValues, loadSchema, runFlux } from '../lib/influx';
import { AGG_FNS, autoWindow, dataQuery } from '../lib/flux';
import { framesToSeries } from '../lib/series';
import { toCsv, saveFile } from '../lib/csv';
import { buildDashboard, createDashboard, toImportFile } from '../lib/dashboard';
import { DrawStyle, MeasurementSchema, MeasurementSelection, Naming, QuerySelection, Series, Split } from '../lib/types';
import { SelectionCard } from '../components/SelectionCard';
import { ChartView, TableView } from '../components/ResultViews';
import { DashboardModal, DownloadModal, DownloadSettings } from '../components/Modals';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const STORE = 'gst84-influxbrowser.';

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(STORE + key, JSON.stringify(value));
  } catch {
    // ignore: storage is a convenience only
  }
}

const isFluxInflux = (ds: DataSourceInstanceSettings) =>
  ds.type === 'influxdb' && String((ds.jsonData as { version?: string }).version ?? '').toLowerCase() === 'flux';

const windowOptions = ['auto', 'none', '10s', '1m', '5m', '15m', '1h', '6h', '1d', '7d'].map((w) => ({
  value: w,
  label: w === 'none' ? 'ruwe data' : w,
}));
const fnOptions = AGG_FNS.map((f) => ({ value: f, label: f }));

interface LoadedData {
  series: Series[];
  window: string;
  fn: string;
  query: string;
  range: TimeRange;
}

export default function Browser() {
  const s = useStyles2(getStyles);

  // --- settings -----------------------------------------------------------
  const [dsUid, setDsUid] = useState<string | undefined>(() => load('ds', undefined));
  const ds: DataSourceRef | undefined = useMemo(() => {
    const inst = dsUid ? getDataSourceSrv().getInstanceSettings(dsUid) : undefined;
    return inst ? { uid: inst.uid, type: inst.type } : undefined;
  }, [dsUid]);
  const [timeRange, setTimeRange] = useState<TimeRange>(() =>
    rangeUtil.convertRawToRange(load('range', { from: 'now-24h', to: 'now' }))
  );
  const [timeZone, setTimeZone] = useState<TimeZone>('browser');
  const [bucket, setBucket] = useState<string>(() => load('bucket', ''));
  const [split, setSplit] = useState<Split>(() => load('split', 'field'));
  const [style, setStyle] = useState<DrawStyle>(() => load('style', 'line'));
  const [window, setWindow] = useState('auto');
  const [fn, setFn] = useState('mean');

  // --- schema state ---------------------------------------------------------
  const [buckets, setBuckets] = useState<string[]>([]);
  // Measurements are stored with the bucket/period they belong to; anything else counts as loading.
  const [mResult, setMResult] = useState<{ key: string; list: string[] } | null>(null);
  const [mFilter, setMFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<Record<string, MeasurementSchema | undefined>>({});
  const [sel, setSel] = useState<Record<string, MeasurementSelection>>({});
  const tagValueCache = useRef(new Map<string, Promise<string[]>>());
  const [error, setError] = useState('');

  // --- results --------------------------------------------------------------
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'chart' | 'table' | 'query'>('chart');
  const [modal, setModal] = useState<'download' | 'dashboard' | null>(null);
  const [colorSlots] = useState(() => new Map<string, number>());

  useEffect(() => save('split', split), [split]);
  useEffect(() => save('style', style), [style]);

  const absRange = useCallback(() => absOf(timeRange), [timeRange]);
  const rangeKey = `${timeRange.raw.from.toString()}|${timeRange.raw.to.toString()}`;
  const mKey = `${dsUid}|${bucket}|${rangeKey}`;
  const measurements = mResult?.key === mKey ? mResult.list : null;

  // Buckets per data source.
  useEffect(() => {
    if (!ds) {
      return;
    }
    let stale = false;
    listBuckets(ds, absRange())
      .then((b) => {
        if (!stale) {
          setBuckets(b);
          setError('');
        }
      })
      .catch((e) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds]);

  // Measurements, fields and tags all depend on bucket and period.
  useEffect(() => {
    if (!ds || !bucket) {
      return;
    }
    let stale = false;
    const range = absRange();
    tagValueCache.current.clear();
    listMeasurements(ds, bucket, range)
      .then((m) => !stale && setMResult({ key: mKey, list: m }))
      .catch((e) => !stale && setError(e.message));
    Promise.all(
      selected.map((m) =>
        loadSchema(ds, bucket, m, range).catch((e): MeasurementSchema => ({ fields: [], tags: [], error: e.message }))
      )
    ).then((fresh) => {
      if (stale) {
        return;
      }
      setSchemas((old) => {
        const next: Record<string, MeasurementSchema> = {};
        selected.forEach((m, i) => (next[m] = keepMissing(fresh[i], old[m], sel[m])));
        return next;
      });
      // Measurements that had no fields before may have them in the new period.
      setSel((cur) => {
        const next = { ...cur };
        selected.forEach((m, i) => {
          const pick = defaultField(fresh[i]);
          if (next[m] && !next[m].fields.length && pick) {
            next[m] = { ...next[m], fields: [pick] };
          }
        });
        return next;
      });
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, bucket, rangeKey]);

  const toggleMeasurement = async (m: string, on: boolean) => {
    if (!on) {
      setSelected((cur) => cur.filter((x) => x !== m));
      return;
    }
    setSelected((cur) => (cur.includes(m) ? cur : [...cur, m]));
    const selection = sel[m] ?? { fields: [], tags: {} };
    setSel((cur) => ({ ...cur, [m]: selection }));
    if (!ds) {
      return;
    }
    const schema = await loadSchema(ds, bucket, m, absRange()).catch(
      (e): MeasurementSchema => ({ fields: [], tags: [], error: e.message })
    );
    setSchemas((cur) => ({ ...cur, [m]: schema }));
    const pick = defaultField(schema);
    if (!selection.fields.length && pick) {
      setSel((cur) => ({ ...cur, [m]: { ...cur[m], fields: [pick] } }));
    }
  };

  const loadTagValues = (m: string, tag: string) => {
    const key = `${m}\u0000${tag}`;
    if (!tagValueCache.current.has(key) && ds) {
      tagValueCache.current.set(key, listTagValues(ds, bucket, m, tag, absRange()).catch(() => []));
    }
    return tagValueCache.current.get(key) ?? Promise.resolve([]);
  };

  const querySelections = useMemo((): QuerySelection[] => {
    return selected
      .filter((m) => sel[m]?.fields.length && schemas[m] && !schemas[m]!.error)
      .map((m) => {
        const types = new Map(schemas[m]!.fields.map((f) => [f.name, f.type]));
        const tags = Object.fromEntries(Object.entries(sel[m].tags).filter(([, v]) => v.length));
        return { measurement: m, fields: sel[m].fields.map((name) => ({ name, type: types.get(name) ?? 'number' })), tags };
      });
  }, [selected, sel, schemas]);

  // --- data loading ---------------------------------------------------------
  const dataReq = useRef(0);
  const loadData = useCallback(async (next: { range?: TimeRange; window?: string; fn?: string } = {}) => {
    if (!ds || !querySelections.length) {
      return;
    }
    const tr = next.range ?? timeRange;
    const winSetting = next.window ?? window;
    const fnSetting = next.fn ?? fn;
    const req = ++dataReq.current;
    const range = absOf(tr);
    const win = winSetting === 'auto' ? autoWindow(range.from, range.to) : winSetting;
    setLoading(true);
    try {
      const query = dataQuery({ bucket, selections: querySelections, window: win, fn: fnSetting, timezone: TZ });
      const frames = await runFlux(ds, query, range);
      if (req !== dataReq.current) {
        return;
      }
      const r = rangeUtil.convertRawToRange(tr.raw);
      setData({ series: framesToSeries(frames), window: win, fn: fnSetting, query, range: r });
      setError('');
    } catch (e) {
      if (req === dataReq.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (req === dataReq.current) {
        setLoading(false);
      }
    }
  }, [ds, bucket, querySelections, window, fn, timeRange]);

  // Like a dashboard: once data is shown, period/resolution/function changes reload it.
  const changeRange = (r: TimeRange) => {
    setTimeRange(r);
    if (typeof r.raw.from === 'string' && typeof r.raw.to === 'string') {
      save('range', r.raw);
    }
    if (data) {
      loadData({ range: r });
    }
  };
  const changeWindow = (w: string) => {
    setWindow(w);
    if (data) {
      loadData({ window: w });
    }
  };
  const changeFn = (f: string) => {
    setFn(f);
    if (data) {
      loadData({ fn: f });
    }
  };
  const onZoom = (abs: AbsoluteTimeRange) => {
    const from = dateTime(abs.from);
    const to = dateTime(abs.to);
    changeRange({ from, to, raw: { from, to } });
  };
  const shift = (dir: -1 | 1) => {
    const r = absRange();
    const span = r.to - r.from;
    const from = dateTime(r.from + (dir * span) / 2);
    const to = dateTime(r.to + (dir * span) / 2);
    changeRange({ from, to, raw: { from, to } });
  };
  const zoomOut = () => {
    const r = absRange();
    const span = r.to - r.from;
    const from = dateTime(r.from - span / 2);
    const to = dateTime(Math.min(Date.now(), r.to + span / 2));
    changeRange({ from, to, raw: { from, to } });
  };

  // --- export ---------------------------------------------------------------
  const summary = `${bucket} · ${querySelections.length} measurement(s), ${querySelections.reduce((a, q) => a + q.fields.length, 0)} field(s)`;

  const download = async (o: DownloadSettings) => {
    if (!ds) {
      return;
    }
    const range = absRange();
    const query = dataQuery({ bucket, selections: querySelections, window: o.window, fn: o.fn, timezone: TZ });
    const series = framesToSeries(await runFlux(ds, query, range));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    saveFile(toCsv(series, o.layout, o.format, TZ), `${bucket.replace(/[^\w.-]+/g, '_')}-${stamp}.csv`, 'text/csv;charset=utf-8');
  };

  const dashboardFor = (title: string, naming: Naming) =>
    buildDashboard({
      title,
      ds: ds!,
      bucket,
      series: data!.series,
      tagFilters: Object.fromEntries(querySelections.map((q) => [q.measurement, q.tags])),
      split,
      style,
      fn,
      naming,
      time:
        typeof timeRange.raw.from === 'string'
          ? { from: timeRange.raw.from, to: String(timeRange.raw.to) }
          : { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
    });

  // --- render ---------------------------------------------------------------
  const shownMeasurements = useMemo(() => {
    const names = [...new Set([...selected, ...(measurements ?? [])])].sort((a, b) => a.localeCompare(b));
    const q = mFilter.toLowerCase();
    return names.filter((m) => m.toLowerCase().includes(q));
  }, [measurements, selected, mFilter]);

  const statusText = data
    ? `${data.series.length} reeksen · ${data.series.reduce((a, x) => a + x.times.length, 0).toLocaleString('nl-BE')} punten · ${
        data.window === 'none' ? 'ruwe data' : `${data.fn} per ${data.window}`
      }`
    : '';

  return (
    <PluginPage
      actions={
        <TimeRangePicker
          value={timeRange}
          timeZone={timeZone}
          onChange={changeRange}
          onChangeTimeZone={setTimeZone}
          onMoveBackward={() => shift(-1)}
          onMoveForward={() => shift(1)}
          onZoom={zoomOut}
        />
      }
    >
      <div className={s.layout}>
        <aside className={s.sidebar}>
          <Field label="1. Databron" description="InfluxDB 2 met querytaal Flux">
            <DataSourcePicker
              current={dsUid}
              filter={isFluxInflux}
              noDefault
              onChange={(inst) => {
                setDsUid(inst.uid);
                save('ds', inst.uid);
                setBucket('');
                setSelected([]);
                setData(null);
              }}
            />
          </Field>

          {ds && (
            <Field label="2. Bucket">
              <Combobox
                options={buckets.map((b) => ({ value: b, label: b }))}
                value={bucket || null}
                placeholder="kies een bucket"
                onChange={(o) => {
                  setBucket(o.value);
                  save('bucket', o.value);
                  setSelected([]);
                  setSchemas({});
                  setSel({});
                  setData(null);
                }}
              />
            </Field>
          )}

          {ds && bucket && (
            <Field label="3. Measurements">
              <div>
                <FilterInput value={mFilter} onChange={setMFilter} placeholder="Zoeken…" />
                <div className={s.checklist}>
                  {measurements === null && <LoadingPlaceholder text="laden…" />}
                  {shownMeasurements.map((m) => (
                    <div key={m} className={s.checkRow}>
                      <Checkbox label={m} value={selected.includes(m)} onChange={(e) => toggleMeasurement(m, e.currentTarget.checked)} />
                    </div>
                  ))}
                  {measurements !== null && !shownMeasurements.length && (
                    <Text color="secondary">{mFilter ? 'Geen resultaten' : 'Geen measurements in deze periode'}</Text>
                  )}
                </div>
              </div>
            </Field>
          )}

          {selected.length > 0 && (
            <Field label="4. Values & tags" description="Kies per measurement de values; tags filteren optioneel op tagwaarden.">
              <div>
                {selected.map((m) => (
                  <SelectionCard
                    key={m}
                    measurement={m}
                    schema={schemas[m]}
                    selection={sel[m] ?? { fields: [], tags: {} }}
                    onChange={(x) => setSel((cur) => ({ ...cur, [m]: x }))}
                    onRemove={() => toggleMeasurement(m, false)}
                    loadTagValues={(tag) => loadTagValues(m, tag)}
                  />
                ))}
              </div>
            </Field>
          )}

          <div className={s.sticky}>
            <Button fullWidth icon="sync" onClick={() => loadData()} disabled={!querySelections.length || loading}>
              {loading ? 'Laden…' : 'Data tonen'}
            </Button>
          </div>
        </aside>

        <main className={s.main}>
          <div className={s.toolbar}>
            <TabsBar>
              <Tab label="Grafiek" active={tab === 'chart'} onChangeTab={() => setTab('chart')} />
              <Tab label="Tabel" active={tab === 'table'} onChangeTab={() => setTab('table')} />
              <Tab label="Flux" active={tab === 'query'} onChangeTab={() => setTab('query')} />
            </TabsBar>
            <Stack gap={1} wrap="wrap" alignItems="flex-end">
              <Field label="Grafieken" className={s.inline}>
                <RadioButtonGroup<Split>
                  size="sm"
                  options={[
                    { value: 'measurement', label: 'per measurement' },
                    { value: 'field', label: 'per value' },
                    { value: 'series', label: 'per reeks' },
                  ]}
                  value={split}
                  onChange={setSplit}
                />
              </Field>
              <Field label="Weergave" className={s.inline}>
                <RadioButtonGroup<DrawStyle>
                  size="sm"
                  options={[
                    { value: 'line', label: 'lijnen' },
                    { value: 'points', label: 'punten' },
                    { value: 'both', label: 'beide' },
                  ]}
                  value={style}
                  onChange={setStyle}
                />
              </Field>
              <Field label="Resolutie" className={s.inline}>
                <Combobox width={14} options={windowOptions} value={window} onChange={(o) => changeWindow(o.value)} />
              </Field>
              <Field label="Functie" className={s.inline}>
                <Combobox width={12} options={fnOptions} value={fn} onChange={(o) => changeFn(o.value)} />
              </Field>
              <Button variant="secondary" icon="download-alt" disabled={!querySelections.length} onClick={() => setModal('download')}>
                Download
              </Button>
              <Button icon="apps" disabled={!data?.series.length} onClick={() => setModal('dashboard')}>
                Dashboard maken
              </Button>
            </Stack>
          </div>

          {error && (
            <Alert title="Fout" severity="error" onRemove={() => setError('')}>
              {error}
            </Alert>
          )}
          {statusText && (
            <Text variant="bodySmall" color="secondary">
              {statusText}
            </Text>
          )}

          <div className={s.results}>
            {!ds && (
              <EmptyState variant="call-to-action" message="Kies een InfluxDB-databron (Flux)">
                Deze app gebruikt de InfluxDB-databronnen die al in Grafana staan.
              </EmptyState>
            )}
            {ds && !data && (
              <EmptyState variant="call-to-action" message="Nog geen data">
                Kies een bucket, measurements en values en klik op <b>Data tonen</b>.
              </EmptyState>
            )}
            {data && !data.series.length && <EmptyState variant="not-found" message="Geen data voor deze selectie en periode" />}
            {data && data.series.length > 0 && tab === 'chart' && (
              <ChartView
                series={data.series}
                split={split}
                style={style}
                timeRange={data.range}
                colorSlots={colorSlots}
                subtitle={data.window === 'none' ? 'ruwe data' : `${data.fn} per ${data.window}`}
                onZoom={onZoom}
              />
            )}
            {data && data.series.length > 0 && tab === 'table' && <TableView series={data.series} timeRange={data.range} />}
            {data && tab === 'query' && <pre className={s.query}>{data.query}</pre>}
          </div>
        </main>
      </div>

      {modal === 'download' && (
        <DownloadModal summary={summary} timezone={TZ} onDownload={download} onDismiss={() => setModal(null)} />
      )}
      {modal === 'dashboard' && data && ds && (
        <DashboardModal
          summary={`${summary}, ${data.series.length} reeksen`}
          defaultTitle={`${bucket} – ${querySelections.map((q) => q.measurement).join(', ')}`}
          onDismiss={() => setModal(null)}
          onCreate={(title, naming, folderUid) => createDashboard(dashboardFor(title, naming), folderUid)}
          onExport={(title, naming) =>
            saveFile(
              JSON.stringify(toImportFile(dashboardFor(title, naming), ds.uid!), null, 2),
              `grafana-${title.replace(/[^\w.-]+/g, '_') || 'dashboard'}.json`,
              'application/json'
            )
          }
        />
      )}
    </PluginPage>
  );
}

/** Sensible default: a single field, or the conventional "value" field, is pre-selected. */
function defaultField(schema: MeasurementSchema): string | undefined {
  const f = schema.fields.filter((x) => !x.missing);
  return (f.length === 1 ? f[0] : f.find((x) => x.name === 'value'))?.name;
}

/** Absolute range; re-evaluates relative ranges ("now-24h") at call time. */
function absOf(timeRange: TimeRange): AbsRange {
  const r = rangeUtil.convertRawToRange(timeRange.raw);
  return { from: r.from.valueOf(), to: r.to.valueOf() };
}

/** Keeps selected fields/tags without data in the new period visible, so they can be unchecked. */
function keepMissing(fresh: MeasurementSchema, old: MeasurementSchema | undefined, selection?: MeasurementSelection): MeasurementSchema {
  if (!selection || fresh.error) {
    return fresh;
  }
  const fields = [...fresh.fields];
  for (const f of old?.fields ?? []) {
    if (selection.fields.includes(f.name) && !fields.some((x) => x.name === f.name)) {
      fields.push({ ...f, missing: true });
    }
  }
  const tags = [...fresh.tags];
  for (const [tag, values] of Object.entries(selection.tags)) {
    if (values.length && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return { fields, tags };
}

const getStyles = (theme: GrafanaTheme2) => ({
  layout: css({
    display: 'grid',
    gridTemplateColumns: '340px minmax(0, 1fr)',
    gap: theme.spacing(2),
    alignItems: 'start',
    [theme.breakpoints.down('md')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  }),
  sidebar: css({
    position: 'sticky',
    top: theme.spacing(1),
    maxHeight: 'calc(100vh - 140px)',
    overflowY: 'auto',
    paddingRight: theme.spacing(1),
    [theme.breakpoints.down('md')]: { position: 'static', maxHeight: 'none' },
  }),
  checklist: css({
    marginTop: theme.spacing(0.5),
    maxHeight: 240,
    overflowY: 'auto',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.5, 1),
  }),
  checkRow: css({ padding: theme.spacing(0.25, 0) }),
  sticky: css({
    position: 'sticky',
    bottom: 0,
    paddingTop: theme.spacing(1),
    background: theme.colors.background.canvas,
  }),
  main: css({ minWidth: 0 }),
  toolbar: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  }),
  inline: css({ marginBottom: 0 }),
  results: css({ marginTop: theme.spacing(1) }),
  query: css({
    whiteSpace: 'pre-wrap',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
