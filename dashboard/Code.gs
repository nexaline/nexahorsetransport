/**
 * Nexa Horse Transport – private Booking Dashboard (Google Apps Script web app).
 *
 * A separate Apps Script project from the website's booking script. It reads and edits the same Google Sheet
 * ("Nexa Booking Requests"): find a booking by reference number, name, phone, email or horse name; see the
 * customer, trip, dates, horses and estimate; change the status (New, Contacted, Estimate sent, Confirmed,
 * Completed, Cancelled); edit details; and keep a log of every call, email and text with the customer.
 *
 * Who can open it: only the Google accounts listed in ALLOWED_EMAILS, and only if the bookings sheet is shared
 * with them (the dashboard runs as the person using it, so Google itself also checks their access to the sheet).
 *
 * SETUP (once, signed in as nexahorsetransport@gmail.com):
 *  1. https://script.google.com > New project, name it "Nexa Dashboard". Paste this file as Code.gs and add an
 *     HTML file named "Dashboard" with Dashboard.html.
 *  2. Project Settings (gear) > Script Properties:
 *       SHEET_ID        the long ID in the bookings sheet's web address (between /d/ and /edit)
 *       ALLOWED_EMAILS  nexahorsetransport@gmail.com, (Justina's Gmail)   (comma separated)
 *     Keep these in Script Properties only, never in GitHub.
 *  3. Share the bookings sheet (Editor) with every other person in ALLOWED_EMAILS.
 *  4. Deploy > New deployment > Web app: Execute as "User accessing the web app",
 *     Who has access "Anyone with Google account" > Deploy. Bookmark the /exec link.
 *     Each person approves the permissions once, the first time they open it.
 *  5. After changing this code later: Deploy > Manage deployments > Edit > Version "New version".
 *
 * The website's booking script keeps writing the first 35 columns of "Requests" exactly as before; the dashboard
 * only adds its own columns after them (EXTRA_COLUMNS) and a "Communication" tab, and finds every column by its
 * header name, so nothing on the website changes.
 */

var STATUSES = ["New", "Contacted", "Estimate sent", "Confirmed", "Completed", "Cancelled"];
var EXTRA_COLUMNS = ["Confirmed price", "Confirmed pickup date", "Confirmed delivery date", "Internal notes",
  "Last updated", "Updated by"];
var COMM_COLUMNS = ["Reference", "Date", "Type", "Direction", "By", "Note"];
var NOTE_TYPES = ["Call", "Email", "Text", "In person", "Other"];
var DIRECTIONS = ["From customer", "To customer", "Internal note"];
// Booking fields the dashboard may change, with their maximum length.
var EDITABLE = {
  "Status": 40, "First name": 60, "Last name": 60, "Phone": 40, "Email": 200,
  "Pickup": 300, "Delivery": 300,
  "Earliest pickup": 20, "Latest pickup": 20, "Earliest delivery": 20, "Latest delivery": 20,
  "Other details": 3000, "Confirmed price": 40, "Confirmed pickup date": 20, "Confirmed delivery date": 20,
  "Internal notes": 5000
};
var HORSE_EDITABLE = { "Name": 60, "Age (years)": 20, "Breed": 60, "Gender": 20, "Colour": 40,
  "Height (hands)": 20, "Weight (kg)": 20 };
var HIDDEN = { "Private token": true };   // never sent to the browser
var TIME_ZONE = "America/Edmonton";

function doGet() {
  var email = currentEmail();
  if (!isAllowed(email)) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;max-width:480px;margin:60px auto;padding:0 16px">' +
      '<h2 style="color:#3D1758">Nexa Dashboard</h2><p>This page is private. The Google account you are signed in with ' +
      (email ? "(" + escapeHtml(email) + ") " : "") + "doesn't have access.</p></div>")
      .setTitle("Nexa Dashboard").addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
  var page = HtmlService.createTemplateFromFile("Dashboard");
  page.userEmail = email;
  return page.evaluate().setTitle("Nexa Dashboard").addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ---- access -------------------------------------------------------------------------------------------------

function currentEmail() {
  return String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
}

function isAllowed(email) {
  if (!email) return false;
  var list = String(PropertiesService.getScriptProperties().getProperty("ALLOWED_EMAILS") || "nexahorsetransport@gmail.com");
  return list.toLowerCase().split(/[\s,;]+/).filter(String).indexOf(email) !== -1;
}

function requireUser() {
  var email = currentEmail();
  if (!isAllowed(email)) throw new Error("No access for this Google account.");
  return email;
}

// ---- sheet helpers ------------------------------------------------------------------------------------------

function spreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (!id) throw new Error("SHEET_ID is missing in Script Properties.");
  return SpreadsheetApp.openById(id);
}

function requestsSheet(ss) {
  var sheet = ss.getSheetByName("Requests");
  if (!sheet) throw new Error('The "Requests" tab was not found.');
  var headers = headerRow(sheet);
  var missing = EXTRA_COLUMNS.filter(function (c) { return headers.indexOf(c) === -1; });
  if (missing.length) {
    var start = headers.length + 1;
    if (sheet.getMaxColumns() < headers.length + missing.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length + missing.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight("bold").setBackground("#FFF7CC");
  }
  return sheet;
}

function commSheet(ss) {
  var sheet = ss.getSheetByName("Communication");
  if (!sheet) {
    sheet = ss.insertSheet("Communication");
    sheet.getRange(1, 1, 1, COMM_COLUMNS.length).setValues([COMM_COLUMNS]).setFontWeight("bold").setBackground("#F4EEF8");
    sheet.setFrozenRows(1);
    sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm");
  }
  return sheet;
}

function headerRow(sheet) {
  var last = sheet.getLastColumn();
  if (!last) return [];
  var row = sheet.getRange(1, 1, 1, last).getDisplayValues()[0];
  while (row.length && !String(row[row.length - 1]).trim()) row.pop();
  return row.map(function (h) { return String(h).trim(); });
}

// All rows of a tab as objects keyed by header (text exactly as shown in the sheet), plus their row number.
function readTab(sheet) {
  var headers = headerRow(sheet);
  var rows = sheet.getLastRow() < 2 ? [] :
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();
  return rows.map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { if (h && !HIDDEN[h]) o[h] = r[j]; });
    return o;
  });
}

function clean(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 500);
}

// Plain text in Sheets: anything starting with = + - or @ gets a hidden leading apostrophe (never a formula).
function cellText(value, max) {
  var v = clean(value, max);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function findRequest(sheet, reference) {
  var ref = clean(reference, 40);
  var list = readTab(sheet).filter(function (o) { return o["Reference"] === ref; });
  if (!list.length) throw new Error("Booking " + ref + " was not found.");
  return list[0];
}

// ---- called from the dashboard page -------------------------------------------------------------------------

function listBookings() {
  requireUser();
  var ss = spreadsheet();
  var horses = {};
  var horseTab = ss.getSheetByName("Horses");
  if (horseTab) readTab(horseTab).forEach(function (h) {
    (horses[h["Reference"]] = horses[h["Reference"]] || []).push(h["Name"]);
  });
  var list = readTab(requestsSheet(ss)).filter(function (o) { return o["Reference"]; }).map(function (o) {
    return {
      ref: o["Reference"], received: o["Received"], status: o["Status"] || "New",
      name: [o["First name"], o["Last name"]].join(" ").trim() || o["Full name"],
      phone: o["Phone"], email: o["Email"], pickup: o["Pickup"], delivery: o["Delivery"],
      pickupDate: o["Confirmed pickup date"] || o["Earliest pickup"],
      horses: o["Number of horses"], horseNames: (horses[o["Reference"]] || []).join(", "),
      total: o["Confirmed price"] || o["Estimated total"], confirmedPrice: o["Confirmed price"]
    };
  });
  list.reverse();   // newest first
  return { bookings: list, statuses: STATUSES };
}

function getBooking(reference) {
  requireUser();
  var ss = spreadsheet();
  var booking = findRequest(requestsSheet(ss), reference);
  delete booking._row;
  var horseTab = ss.getSheetByName("Horses");
  var horses = horseTab ? readTab(horseTab).filter(function (h) { return h["Reference"] === booking["Reference"]; }) : [];
  horses.forEach(function (h) { delete h._row; });
  var notes = readTab(commSheet(ss)).filter(function (n) { return n["Reference"] === booking["Reference"]; });
  notes.forEach(function (n) { delete n._row; });
  notes.reverse();  // newest first
  return { booking: booking, horses: horses, notes: notes, statuses: STATUSES, noteTypes: NOTE_TYPES,
    directions: DIRECTIONS, editable: Object.keys(EDITABLE), horseEditable: Object.keys(HORSE_EDITABLE) };
}

function saveBooking(reference, changes) {
  var email = requireUser();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = spreadsheet();
    var sheet = requestsSheet(ss);
    var headers = headerRow(sheet);
    var current = findRequest(sheet, reference);
    var summary = [];
    Object.keys(changes || {}).forEach(function (field) {
      if (!EDITABLE.hasOwnProperty(field)) return;
      var value = clean(changes[field], EDITABLE[field]);
      if (field === "Status" && STATUSES.indexOf(value) === -1) throw new Error("Unknown status: " + value);
      if (value === clean(current[field], EDITABLE[field])) return;
      var col = headers.indexOf(field) + 1;
      if (!col) return;
      sheet.getRange(current._row, col).setValue(cellText(value, EDITABLE[field]));
      summary.push(field === "Status" ? "Status: " + (current[field] || "New") + " → " + value
        : field === "Internal notes" ? "Internal notes edited" : field + ": " + (value || "(cleared)"));
    });
    if (summary.length) {
      sheet.getRange(current._row, headers.indexOf("Last updated") + 1).setValue(new Date());
      sheet.getRange(current._row, headers.indexOf("Updated by") + 1).setValue(email);
      commSheet(ss).appendRow([cellText(current["Reference"], 40), new Date(), "Update", "Internal note", email,
        cellText("Changed: " + summary.join("; "), 3000)]);
    }
  } finally {
    lock.releaseLock();
  }
  return getBooking(reference);
}

function saveHorse(reference, horseNumber, changes) {
  var email = requireUser();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = spreadsheet();
    var sheet = ss.getSheetByName("Horses");
    if (!sheet) throw new Error('The "Horses" tab was not found.');
    var headers = headerRow(sheet);
    var ref = clean(reference, 40);
    var horse = readTab(sheet).filter(function (h) { return h["Reference"] === ref && h["Horse"] === String(horseNumber); })[0];
    if (!horse) throw new Error("Horse " + horseNumber + " of " + ref + " was not found.");
    var summary = [];
    Object.keys(changes || {}).forEach(function (field) {
      if (!HORSE_EDITABLE.hasOwnProperty(field)) return;
      var value = clean(changes[field], HORSE_EDITABLE[field]);
      if (value === clean(horse[field], HORSE_EDITABLE[field])) return;
      var col = headers.indexOf(field) + 1;
      if (!col) return;
      sheet.getRange(horse._row, col).setValue(cellText(value, HORSE_EDITABLE[field]));
      summary.push(field + ": " + (value || "(cleared)"));
    });
    if (summary.length) {
      commSheet(ss).appendRow([cellText(ref, 40), new Date(), "Update", "Internal note", email,
        cellText("Horse " + horseNumber + " changed: " + summary.join("; "), 3000)]);
    }
  } finally {
    lock.releaseLock();
  }
  return getBooking(reference);
}

function addNote(reference, type, direction, note) {
  var email = requireUser();
  var ss = spreadsheet();
  var booking = findRequest(requestsSheet(ss), reference);
  type = NOTE_TYPES.indexOf(type) !== -1 ? type : "Other";
  direction = DIRECTIONS.indexOf(direction) !== -1 ? direction : "Internal note";
  note = clean(note, 3000);
  if (!note) throw new Error("Please write the note first.");
  commSheet(ss).appendRow([cellText(booking["Reference"], 40), new Date(), type, direction, email, cellText(note, 3000)]);
  return getBooking(reference);
}
