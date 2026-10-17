import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import {
  AbsoluteTimeRange,
  DataFrame,
  FieldType,
  GrafanaTheme2,
  LoadingState,
  PanelData,
  TimeRange,
  createDataFrame,
} from '@grafana/data';
import { PanelRenderer } from '@grafana/runtime';
import { Text, useStyles2, useTheme2 } from '@grafana/ui';
import { chartUnitText, grafanaUnit, stateTimelineFieldConfig, stateTimelineOptions, timeseriesFieldConfig, timeseriesOptions } from '../lib/panels';
import { chartGroups, labelAmong, seriesKey, shortLabel, unitOf, varyingTags, withUnit } from '../lib/series';
import { DrawStyle, Series, Split } from '../lib/types';
import { useWidth } from './useWidth';

const TEXT_ROWS = 500;

function panelData(series: DataFrame[], timeRange: TimeRange): PanelData {
  return { state: LoadingState.Done, series, timeRange };
}

/** One frame per series, coloured by a slot that sticks to the entity across reloads. */
function seriesFrame(s: Series, label: string, color?: string): DataFrame {
  return createDataFrame({
    name: label,
    fields: [
      { name: 'Time', type: FieldType.time, values: s.times },
      {
        name: label,
        type: s.kind === 'number' ? FieldType.number : s.kind === 'boolean' ? FieldType.boolean : FieldType.string,
        values: s.values,
        config: { displayNameFromDS: label, ...(color ? { color: { mode: 'fixed', fixedColor: color } } : {}) },
      },
    ],
  });
}

/** Wide table: time plus one column per series, newest first. */
function wideFrame(series: Series[], labels: string[], limit?: number): { frame: DataFrame; rows: number } {
  const rows = new Map<number, Array<Series['values'][number]>>();
  series.forEach((s, i) =>
    s.times.forEach((t, j) => {
      if (!rows.has(t)) {
        rows.set(t, new Array(series.length).fill(null));
      }
      rows.get(t)![i] = s.values[j];
    })
  );
  const times = [...rows.keys()].sort((a, b) => b - a);
  const shown = limit ? times.slice(0, limit) : times;
  const frame = createDataFrame({
    fields: [
      { name: 'Tijd', type: FieldType.time, values: shown },
      ...series.map((s, i) => ({
        name: labels[i],
        type: s.kind === 'number' ? FieldType.number : s.kind === 'boolean' ? FieldType.boolean : FieldType.string,
        values: shown.map((t) => rows.get(t)![i]),
        config: { unit: grafanaUnit(unitOf(s)) },
      })),
    ],
  });
  return { frame, rows: times.length };
}

interface ChartProps {
  series: Series[];
  split: Split;
  style: DrawStyle;
  timeRange: TimeRange;
  colorSlots: Map<string, number>;
  subtitle: string;
  onZoom: (range: AbsoluteTimeRange) => void;
}

export function ChartView({ series, split, style, timeRange, colorSlots, subtitle, onZoom }: ChartProps) {
  const s = useStyles2(getStyles);
  const palette = useTheme2().visualization.palette;
  const [ref, width] = useWidth<HTMLDivElement>();

  const cards = useMemo(() => {
    const colorOf = (x: Series) => {
      const k = seriesKey(x);
      if (!colorSlots.has(k)) {
        colorSlots.set(k, colorSlots.size);
      }
      return palette[colorSlots.get(k)! % palette.length];
    };
    const out: Array<{ key: string; title: string; kind: 'timeseries' | 'state-timeline' | 'table'; series: Series[]; unit: string }> = [];
    for (const g of chartGroups(series, split)) {
      const numbers = g.series.filter((x) => x.kind === 'number');
      const bools = g.series.filter((x) => x.kind === 'boolean');
      const texts = g.series.filter((x) => x.kind === 'string');
      const unit = chartUnitText(g.unit, [...new Set(g.series.map((x) => x.measurement))]);
      if (numbers.length) {
        out.push({ key: g.key + 'n', title: g.title, kind: 'timeseries', series: numbers, unit });
      }
      if (bools.length) {
        out.push({ key: g.key + 'b', title: g.title, kind: 'state-timeline', series: bools, unit: '' });
      }
      // Text values cannot be plotted: shown as a table in place of a chart.
      if (texts.length) {
        out.push({ key: g.key + 't', title: g.title, kind: 'table', series: texts, unit: '' });
      }
    }
    return out.map((c) => {
      const tags = varyingTags(c.series);
      const withField = new Set(c.series.map((x) => x.field)).size > 1;
      const labels = c.series.map((x) => shortLabel(x, tags, withField));
      if (c.kind === 'table') {
        const { frame, rows } = wideFrame(c.series, labels, TEXT_ROWS);
        return { ...c, frames: [frame], rows };
      }
      return { ...c, frames: c.series.map((x, i) => seriesFrame(x, labels[i], colorOf(x))), rows: 0 };
    });
  }, [series, split, colorSlots, palette]);

  return (
    <div ref={ref}>
      {width > 0 &&
        cards.map((c) => {
          const height = c.kind === 'timeseries' ? 320 : c.kind === 'table' ? 280 : Math.min(400, 90 + 36 * c.series.length);
          const title = c.title;
          const meta =
            c.kind === 'table'
              ? `tekst · ${c.rows} rijen${c.rows > TEXT_ROWS ? ` (nieuwste ${TEXT_ROWS}, alles in tab Tabel)` : ''}`
              : c.kind === 'timeseries'
                ? `${c.series.length} reeks${c.series.length === 1 ? '' : 'en'} · ${subtitle}`
                : `${c.series.length} reeks${c.series.length === 1 ? '' : 'en'} · ${c.series[0].kind === 'boolean' ? 'aan/uit' : 'status'}`;
          return (
            <div key={c.key} className={s.panel}>
              <div className={s.header}>
                <Text weight="medium">{c.title}</Text>
                <Text variant="bodySmall" color="secondary">
                  {meta}
                </Text>
              </div>
              {c.kind === 'timeseries' && (
                <PanelRenderer
                  title={title}
                  pluginId="timeseries"
                  width={width - 2}
                  height={height}
                  data={panelData(c.frames, timeRange)}
                  options={timeseriesOptions(c.series.length)}
                  fieldConfig={timeseriesFieldConfig(grafanaUnit(c.unit), style) as never}
                  onChangeTimeRange={onZoom}
                />
              )}
              {c.kind === 'state-timeline' && (
                <PanelRenderer
                  title={title}
                  pluginId="state-timeline"
                  width={width - 2}
                  height={height}
                  data={panelData(c.frames, timeRange)}
                  options={stateTimelineOptions}
                  fieldConfig={stateTimelineFieldConfig(c.series) as never}
                  onChangeTimeRange={onZoom}
                />
              )}
              {c.kind === 'table' && (
                <PanelRenderer
                  title={title}
                  pluginId="table"
                  width={width - 2}
                  height={height}
                  data={panelData(c.frames, timeRange)}
                  options={{ showHeader: true, cellHeight: 'sm' }}
                />
              )}
            </div>
          );
        })}
      {cards.length > 0 && (
        <Text variant="bodySmall" color="secondary">
          Sleep in een grafiek om in te zoomen; de data wordt dan opnieuw opgehaald voor die periode.
        </Text>
      )}
    </div>
  );
}

export function TableView({ series, timeRange }: { series: Series[]; timeRange: TimeRange }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { frame, rows } = useMemo(
    () =>
      wideFrame(
        series,
        series.map((x) => withUnit(`${x.measurement} · ${labelAmong(x, series)}`, unitOf(x)))
      ),
    [series]
  );
  return (
    <div ref={ref}>
      {width > 0 && (
        <PanelRenderer
          title={`${rows} rijen · nieuwste eerst`}
          pluginId="table"
          width={width}
          height={640}
          data={panelData([frame], timeRange)}
          options={{ showHeader: true, cellHeight: 'sm' }}
        />
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  header: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5, 0),
  }),
  panel: css({
    marginBottom: theme.spacing(2),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    overflow: 'hidden',
  }),
});
