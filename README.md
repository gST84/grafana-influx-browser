# Influx Browser — Grafana app plugin

Grafana-versie van [influx_browser](https://github.com/gST84/influx_browser): een app-pagina in Grafana om
InfluxDB 2-data te verkennen (bucket → measurements → values & tags), te tonen als grafiek of tabel, te
downloaden als CSV, en met één klik om te zetten naar een dashboard.

De plugin gebruikt de InfluxDB-databronnen (Flux) die al in Grafana staan. Gebruikersdocumentatie:
[src/README.md](src/README.md) (die wordt ook in Grafana getoond).

## Ontwikkelen

Node.js is niet nodig op je machine: alles kan in Docker.

```bash
# dependencies + build
docker run --rm -v "$PWD":/work -w /work node:22 npm install
docker run --rm -v "$PWD":/work -w /work node:22 npm run build

# Grafana 13 met de plugin op http://localhost:3000
docker compose up -d
```

Na een nieuwe build volstaat de pagina herladen; na een wijziging in `src/plugin.json` moet Grafana
herstarten (`docker compose restart`).

Overige controles: `npm run typecheck`, `npm run lint`, `npm run test:ci` (zelfde `docker run …`-vorm).

### Testdata

`provisioning/datasources/influxdb.yaml` koppelt de dev-Grafana aan een lokale InfluxDB-testcontainer:

```bash
docker run -d --name influx-browser-test -p 18086:8086 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=testtest123 -e DOCKER_INFLUXDB_INIT_ORG=test \
  -e DOCKER_INFLUXDB_INIT_BUCKET=homeassistant -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=devtoken123 \
  influxdb:2.7
```

## Installeren in je eigen Grafana

De plugin is niet gesigneerd. Bouw hem (`npm run build`), kopieer `dist/` naar
`<grafana>/plugins/gst84-influxbrowser-app` en sta hem toe in `grafana.ini`:

```ini
[plugins]
allow_loading_unsigned_plugins = gst84-influxbrowser-app
```

Herstart Grafana; de app staat dan onder **More apps → Influx Browser**.

## Structuur

| Pad | Inhoud |
|---|---|
| `src/lib/flux.ts` | Flux-querybouw (filters, aggregateWindow, schema-queries) |
| `src/lib/influx.ts` | Queries via `/api/ds/query` op de gekozen databron |
| `src/lib/series.ts` | Frames → reeksen, labels, units, opsplitsing in grafieken |
| `src/lib/panels.ts` | Grafana-units en paneelconfiguratie (gedeeld door app en dashboards) |
| `src/lib/dashboard.ts` | Dashboard bouwen, aanmaken (`/api/dashboards/db`) of als importbestand |
| `src/lib/csv.ts` | CSV-export |
| `src/pages/Browser.tsx` | De app-pagina |
| `src/components/` | Selectiekaart, resultaatweergaven, download- en dashboarddialogen |
