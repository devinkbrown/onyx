port module Main exposing (main)

{-| Onyx Elm entry point — `Browser.application` wiring over the pure
`App` core. All behavior lives in `App` (tested without ports); this
module only performs `App.Outbound` intentions through ports and feeds
inbound socket batches and vault rows back in.

Port contract (implemented by `ports.js`):

  - `wsConnect { url }` / `wsClose ()` / `wsSend line` — socket control.
  - `wsLines { at, lines }` — one `\r\n`-split batch per socket
    message, stamped with the receipt ms so folds between Ticks
    (latency RTT) resolve against receipt time.
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
import Attribution
import Browser
import Browser.Events
import Browser.Navigation as Nav
import Json.Decode as Decode
import Json.Encode as Encode
import Nodes
import Schedule
import Task
import Time
import Url
import View


port wsConnect : { url : String } -> Cmd msg


port probeNodes : { nodes : List { id : String, host : String, wss : String }, pin : Maybe String, nick : String, timeoutMs : Int, maxConcurrency : Int } -> Cmd msg


port nodesProbed : ({ wss : String, sessionToken : Maybe String, meshToken : Maybe String, meshExpiresAtMs : Maybe Float } -> msg) -> Sub msg


port uploadPick : { key : String, accept : String, multiple : Bool } -> Cmd msg


port uploadPicked : ({ key : String, files : List { name : String, size : Float, mime : String } } -> msg) -> Sub msg


port uploadSend : { key : String, endpoint : String, fieldName : String, index : Int } -> Cmd msg


port uploadDone : ({ key : String, index : Int, ok : Bool, status : Int, body : String, contentType : Maybe String } -> msg) -> Sub msg


port uploadProgress : ({ key : String, index : Int, loaded : Int, total : Maybe Int } -> msg) -> Sub msg


port previewFetch : { key : String, endpoint : String, url : String } -> Cmd msg


port previewDone : ({ key : String, ok : Bool, status : Int, body : String } -> msg) -> Sub msg


port wsClose : () -> Cmd msg


port wsSend : String -> Cmd msg


port mediaBinarySend : { bytes : List Int } -> Cmd msg


port mediaEngineFrame : { bytes : List Int } -> Cmd msg


port mediaBinaryReceived : ({ bytes : List Int } -> msg) -> Sub msg


port wsLines : ({ at : Int, lines : List String } -> msg) -> Sub msg


port wsOpened : ({ url : String } -> msg) -> Sub msg


port wsClosed : ({ clean : Bool, reason : String } -> msg) -> Sub msg


port vaultPut : { target : String, rows : List App.VaultRow } -> Cmd msg


port vaultGet : { target : String, limit : Int } -> Cmd msg


port vaultStored : ({ target : String, stored : Int } -> msg) -> Sub msg


port vaultRows : ({ target : String, rows : List App.VaultRow, status : String } -> msg) -> Sub msg


port vaultSearch : { query : String, limit : Int, seq : Int, mode : String, activeTarget : Maybe String, selfNick : String, nowMs : Float } -> Cmd msg


port vaultSearchModeSave : { mode : String } -> Cmd msg


port retentionPolicyRequest : () -> Cmd msg


port retentionPolicySave : { json : String } -> Cmd msg


port retentionPolicyLoaded : (Encode.Value -> msg) -> Sub msg


port retentionPolicyApplied : ({ saved : Bool, pruned : Bool } -> msg) -> Sub msg


port vaultClassifyDm : { target : String } -> Cmd msg


port voiceJoin : { channel : String, video : Bool } -> Cmd msg


port voiceLeave : { channel : String } -> Cmd msg


port voiceMute : { muted : Bool } -> Cmd msg


port vaultSearched : ({ rows : List App.VaultRow, status : String, seq : Int, mode : String } -> msg) -> Sub msg


port vaultDmPrivacyClassified : ({ target : String, privacy : String } -> msg) -> Sub msg


port vaultGetAround : { target : String, at : Int, limit : Int } -> Cmd msg


port vaultRowsAround : ({ target : String, at : Int, rows : List App.VaultRow, status : String } -> msg) -> Sub msg


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

port personReportReceiptSave : { key : String, nick : String, reason : String, draft : String } -> Cmd msg

port guidesProgressLoaded : (Decode.Value -> msg) -> Sub msg

port historyReplace : String -> Cmd msg

port statsRevealInspector : () -> Cmd msg

port appearanceRequest : () -> Cmd msg

port appearanceStorePrefs : { json : String } -> Cmd msg


port blocklistsSave : { ignored : List String, muted : List String } -> Cmd msg


port identityProfileSave : { serverUrl : String, identity : String, status : String, expiryIso : Maybe String } -> Cmd msg


port identityProfileRequest : { serverUrl : String, identity : String } -> Cmd msg


port identityProfileLoaded : ({ status : String, expiryMs : Maybe Float } -> msg) -> Sub msg


port topicHistorySave : { serverUrl : String, identity : String, history : Encode.Value } -> Cmd msg


port topicHistoryRequest : { serverUrl : String, identity : String } -> Cmd msg


port topicHistoryLoaded : (Decode.Value -> msg) -> Sub msg


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


port channelNotifySave : { entries : List { channel : String, level : String } } -> Cmd msg


port starredSave : { channels : List String } -> Cmd msg


port autoJoinSave : { channels : List String } -> Cmd msg


port channelColorsSave : { entries : List { channel : String, color : String } } -> Cmd msg


port scheduledSave : { rows : Encode.Value } -> Cmd msg


port scheduledPersisted : ({ ok : Bool } -> msg) -> Sub msg


port scheduledFenceRequest : { tag : String, owner : { serverUrl : String, identity : String } } -> Cmd msg


port scheduledFenceResult : ({ tag : String, ok : Bool, epoch : Int, generation : Int } -> msg) -> Sub msg


port scheduledAddRequest : { row : Encode.Value, expectedEpoch : Maybe Int, expectedGeneration : Maybe Int } -> Cmd msg


port scheduledAddResult : ({ id : String, ok : Bool } -> msg) -> Sub msg


port scheduledDispatchRequest : { rows : Encode.Value, owner : { serverUrl : String, identity : String }, candidates : List { id : String, token : String, claimedAt : Int } } -> Cmd msg


port scheduledDispatchResult : ({ queue : Maybe Decode.Value, granted : List String } -> msg) -> Sub msg


port scheduledSettle : { id : String, owner : { serverUrl : String, identity : String }, token : String, admitted : Bool } -> Cmd msg


port scheduledCancelRequest : { id : String, owner : { serverUrl : String, identity : String } } -> Cmd msg


port scheduledCancelResult : ({ id : String, ok : Bool } -> msg) -> Sub msg


port scheduledOwnerCancel : { owner : { serverUrl : String, identity : String } } -> Cmd msg


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

port sessionTokenStore : { kind : String, token : String, expiresAt : Maybe Int, server : String, nick : String } -> Cmd msg

port sessionTokensClear : { server : String, nick : String } -> Cmd msg

port reclaimTimerStart : { stage : String } -> Cmd msg

port reclaimTimersClear : () -> Cmd msg

port reclaimTimerFired : ({ stage : String } -> msg) -> Sub msg

port saslStoreCredentials : { account : String, password : String, hasClientCert : Bool } -> Cmd msg

port saslRespond : { mech : String, nick : String, param : String } -> Cmd msg

port saslPayload : ({ payload : String } -> msg) -> Sub msg

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


port dmOpenRequest : { peer : String, presentedKey : String, messageId : Int, envelope : String, owner : Maybe { serverUrl : String, identity : String } } -> Cmd msg


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
    , channelNotify : List { channel : String, level : String }
    , starredChannels : List String
    , autoJoinChannels : List String
    , channelColors : List { channel : String, color : String }
    , scheduledMessages : Maybe String
    , sessionToken : Maybe String
    , meshToken : Maybe String
    , meshExpiresAtMs : Maybe Float
    }


type alias Model =
    { app : App.Model
    , navKey : Nav.Key
    }


decodeField : String -> Decode.Decoder a -> Decode.Value -> Maybe a
decodeField field decoder raw =
    Decode.decodeValue (Decode.field field decoder) raw
        |> Result.toMaybe


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
                , channelNotify = channelNotify
                , starredChannels =
                    App.parseStarredChannels
                        (Maybe.withDefault [] (decodeField "starredChannels" (Decode.list Decode.string) rawFlags))
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
                , scheduledMessages =
                    Schedule.parseScheduledMessages
                        (Maybe.withDefault "" (decodeField "scheduledMessages" Decode.string rawFlags))
                , origin = Maybe.withDefault "" (decodeField "origin" Decode.string rawFlags)
                , mediaUrl = decodeField "mediaUrl" Decode.string rawFlags
                , nowMs = Maybe.withDefault 0 (decodeField "nowMs" Decode.float rawFlags)
                , sessionTokens =
                    { sessionToken = decodeField "sessionToken" Decode.string rawFlags
                    , meshToken = decodeField "meshToken" Decode.string rawFlags
                    , meshTokenExpiresAt = decodeField "meshExpiresAtMs" Decode.float rawFlags
                    }
            }
      , navKey = key
      }
    , Cmd.batch
        [ case wsPin of
            Just pin ->
                -- Pinned endpoint connects directly (mirrors the
                -- `VITE_IRC_WS` leg of `selectBestNode`).
                perform key (App.WsConnect { url = pin })

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


perform : Nav.Key -> App.Outbound -> Cmd App.Msg
perform key outbound =
    case outbound of
        App.SendLine line ->
            wsSend line

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

        App.ChannelNotifySave req ->
            channelNotifySave req

        App.StarredSave req ->
            starredSave req

        App.AutoJoinSave req ->
            autoJoinSave req

        App.ChannelColorsSave req ->
            channelColorsSave req

        App.ScheduledSave req ->
            scheduledSave req

        App.ScheduledFenceRequest req ->
            scheduledFenceRequest req

        App.ScheduledAddRequest req ->
            scheduledAddRequest req

        App.ScheduledDispatchRequest req ->
            scheduledDispatchRequest req

        App.ScheduledSettle req ->
            scheduledSettle req

        App.ScheduledCancelRequest req ->
            scheduledCancelRequest req

        App.ScheduledOwnerCancel req ->
            scheduledOwnerCancel req

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

        App.GuidesProgressRequest ->
            guidesProgressRequest ()

        App.GuidesProgressStore req ->
            guidesProgressStore req.ids

        App.PersonReportReceiptSave req ->
            personReportReceiptSave req

        App.HttpFetch req ->
            httpFetch req

        App.SessionTokenStored req ->
            sessionTokenStore req

        App.SessionTokensCleared req ->
            sessionTokensClear req

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
    in
    ( { model | app = app }
    , Cmd.batch (List.map (perform model.navKey) outbound)
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
                            if model.app.mediaLightbox /= Nothing then
                                Decode.succeed App.MediaLightboxClose

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

                            else
                                Decode.succeed App.NavMenuEscape

                        else
                            Decode.fail "not-escape"
                    )
            )
        , wsLines App.WsBatchReceived
        , nodesProbed App.NodesProbed
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
        , vaultRows App.VaultRowsReceived
        , vaultSearched App.VaultSearched
        , vaultDmPrivacyClassified App.VaultDmPrivacyClassified
        , vaultRowsAround App.VaultRowsAroundReceived
        , vaultExported App.VaultExported
        , deviceHistoryCopyRows App.DeviceHistoryRowsReceived
        , vaultImportFile App.VaultImportFile
        , vaultStored App.VaultStored
        , outboxQueued App.OutboxQueued
        , outboxQueueFailed App.OutboxQueueFailed
        , outboxFlushed App.OutboxFlushed
        , outboxRetryFired (\_ -> App.OutboxRetryFired)
        , scheduledPersisted App.ScheduledPersisted
        , scheduledFenceResult App.ScheduledFenceResult
        , scheduledAddResult App.ScheduledAddResult
        , scheduledDispatchResult App.ScheduledDispatchResult
        , scheduledCancelResult App.ScheduledCancelResult
        , scheduleClockResult App.ScheduleClockReceived
        , scheduleParseResult App.ScheduleParseReceived
        , identityProfileLoaded App.IdentityProfileLoaded
        , topicHistoryLoaded App.TopicHistoryLoaded
        , nickAliasesLoaded App.NickAliasesLoaded
        , friendsLoaded App.FriendsLoaded
        , watchListLoaded App.WatchListLoaded
        , ctcpConfigLoaded App.CtcpConfigLoaded
        , guestClaimDismissLoaded App.GuestClaimDismissLoaded
        , tempBanTimerFired (\res -> App.TempBanElapsed { key = res.key })
        , whoisTimeoutFired (\res -> App.WhoisTimeoutElapsed { nick = res.nick, gen = res.gen })
        , pingDue (\_ -> App.PingDue)
        , clipboardResult (\res -> App.ClipboardResult { tag = res.tag, ok = res.ok })
        , translateResult (\res -> App.TranslationResult { msgid = res.msgid, lang = res.lang, source = res.source, ok = res.ok, text = res.text })
        , translationConfig (\res -> App.TranslationConfig { available = res.available, target = res.target, browserLang = res.browserLang })
        , guidesProgressLoaded App.GuidesProgressLoaded
        , appearanceSnapshot App.AppearanceSnapshot
        , appearancePreviewed App.AppearancePreviewed
        , studioPromptResult App.StudioPromptResult
        , studioEyeDropperResult App.StudioEyeDropperResult
        , studioCustomThemes App.StudioCustomThemesRefreshed
        , voiceCallHub App.CallHubSnapshot
        , mediaBinaryReceived App.MediaBinaryReceived
        , httpResult App.HttpResult
        , reclaimTimerFired App.ReclaimTimerFired
        , saslPayload App.SaslPayload
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
