# Nexa Horse Transportation

Simple static website for Nexa Horse Transportation (Sundre, Alberta; serving Canada and the US).

- `index.html`: home, services, instant quote calculator + booking request form, contact
- `terms.html`: terms and conditions
- `styles.css`: shared styles (mobile-friendly)

Quote rates live at the top of the script in `index.html` (`RATES`, `MINIMUM_CHARGE`, `GST_RATE`); the "See our rates" table in the booking section shows the same numbers, so update both together. Customers enter each location as an address (Google Places API (New) autocomplete), a postal / ZIP code, GPS coordinates, or a pin on a map; every location is turned into an address plus GPS coordinates (Places API (New), or the Geocoding API through the Maps JavaScript API), both of which go in the booking email. Driving distance comes from Google Routes API, and a map under the location fields shows both pins and the route. The key is in `GOOGLE_MAPS_API_KEY` near the bottom of `index.html`; customers can type the distance in if the lookup fails.

Trips with both ends in Canada are kept in Canada using pass-through waypoints (`CANADIAN_ROUTE_VIA`), skipping any that aren't between the pickup and drop-off:

- Western Canada (BC, AB, SK, MB) to Ontario or Quebec: Thunder Bay, Sault Ste. Marie and Sudbury (Sudbury is kept for southwestern Ontario too, so the route doesn't cut through Michigan from the Sault)
- Ontario or Quebec to NB, NS or PEI: Rivière-du-Loup and Edmundston
- Western Canada to NB, NS or PEI: all five, west to east

The route is then checked against the `US_AREAS` boxes. If it still leaves Canada, the customer sees a note asking them to confirm the distance with us, including which part of the route is in the US and between which waypoints (also logged to the browser console). The note is included in the booking email.

No build step. Open `index.html` in a browser, or host the folder on any static host (e.g. GitHub Pages).

## Before going live

- Paste your Google Maps Platform API key into `GOOGLE_MAPS_API_KEY` in `index.html`.
- In Google Cloud Console, restrict the API key: under *Application restrictions* choose *Websites* and add your site's address, and under *API restrictions* allow only Places API (New), Routes API, Maps JavaScript API and Geocoding API (the last two must also be enabled for the project). The key is visible in the page source, so this stops others from using it.
- Have the terms in `terms.html` reviewed so they match how you actually operate (deposits, cancellation window, liability).
