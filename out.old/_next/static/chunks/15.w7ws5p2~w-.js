(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,58615,e=>{"use strict";var r=e.i(30152),t=e.i(93737),o=e.i(79239);function a(e){try{let r="ocean-stream-clips",t=JSON.parse(localStorage.getItem(r)??"[]"),o=[e,...t].slice(0,50);localStorage.setItem(r,JSON.stringify(o))}catch{}}function i(e){if(e<3600){let r=String(Math.floor(e/60)).padStart(2,"0"),t=String(e%60).padStart(2,"0");return`${r}:${t}`}let r=Math.floor(e/3600),t=String(Math.floor(e%3600/60)).padStart(2,"0"),o=String(e%60).padStart(2,"0");return`${r}:${t}:${o}`}function n({channel:e}){let d=(0,o.useOnyxStore)(e=>e.streams).get(e.toLowerCase()),c=(0,o.useOnyxStore)(e=>e.ourNick),[p,x]=(0,t.useState)(()=>d?.live?Math.floor(Date.now()/1e3)-d.startedAt:0),[u,b]=(0,t.useState)(!1),m=(0,t.useRef)(p);(0,t.useEffect)(()=>{m.current=p},[p]);let h=!!(d?.streamer&&c&&d.streamer.toLowerCase()===c.toLowerCase()),g=d?.live??!1,v=d?.startedAt??0;(0,t.useEffect)(()=>{if(!g)return;let e=setInterval(()=>{x(Math.floor(Date.now()/1e3)-v)},1e3);return()=>clearInterval(e)},[g,v]);let f=d?.channel??"",w=d?.title??"";return((0,t.useEffect)(()=>{if(!g||!h)return;let e=e=>{if("c"!==e.key&&"C"!==e.key)return;let r=document.activeElement?.tagName?.toLowerCase();"input"===r||"textarea"===r||document.activeElement?.isContentEditable||u||(a({id:`${Date.now()}`,channel:f,title:w,timestamp:Date.now(),elapsed:m.current}),b(!0),setTimeout(()=>b(!1),2e3))};return window.addEventListener("keydown",e),()=>window.removeEventListener("keydown",e)},[g,f,w,h,u]),d?.live)?(0,r.jsxs)("div",{className:"sovl-root",children:[(0,r.jsx)("div",{className:"sovl-gradient-top","aria-hidden":"true"}),(0,r.jsxs)("div",{className:"sovl-bar",children:[(0,r.jsx)("span",{className:"sovl-live-badge","aria-label":"Live",children:"LIVE"}),(0,r.jsx)("span",{className:"sovl-title",children:d.title}),d.category&&(0,r.jsx)("span",{className:"sovl-category",children:d.category}),(0,r.jsx)("div",{className:"sovl-spacer","aria-hidden":"true"}),h&&(0,r.jsx)("button",{className:"sovl-clip-btn",onClick:()=>{u||(a({id:`${Date.now()}`,channel:d.channel,title:d.title,timestamp:Date.now(),elapsed:p}),b(!0),setTimeout(()=>b(!1),2e3))},"aria-label":u?"Clip saved":"Save stream clip (C)",title:u?"Clip saved!":"Save clip (C)",children:u?(0,r.jsx)("span",{style:{color:"var(--gold)"},children:"✓ Saved"}):(0,r.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M6.13 1L6 16a2 2 0 0 0 2 2h15"}),(0,r.jsx)("path",{d:"M1 6.13L16 6a2 2 0 0 1 2 2v15"})]})}),(0,r.jsxs)("span",{className:"sovl-viewers","aria-label":`${d.viewers} viewers`,children:[(0,r.jsx)(s,{}),d.viewers]}),(0,r.jsxs)("span",{className:"sovl-uptime","aria-label":`Uptime ${i(p)}`,children:[(0,r.jsx)(l,{}),i(p)]})]}),(0,r.jsx)("style",{children:`
        .sovl-root {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          pointer-events: none;
          z-index: 10;
        }
        .sovl-gradient-top {
          height: 64px;
          background: linear-gradient(to bottom, rgba(3,8,16,0.85) 0%, transparent 100%);
        }
        .sovl-bar {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
        }
        .sovl-live-badge {
          background: #e63946;
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.1em;
          padding: 3px 8px;
          border-radius: 999px;
          flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(230,57,70,0.5);
          animation: sovl-live-pulse 2s ease-in-out infinite;
        }
        @keyframes sovl-live-pulse {
          0%, 100% { box-shadow: 0 2px 8px rgba(230,57,70,0.5); }
          50%       { box-shadow: 0 2px 14px rgba(230,57,70,0.75); }
        }
        .sovl-title {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 200px;
          text-shadow: 0 1px 4px rgba(0,0,0,0.6);
        }
        .sovl-category {
          font-size: 11px;
          font-weight: 500;
          color: rgba(255,255,255,0.7);
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 999px;
          padding: 2px 8px;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .sovl-spacer { flex: 1; }
        .sovl-viewers,
        .sovl-uptime {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
          color: rgba(255,255,255,0.85);
          font-variant-numeric: tabular-nums;
          background: rgba(0,0,0,0.3);
          border-radius: 999px;
          padding: 3px 9px;
        }
        .sovl-clip-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: 999px;
          color: var(--text-primary);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          pointer-events: auto;
          transition: background 0.15s;
          font-family: inherit;
        }
        .sovl-clip-btn:hover {
          background: var(--accent-glow);
        }
      `})]}):null}let s=()=>(0,r.jsxs)("svg",{width:"12",height:"12",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"}),(0,r.jsx)("circle",{cx:"12",cy:"12",r:"3"})]}),l=()=>(0,r.jsxs)("svg",{width:"11",height:"11",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("circle",{cx:"12",cy:"12",r:"10"}),(0,r.jsx)("polyline",{points:"12 6 12 12 16 14"})]});function d({channel:e}){let a=(0,o.useOnyxStore)(e=>e.raids).get(e.toLowerCase()),i=(0,t.useRef)(null),[n,s]=(0,t.useState)(!1),[l,c]=(0,t.useState)(!1);return((0,t.useEffect)(()=>{if(!a||a.timestamp===i.current)return;i.current=a.timestamp,c(!1),s(!0);let e=setTimeout(()=>c(!0),11600),r=setTimeout(()=>{s(!1),c(!1)},12e3);return()=>{clearTimeout(e),clearTimeout(r)}},[a]),n&&a)?(0,r.jsxs)("div",{className:`raid-root${l?" raid-root--leaving":""}`,"aria-live":"assertive","aria-atomic":"true",children:[(0,r.jsxs)("div",{className:"raid-card",children:[(0,r.jsx)("div",{className:"raid-label",children:"INCOMING RAID"}),(0,r.jsx)("div",{className:"raid-nick",children:a.raider}),(0,r.jsxs)("div",{className:"raid-sub",children:["from ",a.from,a.viewers>0&&` with ${a.viewers} viewer${1===a.viewers?"":"s"}`]})]}),(0,r.jsx)("style",{children:`
        .raid-root {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 20;
        }
        .raid-root--leaving .raid-card {
          animation: raid-exit 400ms cubic-bezier(0.7,0,0.84,0) forwards;
        }
        .raid-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 24px 36px;
          background: rgba(6, 16, 29, 0.92);
          border: 1px solid rgba(103, 232, 249, 0.3);
          border-radius: 16px;
          backdrop-filter: blur(16px);
          box-shadow: 0 0 0 1px rgba(103,232,249,0.10), 0 24px 64px rgba(0,0,0,0.75);
          animation: raid-entrance 400ms cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes raid-entrance {
          from { opacity: 0; transform: scale(0.88); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes raid-exit {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(0.92); }
        }
        .raid-label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 4px;
        }
        .raid-nick {
          font-size: 32px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -0.02em;
          text-shadow: 0 0 20px rgba(103,232,249,0.6), 0 0 40px rgba(103,232,249,0.3);
          line-height: 1.1;
        }
        .raid-sub {
          font-size: 13px;
          color: rgba(255,255,255,0.6);
          font-weight: 500;
        }
      `})]}):null}function c({channel:e}){let a=(0,o.useOnyxStore)(e=>e.streamPolls),i=(0,o.useOnyxStore)(e=>e.voteStreamPoll),n=a.get(e.toLowerCase()),[s,l]=(0,t.useState)(null);if((0,t.useEffect)(()=>{if(!n?.active||!n.endsAt)return;let e=n.endsAt,r=setTimeout(()=>l(e),Math.max(0,e-Date.now()));return()=>clearTimeout(r)},[n?.active,n?.endsAt]),!n||!n.active||s===n.endsAt)return null;let d=n.votes.reduce((e,r)=>e+r,0);return(0,r.jsxs)("div",{className:"pw-root",role:"group","aria-label":`Poll: ${n.question}`,children:[(0,r.jsx)("div",{className:"pw-question",children:n.question}),(0,r.jsx)("div",{className:"pw-options",children:n.options.map((t,o)=>{let a=d>0?Math.round((n.votes[o]??0)/d*100):0,s=n.myVote===o,l=null!==n.myVote;return(0,r.jsxs)("button",{className:`pw-option${s?" pw-option--voted":""}${l?" pw-option--locked":""}`,onClick:()=>{null===n.myVote&&i(e,o)},disabled:l,type:"button","aria-pressed":s,"aria-label":`${t} — ${a}%`,children:[(0,r.jsx)("div",{className:"pw-option-bar",style:{width:`${a}%`},"aria-hidden":"true"}),(0,r.jsx)("span",{className:"pw-option-label",children:t}),(0,r.jsxs)("span",{className:"pw-option-pct","aria-hidden":"true",children:[a,"%"]})]},o)})}),(0,r.jsxs)("div",{className:"pw-footer","aria-live":"polite","aria-atomic":"true",children:[d," vote",1===d?"":"s"]}),(0,r.jsx)("style",{children:`
        .pw-root {
          background: rgba(6,16,29,0.82);
          border: 1px solid var(--border-normal);
          border-radius: 10px;
          backdrop-filter: blur(10px);
          padding: 12px 14px;
          min-width: 200px;
          max-width: 280px;
        }
        .pw-question {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 8px;
          line-height: 1.4;
        }
        .pw-options {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .pw-option {
          position: relative;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px;
          cursor: pointer;
          overflow: hidden;
          text-align: left;
          font-family: inherit;
          transition: border-color 150ms;
        }
        .pw-option:hover:not(.pw-option--locked) {
          border-color: var(--accent-border);
        }
        .pw-option--voted {
          border-color: var(--accent);
        }
        .pw-option--locked { cursor: default; }
        .pw-option-bar {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          background: var(--accent-subtle);
          transition: width 400ms cubic-bezier(0.16,1,0.3,1);
          pointer-events: none;
        }
        .pw-option--voted .pw-option-bar { background: var(--accent-glow); }
        .pw-option-label {
          position: relative;
          font-size: 12px;
          font-weight: 500;
          color: rgba(255,255,255,0.85);
          flex: 1;
          z-index: 1;
        }
        .pw-option-pct {
          position: relative;
          font-size: 11px;
          font-weight: 700;
          color: rgba(255,255,255,0.5);
          font-variant-numeric: tabular-nums;
          z-index: 1;
          flex-shrink: 0;
        }
        .pw-option--voted .pw-option-pct { color: var(--accent); }
        .pw-footer {
          font-size: 10px;
          color: rgba(255,255,255,0.35);
          margin-top: 7px;
          font-variant-numeric: tabular-nums;
        }
      `})]})}let p=[{label:"30s",value:30},{label:"1m",value:60},{label:"2m",value:120},{label:"5m",value:300}];function x({channel:e,onClose:a}){let i=(0,o.useOnyxStore)(e=>e.createStreamPoll),[n,s]=(0,t.useState)(""),[l,d]=(0,t.useState)(["",""]),[c,u]=(0,t.useState)(60),b="pcm-heading";(0,t.useEffect)(()=>{let e=e=>{"Escape"===e.key&&a()};return document.addEventListener("keydown",e),()=>document.removeEventListener("keydown",e)},[a]);let m=l.filter(e=>e.trim()),h=n.trim().length>0&&m.length>=2;return(0,r.jsxs)("div",{className:"pcm-backdrop",onClick:e=>{e.target===e.currentTarget&&a()},role:"dialog","aria-modal":"true","aria-labelledby":b,children:[(0,r.jsxs)("div",{className:"pcm-modal",children:[(0,r.jsxs)("div",{className:"pcm-header",children:[(0,r.jsx)("h3",{id:b,className:"pcm-title",children:"Create Poll"}),(0,r.jsx)("button",{className:"pcm-close",onClick:a,"aria-label":"Close",children:(0,r.jsx)("svg",{width:"11",height:"11",viewBox:"0 0 10 10",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M1.5 1.5l7 7M8.5 1.5l-7 7"})})})]}),(0,r.jsxs)("div",{className:"pcm-body",children:[(0,r.jsx)("label",{className:"pcm-label",htmlFor:"pcm-question",children:"Question"}),(0,r.jsx)("input",{id:"pcm-question",className:"pcm-input",value:n,onChange:e=>s(e.target.value.slice(0,120)),placeholder:"Ask your viewers...",autoFocus:!0}),(0,r.jsxs)("label",{className:"pcm-label",children:["Options ",(0,r.jsx)("span",{className:"pcm-hint",children:"(2–4)"})]}),l.map((e,t)=>(0,r.jsxs)("div",{className:"pcm-opt-row",children:[(0,r.jsx)("input",{className:"pcm-input",value:e,onChange:e=>{var r;return r=e.target.value.slice(0,60),void d(e=>e.map((e,o)=>o===t?r:e))},placeholder:`Option ${t+1}`,"aria-label":`Poll option ${t+1}`}),l.length>2&&(0,r.jsx)("button",{className:"pcm-opt-remove",type:"button",onClick:()=>{!(l.length<=2)&&d(e=>e.filter((e,r)=>r!==t))},"aria-label":`Remove option ${t+1}`,children:(0,r.jsx)("svg",{width:"10",height:"10",viewBox:"0 0 10 10",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M1.5 1.5l7 7M8.5 1.5l-7 7"})})})]},t)),l.length<4&&(0,r.jsx)("button",{className:"pcm-add-opt",type:"button",onClick:()=>{l.length<4&&d(e=>[...e,""])},children:"+ Add option"}),(0,r.jsx)("label",{className:"pcm-label",children:"Duration"}),(0,r.jsx)("div",{className:"pcm-dur-row",role:"group","aria-label":"Poll duration",children:p.map(e=>(0,r.jsx)("button",{type:"button",className:`pcm-dur-btn${c===e.value?" pcm-dur-btn--active":""}`,onClick:()=>u(e.value),"aria-pressed":c===e.value,children:e.label},e.value))})]}),(0,r.jsxs)("div",{className:"pcm-footer",children:[(0,r.jsx)("button",{className:"pcm-btn-cancel",type:"button",onClick:a,children:"Cancel"}),(0,r.jsx)("button",{className:`pcm-btn-create${h?"":" pcm-btn-create--disabled"}`,type:"button",onClick:()=>{h&&(i(e,n.trim(),m,c),a())},disabled:!h,"aria-disabled":!h,children:"Create Poll"})]})]}),(0,r.jsx)("style",{children:`
        .pcm-backdrop {
          position: fixed; inset: 0; z-index: 910;
          background: rgba(3,8,16,0.75);
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(4px);
          animation: pcm-fade 150ms ease-out;
        }
        @keyframes pcm-fade { from { opacity: 0; } to { opacity: 1; } }
        .pcm-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: 14px;
          width: 100%; max-width: 400px;
          box-shadow: var(--shadow-xl);
          animation: pcm-scale 180ms cubic-bezier(0.16,1,0.3,1);
          overflow: hidden;
        }
        @keyframes pcm-scale {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .pcm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px 14px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .pcm-title {
          font-size: 15px; font-weight: 700;
          color: var(--text-primary); margin: 0;
        }
        .pcm-close {
          background: none; border: none; cursor: pointer;
          color: var(--text-muted); font-size: 14px; line-height: 1;
          padding: 4px; border-radius: 4px;
          transition: color 120ms;
        }
        .pcm-close:hover { color: var(--text-secondary); }
        .pcm-body {
          padding: 16px 20px;
          display: flex; flex-direction: column; gap: 4px;
        }
        .pcm-label {
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.07em; text-transform: uppercase;
          color: var(--text-muted);
          margin-top: 10px; margin-bottom: 6px; display: block;
        }
        .pcm-label:first-child { margin-top: 0; }
        .pcm-hint {
          font-weight: 400; text-transform: none; letter-spacing: 0;
          color: var(--text-muted); opacity: 0.7;
        }
        .pcm-input {
          width: 100%;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 7px;
          padding: 8px 11px;
          font-size: 13px;
          color: var(--text-primary);
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: border-color 150ms;
        }
        .pcm-input:focus { border-color: var(--accent); }
        .pcm-opt-row {
          display: flex; align-items: center; gap: 6px; margin-bottom: 5px;
        }
        .pcm-opt-remove {
          background: none; border: none; cursor: pointer;
          color: var(--text-muted); font-size: 12px; line-height: 1;
          flex-shrink: 0; padding: 6px;
          transition: color 120ms;
        }
        .pcm-opt-remove:hover { color: var(--danger, #f87171); }
        .pcm-add-opt {
          background: none; border: 1px dashed var(--border-normal);
          border-radius: 7px; padding: 7px 11px;
          font-size: 12px; font-weight: 600;
          color: var(--text-muted); cursor: pointer;
          font-family: inherit; text-align: left;
          transition: border-color 150ms, color 150ms;
        }
        .pcm-add-opt:hover { border-color: var(--accent-border); color: var(--accent); }
        .pcm-dur-row { display: flex; gap: 8px; }
        .pcm-dur-btn {
          flex: 1; padding: 6px 0;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 7px;
          font-size: 12px; font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer; font-family: inherit;
          transition: border-color 120ms, color 120ms, background 120ms;
        }
        .pcm-dur-btn:hover {
          border-color: var(--accent-border); color: var(--text-primary);
        }
        .pcm-dur-btn--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
        }
        .pcm-footer {
          display: flex; align-items: center; justify-content: flex-end;
          gap: 10px; padding: 12px 20px 16px;
          border-top: 1px solid var(--border-subtle);
        }
        .pcm-btn-cancel {
          padding: 7px 16px;
          background: none; border: 1px solid var(--border-normal);
          border-radius: 7px; font-size: 13px; font-weight: 600;
          color: var(--text-secondary); cursor: pointer;
          font-family: inherit;
          transition: border-color 120ms, background 120ms;
        }
        .pcm-btn-cancel:hover { background: var(--bg-overlay); }
        .pcm-btn-create {
          padding: 7px 18px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
          border: none; border-radius: 7px;
          font-size: 13px; font-weight: 700;
          color: #fff; cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px var(--accent-glow);
          transition: opacity 150ms, box-shadow 150ms;
        }
        .pcm-btn-create:hover:not(.pcm-btn-create--disabled) {
          opacity: 0.9; box-shadow: 0 6px 18px rgba(14,165,233,0.4);
        }
        .pcm-btn-create--disabled {
          background: var(--bg-overlay); color: var(--text-muted);
          cursor: not-allowed; box-shadow: none;
        }
      `})]})}let u={"4k60":"4K 60","1080p60":"1080p 60",auto:"Auto"};function b({quality:e}){return(0,r.jsxs)("div",{className:`sl-quality-badge${"4k60"===e?" sl-quality-badge--4k60":""}`,"aria-label":`Stream quality: ${u[e]}`,children:[(0,r.jsx)("span",{className:"sl-quality-badge-dot","aria-hidden":"true"}),u[e]]})}let m=()=>(0,r.jsxs)("svg",{width:"32",height:"32",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("polygon",{points:"23 7 16 12 23 17 23 7"}),(0,r.jsx)("rect",{x:"1",y:"5",width:"15",height:"14",rx:"2",ry:"2"})]}),h=()=>(0,r.jsx)("svg",{width:"13",height:"13",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:(0,r.jsx)("polygon",{points:"13 2 3 14 12 14 11 22 21 10 12 10 13 2"})}),g=()=>(0,r.jsxs)("svg",{width:"13",height:"13",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("line",{x1:"18",y1:"20",x2:"18",y2:"10"}),(0,r.jsx)("line",{x1:"12",y1:"20",x2:"12",y2:"4"}),(0,r.jsx)("line",{x1:"6",y1:"20",x2:"6",y2:"14"})]}),v=()=>(0,r.jsx)("svg",{width:"13",height:"13",viewBox:"0 0 24 24",fill:"currentColor","aria-hidden":"true",children:(0,r.jsx)("rect",{x:"3",y:"3",width:"18",height:"18",rx:"2"})}),f=()=>(0,r.jsxs)("svg",{width:"13",height:"13",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}),(0,r.jsx)("polyline",{points:"16 17 21 12 16 7"}),(0,r.jsx)("line",{x1:"21",y1:"12",x2:"9",y2:"12"})]});e.s(["StreamLayout",0,function({channel:e}){let a=(0,o.useOnyxStore)(e=>e.streams),i=(0,o.useOnyxStore)(e=>e.ourNick),s=(0,o.useOnyxStore)(e=>e.client),l=(0,o.useOnyxStore)(e=>e.endStream),p=(0,o.useOnyxStore)(e=>e.raidChannel),u=(0,o.useOnyxStore)(e=>e.voice.localStream),w=(0,o.useOnyxStore)(e=>e.voice.videoParticipants),[y,k]=(0,t.useState)(!1),[j,N]=(0,t.useState)(""),[C,S]=(0,t.useState)(!1),z=a.get(e.toLowerCase()),L=(0,t.useRef)(null);(0,t.useEffect)(()=>{if(!z?.live||!s)return;let r=`%%${e}`;return s.sendRaw("JOIN",r),()=>{s.sendRaw("PART",r)}},[z?.live,s,e]);let $=z?.streamer.toLowerCase()===i.toLowerCase(),O=$?u:z?w.get(z.streamer)??null:null;if((0,t.useEffect)(()=>{L.current&&L.current.srcObject!==O&&(L.current.srcObject=O)},[O]),!z?.live)return null;let E=()=>{j.trim()&&(p(e,j.trim()),k(!1),N(""))};return(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("div",{className:"sl-root",children:(0,r.jsxs)("div",{className:"sl-video-area",children:[O?(0,r.jsx)("video",{ref:L,className:"sl-video",autoPlay:!0,playsInline:!0,muted:$}):(0,r.jsxs)("div",{className:"sl-video-placeholder","aria-hidden":"true",children:[(0,r.jsx)(m,{}),(0,r.jsx)("span",{children:"Video stream via LADON"})]}),(0,r.jsx)(n,{channel:e}),(0,r.jsx)(d,{channel:e}),(0,r.jsx)(b,{quality:z.quality}),(0,r.jsx)("div",{className:"sl-poll-host",children:(0,r.jsx)(c,{channel:e})}),(0,r.jsxs)("div",{className:"sl-control-bar",children:[(0,r.jsx)("div",{className:"sl-control-gradient","aria-hidden":"true"}),(0,r.jsx)("div",{className:"sl-controls",children:$?(0,r.jsxs)(r.Fragment,{children:[(0,r.jsxs)("div",{className:"sl-raid-wrap",children:[(0,r.jsxs)("button",{className:"sl-ctrl-btn sl-ctrl-btn--ghost",type:"button",onClick:()=>k(e=>!e),"aria-expanded":y,"aria-haspopup":"true",children:[(0,r.jsx)(h,{}),"Raid"]}),y&&(0,r.jsxs)("div",{className:"sl-raid-input-pop",role:"dialog","aria-label":"Raid channel",children:[(0,r.jsx)("input",{className:"sl-raid-input",value:j,onChange:e=>N(e.target.value),placeholder:"#channel","aria-label":"Target channel for raid",onKeyDown:e=>{"Enter"===e.key&&E(),"Escape"===e.key&&k(!1)},autoFocus:!0}),(0,r.jsx)("button",{className:"sl-raid-go",type:"button",onClick:E,disabled:!j.trim(),children:"Raid"})]})]}),(0,r.jsxs)("button",{className:"sl-ctrl-btn sl-ctrl-btn--ghost",type:"button",onClick:()=>S(!0),children:[(0,r.jsx)(g,{}),"Poll"]}),(0,r.jsxs)("button",{className:"sl-ctrl-btn sl-ctrl-btn--danger",type:"button",onClick:()=>l(e),children:[(0,r.jsx)(v,{}),"End Stream"]})]}):(0,r.jsxs)("button",{className:"sl-ctrl-btn sl-ctrl-btn--ghost",type:"button",onClick:()=>{s?.sendRaw("PART",`%%${e}`)},children:[(0,r.jsx)(f,{}),"Leave Stream"]})})]})]})}),C&&(0,r.jsx)(x,{channel:e,onClose:()=>S(!1)}),(0,r.jsx)("style",{children:`
        .sl-root {
          flex-shrink: 0;
          position: relative;
          background: var(--bg-void);
          border-bottom: 1px solid var(--border-subtle);
        }
        .sl-video-area {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          max-height: 320px;
          background: #000;
          overflow: hidden;
        }
        .sl-video {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #000;
        }
        .sl-video-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: rgba(255,255,255,0.18);
          font-size: 13px;
          font-weight: 500;
        }
        .sl-poll-host {
          position: absolute;
          left: 12px;
          bottom: 54px;
          z-index: 15;
          pointer-events: all;
        }
        .sl-control-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 12;
        }
        .sl-control-gradient {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 72px;
          background: linear-gradient(to top, rgba(3,8,16,0.92) 0%, transparent 100%);
          pointer-events: none;
        }
        .sl-controls {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px 12px;
          justify-content: flex-end;
        }
        .sl-ctrl-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: opacity 150ms, background 150ms;
          border: none;
        }
        .sl-ctrl-btn--ghost {
          background: rgba(255,255,255,0.1);
          color: #fff;
          border: 1px solid rgba(255,255,255,0.12);
        }
        .sl-ctrl-btn--ghost:hover { background: rgba(255,255,255,0.16); }
        .sl-ctrl-btn--danger {
          background: rgba(230,57,70,0.18);
          color: #ff6b7a;
          border: 1px solid rgba(230,57,70,0.3);
        }
        .sl-ctrl-btn--danger:hover { background: rgba(230,57,70,0.28); }
        .sl-raid-wrap { position: relative; }
        .sl-raid-input-pop {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          padding: 8px;
          display: flex;
          gap: 6px;
          box-shadow: var(--shadow-lg);
          animation: sl-pop 140ms cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes sl-pop {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .sl-raid-input {
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          color: var(--text-primary);
          font-family: inherit;
          outline: none;
          width: 140px;
        }
        .sl-raid-input:focus { border-color: var(--accent); }
        .sl-raid-go {
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
          border: none;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          cursor: pointer;
          font-family: inherit;
          transition: opacity 150ms;
        }
        .sl-raid-go:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .sl-raid-go:not(:disabled):hover { opacity: 0.88; }
        .sl-quality-badge {
          position: absolute;
          top: 10px;
          right: 12px;
          z-index: 15;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px 3px 6px;
          background: rgba(3, 8, 16, 0.62);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          backdrop-filter: blur(8px);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: rgba(255, 255, 255, 0.65);
          pointer-events: none;
          user-select: none;
        }
        .sl-quality-badge--4k60 {
          border-color: rgba(14, 165, 233, 0.28);
          color: rgba(125, 211, 252, 0.88);
        }
        .sl-quality-badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          opacity: 0.7;
          flex-shrink: 0;
        }
      `})]})}],58615)},11544,e=>{e.n(e.i(58615))}]);