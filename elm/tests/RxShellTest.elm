module RxShellTest exposing (suite)

{-| v3/rx-shell — the sidebar row menu (Favorite, Mark as read,
Notifications, Leave; Mark as read + Mute for DMs) through
`App.update` and `View.view`, its place in the ONE Escape order, the
pointer anchoring, the empty Rooms / Messages collections and the
topbar New conversation entry.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Nav
import Switcher
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


outs : Msg -> Model -> List Outbound
outs msg model =
    Tuple.second (update msg model)


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


attr : String -> String -> Selector.Selector
attr name value =
    Selector.attribute (Attr.attribute name value)


{-| Two rooms (one waiting with a mention) and a DM; #c is open. -}
busy : Model
busy =
    { blank | ourNick = "me", caps = [], endpoint = Just "wss://onyx.example/ws" }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":me!u@h JOIN #b")
        |> step (ChannelSelect "#c")
        |> (\m -> feed m ":bob!u@h PRIVMSG #b :me: look")
        |> (\m -> feed m ":carol!u@h PRIVMSG me :psst")


at : String -> Float -> Float -> RailMenu
at name x y =
    { name = name, x = x, y = y, vw = 1440, vh = 900, leaving = False }


keyboard : String -> RailMenu
keyboard name =
    { name = name, x = 0, y = 0, vw = 1440, vh = 900, leaving = False }


unreadOf : String -> Model -> Int
unreadOf name model =
    Dict.get (String.toLower name) model.channels |> Maybe.map .unread |> Maybe.withDefault -1


clickAt : Float -> Float -> Int -> Encode.Value
clickAt x y detail =
    Encode.object
        [ ( "clientX", Encode.float x )
        , ( "clientY", Encode.float y )
        , ( "detail", Encode.int detail )
        , ( "view", Encode.object [ ( "innerWidth", Encode.float 1440 ), ( "innerHeight", Encode.float 900 ) ] )
        ]


suite : Test
suite =
    describe "v3/rx-shell"
        [ describe "row menu"
            [ test "every room and DM row carries the overflow control" <|
                \_ ->
                    query busy
                        |> Query.find [ Selector.class "onyx-rail" ]
                        |> Query.findAll [ testId "sidebar-row-more" ]
                        |> Query.count (Expect.equal 3)
            , test "a pointer click opens the menu at the pointer; a key press opens it unanchored" <|
                \_ ->
                    let
                        more =
                            query busy
                                |> Query.find [ attr "aria-label" "Room options for #b" ]
                    in
                    Expect.all
                        [ \_ -> more |> Event.simulate (Event.custom "click" (clickAt 300 120 1)) |> Event.expect (RailMenuOpen (at "#b" 300 120))
                        , \_ -> more |> Event.simulate (Event.custom "click" (clickAt 300 120 0)) |> Event.expect (RailMenuOpen (keyboard "#b"))
                        ]
                        ()
            , test "a context menu on the row opens it too (right-click, Android long-press)" <|
                \_ ->
                    query busy
                        |> Query.find [ Selector.class "onyx-rail-row", Selector.containing [ attr "aria-label" "Room options for #b" ] ]
                        |> Event.simulate
                            (Event.custom "contextmenu"
                                (Encode.object
                                    [ ( "clientX", Encode.float 90 )
                                    , ( "clientY", Encode.float 700 )
                                    , ( "target", Encode.object [ ( "tagName", Encode.string "SPAN" ) ] )
                                    , ( "view", Encode.object [ ( "innerWidth", Encode.float 1440 ), ( "innerHeight", Encode.float 900 ) ] )
                                    ]
                                )
                            )
                        |> Event.expect (RailMenuOpen (at "#b" 90 700))
            , test "the room menu offers Favorite, Mark as read, Notifications and Leave" <|
                \_ ->
                    let
                        menu =
                            query (step (RailMenuOpen (keyboard "#b")) busy) |> Query.find [ testId "rail-menu" ]
                    in
                    Expect.all
                        [ \_ -> menu |> Query.has [ attr "role" "dialog", Selector.text "#b" ]
                        , \_ -> menu |> Query.find [ testId "rail-menu-favorite" ] |> Event.simulate Event.click |> Event.expect (SidebarStarToggle "#b")
                        , \_ -> menu |> Query.find [ testId "rail-menu-read" ] |> Event.simulate Event.click |> Event.expect (RailMarkRead "#b")
                        , \_ -> menu |> Query.find [ testId "room-notify" ] |> Query.has [ attr "role" "radiogroup" ]
                        , \_ -> menu |> Query.find [ testId "rail-menu-leave" ] |> Event.simulate Event.click |> Event.expect RailLeaveAsk
                        , \_ -> menu |> Query.hasNot [ testId "rail-menu-mute" ]
                        ]
                        ()
            , test "the DM menu offers Mark as read and Mute, never Leave" <|
                \_ ->
                    let
                        menu =
                            query (step (RailMenuOpen (keyboard "carol")) busy) |> Query.find [ testId "rail-menu" ]
                    in
                    Expect.all
                        [ \_ -> menu |> Query.find [ testId "rail-menu-mute" ] |> Event.simulate Event.click |> Event.expect (MuteDm "carol")
                        , \_ -> menu |> Query.hasNot [ testId "rail-menu-leave" ]
                        , \_ -> menu |> Query.hasNot [ testId "rail-menu-favorite" ]
                        ]
                        ()
            , test "Mark as read is disabled with nothing waiting" <|
                \_ ->
                    query (step (RailMenuOpen (keyboard "#c")) busy)
                        |> Query.find [ testId "rail-menu-read" ]
                        |> Query.has [ Selector.disabled True ]
            , test "a pointer open anchors at the pointer; a keyboard open stays unanchored" <|
                \_ ->
                    Expect.all
                        [ \_ -> query (step (RailMenuOpen (at "#b" 300 120)) busy) |> Query.find [ Selector.class "onyx-railmenu-layer" ] |> Query.has [ attr "data-anchored" "true" ]
                        , \_ -> query (step (RailMenuOpen (at "#b" 300 120)) busy) |> Query.find [ testId "rail-menu" ] |> Query.has [ Selector.style "left" "296px", Selector.style "top" "124px" ]
                        , \_ -> query (step (RailMenuOpen (at "#b" 300 800)) busy) |> Query.find [ testId "rail-menu" ] |> Query.has [ Selector.style "bottom" "104px" ]
                        , \_ -> query (step (RailMenuOpen (keyboard "#b")) busy) |> Query.find [ Selector.class "onyx-railmenu-layer" ] |> Query.has [ attr "data-anchored" "false" ]
                        , \_ -> query (step (RailMenuOpen { name = "#b", x = 200, y = 300, vw = 390, vh = 844, leaving = False }) busy) |> Query.find [ Selector.class "onyx-railmenu-layer" ] |> Query.has [ attr "data-anchored" "false" ]
                        ]
                        ()
            , test "Mark as read clears the room and closes the menu" <|
                \_ ->
                    let
                        after =
                            busy |> step (RailMenuOpen (keyboard "#b")) |> step (RailMarkRead "#b")
                    in
                    Expect.equal ( unreadOf "#b" busy > 0, unreadOf "#b" after, after.railMenu ) ( True, 0, Nothing )
            , test "Leave parts the room; a DM sends nothing" <|
                \_ ->
                    Expect.equal
                        ( outs (RailLeave "#b") (step (RailMenuOpen (keyboard "#b")) busy)
                        , outs (RailLeave "carol") busy
                        , (step (RailLeave "#b") (step (RailMenuOpen (keyboard "#b")) busy)).railMenu
                        )
                        ( [ SendLine "PART #b\u{000D}\n" ], [], Nothing )
            , test "Leave room asks first: the menu swaps to Stay / Leave, Stay returns, Leave parts" <|
                \_ ->
                    let
                        asked =
                            busy |> step (RailMenuOpen (keyboard "#b")) |> step RailLeaveAsk

                        confirm =
                            query asked |> Query.find [ testId "rail-menu" ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Maybe.map .leaving asked.railMenu) (Just True)
                        , \_ -> Expect.equal (outs RailLeaveAsk (step (RailMenuOpen (keyboard "#b")) busy)) []
                        , \_ -> confirm |> Query.has [ Selector.text "Leave #b?" ]
                        , \_ -> confirm |> Query.hasNot [ testId "rail-menu-favorite" ]
                        , \_ -> confirm |> Query.hasNot [ testId "rail-menu-leave" ]
                        , \_ -> confirm |> Query.find [ testId "rail-menu-leave-cancel" ] |> Event.simulate Event.click |> Event.expect RailLeaveCancel
                        , \_ -> confirm |> Query.find [ testId "rail-menu-leave-confirm" ] |> Event.simulate Event.click |> Event.expect (RailLeave "#b")
                        , \_ -> Expect.equal (Maybe.map .leaving (step RailLeaveCancel asked).railMenu) (Just False)
                        ]
                        ()
            , test "asking to leave needs an open menu on a room (a DM, or none, does nothing)" <|
                \_ ->
                    Expect.equal
                        [ (step RailLeaveAsk busy).railMenu |> Maybe.map .leaving
                        , (busy |> step (RailMenuOpen (keyboard "carol")) |> step RailLeaveAsk).railMenu |> Maybe.map .leaving
                        ]
                        [ Nothing, Just False ]
            , test "Favorite and Mute close the menu; the room going away closes it" <|
                \_ ->
                    Expect.equal
                        [ (busy |> step (RailMenuOpen (keyboard "#b")) |> step (SidebarStarToggle "#b")).railMenu
                        , (busy |> step (RailMenuOpen (keyboard "carol")) |> step (MuteDm "carol")).railMenu
                        , (busy |> step (RailMenuOpen (keyboard "#b")) |> (\m -> feed m ":me!u@h PART #b")).railMenu
                        ]
                        [ Nothing, Nothing, Nothing ]
            , test "a notification level keeps the menu open" <|
                \_ ->
                    (busy |> step (RailMenuOpen (keyboard "#b")) |> step (RoomNotifyLevel { channel = "#b", level = "none" })).railMenu
                        |> Expect.equal (Just (keyboard "#b"))
            , test "Escape closes it through the one overlay order; unknown rows never open" <|
                \_ ->
                    let
                        opened =
                            step (RailMenuOpen (keyboard "#b")) busy
                    in
                    Expect.equal
                        ( List.member "rail-menu" (List.map Tuple.first (overlayStack opened))
                        , (step (ShortcutPressed Switcher.Dismiss) opened).railMenu
                        , (step (RailMenuOpen (keyboard "#nowhere")) busy).railMenu
                        )
                        ( True, Nothing, Nothing )
            , test "the open row is marked for its hover actions" <|
                \_ ->
                    query (step (RailMenuOpen (keyboard "#b")) busy)
                        |> Query.find [ attr "aria-label" "Room options for #b" ]
                        |> Query.has [ attr "aria-expanded" "true" ]
            ]
        , describe "empty collections"
            [ test "an empty Rooms collection offers Browse rooms and Start a room" <|
                \_ ->
                    let
                        empty =
                            query (step (NavSelect Nav.Rooms) blank) |> Query.find [ testId "sidebar-rooms-empty" ]
                    in
                    Expect.all
                        [ \_ -> empty |> Query.has [ Selector.text "No rooms yet" ]
                        , \_ -> empty |> Query.find [ testId "sidebar-empty-browse" ] |> Event.simulate Event.click |> Event.expect BrowserOpen
                        , \_ -> empty |> Query.find [ testId "sidebar-empty-start" ] |> Event.simulate Event.click |> Event.expect CreateRoomOpen
                        ]
                        ()
            , test "the empty Messages page offers New message" <|
                \_ ->
                    query (step (NavSelect Nav.Messages) blank)
                        |> Query.find [ testId "sidebar-dms-empty" ]
                        |> Query.find [ testId "sidebar-empty-new" ]
                        |> Event.simulate Event.click
                        |> Event.expect NewMessageOpen
            ]
        , test "the rail's hover label spells the totals out" <|
            \_ ->
                query busy
                    |> Query.find [ attr "aria-label" "Primary" ]
                    |> Query.find [ attr "data-section" "rooms" ]
                    |> Query.find [ Selector.class "onyx-nav-label-count" ]
                    |> Query.has [ Selector.text ", 1 with mentions" ]
        , test "the tab title counts the other conversations waiting" <|
            \_ ->
                Expect.equal
                    ( (View.view busy).title, (View.view (busy |> step (ChannelSelect "#b") |> step (ChannelSelect "carol"))).title )
                    ( "(2) #c — Onyx", "carol — Onyx" )
        , test "New conversation is reachable from inside a room (the topbar)" <|
            \_ ->
                query busy
                    |> Query.find [ Selector.class "onyx-topbar" ]
                    |> Query.find [ testId "topbar-new-conversation" ]
                    |> Event.simulate Event.click
                    |> Event.expect NewMessageOpen
        ]
