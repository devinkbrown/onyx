module Topic exposing
    ( TopicSummary
    , TopicUnreadRow
    , TopicUnreadScope
    , filterByTopic
    , listTopics
    , projectTopicUnread
    , summarizeTopics
    )

{-| Pure topic slicing helpers for topic-aware message views
(mirroring `src/lib/search/topicFilter.ts`: forum-style topic
lists over any record carrying a topic label and a stamp).

Normalization is lowercase-only — surrounding whitespace is
significant and the empty string is an ordinary label distinct
from `Nothing`. Summaries sort by latest activity (newest
first), then alphabetically; the display label keeps its first
casing.

Narrowings: the alphabetical tiebreak compares `toLower` then
raw where the oracle uses `localeCompare` (plain and base
sensitivity); ASCII orders identically. Stamps are epoch
milliseconds, so the oracle `lastAt` clone concern does not
apply — Elm values are immutable. The unread projector covers
the markerless reduction of `projectRoomTopicUnread` (no
device ledger yet, so per-topic markers stay pending): rows at
or newer than the room boundary count by normalized label.
Narrowings: buffers arrive newest-first where the oracle scans
oldest-first (positions invert, results match); rows arrive
already label-validated so invalid labels are skipped only when
empty after trimming rather than revalidated; the highlight
arm reads the admitted row flag where the oracle reclassifies
the text (both arms share the classifier).
-}

import Dict exposing (Dict)


{-| One topic rollup. -}
type alias TopicSummary =
    { topic : String
    , count : Int
    , lastAt : Int
    }


normalizeTopic : String -> String
normalizeTopic topic =
    String.toLower topic


compareTopicsAsc : String -> String -> Order
compareTopicsAsc left right =
    case compare (normalizeTopic left) (normalizeTopic right) of
        EQ ->
            compare left right

        ord ->
            ord


compareSummaries : TopicSummary -> TopicSummary -> Order
compareSummaries left right =
    case compare right.lastAt left.lastAt of
        EQ ->
            compareTopicsAsc left.topic right.topic

        ord ->
            ord


{-| Rows carrying one topic (mirroring `filterByTopic`: a
`Nothing` filter returns the whole list; otherwise rows match
when their label normalizes equal — null-topic rows never
match a label).
-}
filterByTopic : List { a | topic : Maybe String, at : Int } -> Maybe String -> List { a | topic : Maybe String, at : Int }
filterByTopic messages topic =
    case topic of
        Nothing ->
            messages

        Just wanted ->
            let
                key =
                    normalizeTopic wanted
            in
            List.filter
                (\message ->
                    case message.topic of
                        Just label ->
                            normalizeTopic label == key

                        Nothing ->
                            False
                )
                messages


{-| Distinct topic labels in summary order (mirroring
`listTopics`). -}
listTopics : List { a | topic : Maybe String, at : Int } -> List String
listTopics messages =
    List.map .topic (summarizeTopics messages)


{-| One buffer row for unread projection. -}
type alias TopicUnreadRow =
    { id : Int
    , topic : String
    , from : String
    , highlight : Bool
    , system : Bool
    }


{-| Room scope for unread projection. -}
type alias TopicUnreadScope =
    { ours : String
    , notifyLevel : String
    }


{-| Per-topic unread counts over a newest-first buffer (mirroring
the markerless reduction of `projectRoomTopicUnread`: the
boundary id is the divider else the first-unread cursor; rows
at or newer than it count unless system, own, level-`none`, or
a non-highlight under level-`mentions`; untagged rows never
land in the map; a missing boundary counts nothing).
-}
projectTopicUnread : TopicUnreadScope -> List TopicUnreadRow -> Maybe Int -> Dict String Int
projectTopicUnread scope rows boundaryId =
    if scope.notifyLevel == "none" then
        Dict.empty

    else
        case boundaryPosition rows boundaryId of
            Nothing ->
                Dict.empty

            Just position ->
                List.foldl (countUnreadRow scope) Dict.empty (List.take (position + 1) rows)


boundaryPosition : List TopicUnreadRow -> Maybe Int -> Maybe Int
boundaryPosition rows boundaryId =
    case boundaryId of
        Nothing ->
            Nothing

        Just wanted ->
            let
                step row ( index, found ) =
                    case found of
                        Just _ ->
                            ( index + 1, found )

                        Nothing ->
                            if row.id == wanted then
                                ( index + 1, Just index )

                            else
                                ( index + 1, Nothing )
            in
            Tuple.second (List.foldl step ( 0, Nothing ) rows)


countUnreadRow : TopicUnreadScope -> TopicUnreadRow -> Dict String Int -> Dict String Int
countUnreadRow scope row counts =
    if row.system then
        counts

    else if String.toLower row.from == String.toLower scope.ours then
        counts

    else if scope.notifyLevel == "mentions" && not row.highlight then
        counts

    else
        let
            key =
                normalizeTopic (String.trim row.topic)
        in
        if String.isEmpty key then
            counts

        else
            Dict.insert key (Maybe.withDefault 0 (Dict.get key counts) + 1) counts


{-| Counted rollups with latest activity (mirroring
`summarizeTopics`: null-topic rows excluded, first casing kept,
latest stamp wins).
-}
summarizeTopics : List { a | topic : Maybe String, at : Int } -> List TopicSummary
summarizeTopics messages =
    let
        step message buckets =
            case message.topic of
                Nothing ->
                    buckets

                Just label ->
                    let
                        key =
                            normalizeTopic label
                    in
                    case Dict.get key buckets of
                        Nothing ->
                            Dict.insert key { topic = label, count = 1, lastAt = message.at } buckets

                        Just bucket ->
                            Dict.insert key
                                { topic = bucket.topic
                                , count = bucket.count + 1
                                , lastAt = max bucket.lastAt message.at
                                }
                                buckets
    in
    Dict.values (List.foldl step Dict.empty messages)
        |> List.sortWith compareSummaries
