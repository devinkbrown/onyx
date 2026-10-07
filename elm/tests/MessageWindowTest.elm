module MessageWindowTest exposing (suite)

{-| Mirror vectors for `MessageWindow` over the oracle
`src/shell/messageWindow.test.ts` pure suites: trailing slices,
two-sided anchor pages, explicit paging, tail/aria-live signals,
and fail-closed hardening. Rendering/paging state stays ahead;
this pins the math only.
-}

import Expect
import MessageWindow exposing (..)
import Test exposing (Test, describe, test)


plain : Float -> Float -> WindowInput
plain total size =
    { total = total, windowSize = size, anchorIndex = Nothing, anchorContext = Nothing, pageStart = Nothing }


expectConserved : MessageWindow -> Int -> Int -> Expect.Expectation
expectConserved w total capacity =
    Expect.all
        [ \_ -> Expect.atLeast 0 w.start
        , \_ -> Expect.atLeast w.start w.end
        , \_ -> Expect.atMost total w.end
        , \_ -> Expect.equal w.start w.hiddenBefore
        , \_ -> Expect.equal (total - w.end) w.hiddenAfter
        , \_ -> Expect.equal (w.end - w.start) w.rendered
        , \_ -> Expect.equal total (w.hiddenBefore + w.rendered + w.hiddenAfter)
        , \_ -> Expect.atMost capacity w.rendered
        ]
        ()


suite : Test
suite =
    describe "MessageWindow"
        [ describe "computeMessageWindow"
            [ test "renders the whole list when it is smaller than the window" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow (plain 10 120)
                    in
                    Expect.all
                        [ \_ -> Expect.equal 0 w.start
                        , \_ -> Expect.equal 10 w.end
                        , \_ -> Expect.equal 0 w.hiddenBefore
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        , \_ -> Expect.equal 10 w.rendered
                        ]
                        ()
            , test "renders the whole list at the exact window boundary" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow (plain 120 120)
                    in
                    Expect.all
                        [ \_ -> Expect.equal 0 w.start
                        , \_ -> Expect.equal 0 w.hiddenBefore
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        , \_ -> Expect.equal 120 w.rendered
                        ]
                        ()
            , test "keeps only the trailing window when the list is larger" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow (plain 500 120)
                    in
                    Expect.all
                        [ \_ -> Expect.equal 380 w.start
                        , \_ -> Expect.equal 500 w.end
                        , \_ -> Expect.equal 380 w.hiddenBefore
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        , \_ -> Expect.equal 120 w.rendered
                        ]
                        ()
            , test "handles an empty list" <|
                \_ ->
                    Expect.equal empty (computeMessageWindow (plain 0 120))
            , test "fails closed to the default capacity when windowSize is Infinity" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow (plain 5000 (1 / 0))
                    in
                    Expect.all
                        [ \_ -> Expect.equal (5000 - defaultWindowSize) w.start
                        , \_ -> Expect.equal 5000 w.end
                        , \_ -> Expect.equal (5000 - defaultWindowSize) w.hiddenBefore
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        , \_ -> Expect.equal defaultWindowSize w.rendered
                        ]
                        ()
            , test "leaves the trailing window untouched when the anchor already falls inside it" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Just 450, anchorContext = Nothing, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 380 w.start
                        , \_ -> Expect.equal 500 w.end
                        , \_ -> Expect.equal 380 w.hiddenBefore
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        ]
                        ()
            , test "switches to a two-sided bounded page for an anchor above the trailing slice" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Just 100, anchorContext = Nothing, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (100 - defaultAnchorContext) w.start
                        , \_ -> Expect.equal (100 - defaultAnchorContext + 120) w.end
                        , \_ -> Expect.equal (100 - defaultAnchorContext) w.hiddenBefore
                        , \_ -> Expect.equal (500 - w.end) w.hiddenAfter
                        , \_ -> Expect.equal 120 w.rendered
                        , \_ -> Expect.atLeast w.start 100
                        , \_ -> Expect.lessThan w.end 100
                        ]
                        ()
            , test "clamps the two-sided page to zero when the anchor is near the top" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Just 3, anchorContext = Nothing, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 0 w.start
                        , \_ -> Expect.equal 120 w.end
                        , \_ -> Expect.equal 0 w.hiddenBefore
                        , \_ -> Expect.equal 380 w.hiddenAfter
                        , \_ -> Expect.atLeast w.start 3
                        , \_ -> Expect.lessThan w.end 3
                        ]
                        ()
            , test "honours a custom anchor context without exceeding capacity" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Just 200, anchorContext = Just 50, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 150 w.start
                        , \_ -> Expect.equal 270 w.end
                        , \_ -> Expect.equal 120 w.rendered
                        , \_ -> Expect.equal 230 w.hiddenAfter
                        ]
                        ()
            , test "ignores a null or negative anchor" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 380 (computeMessageWindow (plain 500 120)).start
                        , \_ ->
                            Expect.equal 380
                                (computeMessageWindow
                                    { total = 500, windowSize = 120, anchorIndex = Just -1, anchorContext = Nothing, pageStart = Nothing }
                                ).start
                        ]
                        ()
            , test "ignores an anchor at or past the end of the list" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal 380
                                (computeMessageWindow
                                    { total = 500, windowSize = 120, anchorIndex = Just 500, anchorContext = Nothing, pageStart = Nothing }
                                ).start
                        , \_ ->
                            Expect.equal 380
                                (computeMessageWindow
                                    { total = 500, windowSize = 120, anchorIndex = Just 999, anchorContext = Nothing, pageStart = Nothing }
                                ).start
                        ]
                        ()
            , test "never shrinks a trailing window to chase an in-tail anchor" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Just 490, anchorContext = Nothing, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 380 w.start
                        , \_ -> Expect.equal 500 w.end
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        ]
                        ()
            , test "fails closed to the default capacity when windowSize is non-positive" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow (plain 500 0)
                    in
                    Expect.all
                        [ \_ -> Expect.equal defaultWindowSize w.rendered
                        , \_ -> Expect.equal (500 - defaultWindowSize) w.start
                        , \_ -> Expect.equal 500 w.end
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        ]
                        ()
            ]
        , describe "bounded render cost at scale"
            [ test "caps rendered rows to the window on a very large channel (no anchor)" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow (plain 100000 120)
                    in
                    Expect.all
                        [ \_ -> Expect.equal 120 w.rendered
                        , \_ -> Expect.equal (100000 - 120) w.start
                        , \_ -> Expect.equal (100000 - 120) w.hiddenBefore
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        , \_ -> Expect.equal 100000 w.end
                        ]
                        ()
            , test "rendered never exceeds windowSize across a sweep of large totals" <|
                \_ ->
                    Expect.all
                        (List.map
                            (\total ->
                                \_ ->
                                    let
                                        w =
                                            computeMessageWindow (plain (toFloat total) 200)
                                    in
                                    Expect.all
                                        [ \_ -> expectConserved w total 200
                                        , \_ -> Expect.equal 200 w.rendered
                                        , \_ -> Expect.equal total w.end
                                        , \_ -> Expect.equal 0 w.hiddenAfter
                                        ]
                                        ()
                            )
                            [ 1000, 10000, 50000, 250000 ]
                        )
                        ()
            , test "a deep-history anchor stays a bounded two-sided page, not a tail extension" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 100000, windowSize = 120, anchorIndex = Just 40000, anchorContext = Nothing, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (40000 - defaultAnchorContext) w.start
                        , \_ -> Expect.equal (40000 - defaultAnchorContext + 120) w.end
                        , \_ -> Expect.equal 120 w.rendered
                        , \_ -> Expect.equal 100000 (w.hiddenBefore + w.rendered + w.hiddenAfter)
                        , \_ -> Expect.atLeast w.start 40000
                        , \_ -> Expect.lessThan w.end 40000
                        ]
                        ()
            , test "keeps the rendered ceiling for start, middle, and end anchors" <|
                \_ ->
                    Expect.all
                        (List.concatMap
                            (\total ->
                                let
                                    anchors =
                                        [ 0, 3, total // 2, total - 1, total - 5 ]

                                    tail =
                                        computeMessageWindow (plain (toFloat total) 120)
                                in
                                (\_ -> expectConserved tail total 120)
                                    :: (\_ -> Expect.equal total tail.end)
                                    :: (\_ -> Expect.equal 0 tail.hiddenAfter)
                                    :: List.map
                                        (\anchor ->
                                            \_ ->
                                                let
                                                    w =
                                                        computeMessageWindow
                                                            { total = toFloat total
                                                            , windowSize = 120
                                                            , anchorIndex = Just (toFloat anchor)
                                                            , anchorContext = Nothing
                                                            , pageStart = Nothing
                                                            }
                                                in
                                                Expect.all
                                                    [ \_ -> expectConserved w total 120
                                                    , \_ -> Expect.atLeast w.start anchor
                                                    , \_ -> Expect.lessThan w.end anchor
                                                    ]
                                                    ()
                                        )
                                        anchors
                            )
                            [ 10000, 100000, 250000 ]
                        )
                        ()
            , test "growing the window in steps stays a pure trailing slice until the ceiling" <|
                \_ ->
                    let
                        sizes =
                            List.map (\i -> 120 + i * 200) (List.range 0 3)

                        clamped =
                            computeMessageWindow (plain 10000 (toFloat (maxWindowRows + 400)))
                    in
                    Expect.all
                        ((\_ -> expectConserved clamped 10000 maxWindowRows)
                            :: (\_ -> Expect.equal maxWindowRows clamped.rendered)
                            :: (\_ -> Expect.equal 10000 clamped.end)
                            :: (\_ -> Expect.equal 0 clamped.hiddenAfter)
                            :: List.map
                                (\size ->
                                    \_ ->
                                        let
                                            w =
                                                computeMessageWindow (plain 10000 (toFloat size))
                                        in
                                        Expect.all
                                            [ \_ -> Expect.equal size w.rendered
                                            , \_ -> Expect.equal 10000 w.end
                                            , \_ -> Expect.equal 0 w.hiddenAfter
                                            , \_ -> Expect.equal (10000 - size) w.start
                                            ]
                                            ()
                                )
                                sizes
                        )
                        ()
            , test "reader-start / explicit pageStart is a bounded first page, not the whole list" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 250000, windowSize = 120, anchorIndex = Nothing, anchorContext = Nothing, pageStart = Just 0 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 0 w.start
                        , \_ -> Expect.equal 120 w.end
                        , \_ -> Expect.equal 0 w.hiddenBefore
                        , \_ -> Expect.equal (250000 - 120) w.hiddenAfter
                        , \_ -> Expect.equal 120 w.rendered
                        ]
                        ()
            , test "paging earlier from a mid-transcript page stays bounded and contiguous" <|
                \_ ->
                    let
                        first =
                            computeMessageWindow
                                { total = 10000, windowSize = 120, anchorIndex = Nothing, anchorContext = Nothing, pageStart = Just 4000 }

                        earlier =
                            computeMessageWindow
                                { total = 10000
                                , windowSize = 120
                                , anchorIndex = Nothing
                                , anchorContext = Nothing
                                , pageStart = Just (toFloat (max 0 (first.start - first.rendered)))
                                }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 4000 first.start
                        , \_ -> Expect.equal 4120 first.end
                        , \_ -> Expect.equal (10000 - 4120) first.hiddenAfter
                        , \_ -> Expect.equal 3880 earlier.start
                        , \_ -> Expect.equal 4000 earlier.end
                        , \_ -> Expect.equal 120 earlier.rendered
                        , \_ -> Expect.equal first.start earlier.end
                        , \_ -> expectConserved earlier 10000 120
                        ]
                        ()
            , test "a page that lands on the trailing slice snaps back to the live tail" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Nothing, anchorContext = Nothing, pageStart = Just 400 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 380 w.start
                        , \_ -> Expect.equal 500 w.end
                        , \_ -> Expect.equal 0 w.hiddenAfter
                        ]
                        ()
            , test "Infinity never mounts a huge list even with a start page requested" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 250000, windowSize = (1 / 0), anchorIndex = Nothing, anchorContext = Nothing, pageStart = Just 0 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal defaultWindowSize w.rendered
                        , \_ -> Expect.equal 0 w.start
                        , \_ -> Expect.equal defaultWindowSize w.end
                        , \_ -> Expect.equal (250000 - defaultWindowSize) w.hiddenAfter
                        ]
                        ()
            ]
        , describe "tail-append vs history-prepend signal (aria-live)"
            [ test "a new tail message keeps the window start flat once the window is full" <|
                \_ ->
                    let
                        before =
                            computeMessageWindow (plain 5000 120)

                        afterTail =
                            computeMessageWindow (plain 5001 120)
                    in
                    Expect.all
                        [ \_ -> Expect.equal (before.start + 1) afterTail.start
                        , \_ -> Expect.atLeast before.start afterTail.start
                        , \_ -> Expect.equal (before.end + 1) afterTail.end
                        , \_ -> Expect.equal 0 afterTail.hiddenAfter
                        ]
                        ()
            , test "a history prepend (anchor jump) LOWERS start so the effect can suppress it" <|
                \_ ->
                    let
                        tail =
                            computeMessageWindow (plain 5000 120)

                        jumped =
                            computeMessageWindow
                                { total = 5000, windowSize = 120, anchorIndex = Just 100, anchorContext = Nothing, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.lessThan tail.start jumped.start
                        , \_ -> Expect.lessThan tail.end jumped.end
                        , \_ -> Expect.greaterThan 0 jumped.hiddenAfter
                        ]
                        ()
            , test "a tail append on an anchored page does not grow rendered or move start" <|
                \_ ->
                    let
                        before =
                            computeMessageWindow
                                { total = 5000, windowSize = 120, anchorIndex = Just 100, anchorContext = Nothing, pageStart = Nothing }

                        after =
                            computeMessageWindow
                                { total = 5001, windowSize = 120, anchorIndex = Just 100, anchorContext = Nothing, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal before.start after.start
                        , \_ -> Expect.equal before.end after.end
                        , \_ -> Expect.equal before.rendered after.rendered
                        , \_ -> Expect.equal (before.hiddenAfter + 1) after.hiddenAfter
                        ]
                        ()
            ]
        , describe "input hardening"
            [ test "renders nothing when total is NaN or non-finite (fail closed)" <|
                \_ ->
                    Expect.all
                        (List.map
                            (\total ->
                                \_ -> Expect.equal empty (computeMessageWindow (plain total 120))
                            )
                            [ (0 / 0), (1 / 0), -(1 / 0) ]
                        )
                        ()
            , test "never drops the anchor row when given a negative anchor context" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Just 200, anchorContext = Just -50, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.atMost 200 w.start
                        , \_ -> Expect.equal 200 w.start
                        , \_ -> Expect.equal 320 w.end
                        , \_ -> Expect.equal 120 w.rendered
                        , \_ -> Expect.lessThan w.end 200
                        ]
                        ()
            , test "falls back to the default context when anchorContext is non-finite" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Just 200, anchorContext = Just (0 / 0), pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (200 - defaultAnchorContext) w.start
                        , \_ -> Expect.equal 120 w.rendered
                        ]
                        ()
            , test "clamps a context larger than the window so the anchor still fits" <|
                \_ ->
                    let
                        w =
                            computeMessageWindow
                                { total = 500, windowSize = 120, anchorIndex = Just 200, anchorContext = Just 10000, pageStart = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 120 w.rendered
                        , \_ -> Expect.atLeast w.start 200
                        , \_ -> Expect.lessThan w.end 200
                        ]
                        ()
            , test "fails closed on negative and non-finite window sizes" <|
                \_ ->
                    Expect.all
                        (List.map
                            (\size ->
                                \_ ->
                                    let
                                        w =
                                            computeMessageWindow (plain 10000 size)
                                    in
                                    Expect.all
                                        [ \_ -> Expect.equal defaultWindowSize w.rendered
                                        , \_ -> Expect.equal 10000 w.end
                                        , \_ -> Expect.equal 0 w.hiddenAfter
                                        ]
                                        ()
                            )
                            [ -1, -50, (0 / 0), -(1 / 0), (1 / 0) ]
                        )
                        ()
            , test "ignores a non-finite or negative pageStart and stays on the tail" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal 380
                                (computeMessageWindow
                                    { total = 500, windowSize = 120, anchorIndex = Nothing, anchorContext = Nothing, pageStart = Just -8 }
                                ).start
                        , \_ ->
                            Expect.equal 380
                                (computeMessageWindow
                                    { total = 500, windowSize = 120, anchorIndex = Nothing, anchorContext = Nothing, pageStart = Just (0 / 0) }
                                ).start
                        , \_ ->
                            Expect.equal 380
                                (computeMessageWindow
                                    { total = 500, windowSize = 120, anchorIndex = Nothing, anchorContext = Nothing, pageStart = Just (1 / 0) }
                                ).start
                        ]
                        ()
            ]
        , describe "selectMessageAnchorIndex"
            [ test "prefers an active search hit over landing and unread" <|
                \_ ->
                    Expect.equal (Just 80)
                        (selectMessageAnchorIndex
                            { searchIndex = Just 80, landingIndex = Just 20, unreadIndex = Just 40, pageStart = Nothing, forceUnread = False }
                        )
            , test "prefers a time-travel landing over unread when no search hit exists" <|
                \_ ->
                    Expect.equal (Just 20)
                        (selectMessageAnchorIndex
                            { searchIndex = Nothing, landingIndex = Just 20, unreadIndex = Just 40, pageStart = Nothing, forceUnread = False }
                        )
            , test "uses unread only while the feed is in live-tail mode" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just 40)
                                (selectMessageAnchorIndex
                                    { searchIndex = Nothing, landingIndex = Nothing, unreadIndex = Just 40, pageStart = Nothing, forceUnread = False }
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (selectMessageAnchorIndex
                                    { searchIndex = Nothing, landingIndex = Nothing, unreadIndex = Just 40, pageStart = Just 0, forceUnread = False }
                                )
                        ]
                        ()
            , test "lets an explicit unread handoff win over a historical pageStart" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just 850)
                                (selectMessageAnchorIndex
                                    { searchIndex = Nothing, landingIndex = Nothing, unreadIndex = Just 850, pageStart = Just 0, forceUnread = True }
                                )
                        , \_ ->
                            Expect.equal (Just 12)
                                (selectMessageAnchorIndex
                                    { searchIndex = Just 12, landingIndex = Nothing, unreadIndex = Just 850, pageStart = Just 0, forceUnread = True }
                                )
                        ]
                        ()
            , test "skips invalid indices and keeps the priority order" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just 12)
                                (selectMessageAnchorIndex
                                    { searchIndex = Just -1, landingIndex = Just (0 / 0), unreadIndex = Just 12, pageStart = Nothing, forceUnread = False }
                                )
                        , \_ ->
                            Expect.equal (Just 7)
                                (selectMessageAnchorIndex
                                    { searchIndex = Just (1 / 0), landingIndex = Just 7, unreadIndex = Just 12, pageStart = Nothing, forceUnread = False }
                                )
                        ]
                        ()
            ]
        , describe "planUnreadNavigation"
            [ test "returns null when the unread index cannot be resolved" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (planUnreadNavigation { total = 1000, unreadIndex = Nothing, windowSize = 120 })
                        , \_ -> Expect.equal Nothing (planUnreadNavigation { total = 1000, unreadIndex = Just -1, windowSize = 120 })
                        , \_ -> Expect.equal Nothing (planUnreadNavigation { total = 1000, unreadIndex = Just 1000, windowSize = 120 })
                        , \_ -> Expect.equal Nothing (planUnreadNavigation { total = (0 / 0), unreadIndex = Just 10, windowSize = 120 })
                        ]
                        ()
            , test "selects a bounded page that contains a near-tail unread outside the start page" <|
                \_ ->
                    case planUnreadNavigation { total = 1000, unreadIndex = Just 850, windowSize = toFloat defaultWindowSize } of
                        Nothing ->
                            Expect.fail "expected a plan"

                        Just planned ->
                            Expect.all
                                [ \_ -> Expect.equal 850 planned.unreadIndex
                                , \_ -> expectConserved planned.window 1000 defaultWindowSize
                                , \_ -> Expect.atMost defaultWindowSize planned.window.rendered
                                , \_ -> Expect.atLeast planned.window.start 850
                                , \_ -> Expect.lessThan planned.window.end 850
                                , \_ -> Expect.greaterThan 0 planned.window.start
                                ]
                                ()
            , test "keeps a trailing unread on the live tail without exceeding capacity" <|
                \_ ->
                    case planUnreadNavigation { total = 1000, unreadIndex = Just 900, windowSize = toFloat defaultWindowSize } of
                        Nothing ->
                            Expect.fail "expected a plan"

                        Just planned ->
                            Expect.all
                                [ \_ -> Expect.equal 1000 planned.window.end
                                , \_ -> Expect.equal 0 planned.window.hiddenAfter
                                , \_ -> Expect.equal defaultWindowSize planned.window.rendered
                                , \_ -> Expect.atLeast planned.window.start 900
                                , \_ -> Expect.lessThan planned.window.end 900
                                ]
                                ()
            ]
        ]


empty : MessageWindow
empty =
    { start = 0, end = 0, hiddenBefore = 0, hiddenAfter = 0, rendered = 0 }
