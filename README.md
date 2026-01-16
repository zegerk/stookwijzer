# Stookwijzer (mini app)

A tiny static web app that shows the **wood burning advice** (“stookadvies”) for a Dutch postcode area, based on the RIVM Stookwijzer dataset.

This is a front-end only app (HTML/CSS/JS). No backend.

## Data source

- NGR metadata record: <https://www.nationaalgeoregister.nl/geonetwork/srv/dut/catalog.search#/metadata/8a3479b0-7065-4637-8ace-95c38ba215d5>
- WFS endpoint: `https://data.rivm.nl/geo/alo/ows`
- Feature type: `alo:stookwijzer_v2`

The dataset provides advice per PC4 area using 4 blocks of 6 hours:

- `advies_0`, `advies_6`, `advies_12`, `advies_18`
- `definitief_0`, `definitief_6`, `definitief_12`, `definitief_18` (whether the slot is fixed)
- `model_runtime` as the reference timestamp

## Run locally

From this folder:

### Option A (Python)

```bash
python -m http.server 5173
```

### Option B (Node)

```bash
npx serve .
```

Then open:

- <http://localhost:5173>

## How to use

- Enter a postcode (4 digits). The app fetches automatically after you type a valid PC4.
- Click **My location** to use geolocation instead of a postcode.
- Click the big circle to refresh.
- Use the theme toggle in the top-right.

The UI shows:

- Current advice (as a colored status circle + headline)
- A simple overview of the 4 time slots (time range, advice color, and whether it is fixed or can still change)

## Notes

- This app displays the dataset’s “stookadvies” (yellow/orange/red). Local rules or bans may differ.

## License

MIT — see [LICENSE](LICENSE).
