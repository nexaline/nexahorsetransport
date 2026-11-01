/**
 * Nexa Horse Transport – Booking / Estimate request web app (Google Apps Script).
 *
 * The Booking / Estimate form on nexahorsetransport.ca POSTs its data here as JSON. For each request this script:
 *  - gives it a reference number (NX-2026-0001, NX-2026-0002, ... starting again each year),
 *  - saves it to the Google Sheet "Nexa Booking Requests" in this Google account's Drive (tab "Requests",
 *    one row per request, and tab "Horses", one row per horse, linked by the reference number). The sheet
 *    is created automatically the first time. Each request also gets a long random private token, kept
 *    only in the sheet (for a future pre-filled invoice/details form link); it is never sent to the website,
 *  - emails the request to TO_EMAIL with a map picture of the route (pickup A, delivery B and the driving
 *    route). The email is sent even if saving to the sheet fails (the error is logged).
 *  - keeps a copy of the request for one hour, so the customer can press "Email me a copy" on the summary
 *    screen. The page gets a one-time key for it; at most COPY_LIMIT copies are sent per request, and the copy
 *    only ever contains this request's details, built here (never text sent with the copy request).
 *
 * SETUP (once, signed in to Google as nexahorsetransport@gmail.com):
 *  1. Go to https://script.google.com, click "New project", and replace the code with this file.
 *  2. Static map key: in Google Cloud Console create a NEW API key, restrict it to "Maps Static API" only
 *     (API restrictions), and enable the Maps Static API. Do not reuse the website's key.
 *     In the Apps Script editor open Project Settings (gear icon) > Script Properties > Add script property:
 *       Property: STATIC_MAPS_KEY   Value: (the new key)
 *     The key lives only here. Never put it in GitHub or in the website code.
 *  3. Run setupSheet() from the editor and approve the permissions (send email as you, connect to an external
 *     service, see/edit/create Google Sheets). It creates the sheet and logs its link.
 *     Optional: run testBookingEmail() to receive a sample email.
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
var SHEET_NAME = "Nexa Booking Requests";
var COPY_LIMIT = 2;              // "Email me a copy": copies per request
var COPY_MINUTES = 60;           // ... available for this long after the request is sent
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var TIME_ZONE = "America/Edmonton";

var REQUEST_COLUMNS = ["Reference", "Received", "Status", "First name", "Last name", "Full name", "Phone", "Email",
  "Pickup", "Pickup GPS", "Pickup entered as", "Delivery", "Delivery GPS", "Delivery entered as",
  "Trip type (detected)", "Distance (km)", "Distance source", "Route note",
  "Earliest pickup", "Latest pickup", "Earliest delivery", "Latest delivery",
  "Number of horses", "Standard stalls", "Roomier stalls", "Box stalls", "Other details",
  "Estimate lines", "Minimum charge", "Subtotal", "GST (5%)", "Estimated total",
  "SMS consent", "Terms agreed", "Private token"];
var HORSE_COLUMNS = ["Reference", "Horse", "Stall", "Name", "Age (years)", "Breed", "Gender", "Colour",
  "Height (hands)", "Weight (kg)", "Foal or young horse"];

// The website sends the booking as a JSON string with Content-Type text/plain (a "simple" request, so the
// browser doesn't need a CORS preflight, which Apps Script can't answer). The reply is always JSON.
function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (data.action === "emailCopy") return json(emailCopy(data));
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
    var received = new Date();
    var reference = "";
    try {
      reference = nextReference(received);
    } catch (err) {
      console.error("Reference number failed: " + (err && err.stack || err));
    }
    // Saving to the sheet must never stop the email.
    try {
      saveToSheet(data, reference, received);
    } catch (err) {
      console.error("Saving to the sheet failed for " + (reference || "(no reference)") + ": " + (err && err.stack || err));
    }
    sendBookingEmail(data, reference);
    var copyKey = "";
    try {
      copyKey = rememberForCopy(data, reference);
    } catch (err) {
      console.error("Keeping the copy failed for " + (reference || "(no reference)") + ": " + (err && err.stack || err));
    }
    var reply = { ok: true };
    if (reference) reply.reference = reference;
    if (copyKey) reply.copyKey = copyKey;
    return json(reply);
  } catch (err) {
    console.error("Booking request failed: " + (err && err.stack || err));
    return json({ ok: false, error: "The request could not be sent." });
  }
}

// Visiting the web app URL in a browser shows that it is running.
function doGet() {
  return json({ ok: true, service: "Nexa Horse Transport Booking / Estimate requests" });
}

// ---------- reference numbers and the Google Sheet ----------

// NX-2026-0001: the year, then a number that goes up by one for each request that year.
// The counter is kept in the script's properties, under a lock so two requests at once never share a number.
function nextReference(now) {
  var year = Utilities.formatDate(now || new Date(), TIME_ZONE, "yyyy");
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = "REF_COUNTER_" + year;
    var n = (parseInt(props.getProperty(key), 10) || 0) + 1;
    props.setProperty(key, String(n));
    return "NX-" + year + "-" + ("000" + n).slice(-Math.max(4, String(n).length));
  } finally {
    lock.releaseLock();
  }
}

// A long random private token (64 letters and digits). Kept only in the sheet.
function privateToken() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

// The "Nexa Booking Requests" spreadsheet, created (with its two tabs) the first time.
function bookingSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      console.error("The saved sheet could not be opened, so a new one is created: " + err);
    }
  }
  var ss = SpreadsheetApp.create(SHEET_NAME);
  var requests = ss.getSheets()[0].setName("Requests");
  var horses = ss.insertSheet("Horses");
  [[requests, REQUEST_COLUMNS], [horses, HORSE_COLUMNS]].forEach(function (pair) {
    var sheet = pair[0], columns = pair[1];
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold").setBackground("#F4EEF8");
    sheet.setFrozenRows(1);
  });
  ss.setSpreadsheetTimeZone(TIME_ZONE);
  requests.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm");
  props.setProperty("SHEET_ID", ss.getId());
  return ss;
}

function tab(ss, name, columns) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// A cell value that Sheets keeps as plain text: anything starting with = + - or @ gets a leading apostrophe
// (hidden in the sheet), so nothing a customer types can run as a formula.
function cellText(value, max) {
  var v = clean(value, max || 500);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function saveToSheet(data, reference, received) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = bookingSpreadsheet();
    var pickup = data.pickup || {}, dropoff = data.dropoff || {};
    var dates = data.dates || {}, quote = data.quote || {};
    var stall = function (type) {
      var s = (data.stalls || []).filter(function (x) { return x && x.type === type; })[0];
      return String(s ? Number(s.count) || 0 : 0);
    };
    var names = splitName(data);
    var row = [
      cellText(reference || "(none)"), received, "New",
      cellText(names.first, 60), cellText(names.last, 60), cellText(data.name, 120),
      cellText(data.phone, 40), cellText(data.email, 200),
      cellText(pickup.label, 300), cellText(point(pickup) || ""), cellText(pickup.entered, 200),
      cellText(dropoff.label, 300), cellText(point(dropoff) || ""), cellText(dropoff.entered, 200),
      cellText(data.trip, 80), String(Number(data.distanceKm) || 0), cellText(data.distanceSource, 60), cellText(data.routeNote, 600),
      cellText(dates.pickupEarliest, 20), cellText(dates.pickupLatest, 20), cellText(dates.dropoffEarliest, 20), cellText(dates.dropoffLatest, 20),
      String(Number(data.horses) || 0), stall("Standard stall"), stall("Roomier stall"), stall("Box stall"), cellText(data.details, 3000),
      cellText((quote.lines || []).map(function (l) { return clean(l.text, 200) + ": " + clean(l.amount, 40); }).join("\n"), 2000),
      cellText(quote.minimumApplied, 40), cellText(quote.subtotal, 40), cellText(quote.gst, 40), cellText(quote.total, 40),
      data.smsConsent && clean(data.phone, 40) ? "Yes" : "No", data.termsAccepted ? "Yes" : "No",
      privateToken()
    ];
    tab(ss, "Requests", REQUEST_COLUMNS).appendRow(row);
    var horses = horseList(data.horseDetails).map(function (h) {
      return [cellText(reference || "(none)"), String(h.horse), cellText(h.stall, 40), cellText(h.name, 60), cellText(h.age, 20),
        cellText(h.breed, 60), cellText(h.gender, 20), cellText(h.colour, 40), cellText(h.height, 20), cellText(h.weight, 20), h.foalOrYoung];
    });
    if (horses.length) {
      var horseSheet = tab(ss, "Horses", HORSE_COLUMNS);
      horseSheet.getRange(horseSheet.getLastRow() + 1, 1, horses.length, HORSE_COLUMNS.length).setValues(horses);
    }
  } finally {
    lock.releaseLock();
  }
}

// First and last name as sent by the form; older forms only sent the full name.
function splitName(data) {
  var first = clean(data.firstName, 60), last = clean(data.lastName, 60);
  if (!first && !last) {
    var parts = clean(data.name, 120).split(/\s+/);
    first = parts.shift() || "";
    last = parts.join(" ");
  }
  return { first: first, last: last };
}

// Run from the Apps Script editor once: approves the permissions, creates the sheet if needed, and logs its link.
function setupSheet() {
  var ss = bookingSpreadsheet();
  console.log("Booking / Estimate requests are saved in: " + ss.getUrl());
  return ss.getUrl();
}

// ---------- "Email me a copy" ----------

// What the customer's copy may show: only this request's trip, dates, horses and estimate.
function copySnapshot(data) {
  var place = function (p) { p = p || {}; return { label: clean(p.label, 300), lat: Number(p.lat), lng: Number(p.lng) }; };
  var quote = data.quote || {};
  return {
    firstName: splitName(data).first,
    pickup: place(data.pickup),
    dropoff: place(data.dropoff),
    route: { polyline: simplifyPolyline(clean((data.route || {}).polyline, 60000)) },
    distanceKm: Number(data.distanceKm) || 0,
    trip: clean(data.trip, 80),
    dates: data.dates || {},
    stalls: (data.stalls || []).map(function (s) { return { type: clean(s && s.type, 40), count: Number(s && s.count) || 0 }; }),
    horses: Number(data.horses) || 0,
    horseDetails: horseList(data.horseDetails),
    quote: {
      lines: (quote.lines || []).slice(0, 10).map(function (l) { return { text: clean(l && l.text, 200), amount: clean(l && l.amount, 40) }; }),
      minimumApplied: clean(quote.minimumApplied, 40), subtotal: clean(quote.subtotal, 40), gst: clean(quote.gst, 40), total: clean(quote.total, 40)
    }
  };
}

// Keeps the request for COPY_MINUTES and returns the one-time key the page needs to ask for a copy.
function rememberForCopy(data, reference) {
  if (!reference) return "";
  var key = Utilities.getUuid().replace(/-/g, "");
  var entry = { key: key, sent: 0, created: Date.now(), data: copySnapshot(data) };
  var value = JSON.stringify(entry);
  if (value.length > 90000) {
    entry.data.route = { polyline: "" };
    value = JSON.stringify(entry);
  }
  CacheService.getScriptCache().put("copy:" + reference, value, COPY_MINUTES * 60);
  return key;
}

// The page's "Send to my email". Sends this request's copy to the address given, at most COPY_LIMIT times.
function emailCopy(req) {
  var reference = clean(req.reference, 30), key = clean(req.copyKey, 64), to = clean(req.email, 200);
  if (!/^NX-\d{4}-\d{4,}$/.test(reference) || !/^[a-f0-9]{32}$/.test(key)) return { ok: false, error: "not-available" };
  if (!EMAIL_RE.test(to)) return { ok: false, error: "bad-email" };
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  var entry;
  lock.waitLock(20000);
  try {
    var raw = cache.get("copy:" + reference);
    entry = raw ? JSON.parse(raw) : null;
    if (!entry || entry.key !== key) return { ok: false, error: "not-available" };
    var left = COPY_MINUTES * 60 - Math.floor((Date.now() - entry.created) / 1000);
    if (left <= 0) return { ok: false, error: "not-available" };
    if (entry.sent >= COPY_LIMIT) return { ok: false, error: "limit" };
    entry.sent++;
    cache.put("copy:" + reference, JSON.stringify(entry), left);
  } finally {
    lock.releaseLock();
  }
  try {
    sendCustomerCopy(entry.data, reference, to);
    return { ok: true };
  } catch (err) {
    console.error("Email copy failed for " + reference + ": " + (err && err.stack || err));
    return { ok: false, error: "not-sent" };
  }
}

function sendCustomerCopy(snap, reference, to) {
  var map = routeMapImage(snap);
  var cell = "padding:6px 10px;border-bottom:1px solid #DCCFE6;vertical-align:top;";
  var dates = snap.dates || {};
  var range = function (a, b) { a = clean(a, 20); b = clean(b, 20); return a && b && a !== b ? a + " to " + b : a || b; };
  var stallText = snap.stalls.filter(function (s) { return s.count; }).map(function (s) { return s.count + " \u00d7 " + s.type; }).join(", ");
  var sections = [
    ["Your trip", [
      ["Reference number", reference],
      ["Pickup", snap.pickup.label],
      ["Delivery", snap.dropoff.label],
      ["Driving distance", snap.distanceKm ? snap.distanceKm + " km" : ""],
      ["Trip type", snap.trip]
    ]],
    ["Dates", [
      ["Pickup", range(dates.pickupEarliest, dates.pickupLatest) || "to be arranged"],
      ["Delivery", range(dates.dropoffEarliest, dates.dropoffLatest) || "to be arranged"]
    ]],
    ["Your horses", [["Stalls", stallText]].concat(horseRows(snap.horseDetails))]
  ];
  var note = "This is an automatic estimate only. Nothing is confirmed until Nexa Horse Transport calls or emails you to confirm. " +
    "Vet, border, government and customs broker fees are extra, at cost.";
  var hello = snap.firstName ? "Hi " + snap.firstName + "," : "Hello,";
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#222222;max-width:680px;">' +
    '<h2 style="color:#6A2C91;margin:0 0 4px;">Your Booking / Estimate request ' + esc(reference) + '</h2>' +
    '<p style="margin:12px 0;">' + esc(hello) + '</p>' +
    '<p style="margin:0 0 16px;">Thank you for your request. Here is a copy for your records. We will call or email you soon to go over your estimate and dates.</p>';
  if (map.blob) html += '<img src="cid:routeMap" alt="Map of the route from pickup (A) to delivery (B)" width="640" style="max-width:100%;height:auto;border:2px solid #6A2C91;border-radius:6px;">';
  var text = ["YOUR BOOKING / ESTIMATE REQUEST " + reference, "", hello, "",
    "Thank you for your request. Here is a copy for your records. We will call or email you soon to go over your estimate and dates.", ""];
  sections.forEach(function (section) {
    html += '<h3 style="color:#6A2C91;margin:20px 0 6px;">' + esc(section[0]) + '</h3><table style="border-collapse:collapse;width:100%;">';
    text.push(section[0].toUpperCase());
    section[1].forEach(function (row) {
      if (!row[1]) return;
      html += '<tr><td style="' + cell + 'font-weight:bold;width:38%;">' + esc(row[0]) + '</td><td style="' + cell + '">' + esc(row[1]) + "</td></tr>";
      text.push(row[0] + ": " + row[1]);
    });
    html += "</table>";
    text.push("");
  });
  html += '<h3 style="color:#6A2C91;margin:20px 0 6px;">Your estimate</h3><table style="border-collapse:collapse;width:100%;">';
  text.push("YOUR ESTIMATE");
  var rows = (snap.quote.lines || []).map(function (l) { return [l.text, l.amount]; });
  if (snap.quote.minimumApplied) rows.push(["Minimum charge applied", snap.quote.minimumApplied]);
  rows.push(["Subtotal", snap.quote.subtotal], ["GST (5%)", snap.quote.gst], ["Estimated total", snap.quote.total]);
  rows.forEach(function (row, i) {
    var last = i === rows.length - 1;
    html += '<tr><td style="' + cell + (last ? "font-weight:bold;" : "") + '">' + esc(row[0]) + '</td><td style="' + cell +
      'text-align:right;white-space:nowrap;' + (last ? "font-weight:bold;" : "") + '">' + esc(row[1]) + "</td></tr>";
    text.push(row[0] + ": " + row[1]);
  });
  html += "</table>" +
    '<p style="margin:12px 0;padding:10px 12px;background:#FFF9CC;border-left:4px solid #E8141C;">' + esc(note) + "</p>" +
    '<p style="margin:16px 0 0;color:#5E5568;">Questions? Reply to this email, or call 1-844-491-NEXA (1-844-491-6392).<br>Nexa Horse Transport · nexahorsetransport.ca</p></div>';
  text.push(note, "", "Questions? Reply to this email, or call 1-844-491-NEXA (1-844-491-6392).", "Nexa Horse Transport · nexahorsetransport.ca");
  var message = {
    to: to,
    subject: "Your Nexa Horse Transport booking/estimate request \u2013 " + reference,
    htmlBody: html,
    body: text.join("\n"),
    name: "Nexa Horse Transport",
    replyTo: TO_EMAIL
  };
  if (map.blob) message.inlineImages = { routeMap: map.blob };
  MailApp.sendEmail(message);
}

// ---------- email ----------

function sendBookingEmail(data, reference) {
  var pickup = data.pickup || {};
  var dropoff = data.dropoff || {};
  var name = clean(data.name, 120);
  var subject = "New Booking / Estimate request" + (reference ? " " + reference : "") + " – " + name + " – " +
    clean(pickup.label, 80) + " to " + clean(dropoff.label, 80);

  var map = routeMapImage(data);
  var mapsLink = googleMapsLink(data);
  var html = bookingHtml(data, map, mapsLink, reference);
  var text = bookingText(data, map, mapsLink, reference);

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

function bookingRows(data, reference) {
  var pickup = data.pickup || {}, dropoff = data.dropoff || {};
  var names = splitName(data);
  var dates = data.dates || {};
  var stalls = (data.stalls || []).map(function (s) { return clean(s.type, 40) + ": " + (Number(s.count) || 0); }).join(", ");
  return [
    ["Request", [
      ["Reference number", reference || "(not available)"],
      ["Status", "New: nothing is confirmed until we call the customer"]
    ]],
    ["Customer", [
      ["First name", names.first],
      ["Last name", names.last],
      ["Phone", clean(data.phone, 40) || "(not given)"],
      ["Email", clean(data.email, 200) || "(not given)"]
    ]],
    ["Trip", [
      ["Pickup", clean(pickup.label, 300)],
      ["Pickup GPS", gpsText(pickup)],
      ["Pickup entered as", clean(pickup.entered, 200)],
      ["Delivery", clean(dropoff.label, 300)],
      ["Delivery GPS", gpsText(dropoff)],
      ["Delivery entered as", clean(dropoff.entered, 200)],
      ["Earliest pickup date", clean(dates.pickupEarliest, 20) || "(not given)"],
      ["Latest pickup date", clean(dates.pickupLatest, 20) || "(not given)"],
      ["Earliest delivery date", clean(dates.dropoffEarliest, 20) || "(not given)"],
      ["Latest delivery date", clean(dates.dropoffLatest, 20) || "(not given)"],
      ["Trip type", clean(data.trip, 80) ? clean(data.trip, 80) + " (detected automatically)" : "(not detected)"],
      ["Driving distance", (Number(data.distanceKm) || 0) + " km (" + clean(data.distanceSource, 60) + ")"],
      ["Route note", clean(data.routeNote, 600)]
    ]],
    ["Your horses", [
      ["Number of horses", String(Number(data.horses) || 0)],
      ["Per stall type", stalls]
    ].concat(horseRows(data.horseDetails))],
    ["Details", [
      ["Other details & special requirements", clean(data.details, 3000) || "(none)"]
    ]],
    ["Consent", [
      ["Terms & Conditions", data.termsAccepted ? "Agreed" : "Not agreed"],
      ["SMS consent", data.smsConsent && clean(data.phone, 40) ? "Yes" : "No"]
    ]]
  ];
}

// The horse details from the form, cleaned: name, age, breed, gender, colour (required on the form),
// height, weight and foal or young horse (optional).
function horseList(details) {
  return (Array.isArray(details) ? details : []).slice(0, 20).map(function (h, i) {
    h = h || {};
    return {
      horse: Number(h.horse) || i + 1,
      stall: clean(h.stall, 40),
      name: clean(h.name, 60),
      age: clean(h.age, 20),
      breed: clean(h.breed, 60),
      gender: clean(h.gender, 20),
      colour: clean(h.colour, 40),
      height: clean(h.height, 20),
      weight: clean(h.weight, 20),
      foalOrYoung: clean(h.foalOrYoung, 5) === "Yes" ? "Yes" : "No"
    };
  });
}

// One email row per horse.
function horseRows(details) {
  return horseList(details).map(function (h) {
    var bits = [];
    if (h.name) bits.push(h.name);
    if (h.breed) bits.push(h.breed);
    if (h.colour) bits.push(h.colour);
    if (h.age) bits.push(h.age + " years old");
    if (h.gender) bits.push(h.gender);
    if (h.height) bits.push(h.height + " hands");
    if (h.weight) bits.push(h.weight + " kg");
    bits.push("Foal or young horse: " + h.foalOrYoung);
    return ["Horse " + h.horse + " (" + h.stall + ")", bits.join(" \u00b7 ")];
  });
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

function bookingHtml(data, map, mapsLink, reference) {
  var cell = "padding:6px 10px;border-bottom:1px solid #DCCFE6;vertical-align:top;";
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#222222;max-width:680px;">' +
    '<h2 style="color:#6A2C91;margin:0 0 4px;">New Booking / Estimate request' + (reference ? " " + esc(reference) : "") + '</h2>' +
    '<p style="margin:0 0 16px;color:#5E5568;">Sent from the Booking / Estimate form on nexahorsetransport.ca' +
    (data.submittedAt ? " on " + esc(clean(data.submittedAt, 80)) : "") + ".</p>";

  html += '<h3 style="color:#6A2C91;margin:16px 0 6px;">Route map</h3>';
  if (map.blob) {
    html += '<img src="cid:routeMap" alt="Map of the route from pickup (A) to delivery (B)" width="640" style="max-width:100%;height:auto;border:2px solid #6A2C91;border-radius:6px;">';
  }
  if (map.note) html += '<p style="margin:6px 0;color:#5E5568;">' + esc(map.note) + "</p>";
  if (mapsLink) {
    html += '<p style="margin:8px 0 0;"><a href="' + esc(mapsLink) + '" style="color:#6A2C91;font-weight:bold;">Open route in Google Maps</a></p>';
  }

  bookingRows(data, reference).forEach(function (section) {
    html += '<h3 style="color:#6A2C91;margin:20px 0 6px;">' + esc(section[0]) + "</h3><table style=\"border-collapse:collapse;width:100%;\">";
    section[1].forEach(function (row) {
      if (!row[1]) return;
      html += '<tr><td style="' + cell + 'font-weight:bold;width:38%;">' + esc(row[0]) + '</td><td style="' + cell + '">' +
        esc(row[1]).replace(/\n/g, "<br>") + "</td></tr>";
    });
    html += "</table>";
  });

  html += '<h3 style="color:#6A2C91;margin:20px 0 6px;">Instant estimate (shown to the customer)</h3><table style="border-collapse:collapse;width:100%;">';
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

function bookingText(data, map, mapsLink, reference) {
  var lines = ["NEW BOOKING / ESTIMATE REQUEST" + (reference ? " " + reference : "") + " (nexahorsetransport.ca)", ""];
  bookingRows(data, reference).forEach(function (section) {
    lines.push(section[0].toUpperCase());
    section[1].forEach(function (row) { if (row[1]) lines.push(row[0] + ": " + row[1]); });
    lines.push("");
  });
  lines.push("INSTANT ESTIMATE (shown to the customer)");
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

// Run from the Apps Script editor to send yourself a sample email (nothing is saved to the sheet).
function testBookingEmail() {
  sendBookingEmail({
    name: "Test Customer", firstName: "Test", lastName: "Customer", phone: "403-555-0100", email: "", trip: "Within Canada",
    dates: { pickupEarliest: "2027-06-01", pickupLatest: "2027-06-03", dropoffEarliest: "2027-06-02", dropoffLatest: "" },
    details: "Test request from testBookingEmail().",
    pickup: { label: "Sundre, AB, Canada", lat: 51.7976, lng: -114.6403, entered: "address \"Sundre\"" },
    dropoff: { label: "Calgary, AB, Canada", lat: 51.0447, lng: -114.0719, entered: "postal / ZIP code T2P 1J9" },
    distanceKm: 110, distanceSource: "calculated automatically", routeNote: "",
    route: { polyline: "", vias: [] },
    stalls: [{ type: "Standard stall", count: 1 }, { type: "Roomier stall", count: 0 }, { type: "Box stall", count: 0 }],
    horses: 1,
    horseDetails: [{ horse: 1, stall: "Standard stall", name: "Star", age: "8", breed: "Quarter Horse", gender: "Mare", colour: "Bay",
      height: "15.2", weight: "500", foalOrYoung: "No" }],
    quote: { lines: [{ text: "1 x Standard stall @ $2.00/km x 110 km", amount: "$220.00" }], minimumApplied: "$300.00",
      subtotal: "$300.00", gst: "$15.00", total: "$315.00 CAD", notice: "This is an automatic estimate only." },
    smsConsent: false, termsAccepted: true, submittedAt: new Date().toString()
  }, "NX-TEST-0000");
}
