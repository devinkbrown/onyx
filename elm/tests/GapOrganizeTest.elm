module GapOrganizeTest exposing (suite)

{-| v3/gap-organize — the organize + attention feature wired into the
app: the Rooms / Messages lists (folders, hidden rooms, closed DMs, the
row menu), the folder picker, saved messages, private notes on the
member card, the room / DM More menu (including the DM mute button),
reader mode, the Notifications sheet (quiet hours, mode, smart mute)
and the settle step (closed DMs reopen on news, hidden rooms return on a
mention) plus the alert decision those prefs feed.
-}

import App exposing (..)
import Attention
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Organize
import Organizer exposing (Effect(..))
import Prefs
import RoomSettings
import Set
import Switcher
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View
import View.Attention
import View.Organize


-- FIXTURE


base : Model
base =
    { blank
        | endpoint = Just "wss://onyx.test/ws"
        , ourNick = "kn"
        , nowMs = 1784980800000
        , caps = [ "chathistory" ]
        , connection = Live
    }


owner : Organize.Owner
owner =
    case deviceMemoryOwner base of
        Just o ->
            o

        Nothing ->
            { serverUrl = "", identity = "" }


ownerKey : (Organize.Owner -> Maybe String) -> String
ownerKey keyFor =
    keyFor owner |> Maybe.withDefault "<no key>"


smartKey : String
smartKey =
    Organize.ownerKey Attention.smartMuteKey owner |> Maybe.withDefault "<no key>"


feed : String -> Model -> Model
feed line model =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


stepOut : Msg -> Model -> ( Model, List Outbound )
stepOut =
    update


{-| The owner memory as the storage bridge would answer it. -}
loadOwner : List ( String, String ) -> Model -> Model
loadOwner values model =
    let
        tag =
            Organize.foldersKey owner |> Maybe.map (\k -> "owner:" ++ k) |> Maybe.withDefault ""
    in
    step
        (OrganizeMsg
            (Organizer.Loaded
                (Encode.object
                    [ ( "tag", Encode.string tag )
                    , ( "values", Encode.object (List.map (\( k, v ) -> ( k, Encode.string v )) values) )
                    ]
                )
            )
        )
        model


loadDevice : List ( String, String ) -> Model -> Model
loadDevice values model =
    step
        (OrganizeMsg
            (Organizer.Loaded
                (Encode.object
                    [ ( "tag", Encode.string "device" )
                    , ( "values", Encode.object (List.map (\( k, v ) -> ( k, Encode.string v )) values) )
                    ]
                )
            )
        )
        model


{-| #lounge, #design, #elm joined; DMs with jun and mara; the owner
memory loaded empty. -}
world : Model
world =
    base
        |> feed ":kn!u@h JOIN #lounge"
        |> feed ":kn!u@h JOIN #design"
        |> feed ":kn!u@h JOIN #elm"
        |> feed ":jun!u@h PRIVMSG kn :hello there"
        |> feed ":mara!u@h PRIVMSG kn :are we still on for 6?"
        |> loadOwner []


organized : Model
organized =
    world
        |> loadOwner
            [ ( ownerKey Organize.foldersKey, """[{"id":"w","name":"Work","rooms":["#design"],"collapsed":false}]""" )
            , ( ownerKey Organize.hiddenKey, """["#elm"]""" )
            , ( ownerKey Organize.closedKey, """["jun"]""" )
            ]


view : Model -> Query.Single Msg
view model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


testid : String -> Selector.Selector
testid name =
    Selector.attribute (Attr.attribute "data-testid" name)


stored : List Outbound -> List ( String, Maybe String )
stored outs =
    List.filterMap
        (\o ->
            case o of
                OrganizeStore { key, value } ->
                    Just ( key, value )

                _ ->
                    Nothing
        )
        outs


alerts : List Outbound -> List String
alerts outs =
    List.filterMap
        (\o ->
            case o of
                NotifyAlert a ->
                    Just a.title

                _ ->
                    Nothing
        )
        outs


suite : Test
suite =
    describe "gap-organize"
        [ lists
        , rowMenu
        , savedMessages
        , notes
        , moreMenus
        , reader
        , notifications
        , settling
        , alertDecision
        , sinceYouLeft
        ]



-- LISTS


lists : Test
lists =
    describe "Rooms and Messages lists"
        [ test "a folder is a collapsible section holding its rooms" <|
            \_ ->
                view organized
                    |> Query.findAll [ testid "sidebar-folder" ]
                    |> Query.count (Expect.equal 1)
        , test "the folder header names the folder and toggles it" <|
            \_ ->
                view organized
                    |> Query.find [ testid "sidebar-folder-toggle" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Work" ]
                        , Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "true") ]
                        , Event.simulate Event.click >> Event.expect (OrganizeMsg (Organizer.FolderToggle "w"))
                        ]
        , test "a collapsed folder hides its rooms and says how many are waiting" <|
            \_ ->
                let
                    folded =
                        step (OrganizeMsg (Organizer.FolderToggle "w")) organized
                in
                view folded
                    |> Query.find [ testid "sidebar-folder" ]
                    |> Expect.all
                        [ Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "false") ]
                        , Query.hasNot [ Selector.attribute (Attr.attribute "role" "list") ]
                        ]
        , test "a filter in use opens every folder so a match is never tucked away" <|
            \_ ->
                let
                    folded =
                        step (OrganizeMsg (Organizer.FolderToggle "w")) organized
                in
                view { folded | sidebarFilter = "des" }
                    |> Query.find [ testid "sidebar-folder" ]
                    |> Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "true") ]
        , test "a hidden room steps out of the list and is counted underneath" <|
            \_ ->
                view organized
                    |> Query.find [ testid "sidebar-channels" ]
                    |> Expect.all
                        [ Query.hasNot [ Selector.text "#elm" ]
                        , Query.has [ testid "sidebar-hidden" ]
                        , Query.has [ Selector.text "1 hidden room" ]
                        ]
        , test "opening the hidden list offers Show and a way in" <|
            \_ ->
                let
                    open =
                        step (OrganizeMsg Organizer.ShowHiddenToggle) organized
                in
                view open
                    |> Query.find [ testid "sidebar-hidden" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "#elm" ]
                        , Query.find [ testid "sidebar-unhide" ]
                            >> Event.simulate Event.click
                            >> Event.expect (OrganizeMsg (Organizer.Unhide "#elm"))
                        ]
        , test "the open room always stays listed, even if hidden (you never lose your place)" <|
            \_ ->
                let
                    inside =
                        step (ChannelSelect "#elm") organized
                in
                view inside
                    |> Query.find [ testid "sidebar-channels" ]
                    |> Query.has [ Selector.text "#elm" ]
        , test "a muted DM row carries a muted mark and an accessible \"muted\"" <|
            \_ ->
                let
                    muted =
                        step (MuteDm "mara") world
                in
                Expect.all
                    [ \_ -> view muted |> Query.has [ testid "sidebar-dm-muted" ]
                    , \_ -> Expect.equal ( View.Organize.mutedLabel muted "Mara", View.Organize.mutedLabel muted "jun" ) ( ", muted", "" )
                    ]
                    ()
        , test "an unmuted DM row has no mark" <|
            \_ ->
                view world |> Query.hasNot [ testid "sidebar-dm-muted" ]
        , test "a closed conversation leaves Messages and is counted underneath" <|
            \_ ->
                view organized
                    |> Query.find [ testid "sidebar-dms" ]
                    |> Expect.all
                        [ Query.hasNot [ Selector.text "jun" ]
                        , Query.has [ Selector.text "mara" ]
                        , Query.has [ Selector.text "1 closed conversation" ]
                        ]
        , test "Reopen brings it back" <|
            \_ ->
                let
                    open =
                        step (OrganizeMsg Organizer.ShowClosedToggle) organized
                in
                view open
                    |> Query.find [ testid "sidebar-reopen" ]
                    |> Event.simulate Event.click
                    |> Event.expect (OrganizeMsg (Organizer.Reopen "jun"))
        , test "hidden rooms and closed DMs stay reachable from the palette" <|
            \_ ->
                Switcher.entries (isChannelName organized) organized.activeChannel (Dict.values organized.channels)
                    |> List.map .id
                    |> (\ids -> ( List.member "channel:#elm" ids, List.member "dm:jun" ids ))
                    |> Expect.equal ( True, True )
        , test "opening a hidden room from the palette lands in it" <|
            \_ ->
                step (ChannelSelect "#elm") organized
                    |> (\m -> ( m.activeChannel, Organizer.isHidden "#elm" m.organize ))
                    |> Expect.equal ( Just "#elm", True )
        , test "nothing hidden or closed draws no footer" <|
            \_ ->
                view world
                    |> Expect.all
                        [ Query.hasNot [ testid "sidebar-hidden" ]
                        , Query.hasNot [ testid "sidebar-closed" ]
                        , Query.hasNot [ testid "sidebar-folder" ]
                        ]
        , test "before the owner memory loads, nothing is filed, hidden or closed" <|
            \_ ->
                let
                    unloaded =
                        base |> feed ":kn!u@h JOIN #elm" |> feed ":jun!u@h PRIVMSG kn :hi"
                in
                view unloaded
                    |> Expect.all
                        [ Query.hasNot [ testid "sidebar-hidden" ]
                        , Query.hasNot [ testid "sidebar-closed" ]
                        ]
        ]



-- ROW MENU


rowMenu : Test
rowMenu =
    describe "row menu and folder picker"
        [ test "every row has an organize control that opens its menu" <|
            \_ ->
                view world
                    |> Query.findAll [ testid "sidebar-organize-more" ]
                    |> Query.count (Expect.atLeast 5)
        , test "the control names its conversation" <|
            \_ ->
                view world
                    |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Organize #lounge") ]
                    |> Event.simulate Event.click
                    |> Event.expect (OrganizeMsg (Organizer.RowMenuOpen "#lounge"))
        , test "a room menu offers Move to folder and Hide" <|
            \_ ->
                view (step (OrganizeMsg (Organizer.RowMenuOpen "#lounge")) world)
                    |> Query.find [ testid "organize-menu" ]
                    |> Expect.all
                        [ Query.has [ testid "organize-move" ]
                        , Query.has [ testid "organize-hide" ]
                        , Query.hasNot [ testid "organize-close" ]
                        , Query.hasNot [ testid "organize-mute" ]
                        ]
        , test "a DM menu offers Mute and Close, wired to MuteDm and CloseConversation" <|
            \_ ->
                let
                    menu =
                        view (step (OrganizeMsg (Organizer.RowMenuOpen "jun")) world)
                            |> Query.find [ testid "organize-menu" ]
                in
                Expect.all
                    [ Query.find [ testid "organize-mute" ] >> Event.simulate Event.click >> Event.expect (MuteDm "jun")
                    , Query.find [ testid "organize-close" ] >> Event.simulate Event.click >> Event.expect (OrganizeMsg (Organizer.CloseConversation "jun"))
                    , Query.hasNot [ testid "organize-move" ]
                    ]
                    menu
        , test "a muted DM's menu offers Unmute" <|
            \_ ->
                let
                    muted =
                        step (MuteDm "jun") world
                in
                view (step (OrganizeMsg (Organizer.RowMenuOpen "jun")) muted)
                    |> Query.find [ testid "organize-mute" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Unmute conversation" ]
                        , Event.simulate Event.click >> Event.expect (UnmuteDm "jun")
                        ]
        , test "muting from the menu closes it" <|
            \_ ->
                step (MuteDm "jun") (step (OrganizeMsg (Organizer.RowMenuOpen "jun")) world)
                    |> (\m -> ( m.organize.sheet, Set.member "jun" m.mutedDMs ))
                    |> Expect.equal ( Nothing, True )
        , test "the folder picker lists No folder, each folder and a new-folder field" <|
            \_ ->
                let
                    picker =
                        step (OrganizeMsg (Organizer.MoveOpen "#lounge")) organized
                in
                view picker
                    |> Query.find [ testid "organize-move" ]
                    |> Expect.all
                        [ Query.findAll [ testid "organize-folder-choice" ] >> Query.count (Expect.equal 2)
                        , Query.has [ testid "organize-new-folder" ]
                        , Query.has [ testid "organize-create-folder" ]
                        ]
        , test "choosing a folder files the room" <|
            \_ ->
                let
                    picker =
                        step (OrganizeMsg (Organizer.MoveOpen "#lounge")) organized
                in
                view picker
                    |> Query.findAll [ testid "organize-folder-choice" ]
                    |> Query.index 1
                    |> Event.simulate Event.click
                    |> Event.expect (OrganizeMsg (Organizer.FolderAssign "#lounge" (Just "w")))
        , test "filing a room through update writes the folder list under the owner's key" <|
            \_ ->
                let
                    ( after, outs ) =
                        stepOut (OrganizeMsg (Organizer.FolderAssign "#lounge" (Just "w"))) organized
                in
                Expect.equal
                    ( List.map .rooms after.organize.folders
                    , List.map Tuple.first (stored outs)
                    )
                    ( [ [ "#design", "#lounge" ] ], [ ownerKey Organize.foldersKey ] )
        , test "hiding from the menu writes the hidden set and takes the room off the list" <|
            \_ ->
                let
                    ( after, outs ) =
                        stepOut (OrganizeMsg (Organizer.Hide "#lounge")) world
                in
                Expect.equal
                    ( stored outs, Set.toList after.organize.hidden )
                    ( [ ( ownerKey Organize.hiddenKey, Just """["#lounge"]""" ) ], [ "#lounge" ] )
        , test "closing the open DM returns to Messages" <|
            \_ ->
                let
                    inJun =
                        step (ChannelSelect "jun") world

                    closed =
                        step (OrganizeMsg (Organizer.CloseConversation "jun")) inJun
                in
                Expect.equal ( closed.activeChannel, Set.member "jun" (Dict.keys closed.organize.closed |> Set.fromList) )
                    ( Nothing, True )
        , test "nothing is written before the owner memory has loaded" <|
            \_ ->
                let
                    ( _, outs ) =
                        stepOut (OrganizeMsg (Organizer.Hide "#lounge")) (base |> feed ":kn!u@h JOIN #lounge")
                in
                stored outs |> Expect.equal []
        , test "the organize sheet takes Escape like every overlay" <|
            \_ ->
                escapeMsg (step (OrganizeMsg (Organizer.RowMenuOpen "#lounge")) world)
                    |> Expect.equal (Just (OrganizeMsg Organizer.SheetClose))
        ]



-- SAVED MESSAGES


savedMessages : Test
savedMessages =
    let
        saved =
            step
                (OrganizeMsg
                    (Organizer.BookmarkSave
                        { id = "m1", target = "#lounge", from = "sol", text = Just "voice call later at 6?", at = 1784980000000, savedAt = 1784980800000 }
                    )
                )
                world
    in
    describe "saved messages"
        [ test "saving writes the bookmark list under the owner's key" <|
            \_ ->
                stepOut
                    (OrganizeMsg
                        (Organizer.BookmarkSave
                            { id = "m1", target = "#lounge", from = "sol", text = Just "hello", at = 1, savedAt = 2 }
                        )
                    )
                    world
                    |> Tuple.second
                    |> stored
                    |> List.map Tuple.first
                    |> Expect.equal [ ownerKey Organize.bookmarksKey ]
        , test "the You hub entry shows the count and opens the list" <|
            \_ ->
                view { saved | youHubOpen = True }
                    |> Query.find [ testid "you-open-saved" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "1 saved message" ]
                        , Event.simulate Event.click >> Event.expect (OrganizeMsg Organizer.BookmarksOpen)
                        ]
        , test "opening from You closes the hub" <|
            \_ ->
                step (OrganizeMsg Organizer.BookmarksOpen) { saved | youHubOpen = True }
                    |> (\m -> ( m.youHubOpen, m.organize.sheet == Just Organizer.Bookmarks ))
                    |> Expect.equal ( False, True )
        , test "the sheet lists each save with who, where, and the words" <|
            \_ ->
                view (step (OrganizeMsg Organizer.BookmarksOpen) saved)
                    |> Query.find [ testid "organize-saved" ]
                    |> Expect.all
                        [ Query.findAll [ testid "organize-saved-row" ] >> Query.count (Expect.equal 1)
                        , Query.has [ Selector.text "voice call later at 6?" ]
                        , Query.has [ Selector.text "sol" ]
                        , Query.find [ Selector.attribute (Attr.attribute "aria-label" "Open saved message from sol in #lounge") ]
                            >> Event.simulate Event.click
                            >> Event.expect (OrganizeMsg (Organizer.BookmarkJump "#lounge" "m1"))
                        ]
        , test "an empty list explains how to save" <|
            \_ ->
                view (step (OrganizeMsg Organizer.BookmarksOpen) world)
                    |> Query.find [ testid "organize-saved" ]
                    |> Query.has [ Selector.text "Nothing saved yet" ]
        , test "an encrypted save shows a locked line, never words" <|
            \_ ->
                let
                    sealed =
                        step
                            (OrganizeMsg
                                (Organizer.BookmarkSave { id = "m2", target = "mara", from = "mara", text = Nothing, at = 1, savedAt = 2 })
                            )
                            world
                in
                view (step (OrganizeMsg Organizer.BookmarksOpen) sealed)
                    |> Query.find [ testid "organize-saved" ]
                    |> Query.has [ Selector.text "Encrypted message — open it to read" ]
        , test "a save in a room that is not joined cannot be opened" <|
            \_ ->
                let
                    elsewhere =
                        step
                            (OrganizeMsg
                                (Organizer.BookmarkSave { id = "m3", target = "#gone", from = "x", text = Just "old", at = 1, savedAt = 2 })
                            )
                            world
                in
                view (step (OrganizeMsg Organizer.BookmarksOpen) elsewhere)
                    |> Query.find [ testid "organize-saved" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Not joined on this connection" ]
                        , Query.has [ Selector.disabled True ]
                        ]
        , test "removing a save drops it" <|
            \_ ->
                view (step (OrganizeMsg Organizer.BookmarksOpen) saved)
                    |> Query.find [ testid "organize-saved" ]
                    |> Query.find [ testid "organize-saved-remove" ]
                    |> Event.simulate Event.click
                    |> Event.expect (OrganizeMsg (Organizer.BookmarkRemove "#lounge" "m1"))
        , test "Home shows the newest saves" <|
            \_ ->
                view (step (ChannelSelect "") saved |> (\m -> { m | activeChannel = Nothing }))
                    |> Query.has [ testid "home-saved" ]
        , test "jumping to a loaded row opens its room and focuses the row" <|
            \_ ->
                let
                    withRow =
                        world |> feed "@msgid=abc123 :sol!u@h PRIVMSG #lounge :look at this"

                    ( jumped, _ ) =
                        stepOut (OrganizeMsg (Organizer.BookmarkJump "#lounge" "abc123")) withRow
                in
                jumped.activeChannel |> Expect.equal (Just "#lounge")
        , test "jumping to a row that is not loaded says so instead of failing silently" <|
            \_ ->
                let
                    ( jumped, _ ) =
                        stepOut (OrganizeMsg (Organizer.BookmarkJump "mara" "zzz")) world
                in
                List.map .title jumped.toasts |> Expect.equal [ "Saved message not loaded" ]
        ]



-- NOTES


notes : Test
notes =
    let
        card =
            step (UserProfileOpened { nick = "mara", channel = "#lounge" }) (world |> feed ":mara!u@h JOIN #lounge" |> step (ChannelSelect "#lounge"))
    in
    describe "private notes on the member card"
        [ test "a person without a note offers to add one" <|
            \_ ->
                view card
                    |> Query.find [ testid "member-note-add" ]
                    |> Event.simulate Event.click
                    |> Event.expect (OrganizeMsg (Organizer.NoteEdit "mara"))
        , test "a saved note shows on the card with Edit" <|
            \_ ->
                let
                    withNote =
                        card |> loadOwner [ ( ownerKey Organize.notesKey, """{"mara":"Runs the design crit."}""" ) ]
                in
                view withNote
                    |> Query.find [ testid "member-note" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Runs the design crit." ]
                        , Query.has [ testid "member-note-edit" ]
                        ]
        , test "editing shows a field, a counter, and Save" <|
            \_ ->
                view (step (OrganizeMsg (Organizer.NoteEdit "mara")) card)
                    |> Query.find [ testid "member-note" ]
                    |> Expect.all
                        [ Query.has [ testid "member-note-input" ]
                        , Query.has [ testid "member-note-save" ]
                        , Query.has [ Selector.text "0 / 2048" ]
                        ]
        , test "your own card has no note" <|
            \_ ->
                view (step (UserProfileOpened { nick = "kn", channel = "#lounge" }) card)
                    |> Query.hasNot [ testid "member-note-add" ]
        , test "a note is kept per account: another owner's note never shows" <|
            \_ ->
                let
                    withNote =
                        card |> loadOwner [ ( ownerKey Organize.notesKey, """{"mara":"secret"}""" ) ]

                    switched =
                        { withNote | accountName = Just "someone-else" }
                in
                view switched |> Query.hasNot [ Selector.text "secret" ]
        ]



-- MORE MENUS


moreMenus : Test
moreMenus =
    let
        inRoom =
            step (ChannelSelect "#lounge") world |> (\m -> { m | roomMenuOpen = True })

        inDm =
            step (ChannelSelect "mara") world |> (\m -> { m | roomMenuOpen = True })
    in
    describe "room and DM More menus"
        [ test "a room's menu offers Move to folder, Hide, Saved messages and Reader mode" <|
            \_ ->
                view inRoom
                    |> Expect.all
                        [ Query.has [ testid "room-more-folder" ]
                        , Query.has [ testid "room-more-hide" ]
                        , Query.has [ testid "room-more-saved" ]
                        , Query.has [ testid "room-more-reader" ]
                        , Query.hasNot [ testid "dm-more-mute" ]
                        ]
        , test "a DM's menu has a Mute button and Close conversation" <|
            \_ ->
                view inDm
                    |> Expect.all
                        [ Query.find [ testid "dm-more-mute" ]
                            >> Expect.all
                                [ Query.has [ Selector.text "Mute conversation" ]
                                , Event.simulate Event.click >> Event.expect (MuteDm "mara")
                                ]
                        , Query.find [ testid "dm-more-close" ]
                            >> Event.simulate Event.click
                            >> Event.expect (OrganizeMsg (Organizer.CloseConversation "mara"))
                        , Query.hasNot [ testid "room-more-hide" ]
                        ]
        , test "the DM Mute button flips to Unmute once muted, and the menu closes on use" <|
            \_ ->
                let
                    muted =
                        step (MuteDm "mara") inDm
                in
                Expect.equal
                    ( Set.member "mara" muted.mutedDMs, muted.roomMenuOpen )
                    ( True, False )
        , test "a muted DM shows Unmute" <|
            \_ ->
                let
                    muted =
                        step (MuteDm "mara") inDm |> (\m -> { m | roomMenuOpen = True })
                in
                view muted
                    |> Query.find [ testid "dm-more-mute" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Unmute conversation" ]
                        , Event.simulate Event.click >> Event.expect (UnmuteDm "mara")
                        ]
        , test "Hide on the room menu hides the room" <|
            \_ ->
                view inRoom
                    |> Query.find [ testid "room-more-hide" ]
                    |> Event.simulate Event.click
                    |> Event.expect (OrganizeMsg (Organizer.Hide "#lounge"))
        , test "a hidden room's menu says Show room in list" <|
            \_ ->
                let
                    hiddenRoom =
                        organized |> step (ChannelSelect "#elm") |> (\m -> { m | roomMenuOpen = True })
                in
                view hiddenRoom
                    |> Query.find [ testid "room-more-hide" ]
                    |> Query.has [ Selector.text "Show room in list" ]
        , test "Room settings carries the folder and hide controls" <|
            \_ ->
                let
                    settings =
                        step (RoomSettingsMsg RoomSettings.Open) inRoom
                in
                view settings |> Query.has [ testid "chset-device" ]
        ]



-- READER MODE


reader : Test
reader =
    let
        withReader on model =
            let
                prefs =
                    model.prefs
            in
            { model | prefs = { prefs | readerMode = on } }

        inRoom =
            step (ChannelSelect "#lounge") world
    in
    describe "reader mode"
        [ test "flags the app frame while a conversation is showing" <|
            \_ ->
                view (withReader True inRoom)
                    |> Query.has [ Selector.attribute (Attr.attribute "data-reader" "true") ]
        , test "is off on Home even when the preference is on" <|
            \_ ->
                view (withReader True { inRoom | activeChannel = Nothing })
                    |> Query.has [ Selector.attribute (Attr.attribute "data-reader" "false") ]
        , test "is off when the preference is off" <|
            \_ ->
                view (withReader False inRoom)
                    |> Query.has [ Selector.attribute (Attr.attribute "data-reader" "false") ]
        , test "keeps one way out, always in reach" <|
            \_ ->
                view (withReader True inRoom)
                    |> Query.find [ testid "reader-exit" ]
                    |> Event.simulate Event.click
                    |> Event.expect (PrefsTogglePref "readerMode")
        , test "no exit control when it is not active" <|
            \_ ->
                view (withReader False inRoom) |> Query.hasNot [ testid "reader-exit" ]
        , test "a call takes over the screen: reader mode steps aside" <|
            \_ ->
                view (withReader True { inRoom | callsOpen = True })
                    |> Query.has [ Selector.attribute (Attr.attribute "data-reader" "false") ]
        ]



-- NOTIFICATIONS SHEET


notifications : Test
notifications =
    let
        sheet model =
            view { model | notifySheetOpen = True }
    in
    describe "Notifications sheet"
        [ test "carries quiet hours, the mode and smart mute" <|
            \_ ->
                sheet world
                    |> Expect.all
                        [ Query.has [ testid "notify-quiet" ]
                        , Query.has [ testid "notify-preset" ]
                        , Query.has [ testid "notify-smart-mute" ]
                        ]
        , test "quiet hours start off with no hour pickers; the switch turns them on" <|
            \_ ->
                sheet world
                    |> Expect.all
                        [ Query.hasNot [ testid "notify-quiet-start" ]
                        , Query.find [ testid "notify-quiet-toggle" ]
                            >> Event.simulate Event.click
                            >> Event.expect (OrganizeMsg Organizer.QuietToggle)
                        ]
        , test "once on, From and Until hour pickers appear with the live status" <|
            \_ ->
                let
                    on =
                        step (OrganizeMsg Organizer.QuietToggle) world
                in
                sheet on
                    |> Expect.all
                        [ Query.has [ testid "notify-quiet-start" ]
                        , Query.has [ testid "notify-quiet-end" ]
                        , Query.find [ testid "notify-quiet-status" ] >> Query.has [ Selector.text "Every day from 22:00 to 08:00, alerts stay silent." ]
                        ]
        , test "an empty window warns" <|
            \_ ->
                let
                    empty =
                        world
                            |> step (OrganizeMsg Organizer.QuietToggle)
                            |> step (OrganizeMsg (Organizer.QuietStart 8))
                in
                sheet empty |> Query.has [ Selector.text "Pick different start and end hours" ]
        , test "the mode is a three-way radio group, Regular by default" <|
            \_ ->
                sheet world
                    |> Expect.all
                        [ Query.findAll [ Selector.attribute (Attr.attribute "role" "radio") ] >> Query.count (Expect.equal 3)
                        , Query.find [ Selector.attribute (Attr.attribute "role" "radio"), Selector.attribute (Attr.attribute "aria-checked" "true") ]
                            >> Query.has [ Selector.text "Regular" ]
                        ]
        , test "choosing Calm dispatches the preset" <|
            \_ ->
                sheet world
                    |> Query.find [ testid "notify-preset-calm" ]
                    |> Event.simulate Event.click
                    |> Event.expect (OrganizeMsg (Organizer.PresetSet Attention.Calm))
        , test "smart mute shows what is muted and saves through one button" <|
            \_ ->
                let
                    withRules =
                        world
                            |> loadOwner [ ( smartKey, """{"keywords":["airdrop"],"mutedNicks":["bot"]}""" ) ]
                in
                sheet withRules
                    |> Expect.all
                        [ Query.has [ Selector.text "1 word · 1 person muted" ]
                        , Query.find [ testid "notify-smart-mute", Selector.tag "form" ]
                            >> Event.simulate Event.submit
                            >> Event.expect (OrganizeMsg Organizer.SmartSave)
                        ]
        , test "smart mute is disabled until the owner memory loads" <|
            \_ ->
                sheet (base |> feed ":kn!u@h JOIN #lounge")
                    |> Query.find [ testid "notify-smart-save" ]
                    |> Query.has [ Selector.disabled True ]
        ]



-- SETTLING


settling : Test
settling =
    describe "settle: closed DMs reopen, hidden rooms return"
        [ test "a closed DM reopens when the other person writes again, and the change is stored" <|
            \_ ->
                let
                    closed =
                        step (OrganizeMsg (Organizer.CloseConversation "jun")) world

                    ( after, outs ) =
                        stepOut (WsLineReceived ":jun!u@h PRIVMSG kn :got a minute?") { closed | nowMs = closed.nowMs + 60000 }
                in
                Expect.equal
                    ( Dict.isEmpty after.organize.closed, stored outs |> List.map Tuple.second )
                    ( True, [ Nothing ] )
        , test "a closed DM stays closed while others write" <|
            \_ ->
                world
                    |> step (OrganizeMsg (Organizer.CloseConversation "jun"))
                    |> feed ":mara!u@h PRIVMSG kn :ping"
                    |> (\m -> Dict.keys m.organize.closed)
                    |> Expect.equal [ "jun" ]
        , test "opening a closed DM reopens it" <|
            \_ ->
                world
                    |> step (OrganizeMsg (Organizer.CloseConversation "jun"))
                    |> step (ChannelSelect "jun")
                    |> (\m -> Dict.isEmpty m.organize.closed)
                    |> Expect.equal True
        , test "a hidden room returns when someone mentions you" <|
            \_ ->
                let
                    hidden =
                        step (OrganizeMsg (Organizer.Hide "#elm")) world

                    ( after, outs ) =
                        stepOut (WsLineReceived ":ash!u@h PRIVMSG #elm :kn compiler bump landed") hidden
                in
                Expect.equal
                    ( Set.isEmpty after.organize.hidden, stored outs |> List.map Tuple.second )
                    ( True, [ Nothing ] )
        , test "a hidden room stays hidden through ordinary chatter" <|
            \_ ->
                world
                    |> step (OrganizeMsg (Organizer.Hide "#elm"))
                    |> feed ":ash!u@h PRIVMSG #elm :compiler bump landed"
                    |> (\m -> Set.toList m.organize.hidden)
                    |> Expect.equal [ "#elm" ]
        , test "an unrelated message changes nothing and writes nothing" <|
            \_ ->
                let
                    ( _, outs ) =
                        stepOut (WsLineReceived ":ash!u@h PRIVMSG #lounge :hello") organized
                in
                stored outs |> Expect.equal []
        , test "before the memory loads, a new line never writes a half-read list" <|
            \_ ->
                let
                    unloaded =
                        base |> feed ":kn!u@h JOIN #elm"

                    ( _, outs ) =
                        stepOut (WsLineReceived ":ash!u@h PRIVMSG #elm :kn ping") unloaded
                in
                stored outs |> Expect.equal []
        ]



-- ALERT DECISION


alertDecision : Test
alertDecision =
    let
        away =
            let
                ( granted, _ ) =
                    stepOut (NotifyPermissionChanged "granted") { world | pageVisible = False, appFocused = False }
            in
            granted

        hourNow =
            Attention.minuteOfDay away.zone away.nowMs // 60

        alertsFor line model =
            update (WsLineReceived line) model |> Tuple.second |> alerts
    in
    describe "alerts follow the attention prefs"
        [ test "baseline: a mention in a background room alerts" <|
            \_ ->
                alertsFor ":ash!u@h PRIVMSG #lounge :hey kn" away
                    |> Expect.equal [ "ash mentioned you in #lounge" ]
        , test "quiet hours silence it while the window is on" <|
            \_ ->
                let
                    quiet =
                        away
                            |> loadDevice
                                [ ( "onyx:dnd-quiet-start", String.fromInt hourNow )
                                , ( "onyx:dnd-quiet-end", String.fromInt (modBy 24 (hourNow + 1)) )
                                , ( "onyx:dnd-quiet-enabled", "true" )
                                ]
                in
                alertsFor ":ash!u@h PRIVMSG #lounge :hey kn" quiet |> Expect.equal []
        , test "a quiet window that has passed lets alerts through" <|
            \_ ->
                let
                    later =
                        away
                            |> loadDevice
                                [ ( "onyx:dnd-quiet-start", String.fromInt (modBy 24 (hourNow + 2)) )
                                , ( "onyx:dnd-quiet-end", String.fromInt (modBy 24 (hourNow + 3)) )
                                , ( "onyx:dnd-quiet-enabled", "true" )
                                ]
                in
                alertsFor ":ash!u@h PRIVMSG #lounge :hey kn" later |> List.length |> Expect.equal 1
        , test "smart mute silences a keyword and a person, but not others" <|
            \_ ->
                let
                    smart =
                        away
                            |> loadOwner
                                [ ( smartKey, """{"keywords":["airdrop"],"mutedNicks":["deploy-bot"]}""" ) ]
                in
                Expect.equal
                    [ [], [], [ "ash mentioned you in #lounge" ] ]
                    [ alertsFor ":ash!u@h PRIVMSG #lounge :kn free AIRDROP inside" smart
                    , alertsFor ":deploy-bot!u@h PRIVMSG #lounge :kn build done" smart
                    , alertsFor ":ash!u@h PRIVMSG #lounge :kn lunch?" smart
                    ]
        , test "a followed topic alerts under Regular, not under Calm" <|
            \_ ->
                let
                    following =
                        { away | followed = Set.fromList [ followKey "#lounge" Nothing ] }

                    calm =
                        loadDevice [ ( "onyx:calm", "calm" ) ] following
                in
                Expect.equal
                    ( alertsFor ":ash!u@h PRIVMSG #lounge :lunch?" following
                    , alertsFor ":ash!u@h PRIVMSG #lounge :lunch?" calm
                    )
                    ( [ "ash posted in #lounge" ], [] )
        , test "Calm still lets direct messages and mentions through" <|
            \_ ->
                let
                    calm =
                        loadDevice [ ( "onyx:calm", "calm" ) ] away
                in
                Expect.equal
                    ( alertsFor ":ash!u@h PRIVMSG #lounge :hey kn" calm |> List.length
                    , alertsFor ":mara!u@h PRIVMSG kn :hi" calm |> List.length
                    )
                    ( 1, 1 )
        , test "Power alerts on plain lines in rooms set to All; Regular does not" <|
            \_ ->
                let
                    power =
                        loadDevice [ ( "onyx:calm", "power" ) ] away
                in
                Expect.equal
                    ( alertsFor ":ash!u@h PRIVMSG #lounge :lunch?" away
                    , alertsFor ":ash!u@h PRIVMSG #lounge :lunch?" power
                    )
                    ( [], [ "ash posted in #lounge" ] )
        , test "Power respects a muted room" <|
            \_ ->
                let
                    power =
                        loadDevice [ ( "onyx:calm", "power" ) ] { away | channelNotify = Dict.fromList [ ( "#lounge", "none" ) ] }
                in
                alertsFor ":ash!u@h PRIVMSG #lounge :lunch?" power |> Expect.equal []
        , test "a muted DM stays silent under every preset" <|
            \_ ->
                let
                    power =
                        loadDevice [ ( "onyx:calm", "power" ) ] { away | mutedDMs = Set.fromList [ "mara" ] }
                in
                alertsFor ":mara!u@h PRIVMSG kn :hi" power |> Expect.equal []
        ]



-- SINCE YOU LEFT


sinceYouLeft : Test
sinceYouLeft =
    let
        news =
            world
                |> feed "@time=2026-07-25T11:50:00.000Z;msgid=a1 :iris!u@h PRIVMSG #design :kn can you check the release headings?"
                |> feed "@time=2026-07-25T11:52:00.000Z;msgid=a2 :theo!u@h PRIVMSG #design :release headings look tighter now"
                |> feed "@time=2026-07-25T11:55:00.000Z;msgid=a3 :mara!u@h PRIVMSG #elm :compiler bump landed"

        home m =
            view { m | activeChannel = Nothing }
    in
    describe "Home: since you left"
        [ test "Home heads the catch-up with who wrote and when" <|
            \_ ->
                home news
                    |> Query.find [ testid "home-digest" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Since you left" ]
                        , Query.has [ Selector.containing [ Selector.text "people wrote" ] ]
                        ]
        , test "each conversation's row carries who, when and what about" <|
            \_ ->
                home news
                    |> Query.findAll [ testid "home-digest-line" ]
                    |> Query.count (Expect.atLeast 2)
        , test "a row jumps to the first unread line, not just the room" <|
            \_ ->
                home news
                    |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Open #design at your first unread message, 2 unread, 1 mention") ]
                    |> Event.simulate Event.click
                    |> Event.expect (OrganizeMsg (Organizer.DigestJump "#design"))
        , test "the jump opens the room and lands on the first unread row" <|
            \_ ->
                let
                    ( landed, _ ) =
                        stepOut (OrganizeMsg (Organizer.DigestJump "#design")) news
                in
                Expect.equal ( landed.activeChannel, landed.historyLanding ) ( Just "#design", Just "a1" )
        , test "a muted room stays out of the digest; a muted DM too" <|
            \_ ->
                let
                    quieted =
                        { news | channelNotify = Dict.fromList [ ( "#elm", "none" ) ], mutedDMs = Set.fromList [ "jun" ] }

                    names m =
                        View.Attention.digest m |> .rows |> List.map .name |> List.sort
                in
                Expect.equal ( names news, names quieted )
                    ( [ "#design", "#elm", "jun", "mara" ], [ "#design", "mara" ] )
        , test "nothing unread, nothing to say" <|
            \_ ->
                home (base |> feed ":kn!u@h JOIN #lounge" |> loadOwner [])
                    |> Query.hasNot [ testid "home-digest" ]
        , test "offline, Home says what this device is holding" <|
            \_ ->
                home { news | connection = Offline }
                    |> Query.has [ testid "home-memory" ]
        , test "online, that note is not shown" <|
            \_ ->
                home news |> Query.hasNot [ testid "home-memory" ]
        ]
