module VaultImportTest exposing (suite)

{-| Executable spec for vault export-snapshot import validation: shape
gates, strict row revival, newest-tail slicing, global work budget,
last-wins dedupe, and target normalisation. Mirrors the oracle
`parseVaultExport` suites.
-}

import Expect
import Json.Encode as Encode
import Test exposing (Test, describe, test)
import VaultImport


message : String -> String -> String -> String -> Float -> Encode.Value
message id from body type_ time =
    Encode.object
        [ ( "id", Encode.string id )
        , ( "from", Encode.string from )
        , ( "text", Encode.string body )
        , ( "type", Encode.string type_ )
        , ( "time", Encode.float time )
        ]


target : String -> List Encode.Value -> Encode.Value
target name messages =
    Encode.object
        [ ( "target", Encode.string name )
        , ( "messages", Encode.list identity messages )
        ]


snapshot : List Encode.Value -> Encode.Value
snapshot targets =
    Encode.object
        [ ( "kind", Encode.string "onyx-vault" )
        , ( "version", Encode.int 1 )
        , ( "exportedAt", Encode.string "2026-01-01T00:00:00.000Z" )
        , ( "targets", Encode.list identity targets )
        ]


parse : Encode.Value -> Maybe VaultImport.VaultImportSnapshot
parse =
    VaultImport.parseVaultExport


suite : Test
suite =
    describe "VaultImport"
        [ describe "shape gates"
            [ test "wrong kind, version, or targets reject" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal Nothing
                                (parse (Encode.object [ ( "kind", Encode.string "other" ), ( "version", Encode.int 1 ), ( "targets", Encode.list identity [] ) ]))
                        , \_ ->
                            Expect.equal Nothing
                                (parse (Encode.object [ ( "kind", Encode.string "onyx-vault" ), ( "version", Encode.int 2 ), ( "targets", Encode.list identity [] ) ]))
                        , \_ ->
                            Expect.equal Nothing
                                (parse (Encode.object [ ( "kind", Encode.string "onyx-vault" ), ( "version", Encode.int 1 ) ]))
                        , \_ -> Expect.equal Nothing (parse (Encode.list identity []))
                        ]
                        ()
            , test "empty targets still validate" <|
                \_ ->
                    case parse (snapshot []) of
                        Just snap ->
                            Expect.all
                                [ \_ -> Expect.equal [] snap.targets
                                , \_ -> Expect.equal "2026-01-01T00:00:00.000Z" snap.exportedAt
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "unparseable exportedAt becomes empty" <|
                \_ ->
                    let
                        value =
                            Encode.object
                                [ ( "kind", Encode.string "onyx-vault" )
                                , ( "version", Encode.int 1 )
                                , ( "exportedAt", Encode.string "not a date" )
                                , ( "targets", Encode.list identity [] )
                                ]
                    in
                    case parse value of
                        Just snap ->
                            Expect.equal "" snap.exportedAt

                        Nothing ->
                            Expect.fail "expected a snapshot"
            ]
        , describe "row revival"
            [ test "valid rows project onto flat vault rows" <|
                \_ ->
                    let
                        value =
                            snapshot
                                [ target "#C"
                                    [ message "m1" "alice" "hello" "msg" 1000
                                    , message "m2" "" "act" "action" 2000
                                    ]
                                ]
                    in
                    case parse value of
                        Just snap ->
                            Expect.equal
                                [ { target = "#c"
                                  , messages =
                                        [ { id = "m1", target = "#c", from = "alice", body = "hello", atMs = 1000, msgType = "msg" }
                                        , { id = "m2", target = "#c", from = "", body = "act", atMs = 2000, msgType = "action" }
                                        ]
                                  }
                                ]
                                snap.targets

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "ISO string times revive" <|
                \_ ->
                    let
                        msgValue =
                            Encode.object
                                [ ( "id", Encode.string "m1" )
                                , ( "from", Encode.string "a" )
                                , ( "text", Encode.string "b" )
                                , ( "type", Encode.string "msg" )
                                , ( "time", Encode.string "2026-01-01T00:00:00.000Z" )
                                ]
                    in
                    case parse (snapshot [ target "#c" [ msgValue ] ]) of
                        Just snap ->
                            case List.concatMap .messages snap.targets of
                                [ revived ] ->
                                    Expect.greaterThan 0 revived.atMs

                                _ ->
                                    Expect.fail "expected one message"

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "an export-shaped blob round-trips with its types" <|
                \_ ->
                    let
                        value =
                            snapshot
                                [ target "#c"
                                    [ message "m1" "alice" "hi" "msg" 1000
                                    , message "m2" "alice" "hey" "notice" 2000
                                    ]
                                ]
                    in
                    case parse value of
                        Just snap ->
                            Expect.equal
                                [ ( "m1", "msg" ), ( "m2", "notice" ) ]
                                (List.concatMap .messages snap.targets
                                    |> List.map (\m -> ( m.id, m.msgType ))
                                )

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "hostile rows filter out, good rows survive" <|
                \_ ->
                    let
                        badId =
                            Encode.object
                                [ ( "id", Encode.string "a\u{0000}b" )
                                , ( "from", Encode.string "a" )
                                , ( "text", Encode.string "b" )
                                , ( "type", Encode.string "msg" )
                                , ( "time", Encode.float 1 )
                                ]

                        badType =
                            message "ok1" "a" "b" "bogus" 1

                        missingType =
                            Encode.object
                                [ ( "id", Encode.string "ok2" )
                                , ( "from", Encode.string "a" )
                                , ( "text", Encode.string "b" )
                                , ( "time", Encode.float 1 )
                                ]

                        badTime =
                            Encode.object
                                [ ( "id", Encode.string "ok3" )
                                , ( "from", Encode.string "a" )
                                , ( "text", Encode.string "b" )
                                , ( "type", Encode.string "msg" )
                                , ( "time", Encode.string "whenever" )
                                ]

                        longText =
                            message "ok4" "a" (String.repeat 65537 "x") "msg" 1

                        spacedTarget =
                            Encode.object
                                [ ( "id", Encode.string "ok5" )
                                , ( "from", Encode.string "a" )
                                , ( "text", Encode.string "b" )
                                , ( "type", Encode.string "msg" )
                                , ( "time", Encode.float 1 )
                                , ( "target", Encode.string "has space" )
                                ]

                        good =
                            message "good" "a" "b" "notice" 1
                    in
                    case parse (snapshot [ target "#c" [ badId, badType, missingType, badTime, longText, spacedTarget, good ] ]) of
                        Just snap ->
                            Expect.equal [ "good" ] (List.map .id (List.concatMap .messages snap.targets))

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "message-level target overrides survive raw-cased" <|
                \_ ->
                    let
                        msgValue =
                            Encode.object
                                [ ( "id", Encode.string "m1" )
                                , ( "from", Encode.string "a" )
                                , ( "text", Encode.string "b" )
                                , ( "type", Encode.string "msg" )
                                , ( "time", Encode.float 1 )
                                , ( "target", Encode.string "#Other" )
                                ]
                    in
                    case parse (snapshot [ target "#c" [ msgValue ] ]) of
                        Just snap ->
                            Expect.equal [ "#Other" ] (List.map .target (List.concatMap .messages snap.targets))

                        Nothing ->
                            Expect.fail "expected a snapshot"
            ]
        , describe "target handling"
            [ test "targets lowercase, bad targets skip without consuming work" <|
                \_ ->
                    let
                        value =
                            snapshot
                                [ target "has space" [ message "x" "a" "b" "msg" 1 ]
                                , Encode.object [ ( "target", Encode.string "#ok" ) ]
                                , target "#Good" [ message "g" "a" "b" "msg" 1 ]
                                ]
                    in
                    case parse value of
                        Just snap ->
                            Expect.all
                                [ \_ -> Expect.equal [ "#good" ] (List.map .target snap.targets)
                                , \_ -> Expect.equal [ "g" ] (List.map .id (List.concatMap .messages snap.targets))
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "duplicate ids collapse last-wins in first-appearance order" <|
                \_ ->
                    let
                        value =
                            snapshot
                                [ target "#c"
                                    [ message "a" "x" "first" "msg" 1
                                    , message "b" "x" "only" "msg" 2
                                    , message "a" "x" "second" "msg" 3
                                    ]
                                ]
                    in
                    case parse value of
                        Just snap ->
                            Expect.equal [ ( "a", "second" ), ( "b", "only" ) ]
                                (List.map (\m -> ( m.id, m.body )) (List.concatMap .messages snap.targets))

                        Nothing ->
                            Expect.fail "expected a snapshot"
            ]
        , describe "work ceilings"
            [ test "per-target revive keeps the newest tail" <|
                \_ ->
                    let
                        messages =
                            List.map (\i -> message ("m" ++ String.fromInt i) "a" "b" "msg" (toFloat i)) (List.range 1 1605)
                    in
                    case parse (snapshot [ target "#c" messages ]) of
                        Just snap ->
                            case snap.targets of
                                [ only ] ->
                                    Expect.all
                                        [ \_ -> Expect.equal 1600 (List.length only.messages)
                                        , \_ -> Expect.equal (Just "m6") (Maybe.map .id (List.head only.messages))
                                        ]
                                        ()

                                _ ->
                                    Expect.fail "expected one target"

                        Nothing ->
                            Expect.fail "expected a snapshot"
            , test "global budget stops opening later targets" <|
                \_ ->
                    let
                        big =
                            List.map (\i -> message ("m" ++ String.fromInt i) "a" "b" "msg" (toFloat i)) (List.range 1 1600)

                        value =
                            snapshot (List.map (\n -> target ("#t" ++ String.fromInt n) big) (List.range 1 12))
                    in
                    case parse value of
                        Just snap ->
                            Expect.all
                                [ \_ -> Expect.equal 11 (List.length snap.targets)
                                , \_ ->
                                    Expect.equal (Just 384)
                                        (Maybe.map (List.length << .messages) (List.head (List.reverse snap.targets)))
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected a snapshot"
            ]
        ]
