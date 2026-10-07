module CadenceTest exposing (suite)

{-| Cadence datagram parity: the Zig KAT frame byte-for-byte,
encode/decode round-trips, the verbatim MAC-tag allowance,
control-band/codec/shape rejects, and the full replay-guard suite.
Oracle `cadenceFrame.ts` (+ `ws_media_mac.vectors.json`) and
`replayWindow.ts`.
-}

import Bitwise
import Cadence exposing (..)
import Expect
import Test exposing (Test, describe, test)


{-| Zig KAT frame hex (band 64, stream 287454020, seq 7, ts 9000,
keyframe, cadencevox, payload "voice"). -}
katHex : String
katHex =
    "0500000040443322110700000028230000000000000101766f696365"


hexByte : String -> Maybe Int
hexByte pair =
    case String.toList pair of
        [ hi, lo ] ->
            let
                nibble c =
                    if c >= '0' && c <= '9' then
                        Just (Char.toCode c - Char.toCode '0')

                    else if c >= 'a' && c <= 'f' then
                        Just (Char.toCode c - Char.toCode 'a' + 10)

                    else
                        Nothing
            in
            case ( nibble hi, nibble lo ) of
                ( Just h, Just l ) ->
                    Just (h * 16 + l)

                _ ->
                    Nothing

        _ ->
            Nothing


hexToBytes : String -> List Int
hexToBytes hex =
    List.filterMap hexByte
        (List.map String.fromList (chunksOfTwo (String.toList hex)))


chunksOfTwo : List Char -> List (List Char)
chunksOfTwo chars =
    case chars of
        a :: b :: rest ->
            [ a, b ] :: chunksOfTwo rest

        _ ->
            []


bytesToHex : List Int -> String
bytesToHex bytes =
    let
        hex =
            "0123456789abcdef"

        byte b =
            String.slice (b // 16) (b // 16 + 1) hex
                ++ String.slice (modBy 16 b) (modBy 16 b + 1) hex
    in
    String.concat (List.map byte bytes)


voiceBytes : List Int
voiceBytes =
    [ 118, 111, 105, 99, 101 ]


katFrame : CadenceFrame
katFrame =
    { bandId = 64
    , streamId = 287454020
    , sequence = 7
    , timestamp = 9000
    , keyframe = True
    , codec = CodecVox
    , payload = voiceBytes
    }


{-| 12-byte IV: 8-byte prefix (first byte set) + BE counter
(mirrors the oracle `iv()` helper). -}
testIv : Int -> Int -> List Int
testIv prefix counter =
    [ Bitwise.and 255 prefix, 0, 0, 0, 0, 0, 0, 0 ]
        ++ List.map
            (\shift -> Bitwise.and 255 (Bitwise.shiftRightZfBy shift counter))
            [ 24, 16, 8, 0 ]


defaultGuard : ReplayGuard
defaultGuard =
    case makeGuard defaultWindowBits defaultMaxSenders of
        Just guard ->
            guard

        Nothing ->
            { windowBits = 0, maxSenders = 0, senders = [] }


suite : Test
suite =
    describe "Cadence"
        [ describe "frame wire format"
            [ test "encodes the canonical KAT frame byte-for-byte" <|
                \_ ->
                    case encodeFrame katFrame of
                        Nothing ->
                            Expect.fail "expected bytes"

                        Just bytes ->
                            Expect.equal katHex (bytesToHex bytes)
            , test "round-trips encode/decode" <|
                \_ ->
                    let
                        frame =
                            { bandId = 128
                            , streamId = 3735928559
                            , sequence = 4242
                            , timestamp = 1700000000
                            , keyframe = False
                            , codec = CodecVis
                            , payload = [ 1, 2, 3, 4, 5, 6, 7, 8 ]
                            }
                    in
                    case encodeFrame frame |> Maybe.andThen decodeFrame of
                        Nothing ->
                            Expect.fail "expected a frame"

                        Just decoded ->
                            Expect.all
                                [ \_ -> Expect.equal 128 decoded.bandId
                                , \_ -> Expect.equal 3735928559 decoded.streamId
                                , \_ -> Expect.equal 4242 decoded.sequence
                                , \_ -> Expect.equal 1700000000 decoded.timestamp
                                , \_ -> Expect.equal False decoded.keyframe
                                , \_ -> Expect.equal CodecVis decoded.codec
                                , \_ -> Expect.equal [ 1, 2, 3, 4, 5, 6, 7, 8 ] decoded.payload
                                ]
                                ()
            , test "decodes a frame with a trailing 16-byte MAC tag" <|
                \_ ->
                    let
                        tagged =
                            hexToBytes katHex ++ List.repeat 16 0
                    in
                    case decodeFrame tagged of
                        Nothing ->
                            Expect.fail "expected a frame"

                        Just decoded ->
                            Expect.all
                                [ \_ -> Expect.equal 287454020 decoded.streamId
                                , \_ -> Expect.equal voiceBytes decoded.payload
                                ]
                                ()
            , test "rejects a control-band frame and truncated input" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal Nothing
                                (encodeFrame { katFrame | bandId = 10 })
                        , \_ ->
                            Expect.equal Nothing
                                (decodeFrame (List.repeat (minFrameBytes - 1) 0))
                        ]
                        ()
            , test "rejects unknown codecs and overruns" <|
                \_ ->
                    let
                        badCodec =
                            hexToBytes katHex
                                |> List.indexedMap
                                    (\i b ->
                                        if i == 22 then
                                            9

                                        else
                                            b
                                    )

                        overrun =
                            hexToBytes katHex ++ [ 255 ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (decodeFrame badCodec)
                        , \_ -> Expect.equal Nothing (decodeFrame overrun)
                        , \_ -> Expect.equal Nothing (decodeFrame (255 :: hexToBytes katHex))
                        ]
                        ()
            ]
        , describe "replay guard"
            [ test "accepts a fresh IV and only records it on commit" <|
                \_ ->
                    let
                        iv =
                            testIv 1 5
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (mayAcceptIv iv defaultGuard)
                        , \_ -> Expect.equal 0 (senderCount defaultGuard)
                        , \_ ->
                            Expect.equal False
                                (mayAcceptIv iv (commitIv iv defaultGuard))
                        ]
                        ()
            , test "rejects an exact replay after commit" <|
                \_ ->
                    let
                        committed =
                            commitIv (testIv 1 5) defaultGuard
                    in
                    Expect.equal False (mayAcceptIv (testIv 1 5) committed)
            , test "separates senders by prefix" <|
                \_ ->
                    let
                        committed =
                            commitIv (testIv 1 7) defaultGuard
                    in
                    Expect.equal True (mayAcceptIv (testIv 2 7) committed)
            , test "accepts monotonic counters, rejects each re-delivery" <|
                \_ ->
                    let
                        committed =
                            List.foldl commitIv defaultGuard (List.map (testIv 3) [ 0, 1, 2 ])
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (mayAcceptIv (testIv 3 3) committed)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 3 0) committed)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 3 2) committed)
                        ]
                        ()
            , test "tolerates in-window out-of-order, rejects duplicates" <|
                \_ ->
                    let
                        committed =
                            commitIv (testIv 4 8)
                                (commitIv (testIv 4 10) defaultGuard)

                        withNine =
                            commitIv (testIv 4 9) committed
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (mayAcceptIv (testIv 4 9) committed)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 4 9) withNine)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 4 10) withNine)
                        ]
                        ()
            , test "rejects counters before the window" <|
                \_ ->
                    let
                        committed =
                            commitIv (testIv 5 100) defaultGuard

                        moved =
                            List.foldl commitIv committed (List.map (testIv 5) [ 101, 102, 103 ])
                    in
                    Expect.all
                        [ \_ -> Expect.equal False (mayAcceptIv (testIv 5 100) moved)
                        ]
                        ()
            , test "mayAccept alone creates no sender state" <|
                \_ ->
                    let
                        probed =
                            { defaultGuard | senders = defaultGuard.senders }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (mayAcceptIv (testIv 9 0) probed)
                        , \_ -> Expect.equal 0 (senderCount probed)
                        ]
                        ()
            , test "evicts least-recently-used past the cap" <|
                \_ ->
                    let
                        tiny =
                            case makeGuard 64 3 of
                                Just guard ->
                                    guard

                                Nothing ->
                                    defaultGuard

                        three =
                            List.foldl commitIv tiny [ testIv 1 0, testIv 2 0, testIv 3 0 ]

                        touched =
                            commitIv (testIv 1 1) three

                        four =
                            commitIv (testIv 4 0) touched
                    in
                    Expect.all
                        [ \_ -> Expect.equal 3 (senderCount four)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 1 1) four)
                        , \_ -> Expect.equal True (mayAcceptIv (testIv 2 0) four)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 4 0) four)
                        ]
                        ()
            , test "holds a full default window without unbounded growth" <|
                \_ ->
                    let
                        committed =
                            List.foldl commitIv defaultGuard (List.map (testIv 6) (List.range 0 (defaultWindowBits * 4 - 1)))

                        top =
                            defaultWindowBits * 4 - 1
                    in
                    Expect.all
                        [ \_ -> Expect.equal 1 (senderCount committed)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 6 top) committed)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 6 (top - 10)) committed)
                        ]
                        ()
            , test "survives a large forward jump" <|
                \_ ->
                    let
                        narrow =
                            case makeGuard 64 8 of
                                Just guard ->
                                    guard

                                Nothing ->
                                    defaultGuard

                        base =
                            commitIv (testIv 8 0) narrow

                        far =
                            2147483647

                        jumped =
                            commitIv (testIv 8 far) base
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (mayAcceptIv (testIv 8 far) base)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 8 far) jumped)
                        , \_ -> Expect.equal True (mayAcceptIv (testIv 8 (far - 1)) jumped)
                        , \_ -> Expect.equal False (mayAcceptIv (testIv 8 0) jumped)
                        ]
                        ()
            , test "clear forgets all sender state" <|
                \_ ->
                    let
                        committed =
                            commitIv (testIv 7 3) defaultGuard

                        cleared =
                            clearGuard committed
                    in
                    Expect.all
                        [ \_ -> Expect.equal False (mayAcceptIv (testIv 7 3) committed)
                        , \_ -> Expect.equal 0 (senderCount cleared)
                        , \_ -> Expect.equal True (mayAcceptIv (testIv 7 3) cleared)
                        ]
                        ()
            , test "mis-sized IVs fail closed" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (mayAcceptIv (List.repeat 11 0) defaultGuard)
                        , \_ ->
                            Expect.equal defaultGuard
                                (commitIv (List.repeat 13 0) defaultGuard)
                        ]
                        ()
            , test "rejects non-positive dimensions" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (makeGuard 0 8)
                        , \_ -> Expect.equal Nothing (makeGuard 64 0)
                        ]
                        ()
            ]
        ]
