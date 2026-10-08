module RoomMediaTest exposing (suite)

{-| Oracle-mirrored vectors for `RoomMedia` (mirroring
`src/lib/upload/roomMediaIndex.test.ts`: filter split, real domains
with no fetching, locked vs opened E2EE bodies, live-wins merge).
-}

import Expect
import RoomMedia exposing (RoomMediaFilter(..))
import Test exposing (Test, describe, test)


row : String -> String -> RoomMedia.MediaRow
row id body =
    { id = id
    , from = "ada"
    , body = body
    , plaintext = Nothing
    , msgType = "msg"
    , at = 1786104000000
    , deleted = False
    , redacted = False
    , encrypted = False
    }


suite : Test
suite =
    describe "RoomMedia"
        [ test "filters this-device history into Pictures, Files, and Links" <|
            \_ ->
                let
                    index =
                        RoomMedia.indexRoomMedia
                            [ row "pic" "dusk\n[file: harbour.png] 120 KB https://cdn.example/harbour.png"
                            , row "doc" "[file: notes.pdf] 12.0 KB https://cdn.example/notes.pdf"
                            , row "url" "see https://news.example/story"
                            , { id = "join", from = "ada", body = "ada joined", plaintext = Nothing, msgType = "join", at = 1786104000000, deleted = False, redacted = False, encrypted = False }
                            ]
                in
                Expect.all
                    [ \_ ->
                        Expect.equal
                            [ { kind = Pictures
                              , id = "pic:https://cdn.example/harbour.png"
                              , messageId = "pic"
                              , href = "https://cdn.example/harbour.png"
                              , name = Just "harbour.png"
                              , sizeLabel = Just "120 KB"
                              , domain = Nothing
                              , from = "ada"
                              , at = 1786104000000
                              }
                            ]
                            index.pictures
                    , \_ ->
                        Expect.equal
                            [ { kind = Files
                              , id = "doc:https://cdn.example/notes.pdf"
                              , messageId = "doc"
                              , href = "https://cdn.example/notes.pdf"
                              , name = Just "notes.pdf"
                              , sizeLabel = Just "12.0 KB"
                              , domain = Nothing
                              , from = "ada"
                              , at = 1786104000000
                              }
                            ]
                            index.files
                    , \_ ->
                        Expect.equal
                            [ { kind = Links
                              , id = "url:https://news.example/story"
                              , messageId = "url"
                              , href = "https://news.example/story"
                              , name = Nothing
                              , sizeLabel = Nothing
                              , domain = Just "news.example"
                              , from = "ada"
                              , at = 1786104000000
                              }
                            ]
                            index.links
                    , \_ -> Expect.equal 1 (List.length (RoomMedia.itemsForFilter index Pictures))
                    , \_ -> Expect.equal 1 (List.length (RoomMedia.itemsForFilter index Files))
                    , \_ -> Expect.equal 1 (List.length (RoomMedia.itemsForFilter index Links))
                    , \_ -> Expect.equal "No pictures from this conversation are on this device." (RoomMedia.emptyCopy Pictures)
                    , \_ ->
                        Expect.equal 1
                            (List.length (List.filter (not << String.isEmpty) (String.split "." (RoomMedia.emptyCopy Pictures))))
                    ]
                    ()
        , test "shows the real domain with ports stripped" <|
            \_ ->
                let
                    index =
                        RoomMedia.indexRoomMedia [ row "u" "https://www.example.com:8443/path?q=1" ]
                in
                Expect.all
                    [ \_ ->
                        Expect.equal
                            (Just "www.example.com")
                            (List.head index.links |> Maybe.andThen .domain)
                    , \_ -> Expect.equal "cdn.example" (RoomMedia.linkDomain "https://cdn.example/a.png")
                    ]
                    ()
        , test "does not index locked E2EE bodies but indexes opened plaintext" <|
            \_ ->
                let
                    locked =
                        { id = "locked", from = "ada", body = "ENVELOPE not-a-url", plaintext = Nothing, msgType = "msg", at = 0, deleted = False, redacted = False, encrypted = True }

                    opened =
                        { id = "open", from = "ada", body = "ENVELOPE cipher", plaintext = Just "https://friends.example/note", msgType = "msg", at = 0, deleted = False, redacted = False, encrypted = True }
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (RoomMedia.readableMessageBody locked)
                    , \_ -> Expect.equal [] (RoomMedia.indexRoomMedia [ locked ]).links
                    , \_ ->
                        Expect.equal
                            (Just "friends.example")
                            ((RoomMedia.indexRoomMedia [ opened ]).links |> List.head |> Maybe.andThen .domain)
                    ]
                    ()
        , test "lets live transcript win over vault rows with the same id" <|
            \_ ->
                let
                    vault =
                        row "same" "https://old.example"

                    live =
                        row "same" "https://new.example"

                    merged =
                        RoomMedia.mergeRoomHistory [ live ] [ vault ]
                in
                Expect.all
                    [ \_ -> Expect.equal 1 (List.length merged)
                    , \_ -> Expect.equal (Just "https://new.example") (List.head merged |> Maybe.map .body)
                    ]
                    ()
        , test "tombstones and non-chat rows stay out of the index" <|
            \_ ->
                let
                    deleted =
                        { id = "d", from = "ada", body = "https://gone.example", plaintext = Nothing, msgType = "msg", at = 0, deleted = True, redacted = False, encrypted = False }

                    system =
                        { id = "s", from = "ada", body = "https://sys.example", plaintext = Nothing, msgType = "system", at = 0, deleted = False, redacted = False, encrypted = False }

                    notice =
                        row "n" "https://notice.example"
                            |> (\r -> { r | msgType = "notice" })
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (RoomMedia.readableMessageBody deleted)
                    , \_ -> Expect.equal Nothing (RoomMedia.readableMessageBody system)
                    , \_ -> Expect.equal 0 (List.length (RoomMedia.indexRoomMedia [ deleted, system ]).links)
                    , \_ -> Expect.equal 1 (List.length (RoomMedia.indexRoomMedia [ notice ]).links)
                    ]
                    ()
        , test "lists newest first" <|
            \_ ->
                let
                    older =
                        { id = "a", from = "ada", body = "https://a.example", plaintext = Nothing, msgType = "msg", at = 10, deleted = False, redacted = False, encrypted = False }

                    newer =
                        { id = "b", from = "ada", body = "https://b.example", plaintext = Nothing, msgType = "msg", at = 20, deleted = False, redacted = False, encrypted = False }

                    index =
                        RoomMedia.indexRoomMedia [ older, newer ]
                in
                Expect.equal [ "b", "a" ] (List.map .messageId index.links)
        ]
