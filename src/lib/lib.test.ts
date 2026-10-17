import { createDataFrame, FieldType } from '@grafana/data';
import { autoWindow, dataQuery, durationMs, fluxStr, selectionFilter } from './flux';
import { chartGroups, framesToSeries, varyingTags } from './series';
import { buildDashboard, seriesNameExpr, toImportFile } from './dashboard';
import { formatValue, toCsv } from './csv';
import { chartUnitText, grafanaUnit, stateMappings } from './panels';
import { QuerySelection, Series } from './types';

const series = (measurement: string, field: string, tags: Record<string, string>, kind: Series['kind'] = 'number'): Series => ({
  measurement,
  field,
  tags,
  kind,
  times: [1000, 2000],
  values: kind === 'number' ? [1.5, 2] : kind === 'boolean' ? [true, false] : ['a', 'b'],
});

describe('flux', () => {
  it('escapes strings, including interpolation', () => {
    expect(fluxStr('a"b\\c${x}')).toBe('"a\\"b\\\\c\\${x}"');
  });

  it('builds a filter per measurement with tag filters', () => {
    const sel: QuerySelection[] = [
      { measurement: 'W', fields: [{ name: 'value', type: 'number' }], tags: { entity_id: ['pv', 'house'] } },
    ];
    expect(selectionFilter(sel)).toBe(
      '(r._measurement == "W" and r._field == "value" and (r["entity_id"] == "pv" or r["entity_id"] == "house"))'
    );
  });

  it('aggregates text fields with last() next to a numeric aggregate', () => {
    const q = dataQuery({
      bucket: 'b',
      window: '5m',
      fn: 'mean',
      selections: [
        { measurement: 'm', fields: [{ name: 'n', type: 'number' }, { name: 's', type: 'string' }], tags: {} },
      ],
    });
    expect(q).toContain('fn: mean');
    expect(q).toContain('fn: last');
    expect(q).toContain('union(tables: [num, other])');
  });

  it('rejects invalid durations', () => {
    expect(() => dataQuery({ bucket: 'b', window: '5 minutes', fn: 'mean', selections: [] })).toThrow();
  });

  it('picks a nice auto window and parses durations', () => {
    expect(autoWindow(0, 86400e3)).toBe('2m');
    expect(durationMs('1h30m')).toBe(5400e3);
    expect(durationMs('1mo')).toBeNull();
  });
});

describe('series', () => {
  it('converts Flux data source frames', () => {
    const frame = createDataFrame({
      name: 'victron',
      fields: [
        { name: 'Time', type: FieldType.time, values: [1, 2] },
        { name: 'power', type: FieldType.number, values: [10, 20], labels: { device: 'mppt', unit: 'W' } },
      ],
    });
    const [s] = framesToSeries([frame]);
    expect(s).toMatchObject({ measurement: 'victron', field: 'power', tags: { device: 'mppt', unit: 'W' }, kind: 'number' });
  });

  it('never mixes units in one chart', () => {
    const groups = chartGroups(
      [series('victron', 'power', { unit: 'W' }), series('victron', 'voltage', { unit: 'V' })],
      'measurement'
    );
    expect(groups.map((g) => g.title)).toEqual(['victron (W)', 'victron (V)']);
  });

  it('ignores the unit tag when labelling', () => {
    expect(varyingTags([series('m', 'f', { unit: 'W', id: 'a' }), series('m', 'f', { unit: 'V', id: 'b' })])).toEqual(['id']);
  });
});

describe('panels', () => {
  it('maps units, falling back to a suffix or the HA measurement name', () => {
    expect(grafanaUnit('kWh')).toBe('kwatth');
    expect(grafanaUnit('stuks')).toBe('suffix: stuks');
    expect(chartUnitText('', ['°C'])).toBe('°C');
    expect(chartUnitText('', ['energy'])).toBe('');
  });

  it('colours booleans green/grey and strings per value', () => {
    expect(stateMappings([series('m', 'f', {}, 'boolean')])[0].options).toHaveProperty('true.color', 'green');
    expect(Object.keys(stateMappings([series('m', 'f', {}, 'string')])[0].options)).toEqual(['a', 'b']);
  });
});

describe('dashboard', () => {
  const ha = [
    series('W', 'value', { entity_id: 'pv_power', friendly_name: 'PV vermogen' }),
    series('W', 'value', { entity_id: 'house_load', friendly_name: 'Huisverbruik' }),
    series('binary_sensor', 'value', { entity_id: 'door' }, 'boolean'),
  ];

  it('names series from name and id tags', () => {
    const expr = seriesNameExpr('W', ha.slice(0, 2), 'both', false);
    expect(expr).toContain('r["friendly_name"] + " (" + r["entity_id"] + ")"');
    expect(seriesNameExpr('W', ha.slice(0, 2), 'id', false)).toBe('if exists r["entity_id"] then r["entity_id"] else r._field');
  });

  it('builds timeseries and state-timeline panels with units', () => {
    const d = buildDashboard({
      title: 't',
      ds: { uid: 'influx', type: 'influxdb' },
      bucket: 'homeassistant',
      series: ha,
      tagFilters: {},
      split: 'field',
      style: 'line',
      fn: 'mean',
      naming: 'both',
      time: { from: 'now-7d', to: 'now' },
    });
    expect(d.panels.map((p) => p.type)).toEqual(['timeseries', 'state-timeline']);
    expect(JSON.stringify(d.panels[0])).toContain('"unit":"watt"');
    const file = toImportFile(d, 'influx');
    expect(JSON.stringify(file)).toContain('"uid":"${DS_INFLUXDB}"');
    expect(JSON.stringify(file)).not.toContain('"uid":"influx"');
  });
});

describe('csv', () => {
  it('formats numbers for Belgian/Dutch Excel', () => {
    expect(formatValue(24.025000000000002, true)).toBe('24,025');
    expect(formatValue(true, false)).toBe('1');
  });

  it('writes a wide table with one column per series', () => {
    const csv = toCsv([series('W', 'value', { unit: 'W' })], 'wide', 'csv-eu', 'UTC');
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('time (UTC);W · value (W)');
    expect(lines[1]).toBe('1970-01-01 00:00:01;1,5');
  });
});
