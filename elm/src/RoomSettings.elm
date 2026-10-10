module RoomSettings exposing
    ( BridgePlatform(..)
    , BridgeState(..)
    , BridgeStatus
    , Ctx
    , Effect(..)
    , GroupMark
    , Msg(..)
    , Privacy
    , Room
    , ScheduledEvent
    , State
    , blank
    , bridgeAction
    , bridgeAria
    , bridgeLabel
    , bridgeStatusOf
    , bridgeStatusProp
    , canEditTopic
    , encryptionPolicies
    , encryptionPolicyOf
    , ephemeralPresets
    , ephemeralSecondsOf
    , eventCountdown
    , eventProp
    , eventVisible
    , flagToggles
    , formatEphemeral
    , groupMark
    , historyPolicies
    , historyPolicyOf
    , insightCount
    , insightHour
    , insightSigned
    , isOpenFor
    , isValidScheduledTimestamp
    , modeSummary
    , parseBridgeStatus
    , parseScheduledEvent
    , privacyOf
    , scheduledEventOf
    , settle
    , topicExpanded
    , topicLocked
    , update
    )

{-| v3/roomsettings — the pure core of the Room settings sheet (oracle
`shell/ChannelSettings.tsx`) plus the room-header projections that
roadmap 3.1/3.8 hang off the same channel state: the privacy glyph,
the expandable topic, the scheduled-event line (`ScheduledEventLine` /
`notifications/scheduledEvents.ts`), the bridge badge
(`BridgeStatusBadge` / `interop/bridgeStatus.ts`), the group-control
mark (`GroupControlRoomIndicator`) and the insights formatters
(`RoomInsightsStrip`).

`update` never touches `App.Model`: it takes a `Ctx` snapshot of the
active room and returns `Effect`s that `App` interprets with its
existing folds (raw `TOPIC`/`MODE`/`ACCESS` lines, the optimistic
`writeChannelProp` + `PROP` publish, the `ACCESS LIST` loading mark,
the public chanstats detail fetch). Every write is gated the oracle
way: topic on `+t`/op, everything else op-only, all of it only on a
live connection. The server echo stays the source of truth for MODE
and TOPIC; props are optimistic exactly like `_writeChannelProp`.

-}

import Dict exposing (Dict)
import GroupControl
import HistoryPolicy
import Ircx
import Json.Decode as Decode
import Modes
import Wire



-- STATE


type alias State =
    { openFor : Maybe String
    , topicDraft : String
    , keyDraft : String
    , limitDraft : String
    , ephemeralDraft : String
    , encryptionDraft : String
    , historyDraft : String
    , accessLevelDraft : String
    , accessMaskDraft : String
    , accessTimeoutDraft : String
    , accessError : Maybe String
    , topicExpandedFor : Maybe String
    }


blank : State
blank =
    { openFor = Nothing
    , topicDraft = ""
    , keyDraft = ""
    , limitDraft = ""
    , ephemeralDraft = "0"
    , encryptionDraft = "off"
    , historyDraft = "public"
    , accessLevelDraft = "HOST"
    , accessMaskDraft = ""
    , accessTimeoutDraft = ""
    , accessError = Nothing
    , topicExpandedFor = Nothing
    }


{-| The active room as the sheet sees it (`props` is that room's IRCX
channel-prop map).
-}
type alias Room =
    { name : String
    , topic : String
    , modes : String
    , props : Dict String String
    }


type alias Ctx =
    { room : Maybe Room
    , connected : Bool
    , isOp : Bool
    }


type Msg
    = Open
    | Close
    | TopicInput String
    | TopicSubmit
    | FlagToggle Char
    | KeyInput String
    | KeySubmit
    | LimitInput String
    | LimitSubmit
    | EphemeralInput String
    | EphemeralSubmit
    | EncryptionInput String
    | EncryptionSubmit
    | HistoryInput String
    | HistorySubmit
    | AccessLevelInput String
    | AccessMaskInput String
    | AccessTimeoutInput String
    | AccessSubmit
    | AccessRemove { level : String, mask : String }
    | AccessRefresh
    | TopicExpandToggle String
    | EventClear


type Effect
    = Send String
    | WriteProp { channel : String, key : String, value : String }
    | RefreshAccess String
    | LoadInsights String



-- TABLES (copy verbatim with the oracle)


flagToggles : List { letter : Char, label : String, hint : String }
flagToggles =
    [ { letter = 'm', label = "Moderated", hint = "Only voiced members and hosts may speak." }
    , { letter = 'i', label = "Invite only", hint = "People must be invited to join." }
    , { letter = 't', label = "Topic locked", hint = "Only hosts may change the topic." }
    , { letter = 'n', label = "No external messages", hint = "Block messages from people who are not in the room." }
    , { letter = 's', label = "Secret", hint = "Hide the room from listings." }
    ]


ephemeralPresets : List { seconds : Int, label : String }
ephemeralPresets =
    [ { seconds = 0, label = "Off" }
    , { seconds = 3600, label = "1 hour" }
    , { seconds = 86400, label = "1 day" }
    , { seconds = 604800, label = "7 days" }
    , { seconds = 2592000, label = "30 days" }
    ]


encryptionPolicies : List { value : String, label : String, hint : String }
encryptionPolicies =
    [ { value = "off", label = "Off", hint = "Plaintext and encrypted messages are both accepted." }
    , { value = "optional", label = "Optional", hint = "Encrypted messages are marked when clients support Onyx Server E2EE." }
    , { value = "required", label = "Required", hint = "Clients should send only E2EE-tagged payloads here." }
    ]


historyPolicies : List { value : String, label : String, hint : String }
historyPolicies =
    [ { value = "public", label = "Public", hint = "Anyone who can request room history may read this room’s history (server default)." }
    , { value = "members", label = "Members only", hint = "Only people currently in the room may request history." }
    , { value = "opers", label = "Ops only", hint = "Only room ops (and network operators) may request history." }
    ]



-- SELECTORS


modeState : Room -> Modes.ChannelModeState
modeState room =
    Modes.parseChannelModeString room.modes


topicLocked : Room -> Bool
topicLocked room =
    List.member 't' (modeState room).flags


{-| `+t` locks the topic to hosts; without it anyone may set it. -}
canEditTopic : Ctx -> Room -> Bool
canEditTopic ctx room =
    not (topicLocked room) || ctx.isOp


{-| `selectChannelEphemeralSeconds`: the `EPHEMERAL` prop (either
case) as whole seconds in 60s..30d, else none.
-}
ephemeralSecondsOf : Dict String String -> Maybe Int
ephemeralSecondsOf props =
    let
        raw =
            case Dict.get "EPHEMERAL" props of
                Just v ->
                    v

                Nothing ->
                    Maybe.withDefault "" (Dict.get "ephemeral" props)
    in
    case String.toInt (String.trim raw) of
        Just seconds ->
            if seconds < 60 || seconds > maxEphemeralSeconds then
                Nothing

            else
                Just seconds

        Nothing ->
            Nothing


maxEphemeralSeconds : Int
maxEphemeralSeconds =
    30 * 24 * 60 * 60


{-| `selectChannelEncryptionPolicy` (`off`/`optional`/`required`). -}
encryptionPolicyOf : Dict String String -> String
encryptionPolicyOf props =
    case String.toLower (String.trim (Maybe.withDefault "" (Dict.get "encryption-policy" props))) of
        "optional" ->
            "optional"

        "required" ->
            "required"

        _ ->
            "off"


{-| `selectChannelHistoryPolicy` through the shared `HistoryPolicy`. -}
historyPolicyOf : Dict String String -> String
historyPolicyOf props =
    case HistoryPolicy.parseHistoryPolicy (Dict.get HistoryPolicy.historyPolicyProp props) of
        HistoryPolicy.Public ->
            "public"

        HistoryPolicy.Members ->
            "members"

        HistoryPolicy.Opers ->
            "opers"


formatEphemeral : Maybe Int -> String
formatEphemeral seconds =
    case seconds of
        Nothing ->
            "Full history"

        Just 0 ->
            "Full history"

        Just s ->
            case List.filter (\p -> p.seconds == s) ephemeralPresets of
                p :: _ ->
                    p.label

                [] ->
                    if modBy 86400 s == 0 then
                        String.fromInt (s // 86400) ++ " days"

                    else if modBy 3600 s == 0 then
                        String.fromInt (s // 3600) ++ " hours"

                    else if modBy 60 s == 0 then
                        String.fromInt (s // 60) ++ " minutes"

                    else
                        String.fromInt s ++ " seconds"


{-| The read-only rules summary (oracle `modeSummary`). -}
modeSummary : Room -> String
modeSummary room =
    let
        st =
            modeState room

        flagParts =
            flagToggles
                |> List.filter (\f -> List.member f.letter st.flags)
                |> List.map .label

        keyPart =
            if List.member 'k' st.flags && st.key /= Nothing then
                [ "Join key" ]

            else
                []

        limitPart =
            case ( List.member 'l' st.flags, st.limit ) of
                ( True, Just n ) ->
                    [ "Member limit " ++ String.fromInt n ]

                _ ->
                    []

        parts =
            flagParts ++ keyPart ++ limitPart
    in
    if List.isEmpty parts then
        "No special room rules"

    else
        String.join " · " parts



-- HEADER PROJECTIONS


type alias Privacy =
    { key : String
    , icon : String
    , label : String
    }


{-| The room header's privacy glyph, in words (never mode letters):
secret, invite-only and keyed rooms read as private; everything else
is public. A required encryption policy is named alongside.
-}
privacyOf : Room -> Privacy
privacyOf room =
    let
        st =
            modeState room

        has c =
            List.member c st.flags

        encrypted =
            encryptionPolicyOf room.props == "required"

        suffix =
            if encrypted then
                " · end-to-end encrypted"

            else
                ""
    in
    if has 's' then
        { key = "secret", icon = "lock", label = "Secret room — hidden from listings" ++ suffix }

    else if has 'i' then
        { key = "invite", icon = "lock", label = "Invite-only room" ++ suffix }

    else if has 'k' then
        { key = "key", icon = "lock", label = "Room needs a join key" ++ suffix }

    else if encrypted then
        { key = "encrypted", icon = "lock", label = "Public room · end-to-end encrypted" }

    else
        { key = "public", icon = "lock-open", label = "Public room" }


{-| Expanded one-line topic is per room, so it resets on room change. -}
topicExpanded : String -> State -> Bool
topicExpanded channel state =
    Maybe.map String.toLower state.topicExpandedFor == Just (String.toLower channel)


isOpenFor : Maybe String -> State -> Bool
isOpenFor active state =
    case ( active, state.openFor ) of
        ( Just a, Just o ) ->
            String.toLower a == String.toLower o

        _ ->
            False


{-| Leaving the room closes its settings sheet. -}
settle : Maybe String -> State -> State
settle active state =
    case state.openFor of
        Nothing ->
            state

        Just _ ->
            if isOpenFor active state then
                state

            else
                closed state


closed : State -> State
closed state =
    { state
        | openFor = Nothing
        , accessMaskDraft = ""
        , accessTimeoutDraft = ""
        , accessError = Nothing
        , accessLevelDraft = "HOST"
    }



-- SCHEDULED EVENT (notifications/scheduledEvents.ts)


type alias ScheduledEvent =
    { at : Float
    , title : String
    }


eventProp : String
eventProp =
    "ocean.event"


maxValidDateMs : Float
maxValidDateMs =
    8640000000000000


isValidScheduledTimestamp : Float -> Bool
isValidScheduledTimestamp at =
    not (isNaN at) && not (isInfinite at) && at > 0 && abs (at * 1000) <= maxValidDateMs


parseScheduledEvent : String -> Maybe ScheduledEvent
parseScheduledEvent raw =
    case String.indexes "|" raw of
        sep :: _ ->
            if sep < 1 then
                Nothing

            else
                let
                    title =
                        String.trim (String.dropLeft (sep + 1) raw)
                in
                case String.toFloat (String.trim (String.left sep raw)) of
                    Just at ->
                        if isValidScheduledTimestamp at && not (String.isEmpty title) then
                            Just { at = at, title = title }

                        else
                            Nothing

                    Nothing ->
                        Nothing

        [] ->
            Nothing


scheduledEventOf : Dict String String -> Maybe ScheduledEvent
scheduledEventOf props =
    Dict.get eventProp props |> Maybe.andThen parseScheduledEvent


eventGraceMs : Float
eventGraceMs =
    60 * 60 * 1000


{-| Visible until one hour after it started. -}
eventVisible : ScheduledEvent -> Float -> Bool
eventVisible event nowMs =
    isValidScheduledTimestamp event.at
        && not (isNaN nowMs)
        && not (isInfinite nowMs)
        && (nowMs < event.at * 1000 + eventGraceMs)


eventCountdown : ScheduledEvent -> Float -> String
eventCountdown event nowMs =
    if not (isValidScheduledTimestamp event.at) || isNaN nowMs || isInfinite nowMs then
        ""

    else
        let
            delta =
                event.at * 1000 - nowMs
        in
        if delta <= 0 then
            "happening now"

        else
            let
                mins =
                    max 1 (jsRound (delta / 60000))

                hrs =
                    jsRound (toFloat mins / 60)
            in
            if mins < 60 then
                "in " ++ String.fromInt mins ++ " min"

            else if hrs < 48 then
                "in " ++ String.fromInt hrs ++ "h"

            else
                "in " ++ String.fromInt (jsRound (toFloat hrs / 24)) ++ "d"


{-| `Math.round` (half rounds up). -}
jsRound : Float -> Int
jsRound x =
    floor (x + 0.5)



-- BRIDGE STATUS (interop/bridgeStatus.ts)


bridgeStatusProp : String
bridgeStatusProp =
    "ocean.bridge"


type BridgePlatform
    = Discord
    | Matrix
    | IrcBridge
    | UnknownPlatform


type BridgeState
    = BridgeUp
    | BridgeDown
    | BridgeDegraded


type alias BridgeStatus =
    { bridged : Bool
    , platform : BridgePlatform
    , state : BridgeState
    , lastSeen : Maybe String
    }


bridgeStatusOf : Dict String String -> BridgeStatus
bridgeStatusOf props =
    parseBridgeStatus (Maybe.withDefault "" (Dict.get bridgeStatusProp props))


parseBridgeStatus : String -> BridgeStatus
parseBridgeStatus payload =
    let
        trimmed =
            String.trim payload
    in
    if String.isEmpty trimmed then
        { bridged = False, platform = UnknownPlatform, state = BridgeDown, lastSeen = Nothing }

    else
        let
            fields =
                case fieldsFromJson trimmed of
                    Just f ->
                        f

                    Nothing ->
                        fieldsFromTokens trimmed
        in
        { bridged = True
        , platform = normalizePlatform (field fields [ "platform", "target", "network", "type" ])
        , state = normalizeState (field fields [ "state", "status", "health" ])
        , lastSeen = field fields [ "lastSeen", "seen", "updatedAt", "updated" ]
        }


cleanKey : String -> String
cleanKey key =
    String.toLower (String.trim key)
        |> String.filter (\c -> c /= '-' && c /= '_')


cleanValue : String -> Maybe String
cleanValue value =
    let
        clean =
            String.trim value
    in
    if String.isEmpty clean then
        Nothing

    else
        Just clean


{-| A JSON object of string/number fields (anything else is dropped,
mirroring `cleanValue`); arrays and scalars are not objects.
-}
fieldsFromJson : String -> Maybe (Dict String String)
fieldsFromJson payload =
    let
        scalar =
            Decode.oneOf
                [ Decode.map Just Decode.string
                , Decode.map (Just << jsNumber) Decode.float
                , Decode.succeed Nothing
                ]

        decoder =
            Decode.oneOf
                [ Decode.list Decode.value |> Decode.andThen (\_ -> Decode.fail "array")
                , Decode.keyValuePairs scalar
                ]
    in
    case Decode.decodeString decoder payload of
        Ok pairs ->
            Just
                (List.foldl
                    (\( k, v ) acc ->
                        case Maybe.andThen cleanValue v of
                            Just clean ->
                                Dict.insert (cleanKey k) clean acc

                            Nothing ->
                                acc
                    )
                    Dict.empty
                    pairs
                )

        Err _ ->
            Nothing


jsNumber : Float -> String
jsNumber f =
    if toFloat (round f) == f && abs f < 1.0e15 then
        String.fromInt (round f)

    else
        String.fromFloat f


fieldsFromTokens : String -> Dict String String
fieldsFromTokens payload =
    payload
        |> String.map
            (\c ->
                if c == ';' || c == ',' then
                    ' '

                else
                    c
            )
        |> String.words
        |> List.foldl
            (\token acc ->
                let
                    sep =
                        if String.contains "=" token then
                            Just "="

                        else if String.contains ":" token then
                            Just ":"

                        else
                            Nothing
                in
                case sep |> Maybe.andThen (\s -> List.head (String.indexes s token)) of
                    Just at ->
                        case cleanValue (String.dropLeft (at + 1) token) of
                            Just clean ->
                                Dict.insert (cleanKey (String.left at token)) clean acc

                            Nothing ->
                                acc

                    Nothing ->
                        acc
            )
            Dict.empty


field : Dict String String -> List String -> Maybe String
field fields keys =
    case keys of
        [] ->
            Nothing

        k :: rest ->
            case Dict.get (cleanKey k) fields of
                Just v ->
                    Just v

                Nothing ->
                    field fields rest


normalizePlatform : Maybe String -> BridgePlatform
normalizePlatform value =
    case String.toLower (String.trim (Maybe.withDefault "" value)) of
        "discord" ->
            Discord

        "matrix" ->
            Matrix

        "irc" ->
            IrcBridge

        _ ->
            UnknownPlatform


normalizeState : Maybe String -> BridgeState
normalizeState value =
    let
        clean =
            String.toLower (String.trim (Maybe.withDefault "" value))
    in
    if List.member clean [ "up", "ok", "online", "healthy" ] then
        BridgeUp

    else if List.member clean [ "down", "offline", "error", "failed" ] then
        BridgeDown

    else
        BridgeDegraded


platformLabel : BridgePlatform -> String
platformLabel platform =
    case platform of
        Discord ->
            "Discord"

        Matrix ->
            "Matrix"

        IrcBridge ->
            "IRC"

        UnknownPlatform ->
            "Bridge"


stateLabel : BridgeState -> String
stateLabel state =
    case state of
        BridgeUp ->
            "Up"

        BridgeDown ->
            "Down"

        BridgeDegraded ->
            "Degraded"


bridgeLabel : BridgeStatus -> String
bridgeLabel status =
    if not status.bridged then
        "No bridge"

    else
        platformLabel status.platform ++ " bridge: " ++ stateLabel status.state


bridgeAction : BridgeStatus -> String
bridgeAction status =
    if not status.bridged then
        "Ask a room admin to set up a bridge."

    else
        case status.state of
            BridgeUp ->
                "Messages are syncing normally."

            BridgeDown ->
                "Check the bridge connection or try again later."

            BridgeDegraded ->
                "Some messages may be delayed; check again shortly."


bridgeAria : BridgeStatus -> String
bridgeAria status =
    if not status.bridged then
        "No bridge is available for this room. Ask a room admin to set one up."

    else
        let
            seen =
                case status.lastSeen of
                    Just s ->
                        ", last seen " ++ s

                    Nothing ->
                        ""
        in
        platformLabel status.platform
            ++ " bridge is "
            ++ String.toLower (stateLabel status.state)
            ++ seen
            ++ ". "
            ++ bridgeAction status



-- GROUP-CONTROL MARK (GroupControlRoomIndicator)


type alias GroupMark =
    { state : String
    , detail : String
    , protection : String
    }


{-| Passive, channel-only projection. The Elm port has no runtime
lifecycle/activation plane, so activation is always held: a room
whose control applied reads "applied; message protection remains
inactive", never "active".
-}
groupMark : { isChannel : Bool, authenticated : Bool, status : Maybe GroupControl.RoomStatus } -> Maybe GroupMark
groupMark input =
    let
        mk state detail =
            Just { state = state, detail = detail, protection = "Message protection: not active" }
    in
    if not input.isChannel then
        Nothing

    else if not input.authenticated then
        mk "signed-out" "Sign in to inspect room controls"

    else
        case input.status of
            Just GroupControl.RoomLocked ->
                mk "locked" "Room controls locked"

            Just GroupControl.RoomDirectoryPending ->
                mk "pending" "Room controls pending"

            Just GroupControl.RoomPairPending ->
                mk "pending" "Room controls pending"

            Just GroupControl.RoomControlApplied ->
                mk "applied" "Room controls applied; message protection remains inactive"

            Just GroupControl.RoomRecoveryRequired ->
                mk "recovery-required" "Room controls need recovery"

            Just GroupControl.RoomRejected ->
                mk "recovery-required" "Room controls need recovery"

            Nothing ->
                mk "unavailable" "Room controls unavailable"



-- INSIGHTS FORMATTERS (RoomInsightsStrip)


insightCount : Int -> String
insightCount n =
    if n < 0 then
        "0"

    else if n >= 1000000 then
        fixed1 (toFloat n / 1000000) ++ "M"

    else if n >= 10000 then
        String.fromInt (jsRound (toFloat n / 1000)) ++ "k"

    else if n >= 1000 then
        fixed1 (toFloat n / 1000) ++ "k"

    else
        String.fromInt n


insightSigned : Int -> String
insightSigned n =
    if n > 0 then
        "+" ++ insightCount n

    else if n < 0 then
        "−" ++ insightCount (abs n)

    else
        "0"


insightHour : Maybe Int -> String
insightHour hour =
    case hour of
        Nothing ->
            "—"

        Just h ->
            String.padLeft 2 '0' (String.fromInt h) ++ ":00 UTC"


fixed1 : Float -> String
fixed1 x =
    let
        tenths =
            jsRound (x * 10)
    in
    String.fromInt (tenths // 10) ++ "." ++ String.fromInt (modBy 10 tenths)



-- UPDATE


update : Ctx -> Msg -> State -> ( State, List Effect )
update ctx msg state =
    case msg of
        Open ->
            case ctx.room of
                Nothing ->
                    ( state, [] )

                Just room ->
                    let
                        st =
                            modeState room
                    in
                    ( { state
                        | openFor = Just room.name
                        , topicDraft = room.topic
                        , keyDraft = Maybe.withDefault "" st.key
                        , limitDraft = Maybe.withDefault "" (Maybe.map String.fromInt st.limit)
                        , ephemeralDraft = String.fromInt (Maybe.withDefault 0 (ephemeralSecondsOf room.props))
                        , encryptionDraft = encryptionPolicyOf room.props
                        , historyDraft = historyPolicyOf room.props
                        , accessLevelDraft = "HOST"
                        , accessMaskDraft = ""
                        , accessTimeoutDraft = ""
                        , accessError = Nothing
                      }
                    , LoadInsights room.name
                        :: (if ctx.isOp && ctx.connected then
                                [ RefreshAccess room.name ]

                            else
                                []
                           )
                    )

        Close ->
            ( closed state, [] )

        TopicInput v ->
            ( { state | topicDraft = v }, [] )

        TopicSubmit ->
            withRoom ctx state <|
                \room ->
                    if canEditTopic ctx room && ctx.connected && state.topicDraft /= room.topic then
                        ( state, [ Send (Wire.formatIrcLine "TOPIC" [ room.name, state.topicDraft ]) ] )

                    else
                        ( state, [] )

        FlagToggle letter ->
            opOnly ctx state <|
                \room ->
                    if List.any (\f -> f.letter == letter) flagToggles then
                        let
                            sign =
                                if List.member letter (modeState room).flags then
                                    "-"

                                else
                                    "+"
                        in
                        ( state, [ Send (Wire.formatIrcLine "MODE" [ room.name, sign ++ String.fromChar letter ]) ] )

                    else
                        ( state, [] )

        KeyInput v ->
            ( { state | keyDraft = v }, [] )

        KeySubmit ->
            opOnly ctx state <|
                \room ->
                    let
                        next =
                            String.trim state.keyDraft

                        current =
                            Maybe.withDefault "" (modeState room).key
                    in
                    if next == current then
                        ( state, [] )

                    else if not (String.isEmpty next) then
                        ( state, [ Send (Wire.formatIrcLine "MODE" [ room.name, "+k", next ]) ] )

                    else
                        ( state, [ Send (Wire.formatIrcLine "MODE" [ room.name, "-k", current ]) ] )

        LimitInput v ->
            ( { state | limitDraft = v }, [] )

        LimitSubmit ->
            opOnly ctx state <|
                \room ->
                    let
                        raw =
                            String.trim state.limitDraft

                        current =
                            (modeState room).limit
                    in
                    if String.isEmpty raw then
                        if current /= Nothing then
                            ( state, [ Send (Wire.formatIrcLine "MODE" [ room.name, "-l" ]) ] )

                        else
                            ( state, [] )

                    else
                        case String.toInt raw of
                            Just n ->
                                if n <= 0 || Just n == current then
                                    ( state, [] )

                                else
                                    ( state, [ Send (Wire.formatIrcLine "MODE" [ room.name, "+l", String.fromInt n ]) ] )

                            Nothing ->
                                ( state, [] )

        EphemeralInput v ->
            ( { state | ephemeralDraft = v }, [] )

        EphemeralSubmit ->
            opOnly ctx state <|
                \room ->
                    case String.toInt state.ephemeralDraft of
                        Just seconds ->
                            let
                                valid =
                                    seconds == 0 || (seconds >= 60 && seconds <= maxEphemeralSeconds)
                            in
                            if not valid || seconds == Maybe.withDefault 0 (ephemeralSecondsOf room.props) then
                                ( state, [] )

                            else
                                ( state, [ WriteProp { channel = room.name, key = "EPHEMERAL", value = String.fromInt seconds } ] )

                        Nothing ->
                            ( state, [] )

        EncryptionInput v ->
            ( { state | encryptionDraft = v }, [] )

        EncryptionSubmit ->
            opOnly ctx state <|
                \room ->
                    let
                        next =
                            state.encryptionDraft
                    in
                    if next == encryptionPolicyOf room.props || not (List.member next [ "off", "optional", "required" ]) then
                        ( state, [] )

                    else
                        ( state, [ WriteProp { channel = room.name, key = "encryption-policy", value = next } ] )

        HistoryInput v ->
            if HistoryPolicy.isHistoryPolicy v then
                ( { state | historyDraft = v }, [] )

            else
                ( state, [] )

        HistorySubmit ->
            opOnly ctx state <|
                \room ->
                    let
                        next =
                            state.historyDraft
                    in
                    if next == historyPolicyOf room.props || not (HistoryPolicy.isHistoryPolicy next) then
                        ( state, [] )

                    else
                        ( state, [ WriteProp { channel = room.name, key = HistoryPolicy.historyPolicyProp, value = next } ] )

        AccessLevelInput v ->
            case Ircx.parseAccessLevel (Just v) of
                Just _ ->
                    ( { state | accessLevelDraft = String.toUpper (String.trim v) }, [] )

                Nothing ->
                    ( state, [] )

        AccessMaskInput v ->
            ( { state | accessMaskDraft = v }, [] )

        AccessTimeoutInput v ->
            ( { state | accessTimeoutDraft = v }, [] )

        AccessSubmit ->
            opOnly ctx state <|
                \room ->
                    case ( Ircx.parseAccessLevel (Just state.accessLevelDraft), Ircx.normalizeAccessMask (Just state.accessMaskDraft) ) of
                        ( Just _, Just mask ) ->
                            let
                                rawTimeout =
                                    String.trim state.accessTimeoutDraft

                                timeout =
                                    if String.isEmpty rawTimeout then
                                        Ok Nothing

                                    else
                                        case Ircx.parseAccessDuration (Just rawTimeout) of
                                            Just d ->
                                                Ok (Just (String.fromInt d))

                                            Nothing ->
                                                Err "Timeout must be a whole number of seconds (or leave blank)."
                            in
                            case timeout of
                                Err e ->
                                    ( { state | accessError = Just e }, [] )

                                Ok t ->
                                    case Ircx.accessAdd room.name state.accessLevelDraft mask t Nothing of
                                        Just line ->
                                            ( { state | accessError = Nothing, accessMaskDraft = "", accessTimeoutDraft = "" }
                                            , [ Send line ]
                                            )

                                        Nothing ->
                                            ( { state | accessError = Just maskError }, [] )

                        _ ->
                            ( { state | accessError = Just maskError }, [] )

        AccessRemove entry ->
            opOnly ctx state <|
                \room ->
                    case Ircx.accessDelete room.name entry.level entry.mask of
                        Just line ->
                            ( state, [ Send line ] )

                        Nothing ->
                            ( state, [] )

        AccessRefresh ->
            opOnly ctx state <|
                \room -> ( state, [ RefreshAccess room.name ] )

        TopicExpandToggle channel ->
            if topicExpanded channel state then
                ( { state | topicExpandedFor = Nothing }, [] )

            else
                ( { state | topicExpandedFor = Just channel }, [] )

        EventClear ->
            opOnly ctx state <|
                \room ->
                    if Dict.member eventProp room.props then
                        ( state, [ WriteProp { channel = room.name, key = eventProp, value = "" } ] )

                    else
                        ( state, [] )


maskError : String
maskError =
    "Enter a name or hostmask (e.g. alice or alice!*@*)."


withRoom : Ctx -> State -> (Room -> ( State, List Effect )) -> ( State, List Effect )
withRoom ctx state f =
    case ctx.room of
        Just room ->
            f room

        Nothing ->
            ( state, [] )


opOnly : Ctx -> State -> (Room -> ( State, List Effect )) -> ( State, List Effect )
opOnly ctx state f =
    if ctx.isOp && ctx.connected then
        withRoom ctx state f

    else
        ( state, [] )
