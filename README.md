# Nexa Horse Transportation

Simple static website for Nexa Horse Transportation (Sundre, Alberta; serving Canada and the US).

- `index.html`: home, services, instant quote calculator + booking request form, contact
- `terms.html`: terms and conditions
- `styles.css`: shared styles (mobile-friendly)

Quote rates live at the top of the script in `index.html` (`RATES`, `MINIMUM_CHARGE`, `GST_RATE`); the "See our rates" table in the booking section shows the same numbers, so update both together. Driving distance comes from free OpenStreetMap services (Nominatim and the OSRM demo server); customers can type the distance in if the lookup fails.

No build step. Open `index.html` in a browser, or host the folder on any static host (e.g. GitHub Pages).

## Before going live

- Have the terms in `terms.html` reviewed so they match how you actually operate (deposits, cancellation window, liability).
