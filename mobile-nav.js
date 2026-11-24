/*
 * Phones: a menu bar fixed to the bottom of the screen (Home, Estimate, Call, Menu) and a "Menu" panel
 * that slides up with every page of the site, grouped. Built here once for all pages, so every page has
 * the same menu. The bar only shows on phones (styles.css, max-width 640px); computers keep the top menu.
 * If this script doesn't run, phones keep the normal top menu.
 */
(function () {
  "use strict";
  var doc = document;
  var root = doc.documentElement;
  // The booking form shown inside another page (index.html?embed=booking) gets no menu of its own.
  if (root.classList.contains("embed") || window.self !== window.top) return;
  var fr = (root.lang || "").toLowerCase().indexOf("fr") === 0;
  var T = fr ? {
    home: "Accueil", estimate: "Estimation", call: "Appeler", menu: "Menu", close: "Fermer", title: "Menu",
    homePage: "Page d'accueil", alberta: "Alberta", canada: "Partout au Canada", longTrips: "Longs trajets",
    help: "Planifier votre trajet", contact: "Nous joindre", callUs: "Appelez-nous", tollFree: "(sans frais)", textUs: "Téléphone",
    email: "Courriel", booking: "Réservation / Estimation", legal: "Informations légales", barLabel: "Menu du téléphone"
  } : {
    home: "Home", estimate: "Estimate", call: "Call", menu: "Menu", close: "Close", title: "Menu",
    homePage: "Home page", alberta: "Alberta", canada: "Across Canada", longTrips: "Long-distance trips",
    help: "Plan your trip", contact: "Contact us", callUs: "Call us", tollFree: "(toll-free)", textUs: "Phone",
    email: "Email", booking: "Booking / Estimate", legal: "Legal", barLabel: "Phone menu"
  };

  // The home page has these sections, so its links stay on the page instead of reloading it.
  var onHome = !!doc.getElementById("services") && !!doc.getElementById("faq");
  var home = function (hash) { return (onHome ? "" : "index.html") + hash; };
  var bookingHere = !!doc.getElementById("booking");

  var GROUPS = [
    { title: T.homePage, links: [
      [T.booking, home("#booking")],
      ["Services", home("#services")],
      ["Our trailer", home("#equipment")],
      ["Route & schedule", home("#route")],
      ["About us", home("#about")],
      ["Questions (FAQ)", home("#faq")]
    ] },
    { title: T.alberta, links: [
      ["Alberta horse transport", "alberta-horse-transport.html"],
      ["Calgary & Cochrane", "calgary-cochrane-horse-transport.html"],
      ["Edmonton", "edmonton-horse-transport.html"],
      ["Red Deer", "red-deer-horse-transport.html"]
    ] },
    { title: T.canada, links: [
      ["British Columbia", "british-columbia-horse-transport.html"],
      ["Langley, BC", "langley-bc-horse-transport.html"],
      ["Saskatchewan", "saskatchewan-horse-transport.html"],
      ["Manitoba", "manitoba-horse-transport.html"],
      ["Ontario", "ontario-horse-transport.html"],
      ["Québec", "quebec-horse-transport.html"],
      ["Québec (en français)", "transport-chevaux-quebec.html"],
      ["New Brunswick", "new-brunswick-horse-transport.html"],
      ["Nova Scotia", "nova-scotia-horse-transport.html"],
      ["Prince Edward Island", "prince-edward-island-horse-transport.html"]
    ] },
    { title: T.longTrips, links: [
      ["Cross-Canada transport", "long-distance-horse-transport-canada.html"],
      ["Coast to coast", "coast-to-coast-horse-transport-canada.html"],
      ["Alberta ⇄ Ontario", "alberta-ontario-horse-transport.html"],
      ["BC ⇄ Ontario", "british-columbia-ontario-horse-transport.html"]
    ] },
    { title: T.help, links: [
      ["Cost: Alberta to Ontario", "horse-transport-cost-alberta-ontario.html"],
      ["Papers for the Canada–US border", "horse-papers-canada-usa-border.html"],
      ["Preparing for a long trip", "prepare-horse-long-distance-trip.html"],
      ["Events calendar", "events.html"]
    ] }
  ];

  var ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
    estimate: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
    call: '<path d="M6.6 3.5h2.8l1.4 4.2-2 1.4a12 12 0 0 0 6.1 6.1l1.4-2 4.2 1.4v2.8a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>'
  };
  function icon(name, size) {
    return '<svg aria-hidden="true" focusable="false" width="' + (size || 26) + '" height="' + (size || 26) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  // ----- The bar -----
  var bar = doc.createElement("nav");
  bar.className = "mnav-bar";
  bar.setAttribute("aria-label", T.barLabel);
  bar.innerHTML =
    '<a class="mnav-item" href="' + (onHome ? "#home" : "index.html") + '">' + icon("home") + "<span>" + T.home + "</span></a>" +
    '<a class="mnav-item" href="' + (bookingHere ? "#booking" : "index.html#booking") + '">' + icon("estimate") + "<span>" + T.estimate + "</span></a>" +
    '<a class="mnav-item mnav-call" href="tel:+18444916392" aria-label="' + T.call + ' 1-844-491-6392 (toll-free)">' + icon("call") + "<span>" + T.call + "</span></a>" +
    '<button type="button" class="mnav-item mnav-menu-btn" aria-expanded="false" aria-controls="mnav-sheet">' + icon("menu") + "<span>" + T.menu + "</span></button>";

  // ----- The Menu panel -----
  var sheet = doc.createElement("div");
  sheet.className = "mnav-sheet";
  sheet.id = "mnav-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "mnav-title");
  sheet.hidden = true;
  var html =
    '<div class="mnav-backdrop" data-close></div>' +
    '<div class="mnav-panel">' +
      '<div class="mnav-head"><p class="mnav-title" id="mnav-title">' + T.title + "</p>" +
        '<button type="button" class="mnav-close" data-close>' + icon("close", 24) + "<span>" + T.close + "</span></button></div>" +
      '<div class="mnav-body">' +
        '<div class="mnav-contact">' +
          '<a class="mnav-contact-call" href="tel:+18444916392">' + icon("call", 24) + "<span><strong>" + T.callUs + "</strong>1-844-491-6392<small>" + T.tollFree + "</small></span></a>" +
          '<a class="mnav-contact-row" href="tel:+14036361639">' + icon("call", 22) + "<span>" + T.textUs + ": +1 403 636 1639</span></a>" +
          '<a class="mnav-contact-row" href="mailto:info@nexahorsetransport.ca">' + icon("mail", 22) + "<span>info@nexahorsetransport.ca</span></a>" +
        "</div>";
  GROUPS.forEach(function (g, i) {
    html += '<section class="mnav-group" aria-labelledby="mnav-g' + i + '"><h2 class="mnav-group-title" id="mnav-g' + i + '">' + esc(g.title) + "</h2><ul>";
    g.links.forEach(function (l) {
      var file = l[1].split("#")[0].toLowerCase();
      var current = file && file === here && l[1].indexOf("#") === -1;
      html += '<li><a href="' + esc(l[1]) + '"' + (current ? ' aria-current="page"' : "") + "><span>" + esc(l[0]) + "</span>" + icon("chevron", 20) + "</a></li>";
    });
    html += "</ul></section>";
  });
  html += '<p class="mnav-legal"><a href="terms.html">Terms &amp; Conditions</a><a href="privacy.html">Privacy Policy</a></p>' +
    "</div></div>";
  sheet.innerHTML = html;

  var menuBtn = bar.querySelector(".mnav-menu-btn");
  var lastFocus = null;

  function openMenu() {
    lastFocus = doc.activeElement;
    sheet.hidden = false;
    root.classList.add("mnav-open");
    menuBtn.setAttribute("aria-expanded", "true");
    // Next frame, so the panel slides up.
    requestAnimationFrame(function () { sheet.classList.add("is-open"); });
    sheet.querySelector(".mnav-close").focus();
  }
  function closeMenu(keepFocus) {
    sheet.classList.remove("is-open");
    root.classList.remove("mnav-open");
    menuBtn.setAttribute("aria-expanded", "false");
    sheet.hidden = true;
    if (!keepFocus && lastFocus && lastFocus.focus) lastFocus.focus();
  }

  menuBtn.addEventListener("click", function () { if (sheet.hidden) openMenu(); else closeMenu(); });
  sheet.addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) { closeMenu(); return; }
    // A link to a part of this page: close the menu so the page can scroll there.
    if (e.target.closest("a")) closeMenu(true);
  });
  doc.addEventListener("keydown", function (e) {
    if (sheet.hidden) return;
    if (e.key === "Escape") { closeMenu(); return; }
    if (e.key !== "Tab") return;
    // Keep the keyboard inside the open menu.
    var items = [].slice.call(sheet.querySelectorAll("a, button"));
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // Turning a phone sideways into a wider screen: close the menu.
  if (window.matchMedia) {
    var mq = window.matchMedia("(max-width: 640px)");
    var onChange = function () { if (!mq.matches && !sheet.hidden) closeMenu(true); };
    if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
  }

  function mount() {
    doc.body.appendChild(sheet);
    doc.body.appendChild(bar);
    root.classList.add("has-mnav");
  }
  if (doc.body) mount(); else doc.addEventListener("DOMContentLoaded", mount);
})();
