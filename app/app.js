// Nexa Team App, part 1: logins and roles, trips from estimate to delivery, driver pickup / delivery confirmation.
// Data lives in Google Firebase (project nexa-team-app, Firestore in Montréal). Who may see or change what is
// enforced on Google's side by firestore.rules; this file only decides what to show.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, updateDoc,
  deleteDoc, addDoc, collection, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fb = initializeApp({
  apiKey: "AIzaSyAOtj1bmMP3ndyv6o2tLknNOwufxOwURVU",
  authDomain: "nexa-team-app.firebaseapp.com",
  projectId: "nexa-team-app",
  storageBucket: "nexa-team-app.firebasestorage.app",
  messagingSenderId: "103042957823",
  appId: "1:103042957823:web:0f4460c551f4c56cfb27ca"
});
const auth = getAuth(fb);
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const OWNERS = ["nexahorsetransport@gmail.com", "m7samadian@gmail.com"];
const DEFAULT_DISPATCH = "+18444916392";
const STEPS = [
  ["estimate_requested", "Estimate requested"], ["contacted", "Contacted"], ["estimate_sent", "Estimate sent"],
  ["confirmed", "Confirmed"], ["assigned", "Driver assigned"], ["picked_up", "Picked up"], ["in_transit", "In transit"],
  ["delivered", "Delivered"], ["invoiced", "Invoiced"], ["paid", "Paid"]
];
const LABEL = Object.fromEntries(STEPS.concat([["cancelled", "Cancelled"]]));
const ROLES = { admin: "Admin", manager: "Manager", dispatcher: "Dispatcher", driver: "Driver" };
const OPEN = new Set(["estimate_requested", "contacted", "estimate_sent", "confirmed", "assigned", "picked_up", "in_transit"]);

const S = { user: null, email: "", role: "none", tab: "trips", trips: [], members: [], settings: {}, filter: "open", search: "", unsub: [], tripUnsub: [] };
const $view = document.getElementById("view");

// ---------- small helpers ----------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "text") e.textContent = v;
    else if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
function toast(msg, err) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.style.display = "block";
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = "none"), err ? 6000 : 2600);
}
function fail(e) { console.error(e); toast(friendly(e), true); }
function friendly(e) {
  const c = (e && e.code) || "";
  if (c.includes("permission-denied")) return "You don't have permission for that.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Email or password is not right.";
  if (c.includes("email-already-in-use")) return "This email already has an account. Use Sign in or Forgot password.";
  if (c.includes("weak-password")) return "Please use a password of at least 8 characters.";
  if (c.includes("too-many-requests")) return "Too many tries. Please wait a few minutes.";
  return (e && e.message) || "Something went wrong.";
}
// Saves without waiting for the server, so it also works with no signal (Firebase sends it when back online).
function save(promise, okMsg) {
  promise.catch(fail);
  toast(navigator.onLine ? okMsg : okMsg + " (no signal: will send automatically)");
}
const isStaff = () => ["admin", "manager", "dispatcher"].includes(S.role);
const canTeam = () => ["admin", "manager"].includes(S.role);
const field = (label, input) => h("div", {}, h("label", { text: label }), input);
const input = (name, value, type = "text", extra = {}) => h("input", Object.assign({ type, name, value: value ?? "" }, extra));
function fmtTime(ts) {
  const d = ts && ts.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d && !isNaN(d) ? d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "just now";
}
function statusPill(s) { return h("span", { class: "pill st-" + s, text: LABEL[s] || s }); }
function mapsLink(place) {
  if (!place) return null;
  const q = place.lat && place.lng ? place.lat + "," + place.lng : place.label;
  return q ? "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q) : null;
}
function telLink(n) { return "tel:" + String(n || "").replace(/[^\d+]/g, ""); }
function money(n) { const v = Number(n); return isFinite(v) && n !== "" && n != null ? "$" + v.toFixed(2) : ""; }

// GPS (optional: never blocks saving)
function getGps() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), accuracyM: Math.round(p.coords.accuracy) }),
      () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}
// Photo -> small JPEG (max 900 px) so it fits in the trip history and uploads on weak signal.
function shrinkPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- sign in ----------
window.addEventListener("online", () => (document.getElementById("offline").hidden = true));
window.addEventListener("offline", () => (document.getElementById("offline").hidden = false));
document.getElementById("offline").hidden = navigator.onLine;

onAuthStateChanged(auth, async user => {
  stopListening();
  S.user = user; S.email = user && user.email ? user.email.toLowerCase() : "";
  document.getElementById("tabs").hidden = true;
  document.getElementById("rolePill").hidden = true;
  if (!user) return drawLogin();
  if (!user.emailVerified) return drawVerify();
  try {
    S.role = OWNERS.includes(S.email) ? "admin" : "none";
    if (S.role === "none") {
      const m = await getDoc(doc(db, "members", S.email));
      S.role = m.exists() && m.data().active !== false ? m.data().role : "none";
      S.me = m.exists() ? m.data() : null;
    }
  } catch (e) { S.role = "none"; console.error(e); }
  if (S.role === "none") return drawNoAccess();
  const pill = document.getElementById("rolePill");
  pill.textContent = ROLES[S.role]; pill.hidden = false;
  startListening();
  S.tab = "trips";
  drawTabs(); route();
});

function drawLogin(note) {
  const email = input("email", "", "email", { autocomplete: "username", required: true });
  const pass = input("password", "", "password", { autocomplete: "current-password", required: true, minlength: "8" });
  const busy = b => [...$view.querySelectorAll("button")].forEach(x => (x.disabled = b));
  $view.replaceChildren(h("div", { class: "card login" },
    h("h1", { text: "Nexa team sign in" }),
    note ? h("p", { class: "muted", text: note }) : null,
    field("Email", email), h("div", { style: "height:10px" }), field("Password", pass),
    h("div", { style: "height:14px" }),
    h("button", { class: "btn big", text: "Sign in", onclick: async () => {
      busy(true);
      try { await signInWithEmailAndPassword(auth, email.value.trim(), pass.value); } catch (e) { fail(e); busy(false); }
    } }),
    h("div", { style: "height:10px" }),
    h("button", { class: "btn light big", text: "First time? Create my password", onclick: async () => {
      if (pass.value.length < 8) return toast("Please choose a password of at least 8 characters.", true);
      busy(true);
      try { const c = await createUserWithEmailAndPassword(auth, email.value.trim(), pass.value); await sendEmailVerification(c.user); }
      catch (e) { fail(e); busy(false); }
    } }),
    h("p", { class: "muted", style: "margin-top:14px" }, "Forgot your password? ",
      h("a", { href: "#", text: "Send me a reset link", onclick: async ev => {
        ev.preventDefault();
        if (!email.value.trim()) return toast("Type your email first.", true);
        try { await sendPasswordResetEmail(auth, email.value.trim()); toast("Reset link sent. Check your email."); } catch (e) { fail(e); }
      } })),
    h("p", { class: "muted", text: "Only people added to the Nexa team can use this app." })
  ));
}
function drawVerify() {
  $view.replaceChildren(h("div", { class: "card login" },
    h("h1", { text: "Check your email" }),
    h("p", { text: "We sent a link to " + S.email + ". Open it to confirm your email (check Spam too), then come back and tap the button below." }),
    h("button", { class: "btn big", text: "I confirmed my email", onclick: async () => {
      await S.user.reload(); await S.user.getIdToken(true);
      if (auth.currentUser.emailVerified) location.reload(); else toast("Not confirmed yet.", true);
    } }),
    h("div", { style: "height:10px" }),
    h("button", { class: "btn light big", text: "Send the link again", onclick: () => sendEmailVerification(S.user).then(() => toast("Sent."), fail) }),
    h("div", { style: "height:10px" }),
    h("button", { class: "btn red big", text: "Sign out", onclick: () => signOut(auth) })));
}
function drawNoAccess() {
  $view.replaceChildren(h("div", { class: "card login" },
    h("h1", { text: "Not on the team yet" }),
    h("p", { text: "You are signed in as " + S.email + ", but this email hasn't been added to the Nexa team. Ask your manager to add you, then sign in again." }),
    h("button", { class: "btn red big", text: "Sign out", onclick: () => signOut(auth) })));
}

// ---------- live data ----------
function stopListening() { S.unsub.forEach(u => u()); S.unsub = []; S.tripUnsub.forEach(u => u()); S.tripUnsub = []; }
function startListening() {
  const tq = isStaff() ? collection(db, "trips") : query(collection(db, "trips"), where("driverEmail", "==", S.email));
  S.unsub.push(onSnapshot(tq, snap => {
    S.trips = snap.docs.map(d => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 9e9) - ((a.createdAt && a.createdAt.seconds) || 9e9));
    if (S.openTrip) {
      // redraw the open trip when it really changed (status, driver or a save), not while someone is just typing
      const t = S.trips.find(x => x.id === S.openTrip);
      const sig = t ? [t.status, t.driverEmail, t.updatedAt && t.updatedAt.seconds].join("|") : "";
      if (sig !== S.openSig && !S.confirming) { S.openSig = sig; route(); }
    } else if (S.tab === "trips") route();
  }, fail));
  S.unsub.push(onSnapshot(collection(db, "members"), snap => {
    S.members = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    if (S.tab === "team") route();
  }, () => {}));
  S.unsub.push(onSnapshot(doc(db, "settings", "company"), d => { S.settings = d.exists() ? d.data() : {}; }, () => {}));
}

// ---------- navigation ----------
function drawTabs() {
  const tabs = isStaff()
    ? [["trips", "Trips"], ["new", "+ New trip"]].concat(canTeam() ? [["team", "Team"]] : []).concat(S.role === "admin" ? [["settings", "Settings"]] : [])
    : [["trips", "My trips"]];
  tabs.push(["me", "Me"]);
  const nav = document.getElementById("tabs");
  nav.replaceChildren(...tabs.map(([k, t]) => h("button", { class: S.tab === k ? "on" : "", text: t, onclick: () => { S.tab = k; S.openTrip = null; drawTabs(); route(); } })));
  nav.hidden = false;
}
function route() {
  S.confirming = false;
  S.tripUnsub.forEach(u => u()); S.tripUnsub = [];
  if (S.openTrip) return drawTrip(S.openTrip);
  ({ trips: drawTrips, new: drawNewTrip, team: drawTeam, settings: drawSettings, me: drawMe }[S.tab] || drawTrips)();
}
function openTrip(id) { S.openTrip = id; S.openSig = null; window.scrollTo(0, 0); route(); }

// ---------- trip list ----------
function drawTrips() {
  const search = input("q", S.search, "search", { placeholder: isStaff() ? "Search: reference, name, place or horse" : "Search my trips" });
  search.addEventListener("input", () => { S.search = search.value; list(); });
  const chips = h("div", { class: "chips" });
  const box = h("div");
  const filters = [["open", "Open"], ["all", "All"]].concat(STEPS).concat([["cancelled", "Cancelled"]]);
  function match(t, f) { return f === "all" || (f === "open" ? OPEN.has(t.status) : t.status === f); }
  function list() {
    chips.replaceChildren(...filters.map(([k, t]) => {
      const n = S.trips.filter(x => match(x, k)).length;
      return (k === "open" || k === "all" || n) ? h("button", { class: "chip" + (S.filter === k ? " on" : ""), text: t + " (" + n + ")", onclick: () => { S.filter = k; list(); } }) : null;
    }).filter(Boolean));
    const q = S.search.trim().toLowerCase();
    const items = S.trips.filter(t => match(t, /^nx-/.test(q) ? "all" : S.filter)).filter(t => !q ||
      [t.id, t.customerName, t.pickup && t.pickup.label, t.delivery && t.delivery.label, (t.horses || []).map(x => x.name).join(" ")].join(" ").toLowerCase().includes(q));
    box.replaceChildren(...(items.length ? items.map(tripCard) : [h("p", { class: "empty", text: S.trips.length ? "No trips match." : (isStaff() ? "No trips yet. Use “+ New trip” to add one." : "No trips assigned to you yet.") })]));
  }
  list();
  $view.replaceChildren(h("h1", { text: isStaff() ? "Trips" : "My trips" }), search, h("div", { style: "height:10px" }), chips, box);
}
function tripCard(t) {
  const horses = (t.horses || []).map(x => x.name).filter(Boolean).join(", ");
  return h("div", { class: "card trip", tabindex: "0", role: "button", onclick: () => openTrip(t.id), onkeydown: e => e.key === "Enter" && openTrip(t.id) },
    h("div", { class: "trip-top" }, h("div", {}, h("span", { class: "ref", text: t.id }), " · ", h("strong", { text: t.customerName || "(no name)" })), statusPill(t.status)),
    h("div", { class: "muted", text: ((t.pickup && t.pickup.label) || "?") + " → " + ((t.delivery && t.delivery.label) || "?") }),
    h("div", { class: "muted", text: [(t.horses || []).length ? (t.horses.length + " horse(s)" + (horses ? ": " + horses : "")) : "",
      t.pickupDate ? "Pickup " + t.pickupDate : "", t.driverName ? "Driver: " + t.driverName : (isStaff() && ["confirmed"].includes(t.status) ? "No driver yet" : "")].filter(Boolean).join(" · ") }));
}

// ---------- one trip ----------
function drawTrip(id) {
  const t = S.trips.find(x => x.id === id);
  if (!t) { $view.replaceChildren(h("p", { class: "empty", text: "Loading trip…" })); setTimeout(() => S.openTrip === id && S.trips.find(x => x.id === id) && route(), 800); return; }
  const back = h("button", { class: "btn light no-print", text: "← Back", onclick: () => { S.openTrip = null; route(); } });
  const eventsBox = h("div", {}, h("p", { class: "muted", text: "Loading history…" }));
  const privBox = h("div");
  S.tripUnsub.push(onSnapshot(collection(db, "trips", id, "events"), snap => {
    const ev = snap.docs.map(d => d.data()).sort((a, b) => ((b.at && b.at.seconds) || 9e9) - ((a.at && a.at.seconds) || 9e9));
    eventsBox.replaceChildren(...(ev.length ? ev.map(eventRow) : [h("p", { class: "muted", text: "Nothing yet." })]));
  }, fail));
  const parts = [back, h("h1", {}, t.id + " · " + (t.customerName || "(no name)") + " ", statusPill(t.status))];
  parts.push(timeline(t));
  if (isStaff()) {
    S.tripUnsub.push(onSnapshot(doc(db, "trips", id, "private", "details"), d => { privBox.replaceChildren(privateCard(t, d.exists() ? d.data() : {})); }, fail));
    parts.push(staffActions(t), privBox, tripEditor(t));
  } else {
    parts.push(driverView(t));
  }
  parts.push(h("div", { class: "card" }, h("h2", { text: "Trip history" }), isStaff() || S.role === "driver" ? noteForm(t) : null, h("div", { style: "height:10px" }), eventsBox));
  $view.replaceChildren(...parts);
}
function timeline(t) {
  const i = STEPS.findIndex(s => s[0] === t.status);
  return h("div", { class: "card" }, h("div", { class: "steps" }, STEPS.map(([k, label], n) =>
    h("div", { class: "step " + (t.status === "cancelled" ? "todo" : n < i ? "done" : n === i ? "now" : "todo") }, h("span", { class: "dot" }), h("div", {}, h("strong", { text: label }))))),
    t.status === "cancelled" ? h("p", { class: "muted", text: "This trip was cancelled." }) : null);
}
function eventRow(e) {
  const kind = { status: "Status", pickup: "✅ Pickup confirmed", delivery: "✅ Delivery confirmed", location: "📍 Location update", note: "Note", call: "📞 Call", text: "💬 Text", email: "📧 Email", problem: "⚠ Problem" }[e.type] || e.type;
  return h("div", { class: "event" + (e.type === "status" ? " status" : "") },
    h("div", { class: "muted", text: fmtTime(e.at) + " · " + kind + " · " + (e.byName || e.by) + (e.onBehalfOf ? " (for driver " + e.onBehalfOf + ")" : "") }),
    e.text ? h("p", { text: e.text }) : null,
    e.gps ? h("p", {}, h("a", { href: "https://www.google.com/maps?q=" + e.gps.lat + "," + e.gps.lng, target: "_blank", rel: "noopener", text: "GPS " + e.gps.lat + ", " + e.gps.lng })) : null,
    e.photos && e.photos.length ? h("div", { class: "photos" }, e.photos.map(p => h("a", { href: p, target: "_blank" }, h("img", { src: p, alt: "Photo" })))) : null);
}
function logEvent(t, data) {
  return addDoc(collection(db, "trips", t.id, "events"), Object.assign({ at: serverTimestamp(), by: S.email, byName: myName(), byRole: S.role }, data));
}
function myName() { const m = S.members.find(x => x.id === S.email); return (m && m.name) || S.email; }
function setStatus(t, status, extra = {}) {
  const p = updateDoc(doc(db, "trips", t.id), Object.assign({ status, updatedAt: serverTimestamp(), updatedBy: S.email }, extra));
  logEvent(t, { type: "status", text: (LABEL[t.status] || t.status) + " → " + LABEL[status] }).catch(fail);
  return p;
}

// staff: move the trip forward, contact the customer
function staffActions(t) {
  const i = STEPS.findIndex(s => s[0] === t.status);
  const next = STEPS[i + 1];
  const box = h("div", { class: "card no-print" }, h("h2", { text: "Next step" }));
  if (t.status === "confirmed" && !t.driverEmail) box.append(h("p", { class: "muted", text: "Choose a driver below (Trip details), then the trip moves to “Driver assigned”." }));
  if (next && !["picked_up", "delivered"].includes(next[0])) {
    box.append(h("button", { class: "btn yellow", text: "Mark as: " + next[1], onclick: () => save(setStatus(t, next[0]), "Trip moved to " + next[1] + ".") }));
  }
  if (["assigned", "confirmed"].includes(t.status)) box.append(" ", h("button", { class: "btn yellow", text: "Confirm pickup for driver", onclick: () => confirmForm(t, "pickup") }));
  if (["picked_up", "in_transit"].includes(t.status)) box.append(" ", h("button", { class: "btn yellow", text: "Confirm delivery for driver", onclick: () => confirmForm(t, "delivery") }));
  if (t.status !== "cancelled" && t.status !== "paid") box.append(" ", confirmTwice("Cancel trip", () => save(setStatus(t, "cancelled"), "Trip cancelled.")));
  if (t.status === "cancelled") box.append(h("button", { class: "btn light", text: "Re-open trip", onclick: () => save(setStatus(t, "estimate_requested"), "Trip re-opened.") }));
  return box;
}
function confirmTwice(text, action) {
  const b = h("button", { class: "btn red", text });
  b.addEventListener("click", () => {
    if (b.dataset.armed) { action(); delete b.dataset.armed; b.textContent = text; return; }
    b.dataset.armed = "1"; b.textContent = "Tap again to confirm";
    setTimeout(() => { delete b.dataset.armed; b.textContent = text; }, 4000);
  });
  return b;
}

// staff only: phone, email, prices, invoice (stored apart from the trip so drivers never receive it)
function privateCard(t, p) {
  const f = {};
  const mk = (k, label, type = "text", extra = {}) => (f[k] = input(k, p[k], type, extra), field(label, f[k]));
  const phone = p.customerPhone, email = p.customerEmail;
  return h("div", { class: "card" },
    h("h2", { text: "Customer contact and money (office only)" }),
    h("div", { class: "row no-print" },
      phone ? h("a", { class: "btn", href: telLink(phone), text: "☎ Call " + phone }) : null,
      phone ? h("a", { class: "btn light", href: "sms:" + String(phone).replace(/[^\d+]/g, ""), text: "💬 Text" }) : null,
      email ? h("a", { class: "btn light", href: "mailto:" + email + "?subject=" + encodeURIComponent("Your Nexa trip " + t.id), text: "📧 Email" }) : null),
    h("p", { class: "muted no-print", text: "Calls and texts from 1-844-491-NEXA inside the app come in a later part. For now these open your phone." }),
    h("div", { class: "grid" }, mk("customerPhone", "Customer phone", "tel"), mk("customerEmail", "Customer email", "email"),
      mk("estimateTotal", "Website estimate ($)", "text"), mk("price", "Confirmed price before GST ($)", "number", { step: "0.01", min: "0" }),
      mk("invoiceNumber", "Invoice number"), mk("paidOn", "Paid on (date)", "date")),
    h("p", { class: "muted", text: p.price ? "GST 5%: " + money(p.price * 0.05) + " · Total: " + money(p.price * 1.05) : "" }),
    h("div", { class: "row no-print", style: "margin-top:10px" },
      h("button", { class: "btn", text: "Save", onclick: () => {
        const data = {}; for (const k in f) data[k] = f[k].value.trim();
        if (data.price && !(Number(data.price) >= 0)) return toast("Price must be a number.", true);
        data.updatedAt = serverTimestamp(); data.updatedBy = S.email;
        save(setDoc(doc(db, "trips", t.id, "private", "details"), data, { merge: true }), "Saved.");
        logEvent(t, { type: "status", text: "Contact / price details updated" }).catch(fail);
      } }),
      h("button", { class: "btn light", text: "Print estimate", onclick: () => printDoc(t, p, "Estimate") }),
      h("button", { class: "btn light", text: "Print invoice", onclick: () => printDoc(t, p, "Invoice") })));
}
function printDoc(t, p, kind) {
  if (!p.price) return toast("Enter the confirmed price first.", true);
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print.", true);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const horses = (t.horses || []).map(x => esc(x.name) + (x.stall ? " (" + esc(x.stall) + ")" : "")).join(", ");
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${kind} ${esc(t.id)}</title>
  <body style="font-family:system-ui,sans-serif;max-width:720px;margin:30px auto;color:#222">
  <div style="background:#6A2C91;color:#fff;padding:16px 20px;border-bottom:4px solid #E8141C"><b style="font-size:22px">Nexa Horse Transport</b><br>Nexa Line Ltd · 1-844-491-NEXA · nexahorsetransport@gmail.com · www.nexahorsetransport.ca</div>
  <h1 style="color:#3D1758">${kind} ${kind === "Invoice" && p.invoiceNumber ? "#" + esc(p.invoiceNumber) : ""}</h1>
  <p>Date: ${new Date().toLocaleDateString("en-CA")}<br>Trip reference: <b>${esc(t.id)}</b><br>Customer: ${esc(t.customerName)}${p.customerEmail ? "<br>" + esc(p.customerEmail) : ""}${p.customerPhone ? "<br>" + esc(p.customerPhone) : ""}</p>
  <p>From: ${esc(t.pickup && t.pickup.label)}<br>To: ${esc(t.delivery && t.delivery.label)}<br>Horses: ${horses || "-"}</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px">
  <tr><td style="padding:8px;border-bottom:1px solid #ddd">Horse transport</td><td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${money(p.price)}</td></tr>
  <tr><td style="padding:8px;border-bottom:1px solid #ddd">GST (5%)</td><td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${money(p.price * 0.05)}</td></tr>
  <tr><td style="padding:8px"><b>Total (CAD)</b></td><td style="padding:8px;text-align:right"><b>${money(p.price * 1.05)}</b></td></tr></table>
  ${kind === "Estimate" ? "<p style='color:#555'>This estimate is confirmed when we call or email you.</p>" : p.paidOn ? "<p><b>Paid " + esc(p.paidOn) + ". Thank you!</b></p>" : "<p>Thank you for trusting us with your horses.</p>"}
  <script>print()<\/script></body>`);
  w.document.close();
}

// staff: edit the trip itself
function tripEditor(t) {
  const f = {};
  const mk = (k, label, type = "text", value) => (f[k] = input(k, value ?? t[k], type), field(label, f[k]));
  const drivers = S.members.filter(m => m.active !== false && ["driver", "manager", "admin"].includes(m.role));
  const sel = h("select", { name: "driver" }, h("option", { value: "", text: "(no driver yet)" }),
    drivers.map(m => h("option", { value: m.id, text: (m.name || m.id) + " · " + ROLES[m.role], selected: t.driverEmail === m.id })));
  const horsesBox = h("div");
  let horses = JSON.parse(JSON.stringify(t.horses || []));
  function drawHorses() {
    horsesBox.replaceChildren(...horses.map((x, n) => {
      const g = h("div", { class: "grid" });
      [["name", "Name"], ["age", "Age (years)"], ["breed", "Breed"], ["gender", "Gender"], ["colour", "Colour"], ["stall", "Stall"]].forEach(([k, l]) => {
        const i = input(k, x[k]); i.addEventListener("input", () => (x[k] = i.value)); g.append(field(l, i));
      });
      const note = h("textarea", { name: "hnote", value: x.note || "", placeholder: "Health, temperament, loading…" });
      note.addEventListener("input", () => (x.note = note.value));
      return h("div", { class: "horse" }, h("strong", { text: "Horse " + (n + 1) }), g, h("div", { style: "margin-top:6px" }, field("Notes", note)),
        h("button", { class: "btn red", style: "margin-top:6px", text: "Remove horse", onclick: () => { horses.splice(n, 1); drawHorses(); } }));
    }));
  }
  drawHorses();
  const driverNote = h("textarea", { name: "driverNote", value: t.driverNote || "", placeholder: "Gate code, where to park, what to bring…" });
  return h("div", { class: "card no-print" }, h("h2", { text: "Trip details" }),
    h("div", { class: "grid" }, mk("customerName", "Customer name"),
      mk("pickupLabel", "Pickup address", "text", t.pickup && t.pickup.label), mk("deliveryLabel", "Delivery address", "text", t.delivery && t.delivery.label),
      mk("pickupDate", "Pickup date", "date"), mk("deliveryDate", "Delivery date", "date"), field("Driver", sel)),
    h("div", { style: "margin-top:10px" }, field("Notes for the driver", driverNote)),
    h("h2", { style: "margin-top:14px", text: "Horses" }), horsesBox,
    h("button", { class: "btn light", style: "margin-top:8px", text: "+ Add horse", onclick: () => { horses.push({}); drawHorses(); } }),
    h("div", { style: "height:12px" }),
    h("button", { class: "btn big", text: "Save trip details", onclick: () => {
      const d = sel.value, dm = S.members.find(m => m.id === d);
      const data = {
        customerName: f.customerName.value.trim(),
        pickup: Object.assign({}, t.pickup, { label: f.pickupLabel.value.trim() }),
        delivery: Object.assign({}, t.delivery, { label: f.deliveryLabel.value.trim() }),
        pickupDate: f.pickupDate.value, deliveryDate: f.deliveryDate.value,
        driverEmail: d || null, driverName: dm ? (dm.name || dm.id) : null,
        driverNote: driverNote.value.trim(),
        horses: horses.map(x => ({ name: (x.name || "").trim(), age: x.age || "", breed: x.breed || "", gender: x.gender || "", colour: x.colour || "", stall: x.stall || "", note: (x.note || "").trim() })),
        updatedAt: serverTimestamp(), updatedBy: S.email
      };
      if (d && d !== t.driverEmail && ["confirmed", "estimate_sent", "contacted", "estimate_requested"].includes(t.status)) {
        data.status = "assigned";
        logEvent(t, { type: "status", text: LABEL[t.status] + " → Driver assigned (" + data.driverName + ")" }).catch(fail);
      } else if (d !== (t.driverEmail || "")) {
        logEvent(t, { type: "status", text: "Driver changed to " + (data.driverName || "nobody") }).catch(fail);
      }
      save(updateDoc(doc(db, "trips", t.id), data), "Trip saved.");
    } }));
}

// driver: what they need on the road (no prices, no customer phone)
function driverView(t) {
  const dispatch = S.settings.dispatchPhone || DEFAULT_DISPATCH;
  const box = h("div");
  box.append(h("div", { class: "card" },
    h("h2", { text: ((t.pickup && t.pickup.label) || "?") + " → " + ((t.delivery && t.delivery.label) || "?") }),
    h("div", { class: "muted", text: [t.pickupDate && "Pickup " + t.pickupDate, t.deliveryDate && "Delivery " + t.deliveryDate].filter(Boolean).join(" · ") }),
    (t.horses || []).map(x => h("div", { style: "margin-top:8px" }, "🐴 ", h("strong", { text: x.name || "Horse" }),
      [x.gender, x.age && x.age + " y", x.breed, x.colour, x.stall].filter(Boolean).map(v => " · " + v).join(""), x.note ? h("div", { class: "muted", text: x.note }) : null)),
    t.driverNote ? h("p", { style: "margin-top:10px" }, h("strong", { text: "Notes: " }), t.driverNote) : null,
    h("div", { class: "row", style: "margin-top:12px" },
      mapsLink(t.pickup) ? h("a", { class: "btn light", href: mapsLink(t.pickup), target: "_blank", rel: "noopener", text: "🗺 To pickup" }) : null,
      mapsLink(t.delivery) ? h("a", { class: "btn light", href: mapsLink(t.delivery), target: "_blank", rel: "noopener", text: "🗺 To delivery" }) : null)));
  box.append(h("div", { class: "card", style: "background:var(--tint)" }, h("h2", { text: "Your dispatcher" }),
    h("p", { class: "muted", text: "The dispatcher talks to the customer for you." }),
    h("a", { class: "btn", href: telLink(dispatch), text: "☎ Call dispatcher" })));
  if (["assigned", "confirmed"].includes(t.status)) box.append(h("button", { class: "btn yellow big", text: "✅ Confirm pickup", onclick: () => confirmForm(t, "pickup") }));
  if (["picked_up", "in_transit"].includes(t.status)) {
    box.append(h("button", { class: "btn light big", text: "📍 Send location update", onclick: async () => {
      const gps = await getGps();
      if (!gps) return toast("Couldn't get GPS. Check location permission.", true);
      if (t.status === "picked_up") save(setStatus(t, "in_transit", { lastLocation: gps }), "Location sent.");
      else save(updateDoc(doc(db, "trips", t.id), { status: "in_transit", lastLocation: gps, updatedAt: serverTimestamp(), updatedBy: S.email }), "Location sent.");
      logEvent(t, { type: "location", gps, text: "Location update" }).catch(fail);
    } }), h("div", { style: "height:10px" }), h("button", { class: "btn yellow big", text: "✅ Confirm delivery", onclick: () => confirmForm(t, "delivery") }));
  }
  if (t.status === "delivered") box.append(h("div", { class: "card", text: "✅ Delivered. Thank you!" }));
  return box;
}

// pickup / delivery confirmation (driver, or office staff for a driver without signal)
function confirmForm(t, kind) {
  S.confirming = true;
  const isPick = kind === "pickup";
  const checks = (t.horses || []).map(x => ({ label: (x.name || "Horse") + (isPick ? " loaded safely" : " delivered healthy"), el: h("input", { type: "checkbox" }) }));
  checks.push({ label: isPick ? "Health papers / Coggins received" : "Health papers handed over", el: h("input", { type: "checkbox" }) });
  const who = input("who", "", "text", { placeholder: isPick ? "Name of the person handing over" : "Name of the person receiving" });
  const note = h("textarea", { placeholder: "Anything to note (optional)" });
  const photos = [];
  const thumbs = h("div", { class: "photos" });
  const file = h("input", { type: "file", accept: "image/*", capture: "environment", style: "display:none" });
  file.addEventListener("change", async () => {
    if (!file.files[0]) return;
    if (photos.length >= 3) return toast("Up to 3 photos.", true);
    try { const p = await shrinkPhoto(file.files[0]); photos.push(p); thumbs.append(h("img", { src: p, alt: "Photo" })); } catch (e) { toast("Couldn't read that photo.", true); }
    file.value = "";
  });
  const gpsLine = h("p", { class: "muted", text: "📍 Getting GPS…" });
  let gps = null;
  getGps().then(g => { gps = g; gpsLine.textContent = g ? "📍 GPS " + g.lat + ", " + g.lng + " (±" + g.accuracyM + " m)" : "📍 No GPS (still OK to confirm)"; });
  const forDriver = isStaff() && t.driverEmail ? t.driverName || t.driverEmail : null;
  const submit = h("button", { class: "btn yellow big", text: isPick ? "✅ Horses picked up" : "✅ Horses delivered", onclick: () => {
    if (!checks.slice(0, -1).every(c => c.el.checked)) return toast("Please tick every horse first.", true);
    submit.disabled = true;
    const text = [checks.map(c => (c.el.checked ? "☑ " : "☐ ") + c.label).join("\n"), who.value.trim() && (isPick ? "Handed over by: " : "Received by: ") + who.value.trim(), note.value.trim()].filter(Boolean).join("\n");
    logEvent(t, { type: kind, text, gps: gps || null, photos, onBehalfOf: forDriver }).catch(fail);
    save(setStatus(t, isPick ? "picked_up" : "delivered", gps ? { lastLocation: gps } : {}), isPick ? "Pickup confirmed." : "Delivery confirmed.");
    route();
  } });
  $view.replaceChildren(
    h("button", { class: "btn light", text: "← Back", onclick: route }),
    h("h1", { text: (isPick ? "Confirm pickup" : "Confirm delivery") + " · " + t.id }),
    forDriver ? h("p", { class: "card", text: "You are confirming for the driver (" + forDriver + "). It will be saved as confirmed by you for the driver." }) : null,
    h("div", { class: "card" }, h("h2", { text: isPick ? "Horses loaded" : "Horses delivered" }), checks.map(c => h("label", { class: "check" }, c.el, c.label))),
    h("div", { class: "card" }, h("h2", { text: "Photos (up to 3)" }), thumbs,
      h("button", { class: "btn light", style: "margin-top:8px", text: "📷 Take photo", onclick: () => file.click() }), file),
    h("div", { class: "card" }, field(isPick ? "Handed over by" : "Received by", who), h("div", { style: "height:8px" }), field("Note", note), gpsLine,
      h("p", { class: "muted", text: "🕒 Time is saved automatically." })),
    submit);
}

// notes, calls, problems in the trip history
function noteForm(t) {
  const types = isStaff() ? [["note", "Note"], ["call", "Call"], ["text", "Text"], ["email", "Email"], ["problem", "Problem"]] : [["note", "Note"], ["problem", "Problem"]];
  const sel = h("select", {}, types.map(([v, l]) => h("option", { value: v, text: l })));
  const txt = h("textarea", { placeholder: isStaff() ? "e.g. Customer called, wants pickup on the 12th instead." : "e.g. Stopped for water in Golden, both horses fine." });
  return h("div", { class: "no-print" }, h("div", { class: "grid" }, field("Type", sel)), h("div", { style: "height:8px" }), field("Note", txt),
    h("button", { class: "btn", style: "margin-top:8px", text: "Add to history", onclick: () => {
      if (!txt.value.trim()) return toast("Write the note first.", true);
      save(logEvent(t, { type: sel.value, text: txt.value.trim() }), "Added.");
      txt.value = "";
    } }));
}

// ---------- new trip (office) ----------
function drawNewTrip() {
  const f = {};
  const mk = (k, label, type = "text", extra) => (f[k] = input(k, "", type, extra), field(label, f[k]));
  $view.replaceChildren(h("h1", { text: "New trip" }), h("div", { class: "card" },
    h("p", { class: "muted", text: "Use the website reference (NX-2026-0001) if the customer has one; otherwise leave it empty and the app makes one." }),
    h("div", { class: "grid" }, mk("ref", "Reference (optional)", "text", { placeholder: "NX-2026-0001" }), mk("customerName", "Customer name"),
      mk("customerPhone", "Customer phone", "tel"), mk("customerEmail", "Customer email", "email"),
      mk("pickup", "Pickup address"), mk("delivery", "Delivery address"), mk("pickupDate", "Pickup date", "date"), mk("deliveryDate", "Delivery date", "date"),
      mk("horses", "Horse names (comma separated)"), mk("estimateTotal", "Estimate ($)")),
    h("div", { style: "height:12px" }),
    h("button", { class: "btn big", text: "Create trip", onclick: async () => {
      const name = f.customerName.value.trim();
      if (!name) return toast("Customer name is needed.", true);
      let ref = f.ref.value.trim().toUpperCase();
      if (ref && !/^[A-Z0-9-]{4,30}$/.test(ref)) return toast("Reference: letters, numbers and - only.", true);
      if (!ref) ref = "NX-" + new Date().getFullYear() + "-M" + String(Math.floor(1000 + Math.random() * 9000));
      if (S.trips.some(x => x.id === ref)) return toast("A trip with this reference already exists.", true);
      const horses = f.horses.value.split(",").map(s => s.trim()).filter(Boolean).map(n => ({ name: n }));
      const t = { id: ref, status: "estimate_requested" };
      save(setDoc(doc(db, "trips", ref), {
        status: "estimate_requested", customerName: name, pickup: { label: f.pickup.value.trim() }, delivery: { label: f.delivery.value.trim() },
        pickupDate: f.pickupDate.value, deliveryDate: f.deliveryDate.value, horses, driverEmail: null, driverName: null,
        source: "app", createdAt: serverTimestamp(), createdBy: S.email, updatedAt: serverTimestamp(), updatedBy: S.email
      }), "Trip " + ref + " created.");
      setDoc(doc(db, "trips", ref, "private", "details"), { customerPhone: f.customerPhone.value.trim(), customerEmail: f.customerEmail.value.trim(), estimateTotal: f.estimateTotal.value.trim() }).catch(fail);
      logEvent(t, { type: "status", text: "Trip created" }).catch(fail);
      S.tab = "trips"; drawTabs(); openTrip(ref);
    } })));
}

// ---------- team (Admin, Manager) ----------
function drawTeam() {
  const list = h("div");
  const roleOptions = sel => Object.entries(ROLES).filter(([k]) => S.role === "admin" || k !== "admin").map(([k, l]) => h("option", { value: k, text: l, selected: sel === k }));
  const owners = OWNERS.filter(o => !S.members.some(m => m.id === o)).map(o => ({ id: o, name: o === "nexahorsetransport@gmail.com" ? "Nexa (company account)" : "Mohammad Reza", role: "admin", owner: true }));
  const people = owners.concat(S.members).sort((a, b) => Object.keys(ROLES).indexOf(a.role) - Object.keys(ROLES).indexOf(b.role));
  list.replaceChildren(...people.map(m => {
    const locked = m.owner || OWNERS.includes(m.id) || (m.role === "admin" && S.role !== "admin");
    const sel = h("select", { disabled: locked }, roleOptions(m.role));
    sel.addEventListener("change", () => save(setDoc(doc(db, "members", m.id), { role: sel.value, updatedBy: S.email, updatedAt: serverTimestamp() }, { merge: true }), "Role changed."));
    return h("div", { class: "member" },
      h("div", {}, h("strong", { text: m.name || m.id }), h("div", { class: "muted", text: m.id + (m.active === false ? " · not active" : "") })),
      h("div", { class: "row", style: "flex:0 0 auto;align-items:center" }, sel, locked ? null : confirmTwice("Remove", () => save(deleteDoc(doc(db, "members", m.id)), "Removed."))));
  }));
  const email = input("email", "", "email", { placeholder: "their.email@gmail.com" });
  const name = input("name", "");
  const role = h("select", {}, roleOptions("driver"));
  $view.replaceChildren(h("h1", { text: "Team" }),
    h("div", { class: "card" }, list),
    h("div", { class: "card" }, h("h2", { text: "Add a team member" }),
      h("div", { class: "grid" }, field("Email", email), field("Name", name), field("Role", role)),
      h("button", { class: "btn", style: "margin-top:10px", text: "Add", onclick: () => {
        const e = email.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast("Please enter a valid email.", true);
        save(setDoc(doc(db, "members", e), { email: e, name: name.value.trim(), role: role.value, active: true, addedBy: S.email, addedAt: serverTimestamp() }), "Added. They open the app and tap “First time? Create my password”.");
        email.value = ""; name.value = "";
      } })),
    h("div", { class: "card" }, h("h2", { text: "What each role can do" }),
      h("p", { class: "muted", text: "Admin: everything. Manager: all trips, prices, invoices, team. Dispatcher: all trips, prices, invoices, assign drivers, confirm pickup/delivery for a driver without signal. Driver: only their own trips, no prices or customer phone; calls the dispatcher." })));
}

// ---------- settings (Admin) ----------
function drawSettings() {
  const phone = input("dispatchPhone", S.settings.dispatchPhone || DEFAULT_DISPATCH, "tel");
  $view.replaceChildren(h("h1", { text: "Settings" }), h("div", { class: "card" },
    field("Dispatcher phone (drivers call this)", phone),
    h("button", { class: "btn", style: "margin-top:10px", text: "Save", onclick: () => save(setDoc(doc(db, "settings", "company"), { dispatchPhone: phone.value.trim() }, { merge: true }), "Saved.") })));
}
function drawMe() {
  $view.replaceChildren(h("h1", { text: "Me" }), h("div", { class: "card" },
    h("p", {}, "Signed in as ", h("strong", { text: S.email })), h("p", {}, "Role: ", h("strong", { text: ROLES[S.role] })),
    h("p", { class: "muted", text: "Tip: add this app to your home screen (browser menu → Add to Home screen)." }),
    h("button", { class: "btn red big", text: "Sign out", onclick: () => signOut(auth) })));
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
