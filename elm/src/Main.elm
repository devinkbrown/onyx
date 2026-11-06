port module Main exposing (main, runtimeCapturePreparedMessage, wsFramesMessage)

{-| Onyx Elm entry point — `Browser.application` wiring over the pure
`App` core. All behavior lives in `App` (tested without ports); this
module only performs `App.Outbound` intentions through ports and feeds
inbound socket batches and vault rows back in.

Port contract (implemented by `ports.js`):

  - `wsConnect { url }` / `wsClose ()` / `wsSend line` — socket control.
  - `wsLines { at, lines }` — one `\r\n`-split batch per socket
    message, stamped with the receipt ms so folds between Ticks
    (latency RTT) resolve against receipt time; retained for compatible
    runtimes.
  - `wsFrames { owner, frames }` — owner-stamped, receipt-timed batches
    from the runtime's bounded frame coalescer. Frames fold independently
    in order through the same `WsBatchReceived` path.
  - `wsOpened { url }` / `wsClosed { clean, reason }` — lifecycle.
  - `pingDue ()` / `pingObserved ()` — 25s-idle probe trigger from
    ports (which arms the 15s pong timeout in the same tick and
    closes 4001 on silence); any Elm-observed PONG re-arms.
  - `clipboardCopy { text, tag }` / `clipboardResult { tag, ok }` —
    tagged copy (modern clipboard API with the legacy textarea
    fallback, mirroring `writeClipboardText`; empty text reports
    false; the tag echoes so Elm can route each button's result).
  - `appearanceRequest ()` / `appearanceSnapshot {...}` — the
    five appearance slots (`onyx:preferences` + legacy contrast,
    `onyx:scene-motion`, `onyx:theme`, `onyx:custom-themes`,
    `onyx:bg`) read once at boot; Elm validates fail-closed.
  - `appearanceStore*` — one slot write per change; `appearanceApply
    {...}` mirrors `applyPreferences` + `data-theme`/`color-scheme`.
  - `backgroundPreviewRequest { id }` / `appearancePreviewed { id }`
    — hover preview with the 160ms picker delay ports-side.
  - `historyReplace url` — `history.replaceState` for shareable
    stats query state (never navigates).
  - `statsRevealInspector ()` — user-activated inspector scroll +
    focus (respects `prefers-reduced-motion`).
  - `guidesProgressRequest ()` / `guidesProgressLoaded [...]` /
    `guidesProgressStore [...]` — first-room plan progress in the
    `onyx:guides-progress-v1` localStorage slot (raw JSON array in,
    allowlisted ids out; Elm validates element-wise).
  - `httpFetch { key, url }` / `httpResult { key, ok, status, body }`
    — same-origin public JSON feeds (8s timeout, 256 KiB cap,
    mirroring `fetchPublicJson`; results route by key).
  - `vaultPut { target, rows }` / `vaultStored { target, stored }`.
  - `vaultGet { target, limit }` / `vaultRows { target, rows, status }`
    (`status` is `ok` or `unavailable`, mirroring `loadRecentWithStatus`).
  - `vaultGetAround { target, at, limit }` /
    `vaultRowsAround { target, at, rows, status }` (time-travel window
    around an epoch-ms anchor, nearest-first selection ports-side).
  - `vaultSearch { query, limit, seq }` /
    `vaultSearched { rows, status, seq }` (device-wide exact-substring
    search, newest-first, ports-side; `seq` echoes so stale responses
    drop).
  - `vaultExportRequest ()` / `vaultExported { targets, messages }`
    (whole-vault JSON download, `onyx-vault-export.json`).
  - `vaultImportPick ()` / `vaultImportFile { json }` (file picker
    read back as text; the App validates the snapshot and merges
    rows through `vaultPut`).
  - `outboxQueue { target, text }` /
    `outboxQueued { id, target, text, queuedAt }` /
    `outboxQueueFailed { target }` (durable offline queue in the
    vault DB; `queuedAt` stamped ports-side).
  - `outboxFlush { labeled }` /
    `outboxFlushed { sent, uncertain, dropped, rows, sentLabels }`
    (ports-side flush on reconnect: expiry prune, socket send,
    prune-on-write; mid-flush drops report `uncertain`, never silent
    loss; with `labeled` every sent row carries a ports-minted
    `@label=` and `sentLabels` maps row ids to labels for the
    labeled-response correlation).
  - `passkeyCreate { challenge, rpId, account }` /
    `passkeyCreated { credId, clientDataJSON, authData }`.
  - `passkeyGet { challenge, rpId, allowCreds }` /
    `passkeyAssertion { credId, clientDataJSON, authData, signature }`.
  - `passkeyError { message }`, `passkeySettleRequest ()` /
    `passkeySettle ()` (80ms ALLOW-CRED settle tick).
  - `vhostRefreshRequest ()` / `vhostRefresh ()` (300ms
    wear/claim-confirmation re-list tick, mirroring the oracle).
  - `dmSealRequest { target, keys, plaintext, owner, schedId }` /
    `dmSealed { target, envelope }` /
    `dmSealFailed { target, keyChanged }` (TOFU-gated multi-device
    seal; pins are namespaced per device-memory owner like the
    oracle `pinRecordKey`, and a seal-time key change flags the peer
    with no toast while other failures toast).
  - `dmOpenRequest { peer, messageId, envelope, owner }` /
    `dmOpened { peer, messageId, envelope, plaintext }` /
    `dmOpenFailed { peer, messageId, keyChanged }` (open-then-pin TOFU
    open; every failure stays locked).
  - `dmPublishKey ()` (METADATA `ocean.dm-key`/`ocean.dm-keys` publish).
  - `groupPublisherProject ()` /
    `groupPublisherIdentity { signerPub, encryptionPub, deviceId }`
    (ports-side Ed25519 `sign-v1` + P-256 `dm-v1` public projection for
    the ODD1 ADD; null when unprojectable — nothing is sent).
  - `groupPublisherScheduleRetry ()` / `groupPublisherRetryDue ()` (one
    2s retry tick for the unacked ADD, mirroring the oracle delay).
  - `groupWelcomeOpen { key, room, fromAccount, fromDevice, toAccount,
    toDevice, epoch, commitIdB64, membershipB64, commitmentB64,
    welcomeB64 }` / `groupWelcomeOpened { key, room, epoch, ok, reason }`
    (OGW1 open against our `dm-v1` key, plaintext binding checks,
    OGCMT2 commitment check, and install into the ephemeral room
    keyring in one call — the epoch key never crosses).
  - `roomSealRequest { room, plaintext }` /
    `roomSealed { room, envelope }` /
    `roomSealFailed { room, recoveryRequired, notProvisioned }`
    (epoch-key seal; unprovisioned rooms fail instead of sending
    plaintext, with the no-session copy).
  - `roomOpenRequest { room, messageId, envelope }` /
    `roomOpened { room, messageId, envelope, plaintext }` /
    `roomOpenFailed { room, messageId, envelope }` (every failure
    stays locked).

Planned ports (see COVERAGE.md): E2EEGROUP control plane (key
provisioning), media transport, uploads.
-}

import App
import ConnectGate
import Attribution
import Browser
import Browser.Events
import Browser.Navigation as Nav
import Char
import Dict
import Json.Decode as Decode
import Json.Encode as Encode
import Nodes
import Session
import Ids
import RuntimeDomain
import Browser.Dom
import Task
import Time
import Url
import View
import Wire


port wsConnect : { url : String } -> Cmd msg


port probeNodes : { nodes : List { id : String, host : String, wss : String }, pin : Maybe String, nick : String, timeoutMs : Int, maxConcurrency : Int } -> Cmd msg


port nodesProbed : ({ wss : String } -> msg) -> Sub msg


port privateIdentifyRefused : ({ requestId : String, reason : String } -> msg) -> Sub msg


port uploadPick : { key : String, accept : String, multiple : Bool } -> Cmd msg


port uploadPicked : ({ key : String, files : List { name : String, size : Float, mime : String } } -> msg) -> Sub msg


port uploadSend : { key : String, endpoint : String, fieldName : String, index : Int } -> Cmd msg


port uploadDone : ({ key : String, index : Int, ok : Bool, status : Int, body : String, contentType : Maybe String } -> msg) -> Sub msg


port uploadProgress : ({ key : String, index : Int, loaded : Int, total : Maybe Int } -> msg) -> Sub msg


port previewFetch : { key : String, endpoint : String, url : String } -> Cmd msg


port previewDone : ({ key : String, ok : Bool, status : Int, body : String } -> msg) -> Sub msg


port wsClose : () -> Cmd msg


port wsSend : String -> Cmd msg

port runtimeForgetCredential : { credentialRef : String } -> Cmd msg
port runtimeIssueCredentialBundle : () -> Cmd msg
port runtimeSetCredentialRemembered : { remember : Bool } -> Cmd msg
port runtimePrivateIdentify : { account : String, requestId : String, ownerRef : String, accountGeneration : Int, connectionGeneration : Int } -> Cmd msg

port runtimeCredentialState : (Decode.Value -> msg) -> Sub msg
port runtimeOwnerState : (Decode.Value -> msg) -> Sub msg
port runtimePrivateWebhookResult : (Decode.Value -> msg) -> Sub msg
port runtimeFeatureReadiness : (Decode.Value -> msg) -> Sub msg
port runtimeCapabilityRequest : { roundRef : String, names : List String } -> Cmd msg
port runtimeCapabilityEnd : { roundRef : String } -> Cmd msg
port runtimeCapabilityAdmission : (Decode.Value -> msg) -> Sub msg
port runtimeCapabilityResolution : (Decode.Value -> msg) -> Sub msg
port runtimeDomainCommand : Encode.Value -> Cmd msg
port runtimeJournalFlush : Encode.Value -> Cmd msg
port runtimeDraftAutosaveTimerStart : { target : String, revision : Int, delayMs : Int, ownerRef : String, accountGeneration : Int, connectionGeneration : Int } -> Cmd msg

port runtimeDraftAutosaveTimerCancel : { target : String, revision : Int, ownerRef : String, accountGeneration : Int, connectionGeneration : Int } -> Cmd msg
port runtimeDraftAutosaveTimerFired : (Decode.Value -> msg) -> Sub msg
port runtimeDomainResult : (Decode.Value -> msg) -> Sub msg
port runtimeDomainObservation : (Decode.Value -> msg) -> Sub msg


port runtimeSendAccepted : ({ clientIntentId : String, ownerRef : String, accountGeneration : Int, connectionGeneration : Int } -> msg) -> Sub msg
port runtimeClientSafetyState : Encode.Value -> Cmd msg
port runtimeNotificationNavigation : (Decode.Value -> msg) -> Sub msg
port runtimeNotificationNavigationReceipt : Encode.Value -> Cmd msg
port runtimePrivateFilePick : { purpose : String } -> Cmd msg
port runtimePrivateFileSelected : (Decode.Value -> msg) -> Sub msg
port runtimePrivateOutputPick : { purpose : String } -> Cmd msg
port runtimePrivateOutputSelected : (Decode.Value -> msg) -> Sub msg

port runtimePrivatePasswordRequest : Encode.Value -> Cmd msg

port runtimePrivatePasswordSelected : (Decode.Value -> msg) -> Sub msg
port runtimePrivateAccountFormRequest : Encode.Value -> Cmd msg
port runtimePrivateAccountFormReady : (Decode.Value -> msg) -> Sub msg


port runtimePrivateScheduledMessageRequest : Encode.Value -> Cmd msg


port runtimePrivateScheduledMessageReady : (Decode.Value -> msg) -> Sub msg
port runtimePrivateScheduledMessageFailed : (Decode.Value -> msg) -> Sub msg
port runtimeSessionTokenSaslStatus : (Decode.Value -> msg) -> Sub msg
port runtimeCapturePrepared : (Decode.Value -> msg) -> Sub msg
port runtimeMediaGestureResult : (Decode.Value -> msg) -> Sub msg



port mediaBinarySend : { bytes : List Int } -> Cmd msg


port mediaEngineFrame : { bytes : List Int } -> Cmd msg


port mediaBinaryReceived : ({ bytes : List Int } -> msg) -> Sub msg


port wsLines : ({ at : Int, lines : List String } -> msg) -> Sub msg


port wsFrames : (Decode.Value -> msg) -> Sub msg


port wsOpened : ({ url : String } -> msg) -> Sub msg


port wsClosed : ({ clean : Bool, reason : String } -> msg) -> Sub msg


port vaultPut : { target : String, rows : List App.VaultRow, ownerRef : Maybe String, accountGeneration : Maybe Int, connectionGeneration : Maybe Int } -> Cmd msg


port vaultGet : { target : String, limit : Int, ownerRef : Maybe String, accountGeneration : Maybe Int, connectionGeneration : Maybe Int } -> Cmd msg


port vaultStored : ({ target : String, stored : Int } -> msg) -> Sub msg


port vaultRows : ({ target : String, rows : List App.VaultRow, status : String, ownerRef : Maybe String, accountGeneration : Maybe Int, connectionGeneration : Maybe Int, retentionScope : { kind : String, policyRevision : Maybe String, lastSyncMs : Maybe Float } } -> msg) -> Sub msg


port vaultSearch : { query : String, limit : Int, seq : Int, mode : String, activeTarget : Maybe String, selfNick : String, nowMs : Float, ownerRef : Maybe String, accountGeneration : Maybe Int, connectionGeneration : Maybe Int } -> Cmd msg


port vaultSearchModeSave : { mode : String } -> Cmd msg


port retentionPolicyRequest : () -> Cmd msg


port retentionPolicySave : { json : String } -> Cmd msg


port retentionPolicyLoaded : (Encode.Value -> msg) -> Sub msg


port retentionPolicyApplied : ({ saved : Bool, pruned : Bool } -> msg) -> Sub msg


port vaultClassifyDm : { target : String } -> Cmd msg


port voiceJoin : { channel : String, video : Bool } -> Cmd msg


port voiceLeave : { channel : String } -> Cmd msg


port voiceMute : { muted : Bool } -> Cmd msg


port vaultSearched : ({ rows : List App.VaultRow, status : String, seq : Int, mode : String, ownerRef : Maybe String, accountGeneration : Maybe Int, connectionGeneration : Maybe Int, retentionScopes : List { conversationId : String, scope : { kind : String, policyRevision : Maybe String, lastSyncMs : Maybe Float } } } -> msg) -> Sub msg


port vaultDmPrivacyClassified : ({ target : String, privacy : String } -> msg) -> Sub msg


port vaultGetAround : { target : String, at : Int, limit : Int, ownerRef : Maybe String, accountGeneration : Maybe Int, connectionGeneration : Maybe Int } -> Cmd msg


port vaultRowsAround : ({ target : String, at : Int, rows : List App.VaultRow, status : String, ownerRef : Maybe String, accountGeneration : Maybe Int, connectionGeneration : Maybe Int, retentionScope : { kind : String, policyRevision : Maybe String, lastSyncMs : Maybe Float } } -> msg) -> Sub msg


port vaultExportRequest : () -> Cmd msg


port vaultExported : ({ targets : Int, messages : Int } -> msg) -> Sub msg

port vaultImportPick : () -> Cmd msg

port vaultImportFile : ({ json : String } -> msg) -> Sub msg

port outboxQueue : { target : String, text : String } -> Cmd msg

port outboxFlush : { labeled : Bool } -> Cmd msg

port outboxQueued : ({ id : String, target : String, text : String, queuedAt : Float } -> msg) -> Sub msg

port outboxQueueFailed : ({ target : String } -> msg) -> Sub msg

port outboxFlushed : ({ sent : List String, uncertain : List String, dropped : List String, rows : List { id : String, target : String, text : String, queuedAt : Float }, sentLabels : List { id : String, label : String }, waiting : Int, pruneFailed : Int, expiredPruneFailed : Int, admittedPruneFailed : Int, walkOk : Bool } -> msg) -> Sub msg

port outboxRetryStart : Int -> Cmd msg

port outboxRetryFired : (() -> msg) -> Sub msg


port tempBanTimerStart : { key : String, delayMs : Int } -> Cmd msg

port tempBanTimerFired : ({ key : String } -> msg) -> Sub msg


port whoisTimeoutStart : { nick : String, gen : Int, delayMs : Int } -> Cmd msg

port whoisTimeoutFired : ({ nick : String, gen : Int } -> msg) -> Sub msg

port pingDue : (() -> msg) -> Sub msg

port pingObserved : () -> Cmd msg

port clipboardCopy : { text : String, tag : String } -> Cmd msg

port clipboardResult : ({ tag : String, ok : Bool } -> msg) -> Sub msg

port translateRequest : { msgid : String, lang : String, source : String, text : String, targetLang : String } -> Cmd msg

port translateResult : ({ msgid : String, lang : String, source : String, ok : Bool, text : String } -> msg) -> Sub msg

port translationConfig : ({ available : Bool, target : String, browserLang : String } -> msg) -> Sub msg

port translationTargetSave : { target : String } -> Cmd msg

port guidesProgressRequest : () -> Cmd msg

port guidesProgressStore : List String -> Cmd msg

port identityOverridesRequest : { softIgnoreKey : Maybe String, nickColorsKey : Maybe String, displayNamesKey : Maybe String } -> Cmd msg

port identityOverridesSave : { softIgnoreKey : Maybe String, softIgnore : Maybe String, nickColorsKey : Maybe String, nickColors : Maybe String, displayNamesKey : Maybe String, displayNames : Maybe String } -> Cmd msg

port identityOverridesLoaded : (Decode.Value -> msg) -> Sub msg

port personReportReceiptSave : { key : String, nick : String, reason : String, draft : String } -> Cmd msg

port guidesProgressLoaded : (Decode.Value -> msg) -> Sub msg

port historyReplace : String -> Cmd msg

port threadFollowState : ({ target : String, following : Bool } -> msg) -> Sub msg


port threadReveal : { target : String, mode : String, rowId : String } -> Cmd msg


port statsRevealInspector : () -> Cmd msg


port topicChipFocus : () -> Cmd msg

port appearanceRequest : () -> Cmd msg

port appearanceStorePrefs : { json : String } -> Cmd msg


port blocklistsSave : { ignored : List String, muted : List String } -> Cmd msg


port identityProfileSave : { serverUrl : String, identity : String, status : String, expiryIso : Maybe String } -> Cmd msg


port identityProfileRequest : { serverUrl : String, identity : String } -> Cmd msg


port identityProfileLoaded : ({ status : String, expiryMs : Maybe Float } -> msg) -> Sub msg


port topicHistorySave : { serverUrl : String, identity : String, history : Encode.Value } -> Cmd msg


port topicHistoryRequest : { serverUrl : String, identity : String } -> Cmd msg


port topicHistoryLoaded : (Decode.Value -> msg) -> Sub msg


port topicReadSave : { serverUrl : String, identity : String, markers : Encode.Value } -> Cmd msg


port topicReadRequest : { serverUrl : String, identity : String } -> Cmd msg


port topicReadLoaded : (Decode.Value -> msg) -> Sub msg


port nickAliasesRequest : { serverUrl : String, identity : String } -> Cmd msg


port nickAliasesLoaded : (Decode.Value -> msg) -> Sub msg


port friendsRequest : { serverUrl : String, identity : String } -> Cmd msg


port friendsLoaded : (Decode.Value -> msg) -> Sub msg


port friendsSave : { serverUrl : String, identity : String, entries : Maybe String } -> Cmd msg


port ctcpConfigRequest : { serverUrl : String, identity : String } -> Cmd msg


port ctcpConfigLoaded : (Decode.Value -> msg) -> Sub msg


port ctcpTimeReply : { to : String } -> Cmd msg


port watchListRequest : { serverUrl : String, identity : String } -> Cmd msg


port watchListLoaded : (Decode.Value -> msg) -> Sub msg


port watchListSave : { serverUrl : String, identity : String, entries : Maybe String } -> Cmd msg


port guestClaimDismissSave : { serverUrl : String, identity : String } -> Cmd msg


port guestClaimDismissRequest : { serverUrl : String, identity : String } -> Cmd msg


port guestClaimDismissLoaded : (Decode.Value -> msg) -> Sub msg


port followedSave : { keys : List String } -> Cmd msg


port highlightWordsSave : { words : List String } -> Cmd msg


port dndSave : { enabled : Bool, until : Maybe Int } -> Cmd msg


port dndQuietSave : { start : Int, end : Int } -> Cmd msg


port firstHourSeenSave : () -> Cmd msg


port composerFocus : () -> Cmd msg


port navigationLoad : { key : String } -> Cmd msg


port navigationSave : { key : String, json : String } -> Cmd msg


port navigationLoaded : (Decode.Value -> msg) -> Sub msg


port deviceSlotsLoaded : (Decode.Value -> msg) -> Sub msg


port channelNotifySave : { entries : List { channel : String, level : String } } -> Cmd msg


port starredSave : { channels : List String } -> Cmd msg


port forumChannelsSave : { channels : List String } -> Cmd msg


port autoJoinSave : { channels : List String } -> Cmd msg


port channelColorsSave : { entries : List { channel : String, color : String } } -> Cmd msg


port scheduleClockRequest : () -> Cmd msg


port scheduleClockResult : ({ tomorrow9 : Int, minLocal : String } -> msg) -> Sub msg


port scheduleParseRequest : { value : String } -> Cmd msg


port scheduleParseResult : ({ value : String, epoch : Maybe Int } -> msg) -> Sub msg


port notifyAlert : { title : String, body : String, tag : String, desktop : Bool, sound : Bool, volume : Float } -> Cmd msg


port offlineMemoNotice : { channel : String, count : Int, firstMsgId : Int } -> Cmd msg


port notifyPermissionRequest : () -> Cmd msg


port notifyPermissionChanged : (String -> msg) -> Sub msg


port visibilityChanged : ({ visible : Bool, focused : Bool } -> msg) -> Sub msg


port searchHotkey : (() -> msg) -> Sub msg


port transcriptDownload : { filename : String, body : String, mime : String } -> Cmd msg

port mediaSave : { href : String, name : String } -> Cmd msg

port appearanceStoreSceneMotion : { value : String } -> Cmd msg

port appearanceStoreTheme : { id : String } -> Cmd msg

port appearanceStoreBackground : { id : String } -> Cmd msg

port appearanceApply :
    { density : String
    , fontScale : String
    , hideEvents : Bool
    , width : String
    , reader : Bool
    , reduceMotion : Bool
    , reduceTransparency : Bool
    , highContrast : Bool
    , experienceMode : String
    , dataTheme : String
    , scheme : String
    , tokens : List ( String, String )
    }
    -> Cmd msg

port studioStoreCustomThemes : { json : String } -> Cmd msg

port studioShareCopy : { code : String } -> Cmd msg

port studioPromptRequest : { kind : String } -> Cmd msg

port studioPromptResult : ({ kind : String, text : Maybe String } -> msg) -> Sub msg

port studioEyeDropperRequest : () -> Cmd msg

port studioEyeDropperResult : ({ state : String, detail : String, hex : String } -> msg) -> Sub msg

port studioCustomThemes : (Decode.Value -> msg) -> Sub msg

port voiceCallHub : (Decode.Value -> msg) -> Sub msg

port studioStripShareParam : () -> Cmd msg

port backgroundPreviewRequest : { id : String } -> Cmd msg

port appearanceSnapshot : (Decode.Value -> msg) -> Sub msg

port appearancePreviewed : ({ id : String } -> msg) -> Sub msg

port httpFetch : { key : String, url : String } -> Cmd msg

port httpResult : ({ key : String, ok : Bool, status : Int, body : String } -> msg) -> Sub msg

port reclaimTimerStart : { stage : String } -> Cmd msg

port reclaimTimersClear : () -> Cmd msg

port reclaimTimerFired : ({ stage : String } -> msg) -> Sub msg

port saslStoreCredentials : { account : String, hasClientCert : Bool } -> Cmd msg

port saslRespond : { mech : String, nick : String, param : String } -> Cmd msg

port saslFailed : ({ reason : String } -> msg) -> Sub msg

port saslTimerStart : () -> Cmd msg

port saslTimerClear : () -> Cmd msg

port saslTimeout : (() -> msg) -> Sub msg

port savedSearchesList : () -> Cmd msg

port savedSearchesSave : { label : String, query : String, mode : String } -> Cmd msg

port savedSearchesDelete : { id : String } -> Cmd msg

port savedSearchesClear : () -> Cmd msg

port savedSearchesExport : () -> Cmd msg

port savedSearchesImport : { json : String } -> Cmd msg

port savedSearchesPick : () -> Cmd msg

port savedSearchesDownload : { filename : String, json : String } -> Cmd msg

port accountDownload : { filename : String, json : String } -> Cmd msg

port deviceHistoryCopyRequest : { seq : Int } -> Cmd msg

port deviceHistoryCopyRows : ({ seq : Int, exportedAt : String, json : String } -> msg) -> Sub msg

port savedSearchesRows : ({ rows : List Decode.Value, status : String } -> msg) -> Sub msg

port savedSearchesSaved : ({ search : Decode.Value } -> msg) -> Sub msg

port savedSearchesDeleted : ({ id : String, deleted : Bool } -> msg) -> Sub msg

port savedSearchesCleared : ({ cleared : Bool } -> msg) -> Sub msg

port savedSearchesExported : ({ json : String } -> msg) -> Sub msg

port savedSearchesImported : ({ imported : Int } -> msg) -> Sub msg

port savedSearchesImportFile : ({ json : String } -> msg) -> Sub msg

port savedSearchesChanged : ({ revision : Int, reason : String, count : Int } -> msg) -> Sub msg


port passkeyCreate : Decode.Value -> Cmd msg


port passkeyGet : Decode.Value -> Cmd msg


port passkeySettleRequest : () -> Cmd msg


port vhostRefreshRequest : () -> Cmd msg


port vhostRefresh : (() -> msg) -> Sub msg


port passkeyCreated : ({ credId : String, clientDataJSON : String, authData : String } -> msg) -> Sub msg


port passkeyAssertion : ({ credId : String, clientDataJSON : String, authData : String, signature : String } -> msg) -> Sub msg


port passkeyError : ({ message : String } -> msg) -> Sub msg


port passkeySettle : (() -> msg) -> Sub msg


port passkeySupport : ({ supported : Bool } -> msg) -> Sub msg


port dmSealRequest : { target : String, keys : List String, plaintext : String, owner : Maybe { serverUrl : String, identity : String }, schedId : Maybe String } -> Cmd msg


port dmSealed : ({ target : String, envelope : String, schedId : Maybe String } -> msg) -> Sub msg

port dmSealFailed : ({ target : String, keyChanged : Bool, schedId : Maybe String } -> msg) -> Sub msg


port dmOpenRequest : { peer : String, presentedKey : String, messageId : Int, envelope : String, owner : Maybe { serverUrl : String, identity : String }, runtimeOwnerRef : Maybe String, accountGeneration : Maybe Int, connectionGeneration : Maybe Int } -> Cmd msg


port dmOpened : ({ peer : String, messageId : Int, envelope : String, plaintext : String } -> msg) -> Sub msg


port dmOpenFailed : ({ peer : String, messageId : Int, keyChanged : Bool } -> msg) -> Sub msg


port dmPublishKey : () -> Cmd msg


port e2eeDeviceIdentityRequest : () -> Cmd msg


port e2eeDeviceIdentity : ({ deviceId : String, publicKey : String } -> msg) -> Sub msg


port roomSealRequest : { room : String, plaintext : String } -> Cmd msg


port roomSealed : ({ room : String, envelope : String } -> msg) -> Sub msg


port roomSealFailed : ({ room : String, recoveryRequired : Bool, notProvisioned : Bool } -> msg) -> Sub msg


port roomOpenRequest : { room : String, messageId : Int, envelope : String } -> Cmd msg


port roomOpened : ({ room : String, messageId : Int, envelope : String, plaintext : String } -> msg) -> Sub msg


port roomOpenFailed : ({ room : String, messageId : Int, envelope : String } -> msg) -> Sub msg


port groupControlInstall : { channel : String, kind : String, fromAccount : String, fromDevice : String, toAccount : Maybe String, toDevice : Maybe String, payload : String, epoch : Int, signerB64 : String, localAccount : String, endpoint : Maybe String } -> Cmd msg


port groupControlVerified : ({ channel : String, epoch : Int, signerB64 : String, fromAccount : String, fromDevice : String, toAccount : Maybe String, toDevice : Maybe String, kind : String, payload : String, signatureValid : Bool, trust : String } -> msg) -> Sub msg


port groupDirectoryDerive : { account : String, rows : List { deviceId : String, publicKey : String } } -> Cmd msg


port groupDirectoryDerived : ({ account : String, rows : List { deviceId : String, directoryKey : Maybe String, derivedId : Maybe String, trusted : Bool } } -> msg) -> Sub msg


port groupPublisherProject : () -> Cmd msg


port groupPublisherIdentity : (Maybe { signerPub : String, encryptionPub : String, deviceId : String } -> msg) -> Sub msg


port groupPublisherScheduleRetry : () -> Cmd msg


port groupPublisherRetryDue : (() -> msg) -> Sub msg


port attributionEnrollRequest : { serverUrl : String, account : String, nodeHex : String, gen : Int } -> Cmd msg


port attributionEnrollReply : (Maybe Attribution.EnrollReply -> msg) -> Sub msg


port attributionResidenceRequest : { serverUrl : String, account : String, nodeHex : String, epoch : Float, expiryMs : Float, gen : Int } -> Cmd msg


port attributionResidenceReply : (Maybe Attribution.ResidenceReply -> msg) -> Sub msg


port attributionConfirmEnrolled : { serverUrl : String, account : String, publicHex : String } -> Cmd msg


port webPushProbe : () -> Cmd msg


port webPushProbed : ({ supported : Bool, permission : String } -> msg) -> Sub msg


port webPushEnable : { serverUrl : String, account : String, vapidKey : String } -> Cmd msg


port webPushEnabled : ({ ok : Bool, reason : Maybe String } -> msg) -> Sub msg


port webPushRecover : { serverUrl : String, account : String, vapidKey : String } -> Cmd msg


port webPushRecovered : ({ ok : Bool, reason : Maybe String } -> msg) -> Sub msg


port webPushDisable : { serverUrl : String, account : String } -> Cmd msg


port webPushDisabled : ({ ok : Bool, reason : Maybe String } -> msg) -> Sub msg


port webPushCheckActive : { serverUrl : String, account : String } -> Cmd msg


port webPushActiveState : ({ active : Bool, intentDesired : Bool } -> msg) -> Sub msg


port webPushRecoveryHint : (() -> msg) -> Sub msg


port groupWelcomeOpen : { key : String, room : String, fromAccount : String, fromDevice : String, toAccount : String, toDevice : String, epoch : Int, commitIdB64 : String, membershipB64 : String, commitmentB64 : String, welcomeB64 : String } -> Cmd msg


port groupWelcomeOpened : ({ key : String, room : String, epoch : Int, ok : Bool, reason : String } -> msg) -> Sub msg


type alias Flags =
    { wsUrl : String
    , nick : String
    , nowMs : Float
    , e2eeDms : Bool
    , ignoredUsers : List String
    , mutedDMs : List String
    , vaultSearchMode : String
    , followed : List String
    , highlightWords : List String
    , pushEnabled : Bool
    , soundEnabled : Bool
    , soundVolume : Float
    , dndEnabled : Bool
    , dndUntil : Maybe Int
    , dndQuietStart : Int
    , dndQuietEnd : Int
    , firstHourSeen : Bool
    , channelNotify : List { channel : String, level : String }
    , starredChannels : List String
    , forumChannels : List String
    , autoJoinChannels : List String
    , channelColors : List { channel : String, color : String }
    }


type alias Model =
    { app : App.Model
    , navKey : Nav.Key
    , clientSafetyState : Maybe ClientSafetyProjection
    }


type alias ClientSafetyProjection =
    { ownerRef : String
    , accountGeneration : Int
    , connectionGeneration : Int
    , hasUnsavedDraft : Bool
    , composing : Bool
    , pendingAuthoring : Bool
    }


decodeField : String -> Decode.Decoder a -> Decode.Value -> Maybe a
decodeField field decoder raw =
    Decode.decodeValue (Decode.field field decoder) raw
        |> Result.toMaybe


credentialMetadataDecoder : Decode.Decoder Session.CredentialMetadata
credentialMetadataDecoder =
    Decode.field "credentialRef" Decode.string
        |> Decode.andThen
            (\rawRef ->
                case Ids.credentialRefFromRuntime rawRef of
                    Just credentialRef ->
                        Decode.map3 (Session.CredentialMetadata credentialRef)
                            (Decode.field "credentialKind" credentialKindDecoder)
                            (Decode.field "expiresAtMs" (Decode.nullable Decode.float))
                            (Decode.field "restorable" Decode.bool)

                    Nothing ->
                        Decode.fail "invalid credential reference"
            )


credentialKindDecoder : Decode.Decoder Session.CredentialKind
credentialKindDecoder =
    Decode.string
        |> Decode.andThen
            (\kind ->
                case kind of
                    "local-logical" ->
                        Decode.succeed Session.LocalLogical

                    "local-exact" ->
                        Decode.succeed Session.LocalExact

                    "mesh-logical" ->
                        Decode.succeed Session.MeshLogical

                    "mesh-exact" ->
                        Decode.succeed Session.MeshExact

                    _ ->
                        Decode.succeed Session.UnknownCredential
            )


credentialStateMessage : Decode.Value -> App.Msg
credentialStateMessage value =
    let
        decoder =
            Decode.map3 (\credentials issuance remembered -> { credentials = credentials, issuance = issuance, remembered = remembered })
                (Decode.field "credentials" (Decode.list credentialMetadataDecoder))
                (Decode.field "issuance" credentialIssuanceDecoder)
                (Decode.field "remembered" Decode.bool)
    in
    case Decode.decodeValue decoder value of
        Ok state ->
            App.SessionCredentialStateReceived state

        Err _ ->
            App.SessionCredentialsIgnored


runtimeOwnerStampDecoder : Decode.Decoder App.RuntimeOwnerStamp
runtimeOwnerStampDecoder =
    Decode.map5 (\ownerRef networkId accountId accountGeneration connectionGeneration -> { ownerRef = ownerRef, networkId = networkId, accountId = accountId, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration })
        (Decode.field "ownerRef" Decode.string)
        (Decode.field "networkId" Decode.string)
        (Decode.field "accountId" (Decode.nullable (Decode.string |> Decode.andThen (\accountValue -> if Ids.accountIdFromWire accountValue /= Nothing then Decode.succeed accountValue else Decode.fail "invalid account id"))))
        (Decode.field "accountGeneration" Decode.int)
        (Decode.field "connectionGeneration" Decode.int)


runtimeOwnerStateMessage : Decode.Value -> App.Msg
runtimeOwnerStateMessage value =
    Decode.decodeValue runtimeOwnerStampDecoder value
        |> Result.map App.RuntimeOwnerStateReceived
        |> Result.withDefault App.SessionCredentialsIgnored


wsFrameDecoder : Decode.Decoder { at : Int, lines : List String }
wsFrameDecoder =
    Decode.map2 (\at lines -> { at = at, lines = lines })
        (Decode.field "at" Decode.int)
        (Decode.field "lines" (Decode.list Decode.string))


wsFramesMessage : Decode.Value -> App.Msg
wsFramesMessage value =
    let
        decoder =
            Decode.map2 (\owner frames -> App.WsFramesReceived { owner = owner, frames = frames })
                (Decode.field "owner" runtimeOwnerStampDecoder)
                (Decode.field "frames" (Decode.list wsFrameDecoder))
    in
    Decode.decodeValue decoder value
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeNotificationNavigationMessage : Decode.Value -> App.Msg
runtimeNotificationNavigationMessage value =
    let
        decoder =
            Decode.map6 (\requestId ownerRef accountGeneration connectionGeneration kind conversationId ->
                { requestId = requestId
                , ownerRef = ownerRef
                , accountGeneration = accountGeneration
                , connectionGeneration = connectionGeneration
                , kind = kind
                , conversationId = conversationId
                }
            )
                (Decode.field "requestId" (Decode.string |> Decode.andThen (\raw -> if Ids.requestIdFromRuntime raw == Nothing then Decode.fail "invalid navigation request id" else Decode.succeed raw)))
                (Decode.field "ownerRef" (Decode.string |> Decode.andThen (\raw -> if Ids.ownerRefFromRuntime raw == Nothing then Decode.fail "invalid navigation owner" else Decode.succeed raw)))
                (Decode.field "accountGeneration" (Decode.int |> Decode.andThen (\raw -> if raw < 0 then Decode.fail "invalid account generation" else Decode.succeed raw)))
                (Decode.field "connectionGeneration" (Decode.int |> Decode.andThen (\raw -> if raw < 0 then Decode.fail "invalid connection generation" else Decode.succeed raw)))
                (Decode.field "kind" (Decode.string |> Decode.andThen (\raw -> if List.member raw [ "inbox", "dm", "mention", "call" ] then Decode.succeed raw else Decode.fail "invalid notification route kind")))
                (Decode.field "conversationId" (Decode.nullable (Decode.string |> Decode.andThen (\raw -> if String.isEmpty raw || String.length raw > 512 || String.any (\char -> Char.toCode char <= 32 || Char.toCode char == 127) raw then Decode.fail "invalid conversation id" else Decode.succeed raw))))
    in
    Decode.decodeValue decoder value
        |> Result.map App.RuntimeNotificationNavigationReceived
        |> Result.withDefault App.SessionCredentialsIgnored


clientSafetyProjection : App.Model -> Maybe ClientSafetyProjection
clientSafetyProjection app =
    app.runtimeOwnerStamp
        |> Maybe.map
            (\stamp ->
                let
                    hasDraft =
                        not (String.isEmpty app.composer)
                            || List.any (not << String.isEmpty) (Dict.values app.composerDrafts)
                            || not (List.isEmpty app.attachments)
                            || app.pendingAttachmentSend /= Nothing
                            || App.serviceIntegrationFormIsDirty app

                    pendingAuthoring =
                        Maybe.map App.runtimeDomainActionIsAuthoring app.runtimeDomainPendingAction == Just True
                            || Dict.size app.pendingMessageEdits > 0
                            || app.pendingAttachmentSend /= Nothing
                            || not (List.isEmpty app.schedulePending)
                in
                { ownerRef = stamp.ownerRef
                , accountGeneration = stamp.accountGeneration
                , connectionGeneration = stamp.connectionGeneration
                , hasUnsavedDraft = hasDraft
                , composing = app.composerComposing
                , pendingAuthoring = pendingAuthoring
                }
            )


clientSafetyProjectionValue : ClientSafetyProjection -> Encode.Value
clientSafetyProjectionValue state =
    Encode.object
        [ ( "schemaVersion", Encode.int 1 )
        , ( "ownerRef", Encode.string state.ownerRef )
        , ( "accountGeneration", Encode.int state.accountGeneration )
        , ( "connectionGeneration", Encode.int state.connectionGeneration )
        , ( "hasUnsavedDraft", Encode.bool state.hasUnsavedDraft )
        , ( "composing", Encode.bool state.composing )
        , ( "pendingAuthoring", Encode.bool state.pendingAuthoring )
        ]


runtimeFeatureReadinessMessage : Decode.Value -> App.Msg
runtimeFeatureReadinessMessage value =
    Decode.decodeValue
        (Decode.map7 (\roundRef ownerRef accountGeneration connectionGeneration e2ee media newCapabilities -> { roundRef = roundRef, ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration, e2ee = e2ee, media = media, newCapabilities = newCapabilities })
            (Decode.field "roundRef" Decode.string)
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
            (Decode.field "e2ee" Decode.bool)
            (Decode.field "media" Decode.bool)
            (Decode.field "newCapabilities" (Decode.list Decode.string))
        )
        value
        |> Result.map App.RuntimeFeatureReadinessReceived
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeCapabilityAdmissionMessage : Decode.Value -> App.Msg
runtimeCapabilityAdmissionMessage value =
    Decode.decodeValue
        (Decode.map3 (\roundRef names status -> { roundRef = roundRef, names = names, status = status })
            (Decode.field "roundRef" Decode.string)
            (Decode.field "names" (Decode.list Decode.string))
            (Decode.field "status" Decode.string)
        )
        value
        |> Result.map App.RuntimeCapabilityAdmissionReceived
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeCapabilityResolutionMessage : Decode.Value -> App.Msg
runtimeCapabilityResolutionMessage value =
    Decode.decodeValue
        (Decode.map6 (\roundRef names result ownerRef accountGeneration connectionGeneration -> { roundRef = roundRef, names = names, result = result, ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration })
            (Decode.field "roundRef" Decode.string)
            (Decode.field "names" (Decode.list Decode.string))
            (Decode.field "result" Decode.string)
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
        )
        value
        |> Result.map App.RuntimeCapabilityResolutionReceived
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeDomainResultMessage : Decode.Value -> App.Msg
runtimeDomainResultMessage value =
    Decode.decodeValue RuntimeDomain.decodeResult value
        |> Result.map App.RuntimeDomainResultReceived
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeDraftAutosaveTimerMessage : Decode.Value -> App.Msg
runtimeDraftAutosaveTimerMessage value =
    Decode.decodeValue
        (Decode.map5
            (\target revision ownerRef accountGeneration connectionGeneration -> { target = target, revision = revision, ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration })
            (Decode.field "target" (Decode.string |> Decode.andThen (\target -> if String.length target > 0 && String.length target <= 512 then Decode.succeed target else Decode.fail "invalid draft target")))
            (Decode.field "revision" (Decode.int |> Decode.andThen (\revision -> if revision >= 0 then Decode.succeed revision else Decode.fail "invalid draft revision")))
            (Decode.field "ownerRef" (Decode.string |> Decode.andThen (\ownerValue -> if String.length ownerValue > 0 && String.length ownerValue <= 128 then Decode.succeed ownerValue else Decode.fail "invalid owner ref")))
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
        )
        value
        |> Result.map App.DraftAutosaveTimerFired
        |> Result.withDefault App.SessionCredentialsIgnored


runtimePrivateWebhookResultMessage : Decode.Value -> App.Msg
runtimePrivateWebhookResultMessage value =
    Decode.decodeValue
        (Decode.map6 (\requestId ownerRef accountGeneration connectionGeneration room status ->
            { requestId = requestId, ownerRef = ownerRef, accountGeneration = accountGeneration
            , connectionGeneration = connectionGeneration, room = room, status = status }
        )
            (Decode.field "requestId" (Decode.string |> Decode.andThen (\v -> if String.length v > 0 && String.length v <= 128 then Decode.succeed v else Decode.fail "invalid request id")))
            (Decode.field "ownerRef" (Decode.string |> Decode.andThen (\v -> if String.length v > 0 && String.length v <= 128 then Decode.succeed v else Decode.fail "invalid owner ref")))
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
            (Decode.field "room" (Decode.string |> Decode.andThen (\v -> if String.length v > 0 && String.length v <= 512 then Decode.succeed v else Decode.fail "invalid room")))
            (Decode.field "status" (Decode.string |> Decode.andThen (\v -> if List.member v [ "created", "blocked" ] then Decode.succeed v else Decode.fail "invalid status")))
        )
        value
        |> Result.map App.RuntimePrivateWebhookResult
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeDomainObservationMessage : Decode.Value -> App.Msg
runtimeDomainObservationMessage value =
    Decode.decodeValue
        (Decode.map6 (\ownerRef accountGeneration connectionGeneration domain sequence view ->
            ( { ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration, domain = domain, sequence = sequence
              , securityStatus = Decode.decodeValue privateSecurityObservationDecoder view |> Result.toMaybe
              , scheduledView = if domain == "scheduled" then RuntimeDomain.decodeScheduledListView view else Nothing
              , sessionRecovery = Nothing
              , passkeyManagement = Nothing
              , webAuthn = Nothing
              , sessionInventory = Nothing
              , sessionRevocation = Nothing
              , accountCommunity = Nothing
              , serviceIntegration = Nothing
              , draftRecovery = Nothing
              , mediaQuality = Nothing
              , mediaControl = Nothing
              }
            , view
            ))
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
            (Decode.field "domain" (Decode.string |> Decode.andThen (\domain -> if List.member domain [ "session", "account-security", "account-community", "service-integration", "webauthn", "continuation", "workspace", "draft", "journal", "scheduled", "anchor", "settings", "storage", "eviction", "group", "platform", "tab-intent", "operator-import", "media", "integration" ] then Decode.succeed domain else Decode.fail "invalid domain")))
            (Decode.field "sequence" (Decode.int |> Decode.andThen (\sequence -> if sequence > 0 then Decode.succeed sequence else Decode.fail "invalid sequence")))
            (Decode.field "view" Decode.value)
            |> Decode.andThen
                (\( observation, view ) ->
                    let
                        kind = Decode.decodeValue (Decode.field "kind" Decode.string) view |> Result.toMaybe
                    in
                    case ( observation.domain, kind ) of
                        ( "session", Just "session-recovery" ) ->
                            case RuntimeDomain.decodeSessionRecoveryView view of
                                Ok decoded -> Decode.succeed { observation | sessionRecovery = Just decoded }
                                Err _ -> Decode.fail "invalid session recovery observation"

                        ( "account-security", Just "passkey-management" ) ->
                            case RuntimeDomain.decodePasskeyManagementView view of
                                Ok decoded -> Decode.succeed { observation | passkeyManagement = Just decoded }
                                Err _ -> Decode.fail "invalid passkey management observation"

                        ( "webauthn", Just "webauthn" ) ->
                            case RuntimeDomain.decodeWebAuthnView view of
                                Ok decoded -> Decode.succeed { observation | webAuthn = Just decoded }
                                Err _ -> Decode.fail "invalid WebAuthn observation"

                        ( "webauthn", _ ) ->
                            Decode.fail "missing WebAuthn observation"

                        ( "session", Just "session-inventory" ) ->
                            case RuntimeDomain.decodeSessionInventoryView view of
                                Ok decoded -> Decode.succeed { observation | sessionInventory = Just decoded }
                                Err _ -> Decode.fail "invalid session inventory observation"

                        ( "session", Just "session-revocation" ) ->
                            case RuntimeDomain.decodeSessionRevocationView view of
                                Ok decoded -> Decode.succeed { observation | sessionRevocation = Just decoded }
                                Err _ -> Decode.fail "invalid session revocation observation"

                        ( "account-community", Just "account-community" ) ->
                            case RuntimeDomain.decodeAccountCommunityView view of
                                Ok decoded -> Decode.succeed { observation | accountCommunity = Just decoded }
                                Err _ -> Decode.fail "invalid account community observation"

                        ( "service-integration", Just "service-integration" ) ->
                            case RuntimeDomain.decodeServiceIntegrationView view of
                                Ok decoded -> Decode.succeed { observation | serviceIntegration = Just decoded }
                                Err _ -> Decode.fail "invalid service integration observation"

                        ( "draft", Just "draft-recovery" ) ->
                            case RuntimeDomain.decodeDraftRecoveryView view of
                                Ok decoded -> Decode.succeed { observation | draftRecovery = Just decoded }
                                Err _ -> Decode.fail "invalid draft recovery observation"

                        ( "media", Just "media-quality" ) ->
                            case RuntimeDomain.decodeMediaQualityView view of
                                Ok decoded -> Decode.succeed { observation | mediaQuality = Just decoded }
                                Err _ -> Decode.fail "invalid media quality observation"

                        ( "media", Just "media" ) ->
                            case RuntimeDomain.decodeMediaControlView view of
                                Ok decoded -> Decode.succeed { observation | mediaControl = Just decoded }
                                Err _ -> Decode.fail "invalid media control observation"

                        _ ->
                            Decode.succeed observation
                )
        )
        value
        |> Result.map App.RuntimeDomainObservationReceived
        |> Result.withDefault App.SessionCredentialsIgnored


privateSecurityObservationDecoder : Decode.Decoder { action : String, phase : String, outcome : String, reason : Maybe String, targetAccount : Maybe String, requiresLogin : Bool }
privateSecurityObservationDecoder =
    Decode.map6 (\action phase outcome reason targetAccount requiresLogin -> { action = action, phase = phase, outcome = outcome, reason = reason, targetAccount = targetAccount, requiresLogin = requiresLogin })
            (Decode.field "action" (Decode.string |> Decode.andThen (\value -> if List.member value [ "totp-status", "totp-enroll", "totp-disable", "totp-confirm", "recovery-status", "recovery-generate", "recovery-clear", "recovery-login", "account-email", "account-password", "account-certificate-reset", "account-drop", "password-reset-request", "password-reset-confirm", "account-register", "account-verify", "present", "copy", "dismiss" ] then Decode.succeed value else Decode.fail "invalid security action")))
        (Decode.field "phase" (Decode.string |> Decode.andThen (\value -> if List.member value [ "pending", "accepted", "unknown", "blocked", "failed", "dismissed" ] then Decode.succeed value else Decode.fail "invalid security phase")))
        (Decode.field "accountOutcome" (Decode.string |> Decode.andThen (\value -> if List.member value [ "none", "email-updated", "password-changed", "certificate-password-reset", "account-dropped", "reset-request-acknowledged", "password-reset", "account-registered", "email-verified", "no-pending-verification" ] then Decode.succeed value else Decode.fail "invalid security outcome")))
        (Decode.field "reason" (Decode.nullable (Decode.string |> Decode.andThen (\value -> if List.member value [ "busy", "stale-owner", "invalid-input", "transport-blocked", "timeout", "server-failure", "malformed-response", "not-proven", "expired", "copy-failed", "invalid-form", "password-mismatch", "weak-password", "wrong-password", "invalid-email", "invalid-code", "no-request", "too-many-attempts", "account-required", "reset-not-authorized", "unavailable", "temporarily-unavailable", "permission-denied", "transport-unknown", "response-unknown", "operation-failed" ] then Decode.succeed value else Decode.fail "invalid security reason"))))
        (Decode.field "targetAccount" (Decode.nullable (Decode.string |> Decode.andThen (\value -> if String.length value <= 64 && not (String.any (\char -> Char.toCode char <= 32 || Char.toCode char == 127) value) then Decode.succeed value else Decode.fail "invalid account label"))))
        (Decode.field "requiresLogin" Decode.bool)


runtimePrivateFileSelectedMessage : Decode.Value -> App.Msg
runtimePrivateFileSelectedMessage value =
    Decode.decodeValue
        (Decode.map2 (\purpose inputRef -> { purpose = purpose, inputRef = inputRef })
            (Decode.field "purpose" (Decode.string |> Decode.andThen (\purpose -> if List.member purpose [ "operator-import", "settings-import", "group-backup-import" ] then Decode.succeed purpose else Decode.fail "invalid purpose")))
            (Decode.field "inputRef" Decode.string)
        )
        value
        |> Result.map App.RuntimePrivateFileSelected
        |> Result.withDefault App.SessionCredentialsIgnored


runtimePrivateOutputSelectedMessage : Decode.Value -> App.Msg
runtimePrivateOutputSelectedMessage value =
    Decode.decodeValue
        (Decode.map2 (\purpose outputRef -> { purpose = purpose, outputRef = outputRef })
            (Decode.field "purpose" (Decode.string |> Decode.andThen (\purpose -> if List.member purpose [ "settings-export", "storage-export", "group-backup-export" ] then Decode.succeed purpose else Decode.fail "invalid purpose")))
            (Decode.field "outputRef" Decode.string)
        )
        value
        |> Result.map App.RuntimePrivateOutputSelected
        |> Result.withDefault App.SessionCredentialsIgnored


runtimePrivatePasswordSelectedMessage : Decode.Value -> App.Msg
runtimePrivatePasswordSelectedMessage value =
    Decode.decodeValue
        (Decode.map5 (\purpose passwordRef ownerRef accountGeneration connectionGeneration -> { purpose = purpose, passwordRef = passwordRef, ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration })
            (Decode.field "purpose" (Decode.string |> Decode.andThen (\purpose -> if List.member purpose [ "group-backup-export", "group-backup-import" ] then Decode.succeed purpose else Decode.fail "invalid purpose")))
            (Decode.field "passwordRef" Decode.string)
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
        )
        value
        |> Result.map App.RuntimePrivatePasswordSelected
        |> Result.withDefault App.SessionCredentialsIgnored


runtimePrivateAccountFormReadyMessage : Decode.Value -> App.Msg
runtimePrivateAccountFormReadyMessage value =
    Decode.decodeValue
        (Decode.map8
            (\requestId kind action formRef account ownerRef accountGeneration connectionGeneration ->
                { requestId = requestId, kind = kind, action = action, formRef = formRef, account = account
                , ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration
                }
            )
            (Decode.field "requestId" Decode.string)
            (Decode.field "kind" (Decode.string |> Decode.andThen (\kind -> if List.member kind [ "totp-code", "recovery-password", "recovery-code", "account-email", "account-password", "account-certificate-reset", "account-drop", "password-reset-confirm", "account-register", "account-verify" ] then Decode.succeed kind else Decode.fail "invalid private form kind")))
            (Decode.field "action" (Decode.string |> Decode.andThen (\action -> if List.member action [ "totp-confirm", "recovery-generate", "recovery-clear", "recovery-login", "account-email", "account-password", "account-certificate-reset", "account-drop", "password-reset-confirm", "account-register", "account-verify" ] then Decode.succeed action else Decode.fail "invalid private form action")))
            (Decode.field "formRef" Decode.string)
            (Decode.field "account" (Decode.nullable Decode.string))
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
        )
        value
        |> Result.map App.RuntimePrivateAccountFormReady
        |> Result.withDefault App.SessionCredentialsIgnored


runtimePrivateScheduledMessageReadyMessage : Decode.Value -> App.Msg
runtimePrivateScheduledMessageReadyMessage value =
    Decode.decodeValue
        (Decode.map8
            (\requestId operationId kind inputRef dueAtMs prefilledComposer ownerRef accountGeneration ->
                \connectionGeneration ->
                    { requestId = requestId, operationId = operationId, kind = kind, inputRef = inputRef, dueAtMs = dueAtMs, prefilledComposer = prefilledComposer, ownerRef = ownerRef
                    , accountGeneration = accountGeneration, connectionGeneration = connectionGeneration
                    }
            )
            (Decode.field "requestId" Decode.string)
            (Decode.field "operationId" Decode.string)
            (Decode.field "kind" (Decode.string |> Decode.andThen (\kind -> if List.member kind [ "create", "edit" ] then Decode.succeed kind else Decode.fail "invalid scheduled editor kind")))
            (Decode.field "inputRef" Decode.string)
            (Decode.field "dueAtMs" (Decode.int |> Decode.andThen (\dueAtMs -> if dueAtMs >= 0 then Decode.succeed dueAtMs else Decode.fail "invalid scheduled time")))
            (Decode.field "prefilledComposer" Decode.bool)
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            |> Decode.andThen (\build -> Decode.map build (Decode.field "connectionGeneration" Decode.int))
        )
        value
        |> Result.map App.RuntimePrivateScheduledMessageReady
        |> Result.withDefault App.SessionCredentialsIgnored


runtimePrivateScheduledMessageFailedMessage : Decode.Value -> App.Msg
runtimePrivateScheduledMessageFailedMessage value =
    Decode.decodeValue
        (Decode.map5
            (\requestId reason ownerRef accountGeneration connectionGeneration ->
                { requestId = requestId, reason = reason, ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration }
            )
            (Decode.field "requestId" Decode.string)
            (Decode.field "reason" (Decode.string |> Decode.andThen (\reason -> if List.member reason [ "cancelled", "unavailable", "stale" ] then Decode.succeed reason else Decode.fail "invalid private editor outcome")))
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
        )
        value
        |> Result.map App.RuntimePrivateScheduledMessageFailed
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeSessionTokenSaslStatusMessage : Decode.Value -> App.Msg
runtimeSessionTokenSaslStatusMessage value =
    Decode.decodeValue
        (Decode.map5
            (\requestId status ownerRef accountGeneration connectionGeneration ->
                { requestId = requestId, status = status, ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration }
            )
            (Decode.field "requestId" Decode.string)
            (Decode.field "status" (Decode.string |> Decode.andThen (\status -> if List.member status [ "accepted", "rejected", "unknown", "aborted" ] then Decode.succeed status else Decode.fail "invalid continuation status")))
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
        )
        value
        |> Result.map App.RuntimeSessionTokenSaslStatus
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeCapturePreparedMessage : Decode.Value -> App.Msg
runtimeCapturePreparedMessage value =
    let
        decoder =
            Decode.map8
                (\ownerRef connectionGeneration accountGeneration conversationId captureRef kind available reason ->
                    { ownerRef = ownerRef
                    , connectionGeneration = connectionGeneration
                    , accountGeneration = accountGeneration
                    , conversationId = conversationId
                    , captureRef = captureRef
                    , kind = kind
                    , available = available
                    , reason = reason
                    , deviceRef = Nothing
                    , callRef = Nothing
                    }
                )
                (Decode.field "ownerRef" Decode.string)
                (Decode.field "connectionGeneration" Decode.int)
                (Decode.field "accountGeneration" Decode.int)
                (Decode.field "conversationId" Decode.string)
                (Decode.field "captureRef" Decode.string)
                (Decode.field "kind" (Decode.string |> Decode.andThen (\kind -> if List.member kind [ "voice", "video", "camera-preview", "screen", "webrtc-voice", "webrtc-video", "soundcheck", "input-switch" ] then Decode.succeed kind else Decode.fail "invalid capture kind")))
                (Decode.field "available" Decode.bool)
                (Decode.field "reason" (Decode.nullable (Decode.string |> Decode.andThen (\reason -> if List.member reason [ "permission-required", "unsupported", "stale-owner", "expired", "device-missing", "capture-failed", "transport-unavailable", "activation-barrier" ] then Decode.succeed reason else Decode.fail "invalid capture reason"))))
                |> Decode.andThen
                    (\prepared ->
                        Decode.map2 (\deviceRef callRef -> { prepared | deviceRef = deviceRef, callRef = callRef })
                            (Decode.oneOf [ Decode.field "deviceRef" (Decode.nullable (Decode.string |> Decode.andThen (\ref -> if String.length ref >= 22 && String.length ref <= 128 then Decode.succeed ref else Decode.fail "invalid device reference"))), Decode.succeed Nothing ])
                            (Decode.oneOf [ Decode.field "callRef" (Decode.nullable (Decode.string |> Decode.andThen (\ref -> if String.length ref >= 22 && String.length ref <= 128 then Decode.succeed ref else Decode.fail "invalid call reference"))), Decode.succeed Nothing ])
                    )
    in
    Decode.decodeValue decoder value
        |> Result.map App.RuntimeCapturePrepared
        |> Result.withDefault App.SessionCredentialsIgnored


runtimeMediaGestureResultMessage : Decode.Value -> App.Msg
runtimeMediaGestureResultMessage value =
    Decode.decodeValue
        (Decode.map8
            (\ownerRef accountGeneration connectionGeneration gesture conversationId callRef state reason ->
                App.RuntimeMediaGestureResult { ownerRef = ownerRef, accountGeneration = accountGeneration, connectionGeneration = connectionGeneration, gesture = gesture, conversationId = conversationId, callRef = callRef, state = state, reason = reason }
            )
            (Decode.field "ownerRef" Decode.string)
            (Decode.field "accountGeneration" Decode.int)
            (Decode.field "connectionGeneration" Decode.int)
            (Decode.field "gesture" (Decode.string |> Decode.andThen (\gesture -> if List.member gesture [ "caption-prepare", "audio-recover", "output-select" ] then Decode.succeed gesture else Decode.fail "invalid media gesture")))
            (Decode.field "conversationId" Decode.string)
            (Decode.field "callRef" Decode.string)
            (Decode.field "state" (Decode.string |> Decode.andThen (\state -> if List.member state [ "idle", "pending", "applied", "deferred", "rejected", "unknown", "available", "installed", "unavailable", "failed" ] then Decode.succeed state else Decode.fail "invalid media gesture state")))
            (Decode.field "reason" (Decode.nullable (Decode.string |> Decode.andThen (\reason -> if String.length reason <= 128 && not (String.any (\char -> Char.toCode char < 32 || Char.toCode char == 127) reason) then Decode.succeed reason else Decode.fail "invalid media gesture reason"))))
        )
        value
        |> Result.withDefault App.SessionCredentialsIgnored


credentialIssuanceDecoder : Decode.Decoder Session.CredentialIssuance
credentialIssuanceDecoder =
    Decode.string
        |> Decode.andThen
            (\state ->
                case state of
                    "idle" -> Decode.succeed Session.CredentialIdle
                    "pending" -> Decode.succeed Session.CredentialPending
                    "unknown" -> Decode.succeed Session.CredentialUnknown
                    _ -> Decode.fail "invalid credential issuance state"
            )


init : Decode.Value -> Url.Url -> Nav.Key -> ( Model, Cmd App.Msg )
init rawFlags url key =
    let
        nick =
            Maybe.withDefault "guest"
                (decodeField "nick" Decode.string rawFlags)

        -- `?ws=` pin (mirrors `VITE_IRC_WS`): present wins and
        -- disables probing; absent probes the registry.
        wsPin =
            case decodeField "wsPin" Decode.string rawFlags of
                Just pin ->
                    if String.isEmpty (String.trim pin) then
                        Nothing

                    else
                        Just (String.trim pin)

                Nothing ->
                    Nothing

        -- Oracle `DEFAULT_PREFERENCES.e2eeDms = true`; ports-side reads
        -- `onyx:preferences` so the Elm default only covers a missing
        -- flag or an unreadable store.
        e2eeDms =
            Maybe.withDefault True
                (decodeField "e2eeDms" Decode.bool rawFlags)

        -- Oracle `parseIgnoredUsers` / `parseMutedDMs` bounds (512
        -- names, 128 chars); untrusted flag arrays normalize in Elm so
        -- the fold stays fail-closed.
        ignoredUsers =
            App.parseNameBlocklist 512 128 (Maybe.withDefault [] (decodeField "ignoredUsers" (Decode.list Decode.string) rawFlags))

        mutedDMs =
            App.parseNameBlocklist 512 128 (Maybe.withDefault [] (decodeField "mutedDMs" (Decode.list Decode.string) rawFlags))

        -- Oracle `loadDefaultVaultSearchMode` (unknown → hybrid).
        vaultSearchMode =
            App.parseVaultSearchMode (Maybe.withDefault "hybrid" (decodeField "vaultSearchMode" Decode.string rawFlags))

        -- Oracle `boundedFollowedKeys` (256 keys, 160 chars); notify
        -- prefs mirror the `onyx:sound` / `onyx:push-notifications` /
        -- `onyx:dnd-*` loaders (missing flag → oracle default).
        followed =
            App.parseFollowedKeys (Maybe.withDefault [] (decodeField "followed" (Decode.list Decode.string) rawFlags))

        highlightWords =
            App.parseHighlightWords (Maybe.withDefault [] (decodeField "highlightWords" (Decode.list Decode.string) rawFlags))

        pushEnabled =
            Maybe.withDefault True (decodeField "pushEnabled" Decode.bool rawFlags)

        soundEnabled =
            Maybe.withDefault True (decodeField "soundEnabled" Decode.bool rawFlags)

        soundVolume =
            case decodeField "soundVolume" Decode.float rawFlags of
                Just v ->
                    if isNaN v then
                        0.5

                    else
                        clamp 0 1 v

                Nothing ->
                    0.5

        dndEnabled =
            Maybe.withDefault False (decodeField "dndEnabled" Decode.bool rawFlags)

        dndUntil =
            decodeField "dndUntil" Decode.int rawFlags

        dndQuietStart =
            quietHour "dndQuietStart" 22

        dndQuietEnd =
            quietHour "dndQuietEnd" 8

        firstHourSeen =
            Maybe.withDefault False (decodeField "firstHourSeen" Decode.bool rawFlags)

        quietHour field fallback =
            case decodeField field Decode.int rawFlags of
                Just hour ->
                    if hour >= 0 && hour <= 23 then
                        hour

                    else
                        fallback

                Nothing ->
                    fallback

        -- Oracle `parse` over the `{ [channel]: level }` object (first
        -- wins after lowercase, `mentions`/`none` only, 256 cap); the
        -- bridge hands the entries as a list and Elm re-validates.
        channelNotify =
            App.parseChannelNotifyEntries
                (Maybe.withDefault []
                    (decodeField "channelNotify"
                        (Decode.list
                            (Decode.map2 App.ChannelNotifyEntry
                                (Decode.field "channel" Decode.string)
                                (Decode.field "level" Decode.string)
                            )
                        )
                        rawFlags
                    )
                )

        base =
            App.init nick url
    in
    ( { app =
            { base
                | e2eeDms = e2eeDms
                , ignoredUsers = ignoredUsers
                , mutedDMs = mutedDMs
                , vaultSearchMode = vaultSearchMode
                , vaultSearchModeShown = vaultSearchMode
                , followed = followed
                , highlightWords = highlightWords
                , pushEnabled = pushEnabled
                , soundEnabled = soundEnabled
                , soundVolume = soundVolume
                , dndEnabled = dndEnabled
                , dndUntil = dndUntil
                , dndQuietStart = dndQuietStart
                , dndQuietEnd = dndQuietEnd
                , firstHourSeen = firstHourSeen
                , channelNotify = channelNotify
                , starredChannels =
                    App.parseStarredChannels
                        (Maybe.withDefault [] (decodeField "starredChannels" (Decode.list Decode.string) rawFlags))
                , forumChannels =
                    App.parseForumChannels
                        (Maybe.withDefault [] (decodeField "forumChannels" (Decode.list Decode.string) rawFlags))
                , autoJoinChannels =
                    App.parseAutoJoinChannels
                        (Maybe.withDefault [] (decodeField "autoJoinChannels" (Decode.list Decode.string) rawFlags))
                , channelColors =
                    App.parseChannelColorEntries
                        (Maybe.withDefault []
                            (decodeField "channelColors"
                                (Decode.list
                                    (Decode.map2 App.ChannelColorEntry
                                        (Decode.field "channel" Decode.string)
                                        (Decode.field "color" Decode.string)
                                    )
                                )
                                rawFlags
                            )
                        )
                , origin = Maybe.withDefault "" (decodeField "origin" Decode.string rawFlags)
                , mediaUrl = decodeField "mediaUrl" Decode.string rawFlags
                , nowMs = Maybe.withDefault 0 (decodeField "nowMs" Decode.float rawFlags)
                , sessionTokens = { credentials = [] }

                -- v3/connect-gate: a visit without a pinned `?nick=`
                -- meets the gate on `/app`; a pinned nick (invites,
                -- dev, e2e) keeps the dial-straight-in path.
                , connectGate =
                    case decodeField "nick" Decode.string rawFlags of
                        Just _ ->
                            Nothing

                        Nothing ->
                            Just ConnectGate.arm
            }
      , navKey = key
      , clientSafetyState = Nothing
      }
    , Cmd.batch
        [ case wsPin of
            Just pin ->
                -- Pinned endpoint connects directly (mirrors the
                -- `VITE_IRC_WS` leg of `selectBestNode`).
                perform key base (App.WsConnect { url = pin })

            Nothing ->
                -- No pin: probe the registry ports-side, then
                -- `NodesProbed` connects to the winner.
                probeNodes
                    { nodes = Nodes.nodes
                    , pin = Nothing
                    , nick = nick
                    , timeoutMs = Nodes.defaultProbeTimeoutMs
                    , maxConcurrency = Nodes.defaultMaxConcurrency
                    }
        , savedSearchesList ()
        , guidesProgressRequest ()
        , appearanceRequest ()
        , retentionPolicyRequest ()
        , Task.perform App.ZoneReceived Time.here
        , Task.perform (always App.IdentityOverridesReload) (Task.succeed ())
        ]
    )
        |> (\( model, cmds ) ->
                -- A `?theme=` share code imports after the customs
                -- snapshot lands (the revive needs the stored list),
                -- so init only parks it; AppearanceSnapshot consumes it.
                case bootThemeCode url of
                    Just code ->
                        ( setStudioBootTheme model code, cmds )

                    Nothing ->
                        ( model, cmds )
           )


{-| `?theme=` share code parked for the customs snapshot
(mirroring the provider's boot import — never fatal). -}
bootThemeCode : Url.Url -> Maybe String
bootThemeCode url =
    Maybe.withDefault "" url.query
        |> String.split "&"
        |> List.filterMap
            (\part ->
                if String.startsWith "theme=" part then
                    Just (String.dropLeft 6 part)

                else
                    Nothing
            )
        |> List.head


setStudioBootTheme : { a | app : App.Model } -> String -> { a | app : App.Model }
setStudioBootTheme model code =
    let
        app =
            model.app
    in
    { model | app = { app | studioBootTheme = Just code } }


perform : Nav.Key -> App.Model -> App.Outbound -> Cmd App.Msg
perform key app outbound =
    case outbound of
        App.SendLine line ->
            case Wire.validateClientOutboundLine line of
                Ok validated ->
                    wsSend validated

                Err _ ->
                    Task.perform
                        (always
                            (App.ClientLineRejected
                                { endpoint = app.endpoint
                                , physicalConnectionGeneration = app.physicalConnectionGeneration
                                , runtimeOwnerStamp = app.runtimeOwnerStamp
                                }
                            )
                        )
                        (Task.succeed ())

        App.RuntimeNotificationNavigationReceipt receipt ->
            runtimeNotificationNavigationReceipt
                (Encode.object
                    [ ( "requestId", Encode.string receipt.requestId )
                    , ( "ownerRef", Encode.string receipt.ownerRef )
                    , ( "accountGeneration", Encode.int receipt.accountGeneration )
                    , ( "connectionGeneration", Encode.int receipt.connectionGeneration )
                    , ( "opened", Encode.bool receipt.opened )
                    ]
                )

        App.MediaBinarySend req ->
            mediaBinarySend req

        App.MediaEngineFrame req ->
            mediaEngineFrame req

        App.PushUrl path ->
            Nav.pushUrl key path

        App.LoadUrl href ->
            Nav.load href

        App.WsConnect req ->
            wsConnect req

        App.FocusElement elementId ->
            Task.attempt (\_ -> App.ShellFocusSettled) (Browser.Dom.focus elementId)

        App.UploadPick req ->
            uploadPick req

        App.UploadSend req ->
            uploadSend req

        App.PreviewFetch req ->
            previewFetch req

        App.WsDisconnect ->
            wsClose ()

        App.VaultPersist req ->
            vaultPut req

        App.VaultFetch req ->
            vaultGet req

        App.VaultSearch req ->
            vaultSearch req

        App.VaultFetchAround req ->
            vaultGetAround req

        App.VaultExportRequest ->
            vaultExportRequest ()

        App.VaultImportPick ->
            vaultImportPick ()

        App.OutboxQueue req ->
            outboxQueue req

        App.OutboxFlush { labeled } ->
            outboxFlush { labeled = labeled }

        App.OutboxRetryTimer req ->
            outboxRetryStart req.delayMs

        App.TempBanTimerStart req ->
            tempBanTimerStart req

        App.WhoisTimeoutStart req ->
            whoisTimeoutStart req

        App.PingObserved ->
            pingObserved ()

        App.CredentialForgetRequested req ->
            runtimeForgetCredential { credentialRef = Ids.credentialRefToRuntime req.credentialRef }

        App.SessionTokenIssueRequested ->
            runtimeIssueCredentialBundle ()

        App.SessionRememberConsentRequested req ->
            runtimeSetCredentialRemembered req

        App.RuntimeCapabilityRequest req ->
            runtimeCapabilityRequest req

        App.RuntimeCapabilityEnd req ->
            runtimeCapabilityEnd req

        App.RuntimeDomainCommand req ->
            runtimeDomainCommand (RuntimeDomain.commandEncoder req)

        App.RuntimeJournalFlush req ->
            runtimeJournalFlush
                (Encode.object
                    [ ( "ownerRef", Encode.string req.ownerRef )
                    , ( "accountGeneration", Encode.int req.accountGeneration )
                    , ( "connectionGeneration", Encode.int req.connectionGeneration )
                    , ( "requestId", Encode.string req.requestId )
                    ]
                )

        App.RuntimeDraftAutosaveTimerStarted req ->
            runtimeDraftAutosaveTimerStart req

        App.RuntimeDraftAutosaveTimerCancelled req ->
            runtimeDraftAutosaveTimerCancel req

        App.RuntimePrivateFilePick purpose ->
            runtimePrivateFilePick { purpose = purpose }

        App.RuntimePrivateOutputPick purpose ->
            runtimePrivateOutputPick { purpose = purpose }

        App.RuntimePrivatePasswordRequest request ->
            runtimePrivatePasswordRequest
                (Encode.object
                    [ ( "purpose", Encode.string request.purpose )
                    , ( "ownerRef", Encode.string request.ownerRef )
                    , ( "accountGeneration", Encode.int request.accountGeneration )
                    , ( "connectionGeneration", Encode.int request.connectionGeneration )
                    ]
                )

        App.RuntimePrivateAccountFormRequest request ->
            runtimePrivateAccountFormRequest
                (Encode.object
                    [ ( "requestId", Encode.string request.requestId )
                    , ( "kind", Encode.string request.kind )
                    , ( "action", Encode.string request.action )
                    , ( "account", Maybe.withDefault Encode.null (Maybe.map Encode.string request.account) )
                    , ( "ownerRef", Encode.string request.ownerRef )
                    , ( "accountGeneration", Encode.int request.accountGeneration )
                    , ( "connectionGeneration", Encode.int request.connectionGeneration )
                    ]
                )

        App.RuntimePrivateScheduledMessageRequest request ->
            runtimePrivateScheduledMessageRequest
                (Encode.object
                    [ ( "requestId", Encode.string request.requestId )
                    , ( "operationId", Encode.string request.operationId )
                    , ( "ownerRef", Encode.string request.ownerRef )
                    , ( "accountGeneration", Encode.int request.accountGeneration )
                    , ( "connectionGeneration", Encode.int request.connectionGeneration )
                    , ( "kind", Encode.string request.kind )
                    , ( "conversationId", Encode.string request.conversationId )
                    , ( "initialDueAtMs", Encode.int request.initialDueAtMs )
                    , ( "prefillFromComposer", Encode.bool request.prefillFromComposer )
                    ]
                )

        App.PrivateIdentifyRequested req ->
            runtimePrivateIdentify req

        App.ClipboardCopy req ->
            clipboardCopy req

        App.TranslateRequest req ->
            translateRequest req

        App.TranslationTargetSave req ->
            translationTargetSave req

        App.AppearanceRequest ->
            appearanceRequest ()

        App.AppearanceStorePrefs req ->
            appearanceStorePrefs req

        App.BlocklistsSave req ->
            blocklistsSave req

        App.IdentityProfileSave req ->
            identityProfileSave req

        App.IdentityProfileRequest req ->
            identityProfileRequest req

        App.TopicHistorySave req ->
            topicHistorySave req

        App.TopicHistoryRequest req ->
            topicHistoryRequest req

        App.TopicReadSave req ->
            topicReadSave req

        App.TopicReadRequest req ->
            topicReadRequest req

        App.NickAliasesRequest req ->
            nickAliasesRequest req

        App.FriendsRequest req ->
            friendsRequest req

        App.FriendsSave req ->
            friendsSave req

        App.WatchListRequest req ->
            watchListRequest req

        App.WatchListSave req ->
            watchListSave req

        App.CtcpConfigRequest req ->
            ctcpConfigRequest req

        App.CtcpTimeReply req ->
            ctcpTimeReply req

        App.GuestClaimDismissSave req ->
            guestClaimDismissSave req

        App.GuestClaimDismissRequest req ->
            guestClaimDismissRequest req

        App.VaultSearchModeSave req ->
            vaultSearchModeSave req

        App.ClassifyVaultDm req ->
            vaultClassifyDm req

        App.VoiceJoin req ->
            voiceJoin req

        App.VoiceLeave req ->
            voiceLeave req

        App.VoiceMute req ->
            voiceMute req

        App.FollowedSave req ->
            followedSave req

        App.HighlightWordsSave req ->
            highlightWordsSave req

        App.DndSave req ->
            dndSave req

        App.DndQuietSave req ->
            dndQuietSave req

        App.FirstHourSeenSave ->
            firstHourSeenSave ()

        App.ComposerFocus ->
            composerFocus ()

        App.NavigationLoad req ->
            navigationLoad req

        App.NavigationSave req ->
            navigationSave req

        App.ChannelNotifySave req ->
            channelNotifySave req

        App.StarredSave req ->
            starredSave req

        App.ForumChannelsSave req ->
            forumChannelsSave req

        App.AutoJoinSave req ->
            autoJoinSave req

        App.ChannelColorsSave req ->
            channelColorsSave req

        App.ScheduledSave _ ->
            Cmd.none

        App.ScheduledFenceRequest _ ->
            Cmd.none

        App.ScheduledAddRequest _ ->
            Cmd.none

        App.ScheduledDispatchRequest _ ->
            Cmd.none

        App.ScheduledSettle _ ->
            Cmd.none

        App.ScheduledCancelRequest _ ->
            Cmd.none

        App.ScheduledOwnerCancel _ ->
            Cmd.none

        App.ScheduleClockRequest ->
            scheduleClockRequest ()

        App.ScheduleParseRequest req ->
            scheduleParseRequest req

        App.NotifyAlert req ->
            notifyAlert req

        App.NotifyPermissionRequest ->
            notifyPermissionRequest ()

        App.OfflineMemoNotice req ->
            offlineMemoNotice req

        App.TranscriptDownload req ->
            transcriptDownload req

        App.MediaSaveDownload req ->
            mediaSave req

        App.RetentionPolicyRequest ->
            retentionPolicyRequest ()

        App.RetentionPolicySave req ->
            retentionPolicySave req

        App.AppearanceStoreSceneMotion req ->
            appearanceStoreSceneMotion req

        App.AppearanceStoreTheme req ->
            appearanceStoreTheme req

        App.AppearanceStoreBackground req ->
            appearanceStoreBackground req

        App.AppearanceApply req ->
            appearanceApply req

        App.StudioStoreCustomThemes req ->
            studioStoreCustomThemes req

        App.StudioShareCopy req ->
            studioShareCopy req

        App.StudioPromptRequest req ->
            studioPromptRequest req

        App.StudioEyeDropperRequest ->
            studioEyeDropperRequest ()

        App.StudioStripShareParam ->
            studioStripShareParam ()

        App.BackgroundPreviewRequest req ->
            backgroundPreviewRequest req

        App.HistoryReplace req ->
            historyReplace req.url

        App.StatsRevealInspector ->
            statsRevealInspector ()

        App.TopicChipFocus ->
            topicChipFocus ()

        App.GuidesProgressRequest ->
            guidesProgressRequest ()

        App.GuidesProgressStore req ->
            guidesProgressStore req.ids

        App.IdentityOverridesRequest req ->
            identityOverridesRequest req

        App.IdentityOverridesSave req ->
            identityOverridesSave req

        App.PersonReportReceiptSave req ->
            personReportReceiptSave req

        App.HttpFetch req ->
            httpFetch req

        App.ReclaimTimerStarted req ->
            reclaimTimerStart req

        App.ReclaimTimersCleared ->
            reclaimTimersClear ()

        App.SaslCredentialsStored req ->
            saslStoreCredentials req

        App.SaslRespond req ->
            saslRespond req

        App.SaslTimerStarted ->
            saslTimerStart ()

        App.SaslTimerCleared ->
            saslTimerClear ()

        App.SearchListRequest ->
            savedSearchesList ()

        App.SearchSave req ->
            savedSearchesSave req

        App.SearchDelete req ->
            savedSearchesDelete req

        App.SearchClearRequest ->
            savedSearchesClear ()

        App.SearchExportRequest ->
            savedSearchesExport ()

        App.SearchImportPick ->
            savedSearchesPick ()

        App.SearchImport req ->
            savedSearchesImport req

        App.SearchDownload req ->
            savedSearchesDownload req

        App.AccountDownload req ->
            accountDownload req

        App.DeviceHistoryCopyRequest req ->
            deviceHistoryCopyRequest req

        App.PasskeyCreate args ->
            passkeyCreate
                (Encode.object
                    [ ( "challenge", Encode.list Encode.int args.challenge )
                    , ( "rpId", Encode.string args.rpId )
                    , ( "account", Encode.string args.account )
                    ]
                )

        App.PasskeyGet args ->
            passkeyGet
                (Encode.object
                    [ ( "challenge", Encode.list Encode.int args.challenge )
                    , ( "rpId", Encode.string args.rpId )
                    , ( "allowCreds", Encode.list (Encode.list Encode.int) args.allowCreds )
                    ]
                )

        App.PasskeySettleRequest ->
            passkeySettleRequest ()

        App.VhostRefreshRequest ->
            vhostRefreshRequest ()

        App.DmSealRequested args ->
            dmSealRequest args

        App.DmOpenRequested args ->
            dmOpenRequest args

        App.DmPublishKey ->
            dmPublishKey ()

        App.E2eeDeviceIdentityRequest ->
            e2eeDeviceIdentityRequest ()

        App.RoomSealRequested args ->
            roomSealRequest args

        App.RoomOpenRequested args ->
            roomOpenRequest args

        App.GroupControlInstall args ->
            groupControlInstall args

        App.GroupDirectoryDerive args ->
            groupDirectoryDerive args

        App.GroupPublisherProject ->
            groupPublisherProject ()

        App.GroupPublisherRetryAfter ->
            groupPublisherScheduleRetry ()

        App.AttributionEnrollRequest req ->
            attributionEnrollRequest req

        App.AttributionResidenceRequest req ->
            attributionResidenceRequest req

        App.AttributionConfirmEnrolled req ->
            attributionConfirmEnrolled req

        App.WebPushProbe ->
            webPushProbe ()

        App.WebPushEnable req ->
            webPushEnable req

        App.WebPushRecover req ->
            webPushRecover req

        App.WebPushDisable req ->
            webPushDisable req

        App.WebPushCheckActive req ->
            webPushCheckActive req

        App.GroupWelcomeOpen args ->
            groupWelcomeOpen args


update : App.Msg -> Model -> ( Model, Cmd App.Msg )
update msg model =
    let
        ( app, outbound ) =
            App.update msg model.app

        currentSafety =
            clientSafetyProjection app

        safetyCommand =
            if currentSafety /= model.clientSafetyState then
                case currentSafety of
                    Just state ->
                        runtimeClientSafetyState (clientSafetyProjectionValue state)

                    Nothing ->
                        Cmd.none

            else
                Cmd.none
        reveal mode rowId =
            threadReveal { target = Maybe.withDefault "" app.activeChannel |> String.toLower, mode = mode, rowId = rowId }

        landingRow =
            app.activeChannel
                |> Maybe.andThen (\target -> Dict.get (String.toLower target) app.channels)
                |> Maybe.andThen (\channel -> List.filter (\row -> row.msgid == app.historyLanding) channel.messages |> List.head)

        queueAdmissionConsumedActiveDraft =
            case msg of
                App.RuntimeDomainResultReceived result ->
                    let
                        admitted =
                            (result.status == RuntimeDomain.Accepted && List.member result.completionScope [ "local", "server" ])
                                || (result.status == RuntimeDomain.TransportAdmitted && result.completionScope == "transport")
                    in
                    case model.app.runtimeDomainPendingAction of
                        Just (RuntimeDomain.QueueMessage target _ submittedText _ _ _) ->
                            admitted
                                && result.domain == "journal"
                                && result.action == "queue"
                                && model.app.runtimeDomainPending == Just result.requestId
                                && Maybe.map (App.ircCaseKey app >> (==) (App.ircCaseKey app target)) model.app.activeChannel == Just True
                                && model.app.composer == submittedText
                                && String.isEmpty app.composer

                        _ ->
                            False

                _ ->
                    False

        explicitLanding =
            case msg of
                App.PinnedMessageJump _ -> True
                App.MediaIndexJump _ -> True
                _ -> False

        scroll =
            if app.historyLanding /= Nothing && (app.historyLanding /= model.app.historyLanding || explicitLanding) then
                case landingRow of
                    Just row -> reveal "row" (String.fromInt row.id)
                    Nothing -> Cmd.none

            else if App.searchActiveId app /= Nothing && App.searchActiveId app /= App.searchActiveId model.app then
                reveal "row" (App.searchActiveId app |> Maybe.map String.fromInt |> Maybe.withDefault "")

            else
                case msg of
                    App.RuntimeDomainResultReceived _ ->
                        if queueAdmissionConsumedActiveDraft then reveal "latest" "" else Cmd.none
                    App.ThreadShowLatest -> reveal "latest" ""
                    App.ThreadShowEarlier ->
                        if app.threadWindowSize /= model.app.threadWindowSize || app.threadPageStart /= model.app.threadPageStart then
                            reveal "earlier" ""
                        else
                            Cmd.none
                    App.ThreadJumpUnread ->
                        case app.activeChannel |> Maybe.andThen (\name -> Dict.get (String.toLower name) app.viewUnreadDividerId) of
                            Just rowId ->
                                reveal "row" (String.fromInt rowId)

                            Nothing ->
                                Cmd.none
                    App.ChannelTopicSelect _ -> reveal "latest" ""
                    App.ComposerSend ->
                        if not (String.isEmpty model.app.composer) && String.isEmpty app.composer then reveal "latest" "" else Cmd.none
                    _ ->
                        if app.activeChannel /= model.app.activeChannel then reveal "latest" "" else Cmd.none
    in
    ( { model | app = app, clientSafetyState = currentSafety }
    -- Elm's pinned generated runtime prepends commands as it inserts effects,
    -- so mapping a same-port outbound list directly reverses its wire order.
    -- Reverse the effects here to preserve protocol ordering (CAP LS before
    -- NICK/USER, and ordered command groups) on the shared wsSend port.
    , Cmd.batch
        [ safetyCommand
        , Cmd.batch (scroll :: List.map (perform model.navKey app) (List.reverse outbound))
        ]
    )


subscriptions : Model -> Sub App.Msg
subscriptions model =
    Sub.batch
        [ Browser.Events.onKeyDown
            (Decode.field "key" Decode.string
                |> Decode.andThen
                    (\key ->
                        if key == "Escape" then
                            -- Search closes before the transient schedule
                            -- chrome, which closes before the sheet, which
                            -- closes before the nav menu (mirroring the
                            -- panels' Escape-to-close over page chrome).
                            if model.app.connectionDialogOpen then
                                Decode.succeed App.ConnectionDialogClose

                            else if model.app.youOpen then
                                Decode.succeed App.YouClose

                            else if model.app.mediaLightbox /= Nothing then
                                Decode.succeed App.MediaLightboxClose

                            else if model.app.mediaIndexOpen then
                                Decode.succeed App.MediaIndexClose

                            else if model.app.showPinnedMessages then
                                Decode.succeed App.PinnedMessagesClose

                            else if model.app.threadPanel /= Nothing then
                                Decode.succeed App.ThreadClose

                            else if model.app.searchOpen then
                                Decode.succeed App.SearchClose

                            else if model.app.scheduleOpen then
                                Decode.succeed App.ScheduleClose

                            else if model.app.accountOpen then
                                Decode.succeed (App.SetAccountOpen False)

                            else if model.app.showScheduledMessages then
                                Decode.succeed (App.SetShowScheduledMessages False)

                            else if model.app.stewardRoom /= Nothing then
                                Decode.succeed App.StewardClose

                            else if model.app.showNotificationCenter then
                                Decode.succeed App.NotificationCenterClosed

                            else
                                Decode.succeed App.NavMenuEscape

                        else
                            Decode.fail "not-escape"
                    )
            )
        , threadFollowState App.ThreadFollowChanged
        , wsLines App.WsBatchReceived
        , wsFrames wsFramesMessage
        , nodesProbed App.NodesProbed
        , privateIdentifyRefused App.PrivateIdentifyRefused
        , runtimeCredentialState credentialStateMessage
        , runtimeOwnerState runtimeOwnerStateMessage
        , runtimePrivateWebhookResult runtimePrivateWebhookResultMessage
        , runtimeFeatureReadiness runtimeFeatureReadinessMessage
        , runtimeCapabilityAdmission runtimeCapabilityAdmissionMessage
        , runtimeCapabilityResolution runtimeCapabilityResolutionMessage
        , runtimeDomainResult runtimeDomainResultMessage
        , runtimeDraftAutosaveTimerFired runtimeDraftAutosaveTimerMessage
        , runtimeDomainObservation runtimeDomainObservationMessage
        , runtimeSendAccepted App.RuntimeSendAccepted
        , runtimeNotificationNavigation runtimeNotificationNavigationMessage
        , runtimePrivateFileSelected runtimePrivateFileSelectedMessage
        , runtimePrivateOutputSelected runtimePrivateOutputSelectedMessage
        , runtimePrivatePasswordSelected runtimePrivatePasswordSelectedMessage
        , runtimePrivateAccountFormReady runtimePrivateAccountFormReadyMessage
        , runtimePrivateScheduledMessageReady runtimePrivateScheduledMessageReadyMessage
        , runtimePrivateScheduledMessageFailed runtimePrivateScheduledMessageFailedMessage
        , runtimeSessionTokenSaslStatus runtimeSessionTokenSaslStatusMessage
        , runtimeCapturePrepared runtimeCapturePreparedMessage
        , runtimeMediaGestureResult runtimeMediaGestureResultMessage
        , uploadPicked App.UploadPicked
        , uploadDone App.UploadDone
        , uploadProgress App.UploadProgress
        , previewDone App.PreviewArrived
        , wsOpened App.WsOpened
        , wsClosed App.WsClosed
        , notifyPermissionChanged App.NotifyPermissionChanged
        , visibilityChanged (\state -> App.VisibilityChanged { visible = state.visible, focused = state.focused })
        , searchHotkey (\_ -> App.SearchHotkey)
        , retentionPolicyLoaded App.RetentionPolicyLoaded
        , retentionPolicyApplied (\receipt -> App.RetentionPolicyApplied { saved = receipt.saved, pruned = receipt.pruned })
        , vaultRows App.VaultRowsScopedReceived
        , vaultSearched App.VaultSearchedScoped
        , vaultDmPrivacyClassified App.VaultDmPrivacyClassified
        , vaultRowsAround App.VaultRowsAroundScopedReceived
        , vaultExported App.VaultExported
        , deviceHistoryCopyRows App.DeviceHistoryRowsReceived
        , vaultImportFile App.VaultImportFile
        , vaultStored App.VaultStored
        , outboxQueued (\entry -> App.OutboxQueued { id = entry.id, target = entry.target, text = entry.text, queuedAt = entry.queuedAt, revision = Nothing })
        , outboxQueueFailed App.OutboxQueueFailed
        , outboxFlushed App.OutboxFlushed
        , outboxRetryFired (\_ -> App.OutboxRetryFired)
        , scheduleClockResult App.ScheduleClockReceived
        , scheduleParseResult App.ScheduleParseReceived
        , identityProfileLoaded App.IdentityProfileLoaded
        , topicHistoryLoaded App.TopicHistoryLoaded
        , topicReadLoaded App.TopicReadLoaded
        , nickAliasesLoaded App.NickAliasesLoaded
        , friendsLoaded App.FriendsLoaded
        , watchListLoaded App.WatchListLoaded
        , ctcpConfigLoaded App.CtcpConfigLoaded
        , guestClaimDismissLoaded App.GuestClaimDismissLoaded
        , navigationLoaded App.NavigationLoaded
        , deviceSlotsLoaded App.DeviceSlotsLoaded
        , tempBanTimerFired (\res -> App.TempBanElapsed { key = res.key })
        , whoisTimeoutFired (\res -> App.WhoisTimeoutElapsed { nick = res.nick, gen = res.gen })
        , pingDue (\_ -> App.PingDue)
        , clipboardResult (\res -> App.ClipboardResult { tag = res.tag, ok = res.ok })
        , translateResult (\res -> App.TranslationResult { msgid = res.msgid, lang = res.lang, source = res.source, ok = res.ok, text = res.text })
        , translationConfig (\res -> App.TranslationConfig { available = res.available, target = res.target, browserLang = res.browserLang })
        , guidesProgressLoaded App.GuidesProgressLoaded
        , identityOverridesLoaded App.IdentityOverridesLoaded
        , appearanceSnapshot App.AppearanceSnapshot
        , appearancePreviewed App.AppearancePreviewed
        , studioPromptResult App.StudioPromptResult
        , studioEyeDropperResult App.StudioEyeDropperResult
        , studioCustomThemes App.StudioCustomThemesRefreshed
        , voiceCallHub App.CallHubSnapshot
        , mediaBinaryReceived App.MediaBinaryReceived
        , httpResult App.HttpResult
        , reclaimTimerFired App.ReclaimTimerFired
        , saslFailed App.SaslFailed
        , saslTimeout (\_ -> App.SaslTimeout)
        , savedSearchesRows App.SearchRowsReceived
        , savedSearchesSaved App.SearchSavedReceived
        , savedSearchesDeleted App.SearchDeletedReceived
        , savedSearchesCleared App.SearchClearedReceived
        , savedSearchesExported App.SearchExportedReceived
        , savedSearchesImported App.SearchImportedReceived
        , savedSearchesImportFile App.SearchImportFile
        , savedSearchesChanged App.SearchChanged
        , Time.every 1000 App.Tick
        , passkeyCreated App.PasskeyCreated
        , passkeyAssertion App.PasskeyAssertion
        , passkeyError App.PasskeyFailed
        , passkeySettle (\_ -> App.PasskeySettle)
        , vhostRefresh (\_ -> App.VhostRefreshDue)
        , passkeySupport App.PasskeySupportReceived
        , e2eeDeviceIdentity App.E2eeDeviceIdentityReceived
        , dmSealed App.DmSealed
        , dmSealFailed App.DmSealFailed
        , dmOpened App.DmOpenResult
        , dmOpenFailed App.DmOpenFailed
        , roomSealed App.RoomSealed
        , roomSealFailed App.RoomSealFailed
        , roomOpened App.RoomOpenResult
        , roomOpenFailed App.RoomOpenFailed
        , groupControlVerified App.GroupControlVerified
        , groupDirectoryDerived App.GroupDirectoryDerived
        , groupPublisherIdentity App.GroupPublisherIdentity
        , groupPublisherRetryDue (\_ -> App.GroupPublisherRetry)
        , attributionEnrollReply App.AttributionEnrollReply
        , attributionResidenceReply App.AttributionResidenceReply
        , webPushProbed App.WebPushProbed
        , webPushEnabled App.WebPushEnabled
        , webPushRecovered App.WebPushRecovered
        , webPushDisabled App.WebPushDisabled
        , webPushActiveState App.WebPushActiveState
        , webPushRecoveryHint (\_ -> App.WebPushRecoveryHint)
        , groupWelcomeOpened App.GroupWelcomeOpened
        ]


main : Program Decode.Value Model App.Msg
main =
    Browser.application
        { init = init
        , view = \model -> View.view model.app
        , update = update
        , subscriptions = subscriptions
        , onUrlRequest = App.LinkClicked
        , onUrlChange = App.UrlChanged
        }
