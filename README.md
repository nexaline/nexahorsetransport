# Nexa Horse Transportation

Simple static website for Nexa Horse Transportation (Sundre, Alberta; serving Canada and the US).

- `index.html`: home, services, instant quote calculator + booking request form, contact
- `terms.html`: terms and conditions
- `styles.css`: shared styles (mobile-friendly)

Quote rates live at the top of the script in `index.html` (`RATES`, `MINIMUM_CHARGE`, `GST_RATE`); the "See our rates" table in the booking section shows the same numbers, so update both together. Addresses are suggested by Google Places API (New) and driving distance comes from Google Routes API, using the key in `GOOGLE_MAPS_API_KEY` near the bottom of `index.html` (left blank in the repository; until it is set, customers type the distance in); customers can type the distance in if the lookup fails.

No build step. Open `index.html` in a browser, or host the folder on any static host (e.g. GitHub Pages).

## Before going live

- Paste your Google Maps Platform API key into `GOOGLE_MAPS_API_KEY` in `index.html`.
- In Google Cloud Console, restrict the API key: under *Application restrictions* choose *Websites* and add your site's address, and under *API restrictions* allow only Places API (New) and Routes API. The key is visible in the page source, so this stops others from using it.
- Have the terms in `terms.html` reviewed so they match how you actually operate (deposits, cancellation window, liability).
