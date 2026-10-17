export type FieldKind = 'number' | 'string' | 'boolean';

export interface FieldInfo {
  name: string;
  type: FieldKind;
  /** Selected earlier but without data in the current period. */
  missing?: boolean;
}

export interface MeasurementSchema {
  fields: FieldInfo[];
  tags: string[];
  error?: string;
}

/** What the user picked for one measurement. */
export interface MeasurementSelection {
  fields: string[];
  tags: Record<string, string[]>;
}

/** A selection ready for query building: fields carry their type. */
export interface QuerySelection {
  measurement: string;
  fields: FieldInfo[];
  tags: Record<string, string[]>;
}

export type SeriesValue = number | string | boolean | null;

export interface Series {
  measurement: string;
  field: string;
  tags: Record<string, string>;
  kind: FieldKind;
  times: number[];
  values: SeriesValue[];
}

export type Split = 'measurement' | 'field' | 'series';
export type DrawStyle = 'line' | 'points' | 'both';
export type Naming = 'both' | 'name' | 'id';
