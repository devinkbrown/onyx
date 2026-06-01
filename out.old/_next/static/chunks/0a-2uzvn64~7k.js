(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,99994,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0});var n={formatUrl:function(){return s},formatWithValidation:function(){return l},urlObjectKeys:function(){return c}};for(var a in n)Object.defineProperty(r,a,{enumerable:!0,get:n[a]});let i=e.r(44066)._(e.r(42426)),o=/https?|ftp|gopher|file/;function s(e){let{auth:t,hostname:r}=e,n=e.protocol||"",a=e.pathname||"",s=e.hash||"",c=e.query||"",l=!1;t=t?encodeURIComponent(t).replace(/%3A/i,":")+"@":"",e.host?l=t+e.host:r&&(l=t+(~r.indexOf(":")?`[${r}]`:r),e.port&&(l+=":"+e.port)),c&&"object"==typeof c&&(c=String(i.urlQueryToSearchParams(c)));let u=e.search||c&&`?${c}`||"";return n&&!n.endsWith(":")&&(n+=":"),e.slashes||(!n||o.test(n))&&!1!==l?(l="//"+(l||""),a&&"/"!==a[0]&&(a="/"+a)):l||(l=""),s&&"#"!==s[0]&&(s="#"+s),u&&"?"!==u[0]&&(u="?"+u),a=a.replace(/[?#]/g,encodeURIComponent),u=u.replace("#","%23"),`${n}${l}${a}${u}${s}`}let c=["auth","hash","host","hostname","href","path","pathname","port","protocol","query","search","slashes"];function l(e){return s(e)}},63965,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"useMergedRef",{enumerable:!0,get:function(){return a}});let n=e.r(93737);function a(e,t){let r=(0,n.useRef)(null),a=(0,n.useRef)(null);return(0,n.useCallback)(n=>{if(null===n){let e=r.current;e&&(r.current=null,e());let t=a.current;t&&(a.current=null,t())}else e&&(r.current=i(e,n)),t&&(a.current=i(t,n))},[e,t])}function i(e,t){if("function"!=typeof e)return e.current=t,()=>{e.current=null};{let r=e(t);return"function"==typeof r?r:()=>e(null)}}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},37060,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"isLocalURL",{enumerable:!0,get:function(){return i}});let n=e.r(95538),a=e.r(41277);function i(e){if(!(0,n.isAbsoluteUrl)(e))return!0;try{let t=(0,n.getLocationOrigin)(),r=new URL(e,t);return r.origin===t&&(0,a.hasBasePath)(r.pathname)}catch(e){return!1}}},59546,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"errorOnce",{enumerable:!0,get:function(){return n}});let n=e=>{}},35397,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0});var n={default:function(){return x},useLinkStatus:function(){return b}};for(var a in n)Object.defineProperty(r,a,{enumerable:!0,get:n[a]});let i=e.r(44066),o=e.r(30152),s=i._(e.r(93737)),c=e.r(99994),l=e.r(31884),u=e.r(63965),d=e.r(95538),p=e.r(81429);e.r(79935);let f=e.r(22844),h=e.r(18029),m=e.r(37060),g=e.r(70402);function x(t){var r,n;let a,i,x,[b,y]=(0,s.useOptimistic)(h.IDLE_LINK_STATUS),j=(0,s.useRef)(null),{href:_,as:w,children:O,prefetch:k=null,passHref:P,replace:S,shallow:C,scroll:T,onClick:N,onMouseEnter:M,onTouchStart:R,legacyBehavior:L=!1,onNavigate:E,transitionTypes:U,ref:z,unstable_dynamicOnHover:A,...I}=t;a=O,L&&("string"==typeof a||"number"==typeof a)&&(a=(0,o.jsx)("a",{children:a}));let $=s.default.useContext(l.AppRouterContext),K=!1!==k,B=!1!==k?null===(n=k)||"auto"===n?g.FetchStrategy.PPR:g.FetchStrategy.Full:g.FetchStrategy.PPR,D="string"==typeof(r=w||_)?r:(0,c.formatUrl)(r);if(L){if(a?.$$typeof===Symbol.for("react.lazy"))throw Object.defineProperty(Error("`<Link legacyBehavior>` received a direct child that is either a Server Component, or JSX that was loaded with React.lazy(). This is not supported. Either remove legacyBehavior, or make the direct child a Client Component that renders the Link's `<a>` tag."),"__NEXT_ERROR_CODE",{value:"E863",enumerable:!1,configurable:!0});i=s.default.Children.only(a)}let F=L?i&&"object"==typeof i&&i.ref:z,J=s.default.useCallback(e=>(null!==$&&(j.current=(0,h.mountLinkInstance)(e,D,$,B,K,y)),()=>{j.current&&((0,h.unmountLinkForCurrentNavigation)(j.current),j.current=null),(0,h.unmountPrefetchableInstance)(e)}),[K,D,$,B,y]),q={ref:(0,u.useMergedRef)(J,F),onClick(t){L||"function"!=typeof N||N(t),L&&i.props&&"function"==typeof i.props.onClick&&i.props.onClick(t),!$||t.defaultPrevented||function(t,r,n,a,i,o,c){if("u">typeof window){let l,{nodeName:u}=t.currentTarget;if("A"===u.toUpperCase()&&((l=t.currentTarget.getAttribute("target"))&&"_self"!==l||t.metaKey||t.ctrlKey||t.shiftKey||t.altKey||t.nativeEvent&&2===t.nativeEvent.which)||t.currentTarget.hasAttribute("download"))return;if(!(0,m.isLocalURL)(r)){a&&(t.preventDefault(),location.replace(r));return}if(t.preventDefault(),o){let e=!1;if(o({preventDefault:()=>{e=!0}}),e)return}let{dispatchNavigateAction:d}=e.r(66437);s.default.startTransition(()=>{d(r,a?"replace":"push",!1===i?f.ScrollBehavior.NoScroll:f.ScrollBehavior.Default,n.current,c)})}}(t,D,j,S,T,E,U)},onMouseEnter(e){L||"function"!=typeof M||M(e),L&&i.props&&"function"==typeof i.props.onMouseEnter&&i.props.onMouseEnter(e),$&&K&&(0,h.onNavigationIntent)(e.currentTarget,!0===A)},onTouchStart:function(e){L||"function"!=typeof R||R(e),L&&i.props&&"function"==typeof i.props.onTouchStart&&i.props.onTouchStart(e),$&&K&&(0,h.onNavigationIntent)(e.currentTarget,!0===A)}};return(0,d.isAbsoluteUrl)(D)?q.href=D:L&&!P&&("a"!==i.type||"href"in i.props)||(q.href=(0,p.addBasePath)(D)),x=L?s.default.cloneElement(i,q):(0,o.jsx)("a",{...I,...q,children:a}),(0,o.jsx)(v.Provider,{value:b,children:x})}e.r(59546);let v=(0,s.createContext)(h.IDLE_LINK_STATUS),b=()=>(0,s.useContext)(v);("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},36925,e=>{"use strict";var t=e.i(30152),r=e.i(93737);let n=new Intl.NumberFormat("en-US");e.s(["default",0,function(){let[e,a]=(0,r.useState)(null),[i,o]=(0,r.useState)(!1);(0,r.useEffect)(()=>{let e=!1;return fetch("/stats/index.json",{cache:"no-store"}).then(e=>{if(!e.ok)throw Error(`chanstats ${e.status}`);return e.json()}).then(t=>{e||a(t)}).catch(()=>{e||o(!0)}),()=>{e=!0}},[]);let s=(0,r.useMemo)(()=>{let t=e?.channels??[];return{top:t[0],messages:t.reduce((e,t)=>e+(t.total_messages||0),0),joins:t.reduce((e,t)=>e+(t.total_joins||0),0),peak:t.reduce((e,t)=>Math.max(e,t.peak_members||0),0)}},[e]);return(0,t.jsxs)("section",{id:"activity",className:"cs-root","aria-label":"Community activity",children:[(0,t.jsxs)("div",{className:"cs-heading",children:[(0,t.jsx)("span",{className:"cs-kicker",children:"Live archive"}),(0,t.jsx)("h2",{children:"Community activity, exported by Ophion."}),(0,t.jsx)("p",{children:"Channel statistics are generated directly inside the server and served as static JSON and HTML. No stats bot needs to join, part, or reconnect."})]}),(0,t.jsxs)("div",{className:"cs-grid",children:[(0,t.jsxs)("a",{href:"/stats/",className:"cs-main-card",children:[(0,t.jsx)("span",{className:"cs-label",children:"Stats portal"}),(0,t.jsx)("strong",{children:s.top?.name??"#root"}),(0,t.jsx)("span",{children:i?"Open the generated channel statistics.":s.top?`${n.format(s.top.total_messages)} tracked messages`:"Loading channel statistics..."})]}),(0,t.jsxs)("div",{className:"cs-metric",children:[(0,t.jsx)("span",{children:"Messages"}),(0,t.jsx)("strong",{children:e?n.format(s.messages):"..."})]}),(0,t.jsxs)("div",{className:"cs-metric",children:[(0,t.jsx)("span",{children:"Joins"}),(0,t.jsx)("strong",{children:e?n.format(s.joins):"..."})]}),(0,t.jsxs)("div",{className:"cs-metric",children:[(0,t.jsx)("span",{children:"Peak"}),(0,t.jsx)("strong",{children:e?n.format(s.peak):"..."})]}),(0,t.jsxs)("div",{className:"cs-metric",children:[(0,t.jsx)("span",{children:"Tracked"}),(0,t.jsx)("strong",{children:e?n.format(e.tracked_channels):"..."})]})]}),(0,t.jsx)("style",{children:`
        .cs-root {
          position: relative;
          z-index: 1;
          max-width: 1240px;
          margin: 0 auto;
          padding: 0 clamp(20px, 5vw, 80px) 90px;
        }
        .cs-heading {
          max-width: 740px;
          margin: 0 auto 28px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .cs-kicker {
          display: inline-flex;
          width: fit-content;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--accent-border);
          background: var(--accent-subtle);
          color: var(--accent);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .cs-heading h2 {
          margin: 0;
          color: var(--text-primary);
          font-size: clamp(2rem, 4vw, 3rem);
          font-weight: 850;
          line-height: 1.08;
          letter-spacing: -0.03em;
        }
        .cs-heading p {
          margin: 0;
          color: var(--text-secondary);
          font-size: clamp(0.98rem, 1.4vw, 1.08rem);
          line-height: 1.65;
        }
        .cs-grid {
          display: grid;
          grid-template-columns: 1.4fr repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .cs-main-card,
        .cs-metric {
          min-width: 0;
          min-height: 156px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-end;
          gap: 8px;
          padding: 22px;
          border-radius: 18px;
          border: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-base) 88%, transparent);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
        }
        .cs-main-card {
          text-decoration: none;
          background:
            radial-gradient(circle at 20% 20%, var(--accent-subtle), transparent 58%),
            color-mix(in srgb, var(--bg-elevated) 88%, transparent);
          border-color: var(--accent-border);
          transition: border-color 160ms var(--ease-out), transform 160ms var(--ease-out);
        }
        .cs-main-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent);
          text-decoration: none;
        }
        .cs-label,
        .cs-metric span {
          color: var(--text-muted);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .cs-main-card strong {
          color: var(--text-primary);
          font-size: clamp(1.5rem, 2.4vw, 2rem);
          line-height: 1.05;
          letter-spacing: -0.025em;
        }
        .cs-main-card > span:last-child {
          color: var(--text-secondary);
          font-size: 0.9rem;
          line-height: 1.45;
        }
        .cs-metric strong {
          color: var(--accent);
          font-size: clamp(1.45rem, 2.6vw, 2.15rem);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.035em;
          line-height: 1;
        }
        @media (max-width: 980px) {
          .cs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .cs-main-card { grid-column: 1 / -1; }
        }
        @media (max-width: 640px) {
          .cs-root {
            padding-left: 12px;
            padding-right: 12px;
            padding-bottom: 64px;
          }
          .cs-heading {
            align-items: flex-start;
            text-align: left;
            margin-bottom: 20px;
          }
          .cs-heading h2 { font-size: clamp(1.75rem, 8vw, 2.25rem); }
          .cs-grid { gap: 10px; }
          .cs-main-card,
          .cs-metric {
            min-height: 126px;
            padding: 18px;
            border-radius: 14px;
          }
        }
        @media (max-width: 375px) {
          .cs-root {
            padding-left: 8px;
            padding-right: 8px;
          }
          .cs-grid { grid-template-columns: 1fr; }
        }
      `})]})}])}]);