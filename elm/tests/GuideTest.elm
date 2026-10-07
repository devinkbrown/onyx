module GuideTest exposing (suite)

{-| First-room plan parity vectors, mirroring
`src/lib/guides/progress.test.ts` and
`src/lib/guides/roomStarter.test.ts`. Storage I/O stays ports-side;
these cover the allowlist boundary, the summary, the route states,
and the local text handoff.
-}

import Expect
import Guides exposing (..)
import Test exposing (Test, describe, test)


steps : List { id : String, title : String }
steps =
    [ { id = "join", title = "Join a room" }
    , { id = "invite", title = "Invite a friend" }
    , { id = "messages", title = "Messages and private DMs" }
    ]


stepIds : List String
stepIds =
    [ "join", "invite", "messages" ]


suite : Test
suite =
    describe "Guides"
        [ describe "progressSummary"
            [ test "keeps only known completed steps and names the next one" <|
                \_ ->
                    let
                        summary =
                            progressSummary stepIds [ "invite", "unknown" ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal 1 summary.complete
                        , \_ -> Expect.equal 3 summary.total
                        , \_ -> Expect.equal (Just "join") summary.nextId
                        , \_ -> Expect.equal False summary.done
                        ]
                        ()
            , test "reports completion only when every step is complete" <|
                \_ ->
                    let
                        summary =
                            progressSummary stepIds stepIds
                    in
                    Expect.all
                        [ \_ -> Expect.equal 3 summary.complete
                        , \_ -> Expect.equal Nothing summary.nextId
                        , \_ -> Expect.equal True summary.done
                        ]
                        ()
            , test "filter keeps allowlisted ids in step order" <|
                \_ ->
                    Expect.equal [ "join", "messages" ] (filterProgressIds stepIds [ "messages", "unknown", "join", "join" ])
            ]
        , describe "buildRoomStarterRoute"
            [ test "keeps source order with one current start" <|
                \_ ->
                    Expect.equal
                        [ { id = "join", title = "Join a room", number = 1, state = "done", stateLabel = "Done" }
                        , { id = "invite", title = "Invite a friend", number = 2, state = "current", stateLabel = "Start here" }
                        , { id = "messages", title = "Messages and private DMs", number = 3, state = "later", stateLabel = "Then" }
                        ]
                        (buildRoomStarterRoute steps [ "join" ])
            , test "all done invents no current step" <|
                \_ ->
                    let
                        route =
                            buildRoomStarterRoute steps stepIds
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "done", "done", "done" ] (List.map .state route)
                        , \_ -> Expect.equal [] (List.filter (\step -> step.state == "current") route)
                        ]
                        ()
            ]
        , describe "buildRoomStarterExport"
            [ test "deterministic local-only handoff" <|
                \_ ->
                    let
                        text =
                            buildRoomStarterExport steps [ "join" ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (String.contains "Onyx first-room plan" text)
                        , \_ -> Expect.equal True (String.contains "Made in this browser. This plan is not sent anywhere." text)
                        , \_ -> Expect.equal True (String.contains "1. Join a room — Done" text)
                        , \_ -> Expect.equal True (String.contains "2. Invite a friend — Start here" text)
                        , \_ -> Expect.equal True (String.contains "- Direct messages are one-to-one. If a private message cannot open, it stays locked instead of turning into plain text." text)
                        , \_ -> Expect.equal False (String.contains "https://" text)
                        , \_ -> Expect.equal False (String.contains "http://" text)
                        , \_ -> Expect.equal text (buildRoomStarterExport steps [ "join" ])
                        ]
                        ()
            , test "visible safety notes use the guide call wording" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 5 (List.length safetyNotes)
                        , \_ -> Expect.equal False (List.member "Calls are opt-in and are not recorded." safetyNotes)
                        , \_ ->
                            Expect.equal True
                                (List.member "Calls are opt-in. Onyx does not automatically record calls. Participants can choose local recording of their own audio when supported." safetyNotes)
                        , \_ -> Expect.equal "onyx-first-room-plan.txt" roomStarterExportFilename
                        , \_ -> Expect.equal "onyx:guides-progress-v1" guideProgressStorageKey
                        ]
                        ()
            ]
        ]
