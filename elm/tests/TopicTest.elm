module TopicTest exposing (suite)

{-| Oracle-mirrored vectors for topic slicing (mirroring
`src/lib/search/topicFilter.test.ts`: case-insensitive match,
significant whitespace, empty-string labels, dedupe with first
casing, recency-then-alphabetical order, counts, latest stamps).
-}

import Expect
import Test exposing (Test, describe, test)
import Topic exposing (..)


type alias Msg =
    { id : String
    , topic : Maybe String
    , at : Int
    }


msg : String -> Maybe String -> Int -> Msg
msg id topic at =
    { id = id, topic = topic, at = at }


ids : List Msg -> List String
ids messages =
    List.map .id messages


d01 =
    1767261600000


d01b =
    1767265200000


d01c =
    1767268800000


d01d =
    1767272400000


d02 =
    1767348000000


d03 =
    1767434400000


d04 =
    1767520800000


d05 =
    1767607200000


d06 =
    1767693600000


d07 =
    1767780000000


d08 =
    1767866400000


d10 =
    1768039200000


suite : Test
suite =
    describe "Topic"
        [ test "null filter returns every message including topicless ones" <|
            \_ ->
                let
                    messages =
                        [ msg "m1" (Just "Roadmap") d01
                        , msg "m2" Nothing d01b
                        ]
                in
                Expect.equal [ "m1", "m2" ] (ids (filterByTopic messages Nothing))
        , test "matches topics case-insensitively" <|
            \_ ->
                let
                    messages =
                        [ msg "m1" (Just "Roadmap") d01
                        , msg "m2" (Just "roadmap") d01b
                        , msg "m3" (Just "Release") d01c
                        , msg "m4" Nothing d01d
                        ]
                in
                Expect.equal [ "m1", "m2" ] (ids (filterByTopic messages (Just "ROADMAP")))
        , test "treats whitespace as part of the topic instead of trimming it" <|
            \_ ->
                let
                    messages =
                        [ msg "m1" (Just "Roadmap") d01
                        , msg "m2" (Just " Roadmap ") d01b
                        ]
                in
                Expect.all
                    [ \_ -> Expect.equal [ "m1" ] (ids (filterByTopic messages (Just "Roadmap")))
                    , \_ -> Expect.equal [ "m2" ] (ids (filterByTopic messages (Just " roadmap ")))
                    ]
                    ()
        , test "matches an empty-string topic without including null-topic messages" <|
            \_ ->
                let
                    messages =
                        [ msg "m1" (Just "") d01
                        , msg "m2" Nothing d01b
                        ]
                in
                Expect.equal [ "m1" ] (ids (filterByTopic messages (Just "")))
        , test "lists nothing when every message is topicless" <|
            \_ ->
                Expect.equal [] (listTopics [ msg "m1" Nothing d01, msg "m2" Nothing d01b ])
        , test "dedupes case-insensitively, keeps first casing, orders by recency then alphabetically" <|
            \_ ->
                let
                    messages =
                        [ msg "m1" (Just "Roadmap") d01
                        , msg "m2" (Just "bug") d06
                        , msg "m3" (Just "roadmap") d07
                        , msg "m4" (Just "alpha") d06
                        , msg "m5" Nothing d08
                        ]
                in
                Expect.equal [ "Roadmap", "alpha", "bug" ] (listTopics messages)
        , test "keeps empty-string and markup-looking topics as ordinary labels" <|
            \_ ->
                let
                    messages =
                        [ msg "m1" (Just "<img src=x onerror=alert(1)>") d01
                        , msg "m2" (Just "") d02
                        , msg "m3" Nothing d03
                        ]
                in
                Expect.equal [ "", "<img src=x onerror=alert(1)>" ] (listTopics messages)
        , test "counts messages, keeps the latest activity, and orders summaries" <|
            \_ ->
                let
                    messages =
                        [ msg "m1" (Just "Ink") d01
                        , msg "m2" Nothing d10
                        , msg "m3" (Just "ink") d05
                        , msg "m4" (Just "beta") d04
                        , msg "m5" (Just "Alpha") d04
                        ]
                in
                Expect.equal
                    [ { topic = "Ink", count = 2, lastAt = d05 }
                    , { topic = "Alpha", count = 1, lastAt = d04 }
                    , { topic = "beta", count = 1, lastAt = d04 }
                    ]
                    (summarizeTopics messages)
        , test "preserves first casing and counts later differently-cased duplicates" <|
            \_ ->
                let
                    messages =
                        [ msg "m1" (Just "Topic") d01
                        , msg "m2" (Just "topic") d02
                        , msg "m3" (Just "TOPIC") d03
                        ]
                in
                Expect.equal [ { topic = "Topic", count = 3, lastAt = d03 } ] (summarizeTopics messages)
        ]
