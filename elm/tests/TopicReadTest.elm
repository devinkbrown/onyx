module TopicReadTest exposing (suite)

{-| Oracle-mirrored vectors for device-local topic read cursors (mirroring
`src/lib/topics/topicReadLedger.test.ts`: normalization, malformed-row
sanitize, 256 newest cap with tie order, 4096 scan bound, merge advancing,
mark no-regress/same-time-id-wins, mark-all latest-per-topic, channel clear,
exact-id counting, missing-marker fallback, caller boundaries, and the room
projection with its room-boundary lower bound).

Adaptations (Elm has no localStorage, listeners, `Proxy`, or exceptions):

  - Storage/subscribe/cross-tab vectors have no counterpart: every core here
    is pure over an explicit marker list and ports own persistence (later
    slice). Metadata-only shape is enforced by the `TopicReadMarker` type.
  - The oversized-storage and `Proxy` inspection vectors become a functional
    scan-bound vector: rows past the 4096 scan window are absent even when
    they would sort newest.
  - Throwing classifier vectors become row flags: a classifier that would
    throw is modeled by classifying the row out (`system = True` /
    `highlight = False`), keeping the same expected totals.

-}

import Dict
import Expect
import Json.Encode as Encode
import Test exposing (Test, describe, test)
import TopicRead exposing (..)


msg : String -> Maybe String -> Int -> TopicReadMessage
msg id topic at =
    { id = id, topic = topic, at = at, system = False, highlight = False }


sys : String -> Maybe String -> Int -> TopicReadMessage
sys id topic at =
    { id = id, topic = topic, at = at, system = True, highlight = False }


hl : String -> Maybe String -> Int -> TopicReadMessage
hl id topic at =
    { id = id, topic = topic, at = at, system = False, highlight = True }


marker : String -> String -> String -> Int -> TopicReadMarker
marker channel topic id at =
    { channel = channel, topic = topic, lastReadMessageId = id, lastReadAt = at }


rawMarker : String -> String -> String -> Float -> Encode.Value
rawMarker channel topic id at =
    Encode.object
        [ ( "channel", Encode.string channel )
        , ( "topic", Encode.string topic )
        , ( "lastReadMessageId", Encode.string id )
        , ( "lastReadAt", Encode.float at )
        ]


parse : Encode.Value -> List TopicReadMarker
parse =
    parseTopicReadLedger


suite : Test
suite =
    describe "TopicRead"
        [ describe "normalize and parse"
            [ test "mark keeps only normalized channel/topic read metadata" <|
                \_ ->
                    markTopicRead "  #General " " Release Train " "msg-42" 1000 []
                        |> readTopicReadMarker "#general" "release train"
                        |> Expect.equal (Just (marker "#general" "release train" "msg-42" 1000))
            , test "looks up channel and topic case-insensitively" <|
                \_ ->
                    markTopicRead "#General" "RoadMap" "m1" 100 []
                        |> readTopicReadMarker "#GENERAL" "roadmap"
                        |> Expect.equal (Just (marker "#general" "roadmap" "m1" 100))
            , test "rejects malformed rows and duplicate older entries" <|
                \_ ->
                    parse
                        (Encode.list identity
                            [ Encode.null
                            , Encode.string "entry"
                            , rawMarker "#ok" "topic" "old" 10
                            , Encode.object
                                [ ( "channel", Encode.string "#OK" )
                                , ( "topic", Encode.string "TOPIC" )
                                , ( "lastReadMessageId", Encode.string "new" )
                                , ( "lastReadAt", Encode.float 20 )
                                , ( "text", Encode.string "drop me" )
                                ]
                            , rawMarker "#bad channel" "topic" "m" 30
                            , rawMarker "#ok" ("bad" ++ String.fromChar (Char.fromCode 1) ++ "topic") "m" 30
                            , rawMarker "#ok" "topic-2" "" 30
                            , rawMarker "#ok" "topic-3" "m" -1
                            ]
                        )
                        |> Expect.equal [ marker "#ok" "topic" "new" 20 ]
            , test "non-list JSON and invalid channels parse to nothing" <|
                \_ ->
                    Expect.equalLists
                        [ parse (Encode.string "{not json")
                        , parse (Encode.object [ ( "entries", Encode.list identity [] ) ])
                        , parse (Encode.list identity [ rawMarker "room" "alpha" "m1" 10 ])
                        ]
                        [ [], [], [] ]
            , test "decodes real epoch-ms stamps without 32-bit wrapping" <|
                \_ ->
                    parse (Encode.list identity [ rawMarker "#room" "alpha" "m1" 1767261600000 ])
                        |> Expect.equal [ marker "#room" "alpha" "m1" 1767261600000 ]
            ]
        , describe "bounds"
            [ test "retains the 256 newest markers with deterministic tie ordering" <|
                \_ ->
                    let
                        entries =
                            List.range 0 (maxTopicReadEntries + 7)
                                |> List.map
                                    (\index ->
                                        marker "#room"
                                            ("topic-" ++ String.padLeft 3 '0' (String.fromInt index))
                                            ("m-" ++ String.fromInt index)
                                            (if index < 4 then
                                                500

                                             else
                                                index
                                            )
                                    )
                                |> List.reverse
                                |> sanitizeMarkers
                    in
                    Expect.all
                        [ \ledger -> Expect.equal maxTopicReadEntries (List.length ledger)
                        , \ledger ->
                            ledger
                                |> List.head
                                |> Maybe.map .lastReadAt
                                |> Expect.equal (Just 500)
                        , \ledger ->
                            ledger
                                |> List.reverse
                                |> List.head
                                |> Maybe.map .lastReadAt
                                |> Expect.equal (Just 12)
                        ]
                        entries
            , test "orders equal timestamps by channel then topic" <|
                \_ ->
                    sanitizeMarkers
                        [ marker "#z" "z" "m2" 9999
                        , marker "#a" "z" "m2" 9999
                        , marker "#a" "a" "m2" 9999
                        ]
                        |> List.map (\m -> m.channel ++ "/" ++ m.topic)
                        |> Expect.equal [ "#a/a", "#a/z", "#z/z" ]
            , test "ignores rows past the 4096 scan window even when newest" <|
                \_ ->
                    let
                        visible =
                            List.range 0 (maxTopicReadParseEntries - 1)
                                |> List.map (\index -> marker "#room" ("topic-" ++ String.fromInt index) ("m-" ++ String.fromInt index) index)

                        beyond =
                            List.range maxTopicReadParseEntries (maxTopicReadParseEntries + 3)
                                |> List.map (\index -> marker "#room" ("late-" ++ String.fromInt index) ("late-" ++ String.fromInt index) 100000)

                        ledger =
                            sanitizeMarkers (visible ++ beyond)
                    in
                    Expect.all
                        [ \l -> Expect.equal False (List.any (\m -> m.lastReadAt == 100000) l)
                        , \l ->
                            l
                                |> List.head
                                |> Maybe.map .lastReadAt
                                |> Expect.equal (Just (maxTopicReadParseEntries - 1))
                        ]
                        ledger
            ]
        , describe "mark, merge, and clear"
            [ test "merges only advancing cursors" <|
                \_ ->
                    let
                        base =
                            markTopicRead "#room" "local newer" "local-30" 30 []
                                |> markTopicRead "#room" "import newer" "local-10" 10
                                |> markTopicRead "#room" "same time" "local-exact" 20

                        result =
                            mergeTopicReadLedger
                                [ marker "#room" "local newer" "import-20" 20
                                , marker "#room" "import newer" "import-40" 40
                                , marker "#room" "same time" "import-ambiguous" 20
                                , marker "#room" "new topic" "import-50" 50
                                ]
                                base
                    in
                    Expect.all
                        [ \r -> Expect.equal { imported = 2, total = 4 } { imported = r.imported, total = r.total }
                        , \r -> Expect.equal (Just "local-30") (Maybe.map .lastReadMessageId (readTopicReadMarker "#room" "local newer" r.ledger))
                        , \r -> Expect.equal (Just "import-40") (Maybe.map .lastReadMessageId (readTopicReadMarker "#room" "import newer" r.ledger))
                        , \r -> Expect.equal (Just "local-exact") (Maybe.map .lastReadMessageId (readTopicReadMarker "#room" "same time" r.ledger))
                        , \r -> Expect.equal (Just "import-50") (Maybe.map .lastReadMessageId (readTopicReadMarker "#room" "new topic" r.ledger))
                        ]
                        result
            , test "does not move a topic backward, but uses a new id at the same timestamp" <|
                \_ ->
                    let
                        ledger =
                            markTopicRead "#room" "alpha" "newer" 200 []
                    in
                    Expect.all
                        [ \l ->
                            markTopicRead "#room" "alpha" "older" 100 l
                                |> readTopicReadMarker "#room" "alpha"
                                |> Maybe.map .lastReadMessageId
                                |> Expect.equal (Just "newer")
                        , \l ->
                            markTopicRead "#room" "alpha" "same-time-later" 200 l
                                |> readTopicReadMarker "#room" "alpha"
                                |> Maybe.map .lastReadMessageId
                                |> Expect.equal (Just "same-time-later")
                        ]
                        ledger
            , test "marks each topic at its latest non-system message in array order" <|
                \_ ->
                    markAllTopicsRead "#Room"
                        [ msg "a1" (Just "Alpha") 100
                        , msg "b1" (Just "Beta") 100
                        , msg "a2" (Just "alpha") 100
                        , sys "b-system" (Just "beta") 200
                        , msg "b2" (Just "BETA") 150
                        , msg "loose" Nothing 300
                        ]
                        []
                        |> Expect.equal
                            [ marker "#room" "beta" "b2" 150
                            , marker "#room" "alpha" "a2" 100
                            ]
            , test "only considers the bounded suffix when marking every topic" <|
                \_ ->
                    let
                        messages =
                            List.range 0 maxTopicReadMessages
                                |> List.map
                                    (\index ->
                                        msg ("m" ++ String.fromInt index)
                                            (Just
                                                (if index == 0 then
                                                    "too-old"

                                                 else
                                                    "visible"
                                                )
                                            )
                                            index
                                    )

                        ledger =
                            markAllTopicsRead "#room" messages []
                    in
                    Expect.all
                        [ \l -> Expect.equal Nothing (readTopicReadMarker "#room" "too-old" l)
                        , \l ->
                            readTopicReadMarker "#room" "visible" l
                                |> Maybe.map .lastReadMessageId
                                |> Expect.equal (Just ("m" ++ String.fromInt maxTopicReadMessages))
                        ]
                        ledger
            , test "clears one normalized channel without affecting another" <|
                \_ ->
                    let
                        ledger =
                            markTopicRead "#One" "alpha" "a" 10 []
                                |> markTopicRead "#one" "beta" "b" 20
                                |> markTopicRead "#two" "alpha" "c" 30

                        cleared =
                            clearChannelTopicReads " #ONE " ledger
                    in
                    Expect.all
                        [ \r -> Expect.equal 2 r.removed
                        , \r -> Expect.equal [ marker "#two" "alpha" "c" 30 ] r.ledger
                        , \_ -> Expect.equal { removed = 0, ledger = ledger } (clearChannelTopicReads "room" ledger)
                        ]
                        cleared
            ]
        , describe "countUnreadByTopic"
            [ test "uses exact marker ids so equal timestamps and interleaved topics stay ordered" <|
                \_ ->
                    countUnreadByTopic "#ROOM"
                        [ msg "a1" (Just "Alpha") 100
                        , msg "b1" (Just "Beta") 100
                        , msg "a2" (Just "alpha") 100
                        , msg "b2" (Just "beta") 100
                        , sys "a-system" (Just "alpha") 110
                        , msg "a3" (Just "ALPHA") 120
                        ]
                        [ marker "#room" "alpha" "a1" 100
                        , marker "#room" "beta" "b1" 100
                        ]
                        0
                        |> Expect.equalDicts (Dict.fromList [ ( "alpha", 2 ), ( "beta", 1 ) ])
            , test "keeps equal-time rows unread when an exact marker has left the window" <|
                \_ ->
                    countUnreadByTopic "#room"
                        [ msg "equal-a" (Just "alpha") 100
                        , msg "equal-b" (Just "alpha") 100
                        , msg "newer" (Just "alpha") 101
                        ]
                        [ marker "#room" "alpha" "missing" 100 ]
                        3
                        |> Expect.equalDicts (Dict.fromList [ ( "alpha", 3 ) ])
            , test "uses a caller boundary for uninitialized topics and clamps an unsafe boundary" <|
                \_ ->
                    let
                        messages =
                            [ msg "a1" (Just "alpha") 10
                            , msg "b1" (Just "beta") 20
                            , msg "a2" (Just "alpha") 30
                            , msg "b2" (Just "beta") 40
                            ]
                    in
                    Expect.all
                        [ \_ ->
                            countUnreadByTopic "#room" messages [] 2
                                |> Expect.equalDicts (Dict.fromList [ ( "alpha", 1 ), ( "beta", 1 ) ])
                        , \_ ->
                            countUnreadByTopic "#room" messages [] -1
                                |> Expect.equalDicts Dict.empty
                        ]
                        ()
            , test "ignores untagged, malformed, and system messages" <|
                \_ ->
                    countUnreadByTopic "#room"
                        [ msg "loose" Nothing 10
                        , msg "empty" (Just "") 20
                        , msg "bad-topic" (Just ("bad" ++ String.fromChar (Char.fromCode 1) ++ "topic")) 30
                        , sys "system" (Just "alpha") 40
                        , msg "visible" (Just "alpha") 50
                        , msg "" (Just "alpha") 60
                        ]
                        []
                        0
                        |> Expect.equalDicts (Dict.fromList [ ( "alpha", 1 ) ])
            ]
        , describe "projectRoomTopicUnread"
            [ test "aggregates named and untagged unread rows against their correct boundaries" <|
                \_ ->
                    let
                        result =
                            projectRoomTopicUnread "#ROOM"
                                [ msg "a-read" (Just "Alpha") 100
                                , msg "loose-read" Nothing 100
                                , msg "b-unread" (Just "Beta") 100
                                , hl "loose-unread" Nothing 110
                                , hl "a-unread" (Just "ALPHA") 120
                                , { id = "excluded", topic = Just "beta", at = 130, system = True, highlight = True }
                                ]
                                [ marker "#room" "alpha" "a-read" 100 ]
                                2
                    in
                    Expect.all
                        [ \r -> Expect.equalDicts (Dict.fromList [ ( "beta", 1 ), ( "alpha", 1 ) ]) r.unreadByTopic
                        , \r -> Expect.equal 1 r.untaggedUnread
                        , \r -> Expect.equal 3 r.totalUnread
                        , \r -> Expect.equal 2 r.highlightCount
                        , \r -> Expect.equal (Just "b-unread") r.earliestUnreadMessageId
                        ]
                        result
            , test "uses exact ids and source order to disambiguate equal-time topic rows" <|
                \_ ->
                    let
                        result =
                            projectRoomTopicUnread "#ROOM"
                                [ msg "a1" (Just "alpha") 100
                                , msg "b1" (Just "beta") 100
                                , msg "a2" (Just "alpha") 100
                                , msg "b2" (Just "beta") 100
                                ]
                                [ marker "#room" "alpha" "a1" 100
                                , marker "#room" "beta" "b1" 100
                                ]
                                0
                    in
                    Expect.all
                        [ \r -> Expect.equalDicts (Dict.fromList [ ( "alpha", 1 ), ( "beta", 1 ) ]) r.unreadByTopic
                        , \r -> Expect.equal 2 r.totalUnread
                        , \r -> Expect.equal (Just "a2") r.earliestUnreadMessageId
                        ]
                        result
            , test "keeps equal-time rows unread when an exact marker has left the window" <|
                \_ ->
                    let
                        result =
                            projectRoomTopicUnread "#ROOM"
                                [ msg "same-a" (Just "alpha") 100
                                , msg "same-b" (Just "alpha") 100
                                , msg "newer" (Just "alpha") 101
                                ]
                                [ marker "#room" "alpha" "missing" 100 ]
                                0
                    in
                    Expect.all
                        [ \r -> Expect.equalDicts (Dict.fromList [ ( "alpha", 3 ) ]) r.unreadByTopic
                        , \r -> Expect.equal 3 r.totalUnread
                        , \r -> Expect.equal (Just "same-a") r.earliestUnreadMessageId
                        ]
                        result
            , test "keeps the room boundary as a lower bound when a topic marker is older" <|
                \_ ->
                    let
                        result =
                            projectRoomTopicUnread "#ROOM"
                                [ msg "a-read-marker" (Just "alpha") 100
                                , hl "a-after-marker-before-room" (Just "alpha") 110
                                , msg "room-boundary" Nothing 120
                                , hl "a-after-room" (Just "alpha") 130
                                ]
                                [ marker "#room" "alpha" "a-read-marker" 100 ]
                                2
                    in
                    Expect.all
                        [ \r -> Expect.equalDicts (Dict.fromList [ ( "alpha", 1 ) ]) r.unreadByTopic
                        , \r -> Expect.equal 1 r.untaggedUnread
                        , \r -> Expect.equal 2 r.totalUnread
                        , \r -> Expect.equal 1 r.highlightCount
                        , \r -> Expect.equal (Just "room-boundary") r.earliestUnreadMessageId
                        ]
                        result
            , test "fails closed for malformed rows, channels, and boundaries" <|
                \_ ->
                    let
                        messages =
                            [ msg "before-boundary" Nothing 10
                            , sys "predicate-throws" (Just "alpha") 20
                            , { id = "highlight-throws", topic = Just "alpha", at = 30, system = False, highlight = False }
                            , msg "untagged" (Just "") 40
                            , msg "bad-topic" (Just ("bad" ++ String.fromChar (Char.fromCode 1) ++ "topic")) 50
                            , msg "bad-time" (Just "alpha") -1
                            ]

                        markers =
                            parse
                                (Encode.list identity
                                    [ rawMarker "#room" "alpha" "" 20
                                    , rawMarker "#room" "alpha" "old" -1
                                    ]
                                )

                        result =
                            projectRoomTopicUnread "#room" messages markers 0
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] markers
                        , \r ->
                            Expect.equal
                                { unreadByTopic = Dict.fromList [ ( "alpha", 1 ) ]
                                , untaggedUnread = 1
                                , totalUnread = 2
                                , highlightCount = 0
                                , earliestUnreadMessageId = Just "before-boundary"
                                }
                                r
                        , \_ ->
                            projectRoomTopicUnread "#room" messages [] -1
                                |> Expect.equal
                                    { unreadByTopic = Dict.empty
                                    , untaggedUnread = 0
                                    , totalUnread = 0
                                    , highlightCount = 0
                                    , earliestUnreadMessageId = Nothing
                                    }
                        , \_ ->
                            projectRoomTopicUnread "room" messages [] 0
                                |> Expect.equal
                                    { unreadByTopic = Dict.empty
                                    , untaggedUnread = 0
                                    , totalUnread = 0
                                    , highlightCount = 0
                                    , earliestUnreadMessageId = Nothing
                                    }
                        ]
                        result
            , test "bounds the projection to the newest message suffix" <|
                \_ ->
                    let
                        messages =
                            List.range 0 maxTopicReadMessages
                                |> List.map (\index -> msg ("m" ++ String.fromInt index) Nothing index)

                        result =
                            projectRoomTopicUnread "#room" messages [] 0
                    in
                    Expect.all
                        [ \r -> Expect.equal maxTopicReadMessages r.untaggedUnread
                        , \r -> Expect.equal maxTopicReadMessages r.totalUnread
                        , \r -> Expect.equal (Just "m1") r.earliestUnreadMessageId
                        ]
                        result
            ]
        ]
