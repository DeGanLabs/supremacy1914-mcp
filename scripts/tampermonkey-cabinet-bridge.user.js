// ==UserScript==
// @name         S1914 Cabinet Bridge Keepalive
// @namespace    supremacy-cabinet
// @version      1.1.0
// @description  Re-injects cabinet bridge on Supremacy 1914 game pages (optional; prefer npm run cabinet:keep)
// @match        *://*.bytro.com/*
// @match        *://*.supremacy1914.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  const WS = "ws://127.0.0.1:8765";
  const SCRIPT_URL = "http://127.0.0.1:9878/browser-console.js";
  const TOKEN_URL = "http://127.0.0.1:9878/bridge-token";

  async function resolveToken() {
    try {
      const stored = localStorage.getItem("s1914BridgeToken");
      if (stored && stored.length >= 8) return stored;
    } catch (e) {}
    if (window.__s1914BridgeToken && String(window.__s1914BridgeToken).length >= 8) {
      return String(window.__s1914BridgeToken);
    }
    try {
      const r = await fetch(TOKEN_URL, { cache: "no-store" });
      if (!r.ok) return "";
      const t = (await r.text()).trim();
      if (t.length >= 8) {
        try {
          localStorage.setItem("s1914BridgeToken", t);
        } catch (e) {}
        return t;
      }
    } catch (e) {}
    return "";
  }

  async function tryConnect() {
    if (typeof window.hup === "undefined" || !window.hup?.gameState) return false;
    if (!window.s1914?.connectCabinetBridge) return false;
    const token = await resolveToken();
    if (!token) {
      console.warn(
        "[cabinet-tm] no bridge token — start npm run cabinet (+ npm run cabinet:serve) or set localStorage.s1914BridgeToken",
      );
      return false;
    }
    try {
      window.s1914.connectCabinetBridge(WS, token);
      console.log("[cabinet-tm] bridge connected");
      return true;
    } catch (e) {
      console.warn("[cabinet-tm]", e);
      return false;
    }
  }

  function inject() {
    if (document.getElementById("s1914-cabinet-bridge")) {
      tryConnect();
      return;
    }
    const s = document.createElement("script");
    s.id = "s1914-cabinet-bridge";
    s.src = SCRIPT_URL + "?t=" + Date.now();
    s.onload = () => {
      setTimeout(() => {
        tryConnect();
      }, 500);
    };
    s.onerror = () =>
      console.warn(
        "[cabinet-tm] fetch failed — run npm run cabinet:serve or paste console manually",
      );
    document.documentElement.appendChild(s);
  }

  const tick = () => {
    tryConnect().then((ok) => {
      if (!ok) inject();
    });
  };
  tick();
  setInterval(tick, 30_000);
})();
