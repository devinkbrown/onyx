(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,27627,e=>{"use strict";var r=e.i(30152),a=e.i(93737),t=e.i(37807),n=e.i(79239),i=e.i(1544),s=e.i(76525);function o({onClose:e}){let t=(0,n.useOnyxStore)(e=>e.channels),l=(0,n.useOnyxStore)(e=>e.ourNick),c=(0,n.useOnyxStore)(e=>e.client),d=(0,n.useOnyxStore)(e=>e.navigate),[h,p]=(0,a.useState)(""),[v,x]=(0,a.useState)(new Set),[m,u]=(0,a.useState)(!1),g=(0,a.useRef)(null);(0,a.useEffect)(()=>{g.current?.focus()},[]);let f=(0,a.useMemo)(()=>{let e=new Map;for(let r of t.values())for(let[,a]of r.users){if(a.nick.toLowerCase()===l.toLowerCase())continue;let r=a.nick.toLowerCase();e.has(r)||e.set(r,{nick:a.nick,away:a.away??!1})}return[...e.values()].sort((e,r)=>e.nick.toLowerCase().localeCompare(r.nick.toLowerCase()))},[t,l]),b=(0,a.useMemo)(()=>{if(!h.trim())return f;let e=h.trim().toLowerCase();return f.filter(r=>r.nick.toLowerCase().includes(e))},[f,h]),j=e=>{x(r=>{let a=new Set(r);if(a.has(e))a.delete(e);else{if(a.size>=9)return r;a.add(e)}return a})},k=v.size>=9,y=v.size>=2;return(0,r.jsxs)("div",{className:"ngdm-overlay",onClick:e,children:[(0,r.jsxs)("div",{className:"ngdm-modal animate-scale-in",onClick:e=>e.stopPropagation(),role:"dialog","aria-modal":"true","aria-label":"New Group DM",children:[(0,r.jsxs)("div",{className:"ngdm-header",children:[(0,r.jsx)("h2",{className:"ngdm-title",children:"New Group DM"}),(0,r.jsx)("button",{className:"ngdm-close",onClick:e,"aria-label":"Close",children:(0,r.jsx)("svg",{width:"11",height:"11",viewBox:"0 0 10 10",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M1.5 1.5l7 7M8.5 1.5l-7 7"})})})]}),v.size>0&&(0,r.jsx)("div",{className:"ngdm-chips",children:[...v].map(e=>(0,r.jsxs)("span",{className:"ngdm-chip",children:[(0,r.jsx)(i.default,{nick:e,size:18}),e,(0,r.jsx)("button",{className:"ngdm-chip-remove",onClick:()=>j(e),"aria-label":`Remove ${e}`,children:"×"})]},e))}),(0,r.jsx)("div",{className:"ngdm-search-row",children:(0,r.jsx)("input",{ref:g,className:"ngdm-search",placeholder:"Search users…",value:h,onChange:e=>p(e.target.value),"aria-label":"Search users"})}),k&&(0,r.jsxs)("div",{className:"ngdm-warning",children:["Maximum ",9," users per group DM."]}),(0,r.jsx)("div",{className:"ngdm-list",role:"listbox","aria-label":"Select users","aria-multiselectable":"true",children:0===b.length?(0,r.jsx)("div",{className:"ngdm-empty",children:0===f.length?"No users visible — join a channel first.":"No users match your search."}):b.map(e=>{let a=v.has(e.nick),t=!a&&k;return(0,r.jsxs)("button",{role:"option","aria-selected":a,className:`ngdm-user-row ${a?"ngdm-user-row--selected":""} ${t?"ngdm-user-row--disabled":""}`,onClick:()=>!t&&j(e.nick),disabled:t,children:[(0,r.jsx)("span",{className:"ngdm-checkbox","aria-hidden":!0,children:a?"✓":""}),(0,r.jsx)(i.default,{nick:e.nick,size:32,status:e.away?"offline":"online"}),(0,r.jsx)("span",{className:"ngdm-user-nick",children:e.nick}),(0,r.jsx)("span",{className:"ngdm-user-status-dot",style:{background:e.away?"var(--status-offline)":"var(--status-online)"},"aria-hidden":!0})]},e.nick)})}),(0,r.jsxs)("div",{className:"ngdm-footer",children:[(0,r.jsxs)("span",{className:"ngdm-count-label",children:[v.size," / ",9," selected"]}),(0,r.jsxs)("div",{className:"ngdm-footer-actions",children:[(0,r.jsx)(s.default,{variant:"ghost",size:"sm",onClick:e,children:"Cancel"}),(0,r.jsx)(s.default,{variant:"primary",size:"sm",disabled:!y||m,loading:m,onClick:()=>{let r;if(v.size<2||!c)return;u(!0);let a=[...v],t=(r=[l,...a].map(e=>e.toLowerCase().replace(/[^a-z0-9]/g,"")).filter(Boolean).slice(0,4),`#dm-${r.join("-")}`);c.sendRaw("JOIN",t),setTimeout(()=>{for(let e of a)c.sendRaw("INVITE",e,t);d({kind:"channel",channel:t}),e()},400)},children:"Create"})]})]})]}),(0,r.jsx)("style",{children:`
        .ngdm-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.7);
          z-index: 600;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          backdrop-filter: blur(4px);
        }

        .ngdm-modal {
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl);
          width: 100%; max-width: 400px;
          max-height: 80dvh;
          display: flex; flex-direction: column;
          overflow: hidden;
          box-shadow: var(--shadow-xl);
        }

        .ngdm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 20px 0;
          flex-shrink: 0;
        }

        .ngdm-title {
          font-size: 17px; font-weight: 700;
          color: var(--text-primary); letter-spacing: -0.2px;
        }

        .ngdm-close {
          width: 28px; height: 28px;
          border-radius: 50%; border: none;
          background: var(--bg-elevated); color: var(--text-muted);
          cursor: pointer; font-size: 12px;
          display: flex; align-items: center; justify-content: center;
          transition: background 100ms, color 100ms;
        }
        .ngdm-close:hover { background: var(--bg-overlay); color: var(--text-primary); }

        .ngdm-chips {
          display: flex; flex-wrap: wrap; gap: 6px;
          padding: 12px 20px 0;
          flex-shrink: 0;
        }

        .ngdm-chip {
          display: inline-flex; align-items: center; gap: 5px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: 999px;
          padding: 3px 8px 3px 5px;
          font-size: 13px; font-weight: 600; color: var(--accent);
        }

        .ngdm-chip-remove {
          background: none; border: none; cursor: pointer;
          color: var(--accent); font-size: 16px; line-height: 1;
          padding: 0; display: flex; align-items: center;
          opacity: 0.7; transition: opacity 100ms;
        }
        .ngdm-chip-remove:hover { opacity: 1; }

        .ngdm-search-row {
          padding: 12px 20px 0;
          flex-shrink: 0;
        }

        .ngdm-search {
          width: 100%;
          padding: 8px 12px; border-radius: var(--r-md);
          background: var(--bg-elevated); border: 1px solid var(--border-normal);
          color: var(--text-primary); font-size: 14px; font-family: inherit;
          box-sizing: border-box;
        }
        .ngdm-search:focus { outline: none; border-color: var(--accent-border); }
        .ngdm-search::placeholder { color: var(--text-muted); }

        .ngdm-warning {
          margin: 8px 20px 0;
          padding: 8px 12px;
          border-radius: var(--r-sm);
          background: rgba(232,184,75,0.1);
          border: 1px solid rgba(232,184,75,0.3);
          font-size: 12px; font-weight: 600;
          color: var(--gold, #e8b84b);
          flex-shrink: 0;
        }

        .ngdm-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 12px;
          display: flex; flex-direction: column; gap: 2px;
        }

        .ngdm-empty {
          text-align: center; padding: 24px;
          font-size: 13px; color: var(--text-muted);
        }

        .ngdm-user-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: var(--r-md);
          background: none; border: none; cursor: pointer;
          text-align: left; width: 100%;
          transition: background 100ms;
          font-family: inherit;
        }
        .ngdm-user-row:hover:not(.ngdm-user-row--disabled) {
          background: var(--ch-hover-bg);
        }
        .ngdm-user-row--selected {
          background: var(--accent-subtle) !important;
        }
        .ngdm-user-row--disabled {
          opacity: 0.4; cursor: not-allowed;
        }

        .ngdm-checkbox {
          width: 18px; height: 18px; flex-shrink: 0;
          border-radius: var(--r-sm);
          border: 2px solid var(--border-normal);
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: #fff;
          background: transparent;
          transition: background 100ms, border-color 100ms;
        }
        .ngdm-user-row--selected .ngdm-checkbox {
          background: var(--accent);
          border-color: var(--accent);
        }

        .ngdm-user-nick {
          flex: 1; font-size: 14px; font-weight: 600;
          color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .ngdm-user-status-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }

        .ngdm-footer {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px;
          padding: 14px 20px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .ngdm-count-label {
          font-size: 12px; color: var(--text-muted);
        }

        .ngdm-footer-actions {
          display: flex; gap: 8px;
        }

        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in { animation: scale-in 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both; }
      `})]})}var l=e.i(27656),c=e.i(15312);function d(){return(0,r.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.6",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,style:{color:"var(--text-muted)",flexShrink:0},children:[(0,r.jsx)("circle",{cx:"7",cy:"7",r:"4.5"}),(0,r.jsx)("path",{d:"M13 13l-2.5-2.5"})]})}function h(){let e=(0,n.useOnyxStore)(e=>e.ourNick),t=(0,n.useOnyxStore)(e=>e.server),s=(0,n.useOnyxStore)(e=>e.channels),h=(0,n.useOnyxStore)(e=>e.dms),$=(0,n.useOnyxStore)(e=>e.navigate),I=(0,n.useOnyxStore)(e=>e.joinChannel),D=(0,n.useOnyxStore)(e=>e.client),Q=(0,n.useOnyxStore)(e=>e.networkName),E=(0,n.useOnyxStore)(e=>e.openChannelBrowser),R=(0,n.useOnyxStore)(e=>e.openSearchOverlay),Y=(0,n.useOnyxStore)(e=>e.openPinnedMessages),F=(0,n.useOnyxStore)(e=>e.joinHistory),P=(0,n.useOnyxStore)(e=>e.toggleSpotlight),V=(0,n.useOnyxStore)(e=>e.openFriendsPanel),H=(0,n.useOnyxStore)(e=>e.openServices),U=(0,n.useOnyxStore)(e=>e.openNotificationCenter),G=(0,n.useOnyxStore)(e=>e.openScheduledMessages),Z=(0,n.useOnyxStore)(e=>e.openThemeModal),X=(0,n.useOnyxStore)(e=>e.openSoundSettings),K=(0,n.useOnyxStore)(e=>e.openHighlightModal),J=(0,n.useOnyxStore)(e=>e.openCustomEmojiModal),_=(0,n.useOnyxStore)(e=>e.openConnectionProfiles),ee=(0,n.useOnyxStore)(e=>e.openServerInfo),er=(0,n.useOnyxStore)(e=>e.openServerStats),ea=(0,n.useOnyxStore)(e=>e.openKeyboardShortcuts),et=(0,n.useOnyxStore)(e=>e.openAnnouncementsPanel),en=(0,n.useOnyxStore)(e=>e.openPollCreate),ei=(0,n.useOnyxStore)(e=>e.channelUnread),es=(0,n.useOnyxStore)(e=>e.totalUnreadMentions),eo=(0,n.useOnyxStore)(e=>e.voiceChannels),el=(0,n.useOnyxStore)(e=>e.streams),ec=(0,n.useOnyxStore)(e=>e.latencyMs),ed=(0,n.useOnyxStore)(e=>e.connectedAt),[eh,ep]=(0,a.useState)(!1),[ev,ex]=(0,a.useState)(!1),[em,eu]=(0,a.useState)(!1),[eg,ef]=(0,a.useState)(""),[eb,ej]=(0,a.useState)(!1),ek=[...h.values()].sort((e,r)=>{let a=e.messages.at(-1)?.time.getTime()??0;return(r.messages.at(-1)?.time.getTime()??0)-a}),ey=[...s.values()].filter(e=>!e.modes.includes("V")).sort((e,r)=>{let a=e.messages.at(-1)?.time.getTime()??0;return(r.messages.at(-1)?.time.getTime()??0)-a}).slice(0,8),ew=Object.values(ei).reduce((e,r)=>e+r,0)+ek.reduce((e,r)=>e+(r.unread??0),0),eN=[...el.values()].filter(e=>e.live),eC=ed?ed.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—",eL=null==ec?"—":`${ec}ms`,eS=[{label:"Talk",items:[{title:"Friends",meta:`${ek.length} chats`,icon:(0,r.jsx)(f,{}),action:V},{title:"Services",meta:"NickServ / ChanServ",icon:(0,r.jsx)(C,{}),action:()=>H()},{title:"Notifications",meta:ew?`${ew} unread`:"All clear",icon:(0,r.jsx)(w,{}),action:U},{title:"Scheduled",meta:"Message queue",icon:(0,r.jsx)(N,{}),action:G}]},{label:"Create",items:[{title:"Poll",meta:"Ask the room",icon:(0,r.jsx)(L,{}),action:en},{title:"Group DM",meta:"Private room",icon:(0,r.jsx)(j,{}),action:()=>ep(!0)},{title:"Emoji",meta:"Custom set",icon:(0,r.jsx)(S,{}),action:J},{title:"Highlights",meta:"Watch words",icon:(0,r.jsx)(b,{}),action:K}]},{label:"Tune",items:[{title:"Appearance",meta:"Theme and layout",icon:(0,r.jsx)(M,{}),action:Z},{title:"Sound",meta:"Alerts and volume",icon:(0,r.jsx)(z,{}),action:X},{title:"Profiles",meta:"Saved servers",icon:(0,r.jsx)(O,{}),action:_},{title:"Shortcuts",meta:"Keyboard map",icon:(0,r.jsx)(q,{}),action:ea}]},{label:"Server",items:[{title:"Info",meta:Q||"Network",icon:(0,r.jsx)(B,{}),action:ee},{title:"Stats",meta:eL,icon:(0,r.jsx)(W,{}),action:er},{title:"Announcements",meta:"Network posts",icon:(0,r.jsx)(T,{}),action:et},{title:"Channels",meta:`${s.size} joined`,icon:(0,r.jsx)(g,{}),action:E}]}],eM=(0,a.useMemo)(()=>{let e=[];return s.forEach((r,a)=>{r.messages.slice(-5).forEach(r=>{e.push({channel:a,msg:r})})}),e.sort((e,r)=>r.msg.time.getTime()-e.msg.time.getTime()).slice(0,20)},[s]),ez=[],eO=D?.negotiatedCaps;return(eO?.has("draft/chathistory")||eO?.has("chathistory"))&&ez.push("CHATHISTORY"),D?.isupport?.IRCX&&ez.push("IRCX"),eO?.has("sasl")&&ez.push("SASL"),eO?.has("server-time")&&ez.push("SERVER-TIME"),eO?.has("message-tags")&&ez.push("MSG-TAGS"),D?.isupport?.LADONMEDIA&&ez.push("LADON"),(0,r.jsxs)("div",{className:"hv-root",children:[(0,r.jsxs)("div",{className:"hv-hero animate-fade-in",children:[(0,r.jsx)("div",{className:"hv-hero-glow","aria-hidden":!0}),(0,r.jsx)("div",{className:"hv-hero-wave",children:(0,r.jsx)(A,{})}),(0,r.jsx)("div",{className:"hv-hero-eyebrow",children:"Midnight IRC"}),(0,r.jsx)("h1",{className:"hv-hero-title",children:(0,r.jsx)("span",{className:"hv-hero-gradient",children:"Ocean"})}),(0,r.jsx)("p",{className:"hv-hero-subtitle",children:e?(0,r.jsxs)(r.Fragment,{children:["Connected as ",(0,r.jsx)("strong",{children:e})," on ",Q||"your network"]}):"A quiet command center for channels, DMs, and network signals"}),(0,r.jsxs)("button",{className:"hv-spotlight-hint",onClick:P,"aria-label":"Open spotlight search",children:[(0,r.jsx)(d,{}),(0,r.jsx)("span",{className:"hv-spotlight-hint-text",children:"Search channels, people, messages…"}),(0,r.jsx)("kbd",{className:"hv-kbd",children:"Ctrl"}),(0,r.jsx)("span",{className:"hv-kbd-sep",children:"+"}),(0,r.jsx)("kbd",{className:"hv-kbd",children:"K"})]}),(0,r.jsxs)("div",{className:"hv-stats-row",children:[(0,r.jsxs)("div",{className:"hv-stat",children:[(0,r.jsx)("span",{className:"hv-stat-value",children:s.size}),(0,r.jsx)("span",{className:"hv-stat-label",children:"Channels"})]}),(0,r.jsx)("div",{className:"hv-stat-divider","aria-hidden":!0}),(0,r.jsxs)("div",{className:"hv-stat",children:[(0,r.jsx)("span",{className:"hv-stat-value",children:Q||"Ocean"}),(0,r.jsx)("span",{className:"hv-stat-label",children:"Server"})]}),(0,r.jsx)("div",{className:"hv-stat-divider","aria-hidden":!0}),(0,r.jsxs)("div",{className:"hv-stat",children:[(0,r.jsx)("span",{className:"hv-stat-value",children:e||"—"}),(0,r.jsx)("span",{className:"hv-stat-label",children:"You"})]})]}),(0,r.jsxs)("div",{className:"hv-quick-cards",children:[(0,r.jsxs)("button",{className:"hv-quick-card hv-quick-card--0",onClick:E,children:[(0,r.jsx)("span",{className:"hv-quick-card-icon",children:(0,r.jsx)(g,{})}),(0,r.jsx)("span",{className:"hv-quick-card-title",children:"Browse Channels"}),(0,r.jsx)("span",{className:"hv-quick-card-desc",children:"Explore all available channels"}),(0,r.jsx)("span",{className:"hv-quick-card-cta",children:"Open"})]}),(0,r.jsxs)("button",{className:"hv-quick-card hv-quick-card--1",onClick:()=>ej(e=>!e),children:[(0,r.jsx)("span",{className:"hv-quick-card-icon",children:(0,r.jsx)(f,{})}),(0,r.jsx)("span",{className:"hv-quick-card-title",children:"Start a DM"}),(0,r.jsx)("span",{className:"hv-quick-card-desc",children:"Message someone directly"}),(0,r.jsx)("span",{className:"hv-quick-card-cta",children:"Compose"})]}),(0,r.jsxs)("button",{className:"hv-quick-card hv-quick-card--2",onClick:R,children:[(0,r.jsx)("span",{className:"hv-quick-card-icon",children:(0,r.jsx)(b,{})}),(0,r.jsx)("span",{className:"hv-quick-card-title",children:"Search Messages"}),(0,r.jsx)("span",{className:"hv-quick-card-desc",children:"Find messages across channels"}),(0,r.jsx)("span",{className:"hv-quick-card-cta",children:"Search"})]}),(0,r.jsxs)("button",{className:"hv-quick-card hv-quick-card--3",onClick:()=>ep(!0),children:[(0,r.jsx)("span",{className:"hv-quick-card-icon",children:(0,r.jsx)(j,{})}),(0,r.jsx)("span",{className:"hv-quick-card-title",children:"Group DM"}),(0,r.jsx)("span",{className:"hv-quick-card-desc",children:"Chat with multiple people"}),(0,r.jsx)("span",{className:"hv-quick-card-cta",children:"Create"})]})]})]}),(0,r.jsxs)("section",{className:"hv-command-strip animate-fade-in","aria-label":"Workspace status",style:{animationDelay:"70ms"},children:[(0,r.jsxs)("button",{className:"hv-signal-card",onClick:U,children:[(0,r.jsx)("span",{className:"hv-signal-icon hv-signal-icon--mentions",children:(0,r.jsx)(w,{})}),(0,r.jsxs)("span",{className:"hv-signal-copy",children:[(0,r.jsx)("span",{className:"hv-signal-value",children:es}),(0,r.jsx)("span",{className:"hv-signal-label",children:"Mentions"})]})]}),(0,r.jsxs)("button",{className:"hv-signal-card",onClick:R,children:[(0,r.jsx)("span",{className:"hv-signal-icon hv-signal-icon--unread",children:(0,r.jsx)(b,{})}),(0,r.jsxs)("span",{className:"hv-signal-copy",children:[(0,r.jsx)("span",{className:"hv-signal-value",children:ew}),(0,r.jsx)("span",{className:"hv-signal-label",children:"Unread"})]})]}),(0,r.jsxs)("button",{className:"hv-signal-card",onClick:eN[0]?()=>$({kind:"channel",channel:eN[0].channel}):er,children:[(0,r.jsx)("span",{className:"hv-signal-icon hv-signal-icon--live",children:(0,r.jsx)(W,{})}),(0,r.jsxs)("span",{className:"hv-signal-copy",children:[(0,r.jsx)("span",{className:"hv-signal-value",children:eN.length}),(0,r.jsx)("span",{className:"hv-signal-label",children:"Live"})]})]}),(0,r.jsxs)("button",{className:"hv-signal-card",onClick:ee,children:[(0,r.jsx)("span",{className:"hv-signal-icon hv-signal-icon--server",children:(0,r.jsx)(B,{})}),(0,r.jsxs)("span",{className:"hv-signal-copy",children:[(0,r.jsx)("span",{className:"hv-signal-value",children:eL}),(0,r.jsx)("span",{className:"hv-signal-label",children:"Latency"})]})]}),(0,r.jsxs)("button",{className:"hv-signal-card",onClick:E,children:[(0,r.jsx)("span",{className:"hv-signal-icon hv-signal-icon--voice",children:(0,r.jsx)(g,{})}),(0,r.jsxs)("span",{className:"hv-signal-copy",children:[(0,r.jsx)("span",{className:"hv-signal-value",children:eo.length}),(0,r.jsx)("span",{className:"hv-signal-label",children:"Voice rooms"})]})]}),(0,r.jsxs)("button",{className:"hv-signal-card",onClick:ee,children:[(0,r.jsx)("span",{className:"hv-signal-icon hv-signal-icon--uptime",children:(0,r.jsx)(N,{})}),(0,r.jsxs)("span",{className:"hv-signal-copy",children:[(0,r.jsx)("span",{className:"hv-signal-value",children:eC}),(0,r.jsx)("span",{className:"hv-signal-label",children:"Connected"})]})]})]}),(0,r.jsxs)("div",{className:"hv-layout animate-fade-in",style:{animationDelay:"100ms"},children:[(0,r.jsxs)("div",{className:"hv-left",children:[(0,r.jsxs)("section",{className:"hv-panel",children:[(0,r.jsxs)("div",{className:"hv-panel-header",children:[(0,r.jsx)("h2",{className:"hv-panel-title",children:"Direct Messages"}),(0,r.jsxs)("button",{className:"hv-header-btn",onClick:()=>ej(e=>!e),"aria-expanded":eb,title:"New DM",children:[(0,r.jsx)(x,{}),"New DM"]})]}),eb&&(0,r.jsxs)("form",{className:"hv-new-dm-form",onSubmit:e=>{e.preventDefault();let r=eg.trim();r&&D&&(D.sendRaw("PRIVMSG","NickServ",`INFO ${r}`),$({kind:"dm",nick:r}),ef(""),ej(!1))},children:[(0,r.jsx)("input",{className:"hv-input",placeholder:"Enter a nickname…",value:eg,onChange:e=>ef(e.target.value),autoFocus:!0,"aria-label":"Nickname to message"}),(0,r.jsx)("button",{type:"submit",className:"hv-btn-primary",disabled:!eg.trim(),children:"Open"}),(0,r.jsx)("button",{type:"button",className:"hv-btn-ghost",onClick:()=>ej(!1),children:"Cancel"})]}),ek.length>0?(0,r.jsx)("div",{className:"hv-dm-list",children:ek.map(e=>{var a;let t,n=e.messages.at(-1),s=n&&n.from&&n.from!==e.nick?`${n.from}: `:"",o=n?`${s}${(0,c.stripIrcFormatting)(n.text).slice(0,55)}`:"No messages yet",l=!0===e.away?"idle":!1===e.away?"online":"unknown";return(0,r.jsxs)("button",{className:"hv-dm-row",onClick:()=>$({kind:"dm",nick:e.nick}),children:[(0,r.jsxs)("div",{className:"hv-dm-avatar-wrap",children:[(0,r.jsx)(i.default,{nick:e.nick,size:40}),(0,r.jsx)("span",{className:`hv-status-dot hv-status-dot--${l}`,"aria-hidden":!0})]}),(0,r.jsxs)("div",{className:"hv-dm-info",children:[(0,r.jsxs)("div",{className:"hv-dm-top",children:[(0,r.jsx)("span",{className:"hv-dm-nick",children:e.nick}),n&&(0,r.jsx)("span",{className:"hv-dm-time",children:(a=n.time,(t=new Date().getTime()-a.getTime())<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?a.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):a.toLocaleDateString([],{month:"short",day:"numeric"}))})]}),(0,r.jsx)("p",{className:"hv-dm-preview",children:o})]}),e.highlights>0&&(0,r.jsx)("span",{className:"hv-badge",children:e.highlights>99?"99+":e.highlights}),e.unread>0&&0===e.highlights&&(0,r.jsx)("span",{className:"hv-unread-dot"})]},e.nick)})}):(0,r.jsxs)("div",{className:"hv-empty",children:[(0,r.jsx)("div",{className:"hv-empty-art",children:(0,r.jsx)(p,{})}),(0,r.jsxs)("div",{className:"hv-empty-copy",children:[(0,r.jsx)("h3",{className:"hv-empty-title",children:"No direct messages yet"}),(0,r.jsx)("p",{className:"hv-empty-text",children:"Start a private thread or open your friends panel when you are ready to talk."})]}),(0,r.jsxs)("div",{className:"hv-empty-actions",children:[(0,r.jsx)("button",{className:"hv-btn-primary",onClick:()=>ej(!0),children:"Start a DM"}),(0,r.jsx)("button",{className:"hv-btn-ghost",onClick:V,children:"Friends"})]})]})]}),(0,r.jsxs)("section",{className:"hv-panel",children:[(0,r.jsx)("div",{className:"hv-panel-header",children:(0,r.jsx)("h2",{className:"hv-panel-title",children:"Your Channels"})}),ey.length>0?(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("div",{className:"hv-channel-grid",children:ey.map(e=>{let a=e.name.replace(/^[#&]/,""),t=e.topic?(0,c.stripIrcFormatting)(e.topic).slice(0,60):null;return(0,r.jsxs)("button",{className:"hv-ch-card",onClick:()=>$({kind:"channel",channel:e.name}),children:[(0,r.jsxs)("div",{className:"hv-ch-card-header",children:[(0,r.jsx)("span",{className:"hv-ch-hash",children:"#"}),(0,r.jsx)("span",{className:"hv-ch-name",children:a}),e.highlights>0&&(0,r.jsx)("span",{className:"hv-badge",children:e.highlights>99?"99+":e.highlights})]}),t&&(0,r.jsx)("p",{className:"hv-ch-topic",children:t}),(0,r.jsxs)("span",{className:"hv-ch-count",children:[e.users.size," member",1!==e.users.size?"s":""]})]},e.name)})}),(0,r.jsx)("button",{className:"hv-browse-link",onClick:E,children:"Browse all channels →"})]}):(0,r.jsxs)("div",{className:"hv-empty hv-empty--sm",children:[(0,r.jsxs)("div",{className:"hv-empty-copy",children:[(0,r.jsx)("h3",{className:"hv-empty-title",children:"No channels joined"}),(0,r.jsx)("p",{className:"hv-empty-text",children:"Browse the network and pin a few rooms to make this deck come alive."})]}),(0,r.jsxs)("div",{className:"hv-empty-actions",children:[(0,r.jsx)("button",{className:"hv-btn-primary",onClick:E,children:"Browse channels"}),(0,r.jsx)("button",{className:"hv-btn-ghost",onClick:P,children:"Command"})]})]})]}),eM.length>0&&(0,r.jsxs)("section",{className:"hv-panel",children:[(0,r.jsx)("div",{className:"hv-panel-header",children:(0,r.jsx)("h2",{className:"hv-panel-title",children:"Recent Activity"})}),(0,r.jsx)("ul",{className:"activity-feed",role:"list",children:eM.map(({channel:e,msg:a})=>{var t;let n,i="msg"!==a.type&&"action"!==a.type,s=(0,c.stripIrcFormatting)(a.text).slice(0,100),o=e.startsWith("#")||e.startsWith("&")?e:`#${e}`;return(0,r.jsx)("li",{className:"activity-item",role:"listitem",children:(0,r.jsxs)("button",{className:"activity-item-btn",onClick:()=>$({kind:"channel",channel:e}),"aria-label":`Go to ${o}`,children:[(0,r.jsxs)("div",{className:"activity-item-header",children:[(0,r.jsx)("span",{className:"activity-channel-badge",children:o}),(0,r.jsx)("span",{className:"activity-time",children:(t=a.time,(n=Date.now()-t.getTime())<6e4?"just now":n<36e5?`${Math.floor(n/6e4)}m ago`:n<864e5?`${Math.floor(n/36e5)}h ago`:t.toLocaleDateString([],{month:"short",day:"numeric"}))})]}),i?(0,r.jsx)("p",{className:"activity-content activity-system",children:s}):(0,r.jsxs)("p",{className:"activity-content",children:[(0,r.jsx)("span",{className:"activity-nick",children:a.from}),"action"===a.type?(0,r.jsxs)("em",{children:[" ",s]}):`: ${s}`]})]})},a.id)})})]})]}),(0,r.jsxs)("div",{className:"hv-right",children:[(0,r.jsxs)("section",{className:"hv-panel hv-panel--sm",children:[(0,r.jsx)("h2",{className:"hv-panel-title hv-panel-title--sm",children:"Quick Actions"}),(0,r.jsxs)("div",{className:"hv-actions",children:[(0,r.jsxs)("button",{className:"hv-action-row",onClick:E,children:[(0,r.jsx)("span",{className:"hv-action-icon",children:(0,r.jsx)(g,{})}),(0,r.jsx)("span",{children:"Browse channels"})]}),(0,r.jsxs)("button",{className:"hv-action-row",onClick:R,children:[(0,r.jsx)("span",{className:"hv-action-icon",children:(0,r.jsx)(b,{})}),(0,r.jsx)("span",{children:"Search messages"})]}),Y&&(0,r.jsxs)("button",{className:"hv-action-row",onClick:Y,children:[(0,r.jsx)("span",{className:"hv-action-icon",children:(0,r.jsx)(k,{})}),(0,r.jsx)("span",{children:"Pinned messages"})]}),(0,r.jsxs)("button",{className:"hv-action-row",onClick:()=>ep(!0),children:[(0,r.jsx)("span",{className:"hv-action-icon",children:(0,r.jsx)(j,{})}),(0,r.jsx)("span",{children:"New group DM"})]}),(0,r.jsxs)("button",{className:"hv-action-row",onClick:()=>ex(e=>!e),"aria-expanded":ev,children:[(0,r.jsx)("span",{className:"hv-action-icon",children:(0,r.jsx)(y,{})}),(0,r.jsx)("span",{children:"Invite a friend"})]})]}),ev&&(0,r.jsxs)("div",{className:"hv-invite-tip",children:[(0,r.jsx)("p",{className:"hv-invite-label",children:"Use the IRC INVITE command:"}),(0,r.jsxs)("div",{className:"hv-invite-code-row",children:[(0,r.jsx)("code",{className:"hv-invite-code",children:"/invite #channel-name"}),(0,r.jsx)("button",{className:`hv-copy-btn ${em?"hv-copy-btn--copied":""}`,onClick:()=>{navigator.clipboard?.writeText("/invite #channel-name").catch(()=>void 0),eu(!0),setTimeout(()=>eu(!1),2e3)},title:"Copy command",children:em?(0,r.jsx)(u,{}):(0,r.jsx)(m,{})})]})]})]}),(0,r.jsxs)("section",{className:"hv-panel hv-panel--sm",children:[(0,r.jsxs)("div",{className:"hv-panel-header",children:[(0,r.jsx)("h2",{className:"hv-panel-title hv-panel-title--sm",children:"Launchpad"}),(0,r.jsxs)("button",{className:"hv-header-btn hv-header-btn--subtle",onClick:P,children:[(0,r.jsx)(d,{}),"Command"]})]}),(0,r.jsx)("div",{className:"hv-launchpad",children:eS.map(e=>(0,r.jsxs)("div",{className:"hv-launch-group",children:[(0,r.jsx)("div",{className:"hv-launch-label",children:e.label}),(0,r.jsx)("div",{className:"hv-launch-grid",children:e.items.map(a=>(0,r.jsxs)("button",{className:"hv-launch-tile",onClick:a.action,children:[(0,r.jsx)("span",{className:"hv-launch-icon",children:a.icon}),(0,r.jsxs)("span",{className:"hv-launch-copy",children:[(0,r.jsx)("span",{className:"hv-launch-title",children:a.title}),(0,r.jsx)("span",{className:"hv-launch-meta",children:a.meta})]})]},`${e.label}-${a.title}`))})]},e.label))})]}),F.length>0&&(0,r.jsxs)("section",{className:"hv-panel hv-panel--sm",children:[(0,r.jsx)("h2",{className:"hv-panel-title hv-panel-title--sm",children:"Recent Channels"}),(0,r.jsx)("div",{className:"hv-recent-pills",children:F.map(e=>{let a=s.has(e.toLowerCase());return(0,r.jsxs)("button",{className:`hv-recent-pill${a?" hv-recent-pill--active":""}`,onClick:()=>{a?$({kind:"channel",channel:e}):I(e)},title:a?`Switch to ${e}`:`Rejoin ${e}`,children:[(0,r.jsx)("span",{className:"hv-recent-pill-hash",children:"#"}),e.replace(/^[#&]/,"")]},e)})})]}),(0,r.jsxs)("section",{className:"hv-panel hv-panel--sm",children:[(0,r.jsx)("h2",{className:"hv-panel-title hv-panel-title--sm",children:"Server Info"}),(0,r.jsxs)("div",{className:"hv-server-info",children:[(0,r.jsx)("div",{className:"hv-server-logo",children:(0,r.jsx)(v,{size:36})}),(0,r.jsxs)("div",{className:"hv-server-details",children:[(0,r.jsx)("div",{className:"hv-server-name",children:Q||"Ocean"}),(0,r.jsx)("div",{className:"hv-server-account",children:t?.account?(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("span",{className:"hv-account-dot"}),"Signed in as ",(0,r.jsx)("strong",{children:t.account})]}):e?(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("span",{className:"hv-account-dot hv-account-dot--guest"}),"Connected as ",(0,r.jsx)("strong",{children:e})]}):(0,r.jsx)("span",{className:"hv-muted",children:"Not connected"})})]})]}),ez.length>0&&(0,r.jsx)("div",{className:"hv-features",children:ez.map(e=>(0,r.jsx)("span",{className:"hv-feature-badge",children:e},e))}),(0,r.jsx)(l.default,{})]})]})]}),eh&&(0,r.jsx)(o,{onClose:()=>ep(!1)}),(0,r.jsx)("style",{children:`
        /* ── Layout ─────────────────────────────────────────────────── */
        .hv-root {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          padding: 0 24px 40px;
          align-items: center;
          justify-content: flex-start;
          background:
            radial-gradient(ellipse 80% 35% at 50% 0%, rgba(14,165,233,0.06) 0%, transparent 70%),
            radial-gradient(ellipse 40% 20% at 20% 100%, rgba(103,232,249,0.03) 0%, transparent 70%);
        }

        /* ── Spotlight hint ─────────────────────────────────────────── */
        .hv-spotlight-hint {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-full);
          cursor: pointer;
          font-family: inherit;
          margin-bottom: 28px;
          position: relative;
          z-index: 1;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .hv-spotlight-hint:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          box-shadow: var(--shadow-md);
          transform: translateY(-1px);
          filter: brightness(1.05);
        }
        .hv-spotlight-hint-text {
          font-size: 13px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .hv-kbd {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 4px;
          padding: 2px 6px;
          line-height: 1.4;
        }
        .hv-kbd-sep {
          font-size: 11px;
          color: var(--text-muted);
        }

        /* ── Hero ───────────────────────────────────────────────────── */
        .hv-hero {
          width: 100%;
          max-width: 900px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 56px 24px 38px;
          position: relative;
          margin-bottom: 10px;
        }

        .hv-hero-glow {
          position: absolute;
          top: 0; left: 50%;
          transform: translateX(-50%);
          width: 700px;
          height: 340px;
          background: radial-gradient(ellipse at 50% 20%, rgba(14,165,233,0.09) 0%, rgba(103,232,249,0.04) 40%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }

        .hv-hero-wave {
          position: relative;
          z-index: 1;
          margin-bottom: 20px;
          filter: drop-shadow(var(--glow));
        }

        .hv-hero-eyebrow {
          position: relative;
          z-index: 1;
          margin-bottom: 8px;
          color: var(--gold);
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .hv-hero-title {
          position: relative;
          z-index: 1;
          font-size: 46px;
          font-weight: 800;
          letter-spacing: 0;
          line-height: 1;
          margin: 0 0 12px;
        }

        .hv-hero-gradient {
          background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 60%, var(--gold) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hv-hero-subtitle {
          position: relative;
          z-index: 1;
          max-width: 560px;
          font-size: 15px;
          color: var(--text-muted);
          margin: 0 0 18px;
          font-weight: 400;
          letter-spacing: 0;
          line-height: 1.55;
        }

        .hv-hero-subtitle strong {
          color: var(--text-primary);
          font-weight: 700;
        }

        /* Stats row */
        .hv-stats-row {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
          padding: 9px 22px;
          margin-bottom: 30px;
          box-shadow: var(--shadow-sm);
        }

        .hv-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 0 18px;
        }

        .hv-stat-value {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          max-width: 110px;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0;
        }

        .hv-stat-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .hv-stat-divider {
          width: 1px;
          height: 24px;
          background: var(--border-subtle);
          flex-shrink: 0;
        }

        /* Quick action cards */
        .hv-quick-cards {
          position: relative;
          z-index: 1;
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .hv-quick-card {
          width: 158px;
          min-height: 158px;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-float) 34%, transparent), transparent),
            var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 5px;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          position: relative;
          overflow: hidden;
          transition: transform var(--t-normal) var(--ease-out), filter var(--t-normal) var(--ease-out);
          opacity: 0;
          animation: hv-card-in 350ms var(--ease-out) both;
        }

        .hv-quick-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, var(--accent-border), transparent);
          opacity: 0;
          transition: opacity var(--t-fast);
        }

        .hv-quick-card:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-lg), 0 0 0 1px var(--accent-border);
          border-color: var(--accent-border);
          filter: brightness(1.04);
        }

        .hv-quick-card:hover::before { opacity: 1; }

        .hv-quick-card--0 { animation-delay: 0ms; }
        .hv-quick-card--1 { animation-delay: 80ms; }
        .hv-quick-card--2 { animation-delay: 160ms; }
        .hv-quick-card--3 { animation-delay: 240ms; }

        @keyframes hv-card-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .hv-quick-card-icon {
          width: 38px;
          height: 38px;
          border-radius: var(--r-md);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 8px;
          flex-shrink: 0;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .hv-quick-card:hover .hv-quick-card-icon {
          background: rgba(14,165,233,0.16);
          border-color: var(--accent);
          transform: translateY(-1px);
          filter: brightness(1.1);
        }
        /* Each card gets a distinct hue */
        .hv-quick-card--0 .hv-quick-card-icon { background: rgba(14,165,233,0.1); border-color: rgba(14,165,233,0.22); color: #38bdf8; }
        .hv-quick-card--1 .hv-quick-card-icon { background: rgba(103,232,249,0.08); border-color: rgba(103,232,249,0.2); color: var(--gold); }
        .hv-quick-card--2 .hv-quick-card-icon { background: rgba(124,90,245,0.1); border-color: rgba(124,90,245,0.22); color: #a78bfa; }
        .hv-quick-card--3 .hv-quick-card-icon { background: rgba(52,211,153,0.08); border-color: rgba(52,211,153,0.2); color: #34d399; }

        .hv-quick-card-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.3;
          letter-spacing: 0;
        }

        .hv-quick-card-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.45;
        }

        .hv-quick-card-cta {
          margin-top: auto;
          padding-top: 10px;
          font-size: 11px;
          font-weight: 800;
          color: var(--accent-hover);
          opacity: 0.74;
          transform: translateX(0);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
        }

        .hv-quick-card:hover .hv-quick-card-cta {
          opacity: 1;
          transform: translateX(3px);
        }

        .hv-command-strip {
          width: 100%;
          max-width: 900px;
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 8px;
          margin: 0 0 20px;
        }

        .hv-signal-card {
          min-width: 0;
          min-height: 64px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.026), rgba(255,255,255,0)),
            var(--bg-elevated);
          color: var(--text-secondary);
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          box-shadow: 0 8px 22px rgba(0,0,0,0.12);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }

        .hv-signal-card:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          color: var(--text-primary);
          transform: translateY(-2px);
          filter: brightness(1.04);
        }

        .hv-signal-icon {
          width: 34px;
          height: 34px;
          border-radius: var(--r-md);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
        }
        .hv-signal-icon svg { width: 17px; height: 17px; }
        .hv-signal-icon--mentions { color: #f472b6; background: rgba(244,114,182,0.1); border-color: rgba(244,114,182,0.22); }
        .hv-signal-icon--unread { color: #38bdf8; background: rgba(56,189,248,0.1); border-color: rgba(56,189,248,0.22); }
        .hv-signal-icon--live { color: #fb7185; background: rgba(251,113,133,0.1); border-color: rgba(251,113,133,0.22); }
        .hv-signal-icon--server { color: #a78bfa; background: rgba(167,139,250,0.1); border-color: rgba(167,139,250,0.22); }
        .hv-signal-icon--voice { color: #34d399; background: rgba(52,211,153,0.1); border-color: rgba(52,211,153,0.22); }
        .hv-signal-icon--uptime { color: var(--gold); background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.22); }

        .hv-signal-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .hv-signal-value {
          font-size: 15px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .hv-signal-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 900px) {
          .hv-command-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }

        @media (max-width: 520px) {
          .hv-command-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .hv-signal-card { min-height: 58px; }
          .hv-signal-icon { width: 30px; height: 30px; }
        }

        .hv-layout {
          width: 100%;
          max-width: 900px;
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 20px;
          align-items: start;
        }

        .hv-left  { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
        .hv-right { display: flex; flex-direction: column; gap: 16px; }

        @media (max-width: 760px) {
          .hv-layout {
            grid-template-columns: 1fr;
          }
          .hv-right { order: -1; }
        }

        /* ── Panel ──────────────────────────────────────────────────── */
        .hv-panel {
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-float) 18%, transparent), transparent 62%),
            var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          position: relative;
          overflow: hidden;
        }
        .hv-panel::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--border-normal), transparent);
        }
        .hv-panel--sm { padding: 17px; gap: 13px; }

        .hv-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .hv-panel-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0;
        }
        .hv-panel-title--sm {
          font-size: 10px;
          margin-bottom: 2px;
        }

        /* ── Header buttons ─────────────────────────────────────────── */
        .hv-header-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px;
          border-radius: var(--r-md);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
          cursor: pointer; font-size: 12px; font-weight: 600;
          font-family: inherit;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .hv-header-btn:hover {
          background: rgba(14,165,233,0.18);
          border-color: var(--accent);
          transform: translateY(-1px);
          filter: brightness(1.06);
        }
        .hv-header-btn--subtle {
          background: var(--bg-deep);
          border-color: var(--border-subtle);
          color: var(--text-secondary);
        }
        .hv-header-btn--subtle:hover {
          background: var(--ch-hover-bg);
          border-color: var(--accent-border);
          color: var(--text-primary);
        }

        /* ── DM list ────────────────────────────────────────────────── */
        .hv-dm-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .hv-dm-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: var(--r-md);
          background: transparent;
          border: 1px solid transparent;
          cursor: pointer;
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          width: 100%;
        }
        .hv-dm-row:hover {
          background: var(--ch-hover-bg);
          border-color: var(--border-subtle);
          transform: translateX(2px);
          filter: brightness(1.04);
        }

        .hv-dm-avatar-wrap {
          position: relative;
          flex-shrink: 0;
          width: 40px; height: 40px;
        }

        .hv-status-dot {
          position: absolute;
          bottom: 0; right: 0;
          width: 11px; height: 11px;
          border-radius: 50%;
          border: 2px solid var(--bg-elevated);
        }
        .hv-status-dot--online  { background: var(--status-online); }
        .hv-status-dot--idle    { background: var(--status-idle); }
        .hv-status-dot--unknown { background: var(--status-offline); }

        .hv-dm-info {
          flex: 1;
          min-width: 0;
        }

        .hv-dm-top {
          display: flex;
          align-items: baseline;
          gap: 6px;
          margin-bottom: 2px;
        }

        .hv-dm-nick {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .hv-dm-time {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
          flex-shrink: 0;
        }

        .hv-dm-preview {
          font-size: 13px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.4;
          margin: 0;
        }

        /* ── Badges / indicators ────────────────────────────────────── */
        .hv-badge {
          background: var(--danger);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: var(--r-full);
          flex-shrink: 0;
        }

        .hv-unread-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: var(--text-secondary);
          flex-shrink: 0;
        }

        /* ── Empty state ────────────────────────────────────────────── */
        .hv-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 34px 18px;
          text-align: center;
          background: color-mix(in srgb, var(--bg-deep) 56%, transparent);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
        }
        .hv-empty--sm { padding: 24px 18px; }

        .hv-empty-art {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 96px;
          height: 64px;
          border-radius: var(--r-xl);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          box-shadow: var(--glow);
        }

        .hv-empty-copy {
          display: grid;
          justify-items: center;
          gap: 6px;
        }

        .hv-empty-title {
          margin: 0;
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0;
        }

        .hv-empty-text {
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.5;
          margin: 0;
          max-width: 280px;
        }

        .hv-empty-actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .hv-mt { margin-top: 4px; }

        /* ── Channel grid ───────────────────────────────────────────── */
        .hv-channel-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 7px;
        }

        .hv-ch-card {
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 11px 13px;
          text-align: left;
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          display: flex;
          flex-direction: column;
          gap: 4px;
          position: relative;
          overflow: hidden;
        }
        .hv-ch-card:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          box-shadow: 0 4px 12px rgba(14,165,233,0.08);
          transform: translateY(-1px);
          filter: brightness(1.04);
        }

        /* accent left-edge on hover */
        .hv-ch-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0;
          width: 2px; bottom: 0;
          background: var(--accent);
          opacity: 0;
          transition: opacity var(--t-fast);
          border-radius: var(--r-xs) 0 0 var(--r-xs);
        }
        .hv-ch-card:hover::before { opacity: 1; }

        .hv-ch-card-header {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .hv-ch-hash {
          font-size: 14px;
          font-weight: 700;
          color: var(--accent);
          line-height: 1;
          flex-shrink: 0;
          opacity: 0.7;
        }

        .hv-ch-name {
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          letter-spacing: 0;
        }

        .hv-ch-topic {
          font-size: 11px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.4;
          margin: 0;
        }

        .hv-ch-count {
          font-size: 10px;
          color: var(--text-muted);
          font-weight: 500;
          letter-spacing: 0;
        }

        .hv-browse-link {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          color: var(--accent);
          font-family: inherit;
          padding: 4px 0 0;
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          letter-spacing: 0;
        }
        .hv-browse-link:hover { color: var(--accent-hover); transform: translateX(2px); opacity: 0.9; }

        /* ── Recent Channels ────────────────────────────────────────── */
        .hv-recent-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .hv-recent-pill {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 4px 10px;
          border-radius: var(--r-full, 9999px);
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          color: var(--text-secondary);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          user-select: none;
        }
        .hv-recent-pill:hover {
          background: var(--ch-hover-bg);
          border-color: var(--accent-border);
          color: var(--text-primary);
          transform: translateY(-1px);
          filter: brightness(1.04);
        }
        .hv-recent-pill--active {
          background: rgba(124, 90, 245, 0.1);
          border-color: var(--accent-border);
          color: var(--accent);
        }
        .hv-recent-pill--active:hover {
          background: rgba(124, 90, 245, 0.18);
          color: var(--accent);
        }
        .hv-recent-pill-hash {
          font-weight: 700;
          opacity: 0.6;
          font-size: 11px;
        }

        /* ── Quick Actions ──────────────────────────────────────────── */
        .hv-actions {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .hv-action-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: var(--r-md);
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          width: 100%;
        }
        .hv-action-row:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
          transform: translateX(2px);
          filter: brightness(1.04);
        }

        .hv-action-icon { font-size: 16px; line-height: 1; flex-shrink: 0; }

        /* ── Launchpad ──────────────────────────────────────────────── */
        .hv-launchpad {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .hv-launch-group {
          display: grid;
          gap: 6px;
        }

        .hv-launch-label {
          padding: 0 2px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .hv-launch-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 5px;
        }

        .hv-launch-tile {
          min-width: 0;
          min-height: 48px;
          display: grid;
          grid-template-columns: 32px minmax(0, 1fr);
          align-items: center;
          gap: 10px;
          padding: 8px;
          border: 1px solid transparent;
          border-radius: var(--r-md);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }

        .hv-launch-tile:hover {
          background: var(--ch-hover-bg);
          border-color: var(--border-subtle);
          color: var(--text-primary);
          transform: translateX(2px);
          filter: brightness(1.04);
        }

        .hv-launch-icon {
          width: 32px;
          height: 32px;
          border-radius: var(--r-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--bg-deep) 72%, transparent);
          border: 1px solid var(--border-subtle);
          color: var(--accent);
        }
        .hv-launch-icon svg { width: 17px; height: 17px; }

        .hv-launch-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .hv-launch-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .hv-launch-meta {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.25;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* ── Invite tip ─────────────────────────────────────────────── */
        .hv-invite-tip {
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .hv-invite-label {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0;
        }

        .hv-invite-code-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .hv-invite-code {
          flex: 1;
          font-family: 'Fira Code', 'Cascadia Code', monospace;
          font-size: 13px;
          color: var(--gold);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          padding: 6px 10px;
          user-select: all;
        }

        .hv-copy-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px; height: 30px;
          border-radius: var(--r-sm);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          cursor: pointer;
          color: var(--text-secondary);
          flex-shrink: 0;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .hv-copy-btn:hover { background: var(--bg-float); color: var(--text-primary); transform: translateY(-1px); filter: brightness(1.06); }
        .hv-copy-btn--copied { color: var(--status-online); border-color: rgba(52,211,153,0.4); }

        /* ── Server Info ────────────────────────────────────────────── */
        .hv-server-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .hv-server-logo { flex-shrink: 0; }

        .hv-server-details { flex: 1; min-width: 0; }

        .hv-server-name {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0;
          margin-bottom: 3px;
        }

        .hv-server-account {
          font-size: 12px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .hv-server-account strong { color: var(--text-secondary); font-weight: 600; }

        .hv-account-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--status-online);
          flex-shrink: 0;
        }
        .hv-account-dot--guest { background: var(--status-idle); }

        .hv-muted { color: var(--text-muted); }

        .hv-features {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }

        .hv-feature-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0;
          padding: 2px 7px;
          border-radius: var(--r-full);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
        }

        /* ── Forms ──────────────────────────────────────────────────── */
        .hv-new-dm-form {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
        }

        .hv-input {
          flex: 1;
          min-width: 120px;
          padding: 7px 10px;
          border-radius: var(--r-md);
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
        }
        .hv-input:focus { outline: none; border-color: var(--accent-border); }
        .hv-input::placeholder { color: var(--text-muted); }

        .hv-btn-primary {
          padding: 7px 14px;
          border-radius: var(--r-md);
          background: var(--accent);
          color: #fff;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          transition: opacity var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          white-space: nowrap;
        }
        .hv-btn-primary:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); filter: brightness(1.06); }
        .hv-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

        .hv-btn-ghost {
          padding: 7px 12px;
          border-radius: var(--r-md);
          background: none;
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          font-family: inherit;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          white-space: nowrap;
        }
        .hv-btn-ghost:hover { color: var(--text-secondary); border-color: var(--border-normal); transform: translateY(-1px); filter: brightness(1.06); }

        /* ── Activity Feed ──────────────────────────────────────────── */
        .activity-feed {
          display: flex;
          flex-direction: column;
          gap: 6px;
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .activity-item {
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          overflow: hidden;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }

        .activity-item-btn {
          display: block;
          width: 100%;
          padding: 9px 13px;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
        }
        .activity-item:hover {
          border-color: var(--accent-border);
          background: var(--bg-float);
          transform: translateY(-1px);
          filter: brightness(1.03);
        }

        .activity-item-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 3px;
        }

        .activity-channel-badge {
          font-size: 10px;
          font-weight: 700;
          color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          padding: 1px 6px;
          border-radius: var(--r-sm);
          flex-shrink: 0;
          letter-spacing: 0;
        }

        .activity-time {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
          flex-shrink: 0;
        }

        .activity-content {
          font-size: 12px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin: 0;
          line-height: 1.4;
        }

        .activity-nick {
          font-weight: 600;
          color: var(--text-primary);
        }

        .activity-system {
          font-style: italic;
          color: var(--text-muted);
        }

        /* ── Animation ──────────────────────────────────────────────── */
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 200ms var(--ease-out) both; }

        .hv-root button:focus-visible,
        .hv-root input:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .hv-root *,
          .hv-root *::before,
          .hv-root *::after {
            animation-duration: 0ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0ms !important;
          }

          .animate-fade-in,
          .hv-quick-card {
            animation: none !important;
            opacity: 1;
          }

          .hv-spotlight-hint:hover,
          .hv-quick-card:hover,
          .hv-quick-card:hover .hv-quick-card-icon,
          .hv-quick-card:hover .hv-quick-card-cta,
          .hv-signal-card:hover,
          .hv-header-btn:hover,
          .hv-dm-row:hover,
          .hv-ch-card:hover,
          .hv-browse-link:hover,
          .hv-recent-pill:hover,
          .hv-action-row:hover,
          .hv-launch-tile:hover,
          .hv-copy-btn:hover,
          .hv-btn-primary:hover,
          .hv-btn-ghost:hover,
          .activity-item:hover {
            transform: none;
          }
        }
      `})]})}function p(){return(0,r.jsxs)("svg",{width:"80",height:"48",viewBox:"0 0 80 48",fill:"none","aria-hidden":!0,children:[(0,r.jsx)("ellipse",{cx:"40",cy:"40",rx:"36",ry:"6",fill:"var(--accent-subtle)"}),(0,r.jsx)("path",{d:"M4 28 Q14 18 24 28 Q34 38 44 28 Q54 18 64 28 Q74 38 84 28",stroke:"var(--accent)",strokeWidth:"2",strokeLinecap:"round",fill:"none",opacity:"0.5"}),(0,r.jsx)("path",{d:"M4 36 Q14 26 24 36 Q34 46 44 36 Q54 26 64 36 Q74 46 84 36",stroke:"var(--gold)",strokeWidth:"1.5",strokeLinecap:"round",fill:"none",opacity:"0.35"}),(0,r.jsx)("circle",{cx:"40",cy:"16",r:"6",fill:"var(--accent-subtle)",stroke:"var(--accent-border)",strokeWidth:"1.5"}),(0,r.jsx)("path",{d:"M37 16h6M40 13v6",stroke:"var(--accent)",strokeWidth:"1.5",strokeLinecap:"round"})]})}function v({size:e=36}){return(0,r.jsxs)("svg",{width:e,height:e,viewBox:"0 0 36 36",fill:"none","aria-label":"Ocean",children:[(0,r.jsx)("rect",{width:"36",height:"36",rx:"10",fill:"url(#hv-logo-grad)"}),(0,r.jsx)("path",{d:"M18 8L28 14V22L18 28L8 22V14L18 8Z",stroke:"white",strokeWidth:"1.5",strokeLinejoin:"round",fill:"rgba(255,255,255,0.08)"}),(0,r.jsx)("circle",{cx:"18",cy:"18",r:"4",fill:"white",fillOpacity:"0.9"}),(0,r.jsx)("defs",{children:(0,r.jsxs)("linearGradient",{id:"hv-logo-grad",x1:"0",y1:"0",x2:"36",y2:"36",gradientUnits:"userSpaceOnUse",children:[(0,r.jsx)("stop",{offset:"0%",stopColor:"var(--accent)"}),(0,r.jsx)("stop",{offset:"100%",stopColor:"#0369a1"})]})})]})}function x(){return(0,r.jsx)("svg",{width:"11",height:"11",viewBox:"0 0 11 11",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M5.5 1v9M1 5.5h9"})})}function m(){return(0,r.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.6",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("rect",{x:"5",y:"5",width:"9",height:"9",rx:"1.5"}),(0,r.jsx)("path",{d:"M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"})]})}function u(){return(0,r.jsx)("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M3 8l4 4 6-6"})})}function g(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("rect",{x:"2",y:"3",width:"6",height:"6",rx:"1.5"}),(0,r.jsx)("rect",{x:"12",y:"3",width:"6",height:"6",rx:"1.5"}),(0,r.jsx)("rect",{x:"2",y:"11",width:"6",height:"6",rx:"1.5"}),(0,r.jsx)("rect",{x:"12",y:"11",width:"6",height:"6",rx:"1.5"})]})}function f(){return(0,r.jsx)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M3 4.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5.5L2 17v-1.5V5.5a1 1 0 0 1 1-1Z"})})}function b(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("circle",{cx:"9",cy:"9",r:"5.5"}),(0,r.jsx)("path",{d:"M17 17l-3.5-3.5"})]})}function j(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("circle",{cx:"7.5",cy:"7",r:"3"}),(0,r.jsx)("circle",{cx:"13.5",cy:"7",r:"3"}),(0,r.jsx)("path",{d:"M1 17c0-3 2.9-5 6.5-5"}),(0,r.jsx)("path",{d:"M19 17c0-3-2.9-5-6.5-5"}),(0,r.jsx)("path",{d:"M7.5 12c0-2.5 2.7-4 6-4",strokeOpacity:"0"}),(0,r.jsx)("path",{d:"M10.5 12c1.7 0 3.2.5 4.3 1.3"})]})}function k(){return(0,r.jsx)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M12.5 2.5L17.5 7.5L13 12L11 18L8 12L2 9L8 7L12.5 2.5Z"})})}function y(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("circle",{cx:"10",cy:"8",r:"3.5"}),(0,r.jsx)("path",{d:"M3 17c0-3.3 3.1-6 7-6"}),(0,r.jsx)("path",{d:"M15 13v5M17.5 15.5h-5"})]})}function w(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("path",{d:"M10 3a4.5 4.5 0 0 0-4.5 4.5v3.2L4 13h12l-1.5-2.3V7.5A4.5 4.5 0 0 0 10 3Z"}),(0,r.jsx)("path",{d:"M8.2 15a2 2 0 0 0 3.6 0"})]})}function N(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("circle",{cx:"10",cy:"10",r:"7"}),(0,r.jsx)("path",{d:"M10 6v4l2.5 1.5"})]})}function C(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("path",{d:"M10 2.5 16 6v8l-6 3.5L4 14V6l6-3.5Z"}),(0,r.jsx)("path",{d:"M10 7v6M7 8.5h6"})]})}function L(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("path",{d:"M4 15V9M10 15V5M16 15v-3"}),(0,r.jsx)("path",{d:"M3 17h14"})]})}function S(){return(0,r.jsx)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M10 2.5 11.7 8l5.3 2-5.3 2L10 17.5 8.3 12 3 10l5.3-2L10 2.5Z"})})}function M(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("path",{d:"M10 3a7 7 0 0 0 0 14h1.2a1.8 1.8 0 0 0 1.1-3.2.9.9 0 0 1 .5-1.6H14a3 3 0 0 0 0-6h-.5A7 7 0 0 0 10 3Z"}),(0,r.jsx)("circle",{cx:"7",cy:"8",r:".7"}),(0,r.jsx)("circle",{cx:"10",cy:"6.5",r:".7"}),(0,r.jsx)("circle",{cx:"13",cy:"8.2",r:".7"})]})}function z(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("path",{d:"M4 8v4h3l4 3V5L7 8H4Z"}),(0,r.jsx)("path",{d:"M14 7.5a4 4 0 0 1 0 5M16 5a7 7 0 0 1 0 10"})]})}function O(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("path",{d:"M8.5 6.5 10 5a3.5 3.5 0 0 1 5 5l-1.5 1.5"}),(0,r.jsx)("path",{d:"M11.5 13.5 10 15a3.5 3.5 0 0 1-5-5l1.5-1.5"}),(0,r.jsx)("path",{d:"M8 12l4-4"})]})}function q(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("rect",{x:"3",y:"5",width:"14",height:"10",rx:"2"}),(0,r.jsx)("path",{d:"M6 8h.01M9 8h.01M12 8h.01M15 8h.01M6 11h.01M9 11h5"})]})}function B(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("circle",{cx:"10",cy:"10",r:"7"}),(0,r.jsx)("path",{d:"M10 9v4M10 6.8h.01"})]})}function W(){return(0,r.jsx)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M3 10h3l2-5 4 10 2-5h3"})})}function T(){return(0,r.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0,children:[(0,r.jsx)("path",{d:"M4 11H3a1.5 1.5 0 0 1 0-3h1l9-3v9l-9-3Z"}),(0,r.jsx)("path",{d:"M7 12.5 8 16H6l-1-4"}),(0,r.jsx)("path",{d:"M16 8.2a3 3 0 0 1 0 2.6"})]})}function A(){return(0,r.jsxs)("svg",{width:"220",height:"80",viewBox:"0 0 220 80",fill:"none","aria-hidden":!0,children:[(0,r.jsxs)("defs",{children:[(0,r.jsxs)("linearGradient",{id:"hero-wave-grad1",x1:"0",y1:"0",x2:"220",y2:"0",gradientUnits:"userSpaceOnUse",children:[(0,r.jsx)("stop",{offset:"0%",stopColor:"var(--accent)",stopOpacity:"0.6"}),(0,r.jsx)("stop",{offset:"100%",stopColor:"var(--gold)",stopOpacity:"0.4"})]}),(0,r.jsxs)("linearGradient",{id:"hero-wave-grad2",x1:"0",y1:"0",x2:"220",y2:"0",gradientUnits:"userSpaceOnUse",children:[(0,r.jsx)("stop",{offset:"0%",stopColor:"var(--gold)",stopOpacity:"0.25"}),(0,r.jsx)("stop",{offset:"100%",stopColor:"var(--accent)",stopOpacity:"0.15"})]})]}),(0,r.jsx)("circle",{cx:"110",cy:"38",r:"28",fill:"var(--accent-subtle)"}),(0,r.jsx)("circle",{cx:"110",cy:"38",r:"18",fill:"rgba(124,90,245,0.08)",stroke:"var(--accent-border)",strokeWidth:"1"}),(0,r.jsx)("path",{d:"M110 14 L113.2 33.2 L130 24 L118.8 37.2 L132 44 L113.5 42.4 L115 60 L110 44.5 L105 60 L106.5 42.4 L88 44 L101.2 37.2 L90 24 L106.8 33.2 Z",fill:"var(--accent)",opacity:"0.6"}),(0,r.jsx)("circle",{cx:"110",cy:"38",r:"5",fill:"var(--accent)"}),(0,r.jsx)("circle",{cx:"110",cy:"38",r:"3",fill:"var(--gold)",opacity:"0.8"}),(0,r.jsx)("path",{d:"M10 60 Q32 50 55 60 Q77 70 100 60 Q122 50 145 60 Q167 70 190 60 Q200 57 210 60",stroke:"url(#hero-wave-grad1)",strokeWidth:"1.5",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("path",{d:"M0 70 Q22 62 44 70 Q66 78 88 70 Q110 62 132 70 Q154 78 176 70 Q198 62 220 70",stroke:"url(#hero-wave-grad2)",strokeWidth:"1",strokeLinecap:"round",fill:"none"})]})}e.s(["default",0,function(){let e=(0,n.useOnyxStore)(e=>e.status),i=(0,t.useRouter)();return(0,a.useEffect)(()=>{"disconnected"===e&&i.replace("/")},[e,i]),(0,a.useEffect)(()=>{let e=()=>{let e=n.useOnyxStore.getState().client;e?.sendRaw("QUIT","Page closed")};return window.addEventListener("pagehide",e),window.addEventListener("beforeunload",e),()=>{window.removeEventListener("pagehide",e),window.removeEventListener("beforeunload",e)}},[]),(0,r.jsx)(h,{})}],27627)}]);