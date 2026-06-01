(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,36057,e=>{"use strict";var r=e.i(30152),t=e.i(93737);e.i(63880);var a=e.i(79239);function n({label:e,hint:t,error:a,required:i,children:o}){return(0,r.jsxs)("div",{className:`form-field${a?" form-field--error":""}`,children:[(0,r.jsxs)("label",{className:"form-label",children:[e,i&&(0,r.jsx)("span",{className:"form-required",children:"*"})]}),o,t&&!a&&(0,r.jsx)("p",{className:"form-hint",children:t}),a&&(0,r.jsx)("p",{className:"form-error",children:a}),(0,r.jsx)("style",{children:`
        .form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        /* 13px semibold label per spec */
        .form-label {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--text-secondary);
          user-select: none;
          line-height: 1.4;
        }

        /* Accent-colored required asterisk */
        .form-required {
          color: var(--accent);
          margin-left: 3px;
          font-weight: 700;
        }

        /* Target child inputs, selects, and textareas */
        .form-field > input,
        .form-field > select,
        .form-field > textarea,
        .form-field > .form-control {
          height: 36px;
          padding: 0 12px;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color var(--t-fast, 150ms) ease, box-shadow var(--t-fast, 150ms) ease;
          outline: none;
          width: 100%;
        }
        .form-field > textarea,
        .form-field > textarea.form-control {
          height: auto;
          padding: 9px 12px;
        }
        .form-field > select {
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
        }

        /* Focus: accent border + subtle glow */
        .form-field > input:focus,
        .form-field > select:focus,
        .form-field > textarea:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }

        /* Error state: red border + red glow */
        .form-field.form-field--error > input,
        .form-field.form-field--error > select,
        .form-field.form-field--error > textarea {
          border-color: var(--danger);
          box-shadow: 0 0 0 3px var(--danger-subtle);
        }

        /* 12px muted helper text */
        .form-hint {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.45;
          margin: 0;
        }

        /* 12px red error text */
        .form-error {
          font-size: 12px;
          color: var(--danger);
          line-height: 1.45;
          margin: 0;
        }
      `})]})}var i=e.i(76525),o=e.i(6663);let s="wss://eshmaki.me:8080",l=/[^a-zA-Z0-9\-_\[\]{}\\|`^]/,c=["Connecting…","Authenticating…","Loading channels…"];function d(){return(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("circle",{cx:"8",cy:"5.5",r:"2.5",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("path",{d:"M2.5 13.5C2.5 11.015 5.015 9 8 9s5.5 2.015 5.5 4.5",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"})]})}function p(){return(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("rect",{x:"3",y:"7",width:"10",height:"7.5",rx:"1.5",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("path",{d:"M5 7V5a3 3 0 016 0v2",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("circle",{cx:"8",cy:"10.5",r:"1.2",fill:"currentColor"})]})}function x({off:e}){return e?(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M2 2l12 12",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round"}),(0,r.jsx)("path",{d:"M6.5 4.2C7 4.07 7.5 4 8 4c3.5 0 6 4 6 4s-.65 1.1-1.8 2.1",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("path",{d:"M4.2 5.7C2.9 6.8 2 8 2 8s2.5 4 6 4c.9 0 1.75-.24 2.5-.64",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("path",{d:"M6.5 9.4A2 2 0 009.4 6.6",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"})]}):(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("circle",{cx:"8",cy:"8",r:"1.8",stroke:"currentColor",strokeWidth:"1.3",fill:"none"})]})}function u(){return(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",className:"spin-icon",children:[(0,r.jsx)("circle",{cx:"8",cy:"8",r:"6",stroke:"currentColor",strokeWidth:"1.5",strokeOpacity:"0.2"}),(0,r.jsx)("path",{d:"M8 2a6 6 0 016 6",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round"})]})}function h({onSwitch:e}){let g=(0,a.useOnyxStore)(e=>e.connect),f=(0,a.useOnyxStore)(e=>e.status),m=(0,a.useOnyxStore)(e=>e.notifications),[b,v]=(0,t.useState)(""),[k,y]=(0,t.useState)(""),[w,j]=(0,t.useState)(!1),[N,C]=(0,t.useState)(""),[z,S]=(0,t.useState)(!1),[W,Y]=(0,t.useState)(!1),[L,M]=(0,t.useState)(0),[B,E]=(0,t.useState)(!1),O=(0,t.useRef)(null),[R,I]=(0,t.useState)(null),[A,P]=(0,t.useState)(!1);(0,t.useEffect)(()=>{O.current?.focus()},[]),(0,t.useEffect)(()=>{let e=(0,o.loadCredentials)();e&&(I(e),P(!0),v(e.nick),Y(!0))},[]);let T=(0,t.useCallback)(()=>{if(!R)return;let e=function(e){try{let r=new URL(e);return"wss:"===r.protocol||"ws:"===r.protocol?r.toString():null}catch{return null}}(R.server);if(!e){C("Saved server URL is invalid"),E(!0);return}C(""),E(!0),g({url:e,nick:R.nick,password:(0,o.getAuthSecret)(R)})},[R,g]);(0,t.useEffect)(()=>{if("connecting"!==f)return void M(0);let e=setInterval(()=>{M(e=>(e+1)%c.length)},1200);return()=>clearInterval(e)},[f]);let X="connecting"===f,$=m.filter(e=>"error"===e.type).at(-1),U=B&&!X?$:void 0,q=b.length>0&&l.test(b),F=b.length>30,H=b.includes(" ")?"Nickname cannot contain spaces":q?"Invalid characters in nickname":F?"Nickname too long (max 30)":"",V=()=>{S(!0),setTimeout(()=>S(!1),600)},G=!!(N||U);return A&&R?(0,r.jsxs)("div",{className:"auto-reconnect",children:[(0,r.jsxs)("div",{className:"arc-brand","aria-hidden":"true",children:[(0,r.jsx)("span",{className:"arc-brand-line"}),(0,r.jsx)("span",{className:"arc-brand-text",children:"Ocean access"}),(0,r.jsx)("span",{className:"arc-brand-line"})]}),(0,r.jsx)("div",{className:"arc-avatar","aria-hidden":"true",children:R.nick.slice(0,2).toUpperCase()}),(0,r.jsxs)("div",{className:"arc-info",children:[(0,r.jsx)("span",{className:"arc-nick",children:R.nick}),(0,r.jsx)("span",{className:"arc-server",children:function(e){try{return new URL(e).host}catch{return e}}(R.server)})]}),G&&(0,r.jsxs)("div",{className:"arc-error",role:"alert",children:[(0,r.jsxs)("svg",{width:"13",height:"13",viewBox:"0 0 14 14",fill:"none","aria-hidden":"true",style:{flexShrink:0,marginTop:1},children:[(0,r.jsx)("circle",{cx:"7",cy:"7",r:"6",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("path",{d:"M7 4v3.5",stroke:"currentColor",strokeWidth:"1.4",strokeLinecap:"round"}),(0,r.jsx)("circle",{cx:"7",cy:"10",r:"0.8",fill:"currentColor"})]}),N||U?.text]}),(0,r.jsxs)("div",{className:"arc-actions",children:[X?(0,r.jsxs)("div",{className:"arc-connecting",children:[(0,r.jsx)(u,{}),(0,r.jsx)("span",{children:c[L]})]}):(0,r.jsx)(i.default,{variant:"primary",fullWidth:!0,onClick:T,className:"arc-primary",children:U?"Retry":"Connect"}),(0,r.jsx)("button",{type:"button",className:"arc-switch",onClick:()=>{P(!1),E(!1)},children:"Use different account"}),(0,r.jsx)("button",{type:"button",className:"arc-forget",onClick:()=>{(0,o.clearCredentials)(),I(null),P(!1),v(""),y(""),Y(!1),E(!1)},children:"Forget me"})]}),(0,r.jsx)("style",{children:`
          .auto-reconnect {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 18px;
            padding: 4px 0 2px;
          }
          .arc-brand {
            width: 100%;
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            gap: 10px;
            color: var(--text-muted);
            opacity: 0.86;
          }
          .arc-brand-line {
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--border-normal));
          }
          .arc-brand-line:last-child {
            background: linear-gradient(90deg, var(--border-normal), transparent);
          }
          .arc-brand-text {
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0;
            text-transform: uppercase;
            color: var(--gold);
          }
          .arc-avatar {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background:
              radial-gradient(circle at 34% 24%, rgba(255,255,255,0.32), transparent 24%),
              linear-gradient(145deg, var(--gold), var(--accent) 54%, var(--bg-overlay));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: 850;
            color: var(--bg-void);
            box-shadow:
              0 0 0 4px var(--bg-elevated),
              0 0 0 5px var(--accent-border),
              0 18px 34px rgba(0,0,0,0.42),
              0 0 30px var(--accent-glow);
            letter-spacing: 0;
            transition: transform var(--t-normal) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .auto-reconnect:hover .arc-avatar {
            transform: translateY(-2px) scale(1.02);
            filter: brightness(1.05);
          }
          .arc-info {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
            text-align: center;
          }
          .arc-nick {
            font-size: 24px;
            font-weight: 850;
            color: var(--text-primary);
            letter-spacing: 0;
            line-height: 1.1;
          }
          .arc-server {
            font-size: 13px;
            color: var(--text-muted);
          }
          .arc-token-badge {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0;
            color: var(--success);
            background: rgba(52,211,153,0.1);
            border: 1px solid rgba(52,211,153,0.25);
            border-radius: 4px;
            padding: 2px 8px;
            margin-top: 2px;
          }
          .arc-actions {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding-top: 4px;
          }
          .auto-reconnect .btn {
            height: 44px;
            border-radius: var(--r-lg);
            transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .auto-reconnect .btn:hover:not(:disabled) {
            transform: translateY(-1px);
            filter: brightness(1.04) drop-shadow(0 8px 20px var(--accent-glow));
          }
          .auto-reconnect .btn:active:not(:disabled) {
            transform: translateY(0) scale(0.99);
            filter: brightness(0.96);
          }
          .arc-connecting {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 12px 10px;
            font-size: 14px;
            color: var(--text-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: var(--r-lg);
            background: var(--bg-base);
          }
          .arc-switch {
            background: none;
            border: none;
            font-family: inherit;
            font-size: 13px;
            color: var(--text-secondary);
            cursor: pointer;
            text-align: center;
            padding: 5px;
            transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .arc-switch:hover { color: var(--text-primary); transform: translateY(-1px); }
          .arc-switch:active { transform: translateY(0); opacity: 0.78; }
          .arc-forget {
            background: none;
            border: none;
            font-family: inherit;
            font-size: 12px;
            color: var(--text-muted);
            cursor: pointer;
            text-align: center;
            padding: 2px 5px;
            transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .arc-forget:hover { color: var(--danger); transform: translateY(-1px); }
          .arc-forget:active { transform: translateY(0); opacity: 0.76; }
          .arc-error {
            display: flex;
            align-items: flex-start;
            gap: 7px;
            width: 100%;
            padding: 9px 12px;
            background: rgba(248,113,113,0.07);
            border: 1px solid rgba(248,113,113,0.28);
            border-radius: var(--r-md);
            color: var(--danger);
            font-size: 12.5px;
            line-height: 1.45;
            text-align: left;
            animation: fadeIn 200ms var(--ease-out);
          }
          @media (prefers-reduced-motion: reduce) {
            .arc-avatar,
            .auto-reconnect .btn,
            .arc-switch,
            .arc-forget,
            .arc-error {
              animation: none;
              transition-duration: 0.001ms;
            }
            .auto-reconnect:hover .arc-avatar,
            .auto-reconnect .btn:hover:not(:disabled),
            .arc-switch:hover,
            .arc-forget:hover {
              transform: none;
            }
          }
        `})]}):(0,r.jsxs)("form",{onSubmit:e=>{if(e.preventDefault(),!b.trim()){C("Nickname is required"),V();return}if(H){C(H),V();return}C(""),W?(0,o.saveCredentials)({nick:b.trim(),server:s,password:k||void 0}):(0,o.clearCredentials)(),E(!0),g({url:s,nick:b.trim(),password:k||void 0})},className:`auth-form-fields${z?" form-shake":""}`,noValidate:!0,children:[(0,r.jsxs)("div",{className:"login-brand",children:[(0,r.jsx)("div",{className:"login-brand-mark","aria-hidden":"true",children:(0,r.jsx)("span",{className:"login-brand-core"})}),(0,r.jsxs)("div",{className:"login-brand-copy",children:[(0,r.jsx)("span",{className:"login-kicker",children:"Secure relay"}),(0,r.jsx)("h1",{className:"login-title",children:"Enter the midnight"}),(0,r.jsx)("p",{className:"login-subtitle",children:"eshmaki.me IRC access"})]})]}),(0,r.jsxs)(n,{label:"Username",required:!0,children:[(0,r.jsxs)("div",{className:"input-wrap",children:[(0,r.jsx)("span",{className:"input-icon input-icon--left","aria-hidden":"true",children:(0,r.jsx)(d,{})}),(0,r.jsx)("input",{ref:O,id:"login-nick",type:"text",placeholder:"your_nick",value:b,onChange:e=>{v(e.target.value),C(""),E(!1)},autoComplete:"username",maxLength:32,"aria-describedby":H?"login-nick-error":void 0,"aria-invalid":!!H||void 0,className:`onyx-input onyx-input--has-icon${H||G&&!b.trim()?" onyx-input--error":""}`,disabled:X}),(0,r.jsxs)("span",{className:`nick-count${b.length>25?" nick-count--warn":""}${b.length>30?" nick-count--error":""}`,children:[b.length,"/30"]})]}),H&&(0,r.jsx)("span",{id:"login-nick-error",className:"field-hint field-hint--error",role:"alert",children:H})]}),(0,r.jsx)(n,{label:"Password",hint:"Leave blank to join as a guest",children:(0,r.jsxs)("div",{className:"input-wrap",children:[(0,r.jsx)("span",{className:"input-icon input-icon--left","aria-hidden":"true",children:(0,r.jsx)(p,{})}),(0,r.jsx)("input",{type:w?"text":"password",placeholder:"••••••••",value:k,onChange:e=>{y(e.target.value),C(""),E(!1)},autoComplete:"current-password",className:"onyx-input onyx-input--has-icon onyx-input--has-icon-right",disabled:X}),k.length>0&&!w&&(0,r.jsx)("span",{className:"sasl-badge",children:"SASL"}),(0,r.jsx)("button",{type:"button",className:"eye-toggle",onClick:()=>j(e=>!e),"aria-label":w?"Hide password":"Show password",tabIndex:-1,children:(0,r.jsx)(x,{off:w})})]})}),(0,r.jsxs)("label",{className:"remember-row",children:[(0,r.jsx)("input",{type:"checkbox",checked:W,onChange:e=>Y(e.target.checked),className:"remember-checkbox",disabled:X}),(0,r.jsx)("span",{className:"remember-text",children:"Remember me"})]}),(N||U)&&(0,r.jsxs)("div",{className:"auth-error",role:"alert",children:[(0,r.jsx)("span",{className:"auth-error-icon","aria-hidden":"true",children:(0,r.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",children:[(0,r.jsx)("circle",{cx:"7",cy:"7",r:"6",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("path",{d:"M7 4v3.5",stroke:"currentColor",strokeWidth:"1.4",strokeLinecap:"round"}),(0,r.jsx)("circle",{cx:"7",cy:"10",r:"0.8",fill:"currentColor"})]})}),N||U?.text]}),(0,r.jsx)(i.default,{type:"submit",variant:"primary",fullWidth:!0,loading:X,className:"login-submit",children:X?(0,r.jsxs)("span",{className:"btn-loading-inner",children:[(0,r.jsx)(u,{}),c[L]]}):"Sign In"}),(0,r.jsxs)("p",{className:"switch-link",children:["New here?"," ",(0,r.jsx)("button",{type:"button",className:"link-btn",onClick:e,children:"Create an account"})]}),(0,r.jsx)("style",{children:`
        .auth-form-fields {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .login-brand {
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: 14px;
          padding: 2px 0 6px;
        }
        .login-brand-mark {
          width: 46px;
          height: 46px;
          border-radius: var(--r-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            linear-gradient(145deg, color-mix(in srgb, var(--accent) 20%, var(--bg-overlay)), var(--bg-base)),
            var(--bg-base);
          border: 1px solid var(--accent-border);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.08),
            0 12px 24px rgba(0,0,0,0.28),
            0 0 26px var(--accent-glow);
          position: relative;
          overflow: hidden;
          transition: transform var(--t-normal) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .login-brand-mark::before,
        .login-brand-mark::after {
          content: '';
          position: absolute;
          inset: 8px;
          border: 1px solid var(--border-normal);
          border-radius: 50%;
          opacity: 0.74;
        }
        .login-brand-mark::after {
          inset: 15px;
          border-color: var(--gold);
          opacity: 0.5;
        }
        .login-brand-core {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--gold);
          box-shadow:
            0 0 0 5px var(--gold-subtle),
            0 0 22px var(--gold);
          z-index: 1;
        }
        .auth-form-fields:hover .login-brand-mark {
          transform: translateY(-1px) scale(1.02);
          filter: brightness(1.05);
        }
        .login-brand-copy {
          min-width: 0;
        }
        .login-kicker {
          display: block;
          margin-bottom: 2px;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0;
          line-height: 1.1;
          text-transform: uppercase;
          color: var(--gold);
        }
        .login-title {
          margin: 0;
          color: var(--text-primary);
          font-size: 34px;
          font-weight: 900;
          line-height: 0.98;
          letter-spacing: 0;
        }
        .login-subtitle {
          margin: 7px 0 0;
          color: var(--text-muted);
          font-size: 13px;
          font-weight: 550;
        }

        /* ── Shake animation on submit failure ── */
        @keyframes form-shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-5px); }
          30%       { transform: translateX(5px); }
          45%       { transform: translateX(-4px); }
          60%       { transform: translateX(4px); }
          75%       { transform: translateX(-2px); }
          90%       { transform: translateX(2px); }
        }
        .form-shake { animation: form-shake 0.55s cubic-bezier(0.36,0.07,0.19,0.97) both; }

        /* ── Input wrapper ── */
        .input-wrap {
          position: relative;
          display: flex;
          align-items: center;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .input-wrap:hover {
          transform: translateY(-1px);
          filter: brightness(1.04);
        }
        .input-wrap:focus-within {
          transform: translateY(-1px);
          filter: brightness(1.08);
        }

        /* ── Input icon ── */
        .input-icon {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          pointer-events: none;
          color: var(--text-muted);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          z-index: 1;
        }
        .input-icon--left { left: 13px; }
        .input-wrap:focus-within .input-icon--left {
          color: var(--accent);
          transform: translateY(-50%) scale(1.04);
          filter: drop-shadow(0 0 8px var(--accent-glow));
        }

        /* ── Base input ── */
        .onyx-input {
          width: 100%;
          height: 46px;
          padding: 0 14px;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-elevated) 42%, transparent), transparent),
            var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          box-sizing: border-box;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.035),
            0 1px 0 rgba(0,0,0,0.22);
        }
        .onyx-input::placeholder {
          color: var(--text-muted);
          opacity: 0.62;
        }
        .onyx-input--has-icon { padding-left: 40px; }
        .onyx-input--has-icon-right { padding-right: 80px; }
        .onyx-input--mono {
          font-family: var(--font-mono, 'ui-monospace', monospace);
          font-size: 13px;
          letter-spacing: 0;
        }

        /* Focus — accent glow ring */
        .onyx-input:focus {
          outline: none;
          background: var(--bg-elevated);
          border-color: var(--accent);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.06),
            0 0 0 1px var(--accent-border),
            0 0 0 4px var(--accent-subtle),
            0 12px 28px rgba(0,0,0,0.18);
        }
        .onyx-input:hover:not(:focus):not(:disabled) {
          border-color: var(--accent-border);
          background: var(--bg-elevated);
        }
        .onyx-input:active:not(:disabled) {
          filter: brightness(0.98);
        }
        .onyx-input:disabled { opacity: 0.45; cursor: not-allowed; }

        /* Error state */
        .onyx-input--error {
          border-color: rgba(248,113,113,0.6);
          background: rgba(248,113,113,0.03);
        }
        .onyx-input--error:focus {
          border-color: var(--danger);
          box-shadow: 0 0 0 4px rgba(248,113,113,0.15);
        }

        .field-hint { display: block; font-size: 12px; margin-top: 5px; }
        .field-hint--error { color: var(--danger); }

        /* ── Nick character counter ── */
        .nick-count {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 11px;
          color: var(--text-muted);
          pointer-events: none;
          font-variant-numeric: tabular-nums;
          opacity: 0.68;
        }
        .nick-count--warn { color: var(--gold); opacity: 1; }
        .nick-count--error { color: var(--danger); opacity: 1; }
        /* Nick field needs right padding to avoid text running under the counter */
        .input-wrap .onyx-input:not(.onyx-input--has-icon-right) { padding-right: 48px; }

        /* ── Password visibility toggle ── */
        .eye-toggle {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          z-index: 2;
          padding: 0;
        }
        .eye-toggle:hover {
          color: var(--text-secondary);
          background: rgba(14,165,233,0.08);
          transform: translateY(-50%) scale(1.04);
          filter: brightness(1.08);
        }
        .eye-toggle:active {
          transform: translateY(-50%) scale(0.96);
          filter: brightness(0.92);
        }
        .eye-toggle:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        /* SASL badge — shown when password has content and eye is hidden */
        .sasl-badge {
          position: absolute;
          right: 44px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0;
          color: var(--gold);
          background: rgba(103,232,249,0.08);
          border: 1px solid rgba(103,232,249,0.2);
          border-radius: 3px;
          padding: 2px 5px;
          pointer-events: none;
          white-space: nowrap;
          box-shadow: 0 0 14px rgba(103,232,249,0.08);
        }

        /* ── Remember me — custom toggle ── */
        .remember-row {
          display: flex;
          align-items: center;
          gap: 9px;
          cursor: pointer;
          user-select: none;
          width: fit-content;
          padding: 2px 0 1px;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .remember-row:hover {
          transform: translateY(-1px);
          filter: brightness(1.05);
        }
        /* Hide the browser checkbox; we style the label instead */
        .remember-checkbox {
          appearance: none;
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border: 1.5px solid var(--border-normal);
          border-radius: var(--r-xs);
          background: var(--bg-base);
          cursor: pointer;
          flex-shrink: 0;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          position: relative;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        }
        .remember-checkbox:hover {
          border-color: var(--accent);
          filter: brightness(1.12);
        }
        .remember-checkbox:checked {
          background: var(--accent);
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(14,165,233,0.18);
        }
        /* Checkmark via clip-path on ::after */
        .remember-checkbox:checked::after {
          content: '';
          position: absolute;
          inset: 0;
          background: url("data:image/svg+xml,%3Csvg viewBox='0 0 10 10' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 5l2.5 2.5L8 3' stroke='white' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 10px no-repeat;
        }
        .remember-checkbox:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .remember-checkbox:disabled { opacity: 0.4; cursor: not-allowed; }
        .remember-text {
          font-size: 13px;
          color: var(--text-secondary);
        }
        .remember-row:has(.remember-checkbox:disabled) { opacity: 0.5; cursor: not-allowed; }

        /* ── Error banner ── */
        .auth-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(248,113,113,0.07);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: var(--r-md);
          color: var(--danger);
          font-size: 13px;
          line-height: 1.5;
          animation: fadeIn 180ms var(--ease-out);
        }
        .auth-error-icon {
          flex-shrink: 0;
          margin-top: 1px;
          display: flex;
        }

        /* ── Spinner in button ── */
        .btn-loading-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .spin-icon {
          animation: spin-anim 0.8s linear infinite;
        }
        @keyframes spin-anim {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .auth-form-fields .btn {
          height: 46px;
          border-radius: var(--r-lg);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .auth-form-fields .login-submit {
          margin-top: 2px;
          letter-spacing: 0;
          text-transform: uppercase;
          box-shadow:
            0 10px 24px rgba(0,0,0,0.34),
            0 0 0 1px rgba(255,255,255,0.09) inset,
            0 0 24px var(--accent-glow);
        }
        .auth-form-fields .login-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.05) drop-shadow(0 8px 20px var(--accent-glow));
        }
        .auth-form-fields .login-submit:active:not(:disabled) {
          transform: translateY(0) scale(0.99);
          filter: brightness(0.95);
        }

        /* ── Footer links ── */
        .switch-link {
          text-align: center;
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          padding-top: 1px;
        }
        .link-btn {
          color: var(--accent);
          background: none;
          border: none;
          cursor: pointer;
          font-size: inherit;
          font-family: inherit;
          padding: 2px 3px;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .link-btn:hover {
          color: var(--text-link-hover);
          text-decoration: underline;
          transform: translateY(-1px);
          filter: brightness(1.06);
        }
        .link-btn:active {
          transform: translateY(0);
          opacity: 0.76;
        }

        @media (max-width: 420px) {
          .login-brand {
            gap: 12px;
          }
          .login-brand-mark {
            width: 42px;
            height: 42px;
          }
          .login-title {
            font-size: 27px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .form-shake,
          .spin-icon,
          .auth-error {
            animation: none;
          }
          .login-brand-mark,
          .input-wrap,
          .input-icon,
          .onyx-input,
          .eye-toggle,
          .remember-row,
          .remember-checkbox,
          .auth-form-fields .btn,
          .link-btn {
            transition-duration: 0.001ms;
          }
          .auth-form-fields:hover .login-brand-mark,
          .input-wrap:hover,
          .input-wrap:focus-within,
          .input-wrap:focus-within .input-icon--left,
          .eye-toggle:hover,
          .eye-toggle:active,
          .remember-row:hover,
          .auth-form-fields .login-submit:hover:not(:disabled),
          .auth-form-fields .login-submit:active:not(:disabled),
          .link-btn:hover,
          .link-btn:active {
            transform: none;
          }
        }
      `})]})}function g(){return(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("circle",{cx:"8",cy:"5.5",r:"2.5",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("path",{d:"M2.5 13.5C2.5 11.015 5.015 9 8 9s5.5 2.015 5.5 4.5",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"})]})}function f(){return(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("rect",{x:"3",y:"7",width:"10",height:"7.5",rx:"1.5",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("path",{d:"M5 7V5a3 3 0 016 0v2",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("circle",{cx:"8",cy:"10.5",r:"1.2",fill:"currentColor"})]})}function m(){return(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("rect",{x:"1",y:"2",width:"14",height:"5",rx:"1.5",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("rect",{x:"1",y:"9",width:"14",height:"5",rx:"1.5",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("circle",{cx:"12.5",cy:"4.5",r:"1",fill:"currentColor"}),(0,r.jsx)("circle",{cx:"12.5",cy:"11.5",r:"1",fill:"currentColor"})]})}function b({off:e}){return e?(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M2 2l12 12",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round"}),(0,r.jsx)("path",{d:"M6.5 4.2C7 4.07 7.5 4 8 4c3.5 0 6 4 6 4s-.65 1.1-1.8 2.1",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("path",{d:"M4.2 5.7C2.9 6.8 2 8 2 8s2.5 4 6 4c.9 0 1.75-.24 2.5-.64",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("path",{d:"M6.5 9.4A2 2 0 009.4 6.6",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"})]}):(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("path",{d:"M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z",stroke:"currentColor",strokeWidth:"1.3",strokeLinecap:"round",fill:"none"}),(0,r.jsx)("circle",{cx:"8",cy:"8",r:"1.8",stroke:"currentColor",strokeWidth:"1.3",fill:"none"})]})}function v(){return(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("circle",{cx:"8",cy:"8",r:"6.5",fill:"rgba(52,211,153,0.15)",stroke:"var(--success)",strokeWidth:"1.2"}),(0,r.jsx)("path",{d:"M5 8l2.2 2.2L11 5.5",stroke:"var(--success)",strokeWidth:"1.4",strokeLinecap:"round",strokeLinejoin:"round"})]})}function k(){return(0,r.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"none","aria-hidden":"true",className:"spin-icon",children:[(0,r.jsx)("circle",{cx:"8",cy:"8",r:"6",stroke:"currentColor",strokeWidth:"1.5",strokeOpacity:"0.2"}),(0,r.jsx)("path",{d:"M8 2a6 6 0 016 6",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round"})]})}let y={none:"",weak:"Weak",medium:"Medium",strong:"Strong"},w=/\b(account|nick(?:name)?)\b.*\b(register(?:ed|ation)?|created|success(?:ful(?:ly)?)?)\b|\b(register(?:ed|ation)?|created|success(?:ful(?:ly)?)?)\b.*\b(account|nick(?:name)?)\b/i,j=/\b(already|exists|taken|invalid|fail(?:ed|ure)?|error|denied|reject(?:ed)?|missing|need|unknown command|too short)\b/i;async function N(e,r){let t=a.useOnyxStore.getState().client;if(!t)throw Error("Connection failed");await new Promise((a,n)=>{let i,o=!1,s=e=>{o||(o=!0,t.extraMessageHandlers.delete(l),clearTimeout(i),e?n(e):a())},l=e=>{let r=e.params[e.params.length-1]??"",t=e.command.toUpperCase();if("421"===t&&"ACCOUNT"===(e.params[1]??"").toUpperCase())return void s(Error(r||"ACCOUNT REGISTER is not supported by this server"));if(/^[45]\d\d$/.test(t)&&r)return void s(Error(r));if("NOTICE"===t||"PRIVMSG"===t||/^[29]\d\d$/.test(t)){if(j.test(r))return void s(Error(r));w.test(r)&&s()}};t.extraMessageHandlers.add(l),i=setTimeout(()=>s(Error("Registration response timed out")),15e3),r(`ACCOUNT REGISTER ${e}`)})}function C({onSwitch:e}){let o=(0,a.useOnyxStore)(e=>e.connect),s=(0,a.useOnyxStore)(e=>e.sendRaw),[l,c]=(0,t.useState)("fill"),[d,p]=(0,t.useState)(""),[x,u]=(0,t.useState)(""),[h,w]=(0,t.useState)(""),[j,z]=(0,t.useState)(!1),[S,W]=(0,t.useState)(!1),[Y,L]=(0,t.useState)("wss://eshmaki.me:8080"),[M,B]=(0,t.useState)(!1),[E,O]=(0,t.useState)(""),[R,I]=(0,t.useState)(!1),[A,P]=(0,t.useState)(!1),[T,X]=(0,t.useState)(!1),[$,U]=(0,t.useState)(!1),[q,F]=(0,t.useState)(!1),H=(0,t.useRef)(null);(0,t.useEffect)(()=>{H.current?.focus()},[]);let V=function(e){if(!e)return"none";let r=0;return(e.length>=8&&r++,e.length>=12&&r++,/[A-Z]/.test(e)&&r++,/[0-9]/.test(e)&&r++,/[^A-Za-z0-9]/.test(e)&&r++,r<=1)?"weak":r<=3?"medium":"strong"}(x),G=h.length>0&&x===h,D=h.length>0&&x!==h,Z=T&&!d.trim()?"Nickname required":"",K=$&&!x?"Password required":$&&x.length<6?"Minimum 6 characters":"",_=q&&D?"Passwords do not match":"",J=()=>{I(!0),setTimeout(()=>I(!1),600)},Q=async e=>{if(e.preventDefault(),X(!0),U(!0),F(!0),!d.trim()){O("Nickname required"),J();return}if(!x){O("Password required"),J();return}if(x.length<6){O("Password must be at least 6 characters"),J();return}if(x!==h){O("Passwords do not match"),J();return}O(""),P(!0);try{o({url:Y.trim(),nick:d.trim(),realname:d.trim()}),await new Promise((e,r)=>{if("connected"===a.useOnyxStore.getState().status)return void e();let t=a.useOnyxStore.subscribe(e=>e.status,a=>{"connected"===a&&(t(),e()),"error"===a&&(t(),r(Error("Connection failed")))});setTimeout(()=>{t(),r(Error("Connection timed out"))},15e3)}),await N(x,s),c("verify")}catch(e){O(e instanceof Error?e.message:"Registration failed")}finally{P(!1)}};return"verify"===l?(0,r.jsxs)("div",{className:"verify-step animate-fade-in",children:[(0,r.jsx)("div",{className:"verify-icon","aria-hidden":"true",children:(0,r.jsxs)("svg",{width:"48",height:"48",viewBox:"0 0 48 48",fill:"none",children:[(0,r.jsx)("circle",{cx:"24",cy:"24",r:"22",fill:"rgba(52,211,153,0.1)",stroke:"var(--success)",strokeWidth:"1.5"}),(0,r.jsx)("path",{d:"M14 24l7 7 13-14",stroke:"var(--success)",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",fill:"none"})]})}),(0,r.jsx)("h3",{className:"verify-title",children:"Account created!"}),(0,r.jsxs)("p",{className:"verify-text",children:[(0,r.jsx)("strong",{className:"verify-nick",children:d})," is registered. Sign in with your nickname and password to get started."]}),(0,r.jsx)("p",{className:"verify-subtext",children:"Your account is active immediately — no verification step needed."}),(0,r.jsx)("button",{className:"link-btn",onClick:e,children:"Sign in →"}),(0,r.jsx)("style",{children:`
          .verify-step { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 8px 0; text-align: center; }
          .verify-icon { margin-bottom: 4px; animation: check-pop 0.4s cubic-bezier(0.34,1.56,0.64,1); }
          @keyframes check-pop {
            from { transform: scale(0.5); opacity: 0; }
            to   { transform: scale(1); opacity: 1; }
          }
          .verify-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
          .verify-text { font-size: 14px; color: var(--text-secondary); line-height: 1.6; margin: 0; }
          .verify-nick { color: var(--accent); font-weight: 600; }
          .verify-subtext { font-size: 13px; color: var(--text-muted); margin: 0; }
          .link-btn {
            color: var(--accent);
            background: none;
            border: none;
            cursor: pointer;
            font-size: 14px;
            margin-top: 4px;
            font-family: inherit;
            transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .link-btn:hover {
            color: var(--text-link-hover);
            text-decoration: underline;
            transform: translateY(-1px);
            filter: brightness(1.06);
          }
          .link-btn:active {
            transform: translateY(0);
            opacity: 0.76;
          }
          @media (prefers-reduced-motion: reduce) {
            .verify-step,
            .verify-icon {
              animation: none;
            }
            .link-btn {
              transition-duration: 0.001ms;
            }
            .link-btn:hover,
            .link-btn:active {
              transform: none;
            }
          }
        `})]}):(0,r.jsxs)("form",{onSubmit:Q,className:`auth-form-fields${R?" form-shake":""}`,noValidate:!0,children:[(0,r.jsxs)("div",{className:"register-brand",children:[(0,r.jsx)("div",{className:"register-brand-mark","aria-hidden":"true",children:(0,r.jsx)("span",{className:"register-brand-core"})}),(0,r.jsxs)("div",{className:"register-brand-copy",children:[(0,r.jsx)("span",{className:"register-kicker",children:"Ocean registry"}),(0,r.jsx)("h1",{className:"register-title",children:"Claim the midnight"}),(0,r.jsx)("p",{className:"register-subtitle",children:"eshmaki.me IRC account"})]})]}),(0,r.jsxs)(n,{label:"Username",required:!0,children:[(0,r.jsxs)("div",{className:"input-wrap",children:[(0,r.jsx)("span",{className:"input-icon input-icon--left","aria-hidden":"true",children:(0,r.jsx)(g,{})}),(0,r.jsx)("input",{ref:H,type:"text",placeholder:"coolname",value:d,onChange:e=>p(e.target.value),onBlur:()=>X(!0),autoComplete:"username",maxLength:30,className:`onyx-input onyx-input--has-icon${Z?" onyx-input--error":""}`,disabled:A})]}),Z&&(0,r.jsx)("span",{className:"field-hint field-hint--error",children:Z})]}),(0,r.jsxs)(n,{label:"Password",required:!0,children:[(0,r.jsxs)("div",{className:"input-wrap",children:[(0,r.jsx)("span",{className:"input-icon input-icon--left","aria-hidden":"true",children:(0,r.jsx)(f,{})}),(0,r.jsx)("input",{type:j?"text":"password",placeholder:"••••••••",value:x,onChange:e=>u(e.target.value),onBlur:()=>U(!0),autoComplete:"new-password",className:`onyx-input onyx-input--has-icon onyx-input--has-icon-right${K?" onyx-input--error":""}`,disabled:A}),(0,r.jsx)("button",{type:"button",className:"eye-toggle",onClick:()=>z(e=>!e),"aria-label":j?"Hide password":"Show password",tabIndex:-1,children:(0,r.jsx)(b,{off:j})})]}),x.length>0&&(0,r.jsxs)("div",{className:"strength-wrap","aria-label":`Password strength: ${y[V]}`,children:[(0,r.jsx)("div",{className:"strength-bar",children:(0,r.jsx)("div",{className:`strength-fill strength-fill--${V}`})}),(0,r.jsx)("span",{className:`strength-label strength-label--${V}`,children:y[V]})]}),K&&(0,r.jsx)("span",{className:"field-hint field-hint--error",children:K})]}),(0,r.jsxs)(n,{label:"Confirm Password",required:!0,children:[(0,r.jsxs)("div",{className:"input-wrap",children:[(0,r.jsx)("span",{className:"input-icon input-icon--left","aria-hidden":"true",children:(0,r.jsx)(f,{})}),(0,r.jsx)("input",{type:S?"text":"password",placeholder:"••••••••",value:h,onChange:e=>w(e.target.value),onBlur:()=>F(!0),autoComplete:"new-password",className:`onyx-input onyx-input--has-icon onyx-input--has-icon-right${_?" onyx-input--error":G?" onyx-input--success":""}`,disabled:A}),G?(0,r.jsx)("span",{className:"confirm-check",children:(0,r.jsx)(v,{})}):(0,r.jsx)("button",{type:"button",className:"eye-toggle",onClick:()=>W(e=>!e),"aria-label":S?"Hide password":"Show password",tabIndex:-1,children:(0,r.jsx)(b,{off:S})})]}),_&&(0,r.jsx)("span",{className:"field-hint field-hint--error",children:_}),G&&(0,r.jsx)("span",{className:"field-hint field-hint--success",children:"Passwords match"})]}),(0,r.jsxs)("button",{type:"button",className:"advanced-toggle",onClick:()=>B(e=>!e),children:[(0,r.jsx)("span",{className:`advanced-arrow${M?" open":""}`,"aria-hidden":"true",children:(0,r.jsx)("svg",{width:"10",height:"10",viewBox:"0 0 10 10",fill:"none",children:(0,r.jsx)("path",{d:"M3 2l4 3-4 3",stroke:"currentColor",strokeWidth:"1.6",strokeLinecap:"round",strokeLinejoin:"round"})})}),"Advanced"]}),M&&(0,r.jsx)(n,{label:"Server",children:(0,r.jsxs)("div",{className:"input-wrap",children:[(0,r.jsx)("span",{className:"input-icon input-icon--left","aria-hidden":"true",children:(0,r.jsx)(m,{})}),(0,r.jsx)("input",{type:"text",placeholder:"wss://server/gateway",value:Y,onChange:e=>L(e.target.value),className:"onyx-input onyx-input--has-icon onyx-input--mono",disabled:A})]})}),E&&(0,r.jsxs)("div",{className:"auth-error",role:"alert",children:[(0,r.jsx)("span",{className:"auth-error-icon","aria-hidden":"true",children:(0,r.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",children:[(0,r.jsx)("circle",{cx:"7",cy:"7",r:"6",stroke:"currentColor",strokeWidth:"1.3",fill:"none"}),(0,r.jsx)("path",{d:"M7 4v3.5",stroke:"currentColor",strokeWidth:"1.4",strokeLinecap:"round"}),(0,r.jsx)("circle",{cx:"7",cy:"10",r:"0.8",fill:"currentColor"})]})}),E]}),(0,r.jsx)(i.default,{type:"submit",variant:"primary",fullWidth:!0,loading:A,className:"register-submit",children:A?(0,r.jsxs)("span",{className:"btn-loading-inner",children:[(0,r.jsx)(k,{}),"Creating account…"]}):"Create Account"}),(0,r.jsxs)("p",{className:"switch-link",children:["Already have an account?"," ",(0,r.jsx)("button",{type:"button",className:"link-btn",onClick:e,children:"Sign in"})]}),(0,r.jsx)("style",{children:`
        .auth-form-fields {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .register-brand {
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: 14px;
          padding: 2px 0 6px;
        }
        .register-brand-mark {
          width: 46px;
          height: 46px;
          border-radius: var(--r-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            linear-gradient(145deg, color-mix(in srgb, var(--gold) 16%, var(--bg-overlay)), var(--bg-base)),
            var(--bg-base);
          border: 1px solid var(--accent-border);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.08),
            0 12px 24px rgba(0,0,0,0.28),
            0 0 26px var(--accent-glow);
          position: relative;
          overflow: hidden;
          transition: transform var(--t-normal) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .register-brand-mark::before,
        .register-brand-mark::after {
          content: '';
          position: absolute;
          inset: 8px;
          border: 1px solid var(--border-normal);
          border-radius: 50%;
          opacity: 0.74;
        }
        .register-brand-mark::after {
          inset: 15px;
          border-color: var(--gold);
          opacity: 0.5;
        }
        .register-brand-core {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--gold);
          box-shadow:
            0 0 0 5px var(--gold-subtle),
            0 0 22px var(--gold);
          z-index: 1;
        }
        .auth-form-fields:hover .register-brand-mark {
          transform: translateY(-1px) scale(1.02);
          filter: brightness(1.05);
        }
        .register-brand-copy {
          min-width: 0;
        }
        .register-kicker {
          display: block;
          margin-bottom: 2px;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0;
          line-height: 1.1;
          text-transform: uppercase;
          color: var(--gold);
        }
        .register-title {
          margin: 0;
          color: var(--text-primary);
          font-size: 34px;
          font-weight: 900;
          line-height: 0.98;
          letter-spacing: 0;
        }
        .register-subtitle {
          margin: 7px 0 0;
          color: var(--text-muted);
          font-size: 13px;
          font-weight: 550;
        }

        /* ── Shake animation on submit failure ── */
        @keyframes form-shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-5px); }
          30%       { transform: translateX(5px); }
          45%       { transform: translateX(-4px); }
          60%       { transform: translateX(4px); }
          75%       { transform: translateX(-2px); }
          90%       { transform: translateX(2px); }
        }
        .form-shake { animation: form-shake 0.55s cubic-bezier(0.36,0.07,0.19,0.97) both; }

        /* ── Input wrapper ── */
        .input-wrap {
          position: relative;
          display: flex;
          align-items: center;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .input-wrap:hover {
          transform: translateY(-1px);
          filter: brightness(1.04);
        }
        .input-wrap:focus-within {
          transform: translateY(-1px);
          filter: brightness(1.08);
        }

        /* ── Input icon ── */
        .input-icon {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          pointer-events: none;
          color: var(--text-muted);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          z-index: 1;
        }
        .input-icon--left { left: 13px; }
        .input-wrap:focus-within .input-icon--left {
          color: var(--accent);
          transform: translateY(-50%) scale(1.04);
          filter: drop-shadow(0 0 8px var(--accent-glow));
        }

        /* ── Base input ── */
        .onyx-input {
          width: 100%;
          height: 46px;
          padding: 0 14px;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-elevated) 42%, transparent), transparent),
            var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          box-sizing: border-box;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.035),
            0 1px 0 rgba(0,0,0,0.22);
        }
        .onyx-input::placeholder {
          color: var(--text-muted);
          opacity: 0.62;
        }
        .onyx-input--has-icon { padding-left: 40px; }
        .onyx-input--has-icon-right { padding-right: 44px; }
        .onyx-input--mono {
          font-family: var(--font-mono, 'ui-monospace', monospace);
          font-size: 13px;
          letter-spacing: 0;
        }

        /* Focus — accent glow ring */
        .onyx-input:focus {
          outline: none;
          background: var(--bg-elevated);
          border-color: var(--accent);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.06),
            0 0 0 1px var(--accent-border),
            0 0 0 4px var(--accent-subtle),
            0 12px 28px rgba(0,0,0,0.18);
        }
        .onyx-input:hover:not(:focus):not(:disabled) {
          border-color: var(--accent-border);
          background: var(--bg-elevated);
        }
        .onyx-input:active:not(:disabled) {
          filter: brightness(0.98);
        }
        .onyx-input:disabled { opacity: 0.45; cursor: not-allowed; }

        /* Error state */
        .onyx-input--error {
          border-color: rgba(248,113,113,0.6);
          background: rgba(248,113,113,0.03);
        }
        .onyx-input--error:focus {
          border-color: var(--danger);
          box-shadow: 0 0 0 4px rgba(248,113,113,0.15);
        }

        /* Success state */
        .onyx-input--success {
          border-color: rgba(52,211,153,0.5);
          background: rgba(52,211,153,0.03);
        }
        .onyx-input--success:focus {
          border-color: var(--success);
          box-shadow: 0 0 0 4px rgba(52,211,153,0.12);
        }

        /* Field hints */
        .field-hint { display: block; font-size: 12px; margin-top: 5px; }
        .field-hint--error   { color: var(--danger); }
        .field-hint--success { color: var(--success); }

        /* ── Password strength bar ── */
        .strength-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 7px;
        }
        .strength-bar {
          flex: 1;
          height: 3px;
          background: var(--border-subtle);
          border-radius: var(--r-full);
          overflow: hidden;
        }
        .strength-fill {
          height: 100%;
          width: 100%;
          border-radius: var(--r-full);
          transform-origin: left center;
          transition: transform var(--t-normal) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .strength-fill--none   { transform: scaleX(0); background: transparent; }
        .strength-fill--weak   { transform: scaleX(0.33); background: var(--danger); }
        .strength-fill--medium { transform: scaleX(0.66); background: var(--warning); }
        .strength-fill--strong { transform: scaleX(1); background: var(--success); }

        .strength-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0;
          min-width: 40px;
          text-align: right;
        }
        .strength-label--weak   { color: var(--danger); }
        .strength-label--medium { color: var(--warning); }
        .strength-label--strong { color: var(--success); }

        /* ── Password visibility toggle ── */
        .eye-toggle {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          z-index: 2;
          padding: 0;
        }
        .eye-toggle:hover {
          color: var(--text-secondary);
          background: rgba(14,165,233,0.08);
          transform: translateY(-50%) scale(1.04);
          filter: brightness(1.08);
        }
        .eye-toggle:active {
          transform: translateY(-50%) scale(0.96);
          filter: brightness(0.92);
        }
        .eye-toggle:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        /* ── Confirm checkmark ── */
        .confirm-check {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          pointer-events: none;
          z-index: 2;
          animation: check-pop 0.25s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes check-pop {
          from { transform: translateY(-50%) scale(0.6); opacity: 0; }
          to   { transform: translateY(-50%) scale(1); opacity: 1; }
        }

        /* ── Advanced toggle ── */
        .advanced-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--text-secondary);
          background: none;
          border: none;
          cursor: pointer;
          padding: 1px 0 2px;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          align-self: flex-start;
          font-family: inherit;
        }
        .advanced-toggle:hover {
          color: var(--text-primary);
          transform: translateY(-1px);
          filter: brightness(1.06);
        }
        .advanced-toggle:active {
          transform: translateY(0);
          opacity: 0.76;
        }
        .advanced-arrow {
          display: inline-block;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          font-size: 11px;
        }
        .advanced-arrow.open { transform: rotate(90deg); }

        /* ── Error banner ── */
        .auth-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(248,113,113,0.07);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: var(--r-md);
          color: var(--danger);
          font-size: 13px;
          line-height: 1.5;
          animation: fadeIn 180ms var(--ease-out);
        }
        .auth-error-icon {
          flex-shrink: 0;
          margin-top: 1px;
          display: flex;
        }

        /* ── Footer links ── */
        .switch-link {
          text-align: center;
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          padding-top: 1px;
        }
        .link-btn {
          color: var(--accent);
          background: none;
          border: none;
          cursor: pointer;
          font-size: inherit;
          font-family: inherit;
          padding: 2px 3px;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .link-btn:hover {
          color: var(--text-link-hover);
          text-decoration: underline;
          transform: translateY(-1px);
          filter: brightness(1.06);
        }
        .link-btn:active {
          transform: translateY(0);
          opacity: 0.76;
        }

        /* ── Spinner in button ── */
        .btn-loading-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .spin-icon {
          animation: spin-anim 0.8s linear infinite;
        }
        @keyframes spin-anim {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .auth-form-fields .btn {
          height: 46px;
          border-radius: var(--r-lg);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .auth-form-fields .register-submit {
          margin-top: 2px;
          letter-spacing: 0;
          text-transform: uppercase;
          box-shadow:
            0 10px 24px rgba(0,0,0,0.34),
            0 0 0 1px rgba(255,255,255,0.09) inset,
            0 0 24px var(--accent-glow);
        }
        .auth-form-fields .register-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.05) drop-shadow(0 8px 20px var(--accent-glow));
        }
        .auth-form-fields .register-submit:active:not(:disabled) {
          transform: translateY(0) scale(0.99);
          filter: brightness(0.95);
        }

        @media (max-width: 420px) {
          .register-brand {
            gap: 12px;
          }
          .register-brand-mark {
            width: 42px;
            height: 42px;
          }
          .register-title {
            font-size: 27px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .form-shake,
          .confirm-check,
          .spin-icon,
          .auth-error {
            animation: none;
          }
          .register-brand-mark,
          .input-wrap,
          .input-icon,
          .onyx-input,
          .strength-fill,
          .eye-toggle,
          .advanced-toggle,
          .advanced-arrow,
          .auth-form-fields .btn,
          .link-btn {
            transition-duration: 0.001ms;
          }
          .auth-form-fields:hover .register-brand-mark,
          .input-wrap:hover,
          .input-wrap:focus-within,
          .input-wrap:focus-within .input-icon--left,
          .eye-toggle:hover,
          .eye-toggle:active,
          .advanced-toggle:hover,
          .advanced-toggle:active,
          .auth-form-fields .register-submit:hover:not(:disabled),
          .auth-form-fields .register-submit:active:not(:disabled),
          .link-btn:hover,
          .link-btn:active {
            transform: none;
          }
        }
      `})]})}var z=e.i(37807);function S(){return(0,r.jsxs)("svg",{width:"44",height:"44",viewBox:"0 0 44 44",fill:"none","aria-hidden":"true",children:[(0,r.jsx)("rect",{width:"44",height:"44",rx:"12",fill:"url(#logo-grad)"}),(0,r.jsx)("circle",{cx:"22",cy:"22",r:"15",stroke:"rgba(255,255,255,0.10)",strokeWidth:"1.1",fill:"none"}),(0,r.jsx)("circle",{cx:"22",cy:"22",r:"10",stroke:"rgba(255,255,255,0.20)",strokeWidth:"1.1",fill:"none"}),(0,r.jsx)("circle",{cx:"22",cy:"22",r:"5.5",stroke:"rgba(255,255,255,0.32)",strokeWidth:"1.1",fill:"none"}),(0,r.jsx)("line",{x1:"22",y1:"22",x2:"31.5",y2:"11.5",stroke:"rgba(255,255,255,0.65)",strokeWidth:"1.5",strokeLinecap:"round"}),(0,r.jsx)("circle",{cx:"31.5",cy:"11.5",r:"1.8",fill:"rgba(255,255,255,0.88)"}),(0,r.jsx)("circle",{cx:"22",cy:"22",r:"2.4",fill:"white",fillOpacity:"0.95"}),(0,r.jsx)("defs",{children:(0,r.jsxs)("linearGradient",{id:"logo-grad",x1:"0",y1:"0",x2:"44",y2:"44",gradientUnits:"userSpaceOnUse",children:[(0,r.jsx)("stop",{offset:"0%",stopColor:"#0ea5e9"}),(0,r.jsx)("stop",{offset:"100%",stopColor:"#0369a1"})]})})]})}e.s(["default",0,function(){let[e,n]=(0,t.useState)("login"),i=(0,a.useOnyxStore)(e=>e.status),o=(0,z.useRouter)();return(0,t.useEffect)(()=>{"connected"===i&&o.push("/app")},[i,o]),(0,r.jsxs)("div",{className:"auth-root",children:[(0,r.jsxs)("div",{className:"auth-bg",children:[(0,r.jsx)("div",{className:"auth-bg-grid"}),(0,r.jsx)("div",{className:"auth-bg-orb auth-bg-orb-1"}),(0,r.jsx)("div",{className:"auth-bg-orb auth-bg-orb-2"}),(0,r.jsx)("div",{className:"auth-bg-orb auth-bg-orb-3"})]}),(0,r.jsxs)("div",{className:"auth-card animate-scale-in",children:[(0,r.jsxs)("div",{className:"auth-logo",children:[(0,r.jsx)("div",{className:"auth-logo-icon",children:(0,r.jsx)(S,{})}),(0,r.jsx)("span",{className:"auth-logo-text",children:"Ocean"}),(0,r.jsx)("span",{className:"auth-logo-tagline",children:"Deep-sea IRC · eshmaki.me"})]}),(0,r.jsxs)("div",{className:"auth-tabs",children:[(0,r.jsx)("button",{className:`auth-tab ${"login"===e?"auth-tab--active":""}`,onClick:()=>n("login"),children:"Sign In"}),(0,r.jsx)("button",{className:`auth-tab ${"register"===e?"auth-tab--active":""}`,onClick:()=>n("register"),children:"Register"})]}),(0,r.jsx)("div",{className:"auth-form-area",children:"login"===e?(0,r.jsx)(h,{onSwitch:()=>n("register")}):(0,r.jsx)(C,{onSwitch:()=>n("login")})}),(0,r.jsxs)("div",{className:"auth-footer",children:[(0,r.jsxs)("span",{className:"auth-footer-status",children:[(0,r.jsx)("span",{className:"auth-footer-dot","aria-hidden":"true"}),"eshmaki.me"]}),(0,r.jsx)("span",{className:"auth-footer-sep","aria-hidden":"true",children:"·"}),(0,r.jsxs)("span",{className:"auth-footer-powered",children:["Powered by ",(0,r.jsx)("span",{className:"text-accent",children:"Ophion"})]})]})]}),(0,r.jsx)("style",{children:`
        .auth-root {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          position: relative;
          overflow: hidden;
          background: var(--bg-void);
        }

        /* ── Background layer ── */
        .auth-bg {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }

        /* Fine dot grid — more visible, centered fade */
        .auth-bg-grid {
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle, var(--border-normal) 1px, transparent 1px);
          background-size: 32px 32px;
          mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
          opacity: 0.5;
          animation: grid-drift 25s ease-in-out infinite alternate;
        }
        @keyframes grid-drift {
          0%   { transform: translate(0, 0); }
          100% { transform: translate(12px, 16px); }
        }

        /* Atmospheric depth orbs */
        .auth-bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
        }

        /* Primary — large accent blue, top-left */
        .auth-bg-orb-1 {
          width: 900px; height: 900px;
          background: radial-gradient(circle, var(--accent) 0%, transparent 65%);
          top: -380px; left: -300px;
          opacity: 0.12;
          animation: orb-drift-1 22s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-1 {
          0%   { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(50px, 40px) scale(1.05); }
          66%  { transform: translate(-30px, 70px) scale(0.96); }
          100% { transform: translate(35px, -20px) scale(1.03); }
        }

        /* Secondary — gold/cyan, bottom-right */
        .auth-bg-orb-2 {
          width: 700px; height: 700px;
          background: radial-gradient(circle, var(--gold) 0%, transparent 65%);
          bottom: -250px; right: -200px;
          opacity: 0.08;
          animation: orb-drift-2 28s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-2 {
          0%   { transform: translate(0, 0) scale(1); }
          40%  { transform: translate(-45px, -35px) scale(1.06); }
          100% { transform: translate(30px, 50px) scale(0.94); }
        }

        /* Tertiary — accent, mid right */
        .auth-bg-orb-3 {
          width: 480px; height: 480px;
          background: radial-gradient(circle, var(--accent) 0%, transparent 65%);
          top: 40%; right: 10%;
          opacity: 0.06;
          animation: orb-drift-3 35s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-3 {
          0%   { transform: translate(0, 0); }
          50%  { transform: translate(40px, -55px); }
          100% { transform: translate(-35px, 30px); }
        }

        /* ── Card ── */
        .auth-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 480px;
          background: linear-gradient(
            160deg,
            var(--bg-elevated) 0%,
            var(--bg-deep) 100%
          );
          border: 1px solid var(--border-normal);
          border-radius: 20px;
          padding: 44px 40px;
          box-shadow:
            0 32px 80px rgba(0,0,0,0.7),
            0 0 0 1px var(--border-subtle),
            0 0 120px rgba(14,165,233,0.06),
            inset 0 1px 0 var(--border-normal);
        }

        /* Top edge shimmer line — animated */
        .auth-card::before {
          content: '';
          position: absolute;
          top: 0; left: 24px; right: 24px;
          height: 1px;
          background: linear-gradient(90deg, transparent 0%, var(--accent) 25%, var(--gold) 50%, var(--accent) 75%, transparent 100%);
          background-size: 200% 100%;
          border-radius: 0 0 99px 99px;
          opacity: 0.6;
          animation: shimmer-slide 4s ease-in-out infinite;
        }
        @keyframes shimmer-slide {
          0%   { background-position: 100% 0; opacity: 0.4; }
          50%  { background-position: 0% 0;   opacity: 0.7; }
          100% { background-position: 100% 0; opacity: 0.4; }
        }

        /* Subtle inner ambient glow */
        .auth-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 200px;
          background: radial-gradient(ellipse 80% 100% at 50% 0%, rgba(14,165,233,0.04) 0%, transparent 100%);
          border-radius: 20px 20px 0 0;
          pointer-events: none;
        }

        /* ── Logo section ── */
        .auth-logo {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          margin-bottom: 8px;
          padding-bottom: 28px;
          border-bottom: 1px solid var(--border-subtle);
          position: relative;
          z-index: 1;
        }

        /* Logo icon container with pulse/glow animation */
        .auth-logo-icon {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: logo-pulse 3s ease-in-out infinite;
        }
        .auth-logo-icon::before {
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 18px;
          background: radial-gradient(circle, var(--accent) 0%, transparent 70%);
          opacity: 0;
          animation: logo-glow 3s ease-in-out infinite;
        }
        @keyframes logo-pulse {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 8px rgba(14,165,233,0.4)); }
          50%       { transform: scale(1.04); filter: drop-shadow(0 0 20px rgba(14,165,233,0.7)); }
        }
        @keyframes logo-glow {
          0%, 100% { opacity: 0; transform: scale(0.8); }
          50%       { opacity: 0.15; transform: scale(1.2); }
        }

        .auth-logo-text {
          font-size: 30px;
          font-weight: 900;
          letter-spacing: -1.2px;
          line-height: 1;
          background: linear-gradient(135deg, var(--text-primary) 20%, var(--accent) 60%, var(--gold) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .auth-logo-tagline {
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          -webkit-text-fill-color: var(--text-muted);
        }

        /* ── Tabs ── */
        .auth-tabs {
          display: flex;
          gap: 3px;
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 4px;
          margin: 28px 0 26px;
          position: relative;
          z-index: 1;
        }

        .auth-tab {
          flex: 1;
          padding: 10px 16px;
          border-radius: calc(var(--r-md) - 2px);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          transition: all var(--t-normal) var(--ease-out);
          font-family: inherit;
          letter-spacing: 0.02em;
        }

        .auth-tab:hover {
          color: var(--text-secondary);
          background: rgba(14,165,233,0.05);
        }

        .auth-tab--active {
          background: linear-gradient(160deg,
            color-mix(in srgb, var(--accent) 14%, var(--bg-elevated)),
            color-mix(in srgb, var(--accent) 6%, var(--bg-float))
          );
          color: var(--accent);
          font-weight: 700;
          box-shadow:
            0 1px 8px rgba(0,0,0,0.4),
            0 0 0 1px var(--border-normal),
            inset 0 -2px 0 0 var(--accent);
        }

        .auth-form-area {
          min-height: 280px;
          position: relative;
          z-index: 1;
        }

        .auth-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid var(--border-subtle);
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.02em;
          position: relative;
          z-index: 1;
        }
        .auth-footer-status {
          display: flex;
          align-items: center;
          gap: 5px;
          color: var(--text-muted);
        }
        .auth-footer-dot {
          display: inline-block;
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--success);
          box-shadow: 0 0 5px var(--success);
          animation: dot-pulse 2.5s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes dot-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.45; }
        }
        .auth-footer-sep { color: var(--border-normal); }
        .auth-footer-powered { color: var(--text-muted); }

        .text-accent {
          color: var(--accent);
          font-weight: 700;
        }

        /* ── Mobile ─────────────────────────────────────────────────────────── */
        @media (max-width: 480px) {
          .auth-root {
            padding: 16px;
            align-items: flex-start;
            padding-top: max(32px, env(safe-area-inset-top, 0px));
            padding-bottom: max(24px, env(safe-area-inset-bottom, 0px));
          }
          .auth-card {
            padding: 28px 20px;
            border-radius: 16px;
            max-width: 100%;
          }
          .auth-logo-text { font-size: 24px; letter-spacing: -0.8px; }
          .auth-logo { gap: 10px; padding-bottom: 20px; margin-bottom: 4px; }
          .auth-tabs { margin: 20px 0 18px; }
          .auth-tab { padding: 9px 12px; font-size: 12.5px; }
          .auth-form-area { min-height: 240px; }
          .auth-bg-orb-1 { width: 500px; height: 500px; top: -200px; left: -150px; }
          .auth-bg-orb-2 { width: 400px; height: 400px; bottom: -150px; right: -100px; }
          .auth-bg-orb-3 { width: 300px; height: 300px; }
        }

        @media (max-width: 375px) {
          .auth-root { padding: 12px; }
          .auth-card { padding: 24px 16px; }
          .auth-logo-text { font-size: 22px; }
        }

        /* Flush card — no radius on tiny screens */
        @media (max-width: 360px) {
          .auth-root { padding: 0; align-items: flex-start; }
          .auth-card {
            border-radius: 0;
            border-left: none;
            border-right: none;
            padding: 20px 16px;
            max-width: 100%;
            width: 100%;
          }
          .auth-card::before { left: 0; right: 0; border-radius: 0; }
        }
      `})]})}],36057)}]);