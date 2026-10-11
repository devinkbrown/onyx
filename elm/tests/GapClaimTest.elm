module GapClaimTest exposing (suite)

{-| v3/gap-claim — pure logic for claiming history that predates owner
scoping: the ports answer decoder, the attach / delete / not-now state
machine (never automatic, never without a confirm for delete, stale
answers ignored), who sees which card, and the copy.
-}

import Expect
import GapClaim exposing (..)
import Json.Encode as Encode
import Test exposing (Test, describe, test)
import Time


kai : String
kai =
    "[\"onyx\",\"account\",\"kai\"]"


lee : String
lee =
    "[\"onyx\",\"account\",\"lee\"]"


guestKey : String
guestKey =
    "[\"onyx\",\"guest\"]"


ctx : Ctx
ctx =
    { scope = Just kai, localHistory = True }


summary : Summary
summary =
    { rows = 1284
    , conversations = 17
    , oldest = Just 1772528400000
    , newest = Just 1791493200000
    , undated = 0
    , otherOwners = 0
    , truncated = False
    }


{-| A scope that settled and was scanned: the prompt is up. -}
found : State
found =
    { blank | scope = Just kai, scan = Found summary, guest = guestKey }


scanJson : String -> Int -> Encode.Value
scanJson scope rows =
    Encode.object
        [ ( "kind", Encode.string "scan" )
        , ( "scope", Encode.string scope )
        , ( "ok", Encode.bool True )
        , ( "rows", Encode.int rows )
        , ( "conversations", Encode.int 3 )
        , ( "oldest", Encode.int 1772528400000 )
        , ( "newest", Encode.int 1791493200000 )
        , ( "undated", Encode.int 0 )
        , ( "otherOwners", Encode.int 0 )
        , ( "truncated", Encode.bool False )
        , ( "dismissed", Encode.bool False )
        , ( "interrupted", Encode.bool False )
        ]


doneJson : String -> String -> Bool -> Int -> Int -> Int -> Encode.Value
doneJson scope op ok attached deleted remaining =
    Encode.object
        [ ( "kind", Encode.string "done" )
        , ( "scope", Encode.string scope )
        , ( "op", Encode.string op )
        , ( "ok", Encode.bool ok )
        , ( "reason", Encode.string "" )
        , ( "total", Encode.int (attached + deleted + remaining) )
        , ( "attached", Encode.int attached )
        , ( "merged", Encode.int 0 )
        , ( "deleted", Encode.int deleted )
        , ( "remaining", Encode.int remaining )
        ]


progressJson : String -> String -> Int -> Int -> Encode.Value
progressJson scope op done total =
    Encode.object
        [ ( "kind", Encode.string "progress" )
        , ( "scope", Encode.string scope )
        , ( "op", Encode.string op )
        , ( "done", Encode.int done )
        , ( "total", Encode.int total )
        ]


step : Msg -> State -> State
step msg state =
    Tuple.first (update ctx msg state)


effects : Msg -> State -> List Effect
effects msg state =
    Tuple.second (update ctx msg state)


requests : List Effect -> List ( String, String )
requests =
    List.filterMap
        (\fx ->
            case fx of
                Request r ->
                    Just ( r.op, r.scope )

                HistoryChanged ->
                    Nothing
        )


suite : Test
suite =
    describe "GapClaim"
        [ describe "decodeAnswer"
            [ test "a scan answer carries counts and dates only" <|
                \_ ->
                    case decodeAnswer (scanJson kai 1284) of
                        Just (ScanAnswer a) ->
                            Expect.equal
                                { scope = kai, ok = True, rows = 1284, conversations = 3, oldest = Just 1772528400000, newest = Just 1791493200000 }
                                { scope = a.scope, ok = a.ok, rows = a.summary.rows, conversations = a.summary.conversations, oldest = a.summary.oldest, newest = a.summary.newest }

                        _ ->
                            Expect.fail "expected a scan answer"
            , test "a time of 0 (unknown) or null decodes as no date; counts clamp at zero" <|
                \_ ->
                    let
                        value =
                            Encode.object
                                [ ( "kind", Encode.string "scan" )
                                , ( "scope", Encode.string kai )
                                , ( "ok", Encode.bool True )
                                , ( "rows", Encode.int -5 )
                                , ( "oldest", Encode.int 0 )
                                , ( "newest", Encode.null )
                                ]
                    in
                    case decodeAnswer value of
                        Just (ScanAnswer a) ->
                            Expect.equal ( 0, Nothing, Nothing ) ( a.summary.rows, a.summary.oldest, a.summary.newest )

                        _ ->
                            Expect.fail "expected a scan answer"
            , test "progress and done answers" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just (ProgressAnswer { scope = kai, op = Attach, done = 400, total = 1284 }))
                                (decodeAnswer (progressJson kai "attach" 400 1284))
                        , \_ ->
                            case decodeAnswer (doneJson kai "delete" True 0 12 0) of
                                Just (DoneAnswer d) ->
                                    Expect.equal { op = Delete, ok = True, deleted = 12, remaining = 0 } { op = d.op, ok = d.ok, deleted = d.deleted, remaining = d.remaining }

                                _ ->
                                    Expect.fail "expected a done answer"
                        ]
                        ()
            , test "an unknown remaining stays -1 (the verifying scan failed)" <|
                \_ ->
                    let
                        value =
                            Encode.object
                                [ ( "kind", Encode.string "done" )
                                , ( "scope", Encode.string kai )
                                , ( "op", Encode.string "attach" )
                                , ( "ok", Encode.bool False )
                                , ( "reason", Encode.string "verify" )
                                ]
                    in
                    case decodeAnswer value of
                        Just (DoneAnswer d) ->
                            Expect.equal ( -1, "verify" ) ( d.remaining, d.reason )

                        _ ->
                            Expect.fail "expected a done answer"
            , test "malformed, scope-less, op-less and unknown answers are rejected" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (decodeAnswer (Encode.string "x"))
                        , \_ -> Expect.equal Nothing (decodeAnswer (Encode.object [ ( "kind", Encode.string "scan" ) ]))
                        , \_ -> Expect.equal Nothing (decodeAnswer (scanJson "" 3))
                        , \_ -> Expect.equal Nothing (decodeAnswer (progressJson kai "explode" 1 2))
                        , \_ -> Expect.equal Nothing (decodeAnswer (Encode.object [ ( "kind", Encode.string "mystery" ), ( "scope", Encode.string kai ) ]))
                        ]
                        ()
            ]
        , describe "scope changes"
            [ test "the first scope is scanned, once, with the guest scope to spare" <|
                \_ ->
                    let
                        ( s, fx ) =
                            scopeChanged { scope = Just kai, guest = guestKey } blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal Scanning s.scan
                        , \_ -> Expect.equal [ Request { op = "scan", scope = kai, guest = guestKey } ] fx
                        , \_ -> Expect.equal [] (Tuple.second (scopeChanged { scope = Just kai, guest = guestKey } s))
                        ]
                        ()
            , test "a different identity resets the per-scope state but keeps the device's Not now" <|
                \_ ->
                    let
                        before =
                            { found | dismissed = True, phase = ConfirmingDelete }

                        ( s, fx ) =
                            scopeChanged { scope = Just lee, guest = guestKey } before
                    in
                    Expect.all
                        [ \_ -> Expect.equal { scope = Just lee, scan = Scanning, phase = Resting, dismissed = True } { scope = s.scope, scan = s.scan, phase = s.phase, dismissed = s.dismissed }
                        , \_ -> Expect.equal [ ( "scan", lee ) ] (requests fx)
                        ]
                        ()
            , test "losing the scope forgets what was found and asks nothing" <|
                \_ ->
                    let
                        ( s, fx ) =
                            scopeChanged { scope = Nothing, guest = guestKey } found
                    in
                    Expect.equal ( Nothing, Unknown, [] ) ( s.scope, s.scan, fx )
            ]
        , describe "Attach"
            [ test "is never automatic: a scan that finds rows sends nothing but the prompt" <|
                \_ ->
                    let
                        ( s, fx ) =
                            update ctx (Answered (scanJson kai 9)) { blank | scope = Just kai, scan = Scanning }
                    in
                    Expect.equal ( True, Resting, [] ) ( isPending s, s.phase, fx )
            , test "starts a request for the settled scope and shows progress from zero" <|
                \_ ->
                    let
                        ( s, fx ) =
                            update ctx AttachClicked found
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Working Attach { done = 0, total = 1284 }) s.phase
                        , \_ -> Expect.equal [ ( "attach", kai ) ] (requests fx)
                        ]
                        ()
            , test "needs a found scan, the matching scope, and local history on" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [] (effects AttachClicked { blank | scope = Just kai, scan = Clear })
                        , \_ -> Expect.equal [] (effects AttachClicked { found | scope = Just lee })
                        , \_ -> Expect.equal [] (Tuple.second (update { ctx | scope = Nothing } AttachClicked found))
                        , \_ -> Expect.equal [] (Tuple.second (update { ctx | localHistory = False } AttachClicked found))
                        ]
                        ()
            , test "a second click while it runs is ignored" <|
                \_ ->
                    let
                        running =
                            step AttachClicked found
                    in
                    Expect.equal [] (effects AttachClicked running)
            , test "progress follows the operation; another scope's progress is ignored" <|
                \_ ->
                    let
                        running =
                            step AttachClicked found
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Working Attach { done = 400, total = 1284 }) (step (Answered (progressJson kai "attach" 400 1284)) running).phase
                        , \_ -> Expect.equal running.phase (step (Answered (progressJson lee "attach" 400 1284)) running).phase
                        , \_ -> Expect.equal running.phase (step (Answered (progressJson kai "delete" 400 1284)) running).phase
                        ]
                        ()
            , test "a verified finish clears the prompt and tells the App the history changed" <|
                \_ ->
                    let
                        ( s, fx ) =
                            update ctx (Answered (doneJson kai "attach" True 1284 0 0)) (step AttachClicked found)
                    in
                    Expect.all
                        [ \_ -> Expect.equal Clear s.scan
                        , \_ -> Expect.equal [ HistoryChanged ] fx
                        , \_ ->
                            Expect.equal
                                (Finished { op = Attach, ok = True, reason = "", total = 1284, moved = 1284, merged = 0, remaining = 0 })
                                s.phase
                        ]
                        ()
            , test "a failed finish keeps what is left, offers a retry, and re-counts" <|
                \_ ->
                    let
                        ( s, fx ) =
                            update ctx (Answered (doneJson kai "attach" False 400 0 884)) (step AttachClicked found)
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Found { summary | rows = 884 }) s.scan
                        , \_ -> Expect.equal [ ( "scan", kai ) ] (requests fx)
                        , \_ -> Expect.equal True (List.member HistoryChanged fx)
                        , \_ -> Expect.equal [ ( "attach", kai ) ] (requests (effects AttachClicked s))
                        ]
                        ()
            , test "a finish for a scope we left is ignored" <|
                \_ ->
                    let
                        running =
                            step AttachClicked found
                    in
                    Expect.equal ( running, [] ) (update ctx (Answered (doneJson lee "attach" True 1 0 0)) running)
            , test "a delete answer cannot finish an attach" <|
                \_ ->
                    let
                        running =
                            step AttachClicked found
                    in
                    Expect.equal running.phase (step (Answered (doneJson kai "delete" True 0 5 0)) running).phase
            , test "Done returns to rest" <|
                \_ ->
                    let
                        finished =
                            step (Answered (doneJson kai "attach" True 3 0 0)) (step AttachClicked found)
                    in
                    Expect.equal Resting (step Acknowledged finished).phase
            ]
        , describe "Delete"
            [ test "asks first: nothing is requested until it is confirmed" <|
                \_ ->
                    let
                        ( s, fx ) =
                            update ctx DeleteAsked found
                    in
                    Expect.equal ( ConfirmingDelete, [] ) ( s.phase, fx )
            , test "confirm without having asked does nothing" <|
                \_ ->
                    Expect.equal [] (effects DeleteConfirmed found)
            , test "confirm requests the delete for the scope" <|
                \_ ->
                    let
                        ( s, fx ) =
                            update ctx DeleteConfirmed (step DeleteAsked found)
                    in
                    Expect.equal ( Working Delete { done = 0, total = 1284 }, [ ( "delete", kai ) ] ) ( s.phase, requests fx )
            , test "keeping it returns to rest" <|
                \_ ->
                    Expect.equal Resting (step DeleteCancelled (step DeleteAsked found)).phase
            , test "Attach is not available behind the confirm" <|
                \_ ->
                    Expect.equal [] (effects AttachClicked (step DeleteAsked found))
            , test "a verified delete clears the prompt" <|
                \_ ->
                    let
                        ( s, fx ) =
                            update ctx (Answered (doneJson kai "delete" True 0 1284 0)) (step DeleteConfirmed (step DeleteAsked found))
                    in
                    Expect.equal ( Clear, [ HistoryChanged ] ) ( s.scan, fx )
            ]
        , describe "Not now"
            [ test "is remembered on the device and touches nothing else" <|
                \_ ->
                    let
                        ( s, fx ) =
                            update ctx NotNowClicked found
                    in
                    Expect.equal ( True, Found summary, [ ( "dismiss", kai ) ] ) ( s.dismissed, s.scan, requests fx )
            , test "is not offered while an operation runs" <|
                \_ ->
                    Expect.equal [] (effects NotNowClicked (step AttachClicked found))
            ]
        , describe "scan answers"
            [ test "rows found put the prompt up, and fold in the device decision" <|
                \_ ->
                    let
                        value =
                            Encode.object
                                [ ( "kind", Encode.string "scan" )
                                , ( "scope", Encode.string kai )
                                , ( "ok", Encode.bool True )
                                , ( "rows", Encode.int 40 )
                                , ( "dismissed", Encode.bool True )
                                , ( "interrupted", Encode.bool True )
                                ]

                        s =
                            step (Answered value) { blank | scope = Just kai, scan = Scanning }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (isPending s)
                        , \_ -> Expect.equal ( True, True ) ( s.dismissed, s.interrupted )
                        ]
                        ()
            , test "no rows is a clean device; an unreadable store is not 'clean'" <|
                \_ ->
                    let
                        scanning =
                            { blank | scope = Just kai, scan = Scanning }

                        unreadable =
                            Encode.object [ ( "kind", Encode.string "scan" ), ( "scope", Encode.string kai ), ( "ok", Encode.bool False ) ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal Clear (step (Answered (scanJson kai 0)) scanning).scan
                        , \_ -> Expect.equal Unreadable (step (Answered unreadable) scanning).scan
                        ]
                        ()
            , test "an answer for another scope is ignored" <|
                \_ ->
                    let
                        scanning =
                            { blank | scope = Just kai, scan = Scanning, guest = guestKey }
                    in
                    Expect.equal scanning (step (Answered (scanJson lee 99)) scanning)
            , test "a scan answer that predates a running operation is ignored (the finish re-counts)" <|
                \_ ->
                    let
                        running =
                            step AttachClicked found
                    in
                    Expect.equal running (step (Answered (scanJson kai 7)) running)
            , test "Rescan asks again, but never mid-operation" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [ ( "scan", kai ) ] (requests (effects Rescan found))
                        , \_ -> Expect.equal [] (effects Rescan (step AttachClicked found))
                        ]
                        ()
            ]
        , describe "who sees which card"
            [ test "Home: only a found, undismissed prompt - and any running or finished operation" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (homeVisible found)
                        , \_ -> Expect.equal False (homeVisible { found | dismissed = True })
                        , \_ -> Expect.equal False (homeVisible { blank | scan = Clear })
                        , \_ -> Expect.equal False (homeVisible { blank | scan = Scanning })
                        , \_ -> Expect.equal True (homeVisible (step AttachClicked found))
                        , \_ -> Expect.equal False (homeVisible { found | dismissed = True, phase = Working Attach { done = 1, total = 2 } })
                        ]
                        ()
            , test "Preferences: while rows exist, and while an operation or its result is on screen - even after Not now" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (prefsVisible { found | dismissed = True })
                        , \_ -> Expect.equal False (prefsVisible { blank | scan = Clear })
                        , \_ -> Expect.equal True (prefsVisible { blank | scan = Clear, phase = Finished { op = Attach, ok = True, reason = "", total = 1, moved = 1, merged = 0, remaining = 0 } })
                        , \_ -> Expect.equal False (prefsVisible { blank | scan = Unreadable })
                        ]
                        ()
            ]
        , describe "shared device"
            [ test "other owner stamps, or a remembered sign-in for someone else, say yes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (sharedDevice { otherOwners = 0, remembered = [], account = Just "kai" })
                        , \_ -> Expect.equal False (sharedDevice { otherOwners = 0, remembered = [ "Kai" ], account = Just "kai" })
                        , \_ -> Expect.equal True (sharedDevice { otherOwners = 1, remembered = [], account = Just "kai" })
                        , \_ -> Expect.equal True (sharedDevice { otherOwners = 0, remembered = [ "kai", "lee" ], account = Just "kai" })
                        , \_ -> Expect.equal True (sharedDevice { otherOwners = 0, remembered = [ "lee" ], account = Nothing })
                        ]
                        ()
            ]
        , describe "copy"
            [ test "the date range" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Mar 3, 2026 \u{2013} Oct 8, 2026" (rangeLabel Time.utc summary)
                        , \_ -> Expect.equal "Mar 3, 2026" (rangeLabel Time.utc { summary | oldest = Just 1772528400000, newest = Just 1772578800000 })
                        , \_ -> Expect.equal "dates unknown" (rangeLabel Time.utc { summary | oldest = Nothing, newest = Nothing, undated = 4 })
                        , \_ -> Expect.equal "Mar 3, 2026 \u{2013} Oct 8, 2026, plus some undated" (rangeLabel Time.utc { summary | undated = 2 })
                        ]
                        ()
            , test "counts and facts line" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "1,284 messages in 17 conversations" (countsLine summary)
                        , \_ -> Expect.equal "1 message in 1 conversation" (countsLine { summary | rows = 1, conversations = 1 })
                        , \_ -> Expect.equal "More than 250,000 messages in 9 conversations" (countsLine { summary | rows = 250000, conversations = 9, truncated = True })
                        , \_ -> Expect.equal "1,284 messages in 17 conversations \u{00B7} Mar 3, 2026 \u{2013} Oct 8, 2026" (factsLine Time.utc summary)
                        ]
                        ()
            , test "the question names the identity, or guest history" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Attach it to kai?" (question False (Just "kai"))
                        , \_ -> Expect.equal "Attach it to guest history?" (question False Nothing)
                        , \_ -> Expect.equal "Finish attaching it to kai?" (question True (Just "kai"))
                        , \_ -> Expect.equal "Attach to kai" (attachLabel False (Just "kai"))
                        , \_ -> Expect.equal "Attach to guest history" (attachLabel False Nothing)
                        ]
                        ()
            , test "an account: only that account sees it; a shared device says so" <|
                \_ ->
                    let
                        alone =
                            String.join " " (explainLines { account = Just "kai", shared = False })

                        shared =
                            String.join " " (explainLines { account = Just "kai", shared = True })
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (String.contains "Only kai will be able to see, search or export it" alone)
                        , \_ -> Expect.equal True (String.contains "can\u{2019}t be matched to one" alone)
                        , \_ -> Expect.equal False (String.contains "Other accounts" alone)
                        , \_ -> Expect.equal True (String.contains "Other accounts and guests that use this device won\u{2019}t see it" shared)
                        , \_ -> Expect.equal True (String.contains "If it isn\u{2019}t yours, delete it instead." shared)
                        , \_ -> Expect.equal False (String.contains "If it isn\u{2019}t yours" alone)
                        ]
                        ()
            , test "a guest: says guest history is shared by guests on this network, and to sign in first" <|
                \_ ->
                    let
                        copy =
                            String.join " " (explainLines { account = Nothing, shared = False })
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (String.contains "shared by every guest session on this network" copy)
                        , \_ -> Expect.equal True (String.contains "Sign in first" copy)
                        ]
                        ()
            , test "the outcome lines are specific and never claim more than was verified" <|
                \_ ->
                    let
                        attach ok moved merged reason total remaining =
                            outcomeText (Just "kai") { op = Attach, ok = ok, reason = reason, total = total, moved = moved, merged = merged, remaining = remaining }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (String.startsWith "Attached 1,284 messages to kai." (attach True 1284 0 "" 1284 0))
                        , \_ -> Expect.equal True (String.contains "37 messages were already there" (attach True 1247 37 "" 1284 0))
                        , \_ -> Expect.equal True (String.startsWith "Nothing was left to attach" (attach True 0 0 "" 0 0))
                        , \_ -> Expect.equal True (String.startsWith "400 of 1,284 attached. The rest is still stored safely" (attach False 400 0 "write" 1284 884))
                        , \_ -> Expect.equal True (String.contains "Local history is off" (attach False 0 0 "history-off" 0 -1))
                        , \_ -> Expect.equal "Deleted 1,284 messages from before this update." (outcomeText Nothing { op = Delete, ok = True, reason = "", total = 1284, moved = 1284, merged = 0, remaining = 0 })
                        , \_ -> Expect.equal True (String.contains "Attached 3 messages to guest history." (outcomeText Nothing { op = Attach, ok = True, reason = "", total = 3, moved = 3, merged = 0, remaining = 0 }))
                        , \_ -> Expect.equal True (String.contains "20 messages still on this device" (outcomeText Nothing { op = Delete, ok = False, reason = "write", total = 420, moved = 400, merged = 0, remaining = 20 }))
                        ]
                        ()
            , test "attach is blocked, with the reason, while local history is off" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (attachBlocker True)
                        , \_ -> Expect.equal True (attachBlocker False /= Nothing)
                        ]
                        ()
            , test "progress percent is bounded" <|
                \_ ->
                    Expect.equal [ 0, 50, 100, 100 ]
                        [ progressPercent { done = 5, total = 0 }
                        , progressPercent { done = 5, total = 10 }
                        , progressPercent { done = 10, total = 10 }
                        , progressPercent { done = 99, total = 10 }
                        ]
            , test "element ids are per place" <|
                \_ ->
                    Expect.equal "gc-prefs-keep" (elementId "prefs" "keep")
            ]
        , describe "the prompt never carries message text"
            [ test "a scan answer with extra text fields decodes to counts only" <|
                \_ ->
                    let
                        value =
                            Encode.object
                                [ ( "kind", Encode.string "scan" )
                                , ( "scope", Encode.string kai )
                                , ( "ok", Encode.bool True )
                                , ( "rows", Encode.int 2 )
                                , ( "body", Encode.string "SECRET BODY" )
                                , ( "text", Encode.string "SECRET TEXT" )
                                ]

                        s =
                            step (Answered value) { blank | scope = Just kai, scan = Scanning }
                    in
                    Expect.equal False (String.contains "SECRET" (Debug.toString s))
            ]
        ]
