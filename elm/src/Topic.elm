module Topic exposing
    ( TopicSummary
    , filterByTopic
    , listTopics
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
apply — Elm values are immutable.
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
