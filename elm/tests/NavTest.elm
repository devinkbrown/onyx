module NavTest exposing (suite)

{-| Vectors for the v3/shell-nav slice, ported from v3 `NavTest.elm`
(mirroring `shellNavigationModel.test.ts` and
`PrimaryNavigation.test.tsx`) and adapted to today's shell: the mobile
collection page is `clientRoomsOpen`, Home keeps the active
conversation (it is a location, not a deselect), and the You dialog
gathers the old identity-chip doors.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Nav
import Set
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


joined : Model
joined =
    { blank | caps = [] }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":me!u@h JOIN #d")
        |> (\m -> feed m ":bob!u@h PRIVMSG me :psst")


inRoom : Model
inRoom =
    step (ChannelSelect "#c") joined


render : Model -> Query.Single Msg
render model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


find : Nav.Id -> List Nav.Item -> Maybe Nav.Item
find id =
    List.filter (\item -> item.id == id) >> List.head


suite : Test
suite =
    describe "v3/shell-nav"
        [ modelSuite
        , foldSuite
        , filterSuite
        , viewSuite
        ]


modelSuite : Test
modelSuite =
    describe "Nav.items"
        [ test "keeps the canonical Home, Rooms, Messages, Calls, You ordering" <|
            \_ ->
                Expect.equal [ "Home", "Rooms", "Messages", "Calls", "You" ]
                    (List.map .label (Nav.items { variant = Nav.Desktop, current = Nav.Home, collectionOpen = False, youOpen = False }))
        , test "You is never the current location and always announces its dialog" <|
            \_ ->
                Expect.equal (Just ( False, Just "dialog", Just True ))
                    (Nav.items { variant = Nav.Desktop, current = Nav.You, collectionOpen = False, youOpen = True }
                        |> find Nav.You
                        |> Maybe.map (\i -> ( i.current, i.hasPopup, i.expanded ))
                    )
        , test "only the mobile collections carry an expanded page state" <|
            \_ ->
                let
                    state variant =
                        Nav.items { variant = variant, current = Nav.Rooms, collectionOpen = True, youOpen = False }
                            |> List.map .expanded
                in
                Expect.equal
                    ( state Nav.Desktop, state Nav.Mobile )
                    ( [ Nothing, Nothing, Nothing, Nothing, Just False ], [ Nothing, Just True, Just False, Nothing, Just False ] )
        , test "does not infer call state: Calls is current only when stored" <|
            \_ ->
                Expect.equal (Just True)
                    (Nav.items { variant = Nav.Mobile, current = Nav.Calls, collectionOpen = False, youOpen = False }
                        |> find Nav.Calls
                        |> Maybe.map .current
                    )
        , test "conversations live in rooms or messages by name" <|
            \_ ->
                Expect.equal
                    [ Nav.sectionFor (String.startsWith "#") "#c", Nav.sectionFor (String.startsWith "#") "bob" ]
                    [ Nav.Rooms, Nav.Messages ]
        ]


foldSuite : Test
foldSuite =
    describe "NavSelect fold"
        [ test "a fresh model sits on Home with nothing open" <|
            \_ ->
                Expect.equal ( blank.navSection, blank.clientRoomsOpen, blank.youOpen ) ( Nav.Home, False, False )
        , test "selecting a room moves to Rooms; a DM to Messages" <|
            \_ ->
                Expect.equal ( inRoom.navSection, (step (ChannelSelect "bob") inRoom).navSection ) ( Nav.Rooms, Nav.Messages )
        , test "re-selecting the active room from Home returns to Rooms" <|
            \_ ->
                Expect.equal Nav.Rooms (inRoom |> step (NavSelect Nav.Home) |> step (ChannelSelect "#c") |> .navSection)
        , test "Home keeps the conversation and closes calls, panels and search" <|
            \_ ->
                let
                    ( home, out ) =
                        update (NavSelect Nav.Home) { inRoom | searchOpen = True, callsOpen = True, clientMembersOpen = True, youOpen = True }
                in
                Expect.equal
                    ( ( home.navSection, home.activeChannel, out )
                    , ( home.callsOpen, home.clientMembersOpen, home.searchOpen || home.youOpen )
                    )
                    ( ( Nav.Home, Just "#c", [] ), ( False, False, False ) )
        , test "Rooms / Messages open the collection page and close calls" <|
            \_ ->
                let
                    rooms =
                        step (NavSelect Nav.Rooms) { inRoom | callsOpen = True }

                    again =
                        step (NavSelect Nav.Rooms) rooms

                    messages =
                        step (NavSelect Nav.Messages) rooms
                in
                Expect.equal
                    [ ( rooms.navSection, rooms.clientRoomsOpen, rooms.callsOpen )
                    , ( again.navSection, again.clientRoomsOpen, again.callsOpen )
                    , ( messages.navSection, messages.clientRoomsOpen, messages.callsOpen )
                    ]
                    [ ( Nav.Rooms, True, False ), ( Nav.Rooms, True, False ), ( Nav.Messages, True, False ) ]
        , test "picking a conversation pushes it over the collection page" <|
            \_ ->
                let
                    picked =
                        inRoom |> step (NavSelect Nav.Messages) |> step (ChannelSelect "bob")
                in
                Expect.equal ( picked.clientRoomsOpen, picked.navSection ) ( False, Nav.Messages )
        , test "back pops to the collection and moves focus to it" <|
            \_ ->
                let
                    ( back, out ) =
                        update NavBack inRoom
                in
                Expect.equal ( back.clientRoomsOpen, back.navSection, out ) ( True, Nav.Rooms, [ FocusElement "client-rooms" ] )
        , test "Calls toggles the hub and claims the location, then returns to the conversation" <|
            \_ ->
                let
                    opened =
                        step (NavSelect Nav.Calls) inRoom

                    closed =
                        step (NavSelect Nav.Calls) opened
                in
                Expect.equal
                    [ ( opened.callsOpen, opened.navSection ), ( closed.callsOpen, closed.navSection ) ]
                    [ ( True, Nav.Calls ), ( False, Nav.Rooms ) ]
        , test "the legacy calls toggle keeps the location in sync" <|
            \_ ->
                let
                    opened =
                        step ToggleCalls blank
                in
                Expect.equal [ opened.navSection, (step ToggleCalls opened).navSection ] [ Nav.Calls, Nav.Home ]
        , test "You toggles its dialog without becoming the location" <|
            \_ ->
                let
                    opened =
                        step (NavSelect Nav.You) inRoom
                in
                Expect.equal ( opened.youOpen, opened.navSection, (step YouClose opened).youOpen ) ( True, Nav.Rooms, False )
        , test "a You door closes the dialog before opening the next one" <|
            \_ ->
                let
                    next =
                        step (YouThen ConnectionDialogOpen) { inRoom | youOpen = True }
                in
                Expect.equal ( next.youOpen, next.connectionDialogOpen ) ( False, True )
        , test "Keep this name opens the claim sheet even after the chip was dismissed" <|
            \_ ->
                let
                    next =
                        step YouKeepName { inRoom | youOpen = True, guestClaimDismissed = True }
                in
                Expect.equal ( next.youOpen, next.guestClaimOpen ) ( False, True )
        , test "Escape no longer folds the phone collection page away" <|
            \_ ->
                Expect.equal True (step NavMenuEscape { inRoom | clientRoomsOpen = True }).clientRoomsOpen
        ]


filterSuite : Test
filterSuite =
    describe "collection filter"
        [ test "All / Unread / @Mentions / Favorites" <|
            \_ ->
                let
                    quiet =
                        { name = "#quiet", unread = 0, highlights = 0 }

                    busy =
                        { name = "#Busy", unread = 3, highlights = 0 }

                    pinged =
                        { name = "#pinged", unread = 1, highlights = 1 }

                    starred =
                        Set.fromList [ "#busy" ]

                    pass f =
                        List.filter (Nav.passesFilter f starred) [ quiet, busy, pinged ] |> List.map .name
                in
                Expect.equal
                    [ pass Nav.FilterAll, pass Nav.FilterUnread, pass Nav.FilterMentions, pass Nav.FilterFavorites ]
                    [ [ "#quiet", "#Busy", "#pinged" ], [ "#Busy", "#pinged" ], [ "#pinged" ], [ "#Busy" ] ]
        , test "the filter row is single-select with aria-pressed" <|
            \_ ->
                render (step (RailFilterSet Nav.FilterUnread) inRoom)
                    |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Filter conversations") ]
                    |> Query.findAll [ Selector.attribute (Attr.attribute "aria-pressed" "true") ]
                    |> Query.count (Expect.equal 1)
        , test "an empty filter says so politely" <|
            \_ ->
                render (step (RailFilterSet Nav.FilterMentions) inRoom)
                    |> Query.find [ Selector.class "onyx-rail-filter-empty" ]
                    |> Query.has [ Selector.attribute (Attr.attribute "role" "status"), Selector.text "No mentions waiting for you." ]
        , test "filter buttons dispatch" <|
            \_ ->
                render inRoom
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "rail-filter-favorites") ]
                    |> Event.simulate Event.click
                    |> Event.expect (RailFilterSet Nav.FilterFavorites)
        ]


viewSuite : Test
viewSuite =
    describe "rendered navigation"
        [ test "both variants render with their landmarks" <|
            \_ ->
                Expect.all
                    [ \q -> Query.has [ Selector.tag "nav", Selector.attribute (Attr.attribute "aria-label" "Primary") ] q
                    , \q -> Query.has [ Selector.tag "nav", Selector.attribute (Attr.attribute "aria-label" "Mobile navigation") ] q
                    ]
                    (render inRoom)
        , test "the current location carries aria-current=page in both variants" <|
            \_ ->
                render inRoom
                    |> Query.findAll [ Selector.attribute (Attr.attribute "aria-current" "page") ]
                    |> Query.each (Query.has [ Selector.attribute (Attr.attribute "data-section" "rooms") ])
        , test "unread totals are spelled out for screen readers" <|
            \_ ->
                render (feed inRoom ":carol!u@h PRIVMSG #d :hi me")
                    |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "nav-rooms") ]
                    |> Query.first
                    |> Query.has [ Selector.text ", 1 unread" ]
        , test "Rooms shows only rooms; Messages only direct conversations; Home both" <|
            \_ ->
                let
                    rail model =
                        render model |> Query.find [ Selector.id "client-rooms" ]
                in
                Expect.all
                    [ \_ -> rail inRoom |> Query.hasNot [ Selector.text "Direct messages" ]
                    , \_ -> rail { inRoom | navSection = Nav.Messages } |> Query.hasNot [ Selector.text "Browse rooms" ]
                    , \_ -> rail { inRoom | navSection = Nav.Messages } |> Query.has [ Selector.text "bob" ]
                    , \_ -> rail { inRoom | navSection = Nav.Home } |> Query.has [ Selector.text "Direct messages", Selector.text "#d" ]
                    ]
                    ()
        , test "Home shows the Home pane, not the conversation" <|
            \_ ->
                let
                    q =
                        render (step (NavSelect Nav.Home) inRoom)
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.attribute (Attr.attribute "data-testid" "home") ] q
                    , \_ -> Query.hasNot [ Selector.class "onyx-composer" ] q
                    ]
                    ()
        , test "Home lists what needs you and opens it" <|
            \_ ->
                render (step (NavSelect Nav.Home) inRoom)
                    |> Query.find [ Selector.class "onyx-home-row" ]
                    |> Event.simulate Event.click
                    |> Event.expect (ChannelSelect "bob")
        , test "a pushed conversation offers a labelled back control" <|
            \_ ->
                render inRoom
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "room-back") ]
                    |> Expect.all
                        [ Query.has [ Selector.attribute (Attr.attribute "aria-label" "Back to Rooms") ]
                        , Event.simulate Event.click >> Event.expect NavBack
                        ]
        , test "Home has no back control and no conversation tools" <|
            \_ ->
                let
                    q =
                        render (step (NavSelect Nav.Home) inRoom)
                in
                Expect.all
                    [ \_ -> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "room-back") ] q |> Query.count (Expect.equal 0)
                    , \_ -> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "ribbon-pins") ] q |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "the You dialog is a labelled modal with doors" <|
            \_ ->
                render (step (NavSelect Nav.You) inRoom)
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "you-dialog") ]
                    |> Expect.all
                        [ Query.has [ Selector.attribute (Attr.attribute "role" "dialog"), Selector.attribute (Attr.attribute "aria-labelledby" "you-title") ]
                        , Query.find [ Selector.attribute (Attr.attribute "aria-label" "Close You") ] >> Event.simulate Event.click >> Event.expect YouClose
                        , Query.find [ Selector.attribute (Attr.attribute "data-testid" "you-connection") ] >> Event.simulate Event.click >> Event.expect (YouThen ConnectionDialogOpen)
                        ]
        , test "a signed-in You offers account settings" <|
            \_ ->
                render { inRoom | youOpen = True, accountName = Just "alice" }
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-open") ]
                    |> Event.simulate Event.click
                    |> Event.expect (YouThen (SetAccountOpen True))
        , test "the channel map is untouched by navigation" <|
            \_ -> Expect.equal (Dict.keys inRoom.channels) (Dict.keys (step (NavSelect Nav.Home) inRoom).channels)
        ]
