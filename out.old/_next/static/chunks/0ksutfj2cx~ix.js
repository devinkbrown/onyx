(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,6663,e=>{"use strict";let t="ocean-credentials";function a(e){let t=e.trim();try{let e=new URL(t);return e.protocol=e.protocol.toLowerCase(),e.hostname=e.hostname.toLowerCase(),e.toString().replace(/\/$/,"")}catch{return t.toLowerCase().replace(/\/$/,"")}}function r(e,t){return`${a(e)}|${t.trim().toLowerCase()}`}function n(e){return!!e&&"object"==typeof e&&"string"==typeof e.nick&&e.nick.length>0&&"string"==typeof e.server&&e.server.length>0}function s(){let e=localStorage.getItem(t);if(!e)return null;let a=JSON.parse(e);if(a&&"object"==typeof a&&2===a.version&&a.entries&&"object"==typeof a.entries){let e={};for(let[t,r]of Object.entries(a.entries))n(r)&&(e[t]=r);return{version:2,activeKey:"string"==typeof a.activeKey?a.activeKey:void 0,entries:e}}if(n(a)){let e=r(a.server,a.nick);return{version:2,activeKey:e,entries:{[e]:a}}}return null}function i(e){localStorage.setItem(t,JSON.stringify(e))}function o(e){let t=!1;for(let[a,r]of Object.entries(e.entries))r.sessionToken&&r.tokenExpiry&&Date.now()>new Date(r.tokenExpiry).getTime()&&(e.entries[a]={...r,sessionToken:void 0,tokenExpiry:void 0},t=!0);return t}e.s(["clearCredentials",0,function(){try{localStorage.removeItem(t),localStorage.removeItem("ocean-saved-nick")}catch{}},"clearSessionToken",0,function(e,t){try{let a=s();if(!a)return;let n=e&&t?r(e,t):a.activeKey;if(!n||!a.entries[n])return;a.entries[n]={...a.entries[n],sessionToken:void 0,tokenExpiry:void 0},i(a)}catch{}},"getAuthSecret",0,function(e){return e.sessionToken?e.sessionToken:e.password},"loadCredentials",0,function(e,t){try{let a=s();if(!a)return null;o(a)&&i(a);let n=e&&t?r(e,t):a.activeKey;return(n?a.entries[n]:Object.values(a.entries)[0])??null}catch{return null}},"saveCredentials",0,function(e){try{let t=s()??{version:2,entries:{}};o(t);let n=r(e.server,e.nick),c=t.entries[n],l=c&&a(c.server)===a(e.server)&&c.nick.trim().toLowerCase()===e.nick.trim().toLowerCase()&&c.password===e.password,d={nick:e.nick,server:e.server,password:e.password,sessionToken:l?c.sessionToken:void 0,tokenExpiry:l?c.tokenExpiry:void 0,savedAt:new Date().toISOString()};t.entries[n]=d,t.activeKey=n,i(t),localStorage.setItem("ocean-saved-nick",e.nick)}catch{}},"storeSessionToken",0,function(e,t,a){try{let n=s();if(!n)return;o(n);let c=n.activeKey??Object.keys(n.entries)[0];if(!c)return;let l=n.entries[c];if(!l)return;let d=new Date(1e3*t).toISOString(),f=a??l.nick,p={...l,nick:f,sessionToken:e,tokenExpiry:d},b=r(l.server,f);b!==c&&delete n.entries[c],n.entries[b]=p,n.activeKey=b,i(n),a&&localStorage.setItem("ocean-saved-nick",a)}catch{}}])},76525,e=>{"use strict";var t=e.i(30152);e.s(["default",0,function({variant:e="secondary",size:a="md",loading:r=!1,fullWidth:n=!1,icon:s,children:i,disabled:o,className:c="",type:l="button",...d}){let f=`btn--${e}`,p=`btn--${a}`;return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("button",{className:`btn ${f} ${p} ${n?"btn--full":""} ${c}`,disabled:o||r,type:l,...d,children:[r&&!i?(0,t.jsx)("span",{className:"btn-spinner","aria-hidden":!0}):null,!r&&s?(0,t.jsx)("span",{className:"btn-icon",children:s}):null,i&&(0,t.jsx)("span",{children:i})]}),(0,t.jsx)("style",{children:`
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
      `})]})}])},27656,e=>{"use strict";var t=e.i(30152),a=e.i(93737),r=e.i(79239);let n=new Intl.NumberFormat("en-US"),s=new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1});function i(e){return"number"==typeof e&&Number.isFinite(e)?e:0}e.s(["default",0,function(){let e=(0,r.useOnyxStore)(e=>e.serverStats),[o,c]=(0,a.useState)(null);(0,a.useEffect)(()=>{let e=!1;async function t(){try{let t=await fetch("/stats/index.json",{cache:"no-store"});if(!t.ok)return;let a=await t.json();e||c(a)}catch{}}t();let a=window.setInterval(t,6e4);return()=>{e=!0,window.clearInterval(a)}},[]);let l=(0,a.useMemo)(()=>{let e=[...o?.channels??[]].sort((e,t)=>i(t.total_messages)-i(e.total_messages));return{top:e[0],messages:e.reduce((e,t)=>e+i(t.total_messages),0),joins:e.reduce((e,t)=>e+i(t.total_joins),0),peak:e.reduce((e,t)=>Math.max(e,i(t.peak_members)),0),tracked:i(o?.tracked_channels??e.length)}},[o]);if(!e&&!o)return null;let d=e?[{mark:"USR",label:"Users",value:e.users},{mark:"CHN",label:"Channels",value:e.channels},{mark:"NET",label:"Servers",value:e.servers},{mark:"OP",label:"Operators",value:e.opers}]:[];return(0,t.jsxs)("div",{className:"ssw-root",children:[e&&(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)("h3",{className:"ssw-title",children:"Network Stats"}),(0,t.jsx)("div",{className:"ssw-grid",children:d.map(({mark:e,label:a,value:r})=>(0,t.jsxs)("div",{className:"ssw-card",children:[(0,t.jsx)("span",{className:"ssw-mark","aria-hidden":!0,children:e}),(0,t.jsx)("span",{className:"ssw-value",children:n.format(r)}),(0,t.jsx)("span",{className:"ssw-label",children:a})]},a))})]}),o&&(0,t.jsxs)("section",{className:"ssw-activity","aria-label":"Channel activity",children:[(0,t.jsxs)("div",{className:"ssw-activity-head",children:[(0,t.jsx)("h3",{className:"ssw-title",children:"Channel Activity"}),(0,t.jsx)("a",{href:"/stats/",className:"ssw-stats-link",children:"Open"})]}),(0,t.jsxs)("a",{href:l.top?.url??"/stats/",className:"ssw-activity-main",children:[(0,t.jsx)("span",{className:"ssw-activity-label",children:"Top channel"}),(0,t.jsx)("strong",{children:l.top?.name??"#root"}),(0,t.jsxs)("span",{children:[s.format(i(l.top?.total_messages))," messages tracked"]})]}),(0,t.jsxs)("div",{className:"ssw-activity-grid",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("span",{children:"Messages"}),(0,t.jsx)("strong",{children:s.format(l.messages)})]}),(0,t.jsxs)("div",{children:[(0,t.jsx)("span",{children:"Joins"}),(0,t.jsx)("strong",{children:s.format(l.joins)})]}),(0,t.jsxs)("div",{children:[(0,t.jsx)("span",{children:"Peak"}),(0,t.jsx)("strong",{children:n.format(l.peak)})]}),(0,t.jsxs)("div",{children:[(0,t.jsx)("span",{children:"Tracked"}),(0,t.jsx)("strong",{children:n.format(l.tracked)})]})]})]}),(0,t.jsx)("style",{children:`
        .ssw-root {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding-top: 4px;
          border-top: 1px solid var(--border-subtle);
          margin-top: 4px;
        }

        .ssw-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0;
        }

        .ssw-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .ssw-card {
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md, 8px);
          padding: 10px 10px 8px;
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
          position: relative;
          overflow: hidden;
          transition: border-color var(--t-fast);
        }

        .ssw-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent-border), transparent);
          opacity: 0;
          transition: opacity var(--t-fast);
        }

        .ssw-card:hover {
          border-color: var(--accent-border);
        }

        .ssw-card:hover::after {
          opacity: 1;
        }

        .ssw-mark {
          width: fit-content;
          padding: 2px 5px;
          border-radius: 5px;
          background: var(--accent-subtle);
          color: var(--accent);
          font-size: 8px;
          line-height: 1.1;
          font-weight: 900;
          letter-spacing: 0.08em;
          margin-bottom: 5px;
        }

        .ssw-value {
          font-size: 20px;
          font-weight: 800;
          color: var(--accent);
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.03em;
        }

        .ssw-label {
          font-size: 10px;
          color: var(--text-muted);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 1px;
        }

        .ssw-activity {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-top: 10px;
          border-top: 1px solid var(--border-subtle);
        }

        .ssw-activity-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .ssw-stats-link {
          color: var(--accent);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-decoration: none;
        }

        .ssw-stats-link:hover {
          text-decoration: underline;
        }

        .ssw-activity-main {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 12px;
          border: 1px solid var(--accent-border);
          border-radius: var(--r-md, 8px);
          background:
            radial-gradient(circle at 18% 16%, var(--accent-subtle), transparent 64%),
            var(--bg-void);
          text-decoration: none;
          min-width: 0;
          transition: border-color var(--t-fast), transform var(--t-fast);
        }

        .ssw-activity-main:hover {
          border-color: var(--accent);
          transform: translateY(-1px);
          text-decoration: none;
        }

        .ssw-activity-label,
        .ssw-activity-grid span {
          color: var(--text-muted);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ssw-activity-main strong {
          color: var(--text-primary);
          font-size: 18px;
          line-height: 1.05;
          overflow-wrap: anywhere;
        }

        .ssw-activity-main > span:last-child {
          color: var(--text-secondary);
          font-size: 11px;
          line-height: 1.35;
        }

        .ssw-activity-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .ssw-activity-grid div {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 9px 10px;
          border-radius: var(--r-sm, 6px);
          border: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-void) 86%, transparent);
        }

        .ssw-activity-grid strong {
          color: var(--text-primary);
          font-size: 15px;
          line-height: 1.05;
          font-variant-numeric: tabular-nums;
          overflow-wrap: anywhere;
        }
      `})]})}])},1544,41451,e=>{"use strict";var t=e.i(30152);function a(e){let t=0;for(let a=0;a<e.length;a++)t=e.charCodeAt(a)+((t<<5)-t);let a=["#60a5fa","#34d399","#a78bfa","#f472b6","#fb923c","#facc15","#38bdf8","#4ade80","#e879f9","#f87171","#2dd4bf","#c084fc"];return a[Math.abs(t)%a.length]}e.s(["getNickColor",0,a],41451);let r={online:"#23a55a",idle:"#f0b232",dnd:"#f04747",offline:"#80848e"};e.s(["default",0,function({nick:e,size:n=36,status:s,speaking:i=!1,muted:o=!1,deafened:c=!1,animated:l=!1,showTooltip:d=!1,className:f="",src:p}){let b,g,x=a(e),v="#"+[Math.max(0,((g=parseInt(x.replace("#",""),16))>>16)-Math.round(51)),Math.max(0,(g>>8&255)-Math.round(51)),Math.max(0,(255&g)-Math.round(51))].map(e=>e.toString(16).padStart(2,"0")).join(""),h=e.replace(/^[~@+.]+/,"").charAt(0).toUpperCase(),u=Math.round(.44*n),m=!!p?.match(/\.gif($|\?)/i);if(i)b=void 0;else if(s&&r[s]){let e=r[s];b=`0 0 0 2px var(--bg-deep), 0 0 0 4px ${e}`}let w=c?"🔕":o?"🔇":null;return(0,t.jsxs)("span",{className:["av-wrap",i?"av-speaking":"",l?"av-animated":"",f].filter(Boolean).join(" "),style:{width:n,height:n},"aria-label":s?`${e}, ${s}`:e,children:[(0,t.jsx)("span",{className:"av-inner",style:{background:p?"transparent":`linear-gradient(135deg, ${x}, ${v})`,width:n,height:n,fontSize:u,boxShadow:i?void 0:b},children:p?(0,t.jsx)("img",{src:p,className:`av-img${m?" av-img--animated":""}`,loading:m?"eager":"lazy",decoding:"async",alt:e}):h}),m&&(0,t.jsx)("span",{className:"av-gif-badge","aria-label":"Animated avatar",children:"GIF"}),w&&(0,t.jsx)("span",{className:"av-overlay","aria-hidden":!0,children:w}),s&&r[s]&&(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)("span",{className:`av-status-dot av-status-dot--${s}`,"aria-hidden":!0,style:{background:r[s],width:Math.max(8,Math.round(.26*n)),height:Math.max(8,Math.round(.26*n))}}),(0,t.jsx)("span",{className:"sr-only",children:s})]}),d&&(0,t.jsx)("span",{className:"av-tooltip",role:"tooltip",children:e}),(0,t.jsx)("style",{children:`
        .av-wrap {
          position: relative;
          display: inline-flex;
          flex-shrink: 0;
          border-radius: 50%;
          transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .av-wrap:hover {
          transform: scale(1.04);
        }

        .av-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.92);
          letter-spacing: 0.02em;
          user-select: none;
          transition: box-shadow 0.15s ease;
        }

        /* ── Speaking ring ──────────────────────────────────────── */
        .av-speaking .av-inner {
          animation: av-speaking-pulse 1.4s ease-in-out infinite;
        }

        @keyframes av-speaking-pulse {
          0%, 100% {
            box-shadow:
              0 0 0 2px var(--bg-deep, #06101d),
              0 0 0 4px var(--accent, #0ea5e9),
              0 0 0 6px rgba(14, 165, 233, 0.25);
          }
          50% {
            box-shadow:
              0 0 0 2px var(--bg-deep, #06101d),
              0 0 0 5px var(--accent, #0ea5e9),
              0 0 0 10px rgba(14, 165, 233, 0.4);
          }
        }

        /* ── Entrance animation ─────────────────────────────────── */
        .av-animated .av-inner {
          animation: av-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes av-pop {
          0%   { transform: scale(0.7); opacity: 0; }
          70%  { transform: scale(1.08); }
          100% { transform: scale(1); opacity: 1; }
        }

        /* Speaking + animated: speaking wins after entrance completes */
        .av-animated.av-speaking .av-inner {
          animation:
            av-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both,
            av-speaking-pulse 1.4s ease-in-out 0.35s infinite;
        }

        /* ── Image avatar ───────────────────────────────────────── */
        .av-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
          display: block;
        }

        .av-img--animated {
          /* Ensure GIFs play — don't apply grayscale or other filters */
          filter: none !important;
        }

        /* ── Status indicator dot ─────────────────────────────────── */
        .av-status-dot {
          position: absolute;
          bottom: -1px;
          right: -1px;
          border-radius: 50%;
          border: 2px solid var(--bg-void, #030810);
          transition: background 300ms ease, box-shadow 300ms ease;
          pointer-events: none;
          z-index: 2;
        }
        .av-status-dot--online {
          box-shadow: 0 0 0 0 rgba(35, 165, 90, 0.4);
          animation: av-online-pulse 2.5s ease-in-out infinite;
        }
        @keyframes av-online-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(35, 165, 90, 0.4); }
          50%       { box-shadow: 0 0 0 3px rgba(35, 165, 90, 0); }
        }
        .av-status-dot--offline { opacity: 0.5; }

        /* ── GIF badge ──────────────────────────────────────────── */
        .av-gif-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          font-size: 8px;
          background: var(--gold, #67e8f9);
          color: #000;
          border-radius: 3px;
          padding: 1px 3px;
          font-weight: 700;
          line-height: 1;
          pointer-events: none;
          z-index: 1;
        }

        /* ── Overlay badge (mute/deafen) ────────────────────────── */
        .av-overlay {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--bg-deep, #06101d);
          border: 1.5px solid var(--bg-deep, #06101d);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 8px;
          line-height: 1;
        }

        /* ── Tooltip ────────────────────────────────────────────── */
        .av-tooltip {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-elevated, #132131);
          border: 1px solid var(--border-normal, rgba(14,165,233,0.15));
          padding: 4px 9px;
          border-radius: 6px;
          white-space: nowrap;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-primary, #dff0ff);
          pointer-events: none;
          opacity: 0;
          transition: opacity 120ms ease;
          z-index: 50;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        }

        .av-wrap:hover .av-tooltip {
          opacity: 1;
        }
      `})]})}],1544)},15312,e=>{"use strict";let t={0:"#ffffff",1:"#000000",2:"#00007f",3:"#009300",4:"#ff0000",5:"#7f0000",6:"#9c009c",7:"#fc7f00",8:"#ffff00",9:"#00fc00",10:"#009393",11:"#00ffff",12:"#0000fc",13:"#ff00ff",14:"#7f7f7f",15:"#d2d2d2",16:"#470000",17:"#472100",18:"#474700",19:"#324700",20:"#004700",21:"#00472c",22:"#004747",23:"#002747",24:"#000047",25:"#2e0047",26:"#470047",27:"#47002a",28:"#740000",29:"#743a00",30:"#747400",31:"#517400",32:"#007400",33:"#007449",34:"#007474",35:"#004074",36:"#000074",37:"#4b0074",38:"#740074",39:"#740045",40:"#b50000",41:"#b56300",42:"#b5b500",43:"#7db500",44:"#00b500",45:"#00b571",46:"#00b5b5",47:"#0063b5",48:"#0000b5",49:"#7500b5",50:"#b500b5",51:"#b5006b",52:"#ff0000",53:"#ff8c00",54:"#ffff00",55:"#b2ff00",56:"#00ff00",57:"#00ffa0",58:"#00ffff",59:"#008cff",60:"#0000ff",61:"#a500ff",62:"#ff00ff",63:"#ff0098",64:"#ff5959",65:"#ffb459",66:"#ffff71",67:"#cfff60",68:"#6fff6f",69:"#65ffc9",70:"#6dffff",71:"#59b4ff",72:"#5959ff",73:"#c459ff",74:"#ff66ff",75:"#ff59bc",76:"#ff9c9c",77:"#ffd39c",78:"#ffff9c",79:"#e2ff9c",80:"#9cff9c",81:"#9cffdb",82:"#9cffff",83:"#9cd3ff",84:"#9c9cff",85:"#dc9cff",86:"#ff9cff",87:"#ff94d3",88:"#000000",89:"#131313",90:"#282828",91:"#363636",92:"#4d4d4d",93:"#656565",94:"#818181",95:"#9f9f9f",96:"#bcbcbc",97:"#e2e2e2",98:"#ffffff"};function a(e){return{...e}}function r(){return{bold:!1,italic:!1,underline:!1,strike:!1,monospace:!1,fg:void 0,bg:void 0}}e.s(["hasIrcFormatting",0,function(e){return/[\x02\x03\x04\x0f\x11\x16\x1d\x1e\x1f]/.test(e)},"parseIrcFormatting",0,function(e){let n=[],s=r(),i="",o=0,c=()=>{if(i.length>0){var e;n.push({text:i,...{bold:(e=s).bold||void 0,italic:e.italic||void 0,underline:e.underline||void 0,strike:e.strike||void 0,monospace:e.monospace||void 0,fg:e.fg,bg:e.bg}}),i=""}};for(;o<e.length;){let n=e[o];switch(e.charCodeAt(o)){case 2:c(),(s=a(s)).bold=!s.bold,o++;break;case 29:c(),(s=a(s)).italic=!s.italic,o++;break;case 31:c(),(s=a(s)).underline=!s.underline,o++;break;case 30:c(),(s=a(s)).strike=!s.strike,o++;break;case 17:c(),(s=a(s)).monospace=!s.monospace,o++;break;case 22:{c();let e=(s=a(s)).fg;s.fg=s.bg,s.bg=e,o++;break}case 15:c(),s=r(),o++;break;case 3:{c(),s=a(s);let r="";++o<e.length&&/\d/.test(e[o])&&(r+=e[o++],o<e.length&&/\d/.test(e[o])&&(r+=e[o++]));let n="";(o<e.length&&","===e[o]&&(++o<e.length&&/\d/.test(e[o])?(n+=e[o++],o<e.length&&/\d/.test(e[o])&&(n+=e[o++])):o--),""===r&&""===n)?(s.fg=void 0,s.bg=void 0):(""!==r&&(s.fg=t[parseInt(r,10)]),""!==n&&(s.bg=t[parseInt(n,10)]));break}case 4:{c(),s=a(s),o++;let t=e.slice(o,o+6);/^[0-9a-fA-F]{6}$/.test(t)&&(s.fg=`#${t}`,o+=6);break}default:i+=n,o++}}return c(),function(e){let t=[];for(let a of e){if(0===t.length){t.push(a);continue}let e=t[t.length-1];e.bold===a.bold&&e.italic===a.italic&&e.underline===a.underline&&e.strike===a.strike&&e.monospace===a.monospace&&e.fg===a.fg&&e.bg===a.bg?t[t.length-1]={...e,text:e.text+a.text}:t.push(a)}return t}(n)},"stripIrcFormatting",0,function(e){return e.replace(/\x01ACTION (.+)\x01/,"* $1").replace(/\x03\d{1,2}(,\d{1,2})?/g,"").replace(/\x04[0-9a-fA-F]{6}/g,"").replace(/[\x02\x0f\x11\x16\x1d\x1e\x1f]/g,"")}])},93178,e=>{e.v(t=>Promise.all(["static/chunks/15.w7ws5p2~w-.js"].map(t=>e.l(t))).then(()=>t(11544)))},85962,e=>{e.v(t=>Promise.all(["static/chunks/0~40~uijbgffd.js"].map(t=>e.l(t))).then(()=>t(12441)))},24146,e=>{e.v(t=>Promise.all(["static/chunks/09emo.uev~-_s.js"].map(t=>e.l(t))).then(()=>t(13437)))}]);