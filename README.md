# Nexa Horse Transport

Simple static website for Nexa Horse Transport (Sundre, Alberta; serving Canada and the US).

- `index.html`: home, services, instant quote calculator + booking request form, videos (embedded YouTube uploads playlist, newest first, no API key), contact
- `events.html`: Events Calendar of upcoming horse shows, competitions, races and auctions (reads `events.json`)
- `terms.html`: terms and conditions
- `google-apps-script/Code.gs`: Google Apps Script web app that receives booking requests and emails them (with a route map picture) to nexahorsetransport@gmail.com
- `privacy.html`: privacy policy (PIPEDA / Alberta PIPA, text messaging section at `#sms`)
- `styles.css`: shared styles (mobile-friendly)

Quote rates live at the top of the script in `index.html` (`RATES`, `MINIMUM_CHARGE`, `GST_RATE`); the "See our rates" table in the booking section shows the same numbers, so update both together. Customers enter each location in one box (an address or postal / ZIP code with Google Places API (New) autocomplete, or GPS coordinates like `51.0447, -114.0719`), or pick it on the map; every location is turned into an address plus GPS coordinates (Places API (New), or the Geocoding API through the Maps JavaScript API), both of which go in the booking email. Driving distance comes from Google Routes API, and a single map under the location fields shows pin A (pickup), pin B (delivery) and the route; both pins can be dragged. The key is in `GOOGLE_MAPS_API_KEY` near the bottom of `index.html`; customers can type the distance in if the lookup fails.

Trips with both ends in Canada are kept in Canada using pass-through waypoints (`CANADIAN_ROUTE_VIA`), skipping any that aren't between the pickup and delivery locations:

- Western Canada (BC, AB, SK, MB) to Ontario or Quebec: Thunder Bay, Sault Ste. Marie and Sudbury (Sudbury is kept for southwestern Ontario too, so the route doesn't cut through Michigan from the Sault)
- Ontario or Quebec to NB, NS or PEI: Rivière-du-Loup and Edmundston
- Western Canada to NB, NS or PEI: all five, west to east

The route is then checked against the `US_AREAS` boxes. If it still leaves Canada, the customer sees a note asking them to confirm the distance with us, including which part of the route is in the US and between which waypoints (also logged to the browser console). The note is included in the booking email.

## Versions & rollback

| Version | What it is | Saved as |
|---|---|---|
| **v1.0** | The previous design (the site as it was before the 1.1 redesign) | tag `v1.0` and branch `release/v1.0` (commit `cc89498`) |
| **v1.1** | The new design (built on branch `v1.1`, then merged into `main`) | tag `v1.1` |

The `release/v1.0` branch is never changed, so version 1.0 can always be restored exactly.

**To roll back**, say *"Switch the website back to version 1.0"*. The rollback restores the files on `main` to exactly what they were in `v1.0` with a **new commit** (history is never deleted or rewritten), then pushes `main`. GitHub Pages then serves version 1.0 again. Moving forward again later works the same way, from the `v1.1` tag.

Version tags are created with the **Tag a website version** workflow (Actions tab > Run workflow, give the tag name and the commit). It never moves or replaces an existing tag.

## Booking requests (Google Apps Script)

The booking form POSTs each request to a Google Apps Script web app (`google-apps-script/Code.gs`), which emails it to nexahorsetransport@gmail.com with a map picture of the route (pickup A, delivery B, driving route) from the Google Maps Static API. Setup, once, signed in as nexahorsetransport@gmail.com:

1. At https://script.google.com create a new project and paste in `google-apps-script/Code.gs`.
2. In Google Cloud Console create a **separate** API key restricted to the **Maps Static API** (and enable that API). In the Apps Script editor: Project Settings > Script Properties > add `STATIC_MAPS_KEY` with that key. This key is never stored in GitHub or the website.
3. Optional: run `testBookingEmail()` in the editor to receive a sample email.
4. Deploy > New deployment > Web app, Execute as **Me**, Who has access **Anyone**. Copy the Web app URL (ending in `/exec`) into `BOOKING_ENDPOINT` at the top of the script in `index.html`.
5. After later code changes: Deploy > Manage deployments > Edit > New version (keeps the same URL).

If the form shows "Sorry, something went wrong", open the browser console (it logs the real reply), or run the **Check booking endpoint** workflow from the Actions tab: it sends the web app a spam-flagged test request (no email is sent) and prints exactly how it answers.

Spam protection: a hidden honeypot field, and submissions completed in under 3 seconds are ignored (checked in the page and again in the script).

## Events calendar

`events.json` is refreshed every Monday by `.github/workflows/update-events.yml`, which runs `scripts/update-events.mjs` and commits the result to `main` (it can also be run by hand from the repository's Actions tab). The script checks each source's robots.txt, then reads only structured data the site publishes itself: iCal feeds, schema.org event data, or a WordPress events-calendar API. It keeps just the basic facts (name, type, dates, place, links). A source that fails keeps its last known events and the error is logged in the run summary; events that have ended are removed. To add or change a source, edit `SOURCES` at the top of the script.

No build step. Open `index.html` in a browser, or host the folder on any static host (e.g. GitHub Pages).

## Before going live

- Paste your Google Maps Platform API key into `GOOGLE_MAPS_API_KEY` in `index.html`.
- In Google Cloud Console, restrict the API key: under *Application restrictions* choose *Websites* and add your site's address, and under *API restrictions* allow only Places API (New), Routes API, Maps JavaScript API and Geocoding API (the last two must also be enabled for the project). The key is visible in the page source, so this stops others from using it.
- Have the terms in `terms.html` reviewed so they match how you actually operate (deposits, cancellation window, liability).
