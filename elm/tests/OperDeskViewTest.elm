module OperDeskViewTest exposing (suite)

{-| v3/gap-oper — the tabbed operator desk as rendered: tabs, the live
feed, the review block, the lists, and that the controls speak the
console's messages.
-}

import App exposing (ConnectionState(..), Model, Msg(..), Outbound(..), blank, update)
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import OperConsole as C exposing (Field(..))
import OperFeed
import OperPlan exposing (Intent(..))
import OperReply exposing (Section(..))
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


base : Model
base =
    { blank | connection = Live, ourNick = "root", isOper = True, operDeskOpen = True }


onTab : Section -> Model -> Model
onTab section model =
    let
        console =
            model.operConsole
    in
    { model | operConsole = { console | tab = section } }


withConsole : (C.State -> C.State) -> Model -> Model
withConsole f model =
    { model | operConsole = f model.operConsole }


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


line : String -> Msg
line raw =
    WsLineReceived raw


feed : Model -> Model
feed model =
    let
        d cat sev text =
            { category = cat, severity = sev, origin = "n1.test", text = text, kind = OperFeed.CategoryEvent, eventId = Nothing }
    in
    withConsole
        (\c ->
            { c
                | feed =
                    c.feed
                        |> OperFeed.push 1000 (d "FLOOD" "warn" "possible raid on #lounge")
                        |> OperFeed.push 9000 (d "CONNECT" "info" "USER CONNECT alice!u@h")
            }
        )
        model


suite : Test
suite =
    describe "v3/gap-oper operator desk view"
        [ describe "tabs"
            [ test "seven tabs, the current one selected, wired to the console" <|
                \_ ->
                    Expect.all
                        [ \q -> q |> Query.find [ testId "oc-tabs" ] |> Query.findAll [ Selector.attribute (Attr.attribute "role" "tab") ] |> Query.count (Expect.equal 7)
                        , \q -> q |> Query.find [ testId "oc-tab-live" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-selected" "true") ]
                        , \q -> q |> Query.find [ testId "oc-tab-bans" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-selected" "false") ]
                        , \q -> q |> Query.find [ testId "oc-tab-bans" ] |> Event.simulate Event.click |> Event.expect (OperConsoleMsg (C.SelectTab Bans))
                        ]
                        (query base)
            , test "only the current tab's panel is in the page" <|
                \_ ->
                    Expect.all
                        [ \q -> q |> Query.findAll [ testId "oc-tab-live" ] |> Query.count (Expect.equal 1)
                        , \q -> q |> Query.findAll [ testId "oc-ban-form" ] |> Query.count (Expect.equal 0)
                        , \q -> query (onTab Bans base) |> Query.findAll [ testId "oc-ban-form" ] |> Query.count (Expect.equal 1)
                        ]
                        (query base)
            , test "arrow keys rove the tab list and the new tab takes focus" <|
                \_ ->
                    let
                        ( moved, out ) =
                            update (OperConsoleMsg (C.TabKey "ArrowRight")) base
                    in
                    Expect.equal ( Bans, [ SendLine "WARD LIST\u{000D}\n", PrefsFocus { id = "oper-tab-bans" } ] ) ( moved.operConsole.tab, out )
            , test "Home and End wrap to the first and last tab" <|
                \_ ->
                    Expect.equal ( Feed, Network )
                        ( (update (OperConsoleMsg (C.TabKey "Home")) (onTab Appeals base) |> Tuple.first).operConsole.tab
                        , (update (OperConsoleMsg (C.TabKey "End")) base |> Tuple.first).operConsole.tab
                        )
            , test "the tab buttons turn the arrow keys into TabKey (and ignore letters)" <|
                \_ ->
                    Expect.all
                        [ \q ->
                            q
                                |> Query.find [ testId "oc-tab-live" ]
                                |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "ArrowRight" ) ]))
                                |> Event.expect (OperConsoleMsg (C.TabKey "ArrowRight"))
                        , \q ->
                            q
                                |> Query.find [ testId "oc-tab-live" ]
                                |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "a" ) ]))
                                |> Event.toResult
                                |> Expect.err
                        ]
                        (query base)
            , test "selecting a tab from the update loop asks for its list" <|

                \_ ->
                    let
                        ( moved, out ) =
                            update (OperConsoleMsg (C.SelectTab Bans)) base
                    in
                    Expect.equal ( Bans, [ SendLine "WARD LIST\u{000D}\n", PrefsFocus { id = "oper-tab-bans" } ] ) ( moved.operConsole.tab, out )
            ]
        , describe "live"
            [ test "the chips show what this session follows" <|
                \_ ->
                    let
                        followed =
                            update (line ":onyx.test NOTICE root :Event categories: FLOOD KILL (min severity: info)") base |> Tuple.first
                    in
                    Expect.all
                        [ \q -> q |> Query.find [ testId "oc-follow-flood" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-pressed" "true") ]
                        , \q -> q |> Query.find [ testId "oc-follow-connect" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-pressed" "false") ]
                        , \q -> q |> Query.find [ testId "oc-follow-connect" ] |> Event.simulate Event.click |> Event.expect (OperConsoleMsg (C.FollowToggle "CONNECT"))
                        ]
                        (query followed)
            , test "the feed lists rows newest first and pauses" <|
                \_ ->
                    let
                        withRows =
                            feed base
                    in
                    Expect.all
                        [ \q -> q |> Query.findAll [ testId "oc-event" ] |> Query.count (Expect.equal 2)
                        , \q -> q |> Query.find [ testId "oc-feed-pause" ] |> Event.simulate Event.click |> Event.expect (OperConsoleMsg C.FeedPause)
                        , \q -> q |> Query.find [ testId "oc-feed-status" ] |> Query.has [ Selector.text "2 rows" ]
                        ]
                        (query withRows)
            , test "an empty feed explains itself" <|
                \_ -> query base |> Query.has [ Selector.text "Nothing yet" ]
            , test "a paused feed offers resume with the held count" <|
                \_ ->
                    let
                        paused =
                            withConsole
                                (\c ->
                                    { c
                                        | feed =
                                            c.feed
                                                |> OperFeed.pause
                                                |> OperFeed.push 1000 { category = "KILL", severity = "warn", origin = "n1", text = "x", kind = OperFeed.CategoryEvent, eventId = Nothing }
                                    }
                                )
                                base
                    in
                    query paused |> Query.find [ testId "oc-feed-pause" ] |> Query.has [ Selector.text "Resume · 1 new" ]
            , test "the daemon's tagged event reaches the feed through the update loop" <|
                \_ ->
                    let
                        ( m, _ ) =
                            update
                                (line "@onyx_server.io/category=FLOOD;onyx_server.io/severity=warn :n1.test EVENT root FLOOD possible raid on #lounge")
                                base
                    in
                    Expect.equal [ "possible raid on #lounge" ] (List.map .text (OperFeed.visible m.operConsole.feed))
            , test "a non-operator session keeps no feed" <|
                \_ ->
                    let
                        ( m, _ ) =
                            update
                                (line "@onyx_server.io/category=FLOOD;onyx_server.io/severity=warn :n1.test EVENT root FLOOD x")
                                { base | isOper = False }
                    in
                    Expect.equal [] (OperFeed.visible m.operConsole.feed)
            ]
        , describe "bans"
            [ test "the ban button waits for a mask and a reason" <|
                \_ ->
                    let
                        typed =
                            withConsole
                                (\c ->
                                    { c | forms = C.setField BanReason "spam wave" (C.setField BanPattern "*!*@bad.example" c.forms) }
                                )
                                (onTab Bans base)
                    in
                    Expect.all
                        [ \_ -> query (onTab Bans base) |> Query.find [ testId "oc-ban-submit" ] |> Query.has [ Selector.disabled True ]
                        , \_ -> query typed |> Query.find [ testId "oc-ban-submit" ] |> Query.has [ Selector.disabled False ]
                        ]
                        ()
            , test "submitting stages the exact line for review, then confirm sends it" <|
                \_ ->
                    let
                        typed =
                            withConsole
                                (\c ->
                                    { c | forms = C.setField BanReason "spam wave" (C.setField BanPattern "*!*@bad.example" c.forms) }
                                )
                                (onTab Bans base)

                        ( staged, out1 ) =
                            update (OperConsoleMsg (C.Run (BanAdd typed.operConsole.forms.ban))) typed

                        ( _, out2 ) =
                            update (OperConsoleMsg C.Confirm) staged
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out1
                        , \_ -> query staged |> Query.find [ testId "oc-review-wire" ] |> Query.has [ Selector.text "KLINE ADD *!*@bad.example :spam wave" ]
                        , \_ -> query staged |> Query.find [ testId "oc-review-confirm" ] |> Event.simulate Event.click |> Event.expect (OperConsoleMsg C.Confirm)
                        , \_ -> query staged |> Query.find [ testId "oc-review-cancel" ] |> Event.simulate Event.click |> Event.expect (OperConsoleMsg C.Cancel)
                        , \_ ->
                            Expect.equal
                                [ SendLine "KLINE ADD *!*@bad.example :spam wave\u{000D}\n", SendLine "WARD LIST\u{000D}\n" ]
                                out2
                        ]
                        ()
            , test "the ward list renders the daemon's rows with a Lift button each" <|
                \_ ->
                    let
                        listed =
                            List.foldl (\raw m -> update (line raw) m |> Tuple.first)
                                (update (OperConsoleMsg (C.SelectTab Bans)) base |> Tuple.first)
                                [ ":onyx.test NOTICE root :WARD mask *!*@bad.example node/expel by root :spam wave"
                                , ":onyx.test NOTICE root :WARD address 203.0.113.0/24 mesh/refuse by ops :botnet"
                                , ":onyx.test NOTICE root :WARD: end of list"
                                ]
                    in
                    Expect.all
                        [ \q -> q |> Query.findAll [ testId "oc-ban-row" ] |> Query.count (Expect.equal 2)
                        , \q -> q |> Query.findAll [ testId "oc-ban-lift" ] |> Query.first |> Event.simulate Event.click |> Event.expect (OperConsoleMsg (C.Run (BanRemove { match = "mask", pattern = "*!*@bad.example" })))
                        ]
                        (query listed)
            , test "a refusal from the daemon shows in the Bans replies" <|
                \_ ->
                    let
                        asked =
                            update (OperConsoleMsg (C.Refresh Bans)) (onTab Bans base) |> Tuple.first

                        refused =
                            update (line ":onyx.test 481 root :Permission denied: requires the 'client_moderate' operator privilege") asked |> Tuple.first
                    in
                    query refused |> Query.find [ testId "oc-replies" ] |> Query.has [ Selector.text "Permission denied" ]
            , test "offline disables the form" <|
                \_ ->
                    let
                        typed =
                            withConsole
                                (\c ->
                                    { c | forms = C.setField BanReason "spam wave" (C.setField BanPattern "*!*@bad.example" c.forms) }
                                )
                                (onTab Bans { base | connection = Offline })
                    in
                    query typed |> Query.find [ testId "oc-ban-submit" ] |> Query.has [ Selector.disabled True ]
            ]
        , describe "appeals"
            [ test "an open appeal can be answered; the answer is staged, not sent" <|
                \_ ->
                    let
                        listed =
                            List.foldl (\raw m -> update (line raw) m |> Tuple.first)
                                (onTab Appeals base)
                                [ ":onyx.test NOTICE root :APPEAL 4 bob 203.0.113.9 open :please look again" ]

                        opening =
                            update (OperConsoleMsg (C.AnswerAppeal (Just 4))) listed |> Tuple.first
                    in
                    Expect.all
                        [ \_ -> query listed |> Query.findAll [ testId "oc-appeal" ] |> Query.count (Expect.equal 1)
                        , \_ -> query listed |> Query.find [ testId "oc-appeal-answer-open" ] |> Event.simulate Event.click |> Event.expect (OperConsoleMsg (C.AnswerAppeal (Just 4)))
                        , \_ -> query opening |> Query.findAll [ testId "oc-appeal-form" ] |> Query.count (Expect.equal 1)
                        ]
                        ()
            ]
        , describe "silence"
            [ test "the gag, shun and quarantine forms are present and disabled when empty" <|
                \_ ->
                    Expect.all
                        [ \q -> q |> Query.find [ testId "oc-shun-submit" ] |> Query.has [ Selector.disabled True ]
                        , \q -> q |> Query.find [ testId "oc-gag-submit" ] |> Query.has [ Selector.disabled True ]
                        , \q -> q |> Query.find [ testId "oc-q-submit" ] |> Query.has [ Selector.disabled True ]
                        ]
                        (query (onTab Silence base))
            ]
        , describe "content"
            [ test "filters list with a Remove each" <|
                \_ ->
                    let
                        listed =
                            List.foldl (\raw m -> update (line raw) m |> Tuple.first)
                                (onTab Content base)
                                [ ":onyx.test NOTICE root :FILTER LIST #1 free money", ":onyx.test NOTICE root :FILTER: End of filter list (1)" ]
                    in
                    query listed
                        |> Query.find [ testId "oc-filter-remove" ]
                        |> Event.simulate Event.click
                        |> Event.expect (OperConsoleMsg (C.Run (FilterRemove "free money")))
            ]
        , describe "network"
            [ test "the older controls kept their ids" <|
                \_ ->
                    Expect.all
                        [ \q -> q |> Query.findAll [ testId "oper-desk-privs" ] |> Query.count (Expect.equal 1)
                        , \q -> q |> Query.findAll [ testId "oper-desk-kill-form" ] |> Query.count (Expect.equal 1)
                        , \q -> q |> Query.findAll [ testId "oper-desk-observe-form" ] |> Query.count (Expect.equal 1)
                        , \q -> q |> Query.findAll [ testId "oc-report-run" ] |> Query.count (Expect.equal 1)
                        ]
                        (query (onTab Network base))
            ]
        , describe "the sheet stays gated"
            [ test "a person who is not an operator never gets the desk" <|
                \_ ->
                    query { base | isOper = False } |> Query.findAll [ testId "oc-tabs" ] |> Query.count (Expect.equal 0)
            ]
        , describe "wire parsing sanity"
            [ test "the console only reads server lines" <|
                \_ ->
                    let
                        ( m, _ ) =
                            update (line ":mallory!m@evil.example NOTICE root :WARD mask *!*@x.example node/expel by root :spam") base
                    in
                    Expect.equal [] m.operConsole.wards.incoming
            , test "a Set of filter categories is local state only" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (OperConsoleMsg (C.FeedToggleCategory "KILL")) base
                    in
                    Expect.equal ( Set.singleton "KILL", [] ) ( m.operConsole.feed.filter.categories, out )
            ]
        ]


