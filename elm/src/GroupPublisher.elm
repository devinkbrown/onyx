module GroupPublisher exposing
    ( Effect(..)
    , Failure(..)
    , Identity
    , State
    , Status(..)
    , blank
    , canonicalAccount
    , connected
    , disconnected
    , failureToString
    , identityProjected
    , isTransientFailure
    , parseConfirm
    , publishLine
    , registered
    , retryDue
    , setAccount
    , statusToString
    , trustedBody
    , trustedFailure
    , vaultReset
    )

{-| Our device's ODD1 public-record publication — Elm port of the pure
state machine in `src/lib/e2ee/groupDevicePublisher.ts`.

Split of responsibilities, mirroring the oracle:

  - Key custody stays ports-side: the Ed25519 `sign-v1` pair and the P-256
    `dm-v1` pair live in the `onyx-keys` IndexedDB (never the vault); only
    public bytes cross into Elm for the ODD1 build.
  - This module owns the publication lifecycle: generations, the two-send
    cap, transient-vs-terminal failures, and the ADDED-confirm gate.
  - The `E2EEKEY ADD <deviceId> onyx-ogc1-v1 <directory>` wire line is
    built here; `Main` sends it as a `SendLine`.

Fail-closed throughout: no account, no projection, or a mangled identity
means nothing is sent. A successful write is never presented as
message-encryption activation — the public state omits the directory
bytes, exactly like the oracle.

One documented deviation: the oracle keys ownership on
`(endpoint, clientId, account, generation, connectionGeneration)`. Elm has
a single `App` instance per tab, so there is exactly one client and the
`clientId` lane is folded away; `(endpoint, account, generations)` still
invalidate the same way.

-}

import GroupDirectory


{-| Wire algorithm id for the ADD command and the ADDED confirm,
mirroring `GROUP_DEVICE_DIRECTORY_ALGORITHM`.
-}
algorithm : String
algorithm =
    GroupDirectory.directoryAlgorithm


{-| Publication lifecycle, mirroring `GroupDevicePublicationStatus`. -}
type Status
    = Inactive
    | Projecting
    | Sent
    | ServerAckObserved


{-| Terminal and retryable failures, mirroring
`GroupDevicePublicationFailure`. `SendFailed` is unrepresentable through
the port boundary (a `SendLine` has no result channel): the scheduled
retry covers a lost first send, so it never fires here.
-}
type Failure
    = ProjectionUnavailable
    | SendFailed
    | ServerTransient
    | ServerRejected


{-| Pure state. `deviceId`/`pendingDirectory` are the pending
publication (cleared on terminal reject/ack/invalidation); the directory
bytes are retained for the one retry but never rendered, mirroring the
oracle's private `pending` (which its public state omits). -}
type alias State =
    { status : Status
    , generation : Int
    , connectionGeneration : Int
    , endpoint : String
    , account : Maybe String
    , deviceId : Maybe String
    , pendingDirectory : Maybe String
    , attempts : Int
    , failure : Maybe Failure
    , connected : Bool
    , registered : Bool
    }


{-| Ports-side identity projection: public parts only. -}
type alias Identity =
    { deviceId : String
    , directory : String
    }


{-| Effect intentions for `App`/`Main` to perform. -}
type Effect
    = RequestIdentity
    | Publish { deviceId : String, directory : String }
    | ScheduleRetry


statusToString : Status -> String
statusToString status =
    case status of
        Inactive ->
            "inactive"

        Projecting ->
            "projecting"

        Sent ->
            "sent"

        ServerAckObserved ->
            "server-ack-observed"


failureToString : Failure -> String
failureToString failure =
    case failure of
        ProjectionUnavailable ->
            "projection-unavailable"

        SendFailed ->
            "send-failed"

        ServerTransient ->
            "server-transient"

        ServerRejected ->
            "server-rejected"


{-| Fresh machine for one endpoint. -}
blank : String -> State
blank endpoint =
    { status = Inactive
    , generation = 0
    , connectionGeneration = 0
    , endpoint = endpoint
    , account = Nothing
    , deviceId = Nothing
    , pendingDirectory = Nothing
    , attempts = 0
    , failure = Nothing
    , connected = False
    , registered = False
    }


{-| Account canonicalization, mirroring the oracle's `canonicalAccount`:
trimmed, lowercased, `^[a-z0-9_.@-]{1,64}$`, else `Nothing`.
-}
canonicalAccount : Maybe String -> Maybe String
canonicalAccount value =
    case value of
        Nothing ->
            Nothing

        Just raw ->
            let
                normalized =
                    String.toLower (String.trim raw)
            in
            if String.isEmpty normalized || String.length normalized > 64 then
                Nothing

            else if List.all isAccountChar (String.toList normalized) then
                Just normalized

            else
                Nothing


isAccountChar : Char -> Bool
isAccountChar c =
    Char.isAlphaNum c || c == '_' || c == '.' || c == '@' || c == '-'


{-| Derived `ogc1-…` id shape: the oracle's 22-char digest suffix. -}
validDerivedId : String -> Bool
validDerivedId value =
    case String.split "-" value of
        [ "ogc1", suffix ] ->
            String.length suffix == 22 && List.all isB64UrlChar (String.toList suffix)

        _ ->
            False


isB64UrlChar : Char -> Bool
isB64UrlChar c =
    Char.isAlphaNum c || c == '-' || c == '_'


invalidate : State -> State
invalidate state =
    { state
        | status = Inactive
        , deviceId = Nothing
        , pendingDirectory = Nothing
        , attempts = 0
        , failure = Nothing
    }


{-| Shared start gate, mirroring `start()`: needs a live registered
connection and an account; a terminal reject latches until the next
invalidation; an in-flight projection or completed send is a no-op.
-}
start : State -> ( State, List Effect )
start state =
    if not state.connected || not state.registered || state.account == Nothing then
        ( state, [] )

    else if state.failure == Just ServerRejected then
        ( state, [] )

    else
        case state.status of
            Projecting ->
                ( state, [] )

            Sent ->
                ( state, [] )

            ServerAckObserved ->
                ( state, [] )

            Inactive ->
                ( { state | status = Projecting, deviceId = Nothing, attempts = 0, failure = Nothing }
                , [ RequestIdentity ]
                )


{-| Socket connected: bump the connection generation and invalidate,
mirroring `onConnected`. -}
connected : State -> ( State, List Effect )
connected state =
    if state.connected then
        start state

    else
        start
            (invalidate
                { state
                    | connected = True
                    , registered = False
                    , connectionGeneration = state.connectionGeneration + 1
                    , generation = state.generation + 1
                }
            )


{-| Registration (001) complete: mark registered and start. -}
registered : State -> ( State, List Effect )
registered state =
    if not state.connected then
        ( state, [] )

    else
        start { state | registered = True }


{-| Socket lost: drop liveness, bump the connection generation,
invalidate. Mirrors `onDisconnected`. -}
disconnected : State -> State
disconnected state =
    if not state.connected && not state.registered then
        state

    else
        invalidate
            { state
                | connected = False
                , registered = False
                , connectionGeneration = state.connectionGeneration + 1
                , generation = state.generation + 1
            }


{-| Vault reset: invalidate and restart, mirroring `onVaultReset`. -}
vaultReset : State -> ( State, List Effect )
vaultReset state =
    start (invalidate { state | generation = state.generation + 1 })


{-| Authenticated account learned (900) or cleared: a change
invalidates; then the start gate runs. Mirrors
`setAuthenticatedAccount`. -}
setAccount : Maybe String -> State -> ( State, List Effect )
setAccount next state =
    let
        canonical =
            canonicalAccount next
    in
    if canonical == state.account then
        start state

    else
        start (invalidate { state | account = canonical, generation = state.generation + 1 })


{-| Verify a ports-side identity before publishing: the directory must
round-trip through the ODD1 codec and the device id must carry the
derived `ogc1-…` shape. Mirrors the oracle's
`derivedId == identity.deviceId` gate (the SHA-256 itself stays
ports-side with the keys).
-}
verifyIdentity : Identity -> Maybe { deviceId : String, directory : String }
verifyIdentity identity =
    case GroupDirectory.decodeEntry identity.directory of
        Nothing ->
            Nothing

        Just entry ->
            if not (validDerivedId identity.deviceId) then
                Nothing

            else
                case GroupDirectory.encodeEntry entry of
                    Just canonical ->
                        if canonical == identity.directory then
                            Just { deviceId = identity.deviceId, directory = identity.directory }

                        else
                            Nothing

                    Nothing ->
                        Nothing


{-| Identity projection resolved. A verified identity sends the first
ADD and schedules the retry; a missing or mangled one fails
`projection-unavailable` with nothing sent. Mirrors the projection
half of `start()`.
-}
identityProjected : Maybe Identity -> State -> ( State, List Effect )
identityProjected maybeIdentity state =
    if state.status /= Projecting then
        ( state, [] )

    else
        case Maybe.andThen verifyIdentity maybeIdentity of
            Nothing ->
                ( { state | status = Inactive, failure = Just ProjectionUnavailable }, [] )

            Just verified ->
                ( { state
                    | status = Sent
                    , deviceId = Just verified.deviceId
                    , pendingDirectory = Just verified.directory
                    , attempts = 1
                    , failure = Nothing
                  }
                , [ Publish verified, ScheduleRetry ]
                )


{-| Retry timer due: resend once (attempt 2 of 2), then stop. Any state
other than an unacknowledged first send is a no-op — a late timer after
an ack or invalidation sends nothing. Mirrors `attemptSend` on retry.
-}
retryDue : State -> ( State, List Effect )
retryDue state =
    -- Mirrors `attemptSend` on the retry timer: a first send still
    -- awaiting its ack resends once, and a transient failure re-arms
    -- from `Inactive` while the pending publication survives. A late
    -- timer after an ack, a reject, or an invalidation sends nothing.
    if state.attempts >= 2 then
        ( state, [] )

    else if state.status /= Sent && state.failure /= Just ServerTransient then
        ( state, [] )

    else
        case ( state.deviceId, state.pendingDirectory ) of
            ( Just deviceId, Just directory ) ->
                ( { state | status = Sent, attempts = state.attempts + 1 }
                , [ Publish { deviceId = deviceId, directory = directory } ]
                )

            _ ->
                ( state, [] )


{-| Parse an `E2EEKEY ADDED id=<id> alg=<alg>` confirm body, mirroring
`CONFIRM_RE`. Anything else is not a confirm.
-}
parseConfirm : String -> Maybe { id : String, alg : String }
parseConfirm body =
    case String.words (String.trim body) of
        [ "E2EEKEY", "ADDED", idField, algField ] ->
            case ( String.split "=" idField, String.split "=" algField ) of
                ( [ "id", id ], [ "alg", alg ] ) ->
                    if validConfirmToken id 32 && validConfirmToken alg 64 then
                        Just { id = id, alg = alg }

                    else
                        Nothing

                _ ->
                    Nothing

        _ ->
            Nothing


validConfirmToken : String -> Int -> Bool
validConfirmToken value maxLen =
    let
        len =
            String.length value
    in
    len >= 1 && len <= maxLen && List.all isConfirmChar (String.toList value)


isConfirmChar : Char -> Bool
isConfirmChar c =
    Char.isAlphaNum c || c == '_' || c == '.' || c == '-'


{-| Codes the server may answer a failed ADD with that are worth one
retry, mirroring `TRANSIENT_FAILURES`. -}
isTransientFailure : String -> Bool
isTransientFailure code =
    case String.toUpper (String.trim code) of
        "DURABLE_UNAVAILABLE" ->
            True

        "STORE_FAILED" ->
            True

        "TEMPORARILY_UNAVAILABLE" ->
            True

        _ ->
            False


{-| Trusted-server body observed (NOTICE from the 001-learned prefix).
An `ADDED` confirm for the pending device id and algorithm marks
`server-ack-observed`; anything else is ignored. The oracle's warning
holds: this proves the server emitted an ack for this id/alg, never
confirmation of an owner/generation. Mirrors
`observeTrustedServerBody`.
-}
trustedBody : String -> State -> ( State, Bool )
trustedBody body state =
    if state.status /= Sent then
        ( state, False )

    else
        case ( parseConfirm body, state.deviceId ) of
            ( Just confirm, Just deviceId ) ->
                if confirm.id == deviceId && confirm.alg == algorithm then
                    ( { state | status = ServerAckObserved, failure = Nothing }, True )

                else
                    ( state, False )

            _ ->
                ( state, False )


{-| Trusted `FAIL E2EEKEY <code>` observed. A transient code with a send
left re-arms for one retry; anything else latches `server-rejected`
and clears the pending id. Mirrors `observeTrustedFailure`.
-}
trustedFailure : String -> State -> ( State, List Effect )
trustedFailure code state =
    if state.status /= Sent then
        ( state, [] )

    else if isTransientFailure code && state.attempts < 2 then
        ( { state | status = Inactive, failure = Just ServerTransient }, [ ScheduleRetry ] )

    else
        ( { state | status = Inactive, deviceId = Nothing, pendingDirectory = Nothing, failure = Just ServerRejected }, [] )


{-| Build the `E2EEKEY ADD` wire line for a verified identity. -}
publishLine : { deviceId : String, directory : String } -> String
publishLine verified =
    "E2EEKEY ADD " ++ verified.deviceId ++ " " ++ algorithm ++ " " ++ verified.directory
