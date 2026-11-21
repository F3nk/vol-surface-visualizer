# Vol Surface Visualizer

Live implied-volatility surfaces for **BTC, ETH and SOL** options, built for
[Ethos Research](https://ethosresearch.xyz/research/vol-surface-visualizer/).

A volatility surface is a 3D plot of option implied volatility against delta (or strike) and time to
expiration. It shows in one shape how much movement the options market is pricing for each horizon.
Implied volatility is calculated with the Black-Scholes formula from the mid-market option price on
[Deribit](https://www.deribit.com/), and the surface refreshes every five minutes.

**Live:** https://ethosresearch.xyz/research/vol-surface-visualizer/

## What it shows

- **3D surface or heatmap** of implied volatility by delta, strike or strike/forward and days to expiry.
  You can show out-of-the-money options (puts below the forward, calls above), calls only or puts only.
- **The smile for one expiry:** our mid-price IV with the bid–ask IV range, plus Deribit's own mark IV
  as a check.
- **Term structure:** ATM IV and the 25-delta risk reversal for each expiry, and 30-day constant-maturity
  ATM IV, risk reversal and butterfly.
- Tables of every quote, CSV downloads, Markdown/PDF reports, shareable links, and an "Explain with AI"
  prompt.

## How it works

| Step | Detail |
|---|---|
| Data | One public request per coin to Deribit API v2 `public/get_book_summary_by_currency` (`currency=BTC`, `ETH`, and `USDC` for SOL). It returns every live option with best bid, best ask, mark IV and the underlying forward of its expiry. **No API key is needed**; this is public market data. |
| Price | mid = (best bid + best ask) / 2. BTC and ETH options are quoted in coin and converted to USD at the expiry's forward. SOL options are USDC-settled. |
| Implied volatility | Black-Scholes on the forward with a zero rate (Black 1976, the convention Deribit uses), solved by bisection to 1e-6. The bid and ask are converted the same way. |
| Delta | Black-Scholes forward delta at the mid IV. |
| Filters | Options without both a bid and an ask, wider than the spread limit (default 30% of mid), or outside the delta range are left out. The surface is interpolated linearly along each expiry and never extrapolated. |
| Refresh | WordPress cron every 5 minutes, plus an on-request refresh when the stored book is older than 5 minutes. A lock means visitors can never make the server call Deribit more often than that. |

Check against Deribit (21 Nov 2026, liquid out-of-the-money options with spread ≤ 10%): the median gap
between our mid IV and Deribit's mark IV is 0.07 vol points for BTC, 0.09 for ETH and 0.07 for SOL.

## Layout

```
plugins/ethos-volsurface/   WordPress plugin (shortcode [ethos_volsurface], REST /wp-json/ethos-vol/v1/surface?coin=BTC)
  data.php                  Deribit fetch, Black-Scholes, normalisation, 5-minute schedule, cache purge
  ethos-volsurface.php      REST route, page markup, translatable strings
  core.js                   pure functions: surface grid, smile, term structure, 30-day interpolation, AI prompt
  explorer.js / .css        the interactive page (Plotly gl3d 2.35.2, vendored)
  report.js                 Markdown/PDF report export shared by the Ethos tools
tools/
  vol_harness.php           runs the plugin without WordPress: self-tests, saved-book checks, the real REST callback
  test-vol-core.cjs         unit tests for core.js
  vol-browser-qa.cjs        29 Playwright checks (desktop, phone, downloads, links)
```

## Running the checks

```sh
php tools/vol_harness.php selftest
curl -s "https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option" -o btc.json
php tools/vol_harness.php book btc.json BTC          # compares our IV with Deribit's mark IV
php tools/vol_harness.php json btc.json BTC > btc-payload.json
node tools/test-vol-core.cjs btc-payload.json
```

Install it as a normal WordPress plugin (PHP 8.1+), activate it, and put `[ethos_volsurface]` on a page.
The styles use the Ethos theme's colour and font tokens (`--wp--preset--color--*`).

## History and credit

The idea and the first version come from
[dwasse/vol-surface-visualizer](https://github.com/dwasse/vol-surface-visualizer) by Daniel Wasserman
(0xhedge, 2019). That project was a Python server with PostgreSQL on Deribit's API v1, which Deribit has
since switched off. This repository is a rewrite with independent code: no code from the 2019 version is
used. The original is still in this repository's git history.

## Licence

GPL-2.0-or-later (see `LICENSE`). Plotly.js is MIT-licensed (`plugins/ethos-volsurface/vendor/LICENSE-Plotly.txt`).
Market data © Deribit. Nothing here is investment advice.
