module Stats exposing
    ( BackupFile
    , BackupManifest
    , ChannelDetail
    , ChannelDetailTotals
    , ChannelPulse
    , decodeBackupManifest
    , FeedState(..)
    , NetworkDay
    , RoomScope(..)
    , RoomSort(..)
    , StatsChannel
    , StatsIndex
    , StatsWindow
    , TimelineStep
    , WindowState(..)
    , activityLabel
    , activityWindowStateFor
    , activityWindowStatus
    , averageWords
    , barHeight
    , busiestChannel
    , channelDetailUrl
    , channelToSlug
    , compareHeadline
    , decodeChannelDetail
    , decodeChannelPulse
    , decodeStatsIndex
    , feedLedgerPhrase
    , feedNote
    , feedStateAt
    , feedStateKey
    , feedStateLabel
    , feedTimelineNote
    , formatCount
    , formatHour
    , formatPulse
    , inspectorId
    , isActiveRecently
    , maxCompareRooms
    , netMembershipFlow
    , networkShare
    , parseStatsCompareQuery
    , parseStatsRoomQuery
    , parseStatsWindowQuery
    , peakHourShare
    , presencePhrase
    , relTime
    , roomDeepLink
    , roomPulse
    , roomShareOfNetwork
    , safeCount
    , selectionCopy
    , sortLabels
    , statsCompareQuery
    , statsFeedTimeline
    , stepState
    , toFixed1
    , statsIndexUrl
    , statsRoomHref
    , utcDateLabel
    , visibleChannels
    , weekdayLabels
    , windowDaysFor
    )

{-| Pure core of the public Stats surface (1:1 with
`src/routes/Stats.tsx`, `src/routes/PublicRoomComparison.tsx`, and
`src/lib/stats/{networkIndex,channelStats,channelDetail,feedBounds}.ts`).

Aggregate-only room telemetry: the page reports room rhythm, never
message text, participant rankings, or word-frequency profiles.

Documented narrowings (Elm has no locale-aware runtime here):

  - Case-insensitive room matching uses Unicode `String.toLower`
    instead of `toLocaleLowerCase('en')`.
  - `relTime` computes the yesterday/tomorrow boundary in UTC rather
    than the viewer's local calendar day.
  - `utcDateLabel` renders `firstSeen` as a UTC `M/D/YYYY` date instead
    of `Date.toLocaleDateString()`.
  - 32-bit `Int` counters clamp to `2147483647` (same as `Status`);
    unix-second stamps stay `Float`.
  - `Url.percentEncode` output is used for slug URLs and `room=` hrefs;
    slugs themselves are `[a-z0-9._-]` so both encoders agree there.

-}

import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import SavedSearches
import Time
import Url


{-| Stable id for the room inspector region — linked from every
Inspect control.
-}
inspectorId : String
inspectorId =
    "stats-room-inspector"


{-| Same-origin stats index URL, emitted by the chanstats engine.
-}
statsIndexUrl : String
statsIndexUrl =
    "/stats/data/index.json"


maxStatsChannels : Int
maxStatsChannels =
    512


maxStatsDays : Int
maxStatsDays =
    366


maxStatsSparkPoints : Int
maxStatsSparkPoints =
    64


maxStatsChannelLength : Int
maxStatsChannelLength =
    128


maxStatsTopicLength : Int
maxStatsTopicLength =
    512


maxStatsMetaLength : Int
maxStatsMetaLength =
    256


{-| At most two rooms side by side in the comparison plane.
-}
maxCompareRooms : Int
maxCompareRooms =
    2


maxRoomNameLength : Int
maxRoomNameLength =
    128


maxDetailDays : Int
maxDetailDays =
    60


maxDetailText : Int
maxDetailText =
    128


maxBackupFiles : Int
maxBackupFiles =
    128


maxBackupKindLength : Int
maxBackupKindLength =
    64


maxBackupNameLength : Int
maxBackupNameLength =
    256


maxBackupSourceLength : Int
maxBackupSourceLength =
    512


type alias BackupFile =
    { kind : String
    , name : String
    , source : String
    }


type alias BackupManifest =
    { generatedAt : Float
    , files : List BackupFile
    }


{-| `JS Date` range guard: past `±8.64e15` ms `toISOString()` throws, so
an out-of-range `last_active` degrades a deep link to a plain join.
-}
maxTimeMs : Float
maxTimeMs =
    8.64e15


{-| Fresh window for a feed sample (2 minutes, mirroring
`PUBLIC_FEED_FRESH_MS`).
-}
freshMs : Float
freshMs =
    2 * 60 * 1000


{-| Clock-skew allowance before a feed reads as from the future
(5 minutes, mirroring `PUBLIC_FEED_FUTURE_SKEW_MS`).
-}
futureSkewMs : Float
futureSkewMs =
    5 * 60 * 1000


recentRoomWindowSeconds : Int
recentRoomWindowSeconds =
    24 * 60 * 60


type alias StatsChannel =
    { channel : String
    , messages : Int
    , activeUsers : Int
    , present : Int
    , lastActive : Float
    , topic : String
    , spark : List Float
    }


type alias NetworkDay =
    { date : String
    , messages : Int
    }


type alias StatsIndex =
    { generatedAt : Float
    , network : String
    , node : String
    , usersOnline : Int
    , networkDays : List NetworkDay
    , channels : List StatsChannel
    , networkDaysComplete : Bool
    , channelsComplete : Bool
    }


type alias ChannelPulse =
    { hours : List Int
    , total : Int
    , present : Int
    , lastActive : Float
    }


type alias ChannelDetailTotals =
    { messages : Int
    , words : Int
    , activeUsers : Int
    , joins : Int
    , parts : Int
    , quits : Int
    , kicks : Int
    , topicChanges : Int
    }


type alias ChannelDetailDay =
    { date : String
    , messages : Int
    }


type alias ChannelDetail =
    { channel : String
    , generatedAt : Float
    , firstSeen : Float
    , lastActive : Float
    , present : Int
    , lastSpeaker : String
    , totals : ChannelDetailTotals
    , hours : List Int
    , days : List ChannelDetailDay
    , heatmap : List (List Int)
    , busiestDay : Maybe ChannelDetailDay
    , peakHour : Maybe Int
    , complete : Bool
    }


{-| Feed state for the stats route: freshness plus the partial loading
and unavailable legs.
-}
type FeedState
    = FeedLoading
    | FeedCurrent
    | FeedPartial
    | FeedStale
    | FeedFuture
    | FeedUnknown
    | FeedUnavailable


feedStateKey : FeedState -> String
feedStateKey state =
    case state of
        FeedLoading ->
            "loading"

        FeedCurrent ->
            "current"

        FeedPartial ->
            "partial"

        FeedStale ->
            "stale"

        FeedFuture ->
            "future"

        FeedUnknown ->
            "unknown"

        FeedUnavailable ->
            "unavailable"


type alias TimelineStep =
    { id : String
    , label : String
    , status : String
    , detail : String
    , state : String
    }


type RoomSort
    = SortMessages
    | SortPulse
    | SortPresence
    | SortRecent


type RoomScope
    = ScopeAll
    | ScopePresent
    | ScopeRecent


{-| Shareable network activity window: 7 days or the full 14-day feed.
-}
type alias StatsWindow =
    Int


sortLabels : List ( RoomSort, String )
sortLabels =
    [ ( SortMessages, "Messages" )
    , ( SortPulse, "Pulse" )
    , ( SortPresence, "Presence" )
    , ( SortRecent, "Most recent" )
    ]


weekdayLabels : List String
weekdayLabels =
    [ "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" ]


{-| UTF-8 bytes of a string (mirroring `TextEncoder().encode`): lone
surrogates encode as U+FFFD, exactly like the platform encoder.
-}
utf8Bytes : String -> List Int
utf8Bytes text =
    List.concatMap charUtf8Bytes (String.toList text)


charUtf8Bytes : Char -> List Int
charUtf8Bytes c =
    let
        cp =
            Char.toCode c
    in
    if cp < 0x80 then
        [ cp ]

    else if cp < 0x800 then
        [ 0xC0 + (cp // 64), 0x80 + modBy 64 cp ]

    else if cp < 0xD800 || (cp > 0xDFFF && cp < 0x10000) then
        [ 0xE0 + (cp // 4096), 0x80 + modBy 64 (cp // 64), 0x80 + modBy 64 cp ]

    else if cp < 0x110000 then
        [ 0xF0 + (cp // 262144)
        , 0x80 + modBy 64 (cp // 4096)
        , 0x80 + modBy 64 (cp // 64)
        , 0x80 + modBy 64 cp
        ]

    else
        [ 0xEF, 0xBF, 0xBD ]


{-| Channel → data slug, byte-faithful to the server
(`chanstats.zig slugify`): strip one leading sigil; per-UTF-8-byte
lowercase ASCII, keep `[a-z0-9._-]` else `_`; neutralise a leading
dot; cap 128 bytes.
-}
channelToSlug : String -> String
channelToSlug channel =
    if String.isEmpty channel then
        ""

    else
        let
            bytes =
                utf8Bytes channel
        in
        case bytes of
            [] ->
                ""

            first :: rest ->
                let
                    stripped =
                        if first == 0x23 || first == 0x26 || first == 0x2B || first == 0x21 then
                            rest

                        else
                            bytes

                    capped =
                        List.take 128 stripped

                    mapped =
                        List.map slugByte capped

                    dotted =
                        case mapped of
                            0x2E :: tail ->
                                0x5F :: tail

                            _ ->
                                mapped
                in
                if List.isEmpty dotted then
                    ""

                else
                    String.fromList (List.map Char.fromCode dotted)


slugByte : Int -> Int
slugByte b =
    let
        lowered =
            if b >= 0x41 && b <= 0x5A then
                b + 0x20

            else
                b

        safe =
            (lowered >= 0x61 && lowered <= 0x7A)
                || (lowered >= 0x30 && lowered <= 0x39)
                || lowered == 0x2E
                || lowered == 0x2D
                || lowered == 0x5F
    in
    if safe then
        lowered

    else
        0x5F


int32Max : Int
int32Max =
    2147483647


{-| Bounded non-negative feed number (mirroring `boundedFeedNumber`):
non-finite or negative reads as zero, capped at the given maximum.
-}
boundedNumber : Decode.Value -> Float -> Float
boundedNumber raw max =
    case Decode.decodeValue Decode.float raw of
        Ok n ->
            if isNaN n || isInfinite n || n < 0 then
                0

            else
                min n max

        Err _ ->
            0


{-| Bounded non-negative feed integer, clamped to 32 bits (mirroring
`boundedFeedInteger` plus the `Status` Int narrowing).
-}
boundedInt : Decode.Value -> Int
boundedInt raw =
    floor (boundedNumber raw 1000000000000)
        |> min int32Max
        |> max 0


{-| Bounded unix-seconds stamp, kept as a `Float` so the full
`PUBLIC_FEED_UNIX_SECONDS_MAX` range survives 32-bit `Int`.
-}
boundedUnix : Decode.Value -> Float
boundedUnix raw =
    boundedNumber raw 8640000000000


{-| Bounded feed text (mirroring `boundedFeedText`): strings only,
sliced to the bound.
-}
boundedText : Decode.Value -> Int -> String
boundedText raw maxLength =
    case Decode.decodeValue Decode.string raw of
        Ok s ->
            String.left maxLength s

        Err _ ->
            ""


field : String -> Decode.Value -> Maybe Decode.Value
field name raw =
    Decode.decodeValue (Decode.field name Decode.value) raw
        |> Result.toMaybe


isValidChannel : String -> Bool
isValidChannel value =
    String.length value > 0
        && String.length value <= maxStatsChannelLength
        && (String.startsWith "#" value || String.startsWith "&" value)
        && not (String.any isChannelBadChar value)


isChannelBadChar : Char -> Bool
isChannelBadChar c =
    c == '\u{0000}' || c == '\u{000D}' || c == '\u{000A}' || c == '\u{0009}' || c == ' ' || c == ','


normalizeChannel : Decode.Value -> String
normalizeChannel raw =
    case Decode.decodeValue Decode.string raw of
        Ok channel ->
            if isValidChannel channel then
                channel

            else
                ""

        Err _ ->
            ""


decodeNetworkDay : Decoder (Maybe NetworkDay)
decodeNetworkDay =
    Decode.oneOf
        [ Decode.map2
            (\date messages ->
                if isValidDate date then
                    Just { date = date, messages = boundedInt messages }

                else
                    Nothing
            )
            (Decode.field "date" Decode.value |> Decode.map boundedDateText)
            (Decode.maybe (Decode.field "messages" Decode.value) |> Decode.map (Maybe.withDefault Encode.null))
        , Decode.succeed Nothing
        ]


boundedDateText : Decode.Value -> String
boundedDateText raw =
    case Decode.decodeValue Decode.string raw of
        Ok s ->
            if String.length s <= 32 then
                s

            else
                ""

        Err _ ->
            ""


isValidDate : String -> Bool
isValidDate date =
    String.length date
        == 10
        && isAsciiDigitAt 0 date
        && isAsciiDigitAt 1 date
        && isAsciiDigitAt 2 date
        && isAsciiDigitAt 3 date
        && String.slice 4 5 date == "-"
        && isAsciiDigitAt 5 date
        && isAsciiDigitAt 6 date
        && String.slice 7 8 date == "-"
        && isAsciiDigitAt 8 date
        && isAsciiDigitAt 9 date


isAsciiDigitAt : Int -> String -> Bool
isAsciiDigitAt idx s =
    case String.slice idx (idx + 1) s |> String.toList of
        [ c ] ->
            c >= '0' && c <= '9'

        _ ->
            False


{-| Normalize the `network_days` tail (mirroring
`normalizeNetworkDays`): at most the last 366 rows, valid unique
`YYYY-MM-DD` dates only; anything omitted flips `complete` off.
-}
normalizeNetworkDays : Decode.Value -> { days : List NetworkDay, complete : Bool }
normalizeNetworkDays raw =
    case Decode.decodeValue (Decode.list Decode.value) raw of
        Err _ ->
            { days = [], complete = False }

        Ok entries ->
            let
                capped =
                    List.drop (List.length entries - min maxStatsDays (List.length entries)) entries

                step entry ( days, seen, complete ) =
                    case Decode.decodeValue decodeNetworkDay entry of
                        Ok (Just day) ->
                            if List.member day.date seen then
                                ( days, seen, False )

                            else
                                ( days ++ [ day ], day.date :: seen, complete )

                        _ ->
                            ( days, seen, False )
            in
            case List.foldl step ( [], [], List.length entries <= maxStatsDays ) capped of
                ( days, _, complete ) ->
                    { days = days, complete = complete }


decodeStatsChannel : Decoder (Maybe StatsChannel)
decodeStatsChannel =
    Decode.oneOf
        [ Decode.value
            |> Decode.andThen
                (\entry ->
                    let
                        channel =
                            normalizeChannel (field "channel" entry |> Maybe.withDefault Encode.null)
                    in
                    if String.isEmpty channel then
                        Decode.succeed Nothing

                    else
                        Decode.succeed
                            (Just
                                { channel = channel
                                , messages = boundedInt (field "messages" entry |> Maybe.withDefault Encode.null)
                                , activeUsers = boundedInt (field "active_users" entry |> Maybe.withDefault Encode.null)
                                , present = boundedInt (field "present" entry |> Maybe.withDefault Encode.null)
                                , lastActive = boundedUnix (field "last_active" entry |> Maybe.withDefault Encode.null)
                                , topic = boundedText (field "topic" entry |> Maybe.withDefault Encode.null) maxStatsTopicLength
                                , spark = decodeSpark (field "spark" entry |> Maybe.withDefault Encode.null)
                                }
                            )
                )
        , Decode.succeed Nothing
        ]


decodeSpark : Decode.Value -> List Float
decodeSpark raw =
    case Decode.decodeValue (Decode.list Decode.value) raw of
        Err _ ->
            []

        Ok points ->
            List.map (\p -> boundedNumber p 1000000000000) (List.drop (List.length points - min maxStatsSparkPoints (List.length points)) points)


{-| Decode the stats index body (mirroring `normalizeIndex`): a
non-object or a missing `channels` array reads as absent; invalid,
duplicate, or over-cap rows are omitted and flip the matching
`complete` flag.
-}
decodeStatsIndex : String -> Maybe StatsIndex
decodeStatsIndex body =
    Decode.decodeString statsIndexDecoder body
        |> Result.toMaybe


statsIndexDecoder : Decoder StatsIndex
statsIndexDecoder =
    Decode.value
        |> Decode.andThen
            (\root ->
                case Decode.decodeValue (Decode.field "channels" Decode.value) root of
                    Err _ ->
                        Decode.fail "no channels array"

                    Ok channelsRaw ->
                        case Decode.decodeValue (Decode.list Decode.value) channelsRaw of
                            Err _ ->
                                Decode.fail "channels is not an array"

                            Ok entries ->
                                let
                                    capped =
                                        List.take maxStatsChannels entries

                                    step entry ( kept, seenKeys, chansComplete ) =
                                        case Decode.decodeValue decodeStatsChannel entry of
                                            Ok (Just channel) ->
                                                let
                                                    key =
                                                        String.toLower channel.channel
                                                in
                                                if List.member key seenKeys then
                                                    ( kept, seenKeys, False )

                                                else
                                                    ( kept ++ [ channel ], key :: seenKeys, chansComplete )

                                            _ ->
                                                ( kept, seenKeys, False )

                                    ( keptAll, _, chansAllComplete ) =
                                        List.foldl step ( [], [], List.length entries <= maxStatsChannels ) capped

                                    networkDays =
                                        normalizeNetworkDays (field "network_days" root |> Maybe.withDefault Encode.null)
                                in
                                Decode.succeed
                                    { generatedAt = boundedUnix (field "generated_at" root |> Maybe.withDefault Encode.null)
                                    , network = boundedText (field "network" root |> Maybe.withDefault Encode.null) maxStatsMetaLength
                                    , node = boundedText (field "node" root |> Maybe.withDefault Encode.null) maxStatsMetaLength
                                    , usersOnline = boundedInt (field "users_online" root |> Maybe.withDefault Encode.null)
                                    , networkDays = networkDays.days
                                    , channels = keptAll
                                    , networkDaysComplete = networkDays.complete
                                    , channelsComplete = chansAllComplete
                                    }
            )


{-| Per-channel stats file URL for one room (the slug must match the
server byte-for-byte or the file 404s).
-}
channelDetailUrl : String -> Maybe String
channelDetailUrl channel =
    let
        slug =
            channelToSlug channel
    in
    if String.isEmpty slug then
        Nothing

    else
        Just ("/stats/data/" ++ Url.percentEncode slug ++ ".json")


fixedCounts : Decode.Value -> Int -> { values : List Int, complete : Bool }
fixedCounts raw length =
    case Decode.decodeValue (Decode.list Decode.value) raw of
        Ok entries ->
            if List.length entries == length then
                { values = List.map boundedInt entries, complete = True }

            else
                { values = List.repeat length 0, complete = False }

        Err _ ->
            { values = List.repeat length 0, complete = False }


validDetailDate : Decode.Value -> String
validDetailDate raw =
    case Decode.decodeValue Decode.string raw of
        Ok date ->
            if isValidDate date then
                date

            else
                ""

        Err _ ->
            ""


{-| Decode a room detail body (mirroring `normalizeChannelDetail`):
the room-level rhythm only — per-user and word-frequency tables are
deliberately never ingested. `expectedChannel` gates the document to
one room (case-insensitive); a mismatch reads as absent.
-}
decodeChannelDetail : String -> String -> Maybe ChannelDetail
decodeChannelDetail body expectedChannel =
    Decode.decodeString (channelDetailDecoder expectedChannel) body
        |> Result.toMaybe


channelDetailDecoder : String -> Decoder ChannelDetail
channelDetailDecoder expectedChannel =
    Decode.value
        |> Decode.andThen
            (\root ->
                case Decode.decodeValue detailRecordDecoder root of
                    Err _ ->
                        Decode.fail "no detail record"

                    Ok _ ->
                        let
                            channel =
                                normalizeChannel (field "channel" root |> Maybe.withDefault Encode.null)
                        in
                        if String.isEmpty channel || (not (String.isEmpty expectedChannel) && String.toLower channel /= String.toLower expectedChannel) then
                            Decode.fail "room mismatch"

                        else
                            Decode.succeed (buildChannelDetail root channel)
            )


detailRecordDecoder : Decoder ()
detailRecordDecoder =
    Decode.value
        |> Decode.andThen
            (\v ->
                case Decode.decodeValue (Decode.list Decode.value) v of
                    Ok _ ->
                        Decode.fail "array is not a record"

                    Err _ ->
                        case Decode.decodeValue (Decode.keyValuePairs Decode.value) v of
                            Ok _ ->
                                Decode.succeed ()

                            Err _ ->
                                Decode.fail "not a record"
            )


buildChannelDetail : Decode.Value -> String -> ChannelDetail
buildChannelDetail root channel =
    let
        totals =
            field "totals" root |> Maybe.withDefault Encode.null

        totalsRecord =
            case Decode.decodeValue detailRecordDecoder totals of
                Ok _ ->
                    True

                Err _ ->
                    False

        hours =
            fixedCounts (field "hours" root |> Maybe.withDefault Encode.null) 24

        heatmapRaw =
            field "heatmap" root |> Maybe.withDefault Encode.null

        heatmapRows =
            case Decode.decodeValue (Decode.list Decode.value) heatmapRaw of
                Ok rows ->
                    if List.length rows == 7 then
                        List.map (\row -> fixedCounts row 24) rows

                    else
                        List.repeat 7 { values = List.repeat 24 0, complete = False }

                Err _ ->
                    List.repeat 7 { values = List.repeat 24 0, complete = False }

        daysRaw =
            field "days" root |> Maybe.withDefault Encode.null

        daysFold =
            case Decode.decodeValue (Decode.list Decode.value) daysRaw of
                Err _ ->
                    { days = [], complete = False }

                Ok items ->
                    let
                        capped =
                            List.drop (List.length items - min maxDetailDays (List.length items)) items

                        step item ( keptDays, seenDays, daysComplete ) =
                            let
                                dayRecord =
                                    case Decode.decodeValue detailRecordDecoder item of
                                        Ok _ ->
                                            Just item

                                        Err _ ->
                                            Nothing

                                date =
                                    validDetailDate (Maybe.map (\r -> field "date" r |> Maybe.withDefault Encode.null) dayRecord |> Maybe.withDefault Encode.null)
                            in
                            case dayRecord of
                                Just record ->
                                    if String.isEmpty date || List.member date seenDays then
                                        ( keptDays, seenDays, False )

                                    else
                                        ( keptDays ++ [ { date = date, messages = boundedInt (field "messages" record |> Maybe.withDefault Encode.null) } ]
                                        , date :: seenDays
                                        , daysComplete
                                        )

                                Nothing ->
                                    ( keptDays, seenDays, False )
                    in
                    case List.foldl step ( [], [], List.length items <= maxDetailDays ) capped of
                        ( foldedDays, _, foldedComplete ) ->
                            { days = foldedDays, complete = foldedComplete }

        records =
            field "records" root |> Maybe.withDefault Encode.null

        recordsOk =
            case Decode.decodeValue detailRecordDecoder records of
                Ok _ ->
                    True

                Err _ ->
                    False

        busiestRaw =
            field "busiest_day" records |> Maybe.withDefault Encode.null

        busiestDate =
            validDetailDate (field "date" busiestRaw |> Maybe.withDefault Encode.null)

        busiestDay =
            if String.isEmpty busiestDate then
                Nothing

            else
                Just { date = busiestDate, messages = boundedInt (field "messages" busiestRaw |> Maybe.withDefault Encode.null) }

        peakHour =
            case Decode.decodeValue Decode.int (field "peak_hour" records |> Maybe.withDefault Encode.null) of
                Ok h ->
                    if h >= 0 && h < 24 then
                        Just h

                    else
                        Nothing

                Err _ ->
                    Nothing

        complete =
            totalsRecord
                && hours.complete
                && List.all .complete heatmapRows
                && daysFold.complete
                && recordsOk
                && busiestDay /= Nothing
                && peakHour /= Nothing
    in
    { channel = channel
    , generatedAt = boundedUnix (field "generated_at" root |> Maybe.withDefault Encode.null)
    , firstSeen = boundedUnix (field "first_seen" root |> Maybe.withDefault Encode.null)
    , lastActive = boundedUnix (field "last_active" root |> Maybe.withDefault Encode.null)
    , present = boundedInt (field "present" root |> Maybe.withDefault Encode.null)
    , lastSpeaker = boundedText (field "last_speaker" root |> Maybe.withDefault Encode.null) maxDetailText
    , totals =
        { messages = boundedInt (field "messages" totals |> Maybe.withDefault Encode.null)
        , words = boundedInt (field "words" totals |> Maybe.withDefault Encode.null)
        , activeUsers = boundedInt (field "active_users" totals |> Maybe.withDefault Encode.null)
        , joins = boundedInt (field "joins" totals |> Maybe.withDefault Encode.null)
        , parts = boundedInt (field "parts" totals |> Maybe.withDefault Encode.null)
        , quits = boundedInt (field "quits" totals |> Maybe.withDefault Encode.null)
        , kicks = boundedInt (field "kicks" totals |> Maybe.withDefault Encode.null)
        , topicChanges = boundedInt (field "topic_changes" totals |> Maybe.withDefault Encode.null)
        }
    , hours = hours.values
    , days = daysFold.days
    , heatmap = List.map .values heatmapRows
    , busiestDay = busiestDay
    , peakHour = peakHour
    , complete = complete
    }


{-| Decode a 24-hour pulse body (mirroring the `fetchChannelPulse`
shape): exactly 24 hour counts, or absent.
-}
decodeChannelPulse : String -> Maybe ChannelPulse
decodeChannelPulse body =
    Decode.decodeString channelPulseDecoder body
        |> Result.toMaybe


channelPulseDecoder : Decoder ChannelPulse
channelPulseDecoder =
    Decode.value
        |> Decode.andThen
            (\root ->
                case Decode.decodeValue detailRecordDecoder root of
                    Err _ ->
                        Decode.fail "no pulse record"

                    Ok _ ->
                        let
                            hours =
                                fixedCounts (field "hours" root |> Maybe.withDefault Encode.null) 24
                        in
                        if not hours.complete then
                            Decode.fail "no 24-hour histogram"

                        else
                            let
                                totals =
                                    field "totals" root |> Maybe.withDefault Encode.null

                                reported =
                                    Decode.decodeValue Decode.float (field "messages" totals |> Maybe.withDefault Encode.null)
                                        |> Result.toMaybe

                                total =
                                    case reported of
                                        Just n ->
                                            if n >= 0 && not (isNaN n) && not (isInfinite n) then
                                                floor (min n 1000000000000) |> min int32Max |> max 0

                                            else
                                                List.sum hours.values |> min 1000000000000 |> min int32Max

                                        Nothing ->
                                            List.sum hours.values |> min 1000000000000 |> min int32Max
                            in
                            Decode.succeed
                                { hours = hours.values
                                , total = total
                                , present = boundedInt (field "present" root |> Maybe.withDefault Encode.null)
                                , lastActive = boundedUnix (field "last_active" root |> Maybe.withDefault Encode.null)
                                }
            )


{-| Non-negative counter guard (mirroring `safeCount`): non-finite
or non-positive reads as zero.
-}
safeCount : Float -> Float
safeCount value =
    if isNaN value || isInfinite value || value <= 0 then
        0

    else
        value


{-| Share of network messages one room accounts for, 0–100, or
`Nothing` when the index is empty.
-}
roomShareOfNetwork : Int -> Int -> Maybe Float
roomShareOfNetwork roomMessages networkMessages =
    if networkMessages <= 0 then
        Nothing

    else
        Just (min 100 (max 0 (toFloat (max 0 roomMessages) / toFloat networkMessages * 100)))


{-| Peak hour's share of the 24-hour histogram.
-}
peakHourShare : List Int -> Float
peakHourShare hours =
    case hours of
        [] ->
            0

        _ ->
            let
                peak =
                    List.maximum (List.map (max 0) hours) |> Maybe.withDefault 0

                total =
                    List.sum (List.map (max 0) hours)
            in
            if total <= 0 then
                0

            else
                toFloat peak / toFloat total * 100


{-| Joins minus departures (parts + quits + kicks). Negative means the
room is shedding.
-}
netMembershipFlow : ChannelDetailTotals -> Int
netMembershipFlow totals =
    totals.joins - totals.parts - totals.quits - totals.kicks


{-| Canonical public inspector URL for a room.
-}
statsRoomHref : String -> String
statsRoomHref channel =
    "/stats/?room=" ++ Url.percentEncode channel


firstQueryValue : String -> String -> String
firstQueryValue name search =
    let
        query =
            if String.startsWith "?" search then
                String.dropLeft 1 search

            else
                search

        pairs =
            String.split "&" query

        match pair =
            case String.split "=" pair of
                key :: rest ->
                    if formDecode key == name then
                        Just (formDecode (String.join "=" rest))

                    else
                        Nothing

                [] ->
                    Nothing
    in
    List.filterMap match pairs |> List.head |> Maybe.withDefault ""


{-| Form-decode one query part the way `URLSearchParams` parses: `+`
is a space, then percent-decode; malformed sequences stay raw.
-}
formDecode : String -> String
formDecode raw =
    Url.percentDecode (String.replace "+" " " raw) |> Maybe.withDefault raw


isRoomQueryBadChar : Char -> Bool
isRoomQueryBadChar c =
    c == '\u{0000}' || c == '\u{000D}' || c == '\u{000A}' || c == '\u{0009}' || c == ' ' || c == ','


{-| Reads `?room=` from a query string. Accepts `#root`, `&ops`, or a
bare `root` (treated as `#root`). Rejects injection characters.
-}
parseStatsRoomQuery : String -> String
parseStatsRoomQuery search =
    let
        raw =
            String.trim (firstQueryValue "room" search)
    in
    if String.isEmpty raw || String.length raw > maxDetailText then
        ""

    else if
        (String.startsWith "#" raw || String.startsWith "&" raw)
            && not (String.any isRoomQueryBadChar raw)
    then
        raw

    else if not (String.any (\c -> isRoomQueryBadChar c || c == '#' || c == '&') raw) then
        "#" ++ raw

    else
        ""


isValidCompareRoom : String -> Bool
isValidCompareRoom room =
    String.length room > 0
        && String.length room <= maxRoomNameLength
        && (String.startsWith "#" room || String.startsWith "&" room)
        && not (String.any isRoomQueryBadChar room)


collectCompareRooms : List String -> List String
collectCompareRooms candidates =
    let
        step candidate ( rooms, seen ) =
            let
                room =
                    String.trim candidate

                key =
                    String.toLower room
            in
            if List.length rooms >= maxCompareRooms || not (isValidCompareRoom room) || List.member key seen then
                ( rooms, seen )

            else
                ( rooms ++ [ room ], key :: seen )
    in
    List.foldl step ( [], [] ) candidates |> Tuple.first


{-| Read at most two valid, distinct room names from the shareable URL
state.
-}
parseStatsCompareQuery : String -> List String
parseStatsCompareQuery search =
    collectCompareRooms (String.split "," (firstQueryValue "compare" search))


{-| Serialize valid room names for the shareable URL state (no
double-encoding — the caller encodes the joined value once).
-}
statsCompareQuery : List String -> String
statsCompareQuery channels =
    String.join "," (collectCompareRooms channels)


{-| Parse the shareable network activity window, defaulting to the
full feed.
-}
parseStatsWindowQuery : String -> StatsWindow
parseStatsWindowQuery search =
    if firstQueryValue "window" search == "7" then
        7

    else
        14


{-| Compact relative time from a unix-seconds stamp (mirroring
`networkIndex.relTime` over `relativeTime`): out-of-range stamps read
as `a while ago`. The yesterday/tomorrow boundary is UTC (see the
module narrowing note).
-}
relTime : Float -> Float -> String
relTime unixSec nowMs =
    if isNaN unixSec || isInfinite unixSec || unixSec <= 0 || unixSec > 8640000000000 || isNaN nowMs || isInfinite nowMs || abs nowMs > 8640000000000 * 1000 then
        "a while ago"

    else
        relativeTime (unixSec * 1000) nowMs


relativeTime : Float -> Float -> String
relativeTime thenMs nowMs =
    let
        delta =
            thenMs - nowMs

        absMs =
            abs delta

        isFuture =
            delta > 0

        ago amount unit =
            if isFuture then
                "in " ++ amount ++ unit

            else
                amount ++ unit ++ " ago"
    in
    if absMs < 45 * 1000 then
        "just now"

    else if absMs < 60 * 60 * 1000 then
        ago (String.fromInt (max 1 (floor (absMs / (60 * 1000))))) "m"

    else if absMs < 24 * 60 * 60 * 1000 then
        ago (String.fromInt (floor (absMs / (60 * 60 * 1000)))) "h"

    else if absMs < 2 * 24 * 60 * 60 * 1000 then
        if isFuture then
            "tomorrow"

        else
            "yesterday"

    else if absMs < 7 * 24 * 60 * 60 * 1000 then
        ago (String.fromInt (floor (absMs / (24 * 60 * 60 * 1000)))) "d"

    else if absMs < 30 * 24 * 60 * 60 * 1000 then
        ago (String.fromInt (floor (absMs / (7 * 24 * 60 * 60 * 1000)))) "w"

    else if absMs < 365 * 24 * 60 * 60 * 1000 then
        ago (String.fromInt (floor (absMs / (30 * 24 * 60 * 60 * 1000)))) "mo"

    else
        ago (String.fromInt (max 1 (floor (absMs / (365 * 24 * 60 * 60 * 1000))))) "y"


{-| UTC calendar date for a unix-seconds stamp (`M/D/YYYY`), standing
in for `Date.toLocaleDateString()` (see the module narrowing note).
-}
utcDateLabel : Float -> String
utcDateLabel unixSec =
    let
        posix =
            Time.millisToPosix (floor (unixSec * 1000))

        month =
            case Time.toMonth Time.utc posix of
                Time.Jan ->
                    1

                Time.Feb ->
                    2

                Time.Mar ->
                    3

                Time.Apr ->
                    4

                Time.May ->
                    5

                Time.Jun ->
                    6

                Time.Jul ->
                    7

                Time.Aug ->
                    8

                Time.Sep ->
                    9

                Time.Oct ->
                    10

                Time.Nov ->
                    11

                Time.Dec ->
                    12
    in
    String.fromInt month
        ++ "/"
        ++ String.fromInt (Time.toDay Time.utc posix)
        ++ "/"
        ++ String.fromInt (Time.toYear Time.utc posix)


{-| `en-US` thousands grouping for a whole count.
-}
formatCount : Int -> String
formatCount value =
    (if value < 0 then
        "-"

     else
        ""
    )
        ++ groupThousands (String.fromInt (abs value))


groupThousands : String -> String
groupThousands digits =
    let
        len =
            String.length digits
    in
    if len <= 3 then
        digits

    else
        groupThousands (String.left (len - 3) digits) ++ "," ++ String.right 3 digits


{-| `en-US` count for a pulse sum: rounds, then groups.
-}
formatPulse : Float -> String
formatPulse value =
    formatCount (round (safeCount value))


formatHour : Maybe Int -> String
formatHour hour =
    case hour of
        Nothing ->
            "—"

        Just h ->
            String.padLeft 2 '0' (String.fromInt h) ++ ":00 UTC"


barHeight : Int -> Int -> String
barHeight messages peak =
    if peak <= 0 then
        "3"

    else
        String.fromInt (max 3 (round (toFloat messages / toFloat peak * 100)))


roomPulse : StatsChannel -> Float
roomPulse channel =
    List.sum (List.map safeCount channel.spark)


activityLabel : StatsChannel -> Float -> String
activityLabel channel nowMs =
    if channel.present > 0 then
        String.fromInt channel.present ++ " present now"

    else
        "last active " ++ relTime channel.lastActive nowMs


isActiveRecently : StatsChannel -> Float -> Bool
isActiveRecently channel nowMs =
    if channel.present > 0 then
        True

    else
        let
            nowSeconds =
                floor (nowMs / 1000)
        in
        channel.lastActive
            > 0
            && channel.lastActive
            <= toFloat nowSeconds
            + 5
            * 60
            && toFloat nowSeconds - channel.lastActive <= toFloat recentRoomWindowSeconds


type Freshness
    = FreshCurrent
    | FreshStale
    | FreshFuture
    | FreshUnknown


{-| Feed state against the clock (mirroring the route `feedState`:
freshness first, then the partial leg).
-}
feedStateAt : Maybe StatsIndex -> Bool -> Float -> FeedState
feedStateAt maybeIndex loading nowMs =
    case maybeIndex of
        Nothing ->
            if loading then
                FeedLoading

            else
                FeedUnavailable

        Just index ->
            case feedFreshnessAt index.generatedAt nowMs of
                FreshCurrent ->
                    if not index.channelsComplete || not index.networkDaysComplete then
                        FeedPartial

                    else
                        FeedCurrent

                FreshStale ->
                    FeedStale

                FreshFuture ->
                    FeedFuture

                FreshUnknown ->
                    FeedUnknown


feedFreshnessAt : Float -> Float -> Freshness
feedFreshnessAt generatedAt nowMs =
    if isNaN generatedAt || isInfinite generatedAt || generatedAt <= 0 || generatedAt > 8640000000000 || isNaN nowMs || isInfinite nowMs then
        FreshUnknown

    else
        let
            ageMs =
                nowMs - generatedAt * 1000
        in
        if ageMs < -futureSkewMs then
            FreshFuture

        else if ageMs <= freshMs then
            FreshCurrent

        else
            FreshStale


feedStateLabel : FeedState -> String
feedStateLabel state =
    case state of
        FeedLoading ->
            "stats checking"

        FeedCurrent ->
            "stats current"

        FeedStale ->
            "stats stale"

        FeedFuture ->
            "stats time mismatch"

        FeedUnknown ->
            "stats undated"

        FeedPartial ->
            "stats incomplete"

        FeedUnavailable ->
            "stats unavailable"


feedLedgerPhrase : FeedState -> String
feedLedgerPhrase state =
    case state of
        FeedCurrent ->
            "export current"

        FeedPartial ->
            "export incomplete"

        FeedStale ->
            "export stale"

        FeedFuture ->
            "export time mismatch"

        FeedUnknown ->
            "export undated"

        FeedLoading ->
            "export pending"

        FeedUnavailable ->
            "export unavailable"


presencePhrase : FeedState -> String -> String -> String
presencePhrase state whenCurrent otherwise =
    if state == FeedCurrent then
        whenCurrent

    else
        otherwise


{-| The three legibility checks before any claim: a report arrived,
its freshness, and exactly what the page may expose.
-}
statsFeedTimeline : FeedState -> Bool -> List TimelineStep
statsFeedTimeline state hasData =
    let
        report =
            if state == FeedLoading then
                { id = "report", label = "Report", status = "waiting", detail = "Waiting for the next public export.", state = "pending" }

            else if state == FeedUnavailable || not hasData then
                { id = "report", label = "Report", status = "not found", detail = "No public export is available to inspect.", state = "unavailable" }

            else
                { id = "report", label = "Report", status = "received", detail = "A public aggregate export is available.", state = "observed" }

        freshness =
            if state == FeedLoading then
                { id = "freshness", label = "Freshness", status = "pending", detail = "Freshness is checked after a report arrives.", state = "pending" }

            else if state == FeedUnavailable || not hasData then
                { id = "freshness", label = "Freshness", status = "not checked", detail = "There is no timestamp to qualify.", state = "unavailable" }

            else if state == FeedCurrent then
                { id = "freshness", label = "Freshness", status = "within window", detail = "The report is inside the public freshness window.", state = "observed" }

            else if state == FeedPartial then
                { id = "freshness", label = "Freshness", status = "within window", detail = "The report is current, but some rows need review.", state = "attention" }

            else
                { id = "freshness"
                , label = "Freshness"
                , status =
                    if state == FeedFuture then
                        "time mismatch"

                    else if state == FeedUnknown then
                        "undated"

                    else
                        "outside window"
                , detail = "The snapshot stays visible, but it cannot support a current claim."
                , state = "attention"
                }

        scope =
            if state == FeedLoading then
                { id = "scope", label = "Scope", status = "pending", detail = "Privacy boundaries are applied when data is read.", state = "pending" }

            else if state == FeedUnavailable || not hasData then
                { id = "scope", label = "Scope", status = "not available", detail = "No feed means no activity claim.", state = "unavailable" }

            else if state == FeedPartial then
                { id = "scope", label = "Scope", status = "partial aggregate", detail = "Only validated room and day rows are counted.", state = "attention" }

            else
                { id = "scope", label = "Scope", status = "aggregate-only", detail = "Room totals and daily counts; no message text or rankings.", state = "observed" }
    in
    [ report, freshness, scope ]


feedTimelineNote : FeedState -> Maybe StatsIndex -> Float -> String
feedTimelineNote state maybeIndex nowMs =
    if state == FeedLoading then
        "Checking the public export. No activity claim yet."

    else if state == FeedUnavailable then
        "The public export is unavailable. No activity claim is made."

    else
        let
            generatedAt =
                Maybe.map .generatedAt maybeIndex |> Maybe.withDefault 0

            age =
                if generatedAt > 0 then
                    "Last report " ++ relTime generatedAt nowMs ++ "."

                else
                    "The report has no usable timestamp."
        in
        if state == FeedPartial then
            age ++ " Some aggregate rows were omitted, so read this as an incomplete snapshot."

        else if state == FeedCurrent then
            age ++ " The visible network totals are inside the public freshness window."

        else
            age ++ " This snapshot remains visible for context, not as a current health claim."


{-| Window control state for the network activity horizon.
-}
type WindowState
    = WindowCurrent
    | WindowLoading
    | WindowStale
    | WindowUnavailable


windowStateKey : WindowState -> String
windowStateKey state =
    case state of
        WindowCurrent ->
            "current"

        WindowLoading ->
            "loading"

        WindowStale ->
            "stale"

        WindowUnavailable ->
            "unavailable"


activityWindowStateFor : FeedState -> List NetworkDay -> WindowState
activityWindowStateFor feedState windowDays =
    if feedState == FeedLoading then
        WindowLoading

    else if feedState == FeedUnavailable || List.isEmpty windowDays then
        WindowUnavailable

    else if feedState == FeedCurrent then
        WindowCurrent

    else
        WindowStale


activityWindowStatus : FeedState -> WindowState -> StatsWindow -> Int -> String
activityWindowStatus feedState windowState window samples =
    case windowState of
        WindowLoading ->
            "Waiting for the public feed before choosing a window."

        WindowUnavailable ->
            "Window controls are unavailable until daily public activity is exported."

        WindowStale ->
            "Showing the latest " ++ String.fromInt window ++ " days from a " ++ feedLedgerPhrase feedState ++ ". Treat this as a snapshot."

        WindowCurrent ->
            let
                suffix =
                    if samples < window then
                        " · " ++ String.fromInt samples ++ " exported " ++ (if samples == 1 then "day" else "days") ++ " available"

                    else
                        ""
            in
            "Showing the latest " ++ String.fromInt window ++ " days of public network activity" ++ suffix ++ "."


{-| The trailing activity window of the exported day series.
-}
windowDaysFor : List NetworkDay -> StatsWindow -> List NetworkDay
windowDaysFor days window =
    List.drop (List.length days - min window (List.length days)) days


{-| Busiest room by tracked messages (channels arrive sorted
descending, so this is the head).
-}
busiestChannel : List StatsChannel -> Maybe StatsChannel
busiestChannel channels =
    List.head (List.sortBy (\c -> -c.messages) channels)


{-| The visible directory: scope filter, then the active sort with a
channel-name tiebreak (mirroring `localeCompare` on the tie — plain
code-point order here).
-}
visibleChannels : List StatsChannel -> RoomScope -> RoomSort -> String -> Float -> List StatsChannel
visibleChannels channels scope sort query nowMs =
    let
        folded =
            String.toLower (String.trim query)

        scoped =
            List.filter
                (\channel ->
                    (case scope of
                        ScopeAll ->
                            True

                        ScopePresent ->
                            channel.present > 0

                        ScopeRecent ->
                            isActiveRecently channel nowMs
                    )
                        && (String.isEmpty folded
                                || String.contains folded (String.toLower channel.channel)
                                || String.contains folded (String.toLower channel.topic)
                           )
                )
                channels

        keyed =
            case sort of
                SortPulse ->
                    List.map (\c -> ( negate (roomPulse c), c )) scoped

                SortPresence ->
                    List.map (\c -> ( toFloat (negate c.present), c )) scoped

                SortRecent ->
                    List.map (\c -> ( negate c.lastActive, c )) scoped

                SortMessages ->
                    List.map (\c -> ( toFloat (negate c.messages), c )) scoped
    in
    List.sortBy (\( k, c ) -> ( k, c.channel )) keyed
        |> List.map Tuple.second


{-| Room deep link, opening the room at its last recorded moment. An
out-of-range `last_active` degrades to a plain join so a mis-scaled
feed value can never crash the render.
-}
roomDeepLink : String -> Float -> String
roomDeepLink channel lastActiveUnixSec =
    let
        ms =
            lastActiveUnixSec * 1000
    in
    if lastActiveUnixSec > 0 && not (isNaN ms) && not (isInfinite ms) && ms <= maxTimeMs then
        "/app/?join=" ++ Url.percentEncode channel ++ "&at=" ++ Url.percentEncode (SavedSearches.isoFromMillis ms)

    else
        "/app/?join=" ++ Url.percentEncode channel


{-| One decimal place, mirroring `Number.toFixed(1)`.
-}
toFixed1 : Float -> String
toFixed1 value =
    let
        tenths =
            round (value * 10)

        sign =
            if tenths < 0 then
                "-"

            else
                ""

        magnitude =
            abs tenths
    in
    sign ++ String.fromInt (magnitude // 10) ++ "." ++ String.fromInt (modBy 10 magnitude)


averageWords : ChannelDetail -> String
averageWords detail =
    if detail.totals.messages <= 0 then
        "0"

    else
        toFixed1 (toFloat detail.totals.words / toFloat detail.totals.messages)


networkShare : Int -> Int -> String
networkShare messages total =
    if total <= 0 then
        "—"

    else
        let
            share =
                min 100 (max 0 (safeCount (toFloat messages) / toFloat total * 100))
        in
        (if share >= 10 then
            String.fromInt (round share)

         else
            toFixed1 share
        )
            ++ "%"


selectionCopy : Int -> Int -> String
selectionCopy selected available =
    if available == 0 then
        "Room choices will appear when a public room index is available."

    else if selected == 0 then
        "Select two rooms from the directory below to compare their public pulse."

    else if selected == 1 then
        "One room selected. Add one more room to unlock the side-by-side read."

    else
        "Two rooms selected. The comparison uses aggregate public counters only."


feedNote : FeedState -> Int -> Int -> String
feedNote state selected missing =
    if state == FeedLoading then
        "Waiting for the public room index. No comparison claim yet."

    else if state == FeedUnavailable then
        "Room comparison is unavailable until a public room index is exported."

    else if missing > 0 then
        String.fromInt missing ++ " selected " ++ (if missing == 1 then "room is" else "rooms are") ++ " not in this export. Clear the selection or choose another room."

    else if state == FeedPartial then
        "This export is incomplete. Compare only the validated aggregate rows shown here."

    else if state /= FeedCurrent then
        "This is a retained snapshot. It remains useful for context, not as a current claim."

    else if selected == maxCompareRooms then
        "Current export · aggregate-only comparison · no message text or participant rankings."

    else
        "Current export · choose up to two rooms from the public directory."


stepState : FeedState -> String
stepState state =
    if state == FeedLoading then
        "loading"

    else if state == FeedUnavailable then
        "unavailable"

    else if state == FeedCurrent then
        "current"

    else
        "snapshot"


compareHeadline : List StatsChannel -> String
compareHeadline rooms =
    case rooms of
        [ left, right ] ->
            let
                difference =
                    abs (left.messages - right.messages)
            in
            if difference == 0 then
                left.channel ++ " and " ++ right.channel ++ " are level on tracked messages."

            else
                let
                    leader =
                        if left.messages > right.messages then
                            left

                        else
                            right
                in
                leader.channel ++ " leads by " ++ formatCount difference ++ " tracked " ++ (if difference == 1 then "message" else "messages") ++ "."

        _ ->
            ""


{-| Decode the public backup manifest (mirroring
`normalizeBackupManifest`): non-objects read as absent; entries with a
bad kind/name are dropped, and kind+name duplicates collapse
case-insensitively.
-}
decodeBackupManifest : String -> Maybe BackupManifest
decodeBackupManifest body =
    Decode.decodeString backupManifestDecoder body
        |> Result.toMaybe


backupManifestDecoder : Decoder BackupManifest
backupManifestDecoder =
    Decode.value
        |> Decode.andThen
            (\root ->
                case Decode.decodeValue detailRecordDecoder root of
                    Err _ ->
                        Decode.fail "no manifest record"

                    Ok _ ->
                        let
                            filesRaw =
                                field "files" root |> Maybe.withDefault Encode.null

                            entries =
                                case Decode.decodeValue (Decode.list Decode.value) filesRaw of
                                    Ok items ->
                                        List.take maxBackupFiles items

                                    Err _ ->
                                        []

                            step entry ( files, seen ) =
                                let
                                    kindRaw =
                                        field "kind" entry |> Maybe.withDefault Encode.null

                                    nameRaw =
                                        field "name" entry |> Maybe.withDefault Encode.null

                                    kind =
                                        case Decode.decodeValue Decode.string kindRaw of
                                            Ok k ->
                                                k

                                            Err _ ->
                                                ""

                                    name =
                                        case Decode.decodeValue Decode.string nameRaw of
                                            Ok n ->
                                                n

                                            Err _ ->
                                                ""
                                in
                                if String.isEmpty kind
                                    || String.length kind > maxBackupKindLength
                                    || String.isEmpty name
                                    || String.length name > maxBackupNameLength
                                    || String.any isControlChar kind
                                    || String.any isControlChar name then
                                    ( files, seen )

                                else
                                    let
                                        key =
                                            String.toLower kind ++ "\u{0000}" ++ String.toLower name
                                    in
                                    if List.member key seen then
                                        ( files, seen )

                                    else
                                        ( files
                                            ++ [ { kind = kind
                                                 , name = name
                                                 , source = boundedText (field "source" entry |> Maybe.withDefault Encode.null) maxBackupSourceLength
                                                 }
                                               ]
                                        , key :: seen
                                        )
                        in
                        case List.foldl step ( [], [] ) entries of
                            ( files, _ ) ->
                                Decode.succeed
                                    { generatedAt = boundedUnix (field "generated_at" root |> Maybe.withDefault Encode.null)
                                    , files = files
                                    }
            )


isControlChar : Char -> Bool
isControlChar c =
    let
        cp =
            Char.toCode c
    in
    (cp >= 0x00 && cp <= 0x1F) || cp == 0x7F
