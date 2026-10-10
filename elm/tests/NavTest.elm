module NavTest exposing (suite)

{-| Vectors for the v3/nav slice: the shell navigation model
(mirroring `src/shell/navigation/shellNavigationModel.test.ts`), the
`NavSelect` / `YouHubGo` folds and the rendered rail, bottom bar,
identity chip and You hub (mirroring `PrimaryNavigation.test.tsx`,
`YouSettings` and the `Account.tsx` guest branch).
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes
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


inRoom : Model
inRoom =
    { blank | caps = [] }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> step (ChannelSelect "#c")


signedIn : Model
signedIn =
    { inRoom | accountName = Just "alice" }


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


strip : Nav.Item -> ( Nav.Id, ( Bool, Bool ), ( Maybe Bool, Maybe String ) )
strip item =
    ( item.id, ( item.current, item.selected ), ( item.expanded, item.hasPopup ) )


find : Nav.Id -> List Nav.Item -> Maybe Nav.Item
find id =
    List.filter (\item -> item.id == id) >> List.head


suite : Test
suite =
    describe "v3/nav"
        [ modelSuite
        , foldSuite
        , youSuite
        , viewSuite
        ]


modelSuite : Test
modelSuite =
    let
        input variant =
            { variant = variant
            , current = Just Nav.Rooms
            , selectedCollection = Just Nav.Messages
            , expandedCollection = Just (Just Nav.Messages)
            , youDialogOpen = Just True
            }
    in
    describe "Nav.items (createShellNavigationModel)"
        [ test "keeps the canonical Home, Rooms, Messages, Calls, You ordering for both variants" <|
            \_ ->
                Expect.all
                    (List.map
                        (\( variant, landmark ) ->
                            \_ ->
                                let
                                    model =
                                        Nav.items { variant = variant, current = Just Nav.Home, selectedCollection = Nothing, expandedCollection = Nothing, youDialogOpen = Nothing }
                                in
                                Expect.equal
                                    ( List.map .label model, List.all (\i -> i.landmarkLabel == landmark) model )
                                    ( [ "Home", "Rooms", "Messages", "Calls", "You" ], True )
                        )
                        [ ( Nav.Desktop, "Primary" ), ( Nav.Mobile, "Mobile navigation" ) ]
                    )
                    ()
        , test "uses the same destinations and state semantics on mobile and desktop" <|
            \_ ->
                let
                    desktop =
                        Nav.items (input Nav.Desktop)

                    mobile =
                        Nav.items (input Nav.Mobile)
                in
                Expect.all
                    [ \_ -> Expect.equal (List.map strip desktop) (List.map strip mobile)
                    , \_ -> Expect.equal [ "Open Home", "Open Rooms", "Open Messages", "Open Calls", "Open You" ] (List.map .actionLabel mobile)
                    , \_ -> Expect.equal [ "Home", "Rooms", "Messages", "Calls", "You" ] (List.map .actionLabel desktop)
                    ]
                    ()
        , test "separates current location, selected collection, expanded collection, and transient You dialog" <|
            \_ ->
                let
                    model =
                        Nav.items (input Nav.Mobile)
                in
                Expect.equal
                    [ Maybe.map strip (find Nav.Rooms model)
                    , Maybe.map strip (find Nav.Messages model)
                    , Maybe.map strip (find Nav.You model)
                    ]
                    [ Just ( Nav.Rooms, ( True, False ), ( Just False, Nothing ) )
                    , Just ( Nav.Messages, ( False, True ), ( Just True, Nothing ) )
                    , Just ( Nav.You, ( False, False ), ( Just True, Just "dialog" ) )
                    ]
        , test "does not infer connection, account or call state" <|
            \_ ->
                Expect.equal
                    (Nav.items { variant = Nav.Desktop, current = Just Nav.Calls, selectedCollection = Nothing, expandedCollection = Nothing, youDialogOpen = Nothing }
                        |> find Nav.Calls
                    )
                    (Just { id = Nav.Calls, label = "Calls", landmarkLabel = "Primary", actionLabel = "Calls", current = True, selected = False, expanded = Nothing, hasPopup = Nothing })
        , test "keeps optional disclosure state absent instead of silently converting it to false" <|
            \_ ->
                let
                    model =
                        Nav.items { variant = Nav.Desktop, current = Just Nav.Home, selectedCollection = Nothing, expandedCollection = Nothing, youDialogOpen = Nothing }
                in
                Expect.equal
                    ( Maybe.map .expanded (find Nav.Rooms model), Maybe.map .expanded (find Nav.You model) )
                    ( Just Nothing, Just Nothing )
        , test "You is never a current location" <|
            \_ ->
                Expect.equal (Just False)
                    (Nav.items { variant = Nav.Desktop, current = Just Nav.You, selectedCollection = Nothing, expandedCollection = Nothing, youDialogOpen = Nothing }
                        |> find Nav.You
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
        [ test "fresh model sits on Home with nothing open" <|
            \_ ->
                Expect.equal ( blank.navSection, blank.navDrawerOpen, blank.youHubOpen ) ( Nav.Home, False, False )
        , test "selecting a room moves the location to Rooms; a DM to Messages" <|
            \_ ->
                let
                    dm =
                        inRoom |> step (ChannelSelect "bob")
                in
                Expect.equal ( inRoom.navSection, dm.navSection ) ( Nav.Rooms, Nav.Messages )
        , test "Home deselects the active conversation and closes room-scoped panels" <|
            \_ ->
                let
                    ( home, out ) =
                        update (NavSelect Nav.Home) { inRoom | searchOpen = True, callsOpen = True, youHubOpen = True }
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing home.activeChannel
                    , \_ -> Expect.equal Nav.Home home.navSection
                    , \_ -> Expect.equal ( False, False, False ) ( home.searchOpen, home.callsOpen, home.youHubOpen )
                    , \_ -> Expect.equal [] out
                    , \_ -> Expect.equal True (Dict.member "#c" home.channels)
                    ]
                    ()
        , test "Calls toggles the existing calls hub and claims the Calls location" <|
            \_ ->
                let
                    opened =
                        inRoom |> step (NavSelect Nav.Calls)

                    closed =
                        opened |> step (NavSelect Nav.Calls)
                in
                Expect.equal
                    [ ( opened.callsOpen, opened.navSection ), ( closed.callsOpen, closed.navSection ) ]
                    [ ( True, Nav.Calls ), ( False, Nav.Rooms ) ]
        , test "the topbar Calls toggle keeps the location in sync" <|
            \_ ->
                let
                    opened =
                        blank |> step ToggleCalls

                    closed =
                        opened |> step ToggleCalls
                in
                Expect.equal [ opened.navSection, closed.navSection ] [ Nav.Calls, Nav.Home ]
        , test "returning to a call from the hub lands on the call's collection" <|
            \_ ->
                let
                    back =
                        { inRoom | callsOpen = True, navSection = Nav.Calls } |> step (CallsReturnToCall "bob")
                in
                Expect.equal ( back.callsOpen, back.navSection, back.activeChannel ) ( False, Nav.Messages, Just "bob" )
        , test "Rooms / Messages select the collection, close calls and toggle the drawer" <|
            \_ ->
                let
                    rooms =
                        { inRoom | callsOpen = True } |> step (NavSelect Nav.Rooms)

                    again =
                        rooms |> step (NavSelect Nav.Rooms)

                    messages =
                        rooms |> step (NavSelect Nav.Messages)
                in
                Expect.equal
                    [ ( rooms.navSection, rooms.navDrawerOpen, rooms.callsOpen )
                    , ( again.navSection, again.navDrawerOpen, again.callsOpen )
                    , ( messages.navSection, messages.navDrawerOpen, messages.callsOpen )
                    ]
                    [ ( Nav.Rooms, True, False ), ( Nav.Rooms, False, False ), ( Nav.Messages, True, False ) ]
        , test "picking a conversation folds the drawer away" <|
            \_ ->
                let
                    picked =
                        inRoom |> step (NavSelect Nav.Messages) |> step (ChannelSelect "bob")
                in
                Expect.equal ( picked.navDrawerOpen, picked.navSection ) ( False, Nav.Messages )
        , test "You toggles the hub without becoming the location" <|
            \_ ->
                let
                    opened =
                        inRoom |> step (NavSelect Nav.You)
                in
                Expect.equal
                    [ ( opened.youHubOpen, opened.navSection ), ( (step (NavSelect Nav.You) opened).youHubOpen, opened.navSection ) ]
                    [ ( True, Nav.Rooms ), ( False, Nav.Rooms ) ]
        , test "a location choice closes the hub" <|
            \_ ->
                Expect.equal False ({ inRoom | youHubOpen = True } |> step (NavSelect Nav.Rooms)).youHubOpen
        ]


youSuite : Test
youSuite =
    describe "YouHubGo fold"
        [ test "Account opens the existing account panel when signed in" <|
            \_ ->
                let
                    ( next, out ) =
                        update (YouHubGo Nav.YouAccount) { signedIn | youHubOpen = True }

                    ( viaMsg, msgOut ) =
                        update (SetAccountOpen True) signedIn
                in
                Expect.equal ( next.youHubOpen, next.accountOpen, out ) ( False, True, msgOut )
        , test "guest Keep this name opens the guest-claim sheet without disconnecting" <|
            \_ ->
                let
                    ( next, out ) =
                        update (YouHubGo Nav.YouAccount) { inRoom | youHubOpen = True }
                in
                Expect.equal ( next.youHubOpen, next.guestClaimOpen, out ) ( False, True, [] )
        , test "Keep this name reaches the sheet even after the chip was dismissed" <|
            \_ ->
                let
                    next =
                        { inRoom | guestClaimDismissed = True } |> step (YouHubGo Nav.YouAccount)
                in
                Expect.equal ( next.guestClaimOpen, next.guestClaimDismissed ) ( True, True )
        , test "a guest with no name gets no sheet" <|
            \_ ->
                Expect.equal False ({ inRoom | ourNick = "  " } |> step (YouHubGo Nav.YouAccount)).guestClaimOpen
        , test "Appearance and Help entries navigate in-app" <|
            \_ ->
                Expect.equal
                    (List.map (\a -> Tuple.second (update (YouHubGo a) inRoom))
                        [ Nav.YouAppearance, Nav.YouGuides, Nav.YouAbout, Nav.YouStatus ]
                    )
                    [ [ PushUrl "/appearance" ], [ PushUrl "/guides" ], [ PushUrl "/about" ], [ PushUrl "/status" ] ]
        , test "Leave is the existing session disconnect" <|
            \_ ->
                let
                    ( next, out ) =
                        update (YouHubGo Nav.YouLeave) { inRoom | youHubOpen = True }

                    ( direct, directOut ) =
                        update SessionDisconnect inRoom
                in
                Expect.equal ( next.youHubOpen, next.autoReconnect, out ) ( False, direct.autoReconnect, directOut )
        , test "YouHubClose closes the hub" <|
            \_ ->
                Expect.equal False ({ inRoom | youHubOpen = True } |> step YouHubClose).youHubOpen
        ]


viewSuite : Test
viewSuite =
    describe "nav views"
        [ test "desktop rail renders five destinations with Home current on a fresh shell" <|
            \_ ->
                let
                    rail =
                        query blank |> Query.find [ Selector.attribute (attr "aria-label" "Primary") ]
                in
                Expect.all
                    [ \_ -> rail |> Query.findAll [ Selector.tag "button" ] |> Query.count (Expect.equal 5)
                    , \_ ->
                        rail
                            |> Query.find [ Selector.attribute (attr "data-section" "home") ]
                            |> Query.has [ Selector.attribute (attr "aria-current" "page"), Selector.attribute (attr "title" "Quick switch to Home") ]
                    , \_ ->
                        rail
                            |> Query.find [ Selector.attribute (attr "data-section" "you") ]
                            |> Query.has [ Selector.attribute (attr "aria-haspopup" "dialog"), Selector.attribute (attr "aria-expanded" "false") ]
                    , \_ ->
                        rail
                            |> Query.find [ Selector.attribute (attr "data-section" "rooms") ]
                            |> Query.has [ Selector.attribute (attr "aria-pressed" "false") ]
                    ]
                    ()
        , test "mobile bar names each destination Open … and reflects the drawer" <|
            \_ ->
                let
                    bar =
                        query (inRoom |> step (NavSelect Nav.Rooms))
                            |> Query.find [ Selector.attribute (attr "aria-label" "Mobile navigation") ]
                in
                Expect.all
                    [ \_ -> bar |> Query.has [ Selector.attribute (attr "aria-label" "Open Messages") ]
                    , \_ ->
                        bar
                            |> Query.find [ Selector.attribute (attr "aria-label" "Open Rooms") ]
                            |> Query.has
                                [ Selector.attribute (attr "aria-current" "page")
                                , Selector.attribute (attr "aria-pressed" "true")
                                , Selector.attribute (attr "aria-expanded" "true")
                                ]
                    ]
                    ()
        , test "clicking a destination dispatches NavSelect" <|
            \_ ->
                query blank
                    |> Query.find [ Selector.attribute (attr "aria-label" "Primary") ]
                    |> Query.find [ Selector.attribute (attr "data-section" "calls") ]
                    |> Event.simulate Event.click
                    |> Event.expect (NavSelect Nav.Calls)
        , test "the identity chip opens the You hub for guests" <|
            \_ ->
                query inRoom
                    |> Query.find [ Selector.attribute (attr "data-testid" "you-open") ]
                    |> Event.simulate Event.click
                    |> Event.expect (NavSelect Nav.You)
        , test "the identity chip opens the You hub for accounts" <|
            \_ ->
                query signedIn
                    |> Query.find [ Selector.attribute (attr "data-testid" "you-open") ]
                    |> Query.has [ Selector.attribute (attr "aria-label" "Open You"), Selector.text "me" ]
        , test "guest hub shows identity and Keep this name" <|
            \_ ->
                let
                    hub =
                        query { inRoom | youHubOpen = True } |> Query.find [ Selector.attribute (attr "data-testid" "you-hub") ]
                in
                Expect.all
                    [ \_ -> hub |> Query.has [ Selector.text "You are browsing as a guest.", Selector.text "Keep this name if you want to protect it without disconnecting." ]
                    , \_ -> hub |> Query.find [ Selector.attribute (attr "data-testid" "you-nick") ] |> Query.has [ Selector.text "me" ]
                    , \_ ->
                        hub
                            |> Query.find [ Selector.attribute (attr "data-testid" "you-keep-name") ]
                            |> Event.simulate Event.click
                            |> Event.expect (YouHubGo Nav.YouAccount)
                    , \_ -> hub |> Query.hasNot [ Selector.attribute (attr "data-testid" "you-open-account") ]
                    ]
                    ()
        , test "account hub names the account and offers Account" <|
            \_ ->
                let
                    hub =
                        query { signedIn | youHubOpen = True } |> Query.find [ Selector.attribute (attr "data-testid" "you-hub") ]
                in
                Expect.all
                    [ \_ -> hub |> Query.has [ Selector.text "Signed in as alice" ]
                    , \_ -> hub |> Query.has [ Selector.attribute (attr "data-testid" "you-open-account") ]
                    , \_ -> hub |> Query.hasNot [ Selector.attribute (attr "data-testid" "you-keep-name") ]
                    ]
                    ()
        , test "hub Appearance, Leave and close dispatch their messages" <|
            \_ ->
                let
                    hub =
                        query { inRoom | youHubOpen = True }
                in
                Expect.all
                    [ \_ ->
                        hub
                            |> Query.find [ Selector.attribute (attr "data-testid" "you-settings-open-appearance") ]
                            |> Event.simulate Event.click
                            |> Event.expect (YouHubGo Nav.YouAppearance)
                    , \_ ->
                        hub
                            |> Query.find [ Selector.attribute (attr "data-testid" "you-leave") ]
                            |> Event.simulate Event.click
                            |> Event.expect (YouHubGo Nav.YouLeave)
                    , \_ ->
                        hub
                            |> Query.find [ Selector.attribute (attr "data-testid" "you-close") ]
                            |> Event.simulate Event.click
                            |> Event.expect YouHubClose
                    , \_ ->
                        hub
                            |> Query.find [ Selector.attribute (attr "data-testid" "you-open-guides") ]
                            |> Event.simulate Event.click
                            |> Event.expect (YouHubGo Nav.YouGuides)
                    ]
                    ()
        , test "hub is absent while closed" <|
            \_ ->
                query inRoom |> Query.hasNot [ Selector.attribute (attr "data-testid" "you-hub") ]
        , test "Calls is reachable from both navs, not duplicated in the topbar" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        query inRoom
                            |> Query.find [ Selector.attribute (attr "aria-label" "Mobile navigation") ]
                            |> Query.find [ Selector.attribute (attr "data-section" "calls") ]
                            |> Event.simulate Event.click
                            |> Event.expect (NavSelect Nav.Calls)
                    , \_ -> query inRoom |> Query.hasNot [ Selector.class "onyx-calls-toggle" ]
                    ]
                    ()
        ]


attr : String -> String -> Html.Attribute msg
attr name value =
    Html.Attributes.attribute name value
