module Organizer exposing
    ( Ctx
    , Effect(..)
    , Msg(..)
    , Sheet(..)
    , State
    , closedVisible
    , current
    , deviceKeys
    , deviceRead
    , init
    , isHidden
    , loadedFor
    , ready
    , ownerKeys
    , ownerRead
    , reopenWhere
    , revealWhere
    , sheetOpen
    , update
    )

{-| v3/gap-organize — the organize + attention feature: one model
field (`App.Model.organize`), one wrapper message (`App.OrganizeMsg`)
and one settle step. Pure: `update` returns the new state plus
`Effect`s — storage writes / reads and cross-feature intents (open a
conversation, jump to a message, toast, leave the closed DM) that
`App` performs. No `App` import, so it is testable on its own.

Persistence (ports `organizeStore` / `organizeLoad` / `organizeLoaded`):

  - owner-scoped (`base:owner:<enc>`, refused without an owner):
    `onyx:room-folders`, `onyx:hidden-rooms`,
    `onyx:closed-conversations`, `onyx:bookmarks`, `onyx:user-notes`,
    `onyx:smart-mute` (+ a one-time read of the oracle's
    `onyx:channel-navigation` record for its folders);
  - device-wide: `onyx:dnd-quiet-start`, `onyx:dnd-quiet-end`,
    `onyx:dnd-quiet-enabled`, `onyx:calm`.

-}

import Attention
import Dict exposing (Dict)
import Json.Decode as Decode
import Organize exposing (Bookmark, Folder, Owner)
import Set exposing (Set)


type Sheet
    = RowMenu String
    | MoveToFolder String
    | Bookmarks


type alias State =
    { -- persisted (owner-scoped)
      owner : Maybe Owner
    , ownerLoaded : Bool
    , folders : List Folder
    , hidden : Set String
    , closed : Dict String Float
    , bookmarks : List Bookmark
    , notes : Dict String String
    , smartMute : Attention.SmartMute

    -- persisted (device)
    , quiet : Attention.QuietHours
    , preset : Attention.Preset

    -- ui
    , sheet : Maybe Sheet
    , showHidden : Bool
    , showClosed : Bool
    , folderDraft : String
    , folderError : Maybe String
    , renaming : Maybe { id : String, draft : String }
    , noteEditing : Maybe { nick : String, draft : String }
    , noteError : Maybe String
    , smartKeywordsDraft : String
    , smartNicksDraft : String
    , smartStatus : Maybe String
    , outboxConfirm : Maybe String
    }


init : State
init =
    { owner = Nothing
    , ownerLoaded = False
    , folders = []
    , hidden = Set.empty
    , closed = Dict.empty
    , bookmarks = []
    , notes = Dict.empty
    , smartMute = Attention.emptySmartMute
    , quiet = Attention.defaultQuietHours
    , preset = Attention.Regular
    , sheet = Nothing
    , showHidden = False
    , showClosed = False
    , folderDraft = ""
    , folderError = Nothing
    , renaming = Nothing
    , noteEditing = Nothing
    , noteError = Nothing
    , smartKeywordsDraft = ""
    , smartNicksDraft = ""
    , smartStatus = Nothing
    , outboxConfirm = Nothing
    }


{-| What `update` needs from the app model. -}
type alias Ctx =
    { owner : Maybe Owner
    , nowMs : Float
    , active : Maybe String
    }


type Msg
    = Loaded Decode.Value
      -- sheets
    | RowMenuOpen String
    | MoveOpen String
    | BookmarksOpen
    | SheetClose
      -- folders
    | FolderDraft String
    | FolderCreate (Maybe String)
    | FolderAssign String (Maybe String)
    | FolderToggle String
    | FolderMove String Int
    | FolderDelete String
    | FolderRenameStart String
    | FolderRenameDraft String
    | FolderRenameSave
    | FolderRenameCancel
      -- hidden rooms / closed conversations
    | Hide String
    | Unhide String
    | ShowHiddenToggle
    | CloseConversation String
    | Reopen String
    | ShowClosedToggle
      -- saved messages
    | BookmarkSave Organize.BookmarkInput
    | BookmarkRemove String String
    | BookmarkJump String String
      -- private notes
    | NoteEdit String
    | NoteDraft String
    | NoteSave
    | NoteCancel
      -- attention
    | QuietToggle
    | QuietStart Int
    | QuietEnd Int
    | PresetSet Attention.Preset
    | SmartKeywordsDraft String
    | SmartNicksDraft String
    | SmartSave
      -- Home
    | DigestJump String
    | OutboxOpen String
    | OutboxRemoveAsk String
    | OutboxRemoveCancel


type Effect
    = Store String (Maybe String)
    | Toast String (Maybe String)
    | OpenConversation String
    | JumpToMessage String String
    | JumpFirstUnread String
    | LeaveConversation String


{-| Loaded for the live owner: writes are safe. -}
ready : Maybe Owner -> State -> Bool
ready live state =
    live /= Nothing && state.owner == live && state.ownerLoaded


sheetOpen : State -> Bool
sheetOpen state =
    state.sheet /= Nothing


isHidden : String -> State -> Bool
isHidden room state =
    Set.member (String.toLower room) state.hidden


{-| A closed DM stays off the Messages list until it is opened again
or something new arrives (`reopenWhere` does the reopening). -}
closedVisible : String -> State -> Bool
closedVisible nick state =
    not (Dict.member (String.toLower nick) state.closed)



-- KEYS


deviceKeys : List String
deviceKeys =
    [ Attention.quietStartKey, Attention.quietEndKey, Attention.quietEnabledKey, Attention.calmKey ]


ownerKeys : Owner -> List String
ownerKeys owner =
    List.filterMap (\k -> k owner)
        [ Organize.foldersKey
        , Organize.navigationKey
        , Organize.hiddenKey
        , Organize.closedKey
        , Organize.bookmarksKey
        , Organize.notesKey
        , Organize.ownerKey Attention.smartMuteKey
        ]



-- LOADING


type alias LoadedPayload =
    { tag : String
    , values : Dict String (Maybe String)
    }


payloadDecoder : Decode.Decoder LoadedPayload
payloadDecoder =
    Decode.map2 LoadedPayload
        (Decode.field "tag" Decode.string)
        (Decode.field "values" (Decode.dict (Decode.nullable Decode.string)))


{-| The device-wide read (`Main.init`). -}
deviceRead : { tag : String, keys : List String }
deviceRead =
    { tag = "device", keys = deviceKeys }


ownerTag : Owner -> Maybe String
ownerTag owner =
    Organize.foldersKey owner |> Maybe.map (\k -> "owner:" ++ k)


{-| The owner-scoped read, asked by `Main` whenever the device-memory
owner changes (connect, nick change, sign-in, account switch). -}
ownerRead : Owner -> Maybe { tag : String, keys : List String }
ownerRead owner =
    ownerTag owner |> Maybe.map (\tag -> { tag = tag, keys = ownerKeys owner })


{-| The organize memory as it applies to the live owner: after an
account switch the previous owner's folders, notes and saved messages
never show (or get written) until the new owner's answer lands. -}
current : Maybe Owner -> State -> State
current live state =
    if state.owner == live then
        state

    else
        { state
            | owner = live
            , ownerLoaded = False
            , folders = []
            , hidden = Set.empty
            , closed = Dict.empty
            , bookmarks = []
            , notes = Dict.empty
            , smartMute = Attention.emptySmartMute
            , smartKeywordsDraft = ""
            , smartNicksDraft = ""
            , noteEditing = Nothing
            , renaming = Nothing
        }


{-| Fold a load answer. An owner answer for anyone but the live owner
is stale (an account switch raced it) and is dropped. Returns the
effects a migration needs (the oracle's folders, written once under
this client's own key). -}
loadedFor : Ctx -> Decode.Value -> State -> ( State, List Effect )
loadedFor ctx raw state =
    case Decode.decodeValue payloadDecoder raw of
        Err _ ->
            ( state, [] )

        Ok payload ->
            let
                value key =
                    Dict.get key payload.values |> Maybe.andThen identity
            in
            if payload.tag == "device" then
                ( { state
                    | quiet =
                        Attention.loadQuietHours
                            { start = value Attention.quietStartKey
                            , end = value Attention.quietEndKey
                            , enabled = value Attention.quietEnabledKey
                            }
                    , preset = Maybe.map Attention.parsePreset (value Attention.calmKey) |> Maybe.withDefault Attention.Regular
                  }
                , []
                )

            else
                case ctx.owner of
                    Nothing ->
                        ( state, [] )

                    Just owner ->
                        if Just payload.tag /= ownerTag owner then
                            ( state, [] )

                        else
                            let
                                keyed k =
                                    k owner |> Maybe.andThen value

                                own =
                                    keyed Organize.foldersKey |> Maybe.map Organize.decodeFolders

                                fromOracle =
                                    keyed Organize.navigationKey |> Maybe.map Organize.decodeNavigationFolders |> Maybe.withDefault []

                                ( folders, migrate ) =
                                    case own of
                                        Just list ->
                                            ( list, [] )

                                        Nothing ->
                                            if List.isEmpty fromOracle then
                                                ( [], [] )

                                            else
                                                ( fromOracle, storeFolders owner fromOracle )

                                smart =
                                    keyed (Organize.ownerKey Attention.smartMuteKey)
                                        |> Maybe.map Attention.decodeSmartMute
                                        |> Maybe.withDefault Attention.emptySmartMute

                                base =
                                    current ctx.owner state
                            in
                            ( { base
                                | ownerLoaded = True
                                , folders = folders
                                , hidden = keyed Organize.hiddenKey |> Maybe.map (Organize.decodeNameSet Organize.normalizeRoom Organize.maxHidden) |> Maybe.withDefault Set.empty
                                , closed =
                                    keyed Organize.closedKey
                                        |> Maybe.map (Organize.decodeNameSet Organize.normalizeNick Organize.maxClosed)
                                        |> Maybe.withDefault Set.empty
                                        |> Set.toList
                                        |> List.map (\nick -> ( nick, ctx.nowMs ))
                                        |> Dict.fromList
                                , bookmarks = keyed Organize.bookmarksKey |> Maybe.map Organize.decodeBookmarks |> Maybe.withDefault []
                                , notes = keyed Organize.notesKey |> Maybe.map Organize.decodeNotes |> Maybe.withDefault Dict.empty
                                , smartMute = smart
                                , smartKeywordsDraft = String.join ", " smart.keywords
                                , smartNicksDraft = String.join ", " smart.nicks
                              }
                            , migrate
                            )


{-| Reopen the closed conversations `pick` selects (lowered nick and
the time it was closed — or loaded — on this device). -}
reopenWhere : Maybe Owner -> (String -> Float -> Bool) -> State -> ( State, List Effect )
reopenWhere live pick state =
    case ( state.owner, ready live state ) of
        ( Just owner, True ) ->
            let
                ( back, kept ) =
                    Dict.partition pick state.closed
            in
            if Dict.isEmpty back then
                ( state, [] )

            else
                ( { state | closed = kept }, storeClosed owner kept )

        _ ->
            ( state, [] )


{-| Bring back the hidden rooms `pick` selects (a mention, your own
line, or opening it from the list). -}
revealWhere : Maybe Owner -> (String -> Bool) -> State -> ( State, List Effect )
revealWhere live pick state =
    case ( state.owner, ready live state ) of
        ( Just owner, True ) ->
            let
                ( back, kept ) =
                    Set.partition pick state.hidden
            in
            if Set.isEmpty back then
                ( state, [] )

            else
                ( { state | hidden = kept }, storeHidden owner kept )

        _ ->
            ( state, [] )



-- UPDATE


withOwner : Ctx -> State -> (Owner -> ( State, List Effect )) -> ( State, List Effect )
withOwner ctx state run =
    case ctx.owner of
        Just owner ->
            if state.owner == Just owner && state.ownerLoaded then
                run owner

            else
                ( state, [ Toast "Not saved yet" (Just "This device is still loading your saved places. Try again in a moment.") ] )

        Nothing ->
            ( state, [ Toast "Connect first" (Just "Folders, saved messages and notes are kept per account on this device.") ] )


store : (Owner -> Maybe String) -> Owner -> Maybe String -> List Effect
store keyFor owner value =
    case keyFor owner of
        Just key ->
            [ Store key value ]

        Nothing ->
            []


storeFolders : Owner -> List Folder -> List Effect
storeFolders owner folders =
    store Organize.foldersKey owner (Organize.encodeFolders folders)


storeHidden : Owner -> Set String -> List Effect
storeHidden owner hidden =
    store Organize.hiddenKey owner (Organize.encodeNameSet hidden)


storeClosed : Owner -> Dict String Float -> List Effect
storeClosed owner closed =
    store Organize.closedKey owner (Organize.encodeNameSet (Set.fromList (Dict.keys closed)))


storeBookmarks : Owner -> List Bookmark -> List Effect
storeBookmarks owner bookmarks =
    store Organize.bookmarksKey owner (Organize.encodeBookmarks bookmarks)


storeNotes : Owner -> Dict String String -> List Effect
storeNotes owner notes =
    store Organize.notesKey owner (Organize.encodeNotes notes)


storeQuiet : Attention.QuietHours -> List Effect
storeQuiet quiet =
    [ Store Attention.quietStartKey (Just (String.fromInt quiet.startHour))
    , Store Attention.quietEndKey (Just (String.fromInt quiet.endHour))
    , Store Attention.quietEnabledKey
        (Just
            (if quiet.enabled then
                "true"

             else
                "false"
            )
        )
    ]


folderName : String -> State -> String
folderName id state =
    List.filter (\f -> f.id == id) state.folders |> List.head |> Maybe.map .name |> Maybe.withDefault "the folder"


update : Ctx -> Msg -> State -> ( State, List Effect )
update ctx msg raw =
    let
        state =
            case msg of
                Loaded _ ->
                    raw

                _ ->
                    current ctx.owner raw
    in
    case msg of
        Loaded payload ->
            loadedFor ctx payload state

        RowMenuOpen name ->
            ( { state | sheet = Just (RowMenu name) }, [] )

        MoveOpen room ->
            ( { state | sheet = Just (MoveToFolder room), folderDraft = "", folderError = Nothing }, [] )

        BookmarksOpen ->
            ( { state | sheet = Just Bookmarks }, [] )

        SheetClose ->
            ( { state | sheet = Nothing, folderError = Nothing }, [] )

        FolderDraft draft ->
            ( { state | folderDraft = String.left 64 draft, folderError = Nothing }, [] )

        FolderCreate assign ->
            withOwner ctx state <|
                \owner ->
                    case Organize.createFolder { id = String.fromInt (round ctx.nowMs), name = state.folderDraft } state.folders of
                        Err why ->
                            ( { state | folderError = Just why }, [] )

                        Ok ( folders, folder ) ->
                            case assign of
                                Just room ->
                                    let
                                        placed =
                                            Organize.assignRoom room (Just folder.id) folders
                                    in
                                    ( { state | folders = placed, folderDraft = "", folderError = Nothing, sheet = Nothing }
                                    , storeFolders owner placed ++ [ Toast ("Moved to " ++ folder.name) (Just (room ++ " now lives in " ++ folder.name ++ ".")) ]
                                    )

                                Nothing ->
                                    ( { state | folders = folders, folderDraft = "", folderError = Nothing }
                                    , storeFolders owner folders
                                    )

        FolderAssign room target ->
            withOwner ctx state <|
                \owner ->
                    let
                        placed =
                            Organize.assignRoom room target state.folders

                        landed =
                            Maybe.map .id (Organize.folderOf room placed) == target
                    in
                    if not landed then
                        ( { state | folderError = Just "That folder is full." }, [] )

                    else
                        ( { state | folders = placed, sheet = Nothing, folderError = Nothing }
                        , storeFolders owner placed
                            ++ [ case target of
                                    Just id ->
                                        Toast ("Moved to " ++ folderName id state) Nothing

                                    Nothing ->
                                        Toast "Back in Rooms" (Just (room ++ " is no longer in a folder."))
                               ]
                        )

        FolderToggle id ->
            withOwner ctx state <|
                \owner ->
                    let
                        folders =
                            Organize.toggleCollapsed id state.folders
                    in
                    ( { state | folders = folders }, storeFolders owner folders )

        FolderMove id delta ->
            withOwner ctx state <|
                \owner ->
                    let
                        folders =
                            Organize.moveFolder id delta state.folders
                    in
                    ( { state | folders = folders }, storeFolders owner folders )

        FolderDelete id ->
            withOwner ctx state <|
                \owner ->
                    let
                        name =
                            folderName id state

                        folders =
                            Organize.deleteFolder id state.folders
                    in
                    ( { state | folders = folders, renaming = Nothing }
                    , storeFolders owner folders ++ [ Toast ("Deleted " ++ name) (Just "Its rooms are back in Rooms.") ]
                    )

        FolderRenameStart id ->
            ( { state | renaming = Just { id = id, draft = folderName id state }, folderError = Nothing }, [] )

        FolderRenameDraft draft ->
            ( { state | renaming = Maybe.map (\r -> { r | draft = String.left 64 draft }) state.renaming, folderError = Nothing }, [] )

        FolderRenameCancel ->
            ( { state | renaming = Nothing, folderError = Nothing }, [] )

        FolderRenameSave ->
            case state.renaming of
                Nothing ->
                    ( state, [] )

                Just r ->
                    withOwner ctx state <|
                        \owner ->
                            case Organize.renameFolder r.id r.draft state.folders of
                                Err why ->
                                    ( { state | folderError = Just why }, [] )

                                Ok folders ->
                                    ( { state | folders = folders, renaming = Nothing, folderError = Nothing }, storeFolders owner folders )

        Hide room ->
            case Organize.normalizeRoom room of
                Nothing ->
                    ( state, [] )

                Just key ->
                    withOwner ctx state <|
                        \owner ->
                            if Set.size state.hidden >= Organize.maxHidden && not (Set.member key state.hidden) then
                                ( state, [ Toast "Too many hidden rooms" (Just "Show a room again before hiding another.") ] )

                            else
                                let
                                    hidden =
                                        Set.insert key state.hidden
                                in
                                ( { state | hidden = hidden, sheet = Nothing }
                                , storeHidden owner hidden
                                    ++ [ Toast ("Hid " ++ room) (Just "You stay in the room. It comes back to your list when someone mentions you.") ]
                                )

        Unhide room ->
            withOwner ctx state <|
                \owner ->
                    let
                        hidden =
                            Set.remove (String.toLower (String.trim room)) state.hidden
                    in
                    ( { state | hidden = hidden, sheet = Nothing }
                    , storeHidden owner hidden ++ [ Toast ("Showing " ++ room) (Just "It is back on your list.") ]
                    )

        ShowHiddenToggle ->
            ( { state | showHidden = not state.showHidden }, [] )

        CloseConversation nick ->
            case Organize.normalizeNick nick of
                Nothing ->
                    ( state, [] )

                Just key ->
                    withOwner ctx state <|
                        \owner ->
                            if Dict.size state.closed >= Organize.maxClosed && not (Dict.member key state.closed) then
                                ( state, [ Toast "Too many closed conversations" Nothing ] )

                            else
                                let
                                    closed =
                                        Dict.insert key ctx.nowMs state.closed

                                    leave =
                                        case ctx.active of
                                            Just active ->
                                                if String.toLower active == key then
                                                    [ LeaveConversation nick ]

                                                else
                                                    []

                                            Nothing ->
                                                []
                                in
                                ( { state | closed = closed, sheet = Nothing }
                                , storeClosed owner closed
                                    ++ leave
                                    ++ [ Toast "Conversation closed" (Just ("Nothing is deleted. It comes back when " ++ nick ++ " writes again.")) ]
                                )

        Reopen nick ->
            withOwner ctx state <|
                \owner ->
                    let
                        closed =
                            Dict.remove (String.toLower (String.trim nick)) state.closed
                    in
                    ( { state | closed = closed }, storeClosed owner closed ++ [ OpenConversation nick ] )

        ShowClosedToggle ->
            ( { state | showClosed = not state.showClosed }, [] )

        BookmarkSave input ->
            withOwner ctx state <|
                \owner ->
                    if Organize.isBookmarked input.target input.id state.bookmarks then
                        let
                            bookmarks =
                                Organize.removeBookmark input.target input.id state.bookmarks
                        in
                        ( { state | bookmarks = bookmarks }, storeBookmarks owner bookmarks ++ [ Toast "Removed from saved" Nothing ] )

                    else
                        let
                            bookmarks =
                                Organize.addBookmark input state.bookmarks
                        in
                        ( { state | bookmarks = bookmarks }
                        , storeBookmarks owner bookmarks
                            ++ [ Toast "Message saved" (Just "Find it in Saved messages, from You or the room menu.") ]
                        )

        BookmarkRemove target id ->
            withOwner ctx state <|
                \owner ->
                    let
                        bookmarks =
                            Organize.removeBookmark target id state.bookmarks
                    in
                    ( { state | bookmarks = bookmarks }, storeBookmarks owner bookmarks )

        BookmarkJump target id ->
            ( { state | sheet = Nothing }, [ JumpToMessage target id ] )

        NoteEdit nick ->
            ( { state
                | noteEditing = Just { nick = nick, draft = Organize.noteFor nick state.notes |> Maybe.withDefault "" }
                , noteError = Nothing
              }
            , []
            )

        NoteDraft draft ->
            ( { state | noteEditing = Maybe.map (\e -> { e | draft = String.left (Organize.maxNoteLength + 64) draft }) state.noteEditing, noteError = Nothing }, [] )

        NoteCancel ->
            ( { state | noteEditing = Nothing, noteError = Nothing }, [] )

        NoteSave ->
            case state.noteEditing of
                Nothing ->
                    ( state, [] )

                Just editing ->
                    withOwner ctx state <|
                        \owner ->
                            case Organize.setNote editing.nick editing.draft state.notes of
                                Err why ->
                                    ( { state | noteError = Just why }, [] )

                                Ok notes ->
                                    ( { state | notes = notes, noteEditing = Nothing, noteError = Nothing }, storeNotes owner notes )

        QuietToggle ->
            let
                q =
                    state.quiet

                quiet =
                    if q.enabled then
                        { q | enabled = False }

                    else if q.startHour == q.endHour then
                        { enabled = True, startHour = 22, endHour = 8 }

                    else
                        { q | enabled = True }
            in
            ( { state | quiet = quiet }, storeQuiet quiet )

        QuietStart hour ->
            let
                q =
                    state.quiet

                quiet =
                    { q | startHour = clamp 0 23 hour }
            in
            ( { state | quiet = quiet }, storeQuiet quiet )

        QuietEnd hour ->
            let
                q =
                    state.quiet

                quiet =
                    { q | endHour = clamp 0 23 hour }
            in
            ( { state | quiet = quiet }, storeQuiet quiet )

        PresetSet preset ->
            ( { state | preset = preset }, [ Store Attention.calmKey (Just (Attention.presetToString preset)) ] )

        SmartKeywordsDraft draft ->
            ( { state | smartKeywordsDraft = String.left 4096 draft, smartStatus = Nothing }, [] )

        SmartNicksDraft draft ->
            ( { state | smartNicksDraft = String.left 4096 draft, smartStatus = Nothing }, [] )

        SmartSave ->
            withOwner ctx state <|
                \owner ->
                    let
                        old =
                            state.smartMute

                        rules =
                            { old
                                | keywords = Attention.parseKeywordInput state.smartKeywordsDraft
                                , nicks =
                                    Attention.parseKeywordInput state.smartNicksDraft
                                        |> List.filter (not << String.contains " ")
                                        |> List.take Attention.maxMutedNicks
                            }
                    in
                    ( { state
                        | smartMute = rules
                        , smartKeywordsDraft = String.join ", " rules.keywords
                        , smartNicksDraft = String.join ", " rules.nicks
                        , smartStatus = Just ("Saved. " ++ Attention.smartMuteSummary rules ++ ".")
                      }
                    , store (Organize.ownerKey Attention.smartMuteKey) owner (Attention.encodeSmartMute rules)
                    )

        DigestJump name ->
            ( state, [ JumpFirstUnread name ] )

        OutboxOpen target ->
            ( { state | outboxConfirm = Nothing }, [ OpenConversation target ] )

        OutboxRemoveAsk id ->
            ( { state | outboxConfirm = Just id }, [] )

        OutboxRemoveCancel ->
            ( { state | outboxConfirm = Nothing }, [] )
