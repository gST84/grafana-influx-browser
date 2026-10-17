import { DrawStyle, Series } from './types';

// Grafana unit ids; anything else becomes a "suffix:<unit>" custom unit.
export const GRAFANA_UNITS: Record<string, string> = {
  W: 'watt', kW: 'kwatt', MW: 'megwatt', Wh: 'watth', kWh: 'kwatth', MWh: 'mwatth',
  VA: 'voltamp', kVA: 'kvoltamp', var: 'voltampreact', kvar: 'kvoltampreact',
  V: 'volt', mV: 'mvolt', kV: 'kvolt', A: 'amp', mA: 'mamp', Hz: 'hertz',
  '°C': 'celsius', '°F': 'fahrenheit', K: 'kelvin', '%': 'percent',
  hPa: 'pressurehpa', mbar: 'pressurembar', bar: 'pressurebar', Pa: 'pressurepa', psi: 'pressurepsi',
  lx: 'lux', ppm: 'ppm', ppb: 'ppb', 'µg/m³': 'conµgm3', dB: 'dB', dBm: 'dBm',
  'm³': 'm3', L: 'litre', l: 'litre', mm: 'lengthmm', m: 'lengthm', km: 'lengthkm',
  'km/h': 'velocitykmh', 'm/s': 'velocityms', ms: 'ms', s: 's', min: 'm', h: 'h', d: 'd',
  B: 'bytes', kB: 'kbytes', MB: 'mbytes', GB: 'gbytes', '€': 'currencyEUR', EUR: 'currencyEUR',
};

/**
 * Unit text for a chart: the unit tag, or — Home Assistant style — a measurement
 * that is itself a known unit (W, °C, …).
 */
export function chartUnitText(unitTag: string, measurements: string[]): string {
  if (unitTag) {
    return unitTag;
  }
  return measurements.length === 1 && GRAFANA_UNITS[measurements[0]] ? measurements[0] : '';
}

export function grafanaUnit(unitText: string): string | undefined {
  return unitText ? GRAFANA_UNITS[unitText] ?? `suffix: ${unitText}` : undefined;
}

export function timeseriesFieldConfig(unit: string | undefined, style: DrawStyle) {
  return {
    defaults: {
      unit,
      color: { mode: 'palette-classic' },
      custom: {
        drawStyle: style === 'points' ? 'points' : 'line',
        showPoints: style === 'line' ? 'never' : 'always',
        pointSize: 4,
        lineWidth: 2,
        fillOpacity: 0,
        lineInterpolation: 'linear',
        spanNulls: false,
      },
    },
    overrides: [],
  };
}

export function timeseriesOptions(seriesCount: number) {
  return {
    legend: {
      showLegend: true,
      displayMode: seriesCount > 1 ? 'table' : 'list',
      placement: 'bottom',
      calcs: ['lastNotNull', 'min', 'max', 'mean'],
    },
    tooltip: { mode: 'multi', sort: 'none' },
  };
}

// Grafana colours strings in a state timeline only via value mappings: one colour per value seen.
const STATE_COLORS = [
  'green', 'blue', 'orange', 'purple', 'yellow', 'red', 'super-light-blue', 'dark-green',
  'dark-orange', 'light-purple', 'dark-yellow', 'dark-red', 'semi-dark-blue', 'light-green', 'light-orange',
];

export function stateMappings(series: Series[]) {
  const values = new Set<string>();
  for (const s of series) {
    for (const v of s.values) {
      if (v != null) {
        values.add(String(v));
      }
    }
  }
  const options: Record<string, { color: string; index: number }> = {};
  if ([...values].every((v) => v === 'true' || v === 'false')) {
    options.true = { color: 'green', index: 0 };
    options.false = { color: '#808080', index: 1 };
  } else {
    [...values]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, STATE_COLORS.length)
      .forEach((v, i) => {
        options[v] = { color: STATE_COLORS[i], index: i };
      });
  }
  return [{ type: 'value', options }];
}

export function stateTimelineFieldConfig(series: Series[]) {
  return {
    defaults: {
      color: { mode: 'fixed', fixedColor: 'text' },
      mappings: stateMappings(series),
      custom: { lineWidth: 0, fillOpacity: 70 },
    },
    overrides: [],
  };
}

export const stateTimelineOptions = {
  showValue: 'auto',
  mergeValues: true,
  rowHeight: 0.9,
  alignValue: 'left',
  legend: { showLegend: false, displayMode: 'list', placement: 'bottom', calcs: [] },
  tooltip: { mode: 'single', sort: 'none' },
};
