(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,15427,e=>{"use strict";var r=e.i(30152),a=e.i(93737),t=e.i(79239);let o=["Just Chatting","Music","Art & Design","Gaming","Programming","Science & Tech","Talk","Sports","Cooking","Education","Travel","ASMR","Special Event"],l=()=>(0,r.jsx)("svg",{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",children:(0,r.jsx)("path",{d:"M1 1l12 12M13 1L1 13"})}),n=()=>(0,r.jsxs)("svg",{width:"22",height:"22",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M23 7l-7 5 7 5V7z"}),(0,r.jsx)("rect",{x:"1",y:"5",width:"15",height:"14",rx:"2",ry:"2"})]}),i=()=>(0,r.jsxs)("svg",{width:"22",height:"22",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("rect",{x:"2",y:"3",width:"20",height:"14",rx:"2",ry:"2"}),(0,r.jsx)("line",{x1:"8",y1:"21",x2:"16",y2:"21"}),(0,r.jsx)("line",{x1:"12",y1:"17",x2:"12",y2:"21"})]}),s=()=>(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"}),(0,r.jsx)("circle",{cx:"12",cy:"12",r:"3"})]}),c=()=>(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"}),(0,r.jsx)("line",{x1:"1",y1:"1",x2:"23",y2:"23"})]});e.s(["GoLiveModal",0,function({channel:e,onClose:d}){let m=(0,t.useOnyxStore)(e=>e.startStream),[g,p]=(0,a.useState)(""),[x,u]=(0,a.useState)("Just Chatting"),[b,h]=(0,a.useState)(""),[v,y]=(0,a.useState)(!1),[f,k]=(0,a.useState)("camera"),[j,w]=(0,a.useState)("4k60"),[N,C]=(0,a.useState)(""),[S,z]=(0,a.useState)(!1),L=(0,a.useRef)(null),A="glm-heading";(0,a.useEffect)(()=>{L.current?.focus()},[]),(0,a.useEffect)(()=>{let e=e=>{"Escape"===e.key&&d()};return document.addEventListener("keydown",e),()=>document.removeEventListener("keydown",e)},[d]);let E=v?b:x,M=g.trim().length>0&&E.trim().length>0,T=()=>{M&&(m(e,g.trim(),E.trim(),f,N||void 0,j),d())};return(0,r.jsxs)("div",{className:"glm-backdrop",onClick:e=>{e.target===e.currentTarget&&d()},role:"dialog","aria-modal":"true","aria-labelledby":A,children:[(0,r.jsxs)("div",{className:"glm-modal",children:[(0,r.jsxs)("div",{className:"glm-header",children:[(0,r.jsxs)("div",{className:"glm-header-left",children:[(0,r.jsx)("span",{className:"glm-live-dot","aria-hidden":"true"}),(0,r.jsxs)("div",{children:[(0,r.jsx)("h2",{id:A,className:"glm-title",children:"Go Live"}),(0,r.jsx)("p",{className:"glm-channel-name",children:e})]})]}),(0,r.jsx)("button",{className:"glm-close",onClick:d,"aria-label":"Close",children:(0,r.jsx)(l,{})})]}),(0,r.jsxs)("div",{className:"glm-body",children:[(0,r.jsx)("label",{className:"glm-label",htmlFor:"glm-title-input",children:"Stream Title"}),(0,r.jsx)("input",{id:"glm-title-input",ref:L,className:"glm-input",value:g,onChange:e=>p(e.target.value.slice(0,140)),placeholder:"What are you streaming today?",maxLength:140,onKeyDown:e=>{"Enter"===e.key&&M&&T()},autoComplete:"off",spellCheck:!1}),(0,r.jsxs)("div",{className:"glm-counter","aria-live":"polite","aria-atomic":"true",children:[g.length," / 140"]}),(0,r.jsx)("label",{className:"glm-label",children:"Category"}),(0,r.jsxs)("div",{className:"glm-cat-grid",role:"group","aria-label":"Stream category",children:[o.map(e=>(0,r.jsx)("button",{type:"button",className:`glm-cat-chip${!v&&x===e?" glm-cat-chip--active":""}`,onClick:()=>{u(e),y(!1)},"aria-pressed":!v&&x===e,children:e},e)),(0,r.jsx)("button",{type:"button",className:`glm-cat-chip${v?" glm-cat-chip--active":""}`,onClick:()=>y(!0),"aria-pressed":v,children:"Custom…"})]}),v&&(0,r.jsx)("input",{className:"glm-input glm-input--sm",value:b,onChange:e=>h(e.target.value.slice(0,80)),placeholder:"Enter category name","aria-label":"Custom category name",autoFocus:!0}),(0,r.jsx)("label",{className:"glm-label",children:"Source"}),(0,r.jsxs)("div",{className:"glm-source-row",role:"group","aria-label":"Stream source",children:[(0,r.jsxs)("button",{type:"button",className:`glm-source-card${"camera"===f?" glm-source-card--active":""}`,onClick:()=>k("camera"),"aria-pressed":"camera"===f,children:[(0,r.jsx)(n,{}),(0,r.jsx)("span",{children:"Camera"})]}),(0,r.jsxs)("button",{type:"button",className:`glm-source-card${"screen"===f?" glm-source-card--active":""}`,onClick:()=>k("screen"),"aria-pressed":"screen"===f,children:[(0,r.jsx)(i,{}),(0,r.jsx)("span",{children:"Screen Share"})]})]}),(0,r.jsx)("label",{className:"glm-label",children:"Quality"}),(0,r.jsx)("div",{className:"glm-quality-row",role:"group","aria-label":"Stream quality",children:[["4k60","4K 60"],["1080p60","1080p 60"],["auto","Auto"]].map(([e,a])=>(0,r.jsx)("button",{type:"button",className:`glm-quality-chip${j===e?" glm-quality-chip--active":""}`,onClick:()=>w(e),"aria-pressed":j===e,children:a},e))}),(0,r.jsxs)("details",{className:"glm-advanced",children:[(0,r.jsx)("summary",{className:"glm-advanced-toggle",children:"Advanced"}),(0,r.jsxs)("div",{className:"glm-advanced-body",children:[(0,r.jsxs)("label",{className:"glm-label",htmlFor:"glm-stream-key",children:["Stream Key ",(0,r.jsx)("span",{className:"glm-optional",children:"(optional)"})]}),(0,r.jsxs)("div",{className:"glm-key-wrap",children:[(0,r.jsx)("input",{id:"glm-stream-key",className:"glm-input",type:S?"text":"password",value:N,onChange:e=>C(e.target.value),placeholder:"Stream key for external encoder",autoComplete:"off"}),(0,r.jsx)("button",{type:"button",className:"glm-key-toggle",onClick:()=>z(e=>!e),"aria-label":S?"Hide stream key":"Show stream key",children:S?(0,r.jsx)(c,{}):(0,r.jsx)(s,{})})]})]})]})]}),(0,r.jsxs)("div",{className:"glm-footer",children:[(0,r.jsx)("button",{className:"glm-btn-cancel",type:"button",onClick:d,children:"Cancel"}),(0,r.jsxs)("button",{className:`glm-btn-live${M?"":" glm-btn-live--disabled"}`,type:"button",onClick:T,disabled:!M,"aria-disabled":!M,children:[(0,r.jsx)("span",{className:"glm-live-dot glm-live-dot--btn","aria-hidden":"true"}),"Go Live"]})]})]}),(0,r.jsx)("style",{children:`
        .glm-backdrop {
          position: fixed;
          inset: 0;
          z-index: 900;
          background: rgba(3, 8, 16, 0.82);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(6px);
          animation: glm-fade-in 160ms ease-out;
        }
        @keyframes glm-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .glm-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: 16px;
          width: 100%;
          max-width: 460px;
          box-shadow: var(--shadow-xl);
          animation: glm-scale-in 180ms cubic-bezier(0.16,1,0.3,1);
          overflow: hidden;
        }
        @keyframes glm-scale-in {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* Header */
        .glm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 18px;
          border-bottom: 1px solid var(--border-subtle);
          background: linear-gradient(135deg, var(--accent-subtle) 0%, transparent 60%);
        }
        .glm-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .glm-live-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #e63946;
          box-shadow: 0 0 0 3px rgba(230,57,70,0.22), 0 0 8px rgba(230,57,70,0.5);
          flex-shrink: 0;
          animation: glm-pulse 2s ease-in-out infinite;
        }
        .glm-live-dot--btn {
          width: 8px;
          height: 8px;
          animation: none;
          box-shadow: 0 0 6px rgba(230,57,70,0.6);
        }
        @keyframes glm-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 3px rgba(230,57,70,0.22), 0 0 8px rgba(230,57,70,0.5); }
          50% { opacity: 0.85; box-shadow: 0 0 0 5px rgba(230,57,70,0.12), 0 0 12px rgba(230,57,70,0.6); }
        }
        .glm-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.01em;
        }
        .glm-channel-name {
          font-size: 12px;
          color: var(--text-muted);
          margin: 1px 0 0;
          font-weight: 500;
        }
        .glm-close {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          transition: background 120ms, color 120ms;
        }
        .glm-close:hover { background: var(--bg-overlay); color: var(--text-primary); }

        /* Body */
        .glm-body {
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .glm-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-top: 12px;
          margin-bottom: 6px;
          display: block;
        }
        .glm-label:first-child { margin-top: 0; }
        .glm-input {
          width: 100%;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 14px;
          color: var(--text-primary);
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: border-color 150ms, box-shadow 150ms;
        }
        .glm-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }
        .glm-input--sm { margin-top: 6px; }
        .glm-counter {
          font-size: 11px;
          color: var(--text-muted);
          text-align: right;
          margin-top: 3px;
          font-variant-numeric: tabular-nums;
        }
        .glm-optional { font-weight: 400; color: var(--text-muted); opacity: 0.7; }

        /* Category chips */
        .glm-cat-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .glm-cat-chip {
          padding: 4px 10px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: inherit;
          transition: border-color 120ms, background 120ms, color 120ms;
        }
        .glm-cat-chip:hover {
          border-color: var(--accent-border);
          color: var(--text-primary);
          background: var(--accent-subtle);
        }
        .glm-cat-chip--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
        }

        /* Source cards */
        .glm-source-row {
          display: flex;
          gap: 10px;
        }
        .glm-source-card {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 14px 10px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 10px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          font-family: inherit;
          transition: border-color 150ms, background 150ms, color 150ms;
        }
        .glm-source-card:hover {
          border-color: var(--accent-border);
          color: var(--text-primary);
          background: var(--accent-subtle);
        }
        .glm-source-card--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-glow);
        }
        .glm-quality-row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 16px;
        }
        .glm-quality-chip {
          min-width: 0;
          height: 38px;
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          background: var(--bg-overlay);
          color: var(--text-secondary);
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: border-color 150ms, background 150ms, color 150ms;
        }
        .glm-quality-chip:hover {
          border-color: var(--accent-border);
          color: var(--text-primary);
          background: var(--accent-subtle);
        }
        .glm-quality-chip--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-glow);
        }

        /* Advanced */
        .glm-advanced { margin-top: 8px; }
        .glm-advanced-toggle {
          font-size: 12px;
          color: var(--text-muted);
          cursor: pointer;
          list-style: none;
          user-select: none;
          transition: color 120ms;
        }
        .glm-advanced-toggle::-webkit-details-marker { display: none; }
        .glm-advanced-toggle::before { content: '▸ '; }
        details[open] .glm-advanced-toggle::before { content: '▾ '; }
        .glm-advanced-toggle:hover { color: var(--text-secondary); }
        .glm-advanced-body { margin-top: 10px; }
        .glm-key-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .glm-key-wrap .glm-input { padding-right: 40px; }
        .glm-key-toggle {
          position: absolute;
          right: 10px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          padding: 2px;
          transition: color 120ms;
        }
        .glm-key-toggle:hover { color: var(--text-secondary); }

        /* Footer */
        .glm-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 24px 18px;
          border-top: 1px solid var(--border-subtle);
        }
        .glm-btn-cancel {
          padding: 8px 18px;
          background: none;
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: inherit;
          transition: border-color 120ms, color 120ms, background 120ms;
        }
        .glm-btn-cancel:hover {
          border-color: var(--border-normal);
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
        .glm-btn-live {
          padding: 8px 20px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          cursor: pointer;
          font-family: inherit;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: opacity 150ms, box-shadow 150ms;
          box-shadow: 0 4px 16px var(--accent-glow);
        }
        .glm-btn-live:hover:not(.glm-btn-live--disabled) {
          opacity: 0.92;
          box-shadow: 0 6px 20px rgba(14,165,233,0.4);
        }
        .glm-btn-live--disabled {
          background: var(--bg-overlay);
          color: var(--text-muted);
          cursor: not-allowed;
          box-shadow: none;
        }
        .glm-btn-live--disabled .glm-live-dot--btn {
          background: var(--text-muted);
          box-shadow: none;
        }
      `})]})}])},13437,e=>{e.n(e.i(15427))}]);