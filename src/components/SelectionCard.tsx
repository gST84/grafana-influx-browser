import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Badge, Checkbox, ComboboxOption, Field, IconButton, MultiCombobox, Stack, Text, TextLink, useStyles2 } from '@grafana/ui';
import { MeasurementSchema, MeasurementSelection } from '../lib/types';

interface Props {
  measurement: string;
  schema?: MeasurementSchema;
  selection: MeasurementSelection;
  onChange: (selection: MeasurementSelection) => void;
  onRemove: () => void;
  /** Loads the values of a tag (cached by the caller). */
  loadTagValues: (tag: string) => Promise<string[]>;
}

export function SelectionCard({ measurement, schema, selection, onChange, onRemove, loadTagValues }: Props) {
  const s = useStyles2(getStyles);
  const present = schema?.fields.filter((f) => !f.missing) ?? [];

  const toggleField = (name: string, on: boolean) => {
    const fields = on ? [...selection.fields, name] : selection.fields.filter((f) => f !== name);
    onChange({ ...selection, fields });
  };

  return (
    <div className={s.card}>
      <Stack justifyContent="space-between" alignItems="center">
        <Text weight="medium" truncate>
          {measurement}
        </Text>
        <IconButton name="times" size="sm" tooltip="Verwijderen" onClick={onRemove} />
      </Stack>

      {!schema && <Text color="secondary">laden…</Text>}
      {schema?.error && <Text color="error">{schema.error}</Text>}

      {schema && !schema.error && (
        <>
          <div className={s.heading}>
            <Text variant="bodySmall" color="secondary">
              VALUES (FIELDS) · {present.length}
            </Text>
            {schema.fields.length > 3 && (
              <Stack gap={1}>
                <TextLink href="#" inline={false} variant="bodySmall" onClick={(e) => {
                  e.preventDefault();
                  onChange({ ...selection, fields: schema.fields.map((f) => f.name) });
                }}>
                  alles
                </TextLink>
                <TextLink href="#" inline={false} variant="bodySmall" onClick={(e) => {
                  e.preventDefault();
                  onChange({ ...selection, fields: [] });
                }}>
                  niets
                </TextLink>
              </Stack>
            )}
          </div>
          <div className={s.list}>
            {schema.fields.map((f) => (
              <div key={f.name} className={s.row}>
                <Checkbox
                  label={f.name}
                  value={selection.fields.includes(f.name)}
                  onChange={(e) => toggleField(f.name, e.currentTarget.checked)}
                />
                {f.type !== 'number' && <Badge color="blue" text={f.type === 'boolean' ? 'bool' : 'tekst'} />}
                {f.missing && <Badge color="orange" text="geen data in periode" />}
              </div>
            ))}
            {!present.length && <Text color="secondary">Geen fields in deze periode</Text>}
          </div>

          {schema.tags.length > 0 && (
            <>
              <div className={s.heading}>
                <Text variant="bodySmall" color="secondary">
                  TAGS · FILTER
                </Text>
              </div>
              {schema.tags.map((tag) => (
                <Field key={tag} label={tag} className={s.tagField}>
                  <MultiCombobox<string>
                    placeholder="alle waarden"
                    value={selection.tags[tag] ?? []}
                    options={async (input: string) => {
                      const values = await loadTagValues(tag);
                      // Chosen values stay listed even without data in the current period.
                      const all = [...new Set([...(selection.tags[tag] ?? []), ...values])];
                      const q = input.toLowerCase();
                      return all
                        .filter((v) => v.toLowerCase().includes(q))
                        .slice(0, 500)
                        .map((v): ComboboxOption<string> => ({ value: v, label: v }));
                    }}
                    onChange={(opts) => onChange({ ...selection, tags: { ...selection.tags, [tag]: opts.map((o) => o.value) } })}
                    isClearable
                  />
                </Field>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
    marginBottom: theme.spacing(1),
    background: theme.colors.background.primary,
  }),
  heading: css({
    display: 'flex',
    justifyContent: 'space-between',
    margin: theme.spacing(1, 0, 0.5),
  }),
  list: css({
    maxHeight: 220,
    overflowY: 'auto',
  }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.25, 0),
  }),
  tagField: css({
    marginBottom: theme.spacing(1),
  }),
});
