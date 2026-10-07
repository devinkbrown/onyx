module Notify exposing
    ( NotifyDecision
    , NotifyDecisionInput
    , NotifyKind(..)
    , Permission(..)
    , isAlertKind
    , isAppInactive
    , shouldNotify
    )

{-| Desktop/sound alert decision (a 1:1 Elm mirror of
`src/lib/notifications/decision.ts`): pure in, pure out. Reasons are
the oracle's literal codes so vectors translate line-for-line. `Elm`
performs the granted alert behind ports; the fold only decides. -}


type NotifyKind
    = Mention
    | Dm
    | Follow
    | Call
    | System
    | Error


type Permission
    = Granted
    | Denied
    | Default
    | Unsupported


type alias NotifyDecisionInput =
    { kind : NotifyKind
    , isSelf : Bool
    , muted : Bool
    , smartMuted : Bool
    , pushEnabled : Bool
    , soundEnabled : Bool
    , dnd : Bool
    , permission : Permission
    , pageVisible : Bool
    , appFocused : Bool
    , nowMs : Float
    , lastDesktopAtMs : Maybe Float
    , lastSoundAtMs : Maybe Float
    , desktopThrottleMs : Maybe Float
    , soundThrottleMs : Maybe Float
    }


type alias NotifyDecision =
    { desktop : Bool
    , sound : Bool
    , desktopReason : String
    , soundReason : String
    }


isAlertKind : NotifyKind -> Bool
isAlertKind kind =
    case kind of
        Mention ->
            True

        Dm ->
            True

        Follow ->
            True

        Call ->
            True

        System ->
            False

        Error ->
            False


isAppInactive : Bool -> Bool -> Bool
isAppInactive pageVisible appFocused =
    not pageVisible || not appFocused


throttled : Maybe Float -> Float -> Float -> Bool
throttled last now limitMs =
    case last of
        Nothing ->
            False

        Just at ->
            now - at < limitMs


{-| Mirror of `shouldNotify`: shared base block (kind/self/mute/focus/
dnd), then desktop needs push + granted permission + throttle, sound
needs its switch + throttle. -}
shouldNotify : NotifyDecisionInput -> NotifyDecision
shouldNotify input =
    let
        muted =
            input.muted || input.smartMuted

        baseBlock =
            if not (isAlertKind input.kind) then
                Just "not-message-alert"

            else if input.isSelf then
                Just "self"

            else if muted then
                Just "muted"

            else if not (isAppInactive input.pageVisible input.appFocused) then
                Just "focused"

            else if input.dnd then
                Just "dnd"

            else
                Nothing

        desktopReason =
            case baseBlock of
                Just reason ->
                    reason

                Nothing ->
                    if not input.pushEnabled then
                        "disabled"

                    else if input.permission == Unsupported then
                        "unsupported"

                    else if input.permission /= Granted then
                        "permission"

                    else if throttled input.lastDesktopAtMs input.nowMs (Maybe.withDefault 6000 input.desktopThrottleMs) then
                        "throttled"

                    else
                        "ok"

        soundReason =
            case baseBlock of
                Just reason ->
                    reason

                Nothing ->
                    if not input.soundEnabled then
                        "disabled"

                    else if throttled input.lastSoundAtMs input.nowMs (Maybe.withDefault 1500 input.soundThrottleMs) then
                        "throttled"

                    else
                        "ok"
    in
    { desktop = desktopReason == "ok"
    , sound = soundReason == "ok"
    , desktopReason = desktopReason
    , soundReason = soundReason
    }
