module SwitcherTest exposing (suite)

{-| v3/switcher vectors: the fuzzy ranker (mirroring
`chat/spotlight/fuzzy.test.ts`), palette entries / wrap navigation /
combobox semantics (mirroring `Spotlight.test.tsx`), the Escape overlay
stack, row actions through `App.update`, and the shortcuts overlay
(`ShortcutsOverlay`) through `View.view`.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes
import Json.Encode as Encode
import Route
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


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


titles : List Switcher.Matched -> List String
titles =
    List.map (.entry >> .title)


entry : String -> Switcher.Entry
entry title =
    { id = title, section = Switcher.Actions, title = title, hint = "", keywords = [], target = Switcher.Do Switcher.Leave }


{-| Live model with two rooms and a DM, #b active. -}
joined : Model
joined =
    { blank | endpoint = Just "wss://onyx.example/ws" }
        |> (\m -> feed m ":me!u@h JOIN #onyx-lab")
        |> (\m -> feed m ":me!u@h JOIN #b")
        |> (\m -> feed m ":alice!u@h PRIVMSG me :hi")
        |> step (ChannelSelect "#b")


opened : Model
opened =
    step (ShortcutPressed Switcher.TogglePalette) joined


paletteRows : Model -> List Switcher.Matched
paletteRows model =
    Switcher.matches model.palette.query
        (Switcher.entries (App.isChannelName model) model.activeChannel (Dict.values model.channels))


indexOfTitle : String -> Model -> Int
indexOfTitle title model =
    paletteRows model
        |> List.indexedMap Tuple.pair
        |> List.filter (\( _, m ) -> m.entry.title == title)
        |> List.head
        |> Maybe.map Tuple.first
        |> Maybe.withDefault -1


run : String -> Model -> ( Model, List Outbound )
run title model =
    update (PaletteRun (indexOfTitle title model)) model


suite : Test
suite =
    describe "Switcher"
        [ describe "fuzzyMatch (fuzzy.test.ts)"
            [ test "matches subsequences and rejects missing characters" <|
                \_ ->
                    Expect.equal ( True, False )
                        ( Switcher.fuzzyMatch "gch" "Go to #chat" [] /= Nothing
                        , Switcher.fuzzyMatch "zxq" "Go to #chat" [] /= Nothing
                        )
            , test "empty query returns every item without highlights" <|
                \_ ->
                    let
                        ranked =
                            Switcher.rank "" [ entry "Go to #lapis", entry "Disconnect" ]
                    in
                    Expect.equal ( [ "Go to #lapis", "Disconnect" ], True )
                        ( titles ranked, List.all (\m -> List.isEmpty m.ranges) ranked )
            , test "ranks tight prefix and substring matches ahead of loose matches" <|
                \_ ->
                    let
                        ranked =
                            Switcher.rank "onyx" [ entry "Switch theme: Onyx", entry "Go to #onyx-lab", entry "Disconnect" ]
                    in
                    Expect.equal [ "Go to #onyx-lab", "Switch theme: Onyx" ] (titles ranked)
            , test "compacts adjacent highlighted characters into ranges" <|
                \_ ->
                    Expect.equal (Just [ ( 7, 11 ) ]) (Switcher.fuzzyMatch "chat" "Go to #chat" [] |> Maybe.map .ranges)
            , test "keeps separated highlighted characters in separate ranges" <|
                \_ ->
                    Expect.equal (Just [ ( 0, 1 ), ( 3, 4 ), ( 7, 8 ) ]) (Switcher.fuzzyMatch "gtc" "Go to #chat" [] |> Maybe.map .ranges)
            , test "astral characters highlight as one char" <|
                \_ ->
                    Expect.equal (Just [ ( 0, 1 ) ]) (Switcher.fuzzyMatch "🚀" "🚀 launch room" [] |> Maybe.map .ranges)
            , test "keyword-only matches rank 38 below the title score and carry no highlight" <|
                \_ ->
                    case Switcher.fuzzyMatch "theme" "Appearance" [ "theme" ] of
                        Just m ->
                            Expect.equal [] m.ranges

                        Nothing ->
                            Expect.fail "keyword should match"
            , test "segments split a title into highlighted runs" <|
                \_ ->
                    Expect.equal [ ( "Go to #", False ), ( "chat", True ) ] (Switcher.segments "Go to #chat" [ ( 7, 11 ) ])
            ]
        , describe "entries + navigation"
            [ test "rooms, then DMs, then actions; Jump to date needs an open conversation" <|
                \_ ->
                    let
                        rows =
                            titles (paletteRows opened)

                        noActive =
                            Switcher.entries (App.isChannelName joined) Nothing (Dict.values joined.channels)
                                |> List.map .title
                    in
                    Expect.equal
                        ( List.take 3 rows, List.member "Jump to date…" rows, List.member "Jump to date…" noActive )
                        ( [ "Go to #b", "Go to #onyx-lab", "Open DM with alice" ], True, False )
            , test "every requested action is offered" <|
                \_ ->
                    let
                        rows =
                            titles (paletteRows opened)
                    in
                    Expect.equal True
                        (List.all (\t -> List.member t rows)
                            [ "Browse rooms", "Start a room", "New conversation", "Notifications", "Appearance — theme & background", "You", "Open keyboard shortcuts", "Disconnect" ]
                        )
            , test "room hint mirrors channelHint" <|
                \_ ->
                    Expect.equal (Just "1 users")
                        (paletteRows opened |> List.head |> Maybe.map (.entry >> .hint))
            , test "a query keeps section order with the best match first" <|
                \_ ->
                    Expect.equal [ "Go to #onyx-lab" ]
                        (paletteRows (step (PaletteInput "onyx-l") opened) |> titles |> List.take 1)
            , test "move wraps both ways and an empty set stays at 0" <|
                \_ ->
                    Expect.equal [ 1, 0, 2, 0 ]
                        [ Switcher.move 1 3 0, Switcher.move 1 3 2, Switcher.move -1 3 0, Switcher.move 1 0 5 ]
            , test "arrows wrap through the palette and typing resets the highlight" <|
                \_ ->
                    let
                        count =
                            List.length (paletteRows opened)

                        up =
                            step (PaletteMove -1) opened

                        typed =
                            step (PaletteInput "b") (step (PaletteMove 1) opened)
                    in
                    Expect.equal ( count - 1, 0 ) ( up.palette.active, typed.palette.active )
            , test "results announcement mirrors the oracle copy" <|
                \_ ->
                    Expect.equal [ "", "No matching command", "1 command available", "3 commands available" ]
                        [ Switcher.resultsAnnouncement "" 0, Switcher.resultsAnnouncement "zz" 0, Switcher.resultsAnnouncement "a" 1, Switcher.resultsAnnouncement "a" 3 ]
            ]
        , describe "shortcuts + overlay stack"
            [ test "decodes the port names" <|
                \_ ->
                    Expect.equal
                        [ Switcher.TogglePalette, Switcher.OpenPalette, Switcher.ShowShortcuts, Switcher.Dismiss, Switcher.UnknownShortcut ]
                        (List.map Switcher.shortcutFromString [ "palette-toggle", "palette", "shortcuts", "escape", "nope" ])
            , test "Ctrl+K toggles; / only opens" <|
                \_ ->
                    let
                        toggledTwice =
                            step (ShortcutPressed Switcher.TogglePalette) opened

                        slashTwice =
                            step (ShortcutPressed Switcher.OpenPalette) (step (ShortcutPressed Switcher.OpenPalette) joined)
                    in
                    Expect.equal ( True, False, True ) ( opened.palette.open, toggledTwice.palette.open, slashTwice.palette.open )
            , test "opening resets the query and highlight" <|
                \_ ->
                    let
                        reopened =
                            opened
                                |> step (PaletteInput "zz")
                                |> step PaletteClose
                                |> step (ShortcutPressed Switcher.TogglePalette)
                    in
                    Expect.equal ( "", 0 ) ( reopened.palette.query, reopened.palette.active )
            , test "Escape closes the topmost overlay, then nothing" <|
                \_ ->
                    let
                        both =
                            { opened | shortcutsOpen = True }

                        once =
                            step (ShortcutPressed Switcher.Dismiss) both

                        twice =
                            step (ShortcutPressed Switcher.Dismiss) once

                        thrice =
                            update (ShortcutPressed Switcher.Dismiss) twice
                    in
                    Expect.equal
                        [ ( False, True ), ( False, False ), ( False, False ) ]
                        [ ( once.shortcutsOpen, once.palette.open ), ( twice.shortcutsOpen, twice.palette.open ), ( (Tuple.first thrice).shortcutsOpen, (Tuple.first thrice).palette.open ) ]
            , test "? opens the shortcuts overlay and closes the palette" <|
                \_ ->
                    let
                        next =
                            step (ShortcutPressed Switcher.ShowShortcuts) opened
                    in
                    Expect.equal ( True, False ) ( next.shortcutsOpen, next.palette.open )
            , test "keys are inert off the app shell and behind the connect gate" <|
                \_ ->
                    let
                        landing =
                            step (ShortcutPressed Switcher.TogglePalette) { joined | route = Route.Landing }

                        gated =
                            step (ShortcutPressed Switcher.ShowShortcuts) { joined | connection = Offline, connectGate = True, autoReconnect = False }
                    in
                    Expect.equal ( False, False ) ( landing.palette.open, gated.shortcutsOpen )
            ]
        , describe "running rows"
            [ test "a room row selects it and closes the palette" <|
                \_ ->
                    let
                        ( next, _ ) =
                            run "Go to #onyx-lab" opened
                    in
                    Expect.equal ( Just "#onyx-lab", False ) ( next.activeChannel, next.palette.open )
            , test "Enter runs the highlighted row (a DM)" <|
                \_ ->
                    let
                        next =
                            opened
                                |> step (PaletteInput "alice")
                                |> step PaletteSubmit
                    in
                    Expect.equal ( Just "alice", False ) ( next.activeChannel, next.palette.open )
            , test "actions reuse the existing intents" <|
                \_ ->
                    let
                        after title =
                            Tuple.first (run title opened)
                    in
                    Expect.equal
                        [ True, True, True, True, True, True ]
                        [ (after "Browse rooms").browserOpen
                        , (after "New conversation").newMessageOpen
                        , (after "Jump to date…").showJumpToDate
                        , (after "Notifications").notifySheetOpen
                        , (after "You").youHubOpen
                        , (after "Open keyboard shortcuts").shortcutsOpen
                        ]
            , test "Appearance pushes /appearance" <|
                \_ ->
                    Expect.equal True (List.member (PushUrl "/appearance") (Tuple.second (run "Appearance — theme & background" opened)))
            , test "Disconnect leaves through the session disconnect" <|
                \_ ->
                    let
                        ( viaPalette, outs ) =
                            run "Disconnect" opened

                        ( direct, directOuts ) =
                            update SessionDisconnect { opened | palette = Switcher.closed }
                    in
                    Expect.equal ( direct.connectGate, directOuts ) ( viaPalette.connectGate, outs )
            , test "Enter with no matches is a no-op" <|
                \_ ->
                    let
                        typed =
                            step (PaletteInput "zzzzqqq") opened
                    in
                    Expect.equal typed (step PaletteSubmit typed)
            ]
        , describe "view"
            [ test "palette is a combobox with aria-activedescendant into the listbox" <|
                \_ ->
                    query opened
                        |> Query.find [ Selector.id "onyx-spotlight-input" ]
                        |> Query.has
                            [ Selector.attribute (attrib "role" "combobox")
                            , Selector.attribute (attrib "aria-controls" "onyx-spotlight-listbox")
                            , Selector.attribute (attrib "aria-activedescendant" "onyx-spotlight-option-0")
                            , Selector.attribute (attrib "aria-label" "Command search")
                            ]
            , test "the highlighted option is aria-selected" <|
                \_ ->
                    query (step (PaletteMove 1) opened)
                        |> Query.find [ Selector.id "onyx-spotlight-option-1" ]
                        |> Query.has [ Selector.attribute (attrib "aria-selected" "true") ]
            , test "ArrowDown on the input moves; Escape closes" <|
                \_ ->
                    let
                        input =
                            query opened |> Query.find [ Selector.id "onyx-spotlight-input" ]
                    in
                    Expect.all
                        [ \_ -> input |> Event.simulate (Event.custom "keydown" (keyEvent "ArrowDown")) |> Event.expect (PaletteMove 1)
                        , \_ -> input |> Event.simulate (Event.custom "keydown" (keyEvent "ArrowUp")) |> Event.expect (PaletteMove -1)
                        , \_ -> input |> Event.simulate (Event.custom "keydown" (keyEvent "Enter")) |> Event.expect PaletteSubmit
                        , \_ -> input |> Event.simulate (Event.custom "keydown" (keyEvent "Escape")) |> Event.expect PaletteClose
                        ]
                        ()
            , test "empty results show the oracle empty state" <|
                \_ ->
                    query (step (PaletteInput "zzzzqqq") opened)
                        |> Query.has [ Selector.text "Nothing surfaces yet" ]
            , test "closed palette renders nothing" <|
                \_ ->
                    query joined |> Query.hasNot [ Selector.id "onyx-spotlight-input" ]
            , test "shortcuts overlay mirrors the oracle dialog" <|
                \_ ->
                    query { joined | shortcutsOpen = True }
                        |> Query.find [ Selector.attribute (attrib "data-testid" "shortcuts-overlay") ]
                        |> Query.has
                            [ Selector.text "Open command palette"
                            , Selector.text "Close palette / overlay"
                            , Selector.id "shortcuts-overlay-palette"
                            ]
            , test "the overlay close button closes it" <|
                \_ ->
                    query { joined | shortcutsOpen = True }
                        |> Query.find [ Selector.attribute (attrib "aria-label" "Close keyboard shortcuts") ]
                        |> Event.simulate Event.click
                        |> Event.expect ShortcutsClose
            , test "the topbar launcher opens the palette" <|
                \_ ->
                    query joined
                        |> Query.find [ Selector.attribute (attrib "data-testid" "palette-launcher") ]
                        |> Event.simulate Event.click
                        |> Event.expect PaletteOpen
            ]
        ]


attrib : String -> String -> Html.Attribute msg
attrib =
    Html.Attributes.attribute


keyEvent : String -> Encode.Value
keyEvent key =
    Encode.object [ ( "key", Encode.string key ), ( "isComposing", Encode.bool False ), ( "keyCode", Encode.int 0 ) ]
