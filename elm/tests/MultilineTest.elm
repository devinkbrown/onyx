module MultilineTest exposing (suite)

{-| Vectors ported from `src/lib/irc/multiline.test.ts`. The TypeScript
suite is the oracle; `NaN`/`Infinity` limit vectors are unrepresentable
as Elm `Int`s (the type rules them out), so the port covers the
representable remainder: clamping of huge direct-call limits.
-}

import Expect
import Multiline exposing (..)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Multiline"
        [ describe "parseMultilineLimits"
            [ test "parses max-bytes and max-lines from the cap value" <|
                \_ ->
                    Expect.equal { maxBytes = 4096, maxLines = 24 }
                        (parseMultilineLimits (Just "max-bytes=4096,max-lines=24"))
            , test "falls back to defaults for missing or malformed tokens" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal defaultLimits (parseMultilineLimits Nothing)
                        , \_ -> Expect.equal defaultLimits (parseMultilineLimits (Just ""))
                        , \_ -> Expect.equal defaultLimits (parseMultilineLimits (Just "max-bytes=potato"))
                        , \_ -> Expect.equal defaultLimits (parseMultilineLimits (Just "max-bytes=-5,max-lines=0"))
                        , \_ ->
                            Expect.equal { maxBytes = 4096, maxLines = 8 }
                                (parseMultilineLimits (Just "max-lines=8"))
                        ]
                        ()
            , test "caps hostile advertised limits at client work ceilings" <|
                \_ ->
                    Expect.equal { maxBytes = limitMaxBytes, maxLines = limitMaxLines }
                        (parseMultilineLimits (Just "max-bytes=999999999,max-lines=999999999"))
            ]
        , describe "planMultilineBatches"
            [ test "returns Nothing for single-line text" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (planMultilineBatches "just one line" defaultLimits)
                        , \_ -> Expect.equal Nothing (planMultilineBatches "one line\n\n  \n" defaultLimits)
                        ]
                        ()
            , test "plans a single batch of plain lines" <|
                \_ ->
                    Expect.equal
                        (Just
                            [ [ { text = "alpha", concat = False }
                              , { text = "beta", concat = False }
                              , { text = "gamma", concat = False }
                              ]
                            ]
                        )
                        (planMultilineBatches "alpha\nbeta\ngamma" defaultLimits)
            , test "splits into multiple batches when max-lines is exceeded" <|
                \_ ->
                    case planMultilineBatches "a\nb\nc\nd\ne" { maxBytes = 4096, maxLines = 2 } of
                        Just batches ->
                            Expect.all
                                [ \b -> Expect.equal 3 (List.length b)
                                , \b -> Expect.equal 2 (List.length (withDefault [] (List.head (List.drop 0 b))))
                                , \b -> Expect.equal 2 (List.length (withDefault [] (List.head (List.drop 1 b))))
                                , \b -> Expect.equal 1 (List.length (withDefault [] (List.head (List.drop 2 b))))
                                ]
                                batches

                        Nothing ->
                            Expect.fail "expected batches"
            , test "splits into multiple batches when max-bytes is exceeded" <|
                \_ ->
                    let
                        line =
                            String.repeat 10 "x"
                    in
                    case planMultilineBatches (line ++ "\n" ++ line ++ "\n" ++ line) { maxBytes = 25, maxLines = 24 } of
                        Just batches ->
                            Expect.all
                                [ \b -> Expect.equal 2 (List.length b)
                                , \b -> Expect.equal 2 (List.length (withDefault [] (List.head b)))
                                ]
                                batches

                        Nothing ->
                            Expect.fail "expected batches"
            , test "fragments a single overlong line with concat continuations" <|
                \_ ->
                    let
                        long =
                            String.repeat 30 "a"
                    in
                    case planMultilineBatches (long ++ "\nshort") { maxBytes = 16, maxLines = 24 } of
                        Just batches ->
                            let
                                parts =
                                    List.concat batches
                            in
                            Expect.all
                                [ \_ ->
                                    Expect.equal { text = String.repeat 16 "a", concat = False }
                                        (withDefault { text = "", concat = True } (List.head parts))
                                , \_ ->
                                    Expect.equal True
                                        (String.contains (String.repeat 16 "a")
                                            (String.concat (List.map .text parts))
                                        )
                                , \_ ->
                                    Expect.equal True
                                        (String.startsWith (String.repeat 30 "a")
                                            (String.replace "\n" "" (assembleMultilineText parts))
                                        )
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected batches"
            , test "strips CR from CRLF and lone-CR endings" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just [ "line one", "line two", "line three" ])
                                (Maybe.map (List.map .text << List.concat)
                                    (planMultilineBatches "line one\r\nline two\r\nline three" defaultLimits)
                                )
                        , \_ ->
                            Expect.equal (Just [ "a", "b", "c" ])
                                (Maybe.map (List.map .text << List.concat)
                                    (planMultilineBatches "a\rb\nc" defaultLimits)
                                )
                        ]
                        ()
            , test "strips embedded NUL bytes and drops NUL-only lines" <|
                \_ ->
                    Expect.equal (Just [ "hello", "world" ])
                        (Maybe.map (List.map .text << List.concat)
                            (planMultilineBatches "hel\u{0000}lo\n\u{0000}\nworld" defaultLimits)
                        )
            , test "never splits inside a multi-byte code point" <|
                \_ ->
                    case planMultilineBatches "€€€€\nx" { maxBytes = 4, maxLines = 24 } of
                        Just batches ->
                            let
                                fragments =
                                    List.map .text (List.concat batches)
                            in
                            Expect.all
                                [ \_ ->
                                    Expect.equal False
                                        (List.any (String.contains "�") fragments)
                                , \_ ->
                                    Expect.equal fragments
                                        (List.map
                                            (\f -> String.fromList (String.toList f))
                                            fragments
                                        )
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected batches"
            , test "caps huge direct-call limits before planning" <|
                \_ ->
                    let
                        oversizedLine =
                            String.repeat (limitMaxBytes + 10) "x"

                        manyLines =
                            String.join "\n" (List.repeat (limitMaxLines + 1) "y")

                        byteBatches =
                            planMultilineBatches (oversizedLine ++ "\ntail")
                                { maxBytes = 2147483647, maxLines = 2147483647 }

                        lineBatches =
                            planMultilineBatches manyLines
                                { maxBytes = 2147483647, maxLines = 2147483647 }
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just limitMaxBytes)
                                (Maybe.map (String.length << .text)
                                    (Maybe.andThen List.head (Maybe.map List.concat byteBatches))
                                )
                        , \_ -> Expect.equal (Just 2) (Maybe.map List.length lineBatches)
                        , \_ ->
                            Expect.equal (Just limitMaxLines)
                                (Maybe.map List.length
                                    (Maybe.andThen List.head lineBatches)
                                )
                        ]
                        ()
            ]
        , describe "buildMultilineLines"
            [ test "wraps lines in BATCH +ref … BATCH -ref" <|
                \_ ->
                    case planMultilineBatches "one\ntwo" defaultLimits of
                        Just batches ->
                            Expect.equal (Just [ "BATCH +ref1 draft/multiline #chan\r\n", "@batch=ref1 PRIVMSG #chan :one\r\n", "@batch=ref1 PRIVMSG #chan :two\r\n", "BATCH -ref1\r\n" ])
                                (Maybe.map .lines (buildMultilineLines "#chan" batches [ "ref1" ] []))

                        Nothing ->
                            Expect.fail "expected batches"
            , test "adds the concat tag only to continuation fragments" <|
                \_ ->
                    Expect.equal
                        (Just
                            [ "@batch=ref1 PRIVMSG #chan :aaaa\r\n"
                            , "@batch=ref1;draft/multiline-concat PRIVMSG #chan :bbbb\r\n"
                            ]
                        )
                        (Maybe.map ((List.take 2 << List.drop 1) << .lines)
                            (buildMultilineLines "#chan"
                                [ [ { text = "aaaa", concat = False }, { text = "bbbb", concat = True } ] ]
                                [ "ref1" ]
                                []
                            )
                        )
            , test "exactly one CRLF per line for CRLF-delimited input" <|
                \_ ->
                    case planMultilineBatches "line one\r\nline two" defaultLimits of
                        Just batches ->
                            case buildMultilineLines "#chan" batches [ "ref1" ] [] of
                                Just plan ->
                                    Expect.all
                                        [ \_ ->
                                            Expect.equal True
                                                (List.all (String.endsWith "\r\n") plan.lines)
                                        , \_ ->
                                            Expect.equal True
                                                (List.all
                                                    (\l -> not (String.contains "\r" (String.dropRight 2 l)))
                                                    plan.lines
                                                )
                                        , \_ ->
                                            Expect.equal
                                                [ "BATCH +ref1 draft/multiline #chan\r\n"
                                                , "@batch=ref1 PRIVMSG #chan :line one\r\n"
                                                , "@batch=ref1 PRIVMSG #chan :line two\r\n"
                                                , "BATCH -ref1\r\n"
                                                ]
                                                plan.lines
                                        ]
                                        ()

                                Nothing ->
                                    Expect.fail "expected a send plan"

                        Nothing ->
                            Expect.fail "expected batches"
            , test "applies extra tags to the first BATCH command only" <|
                \_ ->
                    case
                        buildMultilineLines "#chan"
                            [ [ { text = "a", concat = False }, { text = "b", concat = False } ]
                            , [ { text = "c", concat = False }, { text = "d", concat = False } ]
                            ]
                            [ "r1", "r2" ]
                            [ ( "+draft/reply", "msg-42" ) ]
                    of
                        Just plan ->
                            Expect.all
                                [ \_ ->
                                    Expect.equal "@+draft/reply=msg-42 BATCH +r1 draft/multiline #chan\r\n"
                                        (withDefault "" (List.head plan.lines))
                                , \_ ->
                                    Expect.equal "BATCH +r2 draft/multiline #chan\r\n"
                                        (withDefault "" (List.head (List.drop 4 plan.lines)))
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected a send plan"
            , test "escapes extra tag values on the first BATCH command" <|
                \_ ->
                    case planMultilineBatches "one\ntwo" defaultLimits of
                        Just batches ->
                            Expect.equal (Just "@onyx/topic=release\\strain BATCH +ref1 draft/multiline #chan\r\n")
                                (Maybe.andThen List.head
                                    (Maybe.map .lines
                                        (buildMultilineLines "#chan" batches [ "ref1" ] [ ( "onyx/topic", "release train" ) ])
                                    )
                                )

                        Nothing ->
                            Expect.fail "expected batches"
            , test "fails closed when refs run short" <|
                \_ ->
                    Expect.equal Nothing
                        (buildMultilineLines "#chan"
                            [ [ { text = "a", concat = False } ]
                            , [ { text = "b", concat = False } ]
                            ]
                            [ "only-one" ]
                            []
                        )
            ]
        , describe "assembleMultilineText"
            [ test "joins plain parts with newlines" <|
                \_ ->
                    Expect.equal "one\ntwo"
                        (assembleMultilineText
                            [ { text = "one", concat = False }, { text = "two", concat = False } ]
                        )
            , test "joins concat parts without a separator" <|
                \_ ->
                    Expect.equal "hello\nworld"
                        (assembleMultilineText
                            [ { text = "hel", concat = False }
                            , { text = "lo", concat = True }
                            , { text = "world", concat = False }
                            ]
                        )
            , test "round-trips a planned send back to the original text" <|
                \_ ->
                    let
                        text =
                            "first line\nsecond line\nthird line"
                    in
                    Expect.equal (Just text)
                        (Maybe.map (assembleMultilineText << List.concat)
                            (planMultilineBatches text defaultLimits)
                        )
            ]
        ]


withDefault : a -> Maybe a -> a
withDefault fallback value =
    Maybe.withDefault fallback value
