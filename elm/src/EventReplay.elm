module EventReplay exposing
    ( EventReplayEvent
    , EventReplayFeed
    , EventReplayNotice(..)
    , applyEventReplayNotice
    , emptyEventReplayFeed
    , eventReplayJsonParams
    , formatEventReplayEvent
    , maxEvents
    , maxNoticeChars
    , parseEventReplayNotice
    , utf16Length
    )

{-| Onyx Server EVENT REPLAY JSON helpers — Elm port of
`src/lib/irc/eventReplayJson.ts`.

Oper-only server NOTICE payloads (`event-replay` header, `event` rows,
`event-replay-end`) fold into an immutable feed. Fail closed throughout:
malformed JSON, unknown types, oversize strings, and out-of-range
timestamps are rejected so hostile server notices never become
structured rows.

Divergence note: the 1024-char notice bound counts UTF-16 code units in
the oracle (`String.length`); Elm `String.length` counts code points, so
the bound here uses an explicit UTF-16 length. Whitespace collapsing
covers ASCII whitespace (code ≤ 0x20); exotic Unicode spaces are left
intact rather than collapsed.
-}

import Json.Decode as Decode


{-| Bounded NOTICE body: history message ≤400 + JSON envelope + origin ≤64. -}
maxNoticeChars : Int
maxNoticeChars =
    1024


maxTokenChars : Int
maxTokenChars =
    64


maxMessageChars : Int
maxMessageChars =
    400


maxEvents : Int
maxEvents =
    200


minTsMs : Float
minTsMs =
    946684800000


maxTsMs : Float
maxTsMs =
    253402300799000


type alias EventReplayEvent =
    { ts : Float
    , category : String
    , categoryCode : String
    , severity : String
    , origin : String
    , message : String
    }


type EventReplayNotice
    = StreamStart { count : Int, severityFloor : String }
    | StreamEvent EventReplayEvent
    | StreamEnd { count : Int }


type alias EventReplayFeed =
    { pending : Bool
    , severityFloor : Maybe String
    , expectedCount : Maybe Int
    , events : List EventReplayEvent
    , complete : Bool
    , receivedAt : Maybe Float
    }


emptyEventReplayFeed : EventReplayFeed
emptyEventReplayFeed =
    { pending = False
    , severityFloor = Nothing
    , expectedCount = Nothing
    , events = []
    , complete = False
    , receivedAt = Nothing
    }


{-| UTF-16 code-unit length (matches the oracle's `.length` unit). -}
utf16Length : String -> Int
utf16Length text =
    List.length (String.toList text)


isControl : Char -> Bool
isControl c =
    let
        code =
            Char.toCode c
    in
    code <= 0x1F || code == 0x7F


isAsciiWs : Char -> Bool
isAsciiWs c =
    Char.toCode c <= 0x20


cleanToken : Int -> String -> Maybe String
cleanToken max raw =
    let
        cleaned =
            String.left max
                (String.trim
                    (String.fromList (List.filter (\c -> not (isControl c)) (String.toList raw)))
                )
    in
    if String.isEmpty cleaned then
        Nothing

    else
        Just cleaned


cleanMessage : String -> Maybe String
cleanMessage raw =
    if String.isEmpty raw then
        Just ""

    else
        let
            cleaned =
                String.left maxMessageChars
                    (String.trim (collapseWs (String.map controlToSpace raw)))
        in
        if String.isEmpty cleaned then
            Nothing

        else
            Just cleaned


controlToSpace : Char -> Char
controlToSpace c =
    if isControl c then
        ' '

    else
        c


collapseWs : String -> String
collapseWs text =
    text
        |> String.toList
        |> collapseGo False
        |> String.fromList


collapseGo : Bool -> List Char -> List Char
collapseGo prevWs chars =
    case chars of
        [] ->
            []

        c :: rest ->
            if isAsciiWs c then
                if prevWs then
                    collapseGo True rest

                else
                    ' ' :: collapseGo True rest

            else
                c :: collapseGo False rest


finiteCount : Decode.Decoder Int
finiteCount =
    Decode.float
        |> Decode.andThen
            (\f ->
                if isNaN f || isInfinite f || f < 0 || f > toFloat maxEvents then
                    Decode.fail "count out of range"

                else
                    Decode.succeed (truncate f)
            )


finiteTs : Decode.Decoder Float
finiteTs =
    Decode.float
        |> Decode.andThen
            (\f ->
                if isNaN f || isInfinite f || f < minTsMs || f > maxTsMs then
                    Decode.fail "timestamp out of range"

                else
                    -- `floor` (Math.floor, full double precision), never
                    -- `truncate` (`| 0` wraps 13-digit ms to 32 bits).
                    Decode.succeed (toFloat (floor f))
            )


type alias RawEvent =
    { ts : Float
    , category : String
    , categoryCode : Maybe String
    , severity : String
    , origin : String
    , message : String
    }


rawEventDecoder : Decode.Decoder RawEvent
rawEventDecoder =
    Decode.map6 RawEvent
        (Decode.field "ts" finiteTs)
        (Decode.field "category" Decode.string)
        (Decode.maybe (Decode.field "category_code" Decode.string))
        (Decode.field "severity" Decode.string)
        (Decode.field "origin" Decode.string)
        (Decode.field "message" Decode.string)


toEvent : RawEvent -> Maybe EventReplayEvent
toEvent raw =
    Maybe.map5
        (\category maybeCode severity origin message ->
            let
                categoryCode =
                    Maybe.withDefault (String.toUpper category) maybeCode
            in
            if String.isEmpty categoryCode then
                Nothing

            else
                Just
                    { ts = raw.ts
                    , category = category
                    , categoryCode = categoryCode
                    , severity = severity
                    , origin = origin
                    , message = message
                    }
        )
        (cleanToken 32 raw.category)
        (Just (Maybe.andThen (cleanToken 32) raw.categoryCode))
        (cleanToken 24 raw.severity)
        (cleanToken maxTokenChars raw.origin)
        (cleanMessage raw.message)
        |> Maybe.andThen identity


{-| Parse one server NOTICE trailing parameter as an EVENT REPLAY JSON
object. `Nothing` when the body is not a structured replay payload.
-}
parseEventReplayNotice : String -> Maybe EventReplayNotice
parseEventReplayNotice text =
    let
        raw =
            String.trim text
    in
    if not (String.startsWith "{" raw) || utf16Length raw > maxNoticeChars then
        Nothing

    else
        case Decode.decodeString (Decode.field "type" Decode.string) raw of
            Err _ ->
                Nothing

            Ok "event-replay" ->
                case Decode.decodeString (startDecoder "severity_floor" 24) raw of
                    Ok notice ->
                        Just notice

                    Err _ ->
                        Nothing

            Ok "event-replay-end" ->
                case Decode.decodeString (Decode.map StreamEnd (Decode.map (\c -> { count = c }) (Decode.field "count" finiteCount))) raw of
                    Ok notice ->
                        Just notice

                    Err _ ->
                        Nothing

            Ok "event" ->
                case Decode.decodeString rawEventDecoder raw of
                    Err _ ->
                        Nothing

                    Ok rawEvent ->
                        Maybe.map StreamEvent (toEvent rawEvent)

            Ok _ ->
                Nothing


startDecoder : String -> Int -> Decode.Decoder EventReplayNotice
startDecoder floorField floorMax =
    Decode.map2 (\count floor -> StreamStart { count = count, severityFloor = floor })
        (Decode.field "count" finiteCount)
        (Decode.field floorField Decode.string
            |> Decode.andThen
                (\s ->
                    case cleanToken floorMax s of
                        Just cleaned ->
                            Decode.succeed cleaned

                        Nothing ->
                            Decode.fail "bad severity floor"
                )
        )


{-| Apply a parsed notice to an immutable feed. Unrelated notices return
an equal feed (structural no-op).
-}
applyEventReplayNotice : EventReplayFeed -> String -> Float -> EventReplayFeed
applyEventReplayNotice feed text nowMs =
    case parseEventReplayNotice text of
        Nothing ->
            feed

        Just (StreamStart { count, severityFloor }) ->
            { pending = True
            , severityFloor = Just severityFloor
            , expectedCount = Just count
            , events = []
            , complete = False
            , receivedAt = Just nowMs
            }

        Just (StreamEvent event) ->
            if feed.pending then
                if List.length feed.events >= maxEvents then
                    feed

                else
                    { feed | events = feed.events ++ [ event ] }

            else if feed.complete then
                feed

            else
                { feed
                    | pending = True
                    , events = [ event ]
                    , receivedAt =
                        case feed.receivedAt of
                            Just at ->
                                Just at

                            Nothing ->
                                Just nowMs
                }

        Just (StreamEnd { count }) ->
            { feed
                | pending = False
                , complete = True
                , expectedCount = Just count
                , receivedAt =
                    case feed.receivedAt of
                        Just at ->
                            Just at

                        Nothing ->
                            Just nowMs
            }


{-| Params after `EVENT` for a bounded JSON replay (ALL categories). -}
eventReplayJsonParams : Int -> List String
eventReplayJsonParams limit =
    [ "REPLAY", "JSON", "ALL", String.fromInt (clamp 1 maxEvents limit) ]


{-| Compact one-line label for a structured event row. -}
formatEventReplayEvent : EventReplayEvent -> Float -> String
formatEventReplayEvent event nowMs =
    "[" ++ relativeAgeLabel event.ts nowMs ++ "] " ++ event.categoryCode ++ "/" ++ event.severity ++ " <" ++ event.origin ++ "> " ++ (if String.isEmpty event.message then "(empty)" else event.message)


relativeAgeLabel : Float -> Float -> String
relativeAgeLabel ts nowMs =
    let
        minutes =
            floor (max 0 (nowMs - ts) / 60000)
    in
    if minutes < 1 then
        "now"

    else if minutes < 60 then
        String.fromInt minutes ++ "m ago"

    else
        let
            hours =
                minutes // 60
        in
        if hours < 48 then
            String.fromInt hours ++ "h ago"

        else
            String.fromInt (hours // 24) ++ "d ago"
