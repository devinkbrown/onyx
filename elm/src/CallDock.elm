module CallDock exposing
    ( Corner(..)
    , JoinError(..)
    , PipFace
    , PipPosition
    , PipSummary
    , Ring(..)
    , RingCommand
    , acceptAria
    , acceptErrorText
    , acceptingStatus
    , cancelAria
    , codecToast
    , cornerFromWord
    , cornerWord
    , declineAria
    , decodeAcceptFailed
    , decodeErrorKind
    , decodePipPosition
    , defaultPip
    , encodePipPosition
    , failedSub
    , incomingAlert
    , joinErrorFromKind
    , keyStep
    , lostDetail
    , nextCorner
    , nudge
    , pipFaceLimit
    , pipLiveAria
    , pipLiveLabel
    , pipSize
    , pipSummary
    , pipVisible
    , reconnecting
    , recoveryNote
    , ringFor
    , ringStartable
    , ringTimedOut
    , ringTimeoutMs
    , settle
    )

{-| v3/calls-c6 — pure logic for the call surfaces that live outside
the in-room stage (`elm/design/calls/CALLS_DESIGN.md` §2.8, §2.9,
§2.14, §2.15, §6 C6/C7/C10):

  - C6 DM ring overlays: which dialog shows (`ringFor`), oracle copy
    (`IncomingCallOverlay.tsx` / `OutgoingCallOverlay.tsx`), the start
    guard, and the client-side ring timeout (`RING_TIMEOUT_MS`, 30s —
    the oracle store's `startDmCall` timer; spec §7.7 is open, so a
    timed-out outgoing ring provisionally reuses `CallEnded`).
  - C7 picture-in-picture: visibility (`InCall` and viewing another
    target), corner cycle (the WCAG 2.5.7 non-drag alternative),
    keyboard / drag nudges clamped to the viewport, persisted position
    (`onyx:voice-pip-position`), and the facepile summary (port of
    `VoicePip.participantSummary`).
  - C10 recovery: the derived reconnecting state
    (`InCall ∧ connection ≠ Live`), "Reconnected" announcement, rejoin
    memory for a dropped call, and classified join / codec errors fed
    by the `voiceCallHub` snapshot's `errorKind`.

DOM-free; `App` folds it through `settle` after every update.

-}

import Json.Decode as Decode
import Json.Encode as Encode
import Media exposing (CallHub, CallLifecycle(..), CallOutcome(..))
import Set exposing (Set)



-- C6 · RING


type Ring
    = RingIncoming String
    | RingOutgoing String


{-| A ring command for the engine bridge (`voiceRing` port): verb is
one of `accept`, `reject`, `hangup`, `start`.
-}
type alias RingCommand =
    { verb : String
    , peer : String
    }


{-| Engine ring timeout (`MediaEngine.RING_TIMEOUT_MS`, spec §2.9). -}
ringTimeoutMs : Int
ringTimeoutMs =
    30000


{-| Which ring dialog shows, with the display name ("Unknown caller"
/ "Unknown recipient" when the engine reported no peer).
-}
ringFor : CallHub -> Maybe Ring
ringFor hub =
    let
        peer =
            String.trim hub.withPeer

        named fallback =
            if String.isEmpty peer then
                fallback

            else
                peer
    in
    case hub.lifecycle of
        RingingIn ->
            Just (RingIncoming (named "Unknown caller"))

        RingingOut ->
            Just (RingOutgoing (named "Unknown recipient"))

        _ ->
            Nothing


incomingAlert : String -> String
incomingAlert caller =
    "Incoming call from " ++ caller


declineAria : String -> String
declineAria caller =
    "Decline call from " ++ caller


acceptAria : String -> String
acceptAria caller =
    "Accept call from " ++ caller


cancelAria : String -> String
cancelAria callee =
    "Cancel call to " ++ callee


acceptingStatus : String -> String
acceptingStatus caller =
    "Accepting call from " ++ caller ++ "…"


acceptErrorText : String -> String
acceptErrorText caller =
    "Could not accept the call from " ++ caller ++ ". Try again."


{-| A DM call can start only on a live socket, from idle, to a valid
nick that is not a channel and not ourselves (oracle `startDmCall`
needs a client; the engine validates the rest).
-}
ringStartable : { live : Bool, hub : CallHub, ourNick : String, peer : String } -> Bool
ringStartable input =
    let
        peer =
            String.trim input.peer
    in
    input.live
        && (input.hub.lifecycle == Idle)
        && Media.validEngineNick peer
        && not (String.startsWith "#" peer || String.startsWith "&" peer)
        && (String.toLower peer /= String.toLower (String.trim input.ourNick))


{-| The ring has outlived the engine timeout. -}
ringTimedOut : { since : Maybe Float, now : Float } -> Bool
ringTimedOut input =
    case input.since of
        Just since ->
            input.now - since >= toFloat ringTimeoutMs

        Nothing ->
            False


{-| `acceptFailed: true` on a ringing snapshot (the bridge's report
that the engine's accept promise rejected).
-}
decodeAcceptFailed : Decode.Value -> Bool
decodeAcceptFailed raw =
    Decode.decodeValue (Decode.field "acceptFailed" Decode.bool) raw
        |> Result.withDefault False



-- C7 · PICTURE-IN-PICTURE


type Corner
    = BottomRight
    | BottomLeft
    | TopLeft
    | TopRight


{-| Where the mini view sits: an anchor corner plus inward offsets in
px from that corner's 12px margin (always ≥ 0, so a nudge back toward
the anchor never has slack to burn).
-}
type alias PipPosition =
    { corner : Corner
    , x : Int
    , y : Int
    }


defaultPip : PipPosition
defaultPip =
    { corner = BottomRight, x = 0, y = 0 }


{-| Clockwise: bottom-right → bottom-left → top-left → top-right. -}
nextCorner : Corner -> Corner
nextCorner corner =
    case corner of
        BottomRight ->
            BottomLeft

        BottomLeft ->
            TopLeft

        TopLeft ->
            TopRight

        TopRight ->
            BottomRight


cornerWord : Corner -> String
cornerWord corner =
    case corner of
        BottomRight ->
            "bottom-right"

        BottomLeft ->
            "bottom-left"

        TopLeft ->
            "top-left"

        TopRight ->
            "top-right"


cornerFromWord : String -> Maybe Corner
cornerFromWord word =
    case word of
        "bottom-right" ->
            Just BottomRight

        "bottom-left" ->
            Just BottomLeft

        "top-left" ->
            Just TopLeft

        "top-right" ->
            Just TopRight

        _ ->
            Nothing


anchoredRight : Corner -> Bool
anchoredRight corner =
    corner == BottomRight || corner == TopRight


anchoredBottom : Corner -> Bool
anchoredBottom corner =
    corner == BottomRight || corner == BottomLeft


{-| Mini-view footprint by viewport width: 300×170 on desktop, the
160×150 card below the 768px breakpoint (spec §2.8 / §2.18).
-}
pipSize : Int -> { width : Int, height : Int }
pipSize viewportWidth =
    if viewportWidth > 0 && viewportWidth < 768 then
        { width = 160, height = 150 }

    else
        { width = 300, height = 170 }


pipMargin : Int
pipMargin =
    12


{-| Move by a screen-space delta (px; +x right, +y down), clamped so
the card stays fully inside the viewport. An unmeasured viewport
(width or height ≤ 0) only clamps at the anchor side (and at the
oracle's 100000px coordinate cap).
-}
nudge : { dx : Int, dy : Int } -> { width : Int, height : Int } -> PipPosition -> PipPosition
nudge delta viewport pos =
    let
        size =
            pipSize viewport.width

        inwardX =
            if anchoredRight pos.corner then
                -delta.dx

            else
                delta.dx

        inwardY =
            if anchoredBottom pos.corner then
                -delta.dy

            else
                delta.dy

        maxX =
            if viewport.width <= 0 then
                100000

            else
                max 0 (viewport.width - size.width - 2 * pipMargin)

        maxY =
            if viewport.height <= 0 then
                100000

            else
                max 0 (viewport.height - size.height - 2 * pipMargin)
    in
    { pos
        | x = clamp 0 maxX (pos.x + inwardX)
        , y = clamp 0 maxY (pos.y + inwardY)
    }


{-| Arrow keys move 16px, Shift+arrows 48px (spec §2.8). -}
keyStep : { key : String, shift : Bool } -> Maybe { dx : Int, dy : Int }
keyStep input =
    let
        step =
            if input.shift then
                48

            else
                16
    in
    case input.key of
        "ArrowLeft" ->
            Just { dx = -step, dy = 0 }

        "ArrowRight" ->
            Just { dx = step, dy = 0 }

        "ArrowUp" ->
            Just { dx = 0, dy = -step }

        "ArrowDown" ->
            Just { dx = 0, dy = step }

        _ ->
            Nothing


encodePipPosition : PipPosition -> Encode.Value
encodePipPosition pos =
    Encode.object
        [ ( "corner", Encode.string (cornerWord pos.corner) )
        , ( "x", Encode.int pos.x )
        , ( "y", Encode.int pos.y )
        ]


{-| Fail-closed decode of the stored position: an unknown corner, a
non-integer, negative or oversized offset (> 100000, the oracle's
coordinate cap) all fall back to `defaultPip`. The oracle's absolute
`{x, y}` shape has no corner and so also falls back.
-}
decodePipPosition : Decode.Value -> PipPosition
decodePipPosition raw =
    let
        offset =
            Decode.int
                |> Decode.andThen
                    (\n ->
                        if n >= 0 && n <= 100000 then
                            Decode.succeed n

                        else
                            Decode.fail "offset out of range"
                    )

        decoder =
            Decode.map3 PipPosition
                (Decode.field "corner" Decode.string
                    |> Decode.andThen
                        (\word ->
                            case cornerFromWord word of
                                Just corner ->
                                    Decode.succeed corner

                                Nothing ->
                                    Decode.fail "unknown corner"
                        )
                )
                (Decode.field "x" offset)
                (Decode.field "y" offset)
    in
    Decode.decodeValue decoder raw |> Result.withDefault defaultPip


{-| Shows only while in the call's media session (`InCall`), the call
has a target, the viewed conversation is another one, and the Calls
hub (which owns the call surface) is closed.
-}
pipVisible : { hub : CallHub, activeChannel : Maybe String, callsOpen : Bool } -> Bool
pipVisible input =
    case Media.hubRoomLabel input.hub of
        Just target ->
            (input.hub.lifecycle == InCall)
                && not input.callsOpen
                && (case input.activeChannel of
                        Just active ->
                            String.toLower (String.trim active) /= String.toLower target

                        Nothing ->
                            True
                   )

        Nothing ->
            False


type alias PipFace =
    { key : String
    , speaking : Bool
    , muted : Bool
    , self : Bool
    }


type alias PipSummary =
    { visible : List PipFace
    , total : Int
    , speaking : Int
    }


pipFaceLimit : Int
pipFaceLimit =
    5


{-| Port of `VoicePip.participantSummary`: self first, then the call
roster, deduplicated case-insensitively; speakers sort first (stable);
at most five faces, with the full totals reported.
-}
pipSummary :
    { ourNick : String
    , selfMuted : Bool
    , roster : List String
    , speaking : Set String
    , muted : Set String
    }
    -> PipSummary
pipSummary input =
    let
        selfKey =
            String.toLower (String.trim input.ourNick)

        speakingKeys =
            Set.map String.toLower input.speaking

        mutedKeys =
            Set.map String.toLower input.muted

        keys =
            (if String.isEmpty selfKey then
                []

             else
                [ selfKey ]
            )
                ++ List.map (String.trim >> String.toLower) input.roster

        unique =
            List.foldl
                (\key ( seen, acc ) ->
                    if String.isEmpty key || Set.member key seen then
                        ( seen, acc )

                    else
                        ( Set.insert key seen, key :: acc )
                )
                ( Set.empty, [] )
                keys
                |> Tuple.second
                |> List.reverse

        face key =
            let
                isSelf =
                    key == selfKey
            in
            { key = key
            , speaking = Set.member key speakingKeys
            , muted = Set.member key mutedKeys || (isSelf && input.selfMuted)
            , self = isSelf
            }

        faces =
            List.map face unique

        ordered =
            List.filter .speaking faces ++ List.filter (not << .speaking) faces
    in
    { visible = List.take pipFaceLimit ordered
    , total = List.length faces
    , speaking = List.length (List.filter .speaking faces)
    }


{-| "{n} live" / "live". -}
pipLiveLabel : Int -> String
pipLiveLabel speaking =
    if speaking > 0 then
        String.fromInt speaking ++ " live"

    else
        "live"


pipLiveAria : Int -> String
pipLiveAria speaking =
    String.fromInt speaking ++ " speaking"



-- C10 · RECOVERY


type JoinError
    = PermissionDenied
    | NoDevice
    | AccountRequired
    | EncryptionUnavailable
    | JoinOther


{-| The engine has no `reconnecting` state; the shell derives it:
in a call while the socket is not live (spec §2.14).
-}
reconnecting : CallHub -> Bool -> Bool
reconnecting hub live =
    hub.lifecycle == InCall && not live


{-| "Trying to rejoin {target} — your place in the conversation is
kept." -}
lostDetail : String -> String
lostDetail target =
    "Trying to rejoin " ++ target ++ " — your place in the conversation is kept."


{-| The optional `errorKind` word on a snapshot (absent / non-string
→ `Nothing`).
-}
decodeErrorKind : Decode.Value -> Maybe String
decodeErrorKind raw =
    Decode.decodeValue (Decode.field "errorKind" Decode.string) raw
        |> Result.toMaybe


{-| Classified `getUserMedia` failure (the bridge maps
`NotAllowedError`/`SecurityError` → `permission`,
`NotFoundError`/`OverconstrainedError` → `no_device`, anything else
→ `other`). Codec words are not join errors.
-}
joinErrorFromKind : String -> Maybe JoinError
joinErrorFromKind kind =
    case kind of
        "permission" ->
            Just PermissionDenied

        "no_device" ->
            Just NoDevice

        -- v3/calls-engine: media E2EE needs an account + enrolled device key.
        "account" ->
            Just AccountRequired

        "encryption" ->
            Just EncryptionUnavailable

        "other" ->
            Just JoinOther

        _ ->
            Nothing


{-| Failed-banner sub line (§2.3 / §2.15). -}
failedSub : Maybe JoinError -> String -> String
failedSub error room =
    case error of
        Just PermissionDenied ->
            "Onyx needs microphone access. Allow it in your browser's site settings, then try again."

        Just NoDevice ->
            "No microphone was found. Connect one or check Voice settings."

        Just AccountRequired ->
            "Calls are end-to-end encrypted and need an Onyx account. Sign in, then try again."

        Just EncryptionUnavailable ->
            "This browser couldn't set up call encryption. Make sure site storage isn't blocked, then try again."

        _ ->
            "Your place in " ++ room ++ " is kept."


{-| Codec / encoder failure toasts (§2.15, oracle copy). -}
codecToast : String -> Maybe { title : String, description : String }
codecToast kind =
    case kind of
        -- v3/calls-engine: the server has no direct-call target (MEDIA takes
        -- channels only), so a DM ring fails closed with this explanation.
        "unsupported" ->
            Just
                { title = "Direct calls aren't available yet"
                , description = "This server carries calls in rooms only. Start one from a room instead."
                }

        "codec" ->
            Just
                { title = "Media codec unavailable"
                , description = "Could not load the media codec. Video and enhanced audio are disabled in this browser."
                }

        "encoder" ->
            Just
                { title = "Camera could not start"
                , description = "Video encoding failed after trying every quality. Your camera preview may show, but others cannot see you."
                }

        _ ->
            Nothing


{-| The recovery note after one step of the derived reconnecting
state: "Reconnected" (new copy) when it clears while the call
survives, cleared when it starts (the lost banner is its own alert),
otherwise unchanged (`Nothing`).
-}
recoveryNote : { was : Bool, now : Bool, lifecycle : CallLifecycle } -> Maybe String
recoveryNote input =
    if input.was && not input.now && input.lifecycle == InCall then
        Just "Reconnected"

    else if not input.was && input.now then
        Just ""

    else
        Nothing



-- SETTLE


{-| Post-update fold for the docked call surfaces, comparing the model
before and after one update:

  - ring bookkeeping: stamp when a ring starts, drop accept state when
    the ring ends or the caller changes, and time an unanswered ring
    out after `ringTimeoutMs` (outgoing → hang up, provisional
    `CallEnded`; incoming → reject, no outcome — a missed call);
  - recovery: track the derived reconnecting state and its
    "Reconnected" note; remember the room of a dropped call for the
    rejoin banner; clear the join error once a call is under way.

-}
settle :
    { live : Bool, now : Float }
    -> { b | calls : CallHub }
    ->
        { a
            | calls : CallHub
            , callAccepting : Bool
            , callAcceptError : Bool
            , callRingSince : Maybe Float
            , callWasReconnecting : Bool
            , callRecoveryNote : String
            , callRejoin : Maybe String
            , callJoinError : Maybe JoinError
        }
    ->
        ( { a
            | calls : CallHub
            , callAccepting : Bool
            , callAcceptError : Bool
            , callRingSince : Maybe Float
            , callWasReconnecting : Bool
            , callRecoveryNote : String
            , callRejoin : Maybe String
            , callJoinError : Maybe JoinError
          }
        , List RingCommand
        )
settle env before after =
    let
        hub =
            after.calls

        ringing =
            hub.lifecycle == RingingIn || hub.lifecycle == RingingOut

        sameRing =
            (before.calls.lifecycle == hub.lifecycle)
                && (String.toLower before.calls.withPeer == String.toLower hub.withPeer)

        since =
            if not ringing then
                Nothing

            else if sameRing then
                Just (Maybe.withDefault env.now after.callRingSince)

            else
                Just env.now

        keepAccept =
            hub.lifecycle == RingingIn && sameRing

        timedOut =
            ringing && ringTimedOut { since = since, now = env.now }

        ( timedHub, commands ) =
            if timedOut then
                case hub.lifecycle of
                    RingingOut ->
                        ( { blankHub | outcome = Just CallEnded }, [ { verb = "hangup", peer = hub.withPeer } ] )

                    _ ->
                        ( blankHub, [ { verb = "reject", peer = hub.withPeer } ] )

            else
                ( hub, [] )

        nowReconnecting =
            reconnecting timedHub env.live

        note =
            case recoveryNote { was = after.callWasReconnecting, now = nowReconnecting, lifecycle = timedHub.lifecycle } of
                Just text ->
                    text

                Nothing ->
                    if timedHub.lifecycle == Idle then
                        ""

                    else
                        after.callRecoveryNote

        dropped =
            (before.calls.lifecycle /= Idle)
                && (timedHub.lifecycle == Idle)
                && (timedHub.outcome == Just CallDropped)

        rejoin =
            if dropped then
                case before.calls.channel of
                    Just channel ->
                        Just channel

                    Nothing ->
                        after.callRejoin

            else if timedHub.lifecycle /= Idle then
                Nothing

            else
                after.callRejoin

        joinError =
            if timedHub.lifecycle /= Idle then
                Nothing

            else
                after.callJoinError

        next =
            { after
                | calls = timedHub
                , callRingSince =
                    if timedOut then
                        Nothing

                    else
                        since
                , callAccepting = keepAccept && not timedOut && after.callAccepting
                , callAcceptError = keepAccept && not timedOut && after.callAcceptError
                , callWasReconnecting = nowReconnecting
                , callRecoveryNote = note
                , callRejoin = rejoin
                , callJoinError = joinError
            }
    in
    ( next, commands )


blankHub : CallHub
blankHub =
    Media.blankCallHub
