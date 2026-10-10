module DmSafety exposing
    ( Evidence
    , HeaderState(..)
    , Load(..)
    , State
    , acceptLabel
    , blank
    , close
    , deviceReadiness
    , dmKeyChangeAlert
    , dmKeyChangeBody
    , dmKeyChangeTitle
    , dmPrivacyScope
    , dmPrivateChip
    , dmPrivateChipLabel
    , dmVerifyAction
    , emptyNumberCopy
    , evidenceFor
    , evidenceReady
    , foldAcceptResult
    , foldResult
    , forget
    , groups
    , headerState
    , isOpenFor
    , keyChangeStateCopy
    , markAccepting
    , markLoading
    , needsLoad
    , numberAriaLabel
    , numberLabel
    , pendingNumber
    , currentNumber
    , plaintextChip
    , plaintextChipLabel
    , sealDeviceLabel
    , toggle
    , verifyGuidanceTail
    , warningDeviceClause
    )

{-| v3/dmsafety — pure core of the DM safety number panel and the
inline key-change row (mirroring `shell/DmSafetySheet.tsx`,
`shell/DmKeyChangeBanner.tsx` and `lib/e2ee/dmPrivacyChrome.ts`).

The App owns the TOFU flag (`peerKeyChanges`) and the device directory;
this module owns only what the two surfaces add on top: which peer's
panel is open, the per-peer safety evidence loaded through the
`dmSafetyRequest` port (stamped with the exact key set and key-change
flag it was requested for, so a rotation or acceptance invalidates it),
and the accept attempt state. Raw device keys are never rendered.

-}

import Dict exposing (Dict)
import Set exposing (Set)


{-| One safety number load: in flight, or settled (`Nothing` =
unavailable).
-}
type Load
    = Loading
    | Loaded (Maybe String)


{-| Evidence for one peer, stamped with the presented key set and the
key-change flag it was computed for.
-}
type alias Evidence =
    { keys : List String
    , keyChanged : Bool
    , current : Load
    , pending : Load
    }


type alias State =
    { openFor : Maybe String
    , evidence : Dict String Evidence
    , accepting : Set String
    , persistFailed : Set String
    }


blank : State
blank =
    { openFor = Nothing
    , evidence = Dict.empty
    , accepting = Set.empty
    , persistFailed = Set.empty
    }


keyOf : String -> String
keyOf peer =
    String.toLower (String.trim peer)



-- ── Copy (dmPrivacyChrome.ts, verbatim) ──────────────────────────────


dmPrivateChip : String
dmPrivateChip =
    "Private"


dmPrivateChipLabel : String
dmPrivateChipLabel =
    "Private — DM message text is encrypted for you and the other person. Plaintext drafts and attachments may remain on this device and are not covered."


dmVerifyAction : String
dmVerifyAction =
    "Verify"


dmKeyChangeBody : String
dmKeyChangeBody =
    "This usually means they reinstalled Onyx or added a device. Encrypted messages stay locked until you review it; plaintext drafts and attachments are separate local-device data."


dmPrivacyScope : String
dmPrivacyScope =
    "Encrypted messages and their wire payloads are covered by the DM key check. Plaintext local drafts and attachments are not encrypted by this check and may remain on this device."


dmKeyChangeAlert : String -> String
dmKeyChangeAlert name =
    name ++ "'s device key changed. Compare the new safety number before you continue."


dmKeyChangeTitle : String -> String
dmKeyChangeTitle name =
    name ++ "'s device key changed"


{-| Elm addition: the oracle header shows no chip for a plaintext DM;
the v3 design asks the header to always state the E2EE posture.
-}
plaintextChip : String
plaintextChip =
    "Not encrypted"


plaintextChipLabel : String -> String
plaintextChipLabel name =
    "Not encrypted — " ++ name ++ "’s device key has not arrived yet, so messages are sent as plain text."



-- ── Header state ─────────────────────────────────────────────────────


type HeaderState
    = KeyChanged
    | Private
    | Plaintext


{-| `showDmPrivateChip` (key present AND seal-ready) → Private; a
pending key change → KeyChanged (fail closed, never Private);
otherwise Plaintext.
-}
headerState : { keyChanged : Bool, sealKeys : List String } -> HeaderState
headerState input =
    if input.keyChanged then
        KeyChanged

    else if List.isEmpty input.sealKeys then
        Plaintext

    else
        Private



-- ── Panel open/close ─────────────────────────────────────────────────


isOpenFor : String -> State -> Bool
isOpenFor peer state =
    state.openFor == Just (keyOf peer)


{-| Verify toggles the panel for one peer. Closing drops the cached
evidence so a reopen re-runs the loader (the oracle's
"retries when an unavailable result is closed and reopened").
-}
toggle : String -> State -> State
toggle peer state =
    if isOpenFor peer state then
        close state

    else
        { state | openFor = Just (keyOf peer) }


close : State -> State
close state =
    case state.openFor of
        Nothing ->
            state

        Just key ->
            { state
                | openFor = Nothing
                , evidence =
                    -- Keep evidence the key-change row still needs.
                    case Dict.get key state.evidence of
                        Just ev ->
                            if ev.keyChanged then
                                state.evidence

                            else
                                Dict.remove key state.evidence

                        Nothing ->
                            state.evidence
            }


{-| Drop everything held for a peer (accept / dismiss). -}
forget : String -> State -> State
forget peer state =
    let
        key =
            keyOf peer
    in
    { state
        | evidence = Dict.remove key state.evidence
        , accepting = Set.remove key state.accepting
        , persistFailed = Set.remove key state.persistFailed
    }



-- ── Evidence loading ─────────────────────────────────────────────────


evidenceFor : String -> State -> Maybe Evidence
evidenceFor peer state =
    Dict.get (keyOf peer) state.evidence


{-| A load is needed when a surface wants the evidence and none is held
for this exact (key set, key-change flag) stamp.
-}
needsLoad : { peer : String, keys : List String, keyChanged : Bool } -> State -> Bool
needsLoad input state =
    case evidenceFor input.peer state of
        Nothing ->
            True

        Just ev ->
            ev.keys /= input.keys || ev.keyChanged /= input.keyChanged


markLoading : { peer : String, keys : List String, keyChanged : Bool } -> State -> State
markLoading input state =
    let
        key =
            keyOf input.peer

        stale =
            case Dict.get key state.evidence of
                Just ev ->
                    ev.keys /= input.keys

                Nothing ->
                    True
    in
    { state
        | evidence =
            Dict.insert key
                { keys = input.keys, keyChanged = input.keyChanged, current = Loading, pending = Loading }
                state.evidence

        -- A new pending key is a distinct acceptance attempt.
        , accepting =
            if stale then
                Set.remove key state.accepting

            else
                state.accepting
        , persistFailed =
            if stale then
                Set.remove key state.persistFailed

            else
                state.persistFailed
    }


{-| Fold a port result. Stale answers (a different key set than the one
currently awaited) are dropped, so a rotated peer never inherits an
older number.
-}
foldResult : { peer : String, keys : List String, current : Maybe String, pending : Maybe String } -> State -> State
foldResult result state =
    let
        key =
            keyOf result.peer
    in
    case Dict.get key state.evidence of
        Just ev ->
            if ev.keys == result.keys then
                { state
                    | evidence =
                        Dict.insert key
                            { ev | current = Loaded (nonBlank result.current), pending = Loaded (nonBlank result.pending) }
                            state.evidence
                }

            else
                state

        Nothing ->
            state


nonBlank : Maybe String -> Maybe String
nonBlank =
    Maybe.andThen
        (\s ->
            if String.isEmpty (String.trim s) then
                Nothing

            else
                Just (String.trim s)
        )


currentNumber : String -> State -> Maybe String
currentNumber peer state =
    case evidenceFor peer state of
        Just { current } ->
            case current of
                Loaded n ->
                    n

                Loading ->
                    Nothing

        Nothing ->
            Nothing


pendingNumber : String -> State -> Maybe String
pendingNumber peer state =
    case evidenceFor peer state of
        Just { pending } ->
            case pending of
                Loaded n ->
                    n

                Loading ->
                    Nothing

        Nothing ->
            Nothing


{-| Accept is armed only with BOTH exact numbers for the live key set. -}
evidenceReady : String -> List String -> State -> Bool
evidenceReady peer keys state =
    case evidenceFor peer state of
        Just ev ->
            ev.keys == keys && currentNumber peer state /= Nothing && pendingNumber peer state /= Nothing

        Nothing ->
            False


markAccepting : String -> State -> State
markAccepting peer state =
    { state
        | accepting = Set.insert (keyOf peer) state.accepting
        , persistFailed = Set.remove (keyOf peer) state.persistFailed
    }


{-| A failed persistence keeps the warning and offers a retry; an ok
result is folded by the App (which clears the flag). A result for a
key set that is no longer live is ignored.
-}
foldAcceptResult : { peer : String, keys : List String, ok : Bool, liveKeys : List String } -> State -> State
foldAcceptResult result state =
    let
        key =
            keyOf result.peer
    in
    if result.keys /= result.liveKeys || not (Set.member key state.accepting) then
        state

    else if result.ok then
        forget key state

    else
        { state
            | accepting = Set.remove key state.accepting
            , persistFailed = Set.insert key state.persistFailed
        }



-- ── Display helpers ──────────────────────────────────────────────────


{-| Split "12345 67890 …" into readable groups. -}
groups : Maybe String -> List String
groups value =
    case value of
        Just s ->
            String.words s

        Nothing ->
            []


{-| `sealDeviceLabel`: device count clamped to 1…99, two digits. -}
sealDeviceLabel : Int -> String
sealDeviceLabel n =
    String.padLeft 2 '0' (String.fromInt (Basics.min 99 (Basics.max 1 n)))


deviceReadiness : Int -> String
deviceReadiness n =
    if n <= 0 then
        "Not received"

    else if n == 1 then
        "1 device received"

    else
        String.fromInt n ++ " devices received"


verifyGuidanceTail : Int -> String
verifyGuidanceTail n =
    if n > 1 then
        "all " ++ String.fromInt n ++ " of their advertised device keys"

    else
        "the device key they published"


numberLabel : Int -> String
numberLabel n =
    if n > 1 then
        "Current safety number · " ++ String.fromInt n ++ " devices"

    else
        "Current safety number"


numberAriaLabel : String -> Int -> String -> String
numberAriaLabel name n number =
    if n > 1 then
        "Safety number for " ++ name ++ " across " ++ String.fromInt n ++ " devices: " ++ number

    else
        "Safety number for " ++ name ++ ": " ++ number


warningDeviceClause : Int -> String
warningDeviceClause n =
    if n > 1 then
        " or a new device appears"

    else
        ""


{-| Empty-number copy: loading, a key with no trusted pair yet, or no
key at all.
-}
emptyNumberCopy : { name : String, loading : Bool, deviceCount : Int } -> String
emptyNumberCopy input =
    if input.loading then
        "Loading this device’s safety number…"

    else if input.deviceCount > 0 then
        "No trusted device pair is ready to compare yet."

    else
        input.name ++ "’s device key has not arrived yet."


{-| The key-change row's evidence status line (`Nothing` once both
numbers are in).
-}
keyChangeStateCopy : { current : Maybe String, pending : Maybe String } -> Maybe String
keyChangeStateCopy input =
    case ( input.current, input.pending ) of
        ( Just _, Just _ ) ->
            Nothing

        ( Nothing, Nothing ) ->
            Just "Safety numbers are unavailable. Try again to calculate them."

        _ ->
            Just "Waiting for both exact safety numbers before acceptance."


acceptLabel : { accepting : Bool, persistFailed : Bool } -> String
acceptLabel input =
    if input.accepting then
        "Saving trusted key…"

    else if input.persistFailed then
        "Retry saving trusted key"

    else
        "Accept new device key"
