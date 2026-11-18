/* Nexa Horse Transport — cookie notice and Google Analytics.
   Google Analytics loads ONLY after the visitor clicks Accept.
   The choice is saved in this browser; "Cookie settings" in the footer changes it. */
(function () {
  var GA_ID = "G-487SEMES3J";
  var KEY = "nexaCookieChoice"; // "accepted" | "declined"
  var fr = (document.documentElement.lang || "").indexOf("fr") === 0;
  var embed = document.documentElement.classList.contains("embed");
  var T = fr ? {
    text: "Nous utilisons Google Analytics pour savoir combien de personnes visitent notre site et d’où elles viennent (ville ou région). Rien n’est activé sans votre accord.",
    more: "Politique de confidentialité", accept: "Accepter", decline: "Refuser", settings: "Paramètres des témoins"
  } : {
    text: "We use Google Analytics to see how many people visit our website and roughly where they are from (city or region). Nothing is turned on unless you agree.",
    more: "Privacy Policy", accept: "Accept", decline: "Decline", settings: "Cookie settings"
  };

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  var loaded = false;
  function loadGA() {
    if (loaded || embed) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag("js", new Date());
    gtag("config", GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
  }

  function clearGACookies() {
    document.cookie.split(";").forEach(function (c) {
      var n = c.split("=")[0].trim();
      if (n.indexOf("_ga") === 0) {
        var host = location.hostname;
        document.cookie = n + "=; Max-Age=0; path=/";
        document.cookie = n + "=; Max-Age=0; path=/; domain=." + host.replace(/^www\./, "");
      }
    });
  }

  var bar;
  function hide() { if (bar) { bar.remove(); bar = null; } }
  function show() {
    if (bar || embed) return;
    bar = document.createElement("div");
    bar.className = "cookie-bar";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", T.settings);
    bar.innerHTML =
      '<p>' + T.text + ' <a href="privacy.html#analytics">' + T.more + '</a></p>' +
      '<div class="cookie-actions">' +
      '<button type="button" class="btn btn-secondary" data-c="declined">' + T.decline + '</button>' +
      '<button type="button" class="btn" data-c="accepted">' + T.accept + '</button></div>';
    bar.addEventListener("click", function (e) {
      var v = e.target.getAttribute && e.target.getAttribute("data-c");
      if (!v) return;
      var was = get();
      set(v);
      hide();
      if (v === "accepted") loadGA();
      else if (was === "accepted") { clearGACookies(); location.reload(); }
    });
    document.body.appendChild(bar);
  }

  function addSettingsLink() {
    if (embed) return;
    var spot = document.querySelector(".footer-bottom") || document.querySelector("footer");
    if (!spot) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "cookie-settings-link";
    b.textContent = T.settings;
    b.addEventListener("click", show);
    spot.appendChild(b);
  }

  function start() {
    addSettingsLink();
    var c = get();
    if (c === "accepted") loadGA();
    else if (c !== "declined") show();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
