module SavedSearchesTest exposing (suite)

import Expect
import Json.Decode as Decode
import Json.Encode as Encode
import SavedSearches
import Test exposing (Test, describe, test)


v : Encode.Value -> Decode.Value
v =
    identity


obj : List ( String, Encode.Value ) -> Decode.Value
obj fields =
    v (Encode.object fields)


nowMs : Float
nowMs =
    1800000000000


storedRow : String -> String -> String -> String -> Float -> Encode.Value -> Decode.Value
storedRow id label query mode createdAt seq =
    obj
        [ ( "id", Encode.string id )
        , ( "label", Encode.string label )
        , ( "query", Encode.string query )
        , ( "mode", Encode.string mode )
        , ( "createdAt", Encode.float createdAt )
        , ( "seq", seq )
        ]


suite : Test
suite =
    describe "SavedSearches"
        [ describe "validateSearchInput"
            [ test "accepts and trims a valid input" <|
                \_ ->
                    Expect.equal
                        (Just { label = "Mentions", query = "hello", mode = SavedSearches.ExactMode })
                        (SavedSearches.validateSearchInput "  Mentions  " "  hello  " "exact")
            , test "accepts the combined hybrid mode" <|
                \_ ->
                    Expect.equal
                        (Just { label = "Release recall", query = "rollout", mode = SavedSearches.HybridMode })
                        (SavedSearches.validateSearchInput "  Release recall  " "  rollout  " "hybrid")
            , test "rejects empty label and query" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (SavedSearches.validateSearchInput "   " "x" "exact")
                        , \_ -> Expect.equal Nothing (SavedSearches.validateSearchInput "x" "   " "semantic")
                        ]
                        ()
            , test "rejects an invalid mode" <|
                \_ ->
                    Expect.equal Nothing (SavedSearches.validateSearchInput "x" "y" "fuzzy")
            , test "rejects over-length label and query" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (SavedSearches.validateSearchInput (String.repeat (SavedSearches.maxLabelLength + 1) "a") "y" "exact")
                        , \_ -> Expect.equal Nothing (SavedSearches.validateSearchInput "x" (String.repeat (SavedSearches.maxQueryLength + 1) "q") "exact")
                        ]
                        ()
            , test "accepts values exactly at their limits after trimming" <|
                \_ ->
                    let
                        label =
                            String.repeat SavedSearches.maxLabelLength "a"

                        query =
                            String.repeat SavedSearches.maxQueryLength "q"
                    in
                    Expect.equal
                        (Just { label = label, query = query, mode = SavedSearches.SemanticMode })
                        (SavedSearches.validateSearchInput (" " ++ label ++ " ") (" " ++ query ++ " ") "semantic")
            ]
        , describe "normalizeLabel"
            [ test "is case- and edge-space-insensitive" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "my search" (SavedSearches.normalizeLabel "  My Search ")
                        , \_ -> Expect.equal (SavedSearches.normalizeLabel "MY SEARCH") (SavedSearches.normalizeLabel "my search")
                        ]
                        ()
            ]
        , describe "sanitizeId"
            [ test "accepts a clean id and rejects hostile ones" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "ss-abc") (SavedSearches.sanitizeId "ss-abc")
                        , \_ -> Expect.equal Nothing (SavedSearches.sanitizeId "   ")
                        , \_ -> Expect.equal Nothing (SavedSearches.sanitizeId " padded ")
                        , \_ -> Expect.equal Nothing (SavedSearches.sanitizeId (String.repeat (SavedSearches.maxIdLength + 1) "x"))
                        , \_ -> Expect.equal (Just "a b") (SavedSearches.sanitizeId "a b")
                        , \_ -> Expect.equal Nothing (SavedSearches.sanitizeId "bad\u{0000}id")
                        , \_ -> Expect.equal Nothing (SavedSearches.sanitizeId "tab\there")
                        , \_ -> Expect.equal (Just (String.repeat SavedSearches.maxIdLength "x")) (SavedSearches.sanitizeId (String.repeat SavedSearches.maxIdLength "x"))
                        ]
                        ()
            ]
        , describe "timestamps and sequences"
            [ test "validStoredTimestamp bounds the future" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (SavedSearches.validStoredTimestamp 0 nowMs)
                        , \_ -> Expect.equal True (SavedSearches.validStoredTimestamp nowMs nowMs)
                        , \_ -> Expect.equal False (SavedSearches.validStoredTimestamp -1 nowMs)
                        , \_ -> Expect.equal False (SavedSearches.validStoredTimestamp (nowMs + SavedSearches.futureSkewMs + 1) nowMs)
                        ]
                        ()
            , test "validSequence bounds the tiebreaker" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (SavedSearches.validSequence 0)
                        , \_ -> Expect.equal True (SavedSearches.validSequence SavedSearches.maxSequence)
                        , \_ -> Expect.equal False (SavedSearches.validSequence -1)
                        ]
                        ()
            ]
        , describe "ISO time"
            [ test "isoFromMillis anchors at the epoch and Y2K" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "1970-01-01T00:00:00.000Z" (SavedSearches.isoFromMillis 0)
                        , \_ -> Expect.equal "2000-01-01T00:00:00.000Z" (SavedSearches.isoFromMillis 946684800000)
                        ]
                        ()
            , test "parseIsoMillis inverts isoFromMillis" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just 0) (SavedSearches.parseIsoMillis "1970-01-01T00:00:00.000Z")
                        , \_ -> Expect.equal (Just 946684800000) (SavedSearches.parseIsoMillis "2000-01-01T00:00:00.000Z")
                        , \_ -> Expect.equal (Just 1783641600000) (SavedSearches.parseIsoMillis "2026-07-10T00:00:00.000Z")
                        , \_ -> Expect.equal (SavedSearches.parseIsoMillis "2026-07-10T00:00:00.000Z") (SavedSearches.parseIsoMillis "2026-07-10T02:00:00.000+02:00")
                        , \_ -> Expect.equal Nothing (SavedSearches.parseIsoMillis "not-a-date")
                        , \_ -> Expect.equal Nothing (SavedSearches.parseIsoMillis "2026-13-40T99:99:99Z")
                        ]
                        ()
            ]
        , describe "reviveStoredValue"
            [ test "revives a valid row" <|
                \_ ->
                    Expect.equal
                        (Just { id = "s1", label = "Hi", query = "q", mode = SavedSearches.ExactMode, createdAt = 5, seq = 3 })
                        (SavedSearches.reviveStoredValue (storedRow "s1" "Hi" "q" "exact" 5 (Encode.int 3)) nowMs)
            , test "absent seq reads as the neutral tiebreaker" <|
                \_ ->
                    Expect.equal
                        (Just { id = "s1", label = "Hi", query = "q", mode = SavedSearches.ExactMode, createdAt = 5, seq = 0 })
                        (SavedSearches.reviveStoredValue
                            (obj
                                [ ( "id", Encode.string "s1" )
                                , ( "label", Encode.string "Hi" )
                                , ( "query", Encode.string "q" )
                                , ( "mode", Encode.string "exact" )
                                , ( "createdAt", Encode.float 5 )
                                ]
                            )
                            nowMs
                        )
            , test "rejects untrimmed ids, bad seq, and future stamps" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (SavedSearches.reviveStoredValue (storedRow " padded " "Hi" "q" "exact" 5 (Encode.int 1)) nowMs)
                        , \_ -> Expect.equal Nothing (SavedSearches.reviveStoredValue (storedRow "s1" "Hi" "q" "exact" 5 (Encode.float 1.5)) nowMs)
                        , \_ -> Expect.equal Nothing (SavedSearches.reviveStoredValue (storedRow "s1" "Hi" "q" "exact" (nowMs + SavedSearches.futureSkewMs + 1) (Encode.int 1)) nowMs)
                        , \_ -> Expect.equal Nothing (SavedSearches.reviveStoredValue (storedRow "s1" "" "q" "exact" 5 (Encode.int 1)) nowMs)
                        ]
                        ()
            ]
        , describe "ordering and public rows"
            [ test "sorts newest first with seq tiebreak" <|
                \_ ->
                    let
                        rows =
                            [ { id = "a", label = "A", query = "q", mode = SavedSearches.ExactMode, createdAt = 1, seq = 9 }
                            , { id = "b", label = "B", query = "q", mode = SavedSearches.ExactMode, createdAt = 2, seq = 1 }
                            , { id = "c", label = "C", query = "q", mode = SavedSearches.ExactMode, createdAt = 2, seq = 5 }
                            ]
                    in
                    Expect.equal [ "c", "b", "a" ] (List.map .id (SavedSearches.sortNewestFirst rows))
            , test "publicRows dedupes by normalized label and caps" <|
                \_ ->
                    let
                        rows =
                            List.map
                                (\i ->
                                    { id = "s" ++ String.fromInt i
                                    , label =
                                        if modBy 2 i == 0 then
                                            "Same"

                                        else
                                            "Unique " ++ String.fromInt i
                                    , query = "q"
                                    , mode = SavedSearches.ExactMode
                                    , createdAt = toFloat i
                                    , seq = 0
                                    }
                                )
                                (List.range 1 (SavedSearches.savedSearchCap + 10))

                        public =
                            SavedSearches.publicRows rows
                    in
                    Expect.all
                        [ \_ -> Expect.equal 31 (List.length public)
                        , \_ -> Expect.equal 1 (List.length (List.filter (\r -> r.label == "Same") public))
                        , \_ -> Expect.equal "Same" (Maybe.withDefault "" (Maybe.map .label (List.head public)))
                        ]
                        ()
            ]
        , describe "parseExport"
            [ test "rejects wrong kind, version, and shapes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (SavedSearches.parseExport (v Encode.null) nowMs [])
                        , \_ -> Expect.equal Nothing (SavedSearches.parseExport (obj [ ( "kind", Encode.string "other" ), ( "version", Encode.int 1 ), ( "searches", Encode.list identity [] ) ]) nowMs [])
                        , \_ -> Expect.equal Nothing (SavedSearches.parseExport (obj [ ( "kind", Encode.string "onyx-saved-searches" ), ( "version", Encode.int 2 ), ( "searches", Encode.list identity [] ) ]) nowMs [])
                        , \_ -> Expect.equal Nothing (SavedSearches.parseExport (obj [ ( "kind", Encode.string "onyx-saved-searches" ), ( "version", Encode.int 1 ), ( "searches", Encode.string "nope" ) ]) nowMs [])
                        ]
                        ()
            , test "bounds untrusted arrays before reviving rows" <|
                \_ ->
                    let
                        raws =
                            List.map
                                (\i ->
                                    obj
                                        [ ( "id", Encode.string ("s" ++ String.fromInt i) )
                                        , ( "label", Encode.string ("Search " ++ String.fromInt i) )
                                        , ( "query", Encode.string ("query " ++ String.fromInt i) )
                                        , ( "mode", Encode.string "exact" )
                                        , ( "createdAt", Encode.float (toFloat i) )
                                        ]
                                )
                                (List.range 0 (SavedSearches.savedSearchCap * 4 - 1))

                        parsed =
                            SavedSearches.parseExport
                                (obj
                                    [ ( "kind", Encode.string "onyx-saved-searches" )
                                    , ( "version", Encode.int 1 )
                                    , ( "searches", Encode.list identity raws )
                                    ]
                                )
                                nowMs
                                []
                    in
                    Expect.equal (Just SavedSearches.savedSearchCap) (Maybe.map (List.length << .searches) parsed)
            , test "drops invalid rows, repairs exportedAt, keeps valid ones" <|
                \_ ->
                    let
                        parsed =
                            SavedSearches.parseExport
                                (obj
                                    [ ( "kind", Encode.string "onyx-saved-searches" )
                                    , ( "version", Encode.int 1 )
                                    , ( "exportedAt", Encode.string "not-a-date" )
                                    , ( "searches"
                                      , Encode.list identity
                                            [ obj
                                                [ ( "label", Encode.string "ok" )
                                                , ( "query", Encode.string "q" )
                                                , ( "mode", Encode.string "exact" )
                                                , ( "createdAt", Encode.float 123 )
                                                ]
                                            , obj
                                                [ ( "label", Encode.string "" )
                                                , ( "query", Encode.string "q" )
                                                , ( "mode", Encode.string "exact" )
                                                ]
                                            , obj
                                                [ ( "label", Encode.string "bad-mode" )
                                                , ( "query", Encode.string "q" )
                                                , ( "mode", Encode.string "fuzzy" )
                                                ]
                                            , obj
                                                [ ( "label", Encode.string "no-query" )
                                                , ( "query", Encode.string "   " )
                                                , ( "mode", Encode.string "exact" )
                                                ]
                                            , Encode.string "garbage"
                                            ]
                                      )
                                    ]
                                )
                                nowMs
                                [ "ss-fresh" ]
                    in
                    case parsed of
                        Just snap ->
                            Expect.all
                                [ \_ -> Expect.equal 1 (List.length snap.searches)
                                , \_ -> Expect.equal "ok" (Maybe.withDefault "" (Maybe.map .label (List.head snap.searches)))
                                , \_ -> Expect.equal "ss-fresh" (Maybe.withDefault "" (Maybe.map .id (List.head snap.searches)))
                                , \_ -> Expect.equal 123 (Maybe.withDefault 0 (Maybe.map .createdAt (List.head snap.searches)))
                                , \_ -> Expect.equal (SavedSearches.isoFromMillis nowMs) snap.exportedAt
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "revives hybrid rows and ISO createdAt strings" <|
                \_ ->
                    let
                        parsed =
                            SavedSearches.parseExport
                                (obj
                                    [ ( "kind", Encode.string "onyx-saved-searches" )
                                    , ( "version", Encode.int 1 )
                                    , ( "searches"
                                      , Encode.list identity
                                            [ obj
                                                [ ( "id", Encode.string "hybrid" )
                                                , ( "label", Encode.string "Related rollout" )
                                                , ( "query", Encode.string "rollout" )
                                                , ( "mode", Encode.string "hybrid" )
                                                , ( "createdAt", Encode.float 5 )
                                                ]
                                            , obj
                                                [ ( "id", Encode.string "iso" )
                                                , ( "label", Encode.string "Dated" )
                                                , ( "query", Encode.string "q" )
                                                , ( "mode", Encode.string "semantic" )
                                                , ( "createdAt", Encode.string "2026-07-10T00:00:00.000Z" )
                                                ]
                                            ]
                                      )
                                    ]
                                )
                                nowMs
                                []
                    in
                    case parsed of
                        Just snap ->
                            Expect.all
                                [ \_ -> Expect.equal [ "hybrid", "iso" ] (List.map .id snap.searches)
                                , \_ -> Expect.equal (Just SavedSearches.HybridMode) (Maybe.map .mode (List.head snap.searches))
                                , \_ -> Expect.equal (Just 1783641600000) (Maybe.map .createdAt (List.head (List.drop 1 snap.searches)))
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "bounds hostile ids and repairs hostile timestamps" <|
                \_ ->
                    let
                        parsed =
                            SavedSearches.parseExport
                                (obj
                                    [ ( "kind", Encode.string "onyx-saved-searches" )
                                    , ( "version", Encode.int 1 )
                                    , ( "exportedAt", Encode.string (SavedSearches.isoFromMillis (nowMs + SavedSearches.futureSkewMs + 1000)) )
                                    , ( "searches"
                                      , Encode.list identity
                                            [ obj
                                                [ ( "id", Encode.string (String.repeat SavedSearches.maxIdLength "x") )
                                                , ( "label", Encode.string "Exact id" )
                                                , ( "query", Encode.string "a" )
                                                , ( "mode", Encode.string "exact" )
                                                , ( "createdAt", Encode.float 0 )
                                                ]
                                            , obj
                                                [ ( "id", Encode.string (String.repeat (SavedSearches.maxIdLength + 1) "x") )
                                                , ( "label", Encode.string "Huge id" )
                                                , ( "query", Encode.string "b" )
                                                , ( "mode", Encode.string "exact" )
                                                , ( "createdAt", Encode.float -1 )
                                                ]
                                            , obj
                                                [ ( "id", Encode.string "future" )
                                                , ( "label", Encode.string "Future" )
                                                , ( "query", Encode.string "d" )
                                                , ( "mode", Encode.string "exact" )
                                                , ( "createdAt", Encode.float (nowMs + SavedSearches.futureSkewMs + 1) )
                                                ]
                                            ]
                                      )
                                    ]
                                )
                                nowMs
                                [ "ss-regen" ]
                    in
                    case parsed of
                        Just snap ->
                            Expect.all
                                [ \_ -> Expect.equal (SavedSearches.isoFromMillis nowMs) snap.exportedAt
                                , \_ -> Expect.equal (String.repeat SavedSearches.maxIdLength "x") (Maybe.withDefault "" (Maybe.map .id (List.head snap.searches)))
                                , \_ -> Expect.equal 0 (Maybe.withDefault -1 (Maybe.map .createdAt (List.head snap.searches)))
                                , \_ -> Expect.equal [ "ss-regen", "future" ] (List.map .id (List.drop 1 snap.searches))
                                , \_ -> Expect.equal [ nowMs, nowMs ] (List.map .createdAt (List.drop 1 snap.searches))
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected a snapshot"
            ]
        ]
