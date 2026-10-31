# FP Field Calculators

Two stand-alone calculators for pool service techs, styled to match the FP test Training site. No sign-in, no build step, no back end: plain HTML, CSS and JavaScript that runs entirely in the browser.

| Page | What it does |
|---|---|
| `index.html` — **Variable Speed Pump Calculator** | The ANSI/APSP-15 worksheet (V13, no flow lookup) as a form: required flow, TDH, speeds to program, pipe velocity limits, operating cost and filter sizing. |
| `lsi.html` — **LSI & Dosing Calculator** | Langelier Saturation Index from the water test, target readings with a projected index, and chemical amounts for the pool's volume. Links back to the pump calculator. |

## Hosting on GitHub Pages

1. Create a new repository (for example `fp-calculators`) and upload every file and folder here, keeping the structure:
   ```
   index.html  lsi.html  css/styles.css  js/common.js  js/pump.js  js/lsi.js  icon.svg  manifest.webmanifest  .nojekyll  README.md
   ```
2. In the repository go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and the `/ (root)` folder, and save.
3. After a minute the site is live at `https://<your-account>.github.io/<repository>/`. The LSI page is at `.../lsi.html`.

Nothing has to be configured. To change the site name or the links in the thin bar above the header, edit the header block near the top of `index.html` and `lsi.html`.

## How the pump calculator works

Every formula is a direct port of the worksheet, in `js/pump.js` (`PumpCalc.calc`). With the worksheet's sample inputs (15,000 gal, 3" suction / 2½" pressure, 75 GPM at 2400 RPM, 5 in Hg, 10 psi, 249 V, $0.17/kWh, 0.85 A and 10.2 A) the page reproduces the spreadsheet cell for cell: 40 / 42 GPM, TDH 28.75 ft, 1,280 / 1,333 / 2,240 / 1,760 RPM, maximum 2,880 RPM (AOP limit), $0.036 and $0.43 per hour, 51 / 9.1 / 68 sq ft.

Three cells in the spreadsheet reference the wrong cell and were normalized so every filter row uses the same rule:

- Sand and DE "Max RPM to use this filter" in the ANSI-15 block divided by the pressure-pipe limit (`B28`) instead of the measured flow (`B16`); `DEV60` even divided by a pipe size (`B39`). The page uses `2400 ÷ measured GPM × filter rated GPM`, capped at 3450, for every filter, which is what the other two filter blocks already did.
- `CL340` in the "based on max GPM" block compared against the pipe limit (`B28`) instead of the pump maximum (`B30`).

The three filter tables of the worksheet are merged into one table per filter type, with the ANSI-15 fit and the pump-maximum checks shown as badges.

Two small additions that are not in the worksheet: a pool volume estimator (length × width × average depth × 7.5, 5.9 or 7.0) and optional hours per day to turn the per-hour cost into daily, monthly and yearly figures.

## How the LSI calculator works

`js/lsi.js` (`LsiCalc`) computes

```
LSI = pH + TF + CF + AF − TDSF
```

with the temperature, calcium and alkalinity factors read from the APSP / Taylor saturation index table (values between chart points are interpolated) and the TDS factor 12.1 below 1,000 ppm, 12.2 at or above. Total alkalinity is corrected for cyanuric acid before the alkalinity factor is looked up (`carbonate alkalinity = TA − CYA × factor at pH`; the factor reproduces the APSP correction table, 0.22 at pH 7.0 to 0.36 at pH 8.0). Water between −0.3 and +0.3 is reported as balanced.

### Dosing

Amounts are not read from a fixed chart. They come from the carbonate chemistry of the water, so the pH dose changes with alkalinity and stabilizer the way it does in a real pool:

- Acid (muriatic 31.45 %, 20 %, 14.5 % or dry acid) removes alkalinity one for one. Sodium bicarbonate adds alkalinity and carbonate one for one. Soda ash adds two parts alkalinity per part carbonate. Aeration removes carbonate (CO₂) without touching alkalinity.
- Solving for the target pH and target alkalinity together gives the mix of products that lands on both. When the only way to get there is aeration, the plan says so; the "aeration is not practical" option switches to hitting the pH target alone and reports where alkalinity will end up.
- Calcium chloride (77 % dihydrate or 94 % anhydrous), cyanuric acid, and drain-and-refill percentages for lowering calcium or stabilizer use straight stoichiometry.
- Large doses are split into stages (1 qt of muriatic acid, 1 lb of soda ash, 2½ lb of bicarbonate, 10 lb of calcium chloride per 10,000 gal per application).

On 10,000 gallons the figures line up with the usual charts: 1.5 lb bicarbonate raises TA 10 ppm, 25.6 fl oz of 31.45 % muriatic acid lowers TA 10 ppm, 1.2 lb of 77 % calcium chloride raises CH 10 ppm, 13.4 oz of cyanuric acid raises CYA 10 ppm, and about 12 fl oz of muriatic acid takes pH from 7.8 to 7.5 at 100 ppm alkalinity.

The readings "after the plan" are recalculated from the doses actually listed, so they stay honest when a tiny balancing dose is dropped or aeration is declined.

## Other notes

- Inputs are remembered in the browser (localStorage) so a tech can come back to a job; "Reset to example values" clears them.
- "Copy summary" / "Copy dosing plan" puts a plain-text write-up on the clipboard for a work order or text message. "Print / save as PDF" uses the browser's print dialog with a print layout.
- Fonts load from Google Fonts; if that is blocked the page falls back to the system sans-serif.
