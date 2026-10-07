module EventReplayTest exposing (suite)

{-| Vectors ported from `src/lib/irc/eventReplayJson.test.ts`. The
`same-reference` no-op check becomes structural equality in Elm.
-}

import EventReplay exposing (..)
import Expect
import Test exposing (Test, describe, test)


sampleTs : Float
sampleTs =
    1720000000000


{-| JSON `\u00XX` escape as six ASCII chars (avoids raw controls, which
JSON forbids, and source-level `\u` escapes). -}
jsonEscape : Int -> String
jsonEscape code =
    String.fromChar (Char.fromCode 92) ++ "u00" ++ String.fromChar (hexChar (code // 16)) ++ String.fromChar (hexChar (modBy 16 code))


hexChar : Int -> Char
hexChar d =
    if d < 10 then
        Char.fromCode (0x30 + d)

    else
        Char.fromCode (0x61 + d - 10)


suite : Test
suite =
    describe "EventReplay"
        [ test "parses header, event, and end objects" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal (Just (StreamStart { count = 2, severityFloor = "warn" }))
                            (parseEventReplayNotice "{\"type\":\"event-replay\",\"count\":2,\"severity_floor\":\"warn\"}")
                    , \_ ->
                        Expect.equal
                            (Just
                                (StreamEvent
                                    { ts = sampleTs
                                    , category = "kill"
                                    , categoryCode = "KILL"
                                    , severity = "warn"
                                    , origin = "node-a"
                                    , message = "killed badactor"
                                    }
                                )
                            )
                            (parseEventReplayNotice
                                ("{\"type\":\"event\",\"ts\":"
                                    ++ String.fromFloat sampleTs
                                    ++ ",\"category\":\"kill\",\"category_code\":\"KILL\",\"severity\":\"warn\",\"origin\":\"node-a\",\"message\":\"killed badactor\"}"
                                )
                            )
                    , \_ ->
                        Expect.equal (Just (StreamEnd { count = 2 }))
                            (parseEventReplayNotice "{\"type\":\"event-replay-end\",\"count\":2}")
                    ]
                    ()
        , test "rejects hostile or malformed payloads" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (parseEventReplayNotice "")
                    , \_ -> Expect.equal Nothing (parseEventReplayNotice "Event replay: 2 event(s)")
                    , \_ -> Expect.equal Nothing (parseEventReplayNotice "{not json}")
                    , \_ -> Expect.equal Nothing (parseEventReplayNotice "{\"type\":\"event-stats\"}")
                    , \_ -> Expect.equal Nothing (parseEventReplayNotice "{\"type\":\"event\",\"ts\":\"nope\"}")
                    , \_ ->
                        -- Control chars inside values collapse to one space.
                        Expect.equal (Just "y z")
                            (case
                                parseEventReplayNotice
                                    ("{\"type\":\"event\",\"ts\":"
                                        ++ String.fromFloat sampleTs
                                        ++ ",\"category\":\"kill\",\"severity\":\"warn\",\"origin\":\"x\",\"message\":\"y"
                                        ++ jsonEscape 0
                                        ++ "z\"}"
                                    )
                             of
                                Just (StreamEvent e) ->
                                    Just e.message

                                _ ->
                                    Nothing
                            )
                    , \_ ->
                        -- Control-only message after strip fails closed.
                        Expect.equal Nothing
                            (parseEventReplayNotice
                                ("{\"type\":\"event\",\"ts\":"
                                    ++ String.fromFloat sampleTs
                                    ++ ",\"category\":\"kill\",\"severity\":\"warn\",\"origin\":\"x\",\"message\":\""
                                    ++ jsonEscape 0
                                    ++ jsonEscape 1
                                    ++ "\"}"
                                )
                            )
                    , \_ ->
                        Expect.equal Nothing
                            (parseEventReplayNotice
                                "{\"type\":\"event\",\"ts\":1,\"category\":\"kill\",\"severity\":\"warn\",\"origin\":\"x\",\"message\":\"y\"}"
                            )
                    , \_ ->
                        Expect.equal Nothing
                            (parseEventReplayNotice
                                ("{\"type\":\"event-replay\",\"count\":1,\"severity_floor\":\"" ++ String.repeat 1200 "x" ++ "\"}")
                            )
                    ]
                    ()
        , test "derives category_code when omitted" <|
            \_ ->
                Expect.equal (Just "FLOOD")
                    (case
                        parseEventReplayNotice
                            ("{\"type\":\"event\",\"ts\":"
                                ++ String.fromFloat sampleTs
                                ++ ",\"category\":\"flood\",\"severity\":\"info\",\"origin\":\"n1\",\"message\":\"burst\"}"
                            )
                     of
                        Just (StreamEvent e) ->
                            Just e.categoryCode

                        _ ->
                            Nothing
                    )
        , test "folds a full stream into a completed feed" <|
            \_ ->
                let
                    f0 =
                        emptyEventReplayFeed

                    f1 =
                        applyEventReplayNotice f0 "{\"type\":\"event-replay\",\"count\":1,\"severity_floor\":\"debug\"}" sampleTs

                    f2 =
                        applyEventReplayNotice f1
                            ("{\"type\":\"event\",\"ts\":"
                                ++ String.fromFloat sampleTs
                                ++ ",\"category\":\"security\",\"category_code\":\"SECURITY\",\"severity\":\"error\",\"origin\":\"edge\",\"message\":\"throttle\"}"
                            )
                            sampleTs

                    f3 =
                        applyEventReplayNotice f2 "{\"type\":\"event-replay-end\",\"count\":1}" sampleTs
                in
                Expect.all
                    [ \_ -> Expect.equal True f1.pending
                    , \_ -> Expect.equal (Just 1) f1.expectedCount
                    , \_ -> Expect.equal True f3.complete
                    , \_ -> Expect.equal False f3.pending
                    , \_ -> Expect.equal 1 (List.length f3.events)
                    , \_ -> Expect.equal (Just "SECURITY") (Maybe.map .categoryCode (List.head f3.events))
                    ]
                    ()
        , test "leaves unrelated text as a structural no-op" <|
            \_ ->
                Expect.equal emptyEventReplayFeed
                    (applyEventReplayNotice emptyEventReplayFeed "hello" sampleTs)
        , test "builds clamped EVENT REPLAY JSON ALL params" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ "REPLAY", "JSON", "ALL", "50" ] (eventReplayJsonParams 50)
                    , \_ -> Expect.equal [ "REPLAY", "JSON", "ALL", "1" ] (eventReplayJsonParams 0)
                    , \_ -> Expect.equal [ "REPLAY", "JSON", "ALL", "200" ] (eventReplayJsonParams 999)
                    ]
                    ()
        , test "formats a compact row label" <|
            \_ ->
                Expect.equal "[5m ago] KILL/warn <node-a> killed badactor"
                    (formatEventReplayEvent
                        { ts = sampleTs - 5 * 60000
                        , category = "kill"
                        , categoryCode = "KILL"
                        , severity = "warn"
                        , origin = "node-a"
                        , message = "killed badactor"
                        }
                        sampleTs
                    )
        ]
