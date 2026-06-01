(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,6663,e=>{"use strict";let r="ocean-credentials";function t(e){let r=e.trim();try{let e=new URL(r);return e.protocol=e.protocol.toLowerCase(),e.hostname=e.hostname.toLowerCase(),e.toString().replace(/\/$/,"")}catch{return r.toLowerCase().replace(/\/$/,"")}}function n(e,r){return`${t(e)}|${r.trim().toLowerCase()}`}function o(e){return!!e&&"object"==typeof e&&"string"==typeof e.nick&&e.nick.length>0&&"string"==typeof e.server&&e.server.length>0}function a(){let e=localStorage.getItem(r);if(!e)return null;let t=JSON.parse(e);if(t&&"object"==typeof t&&2===t.version&&t.entries&&"object"==typeof t.entries){let e={};for(let[r,n]of Object.entries(t.entries))o(n)&&(e[r]=n);return{version:2,activeKey:"string"==typeof t.activeKey?t.activeKey:void 0,entries:e}}if(o(t)){let e=n(t.server,t.nick);return{version:2,activeKey:e,entries:{[e]:t}}}return null}function i(e){localStorage.setItem(r,JSON.stringify(e))}function s(e){let r=!1;for(let[t,n]of Object.entries(e.entries))n.sessionToken&&n.tokenExpiry&&Date.now()>new Date(n.tokenExpiry).getTime()&&(e.entries[t]={...n,sessionToken:void 0,tokenExpiry:void 0},r=!0);return r}e.s(["clearCredentials",0,function(){try{localStorage.removeItem(r),localStorage.removeItem("ocean-saved-nick")}catch{}},"clearSessionToken",0,function(e,r){try{let t=a();if(!t)return;let o=e&&r?n(e,r):t.activeKey;if(!o||!t.entries[o])return;t.entries[o]={...t.entries[o],sessionToken:void 0,tokenExpiry:void 0},i(t)}catch{}},"getAuthSecret",0,function(e){return e.sessionToken?e.sessionToken:e.password},"loadCredentials",0,function(e,r){try{let t=a();if(!t)return null;s(t)&&i(t);let o=e&&r?n(e,r):t.activeKey;return(o?t.entries[o]:Object.values(t.entries)[0])??null}catch{return null}},"saveCredentials",0,function(e){try{let r=a()??{version:2,entries:{}};s(r);let o=n(e.server,e.nick),c=r.entries[o],l=c&&t(c.server)===t(e.server)&&c.nick.trim().toLowerCase()===e.nick.trim().toLowerCase()&&c.password===e.password,d={nick:e.nick,server:e.server,password:e.password,sessionToken:l?c.sessionToken:void 0,tokenExpiry:l?c.tokenExpiry:void 0,savedAt:new Date().toISOString()};r.entries[o]=d,r.activeKey=o,i(r),localStorage.setItem("ocean-saved-nick",e.nick)}catch{}},"storeSessionToken",0,function(e,r,t){try{let o=a();if(!o)return;s(o);let c=o.activeKey??Object.keys(o.entries)[0];if(!c)return;let l=o.entries[c];if(!l)return;let d=new Date(1e3*r).toISOString(),b=t??l.nick,p={...l,nick:b,sessionToken:e,tokenExpiry:d},g=n(l.server,b);g!==c&&delete o.entries[c],o.entries[g]=p,o.activeKey=g,i(o),t&&localStorage.setItem("ocean-saved-nick",t)}catch{}}])},76525,e=>{"use strict";var r=e.i(30152);e.s(["default",0,function({variant:e="secondary",size:t="md",loading:n=!1,fullWidth:o=!1,icon:a,children:i,disabled:s,className:c="",type:l="button",...d}){let b=`btn--${e}`,p=`btn--${t}`;return(0,r.jsxs)(r.Fragment,{children:[(0,r.jsxs)("button",{className:`btn ${b} ${p} ${o?"btn--full":""} ${c}`,disabled:s||n,type:l,...d,children:[n&&!i?(0,r.jsx)("span",{className:"btn-spinner","aria-hidden":!0}):null,!n&&a?(0,r.jsx)("span",{className:"btn-icon",children:a}):null,i&&(0,r.jsx)("span",{children:i})]}),(0,r.jsx)("style",{children:`
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          border: 1px solid transparent;
          border-radius: var(--r-md, 8px);
          cursor: pointer;
          transition:
            background 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
            border-color 150ms,
            box-shadow 150ms,
            transform 150ms,
            opacity 150ms;
          white-space: nowrap;
          user-select: none;
          letter-spacing: 0.01em;
          position: relative;
          height: 36px;
          padding: 0 12px;
        }
        .btn:active:not(:disabled) { transform: scale(0.97); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        .btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--bg-base, #0c1828), 0 0 0 4px var(--accent, #0ea5e9);
        }

        /* Sizes */
        .btn--sm  { height: 28px; padding: 0 10px; font-size: 12px; }
        .btn--md  { height: 36px; padding: 0 12px; font-size: 14px; }
        .btn--lg  { height: 44px; padding: 0 20px; font-size: 15px; }

        /* ── Primary — accent gradient bg, white text, glow on hover ── */
        .btn--primary {
          background: linear-gradient(135deg, var(--accent, #0ea5e9), color-mix(in srgb, var(--accent, #0ea5e9) 80%, #06b6d4));
          color: #fff;
          border-color: rgba(255,255,255,0.1);
          box-shadow: 0 1px 3px rgba(0,0,0,0.35), 0 0 0 0 var(--accent-glow, rgba(14,165,233,0.4));
        }
        .btn--primary:hover:not(:disabled) {
          background: linear-gradient(135deg, var(--accent-hover, #38bdf8), color-mix(in srgb, var(--accent-hover, #38bdf8) 80%, #22d3ee));
          box-shadow:
            0 4px 12px var(--accent-glow, rgba(14,165,233,0.45)),
            0 0 0 1px rgba(255,255,255,0.1) inset;
        }
        .btn--primary:active:not(:disabled) {
          background: linear-gradient(135deg, var(--accent, #0ea5e9), color-mix(in srgb, var(--accent, #0ea5e9) 70%, #0284c7));
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }

        /* ── Secondary — transparent bg, 1px accent border, accent text ── */
        .btn--secondary {
          background: transparent;
          color: var(--accent, #0ea5e9);
          border-color: var(--accent, #0ea5e9);
        }
        .btn--secondary:hover:not(:disabled) {
          background: var(--accent-subtle, rgba(14,165,233,0.1));
          border-color: var(--accent-hover, #38bdf8);
          color: var(--accent-hover, #38bdf8);
        }

        /* ── Ghost — transparent, no border, hover shows float bg ── */
        .btn--ghost {
          background: transparent;
          color: var(--text-secondary, #a0a8c8);
          border-color: transparent;
        }
        .btn--ghost:hover:not(:disabled) {
          background: var(--bg-float, #1a2c40);
          color: var(--text-primary, #f0f4ff);
        }

        /* ── Danger — solid red bg, white text, red glow on hover ── */
        .btn--danger {
          background: var(--danger, #f87171);
          color: #fff;
          border-color: rgba(255,255,255,0.08);
          box-shadow: 0 1px 4px rgba(248,113,113,0.3);
        }
        .btn--danger:hover:not(:disabled) {
          background: color-mix(in srgb, var(--danger, #f87171) 85%, #fff 15%);
          box-shadow: 0 4px 12px rgba(248,113,113,0.5);
        }
        .btn--danger:active:not(:disabled) {
          background: color-mix(in srgb, var(--danger, #f87171) 90%, #000 10%);
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }

        .btn--full { width: 100%; }

        /* Icon / Spinner */
        .btn-icon { display: flex; align-items: center; }
        .btn-spinner {
          width: 13px; height: 13px;
          border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
          border-top-color: currentColor;
          border-radius: 50%;
          animation: btn-spin 0.65s linear infinite;
          flex-shrink: 0;
        }
        @keyframes btn-spin {
          to { transform: rotate(360deg); }
        }

        /* Focus ring accessible outline */
        .btn:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent, #0ea5e9) 20%, transparent);
        }
      `})]})}])},37807,(e,r,t)=>{r.exports=e.r(41269)}]);