module OperFeedTest exposing (suite)

{-| v3/gap-oper — the live Event Spine feed: wire folds from the
daemon's real line shapes (`event_spine.zig renderEventTagged`,
`observe.zig`, `oper_cmd.zig handleAudit`) and the bounded / rate-limited
/ pausable / filterable ring.
-}

import Expect
import OperFeed exposing (Draft, Feed, Kind(..))
import Set
import Test exposing (Test, describe, test)
import Wire


parse : String -> Maybe Draft
parse line =
    OperFeed.parseEvent (Wire.parseIrcMessage line)


draft : String -> String -> String -> Draft
draft category severity text =
    { category = category, severity = severity, origin = "n1.test", text = text, kind = CategoryEvent, eventId = Nothing }


pushAll : Float -> List Draft -> Feed -> Feed
pushAll at drafts feed =
    List.foldl (OperFeed.push at) feed drafts


texts : Feed -> List String
texts feed =
    List.map .text (OperFeed.visible feed)


suite : Test
suite =
    describe "v3/gap-oper OperFeed"
        [ describe "wire folds"
            [ test "a tagged category event keeps category and severity from the tags" <|
                \_ ->
                    case parse "@onyx_server.io/category=FLOOD;onyx_server.io/severity=warn :onyx.test EVENT root FLOOD possible raid on #lounge: join rate exceeded, throttling new joins" of
                        Just d ->
                            Expect.equal
                                ( ( "FLOOD", "warn" ), ( "onyx.test", "possible raid on #lounge: join rate exceeded, throttling new joins" ) )
                                ( ( d.category, d.severity ), ( d.origin, d.text ) )


                        Nothing ->
                            Expect.fail "expected a draft"
            , test "stable message ids and server time tags do not break the category" <|
                \_ ->
                    case parse "@time=2026-10-10T10:00:00.000Z;msgid=ab12cd;onyx_server.io/category=KILL;onyx_server.io/severity=notice :n2.test EVENT root KILL root killed bob (spam)" of
                        Just d ->
                            Expect.equal ( "KILL", Just "ab12cd", "n2.test" ) ( d.category, d.eventId, d.origin )

                        Nothing ->
                            Expect.fail "expected a draft"
            , test "without message-tags the category is the leading token" <|
                \_ ->
                    Expect.equal
                        (Just ( "SECURITY", "notice", "login failed for bob" ))
                        (parse ":n1.test EVENT root SECURITY login failed for bob"
                            |> Maybe.map (\d -> ( d.category, d.severity, d.text ))
                        )
            , test "an unknown severity tag reads as notice" <|
                \_ ->
                    Expect.equal (Just "notice")
                        (parse "@onyx_server.io/category=SPAM;onyx_server.io/severity=loud :n1 EVENT root SPAM x" |> Maybe.map .severity)
            , test "EVENT BROADCAST arrives as an ANNOUNCE row" <|
                \_ ->
                    case parse "@onyx_server.io/category=ANNOUNCE;onyx_server.io/severity=notice :n1.test EVENT root root!r@h.example: maintenance at 03:00 UTC" of
                        Just d ->
                            Expect.equal ( "ANNOUNCE", AnnounceEvent, "root!r@h.example: maintenance at 03:00 UTC" ) ( d.category, d.kind, d.text )

                        Nothing ->
                            Expect.fail "expected a draft"
            , test "OBSERVE pushes read as a person and an action" <|
                \_ ->
                    Expect.equal
                        [ Just "bob!~b@10.0.0.4 · connect · acct=bob"
                        , Just "bob!~b@10.0.0.4 · nick · acct=* -> robert"
                        , Just "Watching *!*@x"
                        , Just "Watch mask *!*@x"
                        , Just "n!u@h is online · acct=*"
                        ]
                        (List.map (Maybe.map .text << parse)
                            [ ":onyx.local EVENT kain OBSERVE connect bob!~b@10.0.0.4 acct=bob"
                            , ":onyx.local EVENT kain OBSERVE nick bob!~b@10.0.0.4 acct=* -> robert"
                            , ":onyx.local EVENT kain OBSERVE watching *!*@x"
                            , ":onyx.local EVENT kain OBSERVE filter *!*@x"
                            , ":onyx.local EVENT kain OBSERVE present n!u@h acct=*"
                            ]
                        )
            , test "AUDIT rows fold oper, action, target, proof and reason" <|
                \_ ->
                    Expect.equal
                        (Just ( "AUDIT", AuditEvent, "#5 root SHUN *!*@bad.example (proof ab12) — spam wave" ))
                        (parse ":onyx.test EVENT root AUDIT #5 root SHUN *!*@bad.example proof=ab12 :spam wave"
                            |> Maybe.map (\d -> ( d.category, d.kind, d.text ))
                        )
            , test "the MEDIA and WEBAUTHN planes belong to other folds" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing ]
                        [ parse ":s EVENT me MEDIA JOIN #c alice"
                        , parse ":s EVENT me WEBAUTHN REGISTER challenge"
                        ]
            , test "an untagged body that names no operator plane is ignored" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing ]
                        [ parse ":s EVENT me MEMBER JOIN #c alice"
                        , parse ":s EVENT me"
                        ]
            , test "other commands are not events" <|
                \_ -> Expect.equal Nothing (parse ":s NOTICE me :FLOOD something")
            , test "a very long body is bounded" <|
                \_ ->
                    case parse (":s EVENT me FLOOD " ++ String.repeat 900 "x") of
                        Just d ->
                            Expect.atMost 600 (String.length d.text)

                        Nothing ->
                            Expect.fail "expected a draft"
            ]
        , describe "ring"
            [ test "is bounded to maxEntries, oldest rows fall off" <|
                \_ ->
                    let
                        feed =
                            List.foldl
                                (\i f -> OperFeed.push (toFloat i * 2000) (draft "KILL" "warn" ("row " ++ String.fromInt i)) f)
                                OperFeed.empty
                                (List.range 1 (OperFeed.maxEntries + 25))
                    in
                    Expect.all
                        [ \f -> Expect.equal OperFeed.maxEntries (List.length f.entries)
                        , \f -> Expect.equal (Just ("row " ++ String.fromInt (OperFeed.maxEntries + 25))) (Maybe.map .text (List.head f.entries))
                        ]
                        feed
            , test "newest row comes first" <|
                \_ ->
                    Expect.equal [ "b", "a" ]
                        (OperFeed.empty
                            |> OperFeed.push 1000 (draft "KILL" "warn" "a")
                            |> OperFeed.push 9000 (draft "KILL" "warn" "b")
                            |> texts
                        )
            , test "an identical row within the repeat window collapses to a counter" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "FLOOD" "notice" "possible raid")
                                |> OperFeed.push 1500 (draft "FLOOD" "notice" "possible raid")
                                |> OperFeed.push 2000 (draft "FLOOD" "notice" "possible raid")
                    in
                    Expect.equal [ ( "possible raid", 3 ) ] (List.map (\e -> ( e.text, e.repeat )) (OperFeed.visible feed))
            , test "an identical row long after the first is a new line" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "FLOOD" "notice" "possible raid")
                                |> OperFeed.push 20000 (draft "FLOOD" "notice" "possible raid")
                    in
                    Expect.equal 2 (List.length (OperFeed.visible feed))
            , test "the same server event id is stored once" <|
                \_ ->
                    let
                        d =
                            { category = "KILL", severity = "warn", origin = "n1", text = "x", kind = CategoryEvent, eventId = Just "abc" }
                    in
                    Expect.equal 1
                        (OperFeed.empty
                            |> OperFeed.push 1000 d
                            |> OperFeed.push 90000 d
                            |> OperFeed.visible
                            |> List.length
                        )
            ]
        , describe "rate limit"
            [ test "low-severity rows past the window budget are counted, not stored" <|
                \_ ->
                    let
                        rows =
                            List.map (\i -> draft "CONNECT" "info" ("user " ++ String.fromInt i)) (List.range 1 (OperFeed.admitPerWindow + 10))

                        feed =
                            pushAll 5000 rows OperFeed.empty
                    in
                    Expect.equal ( OperFeed.admitPerWindow, 10 ) ( List.length (OperFeed.visible feed), OperFeed.droppedCount feed )
            , test "warn and above always pass the limiter" <|
                \_ ->
                    let
                        quiet =
                            List.map (\i -> draft "CONNECT" "info" ("user " ++ String.fromInt i)) (List.range 1 (OperFeed.admitPerWindow + 5))

                        feed =
                            pushAll 5000 (quiet ++ [ draft "KILL" "warn" "killed bob", draft "ERROR" "critical" "disk full" ]) OperFeed.empty
                    in
                    Expect.equal [ "disk full", "killed bob" ] (List.take 2 (texts feed))
            , test "a new window admits again" <|
                \_ ->
                    let
                        rows =
                            List.map (\i -> draft "CONNECT" "info" ("user " ++ String.fromInt i)) (List.range 1 (OperFeed.admitPerWindow + 3))

                        feed =
                            OperFeed.empty
                                |> pushAll 5000 rows
                                |> OperFeed.push (5000 + OperFeed.windowMs + 1) (draft "CONNECT" "info" "late")
                    in
                    Expect.equal (Just "late") (List.head (texts feed))
            ]
        , describe "pause"
            [ test "pausing freezes the visible rows and counts the held ones" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "KILL" "warn" "before")
                                |> OperFeed.pause
                                |> OperFeed.push 9000 (draft "KILL" "warn" "after one")
                                |> OperFeed.push 17000 (draft "KILL" "warn" "after two")
                    in
                    Expect.equal ( [ "before" ], 2, True ) ( texts feed, OperFeed.heldCount feed, OperFeed.isPaused feed )
            , test "resume releases the held rows" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "KILL" "warn" "before")
                                |> OperFeed.pause
                                |> OperFeed.push 9000 (draft "KILL" "warn" "after")
                                |> OperFeed.resume
                    in
                    Expect.equal ( [ "after", "before" ], 0, False ) ( texts feed, OperFeed.heldCount feed, OperFeed.isPaused feed )
            , test "identical rows do not collapse into a frozen view" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "FLOOD" "notice" "same")
                                |> OperFeed.pause
                                |> OperFeed.push 1500 (draft "FLOOD" "notice" "same")
                    in
                    Expect.equal ( 1, 1 ) ( List.length (OperFeed.visible feed), OperFeed.heldCount feed )
            , test "clearing a paused feed stays paused with nothing held" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "KILL" "warn" "a")
                                |> OperFeed.pause
                                |> OperFeed.push 9000 (draft "KILL" "warn" "b")
                                |> OperFeed.clear
                    in
                    Expect.equal ( [], 0, True ) ( texts feed, OperFeed.heldCount feed, OperFeed.isPaused feed )
            , test "clear resets the dropped counter and keeps the filter" <|
                \_ ->
                    let
                        filter =
                            { categories = Set.singleton "KILL", minSeverity = "", text = "" }

                        rows =
                            List.map (\i -> draft "CONNECT" "info" (String.fromInt i)) (List.range 1 (OperFeed.admitPerWindow + 4))

                        feed =
                            OperFeed.empty |> OperFeed.setFilter filter |> pushAll 5000 rows |> OperFeed.clear
                    in
                    Expect.equal ( 0, filter ) ( OperFeed.droppedCount feed, feed.filter )
            ]
        , describe "filter"
            [ test "by category set" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "KILL" "warn" "k")
                                |> OperFeed.push 9000 (draft "FLOOD" "warn" "f")
                                |> OperFeed.push 17000 (draft "SPAM" "warn" "s")
                                |> OperFeed.setFilter { categories = Set.fromList [ "KILL", "SPAM" ], minSeverity = "", text = "" }
                    in
                    Expect.equal [ "s", "k" ] (texts feed)
            , test "by minimum severity" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "KILL" "info" "quiet")
                                |> OperFeed.push 9000 (draft "KILL" "error" "loud")
                                |> OperFeed.setFilter { categories = Set.empty, minSeverity = "warn", text = "" }
                    in
                    Expect.equal [ "loud" ] (texts feed)
            , test "by text, case-insensitively, across origin and category" <|
                \_ ->
                    let
                        feed =
                            OperFeed.empty
                                |> OperFeed.push 1000 (draft "KILL" "warn" "Killed BadActor")
                                |> OperFeed.push 9000 (draft "FLOOD" "warn" "raid on #lounge")
                                |> OperFeed.setFilter { categories = Set.empty, minSeverity = "", text = "  badactor " }
                    in
                    Expect.equal [ "Killed BadActor" ] (texts feed)
            , test "a blank filter is inactive and shows everything" <|
                \_ ->
                    Expect.equal ( False, True ) ( OperFeed.filterIsActive OperFeed.blankFilter, OperFeed.filterIsActive { categories = Set.empty, minSeverity = "warn", text = "" } )
            ]
        ]
