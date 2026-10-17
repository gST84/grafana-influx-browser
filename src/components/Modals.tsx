import React, { useState } from 'react';
import { Alert, Button, Combobox, Field, Input, Modal, RadioButtonGroup, Stack, TextLink } from '@grafana/ui';
import { FolderPicker, locationService } from '@grafana/runtime';
import { AGG_FNS, DURATION_RE } from '../lib/flux';
import { CsvFormat, CsvLayout } from '../lib/csv';
import { Naming } from '../lib/types';

const fnOptions = AGG_FNS.map((f) => ({ value: f, label: f }));
const WINDOWS = ['none', '10s', '30s', '1m', '5m', '10m', '15m', '30m', '1h', '1d', '7d', '1mo', 'custom'];
const windowOptions = WINDOWS.map((w) => ({
  value: w,
  label: w === 'none' ? 'geen (ruwe data)' : w === 'custom' ? 'andere…' : w,
}));

export interface DownloadSettings {
  window: string;
  fn: string;
  layout: CsvLayout;
  format: CsvFormat;
}

interface DownloadProps {
  summary: string;
  timezone: string;
  onDownload: (settings: DownloadSettings) => Promise<void>;
  onDismiss: () => void;
}

export function DownloadModal({ summary, timezone, onDownload, onDismiss }: DownloadProps) {
  const [window, setWindow] = useState('5m');
  const [custom, setCustom] = useState('');
  const [fn, setFn] = useState('mean');
  const [layout, setLayout] = useState<CsvLayout>('wide');
  const [format, setFormat] = useState<CsvFormat>('csv-eu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const customInvalid = window === 'custom' && !DURATION_RE.test(custom.trim());

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await onDownload({ window: window === 'custom' ? custom.trim() : window, fn, layout, format });
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Data downloaden" isOpen onDismiss={onDismiss}>
      <Field label="Selectie" description={summary}>
        <></>
      </Field>
      <Field label="aggregateWindow" description="De tijdstempel is het begin van elk venster.">
        <Combobox options={windowOptions} value={window} onChange={(o) => setWindow(o.value)} />
      </Field>
      {window === 'custom' && (
        <Field label="Eigen duur" invalid={customInvalid} error="Gebruik een Flux-duur, bv. 30s, 5m, 1h, 1d">
          <Input value={custom} placeholder="bv. 2m" onChange={(e) => setCustom(e.currentTarget.value)} />
        </Field>
      )}
      <Field label="Functie">
        <Combobox options={fnOptions} value={fn} onChange={(o) => setFn(o.value)} />
      </Field>
      <Field label="Indeling">
        <RadioButtonGroup<CsvLayout>
          options={[
            { value: 'wide', label: 'Breed: 1 kolom per reeks' },
            { value: 'long', label: 'Lang: 1 rij per meetwaarde' },
          ]}
          value={layout}
          onChange={setLayout}
        />
      </Field>
      <Field label="Formaat" description={`Tijden in tijdzone ${timezone}.`}>
        <RadioButtonGroup<CsvFormat>
          options={[
            { value: 'csv-eu', label: 'Excel BE/NL (; en decimale komma)' },
            { value: 'csv', label: 'CSV standaard' },
          ]}
          value={format}
          onChange={setFormat}
        />
      </Field>
      {error && <Alert title="Download mislukt">{error}</Alert>}
      <Modal.ButtonRow>
        <Button variant="secondary" fill="outline" onClick={onDismiss}>
          Annuleren
        </Button>
        <Button icon="download-alt" onClick={go} disabled={busy || customInvalid}>
          {busy ? 'Bezig…' : 'Downloaden'}
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}

interface DashboardProps {
  summary: string;
  defaultTitle: string;
  onCreate: (title: string, naming: Naming, folderUid?: string) => Promise<string>;
  onExport: (title: string, naming: Naming) => void;
  onDismiss: () => void;
}

export function DashboardModal({ summary, defaultTitle, onCreate, onExport, onDismiss }: DashboardProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [naming, setNaming] = useState<Naming>('both');
  const [folderUid, setFolderUid] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      setUrl(await onCreate(title.trim(), naming, folderUid));
    } catch (e) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err.data?.message || err.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Dashboard maken" isOpen onDismiss={onDismiss}>
      <Field label="Inhoud" description={`${summary}. Panelen, units en weergave volgen wat je nu ziet.`}>
        <></>
      </Field>
      <Field label="Titel" required invalid={!title.trim()}>
        <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
      </Field>
      <Field label="Map">
        <FolderPicker value={folderUid} onChange={(uid) => setFolderUid(uid)} />
      </Field>
      <Field label="Naam van de reeksen" description="Uit de tags gehaald, dus ook nieuwe sensoren krijgen een goede naam.">
        <RadioButtonGroup<Naming>
          options={[
            { value: 'both', label: 'naam + id' },
            { value: 'name', label: 'alleen naam' },
            { value: 'id', label: 'alleen id' },
          ]}
          value={naming}
          onChange={setNaming}
        />
      </Field>
      {error && <Alert title="Dashboard maken mislukt">{error}</Alert>}
      {url && (
        <Alert severity="success" title="Dashboard aangemaakt">
          <Stack gap={2}>
            <TextLink href={url} inline={false}>
              Openen
            </TextLink>
          </Stack>
        </Alert>
      )}
      <Modal.ButtonRow>
        <Button variant="secondary" fill="outline" onClick={onDismiss}>
          Sluiten
        </Button>
        <Button variant="secondary" icon="download-alt" onClick={() => onExport(title.trim(), naming)} disabled={!title.trim()}>
          JSON downloaden
        </Button>
        {url ? (
          <Button icon="apps" onClick={() => locationService.push(url)}>
            Naar dashboard
          </Button>
        ) : (
          <Button icon="plus" onClick={create} disabled={busy || !title.trim()}>
            {busy ? 'Bezig…' : 'Dashboard aanmaken'}
          </Button>
        )}
      </Modal.ButtonRow>
    </Modal>
  );
}
