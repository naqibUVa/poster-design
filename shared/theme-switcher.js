/* ===========================================================================
   App Suite — theme switcher and chrome collapser.

   Drop-in companion to shared/themes.css. Add both to any app:

       <link rel="stylesheet" href="../../shared/themes.css">
       <script defer src="../../shared/theme-switcher.js"></script>

   and the app gets: ten palettes, light/dark/auto, compact density, a
   collapsible-chrome API, and a keyboard-driven picker. No dependencies, no
   build step, no framework. Loaded as a classic script rather than a module so
   it also works from a double-clicked file:// page.

   WHAT IT MANAGES (all attributes on <html>)
     data-theme    slate | indigo | emerald | amber | rose | teal | violet
                   | copper | midnight | paper
     data-mode     light | dark          (absent = follow the OS)
     data-density  comfortable | compact
     data-chrome   visible | hidden      (see "collapsible chrome" below)

   PERSISTENCE
     localStorage, under keys prefixed "appsuite:". Each app runs on its own
     port and therefore its own origin, so a choice does not automatically
     carry between apps. The dashboard broadcasts its choice to the app frames
     over postMessage to close that gap — see receiveFromDashboard() below.

   COLLAPSIBLE CHROME
     Toolbars opt in by carrying data-chrome-region. Toggling hides every
     opted-in region at once, which on a 13" laptop is the difference between
     three stacked bars and none. The state is remembered, and Escape or the
     keyboard shortcut brings it back — a UI you cannot get back out of is a
     trap, so there is always a visible restore affordance.

   KEYBOARD
     Cmd/Ctrl + Shift + T   cycle palette
     Cmd/Ctrl + Shift + D   cycle light -> dark -> auto
     Cmd/Ctrl + Shift + K   toggle compact density
     Cmd/Ctrl + Shift + H   hide/show the chrome
   =========================================================================== */

(function () {
  "use strict";

  var STORE_PREFIX = "appsuite:";
  var KEY_THEME = STORE_PREFIX + "theme";
  var KEY_MODE = STORE_PREFIX + "mode";
  var KEY_DENSITY = STORE_PREFIX + "density";
  var KEY_CHROME = STORE_PREFIX + "chrome";

  // Order matters: this is the cycle order for the keyboard shortcut, and the
  // order swatches appear in the picker. Neutral first, then by hue, with the
  // two fixed-mode themes last because they behave differently.
  var THEMES = [
    { id: "slate", label: "Slate", swatch: "#2f6fed" },
    { id: "indigo", label: "Indigo", swatch: "#4f46e5" },
    { id: "violet", label: "Violet", swatch: "#7c30c4" },
    { id: "rose", label: "Rose", swatch: "#c2185b" },
    { id: "copper", label: "Copper", swatch: "#b04f22" },
    { id: "amber", label: "Amber", swatch: "#a8600b" },
    { id: "emerald", label: "Emerald", swatch: "#0b7a53" },
    { id: "teal", label: "Teal", swatch: "#00727f" },
    { id: "midnight", label: "Midnight", swatch: "#4d9dff", fixed: "dark" },
    { id: "paper", label: "Paper", swatch: "#3b5f8a", fixed: "light" }
  ];

  var MODES = ["light", "dark", "auto"];

  var root = document.documentElement;

  /* ---------------------------------------------------------------- storage */

  // localStorage throws rather than returning null in a few real situations:
  // Safari private browsing, a file:// page in some builds, and any browser
  // with site data blocked. A theme picker is not worth breaking an app over,
  // so every access degrades to "this session only".
  function read(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* Non-fatal: the attribute is already applied, it just will not persist. */
    }
  }

  function findTheme(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return null;
  }

  /* ------------------------------------------------------------ application */

  var state = {
    theme: read(KEY_THEME, "slate"),
    mode: read(KEY_MODE, "auto"),
    density: read(KEY_DENSITY, "auto"),
    chrome: read(KEY_CHROME, "visible")
  };

  if (!findTheme(state.theme)) state.theme = "slate";
  if (MODES.indexOf(state.mode) === -1) state.mode = "auto";

  function apply() {
    root.setAttribute("data-theme", state.theme);

    // A fixed-mode theme (Midnight, Paper) overrides the mode setting rather
    // than silently disagreeing with it. The stored mode is left untouched so
    // it comes back when the user switches to a normal palette.
    var theme = findTheme(state.theme);
    var effectiveMode = theme && theme.fixed ? theme.fixed : state.mode;

    if (effectiveMode === "auto") {
      root.removeAttribute("data-mode");
    } else {
      root.setAttribute("data-mode", effectiveMode);
    }

    if (state.density === "auto") {
      root.removeAttribute("data-density");
    } else {
      root.setAttribute("data-density", state.density);
    }

    root.setAttribute("data-chrome", state.chrome);

    // Hiding is done with a class on each region rather than by walking the DOM
    // and setting display, so an app can style the transition however it likes
    // and a region added later is picked up automatically.
    var regions = document.querySelectorAll("[data-chrome-region]");
    for (var i = 0; i < regions.length; i++) {
      regions[i].classList.toggle("chrome-hidden", state.chrome === "hidden");
      regions[i].setAttribute("aria-hidden", state.chrome === "hidden" ? "true" : "false");
    }

    syncControls();
    announce();

    // Apps that need to react — a canvas that must re-measure after a toolbar
    // collapses, or an export that bakes in the palette — listen for this
    // instead of polling the attribute.
    window.dispatchEvent(new CustomEvent("appsuite:themechange", {
      detail: {
        theme: state.theme,
        mode: effectiveMode,
        modeSetting: state.mode,
        density: state.density,
        chrome: state.chrome
      }
    }));
  }

  /* --------------------------------------------------------------- mutators */

  function setTheme(id) {
    if (!findTheme(id)) return;
    state.theme = id;
    write(KEY_THEME, id);
    apply();
  }

  function setMode(mode) {
    if (MODES.indexOf(mode) === -1) return;
    state.mode = mode;
    write(KEY_MODE, mode);
    apply();
  }

  function setDensity(density) {
    state.density = density;
    write(KEY_DENSITY, density);
    apply();
  }

  function setChrome(chrome) {
    state.chrome = chrome === "hidden" ? "hidden" : "visible";
    write(KEY_CHROME, state.chrome);
    apply();
  }

  function cycleTheme(step) {
    var index = 0;
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === state.theme) { index = i; break; }
    }
    index = (index + (step || 1) + THEMES.length) % THEMES.length;
    setTheme(THEMES[index].id);
  }

  function cycleMode() {
    setMode(MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]);
  }

  function toggleDensity() {
    setDensity(state.density === "compact" ? "comfortable" : "compact");
  }

  function toggleChrome() {
    setChrome(state.chrome === "hidden" ? "visible" : "hidden");
  }

  /* ------------------------------------------------------ screen-reader note */

  var liveRegion = null;

  function announce() {
    if (!liveRegion) return;
    var theme = findTheme(state.theme);
    liveRegion.textContent =
      (theme ? theme.label : state.theme) + " theme, " +
      (state.mode === "auto" ? "system" : state.mode) + " mode, " +
      (state.chrome === "hidden" ? "toolbars hidden" : "toolbars visible");
  }

  /* ------------------------------------------------------------------- UI */

  var picker = null;

  // The picker is injected rather than required in each app's markup, so an app
  // adopts the whole system by adding two files and nothing else. An app that
  // wants the controls somewhere specific puts an empty
  // <div data-theme-controls></div> where it wants them and we fill that in.
  function buildUI() {
    var host = document.querySelector("[data-theme-controls]");
    var floating = false;

    if (!host) {
      host = document.createElement("div");
      host.className = "appsuite-theme-dock";
      document.body.appendChild(host);
      floating = true;
    }

    host.classList.add("appsuite-theme-controls");

    var chromeBtn = document.createElement("button");
    chromeBtn.type = "button";
    chromeBtn.className = "appsuite-chrome-toggle";
    chromeBtn.setAttribute("data-role", "chrome");
    // This button is deliberately never inside a [data-chrome-region]: the
    // control that unhides the toolbars cannot be one of the things that gets
    // hidden, or the state is unrecoverable without the keyboard.
    chromeBtn.title = "Hide or show the toolbars (Cmd/Ctrl+Shift+H)";
    chromeBtn.addEventListener("click", toggleChrome);

    var themeBtn = document.createElement("button");
    themeBtn.type = "button";
    themeBtn.className = "appsuite-theme-toggle";
    themeBtn.setAttribute("aria-haspopup", "true");
    themeBtn.setAttribute("aria-expanded", "false");
    themeBtn.title = "Change theme (Cmd/Ctrl+Shift+T)";

    var menu = document.createElement("div");
    menu.className = "appsuite-theme-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    var swatches = document.createElement("div");
    swatches.className = "appsuite-swatches";
    THEMES.forEach(function (theme) {
      var swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "appsuite-swatch";
      swatch.setAttribute("role", "menuitemradio");
      swatch.setAttribute("data-theme-id", theme.id);
      swatch.style.setProperty("--swatch", theme.swatch);
      swatch.title = theme.label + (theme.fixed ? " (always " + theme.fixed + ")" : "");
      swatch.innerHTML = '<span class="appsuite-swatch-dot"></span><span class="appsuite-swatch-label"></span>';
      swatch.querySelector(".appsuite-swatch-label").textContent = theme.label;
      swatch.addEventListener("click", function () { setTheme(theme.id); });
      swatches.appendChild(swatch);
    });

    var row = document.createElement("div");
    row.className = "appsuite-theme-row";

    var modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.className = "appsuite-mini";
    modeBtn.setAttribute("data-role", "mode");
    modeBtn.addEventListener("click", cycleMode);

    var densityBtn = document.createElement("button");
    densityBtn.type = "button";
    densityBtn.className = "appsuite-mini";
    densityBtn.setAttribute("data-role", "density");
    densityBtn.addEventListener("click", toggleDensity);

    row.appendChild(modeBtn);
    row.appendChild(densityBtn);
    menu.appendChild(swatches);
    menu.appendChild(row);

    themeBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      themeBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", function (event) {
      if (menu.hidden) return;
      if (!menu.contains(event.target) && event.target !== themeBtn) {
        menu.hidden = true;
        themeBtn.setAttribute("aria-expanded", "false");
      }
    });

    liveRegion = document.createElement("div");
    liveRegion.className = "appsuite-sr-only";
    liveRegion.setAttribute("aria-live", "polite");

    host.appendChild(chromeBtn);
    host.appendChild(themeBtn);
    host.appendChild(menu);
    host.appendChild(liveRegion);

    if (floating) host.classList.add("is-floating");

    picker = { host: host, themeBtn: themeBtn, chromeBtn: chromeBtn, menu: menu, modeBtn: modeBtn, densityBtn: densityBtn };
  }

  function syncControls() {
    if (!picker) return;

    var theme = findTheme(state.theme);
    picker.themeBtn.innerHTML = '<span class="appsuite-swatch-dot"></span><span class="appsuite-theme-name"></span>';
    picker.themeBtn.style.setProperty("--swatch", theme ? theme.swatch : "#2f6fed");
    picker.themeBtn.querySelector(".appsuite-theme-name").textContent = theme ? theme.label : state.theme;

    picker.chromeBtn.textContent = state.chrome === "hidden" ? "Show toolbars" : "Hide toolbars";
    picker.chromeBtn.setAttribute("aria-pressed", state.chrome === "hidden" ? "true" : "false");

    picker.modeBtn.textContent =
      state.mode === "light" ? "Light" : state.mode === "dark" ? "Dark" : "Auto";
    picker.densityBtn.textContent = state.density === "compact" ? "Compact" : "Comfortable";

    var swatches = picker.menu.querySelectorAll(".appsuite-swatch");
    for (var i = 0; i < swatches.length; i++) {
      var active = swatches[i].getAttribute("data-theme-id") === state.theme;
      swatches[i].classList.toggle("is-active", active);
      swatches[i].setAttribute("aria-checked", active ? "true" : "false");
    }
  }

  /* -------------------------------------------------------------- keyboard */

  document.addEventListener("keydown", function (event) {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;

    var key = event.key.toLowerCase();
    if (key === "t") { event.preventDefault(); cycleTheme(event.altKey ? -1 : 1); }
    else if (key === "d") { event.preventDefault(); cycleMode(); }
    else if (key === "k") { event.preventDefault(); toggleDensity(); }
    else if (key === "h") { event.preventDefault(); toggleChrome(); }
  });

  // Escape restores hidden chrome, but only when nothing else is likely to want
  // the key — a modal, a menu, or an editor mid-edit should get it first.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || state.chrome !== "hidden") return;
    if (document.querySelector("[open], dialog[open], .modal.is-open")) return;
    var el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    setChrome("visible");
  });

  /* ------------------------------------------------- dashboard <-> app sync */

  // Each app is a separate origin, so localStorage cannot be shared. The
  // dashboard posts its choice into every frame; an app applies it but does not
  // echo it back, which is what stops two frames from ping-ponging updates.
  function receiveFromDashboard(event) {
    var data = event.data;
    if (!data || data.type !== "appsuite:theme") return;
    if (data.theme && findTheme(data.theme)) { state.theme = data.theme; write(KEY_THEME, data.theme); }
    if (data.mode && MODES.indexOf(data.mode) !== -1) { state.mode = data.mode; write(KEY_MODE, data.mode); }
    if (data.density) { state.density = data.density; write(KEY_DENSITY, data.density); }
    apply();
  }

  window.addEventListener("message", receiveFromDashboard);

  /* ------------------------------------------------------------ public API */

  window.AppSuiteTheme = {
    themes: THEMES,
    get: function () {
      return {
        theme: state.theme, mode: state.mode,
        density: state.density, chrome: state.chrome
      };
    },
    setTheme: setTheme,
    setMode: setMode,
    setDensity: setDensity,
    setChrome: setChrome,
    toggleChrome: toggleChrome,
    toggleDensity: toggleDensity,
    cycleTheme: cycleTheme,

    // Used by the dashboard to push its choice into every app iframe.
    broadcast: function (frames) {
      var payload = {
        type: "appsuite:theme",
        theme: state.theme,
        mode: state.mode,
        density: state.density
      };
      // "*" as the target origin is acceptable here and only here: the payload
      // is three enum values with no secret in it, and the frames live on
      // http://localhost:<port>, a set of origins we would otherwise have to
      // enumerate and keep in sync with apps.json for no security gain.
      (frames || []).forEach(function (frame) {
        try { frame.contentWindow.postMessage(payload, "*"); } catch (err) { /* frame not ready */ }
      });
    }
  };

  /* ------------------------------------------------------------------ boot */

  // The attributes are applied before first paint where possible, so a dark
  // theme does not flash white on load. buildUI has to wait for <body>.
  apply();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { buildUI(); apply(); });
  } else {
    buildUI();
    apply();
  }
})();
