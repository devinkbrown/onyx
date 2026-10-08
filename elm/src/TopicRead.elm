module TopicRead exposing
    ( TopicReadMarker
    , TopicReadMessage
    , TopicReadProjection
    , clearChannelTopicReads
    , countUnreadByTopic
    , encodeTopicReadMarker
    , encodeTopicReadMarkers
    , markAllTopicsRead
    , markTopicRead
    , markerDecoder
    , maxChannelLength
    , maxDateMilliseconds
    , maxMessageIdLength
    , maxTopicLabelBytes
    , maxTopicReadEntries
    , maxTopicReadMessages
    , maxTopicReadParseEntries
    , mergeTopicReadLedger
    , normalizeChannel
    , normalizeMessageId
    , normalizeTime
    , normalizeTopicLabel
    , parseTopicReadLedger
    , projectRoomTopicUnread
    , readTopicReadMarker
    , sanitizeMarkers
    )

{-| Device-local read cursors for named topic conversations (pure core
mirroring `src/lib/topics/topicReadLedger.ts`: normalized channel/topic
pairs plus the last-read message id and timestamp — message bodies,
authors, previews, and account data never enter the stored shape).

Conventions (read before wiring this into `App`):

  - Messages arrive **oldest-first**, like the oracle arrays. Order is
    authoritative for equal timestamps (exact-marker disambiguation and
    latest-wins scans). This is the reverse of `Topic.projectTopicUnread`,
    whose buffers arrive newest-first; do not mix the two without reversing.
  - Caller classification (`isSystemMessage` / `isExcludedMessage` /
    `isHighlightMessage`) rides the row `system` / `highlight` flags instead
    of function parameters, so every fold stays total. Elm functions cannot
    throw, so the oracle try/catch fail-closed arms have no counterpart here;
    callers classify rows before folding.
  - Storage, cross-tab publish, and owner scoping live behind ports (a later
    slice owns the `onyx:topic-read-ledger` bridge). Every function here is
    pure over an explicit marker list; persistence-shaped results thread the
    ledger through the return value instead of writing it.

Narrowings vs the oracle: `String.length` counts Unicode scalar values where
JavaScript counts UTF-16 code units (the 128/512 caps agree on ASCII);
`String.trim`/`toLower` follow Elm's tables rather than JavaScript's for
exotic whitespace/casing; `compare` orders strings by scalar value rather
than UTF-16 order (ASCII-identical); epoch-ms rides Elm `Int` (doubles, exact
to 2^53) with `floor`, never `truncate`.

-}

import Dict exposing (Dict)
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode


{-| One device-local read cursor. -}
type alias TopicReadMarker =
    { channel : String
    , topic : String
    , lastReadMessageId : String
    , lastReadAt : Int
    }


{-| One structural message row. `system` carries the caller's exclusion
classification, `highlight` the caller's mention/keyword classification. -}
type alias TopicReadMessage =
    { id : String
    , topic : Maybe String
    , at : Int
    , system : Bool
    , highlight : Bool
    }


{-| Aggregate unread state after applying room and device-topic boundaries
(`earliestUnreadMessageId` is `Nothing` instead of the oracle `null`). -}
type alias TopicReadProjection =
    { unreadByTopic : Dict String Int
    , untaggedUnread : Int
    , totalUnread : Int
    , highlightCount : Int
    , earliestUnreadMessageId : Maybe String
    }


{-| Newest markers retained per device (`MAX_TOPIC_READ_ENTRIES`). -}
maxTopicReadEntries : Int
maxTopicReadEntries =
    256


{-| Newest message suffix inspected (`MAX_TOPIC_READ_MESSAGES`). -}
maxTopicReadMessages : Int
maxTopicReadMessages =
    4096


{-| Untrusted rows inspected before dedupe/sort
(`MAX_TOPIC_READ_PARSE_ENTRIES`). -}
maxTopicReadParseEntries : Int
maxTopicReadParseEntries =
    4096


{-| Channel cap (`String.length`, see the narrowing note above). -}
maxChannelLength : Int
maxChannelLength =
    128


{-| Message-id cap (`String.length`, see the narrowing note above). -}
maxMessageIdLength : Int
maxMessageIdLength =
    512


{-| Largest storable epoch-ms (`MAX_DATE_MILLISECONDS`). -}
maxDateMilliseconds : Int
maxDateMilliseconds =
    8640000000000000


{-| Max label bytes (`MAX_TOPIC_LABEL_BYTES`, mirroring `App.utf8ByteLength`
so this module stays import-light for tests). -}
maxTopicLabelBytes : Int
maxTopicLabelBytes =
    50


{-| UTF-8 byte length (mirroring `App.utf8ByteLength`: ASCII 1 byte, astral
codepoints 4). -}
utf8ByteLength : String -> Int
utf8ByteLength value =
    List.foldl
        (\c acc ->
            let
                code =
                    Char.toCode c
            in
            acc
                + (if code < 0x80 then
                    1

                   else if code < 0x800 then
                    2

                   else if code < 0x10000 then
                    3

                   else
                    4
                  )
        )
        0
        (String.toList value)


{-| Label validity (mirroring `App.isValidTopicLabel`): nonempty, no comma,
no C0/DEL controls, 1..50 UTF-8 bytes. -}
isValidTopicLabel : String -> Bool
isValidTopicLabel label =
    if String.isEmpty label || String.contains "," label then
        False

    else if List.any (\c -> Char.toCode c < 0x20 || Char.toCode c == 0x7F) (String.toList label) then
        False

    else
        let
            bytes =
                utf8ByteLength label
        in
        bytes >= 1 && bytes <= maxTopicLabelBytes


{-| JavaScript `\s` multibyte members beyond what `Char.toCode <= 0x20`
covers (`\t\n\v\f\r ` and C0 arrive through the range check). -}
isNonAsciiSpace : Char -> Bool
isNonAsciiSpace c =
    case Char.toCode c of
        0xA0 ->
            True

        0x1680 ->
            True

        0x2028 ->
            True

        0x2029 ->
            True

        0x202F ->
            True

        0x205F ->
            True

        0x3000 ->
            True

        0xFEFF ->
            True

        code ->
            code >= 0x2000 && code <= 0x200A


isChannelBadChar : Char -> Bool
isChannelBadChar c =
    Char.toCode c <= 0x20 || Char.toCode c == 0x7F || c == ',' || isNonAsciiSpace c


{-| Normalized channel (`trim` + lowercase, `#`/`&` prefix, length and
charset bounds) or `Nothing`. -}
normalizeChannel : String -> Maybe String
normalizeChannel value =
    let
        channel =
            String.toLower (String.trim value)
    in
    case String.uncons channel of
        Nothing ->
            Nothing

        Just ( head, _ ) ->
            if head /= '#' && head /= '&' then
                Nothing

            else if String.length channel > maxChannelLength then
                Nothing

            else if String.any isChannelBadChar channel then
                Nothing

            else
                Just channel


{-| Normalized topic label (`trim` + lowercase + label validity) or
`Nothing`. -}
normalizeTopicLabel : String -> Maybe String
normalizeTopicLabel value =
    let
        topic =
            String.toLower (String.trim value)
    in
    if isValidTopicLabel topic then
        Just topic

    else
        Nothing


{-| Validated message id (nonempty, already trimmed, length bound, no
controls) or `Nothing`. -}
normalizeMessageId : String -> Maybe String
normalizeMessageId value =
    if String.isEmpty value then
        Nothing

    else if String.length value > maxMessageIdLength then
        Nothing

    else if value /= String.trim value then
        Nothing

    else if String.any (\c -> Char.toCode c < 0x20 || Char.toCode c == 0x7F) value then
        Nothing

    else
        Just value


{-| Validated epoch-ms (integer, 0..`maxDateMilliseconds`) or `Nothing`.
Takes the JSON `Float` and floors it (never `truncate`, which wraps
13-digit ms to 32 bits — see `EventReplay.finiteTs`). -}
normalizeTime : Float -> Maybe Int
normalizeTime value =
    if isNaN value || isInfinite value then
        Nothing

    else if value < 0 || value > toFloat maxDateMilliseconds then
        Nothing

    else if value /= toFloat (floor value) then
        Nothing

    else
        Just (floor value)


markerKey : TopicReadMarker -> ( String, String )
markerKey marker =
    ( marker.channel, marker.topic )


{-| Newest-first ordering (timestamp descending, then channel, topic, and
message id ascending — mirroring `compareNewest`). -}
compareNewest : TopicReadMarker -> TopicReadMarker -> Order
compareNewest left right =
    if left.lastReadAt /= right.lastReadAt then
        compare right.lastReadAt left.lastReadAt

    else if left.channel /= right.channel then
        compare left.channel right.channel

    else if left.topic /= right.topic then
        compare left.topic right.topic

    else
        compare left.lastReadMessageId right.lastReadMessageId


{-| Decode one marker row, failing closed on any invalid field (extra
payload fields never enter the stored shape). -}
markerDecoder : Decoder TopicReadMarker
markerDecoder =
    Decode.map4 buildMarker
        (Decode.field "channel" Decode.string)
        (Decode.field "topic" Decode.string)
        (Decode.field "lastReadMessageId" Decode.string)
        (Decode.field "lastReadAt" Decode.float)
        |> Decode.andThen
            (\maybe ->
                case maybe of
                    Just marker ->
                        Decode.succeed marker

                    Nothing ->
                        Decode.fail "invalid topic-read marker"
            )


buildMarker : String -> String -> String -> Float -> Maybe TopicReadMarker
buildMarker rawChannel rawTopic rawId rawAt =
    Maybe.map4 TopicReadMarker
        (normalizeChannel rawChannel)
        (normalizeTopicLabel rawTopic)
        (normalizeMessageId rawId)
        (normalizeTime rawAt)


{-| Dedupe by channel/topic (newest wins, later input wins ties), sort
newest-first, and apply the parse-scan and entry caps. Idempotent, so merge
and mark cores reuse it defensively. -}
sanitizeMarkers : List TopicReadMarker -> List TopicReadMarker
sanitizeMarkers markers =
    List.take maxTopicReadParseEntries markers
        |> List.foldl insertNewest Dict.empty
        |> Dict.values
        |> List.sortWith compareNewest
        |> List.take maxTopicReadEntries


insertNewest : TopicReadMarker -> Dict ( String, String ) TopicReadMarker -> Dict ( String, String ) TopicReadMarker
insertNewest marker acc =
    case Dict.get (markerKey marker) acc of
        Nothing ->
            Dict.insert (markerKey marker) marker acc

        Just existing ->
            if compareNewest marker existing == LT then
                Dict.insert (markerKey marker) marker acc

            else
                acc


{-| Encode one marker for the ports bridge (metadata fields only — the
bridge shape-checks and the Elm loader re-validates). -}
encodeTopicReadMarker : TopicReadMarker -> Encode.Value
encodeTopicReadMarker marker =
    Encode.object
        [ ( "channel", Encode.string marker.channel )
        , ( "topic", Encode.string marker.topic )
        , ( "lastReadMessageId", Encode.string marker.lastReadMessageId )
        , ( "lastReadAt", Encode.int marker.lastReadAt )
        ]


{-| Encode a ledger for the ports bridge. -}
encodeTopicReadMarkers : List TopicReadMarker -> Encode.Value
encodeTopicReadMarkers markers =
    Encode.list encodeTopicReadMarker markers


{-| Sanitize an untrusted persisted/portable ledger value into the canonical
bounded metadata-only shape. Non-list JSON parses to `[]`; invalid rows drop
individually. -}
parseTopicReadLedger : Decode.Value -> List TopicReadMarker
parseTopicReadLedger value =
    case Decode.decodeValue (Decode.list Decode.value) value of
        Err _ ->
            []

        Ok raws ->
            raws
                |> List.take maxTopicReadParseEntries
                |> List.filterMap (\raw -> Result.toMaybe (Decode.decodeValue markerDecoder raw))
                |> sanitizeMarkers


{-| Case-insensitive lookup for one channel/topic marker. -}
readTopicReadMarker : String -> String -> List TopicReadMarker -> Maybe TopicReadMarker
readTopicReadMarker channel topic ledger =
    case ( normalizeChannel channel, normalizeTopicLabel topic ) of
        ( Just wantedChannel, Just wantedTopic ) ->
            List.head (List.filter (\m -> m.channel == wantedChannel && m.topic == wantedTopic) ledger)

        _ ->
            Nothing


{-| Advance one topic cursor. Older timestamps never regress it; at an equal
timestamp the caller's explicit message id wins. Invalid input leaves the
ledger unchanged. -}
markTopicRead : String -> String -> String -> Int -> List TopicReadMarker -> List TopicReadMarker
markTopicRead channel topic messageId atMs ledger =
    case
        Maybe.map4 TopicReadMarker
            (normalizeChannel channel)
            (normalizeTopicLabel topic)
            (normalizeMessageId messageId)
            (normalizeTime (toFloat atMs))
    of
        Nothing ->
            ledger

        Just candidate ->
            let
                key =
                    ( candidate.channel, candidate.topic )

                rest =
                    List.filter (\m -> markerKey m /= key) ledger
            in
            case readTopicReadMarker channel topic ledger of
                Just current ->
                    if current.lastReadAt > candidate.lastReadAt then
                        ledger

                    else if current.lastReadAt == candidate.lastReadAt && current.lastReadMessageId == candidate.lastReadMessageId then
                        ledger

                    else
                        sanitizeMarkers (candidate :: rest)

                Nothing ->
                    sanitizeMarkers (candidate :: rest)


{-| Advance every named topic to its latest non-system message in the bounded
suffix. Array order is authoritative for equal timestamps. -}
markAllTopicsRead : String -> List TopicReadMessage -> List TopicReadMarker -> List TopicReadMarker
markAllTopicsRead channel messages ledger =
    case normalizeChannel channel of
        Nothing ->
            ledger

        Just wantedChannel ->
            let
                suffix =
                    boundedSuffix messages

                insertLatest ( _, msg ) acc =
                    if msg.system then
                        acc

                    else
                        case validTopicMessage msg of
                            Nothing ->
                                acc

                            Just ( topic, msgId, atMs ) ->
                                Dict.insert topic { channel = wantedChannel, topic = topic, lastReadMessageId = msgId, lastReadAt = atMs } acc

                latest =
                    List.foldl insertLatest Dict.empty suffix
            in
            if Dict.isEmpty latest then
                ledger

            else
                let
                    base =
                        List.foldl (\m acc -> Dict.insert (markerKey m) m acc) Dict.empty ledger

                    merged =
                        List.foldl
                            (\candidate acc ->
                                case Dict.get (markerKey candidate) acc of
                                    Just existing ->
                                        if existing.lastReadAt <= candidate.lastReadAt then
                                            Dict.insert (markerKey candidate) candidate acc

                                        else
                                            acc

                                    Nothing ->
                                        Dict.insert (markerKey candidate) candidate acc
                            )
                            base
                            (Dict.values latest)
                in
                sanitizeMarkers (Dict.values merged)


{-| Merge parsed portable markers into a ledger. A strictly newer timestamp
advances an existing cursor; equal timestamps keep the destination id.
`imported` counts merged candidates exactly present in the committed ledger
(zero when there is nothing to merge). -}
mergeTopicReadLedger : List TopicReadMarker -> List TopicReadMarker -> { imported : Int, total : Int, ledger : List TopicReadMarker }
mergeTopicReadLedger imported ledger =
    let
        candidates =
            sanitizeMarkers imported
    in
    if List.isEmpty candidates then
        { imported = 0, total = List.length ledger, ledger = ledger }

    else
        let
            base =
                List.foldl (\m acc -> Dict.insert (markerKey m) m acc) Dict.empty ledger

            merged =
                List.foldl
                    (\candidate acc ->
                        case Dict.get (markerKey candidate) acc of
                            Just existing ->
                                if candidate.lastReadAt > existing.lastReadAt then
                                    Dict.insert (markerKey candidate) candidate acc

                                else
                                    acc

                            Nothing ->
                                Dict.insert (markerKey candidate) candidate acc
                    )
                    base
                    candidates

            committed =
                sanitizeMarkers (Dict.values merged)

            retained =
                List.filter (\m -> List.member m committed) candidates
        in
        { imported = List.length retained, total = List.length committed, ledger = committed }


{-| Remove all markers for one channel. Invalid channels remove nothing. -}
clearChannelTopicReads : String -> List TopicReadMarker -> { removed : Int, ledger : List TopicReadMarker }
clearChannelTopicReads channel ledger =
    case normalizeChannel channel of
        Nothing ->
            { removed = 0, ledger = ledger }

        Just wantedChannel ->
            let
                next =
                    List.filter (\m -> m.channel /= wantedChannel) ledger
            in
            { removed = List.length ledger - List.length next, ledger = next }


{-| Newest bounded message suffix with absolute array indices (mirroring the
oracle `windowStart` + per-row `index`). -}
boundedSuffix : List a -> List ( Int, a )
boundedSuffix messages =
    let
        length =
            List.length messages

        start =
            max 0 (length - maxTopicReadMessages)
    in
    List.indexedMap (\offset msg -> ( start + offset, msg )) (List.drop start messages)


{-| Valid named-topic row: id, normalized topic, and timestamp all check out. -}
validTopicMessage : TopicReadMessage -> Maybe ( String, String, Int )
validTopicMessage msg =
    case msg.topic of
        Nothing ->
            Nothing

        Just label ->
            Maybe.map3 (\topic msgId atMs -> ( topic, msgId, atMs ))
                (normalizeTopicLabel label)
                (normalizeMessageId msg.id)
                (normalizeTime (toFloat msg.at))


{-| Valid room row: untagged (`Nothing`) rows pass with a `Nothing` topic;
invalid labels reject the row. -}
validRoomMessage : TopicReadMessage -> Maybe ( String, Maybe String, Int )
validRoomMessage msg =
    case ( normalizeMessageId msg.id, normalizeTime (toFloat msg.at) ) of
        ( Just msgId, Just atMs ) ->
            case msg.topic of
                Nothing ->
                    Just ( msgId, Nothing, atMs )

                Just label ->
                    case normalizeTopicLabel label of
                        Just topic ->
                            Just ( msgId, Just topic, atMs )

                        Nothing ->
                            Nothing

        _ ->
            Nothing


{-| Validated counting row (absolute array index plus normalized fields). -}
type alias CountRow =
    { index : Int
    , message : TopicReadMessage
    , id : String
    , topic : String
    , at : Int
    }


{-| Validated room row (untagged rows carry `topic = Nothing`). -}
type alias RoomRow =
    { index : Int
    , message : TopicReadMessage
    , id : String
    , topic : Maybe String
    , at : Int
    }


markersFor : String -> List TopicReadMarker -> Dict String TopicReadMarker
markersFor channel ledger =
    List.foldl
        (\m acc ->
            if m.channel == channel then
                Dict.insert m.topic m acc

            else
                acc
        )
        Dict.empty
        ledger


{-| Per-topic unread counts over structural message metadata (mirroring
`countUnreadByTopic`).

Exact marker ids use array order, so interleaved topics and equal timestamps
stay correct. When an exact marker has left the bounded window, rows at the
same timestamp stay unread: only strictly older rows are proven read. Topics
without a marker use the caller boundary; out-of-range boundaries fail closed
to the end of the list.

-}
countUnreadByTopic : String -> List TopicReadMessage -> List TopicReadMarker -> Int -> Dict String Int
countUnreadByTopic channel messages markers fallbackBoundaryIndex =
    case normalizeChannel channel of
        Nothing ->
            Dict.empty

        Just wantedChannel ->
            let
                rows =
                    boundedSuffix messages
                        |> List.filterMap
                            (\( index, msg ) ->
                                case validTopicMessage msg of
                                    Just ( topic, msgId, atMs ) ->
                                        Just { index = index, message = msg, id = msgId, topic = topic, at = atMs }

                                    Nothing ->
                                        Nothing
                            )

                length =
                    List.length messages

                fallback =
                    if fallbackBoundaryIndex < 0 || fallbackBoundaryIndex > length then
                        length

                    else
                        fallbackBoundaryIndex

                channelMarkers =
                    markersFor wantedChannel markers

                exact =
                    exactBoundaryIndexes rows channelMarkers

                countRow row acc =
                    if row.message.system then
                        acc

                    else
                        let
                            unread =
                                case Dict.get row.topic channelMarkers of
                                    Nothing ->
                                        row.index >= fallback

                                    Just marker ->
                                        case Dict.get row.topic exact of
                                            Just boundary ->
                                                row.index > boundary

                                            Nothing ->
                                                row.at >= marker.lastReadAt
                        in
                        if unread then
                            Dict.update row.topic
                                (\current -> Just (Maybe.withDefault 0 current + 1))
                                acc

                        else
                            acc
            in
            List.foldl countRow Dict.empty rows


exactBoundaryIndexes : List CountRow -> Dict String TopicReadMarker -> Dict String Int
exactBoundaryIndexes rows channelMarkers =
    List.foldl
        (\row acc ->
            if Dict.member row.topic acc then
                acc

            else
                case Dict.get row.topic channelMarkers of
                    Just marker ->
                        if marker.lastReadMessageId == row.id && marker.lastReadAt == row.at then
                            Dict.insert row.topic row.index acc

                        else
                            acc

                    Nothing ->
                        acc
        )
        Dict.empty
        rows


{-| Pure room unread projection after applying device-local topic markers
(mirroring `projectRoomTopicUnread`).

Named topics use an exact marker id when it remains in the bounded window.
When that id has left the window, only rows strictly older than its timestamp
are proven read. The room boundary is a universal lower bound: a topic marker
may advance beyond it but can never make an older room-read row unread again.
Untagged rows and topics without a marker use that room boundary directly.

-}
projectRoomTopicUnread : String -> List TopicReadMessage -> List TopicReadMarker -> Int -> TopicReadProjection
projectRoomTopicUnread channel messages markers fallbackBoundaryIndex =
    let
        empty =
            { unreadByTopic = Dict.empty
            , untaggedUnread = 0
            , totalUnread = 0
            , highlightCount = 0
            , earliestUnreadMessageId = Nothing
            }
    in
    case normalizeChannel channel of
        Nothing ->
            empty

        Just wantedChannel ->
            let
                rows =
                    boundedSuffix messages
                        |> List.filterMap
                            (\( index, msg ) ->
                                case validRoomMessage msg of
                                    Just ( msgId, topic, atMs ) ->
                                        Just { index = index, message = msg, id = msgId, topic = topic, at = atMs }

                                    Nothing ->
                                        Nothing
                            )

                length =
                    List.length messages

                fallback =
                    if fallbackBoundaryIndex < 0 || fallbackBoundaryIndex > length then
                        length

                    else
                        fallbackBoundaryIndex

                channelMarkers =
                    markersFor wantedChannel markers

                exact =
                    exactRoomBoundaryIndexes rows channelMarkers

                foldRow row acc =
                    if row.message.system then
                        acc

                    else if row.index < fallback then
                        acc

                    else
                        let
                            unread =
                                case row.topic of
                                    Nothing ->
                                        True

                                    Just topic ->
                                        case Dict.get topic channelMarkers of
                                            Nothing ->
                                                True

                                            Just marker ->
                                                case Dict.get topic exact of
                                                    Just boundary ->
                                                        row.index > boundary

                                                    Nothing ->
                                                        row.at >= marker.lastReadAt
                        in
                        if not unread then
                            acc

                        else
                            { acc
                                | totalUnread = acc.totalUnread + 1
                                , highlightCount =
                                    if row.message.highlight then
                                        acc.highlightCount + 1

                                    else
                                        acc.highlightCount
                                , earliestUnreadMessageId =
                                    case acc.earliestUnreadMessageId of
                                        Just _ ->
                                            acc.earliestUnreadMessageId

                                        Nothing ->
                                            Just row.id
                                , unreadByTopic =
                                    case row.topic of
                                        Just topic ->
                                            Dict.update topic
                                                (\current -> Just (Maybe.withDefault 0 current + 1))
                                                acc.unreadByTopic

                                        Nothing ->
                                            acc.unreadByTopic
                                , untaggedUnread =
                                    case row.topic of
                                        Just _ ->
                                            acc.untaggedUnread

                                        Nothing ->
                                            acc.untaggedUnread + 1
                            }
            in
            List.foldl foldRow empty rows


exactRoomBoundaryIndexes : List RoomRow -> Dict String TopicReadMarker -> Dict String Int
exactRoomBoundaryIndexes rows channelMarkers =
    List.foldl
        (\row acc ->
            case row.topic of
                Nothing ->
                    acc

                Just topic ->
                    if Dict.member topic acc then
                        acc

                    else
                        case Dict.get topic channelMarkers of
                            Just marker ->
                                if marker.lastReadMessageId == row.id && marker.lastReadAt == row.at then
                                    Dict.insert topic row.index acc

                                else
                                    acc

                            Nothing ->
                                acc
        )
        Dict.empty
        rows
