module Session exposing
    ( AccountSessionRow
    , CapRow
    , CapStatus(..)
    , ReclaimClock
    , ReclaimPlan(..)
    , ReclaimSkipReason(..)
    , ReclaimTokenKind(..)
    , ResumeOutcome(..)
    , CredentialKind(..)
    , CredentialMetadata
    , CredentialIssuance(..)
    , ReclaimTokens
    , SessionState(..)
    , buildCapabilityMatrix
    , capReqChunkLength
    , capabilitySummary
    , chunkCapReq
    , maxCapNameLength
    , maxCapValueLength
    , maxClientCapEntries
    , parseCapToken
    , wantedCaps
    , formatSessionAge
    , hasCapability
    , isSessionDropSuccess
    , isSessionListEnd
    , otherAttachedSessions
    , parseSessionDropOk
    , parseSessionListLine
    , planSessionReclaim
    , resumeSuccessOutcome
    , productCaps
    , reclaimExpirySkewMs
    , reclaimOffered
    , sessionRowLabel
    )

{-| Session reclaim, session-list, and capability-matrix helpers — Elm
port of `src/lib/irc/sessionReclaim.ts`, `src/lib/irc/sessionList.ts`
(pure parts), and `src/lib/irc/capabilityMatrix.ts`.

Reclaim order: live mesh Bearer [REDACTED] node-local bearer, then nothing. A
lapsed or malformed mesh token falls THROUGH to the local one — replaying
it would draw `FAIL SESSION INVALID_TOKEN`, whose terminal handler wipes
BOTH bearers. Pure and clock-injected: every decision is a function of
the caller's `now`.

`formatSessionSignon` is deliberately NOT ported: it renders via
`toLocaleString`, whose output varies by environment. Elm exposes the raw
`signonMs`; locale display stays in the view layer.

-}

import Wire
import Ids



-- reclaim


{-| Refuse a Bearer [REDACTED] close to its deadline: it must survive the 001
round trip, and a reclaim racing expiry is indistinguishable from a
stolen one on the wire.
-}
reclaimExpirySkewMs : Float
reclaimExpirySkewMs =
    30000


type ReclaimTokenKind
    = MeshBearer
    | LocalBearer
    | UnknownBearer


type ResumeOutcome
    = ResumePending
    | ExactRestored
    | LogicalRestored
    | NewLegacyAttachment
    | AttachmentBusy
    | MissingAttachment
    | ResumeRetryable
    | ResumeRevoked
    | ResumeInvalid
    | ResumeUnknown


resumeSuccessOutcome : String -> Maybe ResumeOutcome
resumeSuccessOutcome body =
    if List.member body exactResumeNotices then
        Just ExactRestored

    else if List.member body legacyResumeNotices then
        Just NewLegacyAttachment

    else if List.member body logicalResumeNotices then
        Just LogicalRestored

    else
        Nothing


exactResumeNotices : List String
exactResumeNotices =
    [ "SESSION RESUME: already attached to this exact session"
    , "SESSION RESUME: exact session restored"
    , "SESSION RESUME: exact session reclaimed"
    , "SESSION RESUME: exact session restored (cross-server)"
    , "SESSION RESUME: exact session reclaimed (cross-server)"
    ]


legacyResumeNotices : List String
legacyResumeNotices =
    [ "SESSION RESUME: legacy session state cloned into a new attachment"
    , "SESSION RESUME: legacy session attached as a new attachment"
    ]


logicalResumeNotices : List String
logicalResumeNotices =
    [ "SESSION RESUME: already attached to this session"
    , "SESSION RESUME: attached to live session"
    , "SESSION RESUME: already attached to this mesh session"
    , "SESSION RESUME: attached to live mesh session"
    , "SESSION RESUME: attached to replicated mesh session"
    , "SESSION RESUME: session restored (cross-server)"
    , "SESSION RESUME: session reclaimed (cross-server)"
    ]


type CredentialKind
    = MeshLogical
    | MeshExact
    | LocalLogical
    | LocalExact
    | UnknownCredential


type ReclaimSkipReason
    = Unauthenticated
    | Expired
    | NoneHeld


type alias CredentialMetadata =
    { credentialRef : Ids.CredentialRef
    , kind : CredentialKind
    , expiresAtMs : Maybe Float
    , restorable : Bool
    }


type alias ReclaimTokens =
    { credentials : List CredentialMetadata }


type CredentialIssuance
    = CredentialIdle
    | CredentialPending
    | CredentialUnknown


type alias ReclaimClock =
    { now : Float
    , authenticated : Bool
    }


type ReclaimPlan
    = Attempt { credentialRef : Ids.CredentialRef, kind : ReclaimTokenKind, credentialKind : CredentialKind, meshExpired : Bool }
    | Skip { reason : ReclaimSkipReason, meshExpired : Bool }


type MeshStatus
    = Usable
    | ExpiredMesh
    | AbsentMesh


meshStatus : ReclaimTokens -> Float -> MeshStatus
meshStatus tokens now =
    let
        mesh = List.filter (\credential -> isMeshKind credential.kind && credential.restorable) tokens.credentials

        usable credential =
            case credential.expiresAtMs of
                Nothing -> True
                Just expiresAt -> not (isNaN expiresAt || isInfinite expiresAt) && now < expiresAt - reclaimExpirySkewMs
    in
    if List.any usable mesh then
        Usable

    else if List.isEmpty mesh then
        AbsentMesh

    else
        ExpiredMesh


{-| Decide which bearer — if any — the next `SESSION RESUME` should carry.
Account proof gates the bearer: a reclaim token selects one session
within an account, it does not authenticate the account.
-}
planSessionReclaim : ReclaimTokens -> ReclaimClock -> ReclaimPlan
planSessionReclaim tokens clock =
    let
        mesh =
            meshStatus tokens clock.now

        meshExpired =
            mesh == ExpiredMesh
    in
    if not clock.authenticated then
        Skip { reason = Unauthenticated, meshExpired = meshExpired }

    else if mesh == Usable then
        case bestCredential isMeshKind tokens.credentials of
            Just credential -> Attempt { credentialRef = credential.credentialRef, kind = MeshBearer, credentialKind = credential.kind, meshExpired = False }
            Nothing -> Skip { reason = NoneHeld, meshExpired = meshExpired }

    else if List.any (\credential -> isLocalKind credential.kind && credential.restorable) tokens.credentials then
        case bestCredential isLocalKind tokens.credentials of
            Just credential -> Attempt { credentialRef = credential.credentialRef, kind = LocalBearer, credentialKind = credential.kind, meshExpired = meshExpired }
            Nothing -> Skip { reason = NoneHeld, meshExpired = meshExpired }

    else if meshExpired then
        Skip { reason = Expired, meshExpired = meshExpired }

    else
        Skip { reason = NoneHeld, meshExpired = meshExpired }


{-| Whether a saved identity can still offer one-tap resume, ignoring
socket state. No authentication gate: sign-in surfaces ask before any
connection exists.
-}
reclaimOffered : ReclaimTokens -> Float -> Bool
reclaimOffered tokens now =
    meshStatus tokens now == Usable || List.any (\credential -> isLocalKind credential.kind && credential.restorable) tokens.credentials


isMeshKind : CredentialKind -> Bool
isMeshKind kind = kind == MeshExact || kind == MeshLogical


isLocalKind : CredentialKind -> Bool
isLocalKind kind = kind == LocalExact || kind == LocalLogical


bestCredential : (CredentialKind -> Bool) -> List CredentialMetadata -> Maybe CredentialMetadata
bestCredential matches credentials =
    let
        candidates = List.filter (\credential -> matches credential.kind && credential.restorable) credentials
        exact = List.filter (\credential -> credential.kind == MeshExact || credential.kind == LocalExact) candidates
    in
    List.head (if List.isEmpty exact then candidates else exact)



-- session list


type SessionState
    = Attached
    | Detached


type alias AccountSessionRow =
    { index : Int
    , current : Bool
    , signonMs : Int
    , state : SessionState
    , sid : Maybe String
    }


{-| Parse a `SESSION LIST` row. Case-insensitive literals (mirroring the
`/i` wire regexes); the optional `sid=` carries a validated 32-hex-digit
physical selector, lowercased.
-}
parseSessionListLine : String -> Maybe AccountSessionRow
parseSessionListLine text =
    case String.words (String.trim text) of
        [ session, list, marker, chanEl, signonEl, stateEl ] ->
            parseSessionRow session list marker chanEl signonEl stateEl Nothing

        [ session, list, marker, chanEl, signonEl, stateEl, sidEl ] ->
            parseSessionRow session list marker chanEl signonEl stateEl (Just sidEl)

        _ ->
            Nothing


type alias RowParts =
    { index : Int
    , signonMs : Int
    , state : SessionState
    , sid : Maybe String
    }


parseSessionRow : String -> String -> String -> String -> String -> String -> Maybe String -> Maybe AccountSessionRow
parseSessionRow session list marker chanEl signonEl stateEl sidEl =
    if String.toUpper session /= "SESSION" || String.toUpper list /= "LIST" then
        Nothing

    else if marker /= "*" && marker /= "-" then
        Nothing

    else
        case Maybe.map4 RowParts (parseHashIndex chanEl) (parseSignon signonEl) (parseRowState stateEl) (parseRowSid sidEl) of
            Just parts ->
                Just
                    { index = parts.index
                    , current = marker == "*"
                    , signonMs = parts.signonMs
                    , state = parts.state
                    , sid = parts.sid
                    }

            Nothing ->
                Nothing


parseHashIndex : String -> Maybe Int
parseHashIndex el =
    if String.startsWith "#" el then
        parsePositiveInt (String.dropLeft 1 el)

    else
        Nothing


parsePositiveInt : String -> Maybe Int
parsePositiveInt digits =
    if String.isEmpty digits || not (List.all isAsciiDigit (String.toList digits)) then
        Nothing

    else
        case String.toInt digits of
            Just n ->
                if n > 0 then
                    Just n

                else
                    Nothing

            Nothing ->
                -- Absurd magnitudes (> 2^31-1) are unrepresentable as Elm
                -- Int; session ordinals are small in practice.
                Nothing


parseSignon : String -> Maybe Int
parseSignon el =
    let
        upper =
            String.toUpper el
    in
    if String.startsWith "SIGNON=" upper then
        let
            digits =
                String.dropLeft (String.length "SIGNON=") el
        in
        if String.isEmpty digits || not (List.all isAsciiDigit (String.toList digits)) then
            Nothing

        else
            String.toInt digits

    else
        Nothing


parseRowState : String -> Maybe SessionState
parseRowState el =
    case String.toUpper el of
        "ATTACHED" ->
            Just Attached

        "DETACHED" ->
            Just Detached

        _ ->
            Nothing


parseRowSid : Maybe String -> Maybe (Maybe String)
parseRowSid sidEl =
    case sidEl of
        Nothing ->
            Just Nothing

        Just el ->
            if String.length el == 36 && String.toUpper (String.left 4 el) == "SID=" then
                let
                    hex =
                        String.dropLeft 4 el
                in
                if String.length hex == 32 && List.all isHexDigit (String.toList hex) then
                    Just (Just (String.toLower hex))

                else
                    Nothing

            else
                Nothing


isAsciiDigit : Char -> Bool
isAsciiDigit c =
    let
        code =
            Char.toCode c
    in
    code >= 0x30 && code <= 0x39


isHexDigit : Char -> Bool
isHexDigit c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x30 && code <= 0x39)
        || (code >= 0x41 && code <= 0x46)
        || (code >= 0x61 && code <= 0x66)


isSessionListEnd : String -> Bool
isSessionListEnd text =
    let
        trimmed =
            String.trim text
    in
    if String.length trimmed < String.length "SESSION:" then
        False

    else if String.toUpper (String.left (String.length "SESSION:") trimmed) /= "SESSION:" then
        False

    else
        String.toUpper (String.trimLeft (String.dropLeft (String.length "SESSION:") trimmed))
            == "END OF SESSION LIST"


parseSessionDropOk : String -> Maybe Int
parseSessionDropOk text =
    case String.words (String.trim text) of
        [ session, drop, chanEl, ok ] ->
            if String.toUpper session /= "SESSION" then
                Nothing

            else if String.toUpper drop /= "DROP" then
                Nothing

            else if String.toUpper ok /= "OK" then
                Nothing

            else
                parseHashIndex chanEl

        _ ->
            Nothing


{-| SID and owner-reactor replies have no ordinal; both confirm a DROP. -}
isSessionDropSuccess : String -> Bool
isSessionDropSuccess text =
    case String.words (String.trim text) of
        [ session, drop, sidEl, ok ] ->
            String.toUpper session == "SESSION"
                && String.toUpper drop == "DROP"
                && String.toUpper ok == "OK"
                && isSidAssignment sidEl

        [ session, drop, ok, clientEl, signonEl ] ->
            String.toUpper session == "SESSION"
                && String.toUpper drop == "DROP"
                && String.toUpper ok == "OK"
                && isClientAssignment clientEl
                && isSignonAssignment signonEl

        _ ->
            False


isSidAssignment : String -> Bool
isSidAssignment el =
    String.length el == 36
        && String.toUpper (String.left 4 el) == "SID="
        && List.all isHexDigit (String.toList (String.dropLeft 4 el))


isClientAssignment : String -> Bool
isClientAssignment el =
    let
        upper =
            String.toUpper el
    in
    String.startsWith "CLIENT=" upper
        && (parsePositiveInt (String.dropLeft (String.length "CLIENT=") el) /= Nothing)


isSignonAssignment : String -> Bool
isSignonAssignment el =
    let
        upper =
            String.toUpper el
    in
    if String.startsWith "SIGNON=" upper then
        let
            digits =
                String.dropLeft (String.length "SIGNON=") el

            unsigned =
                if String.startsWith "-" digits then
                    String.dropLeft 1 digits

                else
                    digits
        in
        not (String.isEmpty unsigned)
            && List.all isAsciiDigit (String.toList unsigned)
            && (String.toInt unsigned /= Nothing)

    else
        False


{-| Relative age for multi-device session lists. Pure millisecond arithmetic. -}
formatSessionAge : Int -> Int -> String
formatSessionAge signonMs nowMs =
    if signonMs <= 0 then
        "unknown age"

    else
        -- Quotient safety: `//` wraps at 2^31, but minute-quotients of
        -- realistic signons stay far below it.
        let
            minutes =
                max 0 (nowMs - signonMs) // 60000
        in
        if minutes < 1 then
            "just now"

        else if minutes < 60 then
            String.fromInt minutes ++ "m active"

        else
            let
                hours =
                    minutes // 60
            in
            if hours < 48 then
                String.fromInt hours ++ "h active"

            else
                String.fromInt (hours // 24) ++ "d active"


sessionRowLabel : AccountSessionRow -> String
sessionRowLabel row =
    if row.current then
        "This connection"

    else if row.state == Attached then
        "Session #" ++ String.fromInt row.index

    else
        "Detached session #" ++ String.fromInt row.index


{-| Non-current attached sessions — bulk revoke targets. -}
otherAttachedSessions : List AccountSessionRow -> List AccountSessionRow
otherAttachedSessions rows =
    List.filter (\row -> not row.current && row.state == Attached) rows



-- capability matrix


type CapStatus
    = Active
    | Available
    | Missing
    | Unknown


type alias CapRow =
    { id : String
    , label : String
    , status : CapStatus
    , hint : String
    }


{-| Product-relevant caps surfaced in Account / Connect diagnostics. -}
productCaps : List { id : String, label : String, hint : String }
productCaps =
    [ { id = "sasl", label = "SASL login", hint = "Account authentication" }
    , { id = "batch", label = "Batches", hint = "Multiline + history batches" }
    , { id = "message-tags", label = "Message tags", hint = "msgid, replies, labels" }
    , { id = "server-time", label = "Server time", hint = "Authoritative timestamps" }
    , { id = "echo-message", label = "Echo message", hint = "Server echoes your sends" }
    , { id = "draft/chathistory", label = "Chat history", hint = "Message history sync" }
    , { id = "draft/read-marker", label = "Read markers", hint = "Multi-device read position" }
    , { id = "draft/multiline", label = "Multiline", hint = "Long messages as batches" }
    , { id = "onyx/e2ee", label = "Onyx E2EE", hint = "Encrypted DM tags" }
    , { id = "onyx/media", label = "Onyx media", hint = "Voice/video plane" }
    , { id = "draft/webpush", label = "Web Push", hint = "Closed-tab notifications" }
    ]


buildCapabilityMatrix : { negotiated : List String, available : List String } -> List CapRow
buildCapabilityMatrix input =
    let
        negotiated =
            List.map String.toLower input.negotiated

        available =
            List.map String.toLower input.available

        knowNothing =
            List.isEmpty negotiated && List.isEmpty available
    in
    List.map
        (\cap ->
            let
                id =
                    String.toLower cap.id

                status =
                    if hasCapability negotiated id then
                        Active

                    else if hasCapability available id then
                        Available

                    else if knowNothing then
                        Unknown

                    else
                        Missing
            in
            { id = cap.id, label = cap.label, status = status, hint = cap.hint }
        )
        productCaps


capabilitySummary : List CapRow -> String
capabilitySummary rows =
    String.fromInt (List.length (List.filter (\r -> r.status == Active) rows))
        ++ "/"
        ++ String.fromInt (List.length rows)
        ++ " product capabilities active"


{-| Client cap-table bounds, mirroring `client.ts`. -}
maxClientCapEntries : Int
maxClientCapEntries =
    256


maxCapNameLength : Int
maxCapNameLength =
    128


maxCapValueLength : Int
maxCapValueLength =
    4 * 1024


{-| One `CAP REQ` line stays within 380 chars of cap text, mirroring
the oracle chunker. -}
capReqChunkLength : Int
capReqChunkLength =
    380


isCapControl : Char -> Bool
isCapControl c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x7F


checkedCapUtf8ByteLength : String -> Maybe Int
checkedCapUtf8ByteLength value =
    String.foldr
        (\char tail -> Maybe.map2 (+) (capUtf8CodePointByteLength char) tail)
        (Just 0)
        value


capUtf8CodePointByteLength : Char -> Maybe Int
capUtf8CodePointByteLength char =
    let
        code =
            Char.toCode char

        units =
            String.length (String.fromChar char)

        surrogate =
            code >= 0xD800 && code <= 0xDFFF
    in
    if units == 1 && code >= 0 && code < 0x80 && not surrogate then
        Just 1

    else if units == 1 && code >= 0x80 && code < 0x800 && not surrogate then
        Just 2

    else if units == 1 && code >= 0x800 && code < 0x10000 && not surrogate then
        Just 3

    else if units == 2 && code >= 0x10000 && code <= 0x10FFFF then
        Just 4

    else
        Nothing


{-| Parse one advertised cap token (`name` or `name=value`),
mirroring `parseAdvertisedCap`: over-long or control-bearing names
(commas included) and values are refused. -}
parseCapToken : String -> Maybe { name : String, value : String }
parseCapToken token =
    case String.split "=" token of
        [] ->
            Nothing

        name :: rest ->
            let
                value =
                    String.join "=" rest

                nameByteLength =
                    checkedCapUtf8ByteLength name

                valueByteLength =
                    checkedCapUtf8ByteLength value
            in
            if String.isEmpty name || Maybe.withDefault (maxCapNameLength + 1) nameByteLength > maxCapNameLength then
                Nothing

            else if Maybe.withDefault (maxCapValueLength + 1) valueByteLength > maxCapValueLength then
                Nothing

            else if String.any isCapControl name || String.contains "," name then
                Nothing

            else if String.any isCapControl value then
                Nothing

            else
                Just { name = name, value = value }


dedupeNames : List String -> List String
dedupeNames names =
    List.foldl
        (\name acc ->
            if List.member name acc then
                acc

            else
                acc ++ [ name ]
        )
        []
        names


{-| Request only exact capability names in the implemented allowlist below.
`no-implicit-names` is safe because self-JOIN and reconnect paths issue
explicit NAMES requests. `tls`/`sts` (WSS is already in use), file-upload,
bot, and capabilities whose runtime has not passed its identity or transport
gate (`onyx/e2ee`, `onyx/media`) stay excluded. `sasl` is requested only when
ports holds a credential; the secret stays ports-side.
-}
wantedCaps : Bool -> List String -> List String
wantedCaps hasCredentials available =
    dedupeNames available
        |> List.filter
            (\cap ->
                List.member cap supportedClientCaps
                    && (hasCredentials || cap /= "sasl")
                    && not (cap == "no-implicit-names" && List.member "draft/no-implicit-names" available)
            )


{-| Explicit request allowlist: capabilities whose semantics this client
actually implements. Capabilities advertised by a server remain visible in
`capAvailable`, but are never negotiated merely because they were offered.
-}
supportedClientCaps : List String
supportedClientCaps =
    [ "sasl"
    , "account-notify"
    , "account-tag"
    , "away-notify"
    , "batch"
    , "cap-notify"
    , "chghost"
    , "channel-rename"
    , "draft/channel-rename"
    , "chathistory"
    , "draft/chathistory"
    , "multiline"
    , "draft/multiline"
    , "read-marker"
    , "draft/read-marker"
    , "draft/no-implicit-names"
    , "no-implicit-names"
    , "draft/search"
    , "draft/typing"
    , "draft/react"
    , "draft/reply"
    , "draft/message-editing"
    , "draft/message-redaction"
    , "typing"
    , "react"
    , "reply"
    , "message-editing"
    , "message-redaction"
    , "msgid"
    , "draft/webpush"
    , "echo-message"
    , "extended-join"
    , "invite-notify"
    , "labeled-response"
    , "message-tags"
    , "multi-prefix"
    , "draft/netsplit"
    , "draft/netjoin"
    , "onyx/session-sync"
    , "server-time"
    , "setname"
    , "standard-replies"
    , "userhost-in-names"
    , "account-extban"
    , "utf8-only"
    ]


{-| Test a negotiated capability by either its canonical server token or
its client-era `draft/` spelling. The server ACKs whichever token it was
asked for; this helper keeps feature gates interoperable across both.
-}
hasCapability : List String -> String -> Bool
hasCapability negotiated name =
    List.any (\candidate -> List.member candidate negotiated) (capabilitySpellings name)


capabilitySpellings : String -> List String
capabilitySpellings name =
    case name of
        "multiline" ->
            [ "multiline", "draft/multiline" ]

        "draft/multiline" ->
            [ "multiline", "draft/multiline" ]

        "chathistory" ->
            [ "chathistory", "draft/chathistory" ]

        "draft/chathistory" ->
            [ "chathistory", "draft/chathistory" ]

        "read-marker" ->
            [ "read-marker", "draft/read-marker" ]

        "draft/read-marker" ->
            [ "read-marker", "draft/read-marker" ]

        "channel-rename" ->
            [ "channel-rename", "draft/channel-rename" ]

        "draft/channel-rename" ->
            [ "channel-rename", "draft/channel-rename" ]

        "no-implicit-names" ->
            [ "no-implicit-names", "draft/no-implicit-names" ]

        "draft/no-implicit-names" ->
            [ "no-implicit-names", "draft/no-implicit-names" ]

        "typing" ->
            [ "typing", "draft/typing" ]

        "draft/typing" ->
            [ "typing", "draft/typing" ]

        "react" ->
            [ "react", "draft/react" ]

        "draft/react" ->
            [ "react", "draft/react" ]

        "reply" ->
            [ "reply", "draft/reply" ]

        "draft/reply" ->
            [ "reply", "draft/reply" ]

        "message-editing" ->
            [ "message-editing", "draft/message-editing" ]

        "draft/message-editing" ->
            [ "message-editing", "draft/message-editing" ]

        "message-redaction" ->
            [ "message-redaction", "draft/message-redaction" ]

        "draft/message-redaction" ->
            [ "message-redaction", "draft/message-redaction" ]

        _ ->
            [ name ]


{-| Split wanted caps into 380-char `CAP REQ` chunks, mirroring
`_requestCaps` (unique, space-joined, new chunk past the bound). -}
chunkCapReq : List String -> List String
chunkCapReq caps =
    let
        step cap ( done, current, currentLen ) =
            let
                nextLen =
                    currentLen + (if List.isEmpty current then 0 else 1) + String.length cap
            in
            if not (List.isEmpty current) && nextLen > capReqChunkLength then
                ( String.join " " (List.reverse current) :: done, [ cap ], String.length cap )

            else
                ( done
                , cap :: current
                , currentLen + (if currentLen > 0 then 1 else 0) + String.length cap
                )

        ( chunks, last, _ ) =
            List.foldl step ( [], [], 0 ) caps
    in
    List.reverse
        (if List.isEmpty last then
            chunks

         else
            String.join " " (List.reverse last) :: chunks
        )
