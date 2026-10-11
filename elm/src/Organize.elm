module Organize exposing
    ( Bookmark
    , BookmarkInput
    , Folder
    , Grouped
    , Owner
    , addBookmark
    , assignRoom
    , bookmarkKey
    , bookmarksKey
    , closedKey
    , createFolder
    , decodeBookmarks
    , decodeFolders
    , decodeNameSet
    , decodeNavigationFolders
    , decodeNotes
    , deleteFolder
    , encodeBookmarks
    , encodeFolders
    , encodeNameSet
    , encodeNotes
    , folderOf
    , foldersKey
    , groupRooms
    , hiddenKey
    , isBookmarked
    , looksSealed
    , maxBookmarks
    , maxClosed
    , maxFolderNameLength
    , maxFolders
    , maxHidden
    , maxNoteLength
    , maxNotes
    , maxRoomsPerFolder
    , maxSnippetLength
    , moveFolder
    , navigationKey
    , normalizeNick
    , normalizeRoom
    , noteFor
    , notesKey
    , ownerKey
    , removeBookmark
    , renameFolder
    , setNote
    , snippetOf
    , toggleCollapsed
    , uniqueFolderId
    )

{-| v3/gap-organize — pure organize memory: room folders, hidden rooms,
closed conversations, saved messages (bookmarks) and private notes on
people. Storage mechanics stay ports-side; this module owns the shapes,
the bounds, the codecs and the owner-scoped keys.

Oracle: `lib/store/channelFoldersPersistence.ts` +
`lib/channelNavigationMemory.ts` (folders), `lib/hiddenRooms.ts`,
`lib/closedConversations.ts`, `lib/bookmarks.ts`, `lib/userNotes.ts`
and `lib/deviceMemoryOwner.ts` (the `base:owner:<enc>` key).

Fixed rather than copied:

  - deleting a folder returns its rooms to the plain Rooms list (the
    oracle moved them into a `default` folder the sidebar never drew,
    so they vanished);
  - a folder name that is too long is cut, not a reason to drop the
    whole folder; create / rename say why they refuse (empty, duplicate,
    cap) instead of reporting success;
  - folders keep their rooms when you part (rejoining restores them);
  - saved messages keep a bounded snippet, never the whole body, and
    never an encrypted message's plaintext (the oracle stored either the
    full text or useless ciphertext);
  - notes and saved messages are bounded and fail closed on hostile
    input (oversize raw values are never parsed).

Names fold with `String.toLower`, the key the rest of the client uses
for `model.channels`, so lookups always agree with the live model.

-}

import Dict exposing (Dict)
import DmCipher
import GroupEnvelope
import Json.Decode as Decode
import Json.Encode as Encode
import PersonSafety
import Set exposing (Set)



-- OWNER-SCOPED KEYS


{-| The device-memory owner (`App.DeviceMemoryOwner`). -}
type alias Owner =
    { serverUrl : String
    , identity : String
    }


{-| `base:owner:<encodeURIComponent(JSON [serverUrl, identity])>`,
mirroring `deviceMemoryStorageKey`. `Nothing` when the owner is not
usable, so nothing is ever written ownerless.
-}
ownerKey : String -> Owner -> Maybe String
ownerKey base owner =
    let
        url =
            String.trim owner.serverUrl

        identity =
            String.toLower (String.trim owner.identity)
    in
    if String.isEmpty url || String.length url > 2048 then
        Nothing

    else if String.isEmpty identity || String.length identity > 256 then
        Nothing

    else
        Just (base ++ ":owner:" ++ PersonSafety.percentEncode ("[" ++ PersonSafety.jsonString url ++ "," ++ PersonSafety.jsonString identity ++ "]"))


foldersKey : Owner -> Maybe String
foldersKey =
    ownerKey "onyx:room-folders"


{-| The oracle's combined navigation record (read once, to bring its
`channelFolders` across; never written here). -}
navigationKey : Owner -> Maybe String
navigationKey =
    ownerKey "onyx:channel-navigation"


hiddenKey : Owner -> Maybe String
hiddenKey =
    ownerKey "onyx:hidden-rooms"


closedKey : Owner -> Maybe String
closedKey =
    ownerKey "onyx:closed-conversations"


bookmarksKey : Owner -> Maybe String
bookmarksKey =
    ownerKey "onyx:bookmarks"


notesKey : Owner -> Maybe String
notesKey =
    ownerKey "onyx:user-notes"



-- NAMES


isControl : Char -> Bool
isControl c =
    let
        code =
            Char.toCode c
    in
    code < 0x20 || code == 0x7F


isBreak : Char -> Bool
isBreak c =
    isControl c || c == ' ' || c == ',' || c == '\u{00A0}'


{-| A storable room name: trimmed, lowered, a channel sigil, at most
128 characters, no whitespace, commas or control characters. -}
normalizeRoom : String -> Maybe String
normalizeRoom raw =
    let
        name =
            String.toLower (String.trim raw)
    in
    if String.isEmpty name || String.length name > 128 then
        Nothing

    else if not (List.any (\sigil -> String.startsWith sigil name) [ "#", "&", "+", "!" ]) then
        Nothing

    else if String.any isBreak name then
        Nothing

    else
        Just name


{-| A storable nick: trimmed, lowered, at most 128 characters, no
whitespace, commas or control characters, and never a channel name. -}
normalizeNick : String -> Maybe String
normalizeNick raw =
    let
        nick =
            String.toLower (String.trim raw)
    in
    if String.isEmpty nick || String.length nick > 128 then
        Nothing

    else if String.any isBreak nick then
        Nothing

    else if List.any (\sigil -> String.startsWith sigil nick) [ "#", "&" ] then
        Nothing

    else
        Just nick


{-| Raw storage bound: anything larger is refused before parsing. -}
withinBytes : Int -> String -> Bool
withinBytes limit raw =
    String.length raw <= limit



-- FOLDERS


type alias Folder =
    { id : String
    , name : String
    , rooms : List String
    , collapsed : Bool
    }


maxFolders : Int
maxFolders =
    32


maxFolderNameLength : Int
maxFolderNameLength =
    48


maxRoomsPerFolder : Int
maxRoomsPerFolder =
    256


{-| Trim, drop control characters, collapse inner runs of spaces, and
cut at `maxFolderNameLength`. -}
cleanFolderName : String -> String
cleanFolderName raw =
    raw
        |> String.filter (not << isControl)
        |> String.words
        |> String.join " "
        |> String.left maxFolderNameLength
        |> String.trim


sameName : String -> String -> Bool
sameName a b =
    String.toLower a == String.toLower b


{-| A fresh id from a seed (the clock), made unique against the list. -}
uniqueFolderId : String -> List Folder -> String
uniqueFolderId seed folders =
    let
        taken id =
            List.any (\f -> f.id == id) folders

        go n =
            let
                candidate =
                    if n == 0 then
                        "folder-" ++ seed

                    else
                        "folder-" ++ seed ++ "-" ++ String.fromInt n
            in
            if n > maxFolders + 1 || not (taken candidate) then
                candidate

            else
                go (n + 1)
    in
    go 0


{-| Create a folder (appended last). `Err` carries the copy to show. -}
createFolder : { id : String, name : String } -> List Folder -> Result String ( List Folder, Folder )
createFolder input folders =
    let
        name =
            cleanFolderName input.name
    in
    if String.isEmpty name then
        Err "Enter a folder name."

    else if List.length folders >= maxFolders then
        Err ("You can keep up to " ++ String.fromInt maxFolders ++ " folders.")

    else if List.any (\f -> sameName f.name name) folders then
        Err ("You already have a folder called " ++ name ++ ".")

    else
        let
            folder =
                { id = uniqueFolderId input.id folders, name = name, rooms = [], collapsed = False }
        in
        Ok ( folders ++ [ folder ], folder )


renameFolder : String -> String -> List Folder -> Result String (List Folder)
renameFolder id rawName folders =
    let
        name =
            cleanFolderName rawName
    in
    if not (List.any (\f -> f.id == id) folders) then
        Err "That folder is gone."

    else if String.isEmpty name then
        Err "Enter a folder name."

    else if List.any (\f -> f.id /= id && sameName f.name name) folders then
        Err ("You already have a folder called " ++ name ++ ".")

    else
        Ok
            (List.map
                (\f ->
                    if f.id == id then
                        { f | name = name }

                    else
                        f
                )
                folders
            )


{-| Delete a folder; its rooms go back to the plain Rooms list. -}
deleteFolder : String -> List Folder -> List Folder
deleteFolder id =
    List.filter (\f -> f.id /= id)


{-| Move a folder `delta` places (clamped at the ends). -}
moveFolder : String -> Int -> List Folder -> List Folder
moveFolder id delta folders =
    let
        from =
            List.indexedMap Tuple.pair folders
                |> List.filter (\( _, f ) -> f.id == id)
                |> List.head
                |> Maybe.map Tuple.first
    in
    case from of
        Nothing ->
            folders

        Just i ->
            let
                to =
                    clamp 0 (List.length folders - 1) (i + delta)
            in
            if to == i then
                folders

            else
                let
                    moving =
                        List.drop i folders |> List.take 1

                    rest =
                        List.take i folders ++ List.drop (i + 1) folders
                in
                List.take to rest ++ moving ++ List.drop to rest


toggleCollapsed : String -> List Folder -> List Folder
toggleCollapsed id =
    List.map
        (\f ->
            if f.id == id then
                { f | collapsed = not f.collapsed }

            else
                f
        )


{-| Put a room in a folder (`Nothing` takes it out of every folder).
A room lives in one folder at most; an unknown folder id only removes
it, and a full folder refuses (the room stays where it was). -}
assignRoom : String -> Maybe String -> List Folder -> List Folder
assignRoom room target folders =
    case normalizeRoom room of
        Nothing ->
            folders

        Just key ->
            let
                targetFull =
                    case target of
                        Just id ->
                            List.any (\f -> f.id == id && List.length (List.filter ((/=) key) f.rooms) >= maxRoomsPerFolder) folders

                        Nothing ->
                            False
            in
            if targetFull then
                folders

            else
                List.map
                    (\f ->
                        let
                            without =
                                List.filter ((/=) key) f.rooms
                        in
                        if Just f.id == target then
                            { f | rooms = without ++ [ key ] }

                        else
                            { f | rooms = without }
                    )
                    folders


folderOf : String -> List Folder -> Maybe Folder
folderOf room folders =
    let
        key =
            String.toLower (String.trim room)
    in
    List.filter (\f -> List.member key f.rooms) folders |> List.head


type alias Grouped a =
    { folders : List ( Folder, List a )
    , unfiled : List a
    }


{-| Split already-sorted rooms into folders (folder order; the input's
order inside each) and the unfiled rest. Folders with no listed room
are kept with an empty list — the view decides whether to draw them. -}
groupRooms : (a -> String) -> List Folder -> List a -> Grouped a
groupRooms nameOf folders rooms =
    let
        inFolder f room =
            List.member (String.toLower (nameOf room)) f.rooms

        filed room =
            List.any (\f -> inFolder f room) folders
    in
    { folders = List.map (\f -> ( f, List.filter (inFolder f) rooms )) folders
    , unfiled = List.filter (not << filed) rooms
    }


type alias RawFolder =
    { id : String
    , name : String
    , rooms : List String
    , collapsed : Bool
    }


folderDecoder : Decode.Decoder RawFolder
folderDecoder =
    Decode.map4 RawFolder
        (Decode.field "id" Decode.string)
        (Decode.field "name" Decode.string)
        (Decode.oneOf
            [ Decode.field "rooms" (Decode.list lenientString)
            , Decode.field "channels" (Decode.list lenientString)
            , Decode.succeed []
            ]
        )
        (Decode.oneOf [ Decode.field "collapsed" Decode.bool, Decode.succeed False ])


lenientString : Decode.Decoder String
lenientString =
    Decode.oneOf [ Decode.string, Decode.succeed "" ]


{-| Sanitize decoded folders: at most 32, ids 1–128 characters and
unique, names cleaned (cut, never dropped for length; blank drops),
rooms normalized, at most 256 per folder, and a room claimed by the
first folder that lists it. The oracle's `default` bucket is not a
folder here (its rooms are simply unfiled).
-}
sanitizeFolders : List RawFolder -> List Folder
sanitizeFolders raw =
    let
        step folder ( seenIds, claimed, acc ) =
            let
                name =
                    cleanFolderName folder.name

                cleanId =
                    String.trim folder.id
            in
            if List.length acc >= maxFolders then
                ( seenIds, claimed, acc )

            else if cleanId == "default" || String.isEmpty cleanId || String.length cleanId > 128 || String.any isControl cleanId then
                ( seenIds, claimed, acc )

            else if Set.member cleanId seenIds || String.isEmpty name then
                ( seenIds, claimed, acc )

            else
                let
                    ( claimedAfter, rooms ) =
                        List.foldl
                            (\room ( taken, kept ) ->
                                case normalizeRoom room of
                                    Just key ->
                                        if Set.member key taken || List.length kept >= maxRoomsPerFolder then
                                            ( taken, kept )

                                        else
                                            ( Set.insert key taken, kept ++ [ key ] )

                                    Nothing ->
                                        ( taken, kept )
                            )
                            ( claimed, [] )
                            folder.rooms
                in
                ( Set.insert cleanId seenIds
                , claimedAfter
                , acc ++ [ { id = cleanId, name = name, rooms = rooms, collapsed = folder.collapsed } ]
                )

        ( _, _, folders ) =
            List.foldl step ( Set.empty, Set.empty, [] ) raw
    in
    folders


maxFolderBytes : Int
maxFolderBytes =
    512 * 1024


foldersListDecoder : Decode.Decoder (List Folder)
foldersListDecoder =
    Decode.list (Decode.oneOf [ Decode.map Just folderDecoder, Decode.succeed Nothing ])
        |> Decode.map (List.filterMap identity >> sanitizeFolders)


{-| Parse the stored folder list; anything malformed is no folders. -}
decodeFolders : String -> List Folder
decodeFolders raw =
    if not (withinBytes maxFolderBytes raw) then
        []

    else
        Decode.decodeString foldersListDecoder raw |> Result.withDefault []


{-| The oracle navigation record's `channelFolders` (one-time import
when this client has no folders of its own yet). -}
decodeNavigationFolders : String -> List Folder
decodeNavigationFolders raw =
    if not (withinBytes maxFolderBytes raw) then
        []

    else
        Decode.decodeString (Decode.field "channelFolders" foldersListDecoder) raw |> Result.withDefault []


encodeFolders : List Folder -> Maybe String
encodeFolders folders =
    if List.isEmpty folders then
        Nothing

    else
        Just
            (Encode.encode 0
                (Encode.list
                    (\f ->
                        Encode.object
                            [ ( "id", Encode.string f.id )
                            , ( "name", Encode.string f.name )
                            , ( "rooms", Encode.list Encode.string f.rooms )
                            , ( "collapsed", Encode.bool f.collapsed )
                            ]
                    )
                    folders
                )
            )



-- HIDDEN ROOMS + CLOSED CONVERSATIONS (lowered name sets)


maxHidden : Int
maxHidden =
    512


maxClosed : Int
maxClosed =
    512


{-| Parse a stored JSON array of names through `normalize`, capped. -}
decodeNameSet : (String -> Maybe String) -> Int -> String -> Set String
decodeNameSet normalize cap raw =
    if not (withinBytes (128 * 1024) raw) then
        Set.empty

    else
        case Decode.decodeString (Decode.list lenientString) raw of
            Ok names ->
                List.foldl
                    (\name acc ->
                        if Set.size acc >= cap then
                            acc

                        else
                            case normalize name of
                                Just key ->
                                    Set.insert key acc

                                Nothing ->
                                    acc
                    )
                    Set.empty
                    names

            Err _ ->
                Set.empty


{-| An empty set removes the key. -}
encodeNameSet : Set String -> Maybe String
encodeNameSet names =
    if Set.isEmpty names then
        Nothing

    else
        Just (Encode.encode 0 (Encode.list Encode.string (Set.toList names)))



-- SAVED MESSAGES


type alias Bookmark =
    { id : String
    , target : String
    , from : String
    , snippet : String
    , locked : Bool
    , at : Int
    , savedAt : Int
    }


{-| What the message menu knows about a row. `text = Nothing` means the
row is encrypted: only its place is saved, never its words. -}
type alias BookmarkInput =
    { id : String
    , target : String
    , from : String
    , text : Maybe String
    , at : Int
    , savedAt : Int
    }


maxBookmarks : Int
maxBookmarks =
    100


maxSnippetLength : Int
maxSnippetLength =
    280


{-| One line, control characters dropped, cut at 280 characters. -}
snippetOf : String -> String
snippetOf text =
    let
        flat =
            text
                |> String.map
                    (\c ->
                        if isControl c then
                            ' '

                        else
                            c
                    )
                |> String.words
                |> String.join " "
    in
    if String.length flat > maxSnippetLength then
        String.left (maxSnippetLength - 1) flat ++ "…"

    else
        flat


bookmarkKey : { a | target : String, id : String } -> String
bookmarkKey b =
    String.toLower b.target ++ "\u{0000}" ++ b.id


isBookmarked : String -> String -> List Bookmark -> Bool
isBookmarked target id =
    List.any (\b -> b.id == id && String.toLower b.target == String.toLower target)


{-| Save a message (newest first). Re-saving refreshes its place at the
top; the oldest falls off past `maxBookmarks`. Invalid input is a
no-op. -}
addBookmark : BookmarkInput -> List Bookmark -> List Bookmark
addBookmark input bookmarks =
    let
        id =
            String.trim input.id

        target =
            String.trim input.target
    in
    if String.isEmpty id || String.length id > 256 || String.any isControl id then
        bookmarks

    else if String.isEmpty target || String.length target > 128 || String.any isBreak target then
        bookmarks

    else
        let
            sealed =
                case input.text of
                    Just body ->
                        looksSealed body

                    Nothing ->
                        True

            entry =
                { id = id
                , target = target
                , from = String.left 128 (String.filter (not << isControl) (String.trim input.from))
                , snippet =
                    if sealed then
                        ""

                    else
                        Maybe.map snippetOf input.text |> Maybe.withDefault ""
                , locked = sealed
                , at = input.at
                , savedAt = input.savedAt
                }
        in
        entry
            :: List.filter (\b -> bookmarkKey b /= bookmarkKey entry) bookmarks
            |> List.take maxBookmarks


removeBookmark : String -> String -> List Bookmark -> List Bookmark
removeBookmark target id =
    List.filter (\b -> not (b.id == id && String.toLower b.target == String.toLower target))


bookmarkDecoder : Decode.Decoder BookmarkInput
bookmarkDecoder =
    let
        time =
            Decode.oneOf
                [ Decode.field "at" Decode.int
                , Decode.field "time" Decode.int
                , Decode.field "time" Decode.float |> Decode.map round
                , Decode.succeed 0
                ]

        -- Oracle snapshots carry the whole `text` (and ciphertext for
        -- encrypted rows): keep a snippet of plain text only.
        words =
            Decode.oneOf
                [ Decode.map2
                    (\locked snippet ->
                        if locked then
                            Nothing

                        else
                            Just snippet
                    )
                    (Decode.field "locked" Decode.bool)
                    (Decode.oneOf [ Decode.field "snippet" Decode.string, Decode.succeed "" ])
                , Decode.map2
                    (\encrypted body ->
                        if encrypted then
                            Nothing

                        else
                            Just body
                    )
                    (Decode.oneOf [ Decode.field "encrypted" Decode.bool, Decode.field "e2ee" Decode.bool, Decode.succeed False ])
                    (Decode.oneOf [ Decode.field "text" Decode.string, Decode.field "snippet" Decode.string ])
                ]
    in
    Decode.map6 BookmarkInput
        (Decode.field "id" Decode.string)
        (Decode.field "target" Decode.string)
        (Decode.oneOf [ Decode.field "from" Decode.string, Decode.succeed "" ])
        words
        time
        (Decode.oneOf [ Decode.field "savedAt" Decode.int, time ])


{-| Envelope-shaped text (DM or room seal prefixes) is never kept as a
snippet, even when a row forgot to say it was encrypted. -}
looksSealed : String -> Bool
looksSealed body =
    let
        t =
            String.trimLeft body
    in
    DmCipher.isEnvelope t || GroupEnvelope.isGroupEnvelope t


decodeBookmarks : String -> List Bookmark
decodeBookmarks raw =
    if not (withinBytes (2 * 1024 * 1024) raw) then
        []

    else
        case Decode.decodeString (Decode.list (Decode.oneOf [ Decode.map Just bookmarkDecoder, Decode.succeed Nothing ])) raw of
            Ok entries ->
                -- Stored newest first; folding from the oldest keeps that
                -- order through `addBookmark`'s dedupe and cap.
                List.foldr addBookmark [] (List.filterMap identity entries)

            Err _ ->
                []


encodeBookmarks : List Bookmark -> Maybe String
encodeBookmarks bookmarks =
    if List.isEmpty bookmarks then
        Nothing

    else
        Just
            (Encode.encode 0
                (Encode.list
                    (\b ->
                        Encode.object
                            [ ( "id", Encode.string b.id )
                            , ( "target", Encode.string b.target )
                            , ( "from", Encode.string b.from )
                            , ( "snippet", Encode.string b.snippet )
                            , ( "locked", Encode.bool b.locked )
                            , ( "at", Encode.int b.at )
                            , ( "savedAt", Encode.int b.savedAt )
                            ]
                    )
                    bookmarks
                )
            )



-- PRIVATE NOTES


maxNotes : Int
maxNotes =
    512


maxNoteLength : Int
maxNoteLength =
    2048


noteFor : String -> Dict String String -> Maybe String
noteFor nick notes =
    Dict.get (String.toLower (String.trim nick)) notes


{-| Set (or, when blank, clear) the note on a person. `Err` carries the
copy to show; the notes are unchanged then. -}
setNote : String -> String -> Dict String String -> Result String (Dict String String)
setNote rawNick rawNote notes =
    case normalizeNick rawNick of
        Nothing ->
            Err "Notes need a valid name."

        Just nick ->
            let
                note =
                    String.trim (String.filter (\c -> c == '\n' || not (isControl c)) rawNote)
            in
            if String.isEmpty note then
                Ok (Dict.remove nick notes)

            else if String.length note > maxNoteLength then
                Err ("Notes can be up to " ++ String.fromInt maxNoteLength ++ " characters.")

            else if not (Dict.member nick notes) && Dict.size notes >= maxNotes then
                Err ("You can keep notes on up to " ++ String.fromInt maxNotes ++ " people.")

            else
                Ok (Dict.insert nick note notes)


decodeNotes : String -> Dict String String
decodeNotes raw =
    if not (withinBytes (2 * 1024 * 1024) raw) then
        Dict.empty

    else
        case Decode.decodeString (Decode.keyValuePairs lenientString) raw of
            Ok pairs ->
                List.foldl
                    (\( nick, note ) acc ->
                        case setNote nick note acc of
                            Ok next ->
                                next

                            Err _ ->
                                acc
                    )
                    Dict.empty
                    pairs

            Err _ ->
                Dict.empty


encodeNotes : Dict String String -> Maybe String
encodeNotes notes =
    if Dict.isEmpty notes then
        Nothing

    else
        Just (Encode.encode 0 (Encode.dict identity Encode.string notes))
