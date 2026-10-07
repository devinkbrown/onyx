module Base64UrlTest exposing (suite)

{-| Vectors for the canonical base64url codec. Strictness rules mirror
`fromB64url` in `src/lib/e2ee/dmCipher.ts`: no padding, base64url
alphabet only, `length % 4 == 1` impossible.
-}

import Base64Url exposing (decode, encode, utf8ByteLength, utf8Bytes)
import Expect
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Base64Url"
        [ describe "encode"
            [ test "empty encodes empty" <|
                \_ -> encode [] |> Expect.equal ""
            , test "known vector AQIDBA" <|
                \_ -> encode [ 1, 2, 3, 4 ] |> Expect.equal "AQIDBA"
            , test "one byte pads nothing, two chars" <|
                \_ -> encode [ 0xFF ] |> Expect.equal "_w"
            , test "two bytes yield three chars" <|
                \_ -> encode [ 0xFF, 0xFF ] |> Expect.equal "__8"
            , test "uses - and _ instead of + and /" <|
                \_ ->
                    -- 0xFB 0xFF -> standard "+/8=" -> url "-_8"
                    encode [ 0xFB, 0xFF ] |> Expect.equal "-_8"
            ]
        , describe "decode"
            [ test "empty decodes to empty (wire validators reject emptiness)" <|
                \_ -> decode "" |> Expect.equal (Just [])
            , test "round-trips arbitrary bytes" <|
                \_ ->
                    let
                        bytes =
                            List.range 0 255
                    in
                    decode (encode bytes) |> Expect.equal (Just bytes)
            , test "rejects padding" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (decode "AQIDBA==")
                        , \_ -> Expect.equal Nothing (decode "AQIDBA=")
                        ]
                        ()
            , test "rejects standard-base64 chars" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (decode "AB+CD")
                        , \_ -> Expect.equal Nothing (decode "AB/CD")
                        , \_ -> Expect.equal Nothing (decode "not+base64url")
                        ]
                        ()
            , test "rejects impossible length % 4 == 1" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (decode "A")
                        , \_ -> Expect.equal Nothing (decode "ABCDE")
                        ]
                        ()
            , test "decodes 2- and 3-char tails" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just [ 0xFF ]) (decode "_w")
                        , \_ -> Expect.equal (Just [ 1, 2 ]) (decode "AQI")
                        ]
                        ()
            ]
        , describe "utf8"
            [ test "ascii is one byte per char" <|
                \_ -> utf8ByteLength "#root" |> Expect.equal 5
            , test "CJK is three bytes (channel guard vector)" <|
                \_ ->
                    -- groupControl.test.ts: '#' + 43×'界' is 129 bytes > 128.
                    utf8ByteLength "界" |> Expect.equal 3
            , test "emoji is four bytes" <|
                \_ -> utf8Bytes "🔒" |> Expect.equal [ 0xF0, 0x9F, 0x94, 0x92 ]
            , test "café has a two-byte é" <|
                \_ -> utf8ByteLength "café" |> Expect.equal 5
            ]
        ]
