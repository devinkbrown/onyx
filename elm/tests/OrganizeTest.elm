module OrganizeTest exposing (suite)

{-| v3/gap-organize — vectors for the pure organize memory: owner-scoped
keys, room / nick normalization, folders (create, rename, delete,
reorder, assign, group), hidden / closed name sets, saved messages and
private notes, each with its stored shape, bounds and hostile input.

Oracle: `lib/store/channelFoldersPersistence.ts`,
`lib/channelNavigationMemory.ts`, `lib/hiddenRooms.ts`,
`lib/closedConversations.ts`, `lib/bookmarks.ts`, `lib/userNotes.ts`.
-}

import Dict
import Expect
import Fuzz
import Organize exposing (Folder)
import Set
import Test exposing (Test, describe, fuzz, test)


owner : Organize.Owner
owner =
    { serverUrl = "wss://irc.eshmaki.me/ws", identity = "Kn" }


folder : String -> String -> List String -> Folder
folder id name rooms =
    { id = id, name = name, rooms = rooms, collapsed = False }


rooms3 : List Folder
rooms3 =
    [ folder "a" "Work" [ "#design", "#elm" ]
    , folder "b" "Friends" [ "#lounge" ]
    ]


input : String -> String -> Maybe String -> Organize.BookmarkInput
input target id text =
    { id = id, target = target, from = "mara", text = text, at = 1000, savedAt = 2000 }


expectOk : (a -> Expect.Expectation) -> Result String a -> Expect.Expectation
expectOk check result =
    case result of
        Ok value ->
            check value

        Err why ->
            Expect.fail ("expected Ok, got Err " ++ why)


suite : Test
suite =
    describe "Organize"
        [ keys
        , names
        , folders
        , folderCodec
        , nameSets
        , bookmarks
        , notes
        ]


keys : Test
keys =
    describe "owner-scoped keys"
        [ test "mirror base:owner:<encodeURIComponent(JSON [url, identity])>, identity lowered" <|
            \_ ->
                Organize.foldersKey owner
                    |> Expect.equal (Just "onyx:room-folders:owner:%5B%22wss%3A%2F%2Firc.eshmaki.me%2Fws%22%2C%22kn%22%5D")
        , test "every store has its own base" <|
            \_ ->
                [ Organize.foldersKey, Organize.hiddenKey, Organize.closedKey, Organize.bookmarksKey, Organize.notesKey, Organize.navigationKey ]
                    |> List.filterMap (\k -> k owner)
                    |> List.map (String.split ":owner:" >> List.head >> Maybe.withDefault "")
                    |> Expect.equal
                        [ "onyx:room-folders"
                        , "onyx:hidden-rooms"
                        , "onyx:closed-conversations"
                        , "onyx:bookmarks"
                        , "onyx:user-notes"
                        , "onyx:channel-navigation"
                        ]
        , test "two accounts never share a key" <|
            \_ ->
                Organize.hiddenKey { owner | identity = "someone-else" }
                    |> Expect.notEqual (Organize.hiddenKey owner)
        , test "two servers never share a key" <|
            \_ ->
                Organize.hiddenKey { owner | serverUrl = "wss://other.example/ws" }
                    |> Expect.notEqual (Organize.hiddenKey owner)
        , test "an unusable owner has no key (nothing is written ownerless)" <|
            \_ ->
                [ Organize.foldersKey { owner | identity = "  " }
                , Organize.foldersKey { owner | serverUrl = "" }
                , Organize.foldersKey { owner | identity = String.repeat 257 "x" }
                , Organize.foldersKey { owner | serverUrl = String.repeat 2049 "x" }
                ]
                    |> Expect.equal [ Nothing, Nothing, Nothing, Nothing ]
        ]


names : Test
names =
    describe "normalizeRoom / normalizeNick"
        [ test "rooms are trimmed, lowered, sigil-checked" <|
            \_ ->
                List.map Organize.normalizeRoom [ "  #Design ", "&local", "+mod", "!safe", "design", "", "#a b", "#a,b", "#a\u{0000}b" ]
                    |> Expect.equal [ Just "#design", Just "&local", Just "+mod", Just "!safe", Nothing, Nothing, Nothing, Nothing, Nothing ]
        , test "a room name over 128 characters is refused" <|
            \_ ->
                Expect.equal ( Nothing, Just ("#" ++ String.repeat 127 "a") )
                    ( Organize.normalizeRoom ("#" ++ String.repeat 128 "a")
                    , Organize.normalizeRoom ("#" ++ String.repeat 127 "a")
                    )
        , test "nicks are trimmed, lowered, never a channel" <|
            \_ ->
                List.map Organize.normalizeNick [ " Mara ", "#room", "&room", "a b", "", "a,b" ]
                    |> Expect.equal [ Just "mara", Nothing, Nothing, Nothing, Nothing, Nothing ]
        ]


folders : Test
folders =
    describe "folders"
        [ describe "createFolder"
            [ test "appends a folder with a unique id and no rooms" <|
                \_ ->
                    Organize.createFolder { id = "9", name = "  Side   projects " } rooms3
                        |> expectOk
                            (\( list, made ) ->
                                Expect.equal
                                    { names = List.map .name list, id = made.id, rooms = made.rooms, collapsed = made.collapsed }
                                    { names = [ "Work", "Friends", "Side projects" ], id = "folder-9", rooms = [], collapsed = False }
                            )
            , test "an id clash is made unique" <|
                \_ ->
                    Organize.createFolder { id = "9", name = "One" } [ folder "folder-9" "Two" [] ]
                        |> expectOk (\( _, made ) -> Expect.equal "folder-9-1" made.id)
            , test "blank, duplicate (any case) and over-cap refuse with the reason" <|
                \_ ->
                    let
                        full =
                            List.range 1 Organize.maxFolders |> List.map (\i -> folder (String.fromInt i) ("F" ++ String.fromInt i) [])
                    in
                    [ Organize.createFolder { id = "x", name = "   " } rooms3
                    , Organize.createFolder { id = "x", name = "work" } rooms3
                    , Organize.createFolder { id = "x", name = "New" } full
                    ]
                        |> List.map (Result.map (always ()))
                        |> Expect.equal
                            [ Err "Enter a folder name."
                            , Err "You already have a folder called work."
                            , Err "You can keep up to 32 folders."
                            ]
            , test "a long name is cut, not refused; control characters drop" <|
                \_ ->
                    Organize.createFolder { id = "x", name = String.repeat 80 "n" ++ "\u{0007}" } []
                        |> expectOk (\( _, made ) -> Expect.equal (String.repeat Organize.maxFolderNameLength "n") made.name)
            ]
        , describe "renameFolder"
            [ test "renames, keeping rooms" <|
                \_ ->
                    Organize.renameFolder "a" " Projects " rooms3
                        |> expectOk (\list -> Expect.equal [ ( "Projects", [ "#design", "#elm" ] ), ( "Friends", [ "#lounge" ] ) ] (List.map (\f -> ( f.name, f.rooms )) list))
            , test "keeping its own name (other case) is fine" <|
                \_ ->
                    Organize.renameFolder "a" "WORK" rooms3
                        |> expectOk (\list -> Expect.equal [ "WORK", "Friends" ] (List.map .name list))
            , test "refuses a taken name, a blank, and a folder that is gone" <|
                \_ ->
                    [ Organize.renameFolder "a" "friends" rooms3
                    , Organize.renameFolder "a" "" rooms3
                    , Organize.renameFolder "zzz" "Anything" rooms3
                    ]
                        |> List.map (Result.map (always ()))
                        |> Expect.equal
                            [ Err "You already have a folder called friends."
                            , Err "Enter a folder name."
                            , Err "That folder is gone."
                            ]
            ]
        , describe "deleteFolder"
            [ test "removes the folder; its rooms are unfiled again, not lost" <|
                \_ ->
                    let
                        after =
                            Organize.deleteFolder "a" rooms3
                    in
                    Expect.equal
                        ( List.map .id after
                        , (Organize.groupRooms identity after [ "#design", "#elm", "#lounge" ]).unfiled
                        )
                        ( [ "b" ], [ "#design", "#elm" ] )
            ]
        , describe "moveFolder"
            [ test "moves down, up, and clamps at the ends" <|
                \_ ->
                    let
                        three =
                            [ folder "a" "A" [], folder "b" "B" [], folder "c" "C" [] ]

                        ids =
                            List.map .id
                    in
                    Expect.equal
                        [ [ "b", "a", "c" ], [ "a", "c", "b" ], [ "a", "b", "c" ], [ "a", "b", "c" ], [ "b", "c", "a" ] ]
                        [ ids (Organize.moveFolder "a" 1 three)
                        , ids (Organize.moveFolder "c" -1 three)
                        , ids (Organize.moveFolder "a" -1 three)
                        , ids (Organize.moveFolder "c" 1 three)
                        , ids (Organize.moveFolder "a" 5 three)
                        ]
            , test "an unknown folder changes nothing" <|
                \_ ->
                    Organize.moveFolder "nope" 1 rooms3 |> Expect.equal rooms3
            ]
        , describe "toggleCollapsed"
            [ test "flips only that folder" <|
                \_ ->
                    Organize.toggleCollapsed "b" rooms3
                        |> List.map .collapsed
                        |> Expect.equal [ False, True ]
            ]
        , describe "assignRoom"
            [ test "a room lives in one folder at most (moving takes it out of the old one)" <|
                \_ ->
                    Organize.assignRoom "#Design" (Just "b") rooms3
                        |> List.map .rooms
                        |> Expect.equal [ [ "#elm" ], [ "#lounge", "#design" ] ]
            , test "Nothing takes it out of every folder" <|
                \_ ->
                    Organize.assignRoom "#lounge" Nothing rooms3
                        |> List.map .rooms
                        |> Expect.equal [ [ "#design", "#elm" ], [] ]
            , test "an unknown folder id only unfiles" <|
                \_ ->
                    Organize.assignRoom "#elm" (Just "gone") rooms3
                        |> List.map .rooms
                        |> Expect.equal [ [ "#design" ], [ "#lounge" ] ]
            , test "a full folder refuses, leaving the room where it was" <|
                \_ ->
                    let
                        crowded =
                            [ folder "a" "A" (List.range 1 Organize.maxRoomsPerFolder |> List.map (\i -> "#r" ++ String.fromInt i))
                            , folder "b" "B" [ "#mine" ]
                            ]
                    in
                    Organize.assignRoom "#mine" (Just "a") crowded |> Expect.equal crowded
            , test "an invalid room name is a no-op" <|
                \_ ->
                    Organize.assignRoom "no sigil" (Just "a") rooms3 |> Expect.equal rooms3
            ]
        , describe "folderOf / groupRooms"
            [ test "folderOf finds the folder holding a room (any case)" <|
                \_ ->
                    ( Organize.folderOf "#ELM" rooms3 |> Maybe.map .id, Organize.folderOf "#none" rooms3 )
                        |> Expect.equal ( Just "a", Nothing )
            , test "groupRooms keeps folder order, the input's order inside, and the unfiled rest" <|
                \_ ->
                    let
                        grouped =
                            Organize.groupRooms identity rooms3 [ "#lounge", "#alpha", "#elm", "#design", "#omega" ]
                    in
                    Expect.equal
                        ( List.map (\( f, xs ) -> ( f.id, xs )) grouped.folders, grouped.unfiled )
                        ( [ ( "a", [ "#elm", "#design" ] ), ( "b", [ "#lounge" ] ) ], [ "#alpha", "#omega" ] )
            , test "a folder with no listed room is kept, empty" <|
                \_ ->
                    Organize.groupRooms identity rooms3 [ "#alpha" ]
                        |> .folders
                        |> List.map (Tuple.second >> List.length)
                        |> Expect.equal [ 0, 0 ]
            ]
        ]


folderCodec : Test
folderCodec =
    describe "folder storage"
        [ test "round-trips through encode / decode" <|
            \_ ->
                let
                    withCollapsed =
                        Organize.toggleCollapsed "b" rooms3
                in
                Organize.encodeFolders withCollapsed
                    |> Maybe.map Organize.decodeFolders
                    |> Expect.equal (Just withCollapsed)
        , test "no folders removes the key" <|
            \_ ->
                Organize.encodeFolders [] |> Expect.equal Nothing
        , test "the stored shape is a JSON array of {id,name,rooms,collapsed}" <|
            \_ ->
                Organize.encodeFolders [ folder "a" "Work" [ "#x" ] ]
                    |> Expect.equal (Just """[{"id":"a","name":"Work","rooms":["#x"],"collapsed":false}]""")
        , test "malformed JSON, non-arrays and oversize values are no folders" <|
            \_ ->
                [ Organize.decodeFolders "{not json"
                , Organize.decodeFolders "{}"
                , Organize.decodeFolders "null"
                , Organize.decodeFolders (String.repeat (600 * 1024) " ")
                ]
                    |> Expect.equal [ [], [], [], [] ]
        , test "hostile entries drop, good ones survive" <|
            \_ ->
                Organize.decodeFolders
                    """[ 7, {"id":"a"}, {"id":"ok","name":"  Good  ","rooms":["#a","nope","#A","#b c",3]},
                         {"id":"ok","name":"Dup id","rooms":[]}, {"id":"x","name":"   "}, {"id":"default","name":"Default"} ]"""
                    |> List.map (\f -> ( f.id, f.name, f.rooms ))
                    |> Expect.equal [ ( "ok", "Good", [ "#a" ] ) ]
        , test "a room claimed by an earlier folder stays there" <|
            \_ ->
                Organize.decodeFolders
                    """[{"id":"a","name":"A","rooms":["#x"]},{"id":"b","name":"B","rooms":["#x","#y"]}]"""
                    |> List.map .rooms
                    |> Expect.equal [ [ "#x" ], [ "#y" ] ]
        , test "caps: 32 folders, names cut at 48" <|
            \_ ->
                let
                    many =
                        List.range 1 40
                            |> List.map (\i -> "{\"id\":\"f" ++ String.fromInt i ++ "\",\"name\":\"F" ++ String.fromInt i ++ "\",\"rooms\":[]}")
                            |> String.join ","

                    longName =
                        "[{\"id\":\"a\",\"name\":\"" ++ String.repeat 80 "n" ++ "\",\"rooms\":[]}]"
                in
                Expect.equal
                    ( List.length (Organize.decodeFolders ("[" ++ many ++ "]"))
                    , Organize.decodeFolders longName |> List.map (.name >> String.length)
                    )
                    ( 32, [ 48 ] )
        , test "the oracle's `channels` key reads as rooms, and its record imports from channelFolders" <|
            \_ ->
                Organize.decodeNavigationFolders
                    """{"channelFolders":[{"id":"w","name":"Work","channels":["#Design"],"collapsed":true}],"other":1}"""
                    |> List.map (\f -> ( f.name, f.rooms, f.collapsed ))
                    |> Expect.equal [ ( "Work", [ "#design" ], True ) ]
        ]


nameSets : Test
nameSets =
    describe "hidden rooms / closed conversations"
        [ test "decode normalizes, dedupes and drops what is not a name" <|
            \_ ->
                Organize.decodeNameSet Organize.normalizeRoom Organize.maxHidden """["#A","#a","junk",7,"#b c","#B"]"""
                    |> Set.toList
                    |> Expect.equal [ "#a", "#b" ]
        , test "DM names normalize as nicks (no channels)" <|
            \_ ->
                Organize.decodeNameSet Organize.normalizeNick Organize.maxClosed """["Mara","#room","jun"]"""
                    |> Set.toList
                    |> Expect.equal [ "jun", "mara" ]
        , test "the cap is honoured" <|
            \_ ->
                let
                    raw =
                        "[" ++ String.join "," (List.map (\i -> "\"#r" ++ String.fromInt i ++ "\"") (List.range 1 600)) ++ "]"
                in
                Organize.decodeNameSet Organize.normalizeRoom Organize.maxHidden raw
                    |> Set.size
                    |> Expect.equal Organize.maxHidden
        , test "bad JSON and oversize values are empty" <|
            \_ ->
                [ Organize.decodeNameSet Organize.normalizeRoom 10 "oops"
                , Organize.decodeNameSet Organize.normalizeRoom 10 (String.repeat (130 * 1024) "a")
                ]
                    |> Expect.equal [ Set.empty, Set.empty ]
        , test "encode is a JSON array; empty removes the key" <|
            \_ ->
                ( Organize.encodeNameSet (Set.fromList [ "#b", "#a" ]), Organize.encodeNameSet Set.empty )
                    |> Expect.equal ( Just """["#a","#b"]""", Nothing )
        ]


bookmarks : Test
bookmarks =
    describe "saved messages"
        [ test "a saved plain message keeps a bounded one-line snippet" <|
            \_ ->
                Organize.addBookmark (input "#lounge" "m1" (Just "line one\nline\ttwo   spaced")) []
                    |> List.map (\b -> { snippet = b.snippet, locked = b.locked, target = b.target, id = b.id })
                    |> Expect.equal [ { snippet = "line one line two spaced", locked = False, target = "#lounge", id = "m1" } ]
        , test "a snippet is cut at 280 characters with an ellipsis" <|
            \_ ->
                Organize.addBookmark (input "#lounge" "m1" (Just (String.repeat 400 "x"))) []
                    |> List.map (.snippet >> String.length)
                    |> Expect.equal [ Organize.maxSnippetLength ]
        , test "an encrypted row saves its place, never its words" <|
            \_ ->
                Organize.addBookmark (input "mara" "m1" Nothing) []
                    |> List.map (\b -> ( b.snippet, b.locked ))
                    |> Expect.equal [ ( "", True ) ]
        , test "envelope-shaped text is never kept, even when the row forgot to say" <|
            \_ ->
                Organize.addBookmark (input "mara" "m1" (Just "ONYXDM1 AAAA.BBBB")) []
                    |> List.map (\b -> ( b.snippet, b.locked ))
                    |> Expect.equal [ ( "", True ) ]
        , test "single, multi-device and room envelopes are all sealed; plain text is not" <|
            \_ ->
                List.map Organize.looksSealed [ "  ONYXDM1 AAAA", "ONYXDMN1 AAAA", "ONYXROOM1 AAAA", "ONYXDM1", "hello ONYXDM1 there" ]
                    |> Expect.equal [ True, True, True, False, False ]
        , test "newest first; re-saving the same message moves it to the top once" <|
            \_ ->
                let
                    list =
                        []
                            |> Organize.addBookmark (input "#a" "1" (Just "one"))
                            |> Organize.addBookmark (input "#a" "2" (Just "two"))
                            |> Organize.addBookmark (input "#A" "1" (Just "one again"))
                in
                list |> List.map (\b -> ( b.id, b.snippet )) |> Expect.equal [ ( "1", "one again" ), ( "2", "two" ) ]
        , test "the same id in two rooms is two saves" <|
            \_ ->
                []
                    |> Organize.addBookmark (input "#a" "1" (Just "x"))
                    |> Organize.addBookmark (input "#b" "1" (Just "y"))
                    |> List.length
                    |> Expect.equal 2
        , test "the oldest falls off past 100" <|
            \_ ->
                let
                    saved =
                        List.foldl (\i acc -> Organize.addBookmark (input "#a" (String.fromInt i) (Just "x")) acc) [] (List.range 1 105)
                in
                Expect.equal
                    { size = List.length saved, newest = List.map .id (List.take 1 saved), has5 = Organize.isBookmarked "#a" "5" saved, has6 = Organize.isBookmarked "#a" "6" saved }
                    { size = 100, newest = [ "105" ], has5 = False, has6 = True }
        , test "invalid input is a no-op" <|
            \_ ->
                [ input "#a" "" (Just "x")
                , input "" "1" (Just "x")
                , input "has space" "1" (Just "x")
                , input "#a" (String.repeat 257 "i") (Just "x")
                ]
                    |> List.map (\i -> Organize.addBookmark i [])
                    |> Expect.equal [ [], [], [], [] ]
        , test "isBookmarked / removeBookmark match the room in any case" <|
            \_ ->
                let
                    saved =
                        Organize.addBookmark (input "#Lounge" "1" (Just "x")) []
                in
                Expect.equal ( Organize.isBookmarked "#lounge" "1" saved, Organize.removeBookmark "#LOUNGE" "1" saved )
                    ( True, [] )
        , test "round-trips through encode / decode" <|
            \_ ->
                let
                    saved =
                        []
                            |> Organize.addBookmark (input "#a" "1" (Just "first"))
                            |> Organize.addBookmark (input "mara" "2" Nothing)
                in
                Organize.encodeBookmarks saved
                    |> Maybe.map Organize.decodeBookmarks
                    |> Expect.equal (Just saved)
        , test "no saves removes the key" <|
            \_ ->
                Organize.encodeBookmarks [] |> Expect.equal Nothing
        , test "the oracle's snapshots import as snippets; its encrypted ones lose their words" <|
            \_ ->
                Organize.decodeBookmarks
                    """[{"id":"1","target":"#a","from":"x","text":"hello world","time":123},
                        {"id":"2","target":"mara","from":"mara","text":"ONYXDM1 ZZZ","encrypted":true,"time":124},
                        {"id":"3","target":"#b","from":"y","text":"ONYXDM1 sneaky","time":125}]"""
                    |> List.map (\b -> ( b.id, b.snippet, b.locked ))
                    |> Expect.equal [ ( "1", "hello world", False ), ( "2", "", True ), ( "3", "", True ) ]
        , test "hostile and oversize values decode to nothing useful" <|
            \_ ->
                [ Organize.decodeBookmarks "nope"
                , Organize.decodeBookmarks "{}"
                , Organize.decodeBookmarks (String.repeat (2 * 1024 * 1024 + 1) " ")
                , Organize.decodeBookmarks """[1,"x",null,{"id":1}]"""
                ]
                    |> Expect.equal [ [], [], [], [] ]
        ]


notes : Test
notes =
    describe "private notes"
        [ test "set, read (any case), replace" <|
            \_ ->
                Organize.setNote "Mara" "  runs design crit  " Dict.empty
                    |> Result.andThen (Organize.setNote "mara" "now on Fridays")
                    |> expectOk (\n -> Expect.equal (Just "now on Fridays") (Organize.noteFor " MARA " n))
        , test "a blank note clears it" <|
            \_ ->
                Organize.setNote "mara" "x" Dict.empty
                    |> Result.andThen (Organize.setNote "mara" "   \n ")
                    |> expectOk (\n -> Expect.equal Dict.empty n)
        , test "newlines are kept, other control characters dropped" <|
            \_ ->
                Organize.setNote "mara" "a\nb\u{0007}c" Dict.empty
                    |> expectOk (\n -> Expect.equal (Just "a\nbc") (Organize.noteFor "mara" n))
        , test "refuses an invalid name, an over-long note, and a 513th person" <|
            \_ ->
                let
                    full =
                        List.range 1 Organize.maxNotes
                            |> List.map (\i -> ( "p" ++ String.fromInt i, "n" ))
                            |> Dict.fromList
                in
                [ Organize.setNote "#room" "x" Dict.empty
                , Organize.setNote "mara" (String.repeat (Organize.maxNoteLength + 1) "x") Dict.empty
                , Organize.setNote "newcomer" "x" full
                , Organize.setNote "p1" "edited" full
                ]
                    |> List.map (Result.map (always ()))
                    |> Expect.equal
                        [ Err "Notes need a valid name."
                        , Err "Notes can be up to 2048 characters."
                        , Err "You can keep notes on up to 512 people."
                        , Ok ()
                        ]
        , test "round-trips; empty removes the key" <|
            \_ ->
                let
                    saved =
                        Dict.fromList [ ( "mara", "design crit" ), ( "jun", "line 1\nline 2" ) ]
                in
                Expect.equal
                    ( Organize.encodeNotes saved |> Maybe.map Organize.decodeNotes, Organize.encodeNotes Dict.empty )
                    ( Just saved, Nothing )
        , test "decode re-applies the rules: keys lowered, junk and blanks dropped" <|
            \_ ->
                Organize.decodeNotes """{"Mara":"  hi ","#room":"x","jun":"","kip":7}"""
                    |> Dict.toList
                    |> Expect.equal [ ( "mara", "hi" ) ]
        , test "bad JSON and oversize values are no notes" <|
            \_ ->
                [ Organize.decodeNotes "[1]", Organize.decodeNotes "oops", Organize.decodeNotes (String.repeat (2 * 1024 * 1024 + 1) " ") ]
                    |> Expect.equal [ Dict.empty, Dict.empty, Dict.empty ]
        , fuzz Fuzz.string "decodeNotes never throws on arbitrary text" <|
            \raw ->
                Organize.decodeNotes raw |> Dict.size |> Expect.atMost Organize.maxNotes
        , fuzz Fuzz.string "decodeFolders never exceeds its caps on arbitrary text" <|
            \raw ->
                Organize.decodeFolders raw |> List.length |> Expect.atMost Organize.maxFolders
        ]
