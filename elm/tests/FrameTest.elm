module FrameTest exposing (suite)

{-| v3/frame — the shell frame: the ONE Escape order (`App.escapeMsg`
over `App.overlayStack`), the shared sheet primitive (`View.Sheet`),
the migrated sheets carrying the focus-scope marker, the global topbar
vs. the room header (+ its More disclosure), and the grid regions.
-}

import App exposing (Model, Msg(..), blank, escapeMsg, overlayStack, update)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Set
import Switcher
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View
import View.Sheet as Sheet


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


scope : String -> Selector.Selector
scope name =
    Selector.attribute (Attr.attribute "data-shortcut-scope" name)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


escape : Model -> Model
escape =
    step (ShortcutPressed Switcher.Dismiss)


keys : Model -> List String
keys model =
    List.map Tuple.first (overlayStack model)


paletteOpen : Model -> Model
paletteOpen model =
    { model | palette = { open = True, query = "", active = 0 } }


room : Model
room =
    { blank
        | ourNick = "me"
        , activeChannel = Just "#c"
        , channels =
            Dict.singleton "#c"
                { name = "#c"
                , topic = "Harbour talk"
                , members = Dict.singleton "me" { nick = "me", modes = Set.empty, away = False }
                , modes = ""
                , messages = []
                , lastSeen = Nothing
                , unread = 0
                , highlights = 0
                , createdAt = Nothing
                }
    }


suite : Test
suite =
    describe "v3/frame"
        [ describe "one Escape order"
            [ test "nothing open: no overlay to close" <|
                \_ -> Expect.equal Nothing (escapeMsg blank)
            , test "shortcuts sit over the palette, the palette over sheets" <|
                \_ ->
                    let
                        m =
                            paletteOpen { blank | shortcutsOpen = True, prefsOpen = True }
                    in
                    Expect.equal [ "shortcuts", "palette", "prefs" ] (keys m)
            , test "the media lightbox is always topmost" <|
                \_ ->
                    Expect.equal (Just MediaLightboxClose)
                        (escapeMsg (paletteOpen { blank | mediaLightbox = Just "https://x/y.png", mediaIndexOpen = True }))
            , test "a confirmation closes before the sheet that spawned it" <|
                \_ ->
                    Expect.equal [ "call-privacy", "new-message", "notify" ]
                        (keys { blank | callPrivacyOpen = True, newMessageOpen = True, notifySheetOpen = True })
            , test "sheets close before drawers, drawers before inline chrome" <|
                \_ ->
                    Expect.equal [ "prefs", "you", "room-menu", "search", "schedule" ]
                        (keys { blank | prefsOpen = True, youHubOpen = True, roomMenuOpen = True, searchOpen = True, scheduleOpen = True })
            , test "one Escape closes exactly one layer, topmost first" <|
                \_ ->
                    let
                        start =
                            paletteOpen { blank | shortcutsOpen = True, notifySheetOpen = True, prefsOpen = True }

                        once =
                            escape start

                        twice =
                            escape once

                        thrice =
                            escape twice

                        four =
                            escape thrice
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "palette", "prefs", "notify" ] (keys once)
                        , \_ -> Expect.equal [ "prefs", "notify" ] (keys twice)
                        , \_ -> Expect.equal [ "notify" ] (keys thrice)
                        , \_ -> Expect.equal [] (keys four)
                        , \_ -> Expect.equal four (escape four)
                        ]
                        ()
            , test "with nothing open Escape still closes the nav menu" <|
                \_ -> Expect.equal False (escape { blank | navMenuOpen = True }).navMenuOpen
            , test "each sheet's close message actually clears it" <|
                \_ ->
                    let
                        opened =
                            [ { blank | accountOpen = True }
                            , { blank | showPinnedMessages = True }
                            , { blank | mediaIndexOpen = True }
                            , { blank | showJumpToDate = True }
                            , { blank | showScheduledMessages = True }
                            , { blank | browserOpen = True }
                            , { blank | youHubOpen = True }
                            , { blank | newMessageOpen = True }
                            , { blank | operDeskOpen = True }
                            , { blank | moderationOpen = True }
                            , { blank | whoisTarget = Just "ana" }
                            , { blank | stewardRoom = Just "#c" }
                            , { blank | reclaimOpen = True }
                            , { blank | guestClaimOpen = True }
                            , { blank | showNotificationCenter = True }
                            , { blank | callMoreOpen = True }
                            ]
                    in
                    Expect.equal (List.map (always []) opened) (List.map (escape >> keys) opened)
            ]
        , describe "room header More menu"
            [ test "toggles open and closed" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (step RoomMenuToggle blank).roomMenuOpen
                        , \_ -> Expect.equal False (step RoomMenuToggle (step RoomMenuToggle blank)).roomMenuOpen
                        , \_ -> Expect.equal False (step RoomMenuClose { blank | roomMenuOpen = True }).roomMenuOpen
                        ]
                        ()
            , test "running an action closes the menu and opens its sheet" <|
                \_ ->
                    let
                        after =
                            step PinnedMessagesOpen { room | roomMenuOpen = True }
                    in
                    Expect.equal ( False, True ) ( after.roomMenuOpen, after.showPinnedMessages )
            , test "unrelated messages leave it open" <|
                \_ -> Expect.equal True (step (NewMessageInput "x") { room | roomMenuOpen = True }).roomMenuOpen
            , test "the disclosure exposes its state and its actions only while open" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            query room
                                |> Query.find [ testId "room-more" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "false") ]
                        , \_ -> query room |> Query.hasNot [ testId "ribbon-pins" ]
                        , \_ ->
                            query { room | roomMenuOpen = True }
                                |> Query.find [ testId "room-more-menu" ]
                                |> Query.has [ testId "ribbon-pins", testId "ribbon-room-media", testId "topbar-jump-to-date" ]
                        , \_ ->
                            query room
                                |> Query.find [ testId "room-more" ]
                                |> Event.simulate Event.click
                                |> Event.expect RoomMenuToggle
                        ]
                        ()
            ]
        , describe "topbar vs. room header"
            [ test "the global bar keeps the launcher, the inbox, the pill and You" <|
                \_ ->
                    query room
                        |> Query.find [ Selector.class "onyx-topbar" ]
                        |> Query.has
                            [ testId "palette-launcher"
                            , testId "inbox-bell"
                            , Selector.class "onyx-conn"
                            , testId "you-open"
                            ]
            , test "v3/ui-mobile-shell: Calls lives in the nav only; Notifications and Leave in You" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            query room
                                |> Query.find [ Selector.class "onyx-topbar" ]
                                |> Query.hasNot [ Selector.class "onyx-calls-toggle", testId "shell-notifications", testId "session-disconnect" ]
                        , \_ ->
                            query { room | youHubOpen = True }
                                |> Query.find [ testId "you-hub" ]
                                |> Query.has [ testId "shell-notifications", testId "you-leave", testId "you-connection" ]
                        ]
                        ()
            , test "room-scoped actions are not in the global bar" <|
                \_ ->
                    query { room | roomMenuOpen = True }
                        |> Query.find [ Selector.class "onyx-topbar" ]
                        |> Query.hasNot [ Selector.class "onyx-search-toggle" ]
            , test "the room header names the room, its topic, Search and More" <|
                \_ ->
                    query room
                        |> Query.find [ testId "room-header" ]
                        |> Query.has
                            [ Selector.text "#c"
                            , Selector.text "Harbour talk"
                            , Selector.class "onyx-search-toggle"
                            , testId "room-more"
                            ]
            , test "no room, no room header" <|
                \_ -> query blank |> Query.hasNot [ testId "room-header" ]
            ]
        , describe "frame regions"
            [ test "conversation column stacks header, transcript pane and composer" <|
                \_ ->
                    query room
                        |> Query.find [ Selector.tag "main", Selector.class "onyx-main" ]
                        |> Query.has [ testId "room-header", Selector.class "onyx-thread-pane", Selector.class "onyx-composer" ]
            , test "overlays mount outside the grid flow" <|
                \_ ->
                    query { room | prefsOpen = True }
                        |> Query.find [ Selector.class "onyx-overlays" ]
                        |> Query.has [ testId "preferences-panel" ]
            ]
        , describe "shared sheet primitive"
            [ test "dialog contract: role, aria-modal, label, scope, focusable panel" <|
                \_ ->
                    sheetQuery
                        |> Query.find [ Selector.attribute (Attr.attribute "role" "dialog") ]
                        |> Query.has
                            [ Selector.attribute (Attr.attribute "aria-modal" "true")
                            , Selector.attribute (Attr.attribute "aria-labelledby" (Sheet.titleId "demo"))
                            , scope "demo"
                            , Selector.attribute (Attr.attribute "tabindex" "-1")
                            , Selector.class "onyx-sheet"
                            , Selector.class "demo-panel"
                            ]
            , test "Escape on the panel closes it (and is claimed)" <|
                \_ ->
                    sheetQuery
                        |> Query.find [ Selector.attribute (Attr.attribute "role" "dialog") ]
                        |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "Escape" ) ]))
                        |> Event.expect "closed"
            , test "IME composition never closes it" <|
                \_ ->
                    sheetQuery
                        |> Query.find [ Selector.attribute (Attr.attribute "role" "dialog") ]
                        |> Event.simulate
                            (Event.custom "keydown"
                                (Encode.object [ ( "key", Encode.string "Escape" ), ( "isComposing", Encode.bool True ) ])
                            )
                        |> Event.toResult
                        |> Expect.err
            , test "the backdrop light-dismisses" <|
                \_ ->
                    sheetQuery
                        |> Query.find [ testId "demo-backdrop" ]
                        |> Event.simulate Event.click
                        |> Event.expect "closed"
            , test "the standard head titles the dialog and closes it" <|
                \_ ->
                    Expect.all
                        [ \_ -> sheetQuery |> Query.find [ Selector.id (Sheet.titleId "demo") ] |> Query.has [ Selector.text "Demo" ]
                        , \_ ->
                            sheetQuery
                                |> Query.find [ testId "demo-close" ]
                                |> Event.simulate Event.click
                                |> Event.expect "closed"
                        ]
                        ()
            , test "migrated sheets carry the focus-scope marker" <|
                \_ ->
                    Expect.all
                        (List.map
                            (\( model, name ) -> \_ -> query model |> Query.has [ scope name ])
                            [ ( { blank | prefsOpen = True }, "prefs" )
                            , ( { blank | notifySheetOpen = True }, "notify" )
                            , ( { blank | accountOpen = True }, "account" )
                            , ( { blank | youHubOpen = True }, "you" )
                            , ( { blank | newMessageOpen = True }, "new-message" )
                            , ( { blank | showJumpToDate = True }, "jump-to-date" )
                            , ( { blank | showScheduledMessages = True }, "scheduled" )
                            , ( { blank | browserOpen = True }, "browse-rooms" )
                            , ( { room | showPinnedMessages = True }, "pins" )
                            , ( { room | mediaIndexOpen = True }, "media" )
                            , ( { blank | shortcutsOpen = True }, "shortcuts" )
                            , ( { blank | whoisTarget = Just "ana" }, "profile" )
                            ]
                        )
                        ()
            ]
        ]


sheetQuery : Query.Single String
sheetQuery =
    let
        base =
            Sheet.config { scope = "demo", onClose = "closed" }
    in
    Sheet.view { base | panelClass = "demo-panel" }
        [ Sheet.header { scope = "demo", title = "Demo", closeLabel = "Close demo", onClose = "closed", closeTestId = Just "demo-close" } ]
        |> Query.fromHtml
