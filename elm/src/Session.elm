module Session exposing
    ( AccountSessionRow
    , CapRow
    , CapStatus(..)
    , ReclaimClock
    , ReclaimPlan(..)
    , ReclaimSkipReason(..)
    , ReclaimTokenKind(..)
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
    , isSessionDropSuccess
    , isSessionListEnd
    , otherAttachedSessions
    , parseSessionDropOk
    , parseSessionListLine
    , planSessionReclaim
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


type ReclaimSkipReason
    = Unauthenticated
    | Expired
    | NoneHeld


type alias ReclaimTokens =
    { sessionToken : Maybe String
    , meshToken : Maybe String
    , meshTokenExpiresAt : Maybe Float
    }


type alias ReclaimClock =
    { now : Float
    , authenticated : Bool
    }


type ReclaimPlan
    = Attempt { token : String, kind : ReclaimTokenKind, meshExpired : Bool }
    | Skip { reason : ReclaimSkipReason, meshExpired : Bool }


type MeshStatus
    = Usable
    | ExpiredMesh
    | AbsentMesh


meshStatus : ReclaimTokens -> Float -> MeshStatus
meshStatus tokens now =
    if not (Wire.isValidSessionCredential tokens.meshToken) then
        AbsentMesh

    else
        case tokens.meshTokenExpiresAt of
            Nothing ->
                -- A legacy note without `expires=` has no local deadline;
                -- the server still enforces its own, so offer it rather
                -- than discarding a working bearer.
                Usable

            Just expiresAt ->
                -- Garbage in the deadline is not evidence of freshness.
                if isNaN expiresAt || isInfinite expiresAt then
                    ExpiredMesh

                else if now < expiresAt - reclaimExpirySkewMs then
                    Usable

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
        case tokens.meshToken of
            Just bearer ->
                Attempt { token = bearer, kind = MeshBearer, meshExpired = False }

            Nothing ->
                Skip { reason = NoneHeld, meshExpired = meshExpired }

    else if Wire.isValidSessionCredential tokens.sessionToken then
        case tokens.sessionToken of
            Just bearer ->
                Attempt { token = bearer, kind = LocalBearer, meshExpired = meshExpired }

            Nothing ->
                Skip { reason = NoneHeld, meshExpired = meshExpired }

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
    meshStatus tokens now == Usable || Wire.isValidSessionCredential tokens.sessionToken



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
                    if List.member id negotiated then
                        Active

                    else if List.member id available then
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
            in
            if String.isEmpty name || String.length name > maxCapNameLength then
                Nothing

            else if String.length value > maxCapValueLength then
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


{-| Caps the client requests, mirroring `_wantedCaps`. Always-off:
`tls` (WSS already), `sts` (advertised, not negotiated),
`no-implicit-names` (would suppress the 353 burst the roster
needs), `draft/file-upload` (unimplemented), `bot` (human client).
`sasl` joins the request only when a credential is held — the
secret itself stays ports-side; the flag only says one exists.
Everything else is requested. -}
wantedCaps : Bool -> List String -> List String
wantedCaps hasCredentials available =
    dedupeNames available
        |> List.filter
            (\cap ->
                cap /= "tls"
                    && cap /= "sts"
                    && (hasCredentials || cap /= "sasl")
                    && cap /= "no-implicit-names"
                    && cap /= "draft/file-upload"
                    && cap /= "bot"
            )


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
