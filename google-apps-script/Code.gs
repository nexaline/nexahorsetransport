/**
 * Nexa Horse Transport – booking request web app (Google Apps Script).
 *
 * The booking form on nexahorsetransport.ca POSTs its data here as JSON. This script emails the request
 * to TO_EMAIL with a map picture of the route (pickup A, drop-off B and the driving route).
 *
 * SETUP (once, signed in to Google as nexahorsetransport@gmail.com):
 *  1. Go to https://script.google.com, click "New project", and replace the code with this file.
 *  2. Static map key: in Google Cloud Console create a NEW API key, restrict it to "Maps Static API" only
 *     (API restrictions), and enable the Maps Static API. Do not reuse the website's key.
 *     In the Apps Script editor open Project Settings (gear icon) > Script Properties > Add script property:
 *       Property: STATIC_MAPS_KEY   Value: (the new key)
 *     The key lives only here. Never put it in GitHub or in the website code.
 *  3. Optional: run testBookingEmail() from the editor to receive a sample email (approve the permissions).
 *  4. Deploy > New deployment > type "Web app": Execute as "Me", Who has access "Anyone" > Deploy.
 *     Copy the Web app URL (it ends in /exec) into BOOKING_ENDPOINT near the top of the script in index.html.
 *  5. After changing this code later, use Deploy > Manage deployments > Edit > Version "New version",
 *     so the same URL keeps working.
 *
 * Gmail accounts can send about 100 emails a day from Apps Script, far more than this form needs.
 */

var TO_EMAIL = "nexahorsetransport@gmail.com";
var FROM_NAME = "Nexa Horse Transport website";
var MIN_FILL_MS = 3000;          // forms completed faster than this are treated as spam
var ROUTE_COLOR = "0x6A2C91";    // brand purple
var MAX_PATH_POINTS = 250;       // keeps the Static Maps URL well under its length limit

// The website sends the booking as a JSON string with Content-Type text/plain (a "simple" request, so the
// browser doesn't need a CORS preflight, which Apps Script can't answer). The reply is always JSON.
function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    // Spam: the hidden "website" field is filled in, or the form was completed too quickly.
    // Reply "ok" so bots learn nothing, but send no email.
    if (clean(data.website, 200) || !(Number(data.elapsedMs) >= MIN_FILL_MS)) {
      return json({ ok: true });
    }
    if (!clean(data.name, 120)) {
      return json({ ok: false, error: "A name is required." });
    }
    if (!clean(data.phone, 40) && !clean(data.email, 200)) {
      return json({ ok: false, error: "A phone number or an email address is required." });
    }
    sendBookingEmail(data);
    return json({ ok: true });
  } catch (err) {
    console.error("Booking request failed: " + (err && err.stack || err));
    return json({ ok: false, error: "The request could not be sent." });
  }
}

// Visiting the web app URL in a browser shows that it is running.
function doGet() {
  return json({ ok: true, service: "Nexa Horse Transport booking requests" });
}

function sendBookingEmail(data) {
  var pickup = data.pickup || {};
  var dropoff = data.dropoff || {};
  var name = clean(data.name, 120);
  var subject = "New booking request – " + name + " – " + clean(pickup.label, 80) + " to " + clean(dropoff.label, 80);

  var map = routeMapImage(data);
  var mapsLink = googleMapsLink(data);
  var html = bookingHtml(data, map, mapsLink);
  var text = bookingText(data, map, mapsLink);

  var message = { to: TO_EMAIL, subject: subject, htmlBody: html, body: text, name: FROM_NAME };
  var email = clean(data.email, 200);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) message.replyTo = email;
  if (map.blob) message.inlineImages = { routeMap: map.blob };
  MailApp.sendEmail(message);
}

// ---------- route map picture ----------

function routeMapImage(data) {
  var key = PropertiesService.getScriptProperties().getProperty("STATIC_MAPS_KEY");
  var a = point(data.pickup);
  var b = point(data.dropoff);
  if (!a && !b) return { note: "No map: neither location has GPS coordinates." };
  if (!key) return { note: "No map: STATIC_MAPS_KEY is not set in the script's properties." };

  var params = ["size=640x400", "scale=2", "maptype=roadmap"];
  if (a) params.push("markers=" + encodeURIComponent("color:" + ROUTE_COLOR + "|label:A|" + a));
  if (b) params.push("markers=" + encodeURIComponent("color:0xE8141C|label:B|" + b));
  var polyline = simplifyPolyline(clean((data.route || {}).polyline, 60000));
  if (polyline) {
    params.push("path=" + encodeURIComponent("color:" + ROUTE_COLOR + "ff|weight:5|enc:" + polyline));
  } else if (a && b) {
    // No route from the website (e.g. the distance was typed in): a straight line between the pins.
    params.push("path=" + encodeURIComponent("color:" + ROUTE_COLOR + "aa|weight:3|" + a + "|" + b));
  }
  params.push("key=" + encodeURIComponent(key));
  var url = "https://maps.googleapis.com/maps/api/staticmap?" + params.join("&");

  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var type = String(response.getHeaders()["Content-Type"] || response.getHeaders()["content-type"] || "");
    if (response.getResponseCode() === 200 && type.indexOf("image/") === 0) {
      return { blob: response.getBlob().setName("route-map.png"), note: polyline ? "" : "Straight line shown; no driving route was sent." };
    }
    console.error("Static map failed: HTTP " + response.getResponseCode() + " " + response.getContentText().slice(0, 300));
    return { note: "The map picture could not be created (HTTP " + response.getResponseCode() + ")." };
  } catch (err) {
    console.error("Static map failed: " + err);
    return { note: "The map picture could not be created." };
  }
}

// "lat,lng" for a location with valid coordinates, otherwise null.
function point(place) {
  if (!place) return null;
  var lat = Number(place.lat), lng = Number(place.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return lat.toFixed(6) + "," + lng.toFixed(6);
}

function googleMapsLink(data) {
  var origin = point(data.pickup) || clean((data.pickup || {}).label, 200);
  var destination = point(data.dropoff) || clean((data.dropoff || {}).label, 200);
  if (!origin || !destination) return "";
  var url = "https://www.google.com/maps/dir/?api=1&travelmode=driving" +
    "&origin=" + encodeURIComponent(origin) + "&destination=" + encodeURIComponent(destination);
  var vias = ((data.route || {}).vias || []).map(function (v) { return clean(v, 100); }).filter(String).slice(0, 8);
  if (vias.length) url += "&waypoints=" + encodeURIComponent(vias.join("|"));
  return url;
}

// Encoded polylines (Google's format), thinned out so very long routes still fit in a Static Maps URL.
function simplifyPolyline(encoded) {
  if (!encoded) return "";
  var points = decodePolyline(encoded);
  if (points.length < 2) return "";
  if (points.length <= MAX_PATH_POINTS) return encoded;
  var step = (points.length - 1) / (MAX_PATH_POINTS - 1);
  var kept = [];
  for (var i = 0; i < MAX_PATH_POINTS; i++) kept.push(points[Math.round(i * step)]);
  return encodePolyline(kept);
}

function decodePolyline(encoded) {
  var points = [], index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (var n = 0; n < 2; n++) {
      var result = 0, shift = 0, b;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index < encoded.length);
      var delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (n === 0) lat += delta; else lng += delta;
    }
    points.push([lat, lng]);
  }
  return points;
}

function encodePolyline(points) {
  var out = "", prevLat = 0, prevLng = 0;
  points.forEach(function (p) {
    out += encodeValue(p[0] - prevLat) + encodeValue(p[1] - prevLng);
    prevLat = p[0];
    prevLng = p[1];
  });
  return out;
}

function encodeValue(v) {
  v = v < 0 ? ~(v << 1) : v << 1;
  var s = "";
  while (v >= 0x20) {
    s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return s + String.fromCharCode(v + 63);
}

// ---------- email content ----------

function bookingRows(data) {
  var pickup = data.pickup || {}, dropoff = data.dropoff || {};
  var dates = data.dates || {};
  var stalls = (data.stalls || []).map(function (s) { return clean(s.type, 40) + ": " + (Number(s.count) || 0); }).join(", ");
  return [
    ["Customer", [
      ["Name", clean(data.name, 120)],
      ["Phone", clean(data.phone, 40) || "(not given)"],
      ["Email", clean(data.email, 200) || "(not given)"]
    ]],
    ["Trip", [
      ["Pickup", clean(pickup.label, 300)],
      ["Pickup GPS", gpsText(pickup)],
      ["Pickup entered as", clean(pickup.entered, 200)],
      ["Drop-off", clean(dropoff.label, 300)],
      ["Drop-off GPS", gpsText(dropoff)],
      ["Drop-off entered as", clean(dropoff.entered, 200)],
      ["Earliest pickup date", clean(dates.pickupEarliest, 20) || "(not given)"],
      ["Latest pickup date", clean(dates.pickupLatest, 20) || "(not given)"],
      ["Earliest drop-off date", clean(dates.dropoffEarliest, 20) || "(not given)"],
      ["Latest drop-off date", clean(dates.dropoffLatest, 20) || "(not given)"],
      ["Trip type", clean(data.trip, 80)],
      ["Driving distance", (Number(data.distanceKm) || 0) + " km (" + clean(data.distanceSource, 60) + ")"],
      ["Route note", clean(data.routeNote, 600)]
    ]],
    ["Horses", [
      ["Number of horses", String(Number(data.horses) || 0)],
      ["Per stall type", stalls]
    ]],
    ["Details", [
      ["Horse details & special requirements", clean(data.details, 3000) || "(none)"]
    ]],
    ["Consent", [
      ["Terms & Conditions", data.termsAccepted ? "Agreed" : "Not agreed"],
      ["SMS consent", data.smsConsent && clean(data.phone, 40) ? "Yes" : "No"]
    ]]
  ];
}

function quoteRows(quote) {
  quote = quote || {};
  var rows = (quote.lines || []).map(function (l) { return [clean(l.text, 200), clean(l.amount, 40)]; });
  if (quote.minimumApplied) rows.push(["Minimum charge applied", clean(quote.minimumApplied, 40)]);
  rows.push(["Subtotal", clean(quote.subtotal, 40)]);
  rows.push(["GST (5%)", clean(quote.gst, 40)]);
  rows.push(["Estimated total", clean(quote.total, 40)]);
  return rows;
}

function bookingHtml(data, map, mapsLink) {
  var cell = "padding:6px 10px;border-bottom:1px solid #DCCFE6;vertical-align:top;";
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#222222;max-width:680px;">' +
    '<h2 style="color:#6A2C91;margin:0 0 4px;">New booking request</h2>' +
    '<p style="margin:0 0 16px;color:#5E5568;">Sent from the booking form on nexahorsetransport.ca' +
    (data.submittedAt ? " on " + esc(clean(data.submittedAt, 80)) : "") + ".</p>";

  html += '<h3 style="color:#6A2C91;margin:16px 0 6px;">Route map</h3>';
  if (map.blob) {
    html += '<img src="cid:routeMap" alt="Map of the route from pickup (A) to drop-off (B)" width="640" style="max-width:100%;height:auto;border:2px solid #6A2C91;border-radius:6px;">';
  }
  if (map.note) html += '<p style="margin:6px 0;color:#5E5568;">' + esc(map.note) + "</p>";
  if (mapsLink) {
    html += '<p style="margin:8px 0 0;"><a href="' + esc(mapsLink) + '" style="color:#6A2C91;font-weight:bold;">Open route in Google Maps</a></p>';
  }

  bookingRows(data).forEach(function (section) {
    html += '<h3 style="color:#6A2C91;margin:20px 0 6px;">' + esc(section[0]) + "</h3><table style=\"border-collapse:collapse;width:100%;\">";
    section[1].forEach(function (row) {
      if (!row[1]) return;
      html += '<tr><td style="' + cell + 'font-weight:bold;width:38%;">' + esc(row[0]) + '</td><td style="' + cell + '">' +
        esc(row[1]).replace(/\n/g, "<br>") + "</td></tr>";
    });
    html += "</table>";
  });

  html += '<h3 style="color:#6A2C91;margin:20px 0 6px;">Instant quote (estimate shown to the customer)</h3><table style="border-collapse:collapse;width:100%;">';
  quoteRows(data.quote).forEach(function (row, i, all) {
    var last = i === all.length - 1;
    html += '<tr><td style="' + cell + (last ? "font-weight:bold;" : "") + '">' + esc(row[0]) + '</td><td style="' + cell +
      'text-align:right;white-space:nowrap;' + (last ? "font-weight:bold;" : "") + '">' + esc(row[1]) + "</td></tr>";
  });
  html += "</table>";
  if (data.quote && data.quote.notice) {
    html += '<p style="margin:10px 0;padding:10px 12px;background:#FFF9CC;border-left:4px solid #E8141C;">' + esc(clean(data.quote.notice, 600)) + "</p>";
  }
  return html + "</div>";
}

function bookingText(data, map, mapsLink) {
  var lines = ["NEW BOOKING REQUEST (nexahorsetransport.ca)", ""];
  bookingRows(data).forEach(function (section) {
    lines.push(section[0].toUpperCase());
    section[1].forEach(function (row) { if (row[1]) lines.push(row[0] + ": " + row[1]); });
    lines.push("");
  });
  lines.push("INSTANT QUOTE (estimate shown to the customer)");
  quoteRows(data.quote).forEach(function (row) { lines.push(row[0] + ": " + row[1]); });
  if (data.quote && data.quote.notice) lines.push(clean(data.quote.notice, 600));
  lines.push("");
  if (mapsLink) lines.push("Open route in Google Maps: " + mapsLink);
  if (map.note) lines.push(map.note);
  return lines.join("\n");
}

function gpsText(place) {
  var p = point(place);
  if (!p) return "not available";
  return p.replace(",", ", ") + (place.approximate ? " (approximate, from the route)" : "");
}

// ---------- helpers ----------

function clean(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 500);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run from the Apps Script editor to send yourself a sample booking email.
function testBookingEmail() {
  sendBookingEmail({
    name: "Test Customer", phone: "403-555-0100", email: "", trip: "Within Canada",
    dates: { pickupEarliest: "2027-06-01", pickupLatest: "2027-06-03", dropoffEarliest: "2027-06-02", dropoffLatest: "" },
    details: "Test request from testBookingEmail().",
    pickup: { label: "Sundre, AB, Canada", lat: 51.7976, lng: -114.6403, entered: "address \"Sundre\"" },
    dropoff: { label: "Calgary, AB, Canada", lat: 51.0447, lng: -114.0719, entered: "postal / ZIP code T2P 1J9" },
    distanceKm: 110, distanceSource: "calculated automatically", routeNote: "",
    route: { polyline: "", vias: [] },
    stalls: [{ type: "Standard stall", count: 1 }, { type: "Roomier stall", count: 0 }, { type: "Box stall", count: 0 }],
    horses: 1,
    quote: { lines: [{ text: "1 x Standard stall @ $2.00/km x 110 km", amount: "$220.00" }], minimumApplied: "$300.00",
      subtotal: "$300.00", gst: "$15.00", total: "$315.00 CAD", notice: "This is an automatic estimate only." },
    smsConsent: false, termsAccepted: true, submittedAt: new Date().toString()
  });
}
