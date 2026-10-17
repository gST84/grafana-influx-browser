# Influx Browser

Browse InfluxDB 2 data from inside Grafana — pick a bucket, measurements, values and tags — and see it as
charts or a table, download it as CSV, or turn the view into a dashboard with one click.

It uses the InfluxDB data sources you already have in Grafana (query language **Flux**); there is no extra
server and no token to configure.

## Features

- **Step by step**: data source → bucket → measurements (several at once) → values (fields) and tag filters.
  Fields, tags and tag values follow the selected time range.
- **Charts per measurement, per value or per series**, rendered with Grafana's own time series, state timeline
  and table panels. Series with different units never share a chart.
- **Units from tags** (`unit`, `units`, `unit_of_measurement`, `uom`, `eenheid`) or — Home Assistant style —
  from the measurement name (`W`, `°C`), mapped to Grafana units (`watt`, `celsius`, `kwatth`, …).
- **Text values** are shown as a table, booleans as a state timeline.
- **Resolution**: automatic `aggregateWindow` (~1000 points per series), a fixed window or raw data, with a
  choice of aggregate function. Drag in a chart to zoom in.
- **CSV download** with its own `aggregateWindow`, wide or long layout, and an Excel BE/NL variant
  (`;` and decimal comma).
- **Create dashboard**: one click turns the current view into a dashboard (or a portable JSON import file).
  Series names are built in the Flux query from name/id tags (`friendly_name`, `entity_id`, …), so sensors
  added later get proper names too.

## Requirements

- Grafana 13.2 or later
- An InfluxDB 2 data source configured with query language **Flux**
