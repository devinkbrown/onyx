module ShellTest exposing (suite)

{-| v3/ui-mobile-shell — the app frame and navigation: the phone back
control, the
collection page staying open with no conversation behind it, the You
hub yielding to Notifications, the guest chip's home on Home, the
frame's conversation marker, nav totals, the collection sidebar and
the phone page title.
-}

import App exposing (..)
import Expect
import Html
import Html.Attributes as Attr
import Nav
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


attr : String -> String -> Selector.Selector
attr name value =
    Selector.attribute (Attr.attribute name value)


inRoom : Model
inRoom =
    { blank | ourNick = "me", caps = [] }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":s 353 me = #c :me @alice bob")
        |> step (ChannelSelect "#c")


inDm : Model
inDm =
    inRoom |> step (ChannelSelect "bob")


suite : Test
suite =
    describe "v3/ui-mobile-shell"
        [ navSuite
        , frameSuite
        ]


navSuite : Test
navSuite =
    describe "navigation"
        [ test "the back control returns to the collection the conversation lives in" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        query inRoom
                            |> Query.find [ testId "room-back" ]
                            |> Event.simulate Event.click
                            |> Event.expect (NavSelect Nav.Rooms)
                    , \_ ->
                        query inDm
                            |> Query.find [ testId "room-back" ]
                            |> Event.simulate Event.click
                            |> Event.expect (NavSelect Nav.Messages)
                    , \_ -> Expect.equal ( True, Nav.Rooms ) ((\m -> ( m.navDrawerOpen, m.navSection )) (step (NavSelect Nav.Rooms) inRoom))
                    ]
                    ()
        , test "the back control counts other conversations waiting" <|
            \_ ->
                feed inRoom ":me!u@h JOIN #b"
                    |> (\m -> feed m ":bob!u@h PRIVMSG #b :hey")
                    |> query
                    |> Query.find [ testId "room-back" ]
                    |> Query.has [ attr "aria-label" "Back to Rooms, 1 with new messages" ]
        , test "with no conversation behind it, the collection page stays open" <|
            \_ ->
                let
                    once =
                        step (NavSelect Nav.Rooms) blank
                in
                Expect.equal [ once.navDrawerOpen, (step (NavSelect Nav.Rooms) once).navDrawerOpen ] [ True, True ]
        , test "Notifications from the You hub replaces the hub" <|
            \_ ->
                let
                    next =
                        step NotifySheetOpen { inRoom | youHubOpen = True }
                in
                Expect.equal ( next.notifySheetOpen, next.youHubOpen ) ( True, False )
        , test "the You hub entry opens Notifications" <|
            \_ ->
                query { inRoom | youHubOpen = True }
                    |> Query.find [ testId "shell-notifications" ]
                    |> Event.simulate Event.click
                    |> Event.expect NotifySheetOpen
        , test "nav items total unread rooms and DMs; mentions take the accent badge" <|
            \_ ->
                let
                    busy =
                        feed inRoom ":me!u@h JOIN #b"
                            |> (\m -> feed m ":bob!u@h PRIVMSG #b :me: look")
                            |> (\m -> feed m ":carol!u@h PRIVMSG me :psst")

                    mobile =
                        query busy |> Query.find [ attr "aria-label" "Mobile navigation" ]
                in
                Expect.all
                    [ \_ -> mobile |> Query.find [ attr "data-section" "rooms" ] |> Query.has [ attr "aria-label" "Open Rooms, 1 with mentions" ]
                    , \_ -> mobile |> Query.find [ attr "data-section" "rooms" ] |> Query.find [ Selector.class "onyx-nav-badge" ] |> Query.has [ Selector.class "onyx-nav-badge--mention", Selector.text "1" ]
                    , \_ -> mobile |> Query.find [ attr "data-section" "messages" ] |> Query.has [ attr "aria-label" "Open Messages, 1 unread" ]
                    , \_ -> query inRoom |> Query.findAll [ Selector.class "onyx-nav-badge" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "the sidebar shows the selected collection" <|
            \_ ->
                Expect.equal
                    [ query inRoom |> Query.find [ Selector.class "onyx-rail" ] |> Query.has [ attr "data-collection" "rooms" ]
                    , query inDm |> Query.find [ Selector.class "onyx-rail" ] |> Query.has [ attr "data-collection" "messages" ]
                    , query blank |> Query.find [ Selector.class "onyx-rail" ] |> Query.has [ attr "data-collection" "all" ]
                    ]
                    [ Expect.pass, Expect.pass, Expect.pass ]
        , test "the phone bar names the open page" <|
            \_ ->
                Expect.all
                    [ \_ -> query (step (NavSelect Nav.Rooms) inRoom) |> Query.find [ Selector.class "onyx-topbar-title" ] |> Query.has [ Selector.text "Rooms" ]
                    , \_ -> query inRoom |> Query.hasNot [ Selector.class "onyx-topbar-title" ]
                    , \_ -> query { inRoom | callsOpen = True } |> Query.find [ Selector.class "onyx-topbar-title" ] |> Query.has [ Selector.text "Calls" ]
                    ]
                    ()
        ]


frameSuite : Test
frameSuite =
    describe "frame"
        [ test "the frame marks an open conversation" <|
            \_ ->
                Expect.all
                    [ \_ -> query inRoom |> Query.find [ Selector.class "onyx-frame" ] |> Query.has [ attr "data-convo" "room" ]
                    , \_ -> query inDm |> Query.find [ Selector.class "onyx-frame" ] |> Query.has [ attr "data-convo" "dm" ]
                    , \_ -> query blank |> Query.find [ Selector.class "onyx-frame" ] |> Query.has [ attr "data-convo" "false" ]
                    , \_ -> query { inRoom | callsOpen = True } |> Query.find [ Selector.class "onyx-frame" ] |> Query.has [ attr "data-convo" "false" ]
                    ]
                    ()
        , test "on the Messages page New sits in the filter row, once" <|
            \_ ->
                Expect.all
                    [ \_ -> query inDm |> Query.find [ Selector.class "onyx-rail-filter" ] |> Query.has [ testId "new-conversation" ]
                    , \_ -> query inDm |> Query.findAll [ testId "new-conversation" ] |> Query.count (Expect.equal 1)
                    , \_ -> query inRoom |> Query.find [ testId "sidebar-dms" ] |> Query.has [ testId "new-conversation" ]
                    ]
                    ()
        , test "the guest chip lives on Home, never over a conversation" <|
            \_ ->
                Expect.all
                    [ \_ -> query { blank | ourNick = "kai" } |> Query.find [ testId "home" ] |> Query.has [ testId "guest-claim" ]
                    , \_ -> query inRoom |> Query.hasNot [ testId "guest-claim" ]
                    , \_ -> query { blank | ourNick = "kai" } |> Query.find [ Selector.class "onyx-notices" ] |> Query.hasNot [ testId "guest-claim" ]
                    ]
                    ()
        , test "the connection pill keeps its words for assistive tech" <|
            \_ ->
                query { inRoom | connection = Live }
                    |> Query.find [ Selector.class "onyx-conn" ]
                    |> Query.has [ Selector.class "onyx-conn-live", Selector.text "Live" ]
        ]
