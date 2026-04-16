// Shared nav for experimental views.
// To add a new view: append to VIEWS below + create the html file.
// To disable a view: remove it from VIEWS (or comment out).
// To remove this system entirely: delete this file and remove its <script> tag
//   from each viewer's head. Each viewer still has a hardcoded nav fallback
//   inside its top-bar so nothing breaks.
(function () {
  'use strict';

  const VIEWS = [
    { href: "index.html",   label: "Map",     match: /^\/?(index\.html)?$/ },
    { href: "viewer2.html", label: "Topics",  match: /viewer2\.html$/ },
  ];

  function render() {
    const path = location.pathname;
    const containers = document.querySelectorAll("[data-views-nav]");
    if (!containers.length) return;

    containers.forEach(container => {
      const style = container.getAttribute("data-views-nav-style") || "bar";
      container.innerHTML = "";
      VIEWS.forEach(v => {
        const a = document.createElement("a");
        a.href = v.href;
        a.textContent = v.label;
        const isActive = v.match.test(path) ||
                         (v.href === "index.html" && (path.endsWith("/") || path.endsWith("/index.html") || path === ""));
        if (style === "bar") {
          a.className = "bar-btn" + (isActive ? " active" : "");
        } else {
          // inline floating style (used on main map)
          a.style.cssText =
            "padding: 5px 11px; border-radius: 7px; text-decoration: none;" +
            "font-size: 11px; font-family: 'DM Sans', system-ui, sans-serif;" +
            (isActive
              ? "color:#fff; background:rgba(110,168,255,0.2); border:1px solid rgba(110,168,255,0.45);"
              : "color:rgba(226,232,244,0.8); background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.08);");
          if (!isActive) {
            a.addEventListener("mouseenter", () => {
              a.style.background = "rgba(110,168,255,0.12)";
              a.style.color = "#fff";
            });
            a.addEventListener("mouseleave", () => {
              a.style.background = "rgba(255,255,255,0.035)";
              a.style.color = "rgba(226,232,244,0.8)";
            });
          }
        }
        container.appendChild(a);
      });
    });
  }

  // Keyboard shortcut: digit 1-N jumps to that view (and Shift+? shows help)
  function onKeyDown(ev) {
    // Skip when user is typing in an input/textarea/select
    const t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    if (k >= "1" && k <= "9") {
      const idx = parseInt(k, 10) - 1;
      if (idx < VIEWS.length) {
        const v = VIEWS[idx];
        // Preserve ?highlight= across jumps
        const params = new URLSearchParams(location.search);
        const hl = params.get("highlight");
        location.href = v.href + (hl != null ? "?highlight=" + hl : "");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
  document.addEventListener("keydown", onKeyDown);
})();
