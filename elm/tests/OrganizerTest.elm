module OrganizerTest exposing (suite)

{-| v3/gap-organize — the organize feature's pure state machine
(`Organizer.update`): owner-scoped loading (and the stale-owner rule),
the write gate, every message's state change and effects, the reopen /
reveal selectors the settle step uses, and the one-time import of the
oracle's folders.
-}

import Attention exposing (Preset(..))
import Dict
import Expect
import Json.Encode as Encode
import Organize
import Organizer exposing (Effect(..), Msg(..))
import Set
import Test exposing (Test, describe, test)


owner : Organize.Owner
owner =
    { serverUrl = "wss://irc.eshmaki.me/ws", identity = "kn" }


other : Organize.Owner
other =
    { serverUrl = "wss://irc.eshmaki.me/ws", identity = "someone" }


ctx : Organizer.Ctx
ctx =
    { owner = Just owner, nowMs = 1784980800000, active = Nothing }


key : (Organize.Owner -> Maybe String) -> String
key keyFor =
    keyFor owner |> Maybe.withDefault "<no key>"


tagFor : Organize.Owner -> String
tagFor o =
    Organize.foldersKey o |> Maybe.map (\k -> "owner:" ++ k) |> Maybe.withDefault "<no tag>"


payload : String -> List ( String, Maybe String ) -> Encode.Value
payload tag values =
    Encode.object
        [ ( "tag", Encode.string tag )
        , ( "values"
          , Encode.object (List.map (\( k, v ) -> ( k, Maybe.map Encode.string v |> Maybe.withDefault Encode.null )) values)
          )
        ]


{-| A state whose owner memory has loaded (empty). -}
ready : Organizer.State
ready =
    Organizer.update ctx (Loaded (payload (tagFor owner) [])) Organizer.init |> Tuple.first


withFolders : Organizer.State
withFolders =
    let
        stored =
            """[{"id":"a","name":"Work","rooms":["#design"],"collapsed":false},{"id":"b","name":"Friends","rooms":[],"collapsed":false}]"""
    in
    Organizer.update ctx (Loaded (payload (tagFor owner) [ ( key Organize.foldersKey, Just stored ) ])) Organizer.init |> Tuple.first


run : Organizer.Msg -> Organizer.State -> ( Organizer.State, List Effect )
run msg state =
    Organizer.update ctx msg state


stores : List Effect -> List ( String, Maybe String )
stores effects =
    List.filterMap
        (\e ->
            case e of
                Store k v ->
                    Just ( k, v )

                _ ->
                    Nothing
        )
        effects


toasts : List Effect -> List String
toasts effects =
    List.filterMap
        (\e ->
            case e of
                Toast title _ ->
                    Just title

                _ ->
                    Nothing
        )
        effects


suite : Test
suite =
    describe "Organizer"
        [ loading
        , gate
        , folderMsgs
        , hiding
        , closing
        , saving
        , notes
        , attention
        , settle
        ]


loading : Test
loading =
    describe "loading"
        [ test "the owner read asks for every owner key, tagged for that owner" <|
            \_ ->
                Organizer.ownerRead owner
                    |> Maybe.map (\r -> { tag = r.tag, count = List.length r.keys, hidden = List.member (key Organize.hiddenKey) r.keys, oracle = List.member (key Organize.navigationKey) r.keys })
                    |> Expect.equal (Just { tag = tagFor owner, count = 7, hidden = True, oracle = True })
        , test "an unusable owner has no read" <|
            \_ ->
                Organizer.ownerRead { owner | identity = "" } |> Expect.equal Nothing
        , test "the device read covers quiet hours and the preset" <|
            \_ ->
                Organizer.deviceRead.keys
                    |> Expect.equal [ "onyx:dnd-quiet-start", "onyx:dnd-quiet-end", "onyx:dnd-quiet-enabled", "onyx:calm" ]
        , test "a device answer sets the schedule and the preset" <|
            \_ ->
                Organizer.update ctx
                    (Loaded
                        (payload "device"
                            [ ( "onyx:dnd-quiet-start", Just "23" )
                            , ( "onyx:dnd-quiet-end", Just "7" )
                            , ( "onyx:dnd-quiet-enabled", Just "true" )
                            , ( "onyx:calm", Just "calm" )
                            ]
                        )
                    )
                    Organizer.init
                    |> Tuple.first
                    |> (\s -> ( s.quiet, s.preset ))
                    |> Expect.equal ( { enabled = True, startHour = 23, endHour = 7 }, Calm )
        , test "an owner answer fills folders, hidden, closed, saves, notes and smart mute" <|
            \_ ->
                let
                    loaded =
                        Organizer.update ctx
                            (Loaded
                                (payload (tagFor owner)
                                    [ ( key Organize.foldersKey, Just """[{"id":"a","name":"Work","rooms":["#design"]}]""" )
                                    , ( key Organize.hiddenKey, Just """["#elm"]""" )
                                    , ( key Organize.closedKey, Just """["jun"]""" )
                                    , ( key Organize.bookmarksKey, Just """[{"id":"1","target":"#a","from":"x","snippet":"hi","locked":false,"at":1,"savedAt":2}]""" )
                                    , ( key Organize.notesKey, Just """{"mara":"design crit"}""" )
                                    , ( key (Organize.ownerKey "onyx:smart-mute"), Just """{"keywords":["spam"],"mutedNicks":["bot"],"muteSystemNoise":false}""" )
                                    ]
                                )
                            )
                            Organizer.init
                            |> Tuple.first
                in
                Expect.equal
                    { folders = List.map .name loaded.folders
                    , hidden = Set.toList loaded.hidden
                    , closed = Dict.keys loaded.closed
                    , saved = List.length loaded.bookmarks
                    , note = Organize.noteFor "mara" loaded.notes
                    , smart = loaded.smartMute.keywords
                    , drafts = ( loaded.smartKeywordsDraft, loaded.smartNicksDraft )
                    , loaded = loaded.ownerLoaded
                    }
                    { folders = [ "Work" ]
                    , hidden = [ "#elm" ]
                    , closed = [ "jun" ]
                    , saved = 1
                    , note = Just "design crit"
                    , smart = [ "spam" ]
                    , drafts = ( "spam", "bot" )
                    , loaded = True
                    }
        , test "an answer for a different owner is stale and dropped" <|
            \_ ->
                let
                    after =
                        Organizer.update ctx (Loaded (payload (tagFor other) [ ( key Organize.hiddenKey, Just """["#x"]""" ) ])) Organizer.init |> Tuple.first
                in
                Expect.equal ( after.ownerLoaded, Set.isEmpty after.hidden ) ( False, True )
        , test "garbage answers change nothing" <|
            \_ ->
                Organizer.update ctx (Loaded (Encode.string "nope")) ready |> Expect.equal ( ready, [] )
        , test "after an account switch the previous owner's memory never shows" <|
            \_ ->
                let
                    full =
                        run (Hide "#design") ready |> Tuple.first

                    seenBySomeoneElse =
                        Organizer.current (Just other) full
                in
                Expect.equal
                    ( Set.isEmpty seenBySomeoneElse.hidden, seenBySomeoneElse.ownerLoaded, seenBySomeoneElse.owner )
                    ( True, False, Just other )
        , test "no owner at all clears the memory too" <|
            \_ ->
                Organizer.current Nothing (run (Hide "#design") ready |> Tuple.first)
                    |> (\s -> ( Set.isEmpty s.hidden, s.ownerLoaded ))
                    |> Expect.equal ( True, False )
        , test "the oracle's channel-navigation folders import once, written under this client's own key" <|
            \_ ->
                let
                    ( state, effects ) =
                        Organizer.update ctx
                            (Loaded
                                (payload (tagFor owner)
                                    [ ( key Organize.navigationKey, Just """{"channelFolders":[{"id":"w","name":"Work","channels":["#design"],"collapsed":false}]}""" ) ]
                                )
                            )
                            Organizer.init
                in
                Expect.equal
                    ( List.map .name state.folders, List.map Tuple.first (stores effects) )
                    ( [ "Work" ], [ key Organize.foldersKey ] )
        , test "folders of our own win over the oracle's record" <|
            \_ ->
                let
                    ( state, effects ) =
                        Organizer.update ctx
                            (Loaded
                                (payload (tagFor owner)
                                    [ ( key Organize.foldersKey, Just """[{"id":"mine","name":"Mine","rooms":[]}]""" )
                                    , ( key Organize.navigationKey, Just """{"channelFolders":[{"id":"w","name":"Work","channels":[]}]}""" )
                                    ]
                                )
                            )
                            Organizer.init
                in
                Expect.equal ( List.map .name state.folders, effects ) ( [ "Mine" ], [] )
        , test "ready needs the live owner and a finished load" <|
            \_ ->
                Expect.equal
                    [ False, True, False, False ]
                    [ Organizer.ready (Just owner) Organizer.init
                    , Organizer.ready (Just owner) ready
                    , Organizer.ready (Just other) ready
                    , Organizer.ready Nothing ready
                    ]
        ]


gate : Test
gate =
    describe "the write gate"
        [ test "before the owner memory loads, writes refuse and say so" <|
            \_ ->
                let
                    ( state, effects ) =
                        run (Hide "#design") Organizer.init
                in
                Expect.equal ( Set.isEmpty state.hidden, stores effects, toasts effects ) ( True, [], [ "Not saved yet" ] )
        , test "with no owner, writes refuse and ask to connect" <|
            \_ ->
                Organizer.update { ctx | owner = Nothing } (Hide "#design") ready
                    |> (\( s, e ) -> ( Set.isEmpty s.hidden, stores e, toasts e ))
                    |> Expect.equal ( True, [], [ "Connect first" ] )
        , test "UI-only messages need no owner" <|
            \_ ->
                Organizer.update { ctx | owner = Nothing } ShowHiddenToggle Organizer.init
                    |> (\( s, e ) -> ( s.showHidden, e ))
                    |> Expect.equal ( True, [] )
        ]


folderMsgs : Test
folderMsgs =
    describe "folders"
        [ test "create stores the list under the owner's key" <|
            \_ ->
                let
                    ( state, effects ) =
                        ready |> run (FolderDraft "  Work  ") |> Tuple.first |> run (FolderCreate Nothing)
                in
                Expect.equal
                    ( List.map .name state.folders, state.folderDraft, List.map Tuple.first (stores effects) )
                    ( [ "Work" ], "", [ key Organize.foldersKey ] )
        , test "create and move files the room and says where it went" <|
            \_ ->
                let
                    ( state, effects ) =
                        ready |> run (FolderDraft "Work") |> Tuple.first |> run (FolderCreate (Just "#design"))
                in
                Expect.equal
                    ( List.map .rooms state.folders, state.sheet, toasts effects )
                    ( [ [ "#design" ] ], Nothing, [ "Moved to Work" ] )
        , test "a bad name keeps the draft, shows the reason, writes nothing" <|
            \_ ->
                let
                    ( state, effects ) =
                        withFolders |> run (FolderDraft "work") |> Tuple.first |> run (FolderCreate Nothing)
                in
                Expect.equal ( state.folderError, effects, state.folderDraft )
                    ( Just "You already have a folder called work.", [], "work" )
        , test "typing clears the old error" <|
            \_ ->
                withFolders
                    |> run (FolderDraft "work")
                    |> Tuple.first
                    |> run (FolderCreate Nothing)
                    |> Tuple.first
                    |> run (FolderDraft "worker")
                    |> Tuple.first
                    |> .folderError
                    |> Expect.equal Nothing
        , test "assign moves the room, closes the sheet, stores, toasts" <|
            \_ ->
                let
                    ( state, effects ) =
                        withFolders |> run (MoveOpen "#lounge") |> Tuple.first |> run (FolderAssign "#lounge" (Just "b"))
                in
                Expect.equal
                    { rooms = List.map .rooms state.folders, sheet = state.sheet, writes = List.length (stores effects), toasts = toasts effects }
                    { rooms = [ [ "#design" ], [ "#lounge" ] ], sheet = Nothing, writes = 1, toasts = [ "Moved to Friends" ] }
        , test "assigning to no folder says it is back in Rooms" <|
            \_ ->
                withFolders
                    |> run (FolderAssign "#design" Nothing)
                    |> (\( s, e ) -> ( List.map .rooms s.folders, toasts e ))
                    |> Expect.equal ( [ [], [] ], [ "Back in Rooms" ] )
        , test "toggle, move and delete all store" <|
            \_ ->
                let
                    step msg ( s, n ) =
                        let
                            ( next, e ) =
                                run msg s
                        in
                        ( next, n + List.length (stores e) )

                    ( final, writes ) =
                        List.foldl step ( withFolders, 0 ) [ FolderToggle "a", FolderMove "a" 1, FolderDelete "b" ]
                in
                Expect.equal ( List.map .id final.folders, writes ) ( [ "a" ], 3 )
        , test "deleting a folder tells you the rooms are back" <|
            \_ ->
                run (FolderDelete "a") withFolders
                    |> Tuple.second
                    |> toasts
                    |> Expect.equal [ "Deleted Work" ]
        , test "rename saves, validates, cancels" <|
            \_ ->
                let
                    started =
                        run (FolderRenameStart "a") withFolders |> Tuple.first

                    typed =
                        run (FolderRenameDraft "Projects") started |> Tuple.first

                    ( saved, effects ) =
                        run FolderRenameSave typed

                    clash =
                        run (FolderRenameDraft "friends") started |> Tuple.first |> run FolderRenameSave

                    cancelled =
                        run FolderRenameCancel started |> Tuple.first
                in
                Expect.equal
                    { seeded = started.renaming |> Maybe.map .draft
                    , names = List.map .name saved.folders
                    , done = saved.renaming
                    , writes = List.length (stores effects)
                    , clashError = (Tuple.first clash).folderError
                    , clashStillEditing = (Tuple.first clash).renaming /= Nothing
                    , cancelled = cancelled.renaming
                    }
                    { seeded = Just "Work"
                    , names = [ "Projects", "Friends" ]
                    , done = Nothing
                    , writes = 1
                    , clashError = Just "You already have a folder called friends."
                    , clashStillEditing = True
                    , cancelled = Nothing
                    }
        ]


hiding : Test
hiding =
    describe "hidden rooms"
        [ test "hide stores the lowered name, closes the sheet, explains the way back" <|
            \_ ->
                let
                    ( state, effects ) =
                        ready |> run (RowMenuOpen "#Elm") |> Tuple.first |> run (Hide "#Elm")
                in
                Expect.equal
                    { hidden = Set.toList state.hidden, sheet = state.sheet, stores = stores effects, toasts = toasts effects }
                    { hidden = [ "#elm" ], sheet = Nothing, stores = [ ( key Organize.hiddenKey, Just """["#elm"]""" ) ], toasts = [ "Hid #Elm" ] }
        , test "a name that is not a room is ignored" <|
            \_ ->
                run (Hide "mara") ready |> Expect.equal ( ready, [] )
        , test "unhide removes it, and the empty set removes the key" <|
            \_ ->
                let
                    hidden =
                        run (Hide "#elm") ready |> Tuple.first

                    ( state, effects ) =
                        run (Unhide "#ELM") hidden
                in
                Expect.equal ( Set.isEmpty state.hidden, stores effects, toasts effects )
                    ( True, [ ( key Organize.hiddenKey, Nothing ) ], [ "Showing #ELM" ] )
        , test "the cap refuses the 513th" <|
            \_ ->
                let
                    crowded =
                        { ready | hidden = Set.fromList (List.map (\i -> "#r" ++ String.fromInt i) (List.range 1 Organize.maxHidden)) }

                    ( state, effects ) =
                        run (Hide "#one-more") crowded
                in
                Expect.equal ( Set.size state.hidden, toasts effects ) ( Organize.maxHidden, [ "Too many hidden rooms" ] )
        , test "the hidden list toggle is UI only" <|
            \_ ->
                run ShowHiddenToggle ready |> (\( s, e ) -> ( s.showHidden, e )) |> Expect.equal ( True, [] )
        , test "isHidden folds case" <|
            \_ ->
                Organizer.isHidden "#ELM" (run (Hide "#elm") ready |> Tuple.first) |> Expect.equal True
        ]


closing : Test
closing =
    describe "closed conversations"
        [ test "closing stores the nick and keeps the open conversation from going stale" <|
            \_ ->
                let
                    ( state, effects ) =
                        Organizer.update { ctx | active = Just "Jun" } (CloseConversation "Jun") ready
                in
                Expect.equal
                    { closed = Dict.keys state.closed, keys = List.map Tuple.first (stores effects), leaves = List.member (LeaveConversation "Jun") effects, toasts = toasts effects }
                    { closed = [ "jun" ], keys = [ key Organize.closedKey ], leaves = True, toasts = [ "Conversation closed" ] }
        , test "closing a DM that is not open does not navigate" <|
            \_ ->
                Organizer.update { ctx | active = Just "mara" } (CloseConversation "jun") ready
                    |> Tuple.second
                    |> List.any (\e -> e == LeaveConversation "jun")
                    |> Expect.equal False
        , test "closed DMs are hidden from lists until reopened" <|
            \_ ->
                let
                    closed =
                        run (CloseConversation "jun") ready |> Tuple.first
                in
                Expect.equal ( Organizer.closedVisible "JUN" closed, Organizer.closedVisible "mara" closed )
                    ( False, True )
        , test "reopen forgets the close and opens the conversation" <|
            \_ ->
                let
                    closed =
                        run (CloseConversation "jun") ready |> Tuple.first

                    ( state, effects ) =
                        run (Reopen "Jun") closed
                in
                Expect.equal
                    ( Dict.isEmpty state.closed, List.member (OpenConversation "Jun") effects, stores effects )
                    ( True, True, [ ( key Organize.closedKey, Nothing ) ] )
        , test "a room name is not a conversation" <|
            \_ ->
                run (CloseConversation "#lounge") ready |> Expect.equal ( ready, [] )
        ]


saving : Test
saving =
    let
        input =
            { id = "m1", target = "#lounge", from = "sol", text = Just "welcome in!", at = 1000, savedAt = 2000 }
    in
    describe "saved messages"
        [ test "save adds, a second save removes (the menu's toggle)" <|
            \_ ->
                let
                    ( saved, saveFx ) =
                        run (BookmarkSave input) ready

                    ( removed, removeFx ) =
                        run (BookmarkSave input) saved
                in
                Expect.equal
                    { saved = List.length saved.bookmarks, saveToasts = toasts saveFx, removed = List.length removed.bookmarks, removeToasts = toasts removeFx }
                    { saved = 1, saveToasts = [ "Message saved" ], removed = 0, removeToasts = [ "Removed from saved" ] }
        , test "the store carries the snippet but an encrypted row never its words" <|
            \_ ->
                let
                    ( _, effects ) =
                        run (BookmarkSave { input | text = Nothing, target = "mara" }) ready
                in
                stores effects
                    |> List.filterMap Tuple.second
                    |> List.all (\raw -> String.contains "\"locked\":true" raw && String.contains "\"snippet\":\"\"" raw)
                    |> Expect.equal True
        , test "remove drops one save and stores" <|
            \_ ->
                let
                    saved =
                        run (BookmarkSave input) ready |> Tuple.first

                    ( state, effects ) =
                        run (BookmarkRemove "#LOUNGE" "m1") saved
                in
                Expect.equal ( state.bookmarks, stores effects ) ( [], [ ( key Organize.bookmarksKey, Nothing ) ] )
        , test "jump closes the sheet and asks for the message" <|
            \_ ->
                run BookmarksOpen ready
                    |> Tuple.first
                    |> run (BookmarkJump "#lounge" "m1")
                    |> (\( s, e ) -> ( s.sheet, e ))
                    |> Expect.equal ( Nothing, [ JumpToMessage "#lounge" "m1" ] )
        , test "saving needs a loaded owner" <|
            \_ ->
                run (BookmarkSave input) Organizer.init |> (\( s, e ) -> ( s.bookmarks, toasts e )) |> Expect.equal ( [], [ "Not saved yet" ] )
        ]


notes : Test
notes =
    describe "private notes"
        [ test "edit seeds the draft from the saved note; save stores; clearing removes" <|
            \_ ->
                let
                    ( saved, saveFx ) =
                        ready |> run (NoteEdit "Mara") |> Tuple.first |> run (NoteDraft "design crit") |> Tuple.first |> run NoteSave

                    reopened =
                        run (NoteEdit "mara") saved |> Tuple.first

                    ( cleared, clearFx ) =
                        reopened |> run (NoteDraft "  ") |> Tuple.first |> run NoteSave
                in
                Expect.equal
                    ( ( Organize.noteFor "mara" saved.notes, saved.noteEditing, List.length (stores saveFx) )
                    , ( reopened.noteEditing |> Maybe.map .draft, Dict.isEmpty cleared.notes, stores clearFx )
                    )
                    ( ( Just "design crit", Nothing, 1 )
                    , ( Just "design crit", True, [ ( key Organize.notesKey, Nothing ) ] )
                    )
        , test "an over-long note keeps the editor open with the reason" <|
            \_ ->
                let
                    ( state, effects ) =
                        ready
                            |> run (NoteEdit "mara")
                            |> Tuple.first
                            |> run (NoteDraft (String.repeat 2100 "x"))
                            |> Tuple.first
                            |> run NoteSave
                in
                Expect.equal ( state.noteError, state.noteEditing /= Nothing, effects ) ( Just "Notes can be up to 2048 characters.", True, [] )
        , test "cancel drops the draft" <|
            \_ ->
                ready |> run (NoteEdit "mara") |> Tuple.first |> run NoteCancel |> Tuple.first |> .noteEditing |> Expect.equal Nothing
        ]


attention : Test
attention =
    describe "attention"
        [ test "turning quiet hours on offers 22:00-08:00 when the window was empty" <|
            \_ ->
                let
                    empty =
                        { ready | quiet = { enabled = False, startHour = 5, endHour = 5 } }
                in
                run QuietToggle empty
                    |> (\( s, e ) -> ( s.quiet, List.map Tuple.first (stores e) ))
                    |> Expect.equal ( { enabled = True, startHour = 22, endHour = 8 }, [ "onyx:dnd-quiet-start", "onyx:dnd-quiet-end", "onyx:dnd-quiet-enabled" ] )
        , test "toggling keeps the chosen hours and writes the flag" <|
            \_ ->
                let
                    chosen =
                        { ready | quiet = { enabled = True, startHour = 23, endHour = 6 } }

                    ( off, effects ) =
                        run QuietToggle chosen
                in
                Expect.equal
                    ( off.quiet, List.filterMap (\( k, v ) -> if k == "onyx:dnd-quiet-enabled" then v else Nothing) (stores effects) )
                    ( { enabled = False, startHour = 23, endHour = 6 }, [ "false" ] )
        , test "start and end hours clamp to a day and store" <|
            \_ ->
                let
                    ( s1, e1 ) =
                        run (QuietStart 30) ready

                    ( s2, _ ) =
                        run (QuietEnd -4) s1
                in
                Expect.equal
                    { start = s1.quiet.startHour, end = s2.quiet.endHour, stored = List.filterMap (\( k, v ) -> if k == "onyx:dnd-quiet-start" then v else Nothing) (stores e1) }
                    { start = 23, end = 0, stored = [ "23" ] }
        , test "quiet hours are device-wide: they store without an owner" <|
            \_ ->
                Organizer.update { ctx | owner = Nothing } QuietToggle Organizer.init
                    |> Tuple.second
                    |> stores
                    |> List.length
                    |> Expect.equal 3
        , test "the preset stores under onyx:calm" <|
            \_ ->
                run (PresetSet Power) ready
                    |> (\( s, e ) -> ( s.preset, stores e ))
                    |> Expect.equal ( Power, [ ( "onyx:calm", Just "power" ) ] )
        , test "smart mute save parses both lists, drops spaced nicks, stores owner-scoped, keeps the system flag" <|
            \_ ->
                let
                    withFlag =
                        { ready | smartMute = { keywords = [], nicks = [], muteSystemNoise = True } }

                    ( state, effects ) =
                        withFlag
                            |> run (SmartKeywordsDraft "Crypto airdrop, free nitro")
                            |> Tuple.first
                            |> run (SmartNicksDraft "Deploy-Bot, two words")
                            |> Tuple.first
                            |> run SmartSave
                in
                Expect.equal
                    ( state.smartMute
                    , state.smartStatus
                    , List.map Tuple.first (stores effects)
                    )
                    ( { keywords = [ "crypto airdrop", "free nitro" ], nicks = [ "deploy-bot" ], muteSystemNoise = True }
                    , Just "Saved. 2 words · 1 person muted."
                    , [ key (Organize.ownerKey "onyx:smart-mute") ]
                    )
        , test "smart mute needs the owner memory" <|
            \_ ->
                run SmartSave Organizer.init |> Tuple.second |> toasts |> Expect.equal [ "Not saved yet" ]
        , test "digest jump asks to land on the first unread line" <|
            \_ ->
                run (DigestJump "#design") ready |> Tuple.second |> Expect.equal [ JumpFirstUnread "#design" ]
        , test "queued-send actions: open goes to the target, remove is two steps" <|
            \_ ->
                let
                    asked =
                        run (OutboxRemoveAsk "o1") ready |> Tuple.first

                    kept =
                        run OutboxRemoveCancel asked |> Tuple.first
                in
                Expect.equal
                    ( asked.outboxConfirm, kept.outboxConfirm, run (OutboxOpen "#lounge") asked |> Tuple.second )
                    ( Just "o1", Nothing, [ OpenConversation "#lounge" ] )
        ]


settle : Test
settle =
    describe "reopen / reveal selectors"
        [ test "reopenWhere reopens the picked DMs and stores the rest" <|
            \_ ->
                let
                    closed =
                        ready |> run (CloseConversation "jun") |> Tuple.first |> run (CloseConversation "mara") |> Tuple.first

                    ( state, effects ) =
                        Organizer.reopenWhere (Just owner) (\k _ -> k == "jun") closed
                in
                Expect.equal
                    ( Dict.keys state.closed, stores effects )
                    ( [ "mara" ], [ ( key Organize.closedKey, Just """["mara"]""" ) ] )
        , test "reopenWhere passes the time it was closed, so history replays can be told apart" <|
            \_ ->
                let
                    closed =
                        run (CloseConversation "jun") ready |> Tuple.first
                in
                Organizer.reopenWhere (Just owner) (\_ at -> at == ctx.nowMs) closed
                    |> Tuple.first
                    |> .closed
                    |> Dict.isEmpty
                    |> Expect.equal True
        , test "nothing to reopen is the same state and no effects" <|
            \_ ->
                Organizer.reopenWhere (Just owner) (\_ _ -> False) ready |> Expect.equal ( ready, [] )
        , test "revealWhere brings hidden rooms back and stores" <|
            \_ ->
                let
                    hidden =
                        ready |> run (Hide "#elm") |> Tuple.first |> run (Hide "#design") |> Tuple.first

                    ( state, effects ) =
                        Organizer.revealWhere (Just owner) ((==) "#elm") hidden
                in
                Expect.equal ( Set.toList state.hidden, List.length (stores effects) ) ( [ "#design" ], 1 )
        , test "neither runs before the owner memory has loaded (never writes a half-read list)" <|
            \_ ->
                let
                    fresh =
                        Organizer.init

                    unloaded =
                        { fresh | owner = Just owner, closed = Dict.fromList [ ( "jun", 0 ) ], hidden = Set.fromList [ "#elm" ] }
                in
                Expect.equal
                    ( Organizer.reopenWhere (Just owner) (\_ _ -> True) unloaded |> Tuple.second
                    , Organizer.revealWhere (Just owner) (\_ -> True) unloaded |> Tuple.second
                    )
                    ( [], [] )
        , test "nor for an owner that is no longer live" <|
            \_ ->
                let
                    hidden =
                        run (Hide "#elm") ready |> Tuple.first
                in
                Organizer.revealWhere (Just other) (\_ -> True) hidden |> Tuple.second |> Expect.equal []
        ]
