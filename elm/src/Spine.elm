module Spine exposing
    ( EventRedispatch(..)
    , ObserveAction(..)
    , OperCommand
    , OperEventCategory(..)
    , OperIntent(..)
    , commandLine
    , eventAdd
    , eventDel
    , eventList
    , foldEventLine
    , foldWallops
    , isObserveAction
    , isOperEventCategory
    , mediaSubscribe
    , observeList
    , observeOff
    , observeWatch
    , operEventCategories
    , operObserveActions
    , parseOperSlash
    , planOperAction
    , privsQuery
    , rehashNode
    )

{-| Event Spine & OBSERVE — Elm port of `lib/oper/operDesk.ts` (intent
planning, category/action tables, slash mapping) plus the `store.ts`
`EVENT`/`WALLOPS` fold shapes (protocol §11).

Fail-closed throughout: anything that cannot be expressed as a safe
single IRC line is a refusal with desk-renderable errors, and nothing
is sent. Summaries mark network-wide or session-ending actions
`destructive`, mirroring the oracle.

Raw `EVENT` lines only re-dispatch the MEDIA and WEBAUTHN planes;
category bodies and OBSERVE pushes via raw `EVENT` are ignored exactly
like the oracle (its §11 checklist box stays unchecked — the oper
NOTICE stream lives in `EventReplay`).

-}

import Wire


operEventCategories : List String
operEventCategories =
    [ "CONNECT"
    , "DISCONNECT"
    , "SERVER_LINK"
    , "FLOOD"
    , "ERROR"
    , "ANNOUNCE"
    , "OPER_ACTION"
    , "KILL"
    , "SPAM"
    , "DEBUG"
    , "POLICY"
    , "SERVICE"
    , "SECURITY"
    ]


type OperEventCategory
    = Connect
    | Disconnect
    | ServerLink
    | Flood
    | Error
    | Announce
    | OperAction
    | KillEvent
    | Spam
    | Debug
    | Policy
    | Service
    | Security


operObserveActions : List String
operObserveActions =
    [ "connect"
    , "quit"
    , "nick"
    , "join"
    , "part"
    , "host"
    , "oper"
    ]


type ObserveAction
    = ObserveConnect
    | ObserveQuit
    | ObserveNick
    | ObserveJoin
    | ObservePart
    | ObserveHost
    | ObserveOper


maxBroadcastLength : Int
maxBroadcastLength =
    400


maxObserveMaskLength : Int
maxObserveMaskLength =
    256


maxKillReasonLength : Int
maxKillReasonLength =
    400


maxOperNickLength : Int
maxOperNickLength =
    50


type OperIntent
    = Broadcast String
    | EventSubscribe String
    | EventUnsubscribe String
    | EventList
    | ObserveWatch { mask : String, actions : List String }
    | ObserveList
    | ObserveOff
    | Rehash
    | Privs
    | Kill { target : String, reason : String }


type alias OperCommand =
    { command : String
    , params : List String
    , summary : String
    , destructive : Bool
    }


{-| Validated wire line for `Main.wsSend`.
-}
commandLine : OperCommand -> String
commandLine cmd =
    Wire.formatIrcLine cmd.command cmd.params


isOperEventCategory : String -> Bool
isOperEventCategory value =
    List.member value operEventCategories


isObserveAction : String -> Bool
isObserveAction value =
    List.member value operObserveActions


normalizeCategory : String -> Maybe OperEventCategory
normalizeCategory value =
    case String.toUpper (String.trim value) of
        "CONNECT" ->
            Just Connect

        "DISCONNECT" ->
            Just Disconnect

        "SERVER_LINK" ->
            Just ServerLink

        "FLOOD" ->
            Just Flood

        "ERROR" ->
            Just Error

        "ANNOUNCE" ->
            Just Announce

        "OPER_ACTION" ->
            Just OperAction

        "KILL" ->
            Just KillEvent

        "SPAM" ->
            Just Spam

        "DEBUG" ->
            Just Debug

        "POLICY" ->
            Just Policy

        "SERVICE" ->
            Just Service

        "SECURITY" ->
            Just Security

        _ ->
            Nothing


categoryName : OperEventCategory -> String
categoryName category =
    case category of
        Connect ->
            "CONNECT"

        Disconnect ->
            "DISCONNECT"

        ServerLink ->
            "SERVER_LINK"

        Flood ->
            "FLOOD"

        Error ->
            "ERROR"

        Announce ->
            "ANNOUNCE"

        OperAction ->
            "OPER_ACTION"

        KillEvent ->
            "KILL"

        Spam ->
            "SPAM"

        Debug ->
            "DEBUG"

        Policy ->
            "POLICY"

        Service ->
            "SERVICE"

        Security ->
            "SECURITY"


normalizeObserveActions : List String -> Maybe (List ObserveAction)
normalizeObserveActions values =
    let
        toAction raw =
            case String.toLower (String.trim raw) of
                "connect" ->
                    Just ObserveConnect

                "quit" ->
                    Just ObserveQuit

                "nick" ->
                    Just ObserveNick

                "join" ->
                    Just ObserveJoin

                "part" ->
                    Just ObservePart

                "host" ->
                    Just ObserveHost

                "oper" ->
                    Just ObserveOper

                _ ->
                    Nothing

    in
    List.foldr
        (\raw acc ->
            case ( toAction raw, acc ) of
                ( Just a, Just rest ) ->
                    Just (a :: rest)

                _ ->
                    Nothing
        )
        (Just [])
        values


observeActionName : ObserveAction -> String
observeActionName action =
    case action of
        ObserveConnect ->
            "connect"

        ObserveQuit ->
            "quit"

        ObserveNick ->
            "nick"

        ObserveJoin ->
            "join"

        ObservePart ->
            "part"

        ObserveHost ->
            "host"

        ObserveOper ->
            "oper"


{-| Deduped, emitted in the documented order so one selection is
always one wire line.
-}
orderObserveActions : List ObserveAction -> List String
orderObserveActions actions =
    [ ObserveConnect, ObserveQuit, ObserveNick, ObserveJoin, ObservePart, ObserveHost, ObserveOper ]
        |> List.filter (\a -> List.member a actions)
        |> List.map observeActionName


isControlChar : Char -> Bool
isControlChar c =
    Char.toCode c <= 31 || Char.toCode c == 127


normalizeMask : String -> Maybe String
normalizeMask value =
    let
        mask =
            String.trim value
    in
    if String.isEmpty mask then
        Nothing

    else if String.length mask > maxObserveMaskLength then
        Nothing

    else if String.any (isControlChar) mask then
        Nothing

    else if String.any (\c -> c == ' ' || c == '\t' || c == '\n' || c == '\r') mask then
        Nothing

    else if String.startsWith ":" mask then
        Nothing

    else if String.all (\c -> c == '*' || c == '?' || c == '!' || c == '@' || c == '.') mask then
        -- Pure wildcards would observe the whole network and flood the
        -- session.
        Nothing

    else
        Just mask


normalizeOperNick : String -> Maybe String
normalizeOperNick value =
    let
        nick =
            String.trim value
    in
    if String.isEmpty nick || String.length nick > maxOperNickLength then
        Nothing

    else if String.any (isControlChar) nick then
        Nothing

    else if String.any (\c -> c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == ',' || c == ':' || c == '*' || c == '?' || c == '!' || c == '@') nick then
        Nothing

    else
        Just nick


normalizeFreeText : String -> Int -> Maybe String
normalizeFreeText value max =
    if String.any (isControlChar) value then
        Nothing

    else
        let
            text =
                String.trim value
        in
        if String.isEmpty text || String.length text > max then
            Nothing

        else
            Just text


{-| Validate an operator intent into the exact wire command.
`MEDIA` is accepted as an ADD/DEL category for the membership-gated
presence feed the client subscribes on registration.
-}
planOperAction : OperIntent -> Result (List String) OperCommand
planOperAction intent =
    case intent of
        Broadcast text ->
            case normalizeFreeText text maxBroadcastLength of
                Nothing ->
                    Err [ "Write the announcement first (under 400 characters, no line breaks)." ]

                Just clean ->
                    Ok
                        { command = "EVENT"
                        , params = [ "BROADCAST", clean ]
                        , summary = "Announce to operators subscribed to ANNOUNCE: \"" ++ clean ++ "\"."
                        , destructive = True
                        }

        EventSubscribe category ->
            planEventSub True category

        EventUnsubscribe category ->
            planEventSub False category

        EventList ->
            Ok
                { command = "EVENT"
                , params = [ "LIST" ]
                , summary = "List the Event Spine categories this session is subscribed to."
                , destructive = False
                }

        ObserveWatch { mask, actions } ->
            case normalizeMask mask of
                Nothing ->
                    Err [ "Enter a nick!user@host mask, wildcards allowed." ]

                Just clean ->
                    case normalizeObserveActions actions of
                        Nothing ->
                            Err [ "Pick from connect, quit, nick, join, part, host, or oper." ]

                        Just parsed ->
                            let
                                ordered =
                                    orderObserveActions parsed
                            in
                            Ok
                                { command = "EVENT"
                                , params = [ "OBSERVE", clean ] ++ ordered
                                , summary =
                                    if List.isEmpty ordered then
                                        "Watch " ++ clean ++ " network-wide. Their real host is revealed to you."

                                    else
                                        "Watch " ++ clean ++ " network-wide for " ++ String.join ", " ordered ++ ". Their real host is revealed to you."
                                , destructive = False
                                }

        ObserveList ->
            Ok
                { command = "EVENT"
                , params = [ "OBSERVE", "LIST" ]
                , summary = "List the standing OBSERVE masks on this session."
                , destructive = False
                }

        ObserveOff ->
            Ok
                { command = "EVENT"
                , params = [ "OBSERVE", "OFF" ]
                , summary = "Clear every standing OBSERVE mask on this session."
                , destructive = False
                }

        Rehash ->
            Ok
                { command = "REHASH"
                , params = []
                , summary = "Ask this node to reload its configuration (382 confirms)."
                , destructive = True
                }

        Privs ->
            Ok
                { command = "PRIVS"
                , params = []
                , summary = "Show the operator privileges this session holds (270)."
                , destructive = False
                }

        Kill { target, reason } ->
            case ( normalizeOperNick target, normalizeFreeText reason maxKillReasonLength ) of
                ( Nothing, _ ) ->
                    Err [ "Enter the nickname to disconnect." ]

                ( _, Nothing ) ->
                    -- A KILL without a reason is unaccountable; the network
                    -- log keeps it, so a reason is required.
                    Err [ "A reason is required — it is recorded network-wide." ]

                ( Just nick, Just clean ) ->
                    Ok
                        { command = "KILL"
                        , params = [ nick, clean ]
                        , summary = "Disconnect " ++ nick ++ " from the network with the reason \"" ++ clean ++ "\"."
                        , destructive = True
                        }


planEventSub : Bool -> String -> Result (List String) OperCommand
planEventSub subscribing category =
    let
        upper =
            String.toUpper (String.trim category)
    in
    if upper == "MEDIA" then
        Ok
            { command = "EVENT"
            , params =
                if subscribing then
                    [ "ADD", "MEDIA", "*" ]

                else
                    [ "DEL", "MEDIA" ]
            , summary =
                if subscribing then
                    "Receive MEDIA presence for channels you are in, from every node."

                else
                    "Stop receiving MEDIA presence."
            , destructive = False
            }

    else
        case normalizeCategory category of
            Nothing ->
                Err [ "Pick a category from the Event Spine list." ]

            Just parsed ->
                let
                    name =
                        categoryName parsed
                in
                Ok
                    { command = "EVENT"
                    , params =
                        if subscribing then
                            [ "ADD", name ]

                        else
                            [ "DEL", name ]
                    , summary =
                        if subscribing then
                            "Receive " ++ name ++ " events from every node on the network."

                        else
                            "Stop receiving " ++ name ++ " events."
                    , destructive = False
                    }


{-| Map a composer slash verb to an operator intent (`/wallops` is a
familiar alias only — the wire verb stays `EVENT BROADCAST`).
-}
parseOperSlash : String -> List String -> Maybe OperIntent
parseOperSlash name args =
    case String.toLower (String.trim name) of
        "broadcast" ->
            Just (Broadcast (String.join " " args))

        "wallops" ->
            Just (Broadcast (String.join " " args))

        "kill" ->
            Just
                (Kill
                    { target = Maybe.withDefault "" (List.head args)
                    , reason = String.join " " (List.drop 1 args)
                    }
                )

        "rehash" ->
            Just Rehash

        "privs" ->
            Just Privs

        "events" ->
            case List.map String.toLower args of
                "add" :: category :: _ ->
                    Just (EventSubscribe category)

                "del" :: category :: _ ->
                    Just (EventUnsubscribe category)

                "remove" :: category :: _ ->
                    Just (EventUnsubscribe category)

                _ ->
                    Just EventList

        "observe" ->
            case args of
                [] ->
                    Just ObserveList

                first :: rest ->
                    case String.toLower (String.trim first) of
                        "" ->
                            Just ObserveList

                        "list" ->
                            Just ObserveList

                        "off" ->
                            Just ObserveOff

                        "clear" ->
                            Just ObserveOff

                        _ ->
                            Just (ObserveWatch { mask = first, actions = rest })

        _ ->
            Nothing



-- ── Builders ─────────────────────────────────────────────────────────


eventAdd : String -> Maybe String
eventAdd category =
    Result.toMaybe (planOperAction (EventSubscribe category))
        |> Maybe.map commandLine


eventDel : String -> Maybe String
eventDel category =
    Result.toMaybe (planOperAction (EventUnsubscribe category))
        |> Maybe.map commandLine


eventList : String
eventList =
    "EVENT LIST\r\n"


mediaSubscribe : String
mediaSubscribe =
    "EVENT ADD MEDIA *\r\n"


observeWatch : String -> List String -> Maybe String
observeWatch mask actions =
    Result.toMaybe (planOperAction (ObserveWatch { mask = mask, actions = actions }))
        |> Maybe.map commandLine


observeList : String
observeList =
    "EVENT OBSERVE LIST\r\n"


observeOff : String
observeOff =
    "EVENT OBSERVE OFF\r\n"


rehashNode : String
rehashNode =
    "REHASH\r\n"


privsQuery : String
privsQuery =
    "PRIVS\r\n"



-- ── Folds ────────────────────────────────────────────────────────────


{-| Re-dispatch of one raw `EVENT` line. MEDIA presence re-shapes into
the NOTE MEDIA param order the media handler consumes; WEBAUTHN drops
the `<me>` target so the existing standard-reply fold stays the single
source of truth. Every other plane is ignored, like the oracle.
-}
type EventRedispatch
    = EventIgnored
    | EventAsNote { params : List String }
    | EventAsPasskey { params : List String }


foldEventLine : Wire.IrcMessage -> EventRedispatch
foldEventLine message =
    if message.command /= "EVENT" then
        EventIgnored

    else
        case List.map String.toUpper (List.take 2 message.params) of
            _ :: "MEDIA" :: [] ->
                EventAsNote
                    { params =
                        [ "MEDIA"
                        , paramAt 3 message.params
                        , paramAt 2 message.params
                        , paramAt 4 message.params
                        ]
                            ++ List.drop 5 message.params
                    }

            _ :: "WEBAUTHN" :: [] ->
                EventAsPasskey { params = List.drop 1 message.params }

            _ ->
                EventIgnored


paramAt : Int -> List String -> String
paramAt index params =
    Maybe.withDefault "" (List.head (List.drop index params))


{-| `WALLOPS :<text>` renders into the server log as
`WALLOPS: <text>` (empty trailing stays empty, like the oracle).
-}
foldWallops : Wire.IrcMessage -> Maybe String
foldWallops message =
    if message.command /= "WALLOPS" then
        Nothing

    else
        Just ("WALLOPS: " ++ paramAt (List.length message.params - 1) message.params)
