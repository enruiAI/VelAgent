// velagent-brand browser half: official dynamic client module-loader factory.
window.__ModuleLoader__.load({
  id: "velagent-brand",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    (function (module, exports, require) {
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_jsx_runtime = require("react/jsx-runtime");
var FAVICON_URL = "/velagent-assets/favicon.svg";
var BRAND_GLYPH = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect x="6" y="6" width="52" height="52" rx="14" fill="url(#g)"/><path d="M26 16h12v10h10v12H38v10H26V38H16V26h10z" fill="#ffffff" opacity="0.92"/></svg>'
);
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject(
    "sidebar.brand.name",
    () => ctx.slots.register({ name: "sidebar.brand.name" }, BrandName)
  );
  ctx.slots.inject(
    "sidebar.brand.mark",
    () => ctx.slots.register({ name: "sidebar.brand.mark" }, BrandMark)
  );
  installFavicon();
}
function BrandName() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 14, fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap" }, children: "VelAgent" });
}
function BrandMark() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: BRAND_GLYPH, alt: "VelAgent", width: 20, height: 20, style: { display: "block", flex: "none", borderRadius: 5 } });
}
function installFavicon() {
  if (typeof document === "undefined" || document.head === null) return;
  const links = document.querySelectorAll('link[rel~="icon"]');
  if (links.length === 0) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = FAVICON_URL;
    document.head.appendChild(link);
    return;
  }
  for (const link of links) {
    link.href = FAVICON_URL;
    link.type = "image/svg+xml";
  }
}

    })(module, exports, require);
    return module.exports;
  },
});