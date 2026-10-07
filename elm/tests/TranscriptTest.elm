module TranscriptTest exposing (suite)

{-| Vectors mirroring `src/lib/export/conversationExport.test.ts`
(scrubbed transcript doc, 5000-row cap, text render) plus the
filename sanitizer and JSON document shape.
-}

import Expect
import Json.Encode as Encode
import Test exposing (Test, describe, test)
import Transcript exposing (..)


suite : Test
suite =
    describe "Transcript"
        [ describe "scrubExportText"
            [ test "strips the oracle CONTROL set and caps length" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "helloworld" (scrubExportText 8192 "hello\u{0000}world")
                        , \_ -> Expect.equal "a\tb\nc\rd" (scrubExportText 8192 "a\tb\nc\rd")
                        , \_ -> Expect.equal "ab" (scrubExportText 2 "abc")
                        , \_ -> Expect.equal "" (scrubExportText 8192 "\u{007F}\u{001B}")
                        ]
                        ()
            ]
        , describe "safeFilenamePart"
            [ test "keeps the allowed set, underscores the rest" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "#ops" (safeFilenamePart "#ops")
                        , \_ -> Expect.equal "a_b" (safeFilenamePart "a/b")
                        , \_ -> Expect.equal "a_b" (safeFilenamePart "a//b")
                        , \_ -> Expect.equal "_" (safeFilenamePart "///")
                        , \_ -> Expect.equal "conversation" (safeFilenamePart "")
                        , \_ -> Expect.equal 64 (String.length (safeFilenamePart (String.repeat 100 "a")))
                        ]
                        ()
            ]
        , describe "chronologicalTail"
            [ test "keeps the newest 5000, oldest first" <|
                \_ ->
                    let
                        newestFirst =
                            List.reverse (List.range 1 5003)

                        tail =
                            chronologicalTail newestFirst
                    in
                    Expect.all
                        [ \_ -> Expect.equal 5000 (List.length tail)
                        , \_ -> Expect.equal (Just 4) (List.head tail)
                        , \_ -> Expect.equal (Just 5003) (List.head (List.reverse tail))
                        ]
                        ()
            , test "short buffers pass through oldest-first" <|
                \_ ->
                    Expect.equal [ 1, 2 ] (chronologicalTail [ 2, 1 ])
            ]
        , describe "transcriptToText"
            [ test "renders the oracle header and row lines" <|
                \_ ->
                    let
                        doc =
                            { target = "#ops"
                            , messageCount = 1
                            , messages =
                                [ { id = "m1"
                                  , time = "2026-07-25T11:00:00.000Z"
                                  , from = "bob"
                                  , type_ = "msg"
                                  , text = "helloworld"
                                  , edited = False
                                  }
                                ]
                            , exportedAt = "2026-07-25T12:00:00.000Z"
                            , ourNick = "alice"
                            }
                    in
                    Expect.equal
                        "# #ops — local export\n# network: unknown\n# exported: 2026-07-25T12:00:00.000Z\n# messages: 1 (this device only — not complete server history)\n\n[2026-07-25T11:00:00.000Z] <bob> helloworld\n"
                        (transcriptToText doc)
            , test "edited rows carry the marker" <|
                \_ ->
                    let
                        doc =
                            { target = "#c"
                            , messageCount = 1
                            , messages =
                                [ { id = "m1"
                                  , time = "t"
                                  , from = "a"
                                  , type_ = "msg"
                                  , text = "x"
                                  , edited = True
                                  }
                                ]
                            , exportedAt = "e"
                            , ourNick = "me"
                            }
                    in
                    Expect.equal True (String.contains "[t] <a> x (edited)" (transcriptToText doc))
            ]
        , describe "filenames and JSON"
            [ test "filename mirrors the oracle download name" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "onyx-#ops-2026-07-25.txt" (transcriptFilename "#ops" "2026-07-25" "txt")
                        , \_ -> Expect.equal "onyx-#ops-2026-07-25.json" (transcriptFilename "#ops" "2026-07-25" "json")
                        ]
                        ()
            , test "JSON document carries kind, version, and counts" <|
                \_ ->
                    let
                        doc =
                            { target = "#c"
                            , messageCount = 0
                            , messages = []
                            , exportedAt = "e"
                            , ourNick = "me"
                            }

                        value =
                            Encode.encode 0 (encodeTranscript doc)
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (String.contains "\"kind\":\"onyx.conversation-export\"" value)
                        , \_ -> Expect.equal True (String.contains "\"version\":1" value)
                        , \_ -> Expect.equal True (String.contains "\"messageCount\":0" value)
                        ]
                        ()
            ]
        ]
