module OperConsoleTest exposing (suite)

{-| v3/gap-oper — the console state machine: what a click sends, what is
staged for review, how the daemon's replies fill each tab, and what a
reply nobody claims does inside and outside the reply window.
-}

import Expect
import OperConsole as C exposing (Field(..), Msg(..), State, UserAppeal(..))
import OperFeed
import OperPlan exposing (Intent(..))
import OperReply exposing (Section(..), Tone(..))
import Test exposing (Test, describe, test)
import Wire


oper : C.Ctx
oper =
    { live = True, isOper = True, nowMs = 100000 }


offline : C.Ctx
offline =
    { oper | live = False }


guest : C.Ctx
guest =
    { oper | isOper = False }


later : Float -> C.Ctx -> C.Ctx
later ms ctx =
    { ctx | nowMs = ctx.nowMs + ms }


send : C.Ctx -> Msg -> State -> ( State, List String )
send =
    C.update


lines : ( State, List String ) -> List String
lines ( _, out ) =
    List.map (String.replace "\u{000D}\n" "") out


stateOf : ( State, List String ) -> State
stateOf =
    Tuple.first


feedLine : C.Ctx -> String -> State -> State
feedLine ctx raw state =
    C.observeLine ctx (Wire.parseIrcMessage raw) state


feedAll : C.Ctx -> List String -> State -> State
feedAll ctx raws state =
    List.foldl (feedLine ctx) state raws


notice : String -> String
notice text =
    ":onyx.test NOTICE root :" ++ text


sendingBlank : State
sendingBlank =
    let
        b =
            C.blank
    in
    { b | userAppeal = AppealSending }


banForm : State -> State
banForm state =
    state
        |> (\s -> { s | forms = C.setField BanPattern "*!*@bad.example" s.forms })
        |> (\s -> { s | forms = C.setField BanReason "spam wave" s.forms })


suite : Test
suite =
    describe "v3/gap-oper OperConsole"
        [ describe "tabs load themselves once"
            [ test "opening Bans asks for the ward list and marks it loading" <|
                \_ ->
                    let
                        result =
                            send oper (SelectTab Bans) C.blank
                    in
                    Expect.equal ( [ "WARD LIST" ], True, Bans ) ( lines result, (stateOf result).wards.loading, (stateOf result).tab )
            , test "a loaded tab is not asked again" <|
                \_ ->
                    let
                        loaded =
                            C.blank
                                |> feedAll oper [ notice "WARD mask *!*@x.example node/expel by root :spam", notice "WARD: end of list" ]
                    in
                    Expect.equal [] (lines (send oper (SelectTab Bans) loaded))
            , test "Live asks which categories this session follows" <|
                \_ -> Expect.equal [] (lines (send oper (SelectTab Network) C.blank))
            , test "an offline desk sends nothing" <|
                \_ -> Expect.equal [] (lines (send offline (SelectTab Bans) C.blank))
            ]
        , describe "bans"
            [ test "adding a ban stages it for review and sends nothing yet" <|
                \_ ->
                    let
                        result =
                            send oper (Run (BanAdd (banForm C.blank).forms.ban)) (banForm C.blank)
                    in
                    Expect.equal ( [], Just "KLINE ADD *!*@bad.example :spam wave" )
                        ( lines result, (stateOf result).pending |> Maybe.map OperPlan.preview )
            , test "confirming sends the ban, then asks for the fresh ward list, and clears the form" <|
                \_ ->
                    let
                        staged =
                            send oper (Run (BanAdd (banForm C.blank).forms.ban)) (banForm C.blank) |> stateOf

                        result =
                            send oper Confirm staged
                    in
                    Expect.equal
                        ( [ "KLINE ADD *!*@bad.example :spam wave", "WARD LIST" ], ( "", "" ), Nothing )
                        ( lines result, ( (stateOf result).forms.ban.pattern, (stateOf result).forms.ban.reason ), (stateOf result).pending )

            , test "cancel drops the staged command" <|
                \_ ->
                    let
                        staged =
                            send oper (Run (BanAdd (banForm C.blank).forms.ban)) (banForm C.blank) |> stateOf
                    in
                    Expect.equal Nothing (send oper Cancel staged |> stateOf |> .pending)
            , test "a refused plan shows its copy and stages nothing" <|
                \_ ->
                    let
                        result =
                            send oper (Run (BanAdd (C.blank.forms.ban))) C.blank
                    in
                    Expect.equal ( [], True, Nothing ) ( lines result, not (List.isEmpty (stateOf result).errors), (stateOf result).pending )
            , test "a person who is not an operator cannot send a ban" <|
                \_ ->
                    let
                        result =
                            send guest (Run (BanAdd (banForm C.blank).forms.ban)) (banForm C.blank)
                    in
                    Expect.equal ( [], Nothing ) ( lines result, (stateOf result).pending )
            , test "ward rows fill the listing at the terminator" <|
                \_ ->
                    let
                        state =
                            send oper (Refresh Bans) C.blank
                                |> stateOf
                                |> feedAll oper
                                    [ notice "WARD mask *!*@bad.example node/expel by root :spam wave"
                                    , notice "WARD address 203.0.113.0/24 mesh/refuse by ops :botnet"
                                    ]

                        before =
                            List.length state.wards.rows

                        done =
                            feedLine oper (notice "WARD: end of list") state
                    in
                    Expect.equal ( 0, 2, False ) ( before, List.length done.wards.rows, done.wards.loading )
            , test "a refresh keeps the old rows until the new list ends" <|
                \_ ->
                    let
                        first =
                            C.blank |> feedAll oper [ notice "WARD mask *!*@a.example node/expel by root :x", notice "WARD: end of list" ]

                        refreshing =
                            send oper (Refresh Bans) first |> stateOf
                    in
                    Expect.equal ( 1, True ) ( List.length refreshing.wards.rows, refreshing.wards.loading )
            , test "a ward test result lands in the Bans reply log" <|
                \_ ->
                    let
                        state =
                            C.blank |> feedLine oper ":onyx.test 725 root mask *!*@bad.example :spam wave"
                    in
                    Expect.equal [ ( Bans, Warn ) ] (List.map (\l -> ( l.section, l.tone )) state.log)
            ]
        , describe "unclaimed replies"
            [ test "a permission refusal inside the window lands in the section that asked" <|
                \_ ->
                    let
                        asked =
                            send oper (Run ShunList) C.blank |> stateOf

                        state =
                            feedLine (later 500 oper) ":onyx.test 481 root :Permission denied: requires the 'client_moderate' operator privilege" asked
                    in
                    Expect.equal [ ( Silence, Bad ) ] (List.map (\l -> ( l.section, l.tone )) state.log)
            , test "the same refusal long afterwards is ignored" <|
                \_ ->
                    let
                        asked =
                            send oper (Run ShunList) C.blank |> stateOf

                        state =
                            feedLine (later 60000 oper) ":onyx.test 481 root :Permission denied" asked
                    in
                    Expect.equal [] state.log
            , test "a refusal stops the list that was loading" <|
                \_ ->
                    let
                        asked =
                            send oper (Run ShunList) C.blank |> stateOf

                        state =
                            feedLine (later 500 oper) ":onyx.test 481 root :Permission denied" asked
                    in
                    Expect.equal ( True, False ) ( asked.shuns.loading, state.shuns.loading )
            , test "a free-text server notice in the window is kept under the asking tab" <|
                \_ ->
                    let
                        asked =
                            send oper (Run (ServerQuery { verb = "MESH", arg = "" })) C.blank |> stateOf

                        state =
                            feedLine (later 300 oper) (notice "mesh intact: 3/3 nodes reachable") asked
                    in
                    Expect.equal [ ( Network, "mesh intact: 3/3 nodes reachable" ) ] (List.map (\l -> ( l.section, l.text )) state.log)
            , test "a stranger's notice is never kept" <|
                \_ ->
                    let
                        asked =
                            send oper (Run ShunList) C.blank |> stateOf

                        state =
                            feedLine (later 300 oper) ":mallory!m@evil.example NOTICE root :WARD: end of list" asked
                    in
                    Expect.equal [] state.log
            , test "a non-operator session claims nothing but its own appeal" <|
                \_ ->
                    let
                        state =
                            C.blank |> feedLine guest (notice "WARD mask *!*@x.example node/expel by root :spam")
                    in
                    Expect.equal ( [], 0 ) ( state.log, List.length state.wards.incoming )
            ]
        , describe "silence"
            [ test "a shun asks for the fresh list after the change" <|
                \_ ->
                    let
                        withForm =
                            C.blank
                                |> (\s -> { s | forms = C.setField ShunMask "*!*@bad.example" s.forms })
                                |> (\s -> { s | forms = C.setField ShunReason "flooding" s.forms })

                        staged =
                            send oper (Run (ShunAdd { mask = "*!*@bad.example", duration = OperPlan.blankDuration, reason = "flooding" })) withForm |> stateOf
                    in
                    Expect.equal [ "SHUN *!*@bad.example :flooding", "SHUN" ] (lines (send oper Confirm staged))
            , test "a gag reflection is logged in Silence" <|
                \_ ->
                    let
                        state =
                            C.blank |> feedLine oper ":onyx.test MODE bob +z"
                    in
                    Expect.equal [ ( Silence, Good, "bob is gagged." ) ] (List.map (\l -> ( l.section, l.tone, l.text )) state.log)
            ]
        , describe "abuse insight"
            [ test "ABUSE facts collect under the asked nick" <|
                \_ ->
                    let
                        state =
                            send oper (Run (AbuseCheck "bob")) C.blank
                                |> stateOf
                                |> feedAll oper
                                    [ notice "ABUSE bob: flood none excess=0 message_tokens=12"
                                    , notice "ABUSE bob: shun yes"
                                    , notice "ABUSE bob: dnsbl clear"
                                    ]
                    in
                    Expect.equal (Just "bob is flagged: shun.") (Maybe.map C.abuseHeadline state.abuse)
            , test "a nick that is not online says so" <|
                \_ ->
                    let
                        state =
                            send oper (Run (AbuseCheck "ghost")) C.blank |> stateOf |> feedLine oper (notice "ABUSE: no such nick")
                    in
                    Expect.equal [ Bad ] (List.map .tone state.log)
            , test "clone groups collect their indented members" <|
                \_ ->
                    let
                        state =
                            send oper (Run ClonesScan) C.blank
                                |> stateOf
                                |> feedAll oper
                                    [ notice "CLONES policy: max_per_ip=3 (on) max_per_net=0 (off); per-class clone caps via STATS Y"
                                    , notice "CLONES ip 203.0.113.9 (2 clients)"
                                    , notice "  alice 203.0.113.9 *"
                                    , notice "  bob 203.0.113.9 bobby"
                                    ]
                    in
                    Expect.equal
                        ( 1, [ "alice", "bob" ], False )
                        ( List.length state.clones.groups
                        , List.concatMap (\g -> List.map .nick g.members) state.clones.groups
                        , state.clones.loading
                        )
            , test "session rows fill at the 262 terminator" <|
                \_ ->
                    let
                        state =
                            send oper (Run (SessionsList { who = "oper", transport = "", account = "", ip = "", sort = "", limit = "" })) C.blank
                                |> stateOf
                                |> feedAll oper
                                    [ ":onyx.test 204 root Oper sessions root (198.51.100.7) 90 0 tls root"
                                    , ":onyx.test 262 root SESSION :End of SESSION view"
                                    ]
                    in
                    Expect.equal ( 1, False ) ( List.length state.sessions.rows, state.sessions.loading )
            ]
        , describe "appeals (operator side)"
            [ test "the list opens the Appeals tab and fills" <|
                \_ ->
                    let
                        result =
                            send oper (SelectTab Appeals) C.blank

                        state =
                            stateOf result
                                |> feedAll oper [ notice "APPEAL 1 bob 203.0.113.9 open :please review", notice "APPEAL 2 ann h.example answered :wrong person" ]
                                |> (\s -> { s | appeals = (\a -> { a | listing = (\l -> { l | rows = List.reverse l.incoming, loading = False }) a.listing }) s.appeals })
                    in
                    Expect.equal ( [ "APPEAL LIST" ], [ 1, 2 ] ) ( lines result, List.map .id state.appeals.listing.rows )

            , test "an answer is staged, then sent with a list refresh" <|
                \_ ->
                    let
                        typed =
                            C.blank |> (\s -> { s | forms = C.setField AppealAnswerText "Lifted, sorry" s.forms })

                        staged =
                            send oper (Run (AppealAnswer { id = "3", text = "Lifted, sorry" })) typed |> stateOf
                    in
                    Expect.equal [ "APPEAL ANSWER 3 :Lifted, sorry", "APPEAL LIST" ] (lines (send oper Confirm staged))
            ]
        , describe "appeals (the person's own)"
            [ test "filing sends APPEAL :text and waits" <|
                \_ ->
                    let
                        typed =
                            C.blank |> (\s -> { s | forms = C.setField AppealText "I was banned by mistake" s.forms })

                        result =
                            send guest SendUserAppeal typed
                    in
                    Expect.equal ( [ "APPEAL :I was banned by mistake" ], AppealSending ) ( lines result, (stateOf result).userAppeal )
            , test "the filed id comes back" <|
                \_ ->
                    let
                        sending =
                            sendingBlank
                    in
                    Expect.equal (AppealFiledAs 12) (feedLine guest (notice "APPEAL filed 12") sending |> .userAppeal)
            , test "a second filing in the hour is explained" <|
                \_ ->
                    let
                        sending =
                            sendingBlank
                    in
                    Expect.equal True
                        (case (feedLine guest (notice "APPEAL already filed") sending).userAppeal of
                            AppealRefused text ->
                                String.contains "already on file" text

                            _ ->
                                False
                        )
            , test "an empty appeal is refused without sending" <|
                \_ ->
                    let
                        result =
                            send guest SendUserAppeal C.blank
                    in
                    Expect.equal ( [], True )
                        ( lines result
                        , case (stateOf result).userAppeal of
                            AppealRefused _ ->
                                True

                            _ ->
                                False
                        )
            , test "a reply nobody asked for does not change an idle form" <|
                \_ -> Expect.equal AppealIdle (feedLine guest (notice "APPEAL filed 9") C.blank |> .userAppeal)
            , test "a dropped connection ends a pending filing with an explanation" <|
                \_ ->
                    let
                        sending =
                            sendingBlank
                    in
                    Expect.equal True
                        (case (send guest Disconnected sending |> stateOf).userAppeal of
                            AppealRefused _ ->
                                True

                            _ ->
                                False
                        )
            ]
        , describe "content controls"
            [ test "a filter add is staged, sent with its list refresh, and the pattern field clears" <|
                \_ ->
                    let
                        typed =
                            C.blank |> (\s -> { s | forms = C.setField FilterPattern "free money" s.forms })

                        staged =
                            send oper (Run (FilterAdd "free money")) typed |> stateOf

                        result =
                            send oper Confirm staged
                    in
                    Expect.equal ( [ "FILTER ADD :free money", "FILTER LIST" ], "" ) ( lines result, (stateOf result).forms.filterPattern )
            , test "filter rows keep their spaces" <|
                \_ ->
                    let
                        state =
                            send oper (Refresh Content) C.blank
                                |> stateOf
                                |> feedAll oper [ notice "FILTER LIST #1 free money", notice "FILTER: End of filter list (1)" ]
                    in
                    Expect.equal [ "free money" ] (List.map .pattern state.filters.rows)
            , test "the content tab loads filters, traps and policy together" <|
                \_ ->
                    Expect.equal [ "FILTER LIST", "SPAMTRAP LIST", "POLICY LIST" ] (lines (send oper (Refresh Content) C.blank))
            , test "spamtrap and policy replies fill their cards" <|
                \_ ->
                    let
                        state =
                            C.blank
                                |> feedAll oper
                                    [ notice "SPAMTRAP: 1 trap nick(s), 0 trap channel(s), 0 offender(s), 4 total trip(s)"
                                    , notice "POLICY: ward=3 filter=1 class=1 ban=2"
                                    ]
                    in
                    Expect.equal ( Just 4, Just 3 ) ( Maybe.map .trips state.spamtrap, Maybe.map .ward state.policy )
            , test "the challenge answer never lands in the log" <|
                \_ ->
                    let
                        staged =
                            send oper (Run (ChallengeQuestion { question = "type cat", answer = "cat" })) C.blank |> stateOf

                        state =
                            send oper Confirm staged |> stateOf
                    in
                    Expect.equal False (List.any (\l -> String.contains ":cat" l.text) state.log)
            ]
        , describe "event spine"
            [ test "the category line tells the desk what is followed" <|
                \_ ->
                    let
                        state =
                            C.blank |> feedLine oper (notice "Event categories: CONNECT FLOOD (min severity: warn)")
                    in
                    Expect.equal ( Just [ "CONNECT", "FLOOD" ], Just "warn" ) ( state.subscribed, state.floor )
            , test "toggling a followed category unfollows it; an unfollowed one follows" <|
                \_ ->
                    let
                        followed =
                            C.blank |> feedLine oper (notice "Event categories: FLOOD (min severity: debug)")
                    in
                    Expect.equal ( [ "EVENT DEL FLOOD" ], [ "EVENT ADD KILL" ] )
                        ( lines (send oper (FollowToggle "FLOOD") followed), lines (send oper (FollowToggle "KILL") followed) )
            , test "opening the desk asks once" <|
                \_ ->
                    let
                        first =
                            send oper Opened C.blank

                        learned =
                            stateOf first |> feedLine oper (notice "Event categories: (none) (min severity: debug)")
                    in
                    Expect.equal ( [ "EVENT LIST" ], [] ) ( lines first, lines (send oper Opened learned) )
            , test "a reconnect forgets the subscriptions" <|
                \_ ->
                    let
                        followed =
                            C.blank |> feedLine oper (notice "Event categories: FLOOD (min severity: warn)")
                    in
                    Expect.equal ( Nothing, Nothing ) (let s = send oper Disconnected followed |> stateOf in ( s.subscribed, s.floor ))
            , test "a live row reaches the feed" <|
                \_ ->
                    let
                        draft =
                            { category = "FLOOD", severity = "warn", origin = "n1.test", text = "possible raid on #lounge", kind = OperFeed.CategoryEvent, eventId = Nothing }

                        state =
                            C.observeEvent oper draft C.blank
                    in
                    Expect.equal [ "possible raid on #lounge" ] (List.map .text (OperFeed.visible state.feed))
            , test "a person who is not an operator never fills the feed" <|
                \_ ->
                    let
                        draft =
                            { category = "FLOOD", severity = "warn", origin = "n1.test", text = "x", kind = OperFeed.CategoryEvent, eventId = Nothing }
                    in
                    Expect.equal [] (OperFeed.visible (C.observeEvent guest draft C.blank).feed)
            , test "the daemon's OPER_ACTION confirmation shows up in the tab that asked" <|
                \_ ->
                    let
                        asked =
                            send oper (Refresh Bans) C.blank |> stateOf

                        draft =
                            { category = "OPER_ACTION", severity = "notice", origin = "n1.test", text = "WARD ADD mask *!*@bad.example node/expel proof=ab12", kind = OperFeed.CategoryEvent, eventId = Nothing }

                        state =
                            C.observeEvent (later 500 oper) draft asked
                    in
                    Expect.equal [ ( Bans, Good ) ] (List.map (\l -> ( l.section, l.tone )) state.log)
            , test "EVENT STATS JSON decodes into counters" <|
                \_ ->
                    let
                        state =
                            C.blank
                                |> feedLine oper (notice "{\"total\":12,\"history_depth\":12,\"categories\":{\"connect\":8,\"flood\":4},\"severities\":{\"info\":10,\"warn\":2},\"operator_surfaces\":{\"audit_json\":true}}")
                    in
                    Expect.equal (Just ( 12, [ ( "connect", 8 ), ( "flood", 4 ) ] )) (Maybe.map (\s -> ( s.total, s.categories )) state.stats)
            , test "feed controls pause, filter and clear" <|
                \_ ->
                    let
                        draft text =
                            { category = "KILL", severity = "warn", origin = "n1", text = text, kind = OperFeed.CategoryEvent, eventId = Nothing }

                        state =
                            C.blank
                                |> C.observeEvent oper (draft "a")
                                |> (\s -> send oper FeedPause s |> stateOf)
                                |> C.observeEvent (later 9000 oper) (draft "b")
                    in
                    Expect.equal ( [ "a" ], 1 ) ( List.map .text (OperFeed.visible state.feed), OperFeed.heldCount state.feed )
            ]
        , describe "reply log"
            [ test "is bounded" <|
                \_ ->
                    let
                        asked =
                            send oper (Run ShunList) C.blank |> stateOf

                        state =
                            List.foldl
                                (\i s -> feedLine (later (toFloat i) oper) (notice ("SHUN: note " ++ String.fromInt i)) s)
                                asked
                                (List.range 1 (C.maxLog + 50))
                    in
                    Expect.equal C.maxLog (List.length state.log)
            , test "clearing one tab leaves the others" <|
                \_ ->
                    let
                        state =
                            C.blank
                                |> feedAll oper [ notice "APPEAL answered", ":onyx.test MODE bob +z" ]
                                |> (\s -> send oper (ClearLog Silence) s |> stateOf)
                    in
                    Expect.equal [ Appeals ] (List.map .section state.log)
            ]
        ]
