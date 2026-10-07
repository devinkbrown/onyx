module GroupEnvelopeTest exposing (suite)

{-| Vectors ported from `src/lib/e2ee/groupEnvelope.test.ts` (pure parts)
and the contract v2 `message_policy_vectors` envelope shape.

Seal/open round-trips need WebCrypto (ports); pack/parse round-trips,
bounds, AAD binding inputs, and the fail-closed display rule are covered
here.
-}

import Base64Url
import Expect
import GroupEnvelope exposing (..)
import Test exposing (Test, describe, test)


nonce12 : List Int
nonce12 =
    List.range 1 12


ct16 : List Int
ct16 =
    List.repeat 16 0x07


suite : Test
suite =
    describe "GroupEnvelope"
        [ describe "parse / pack"
            [ test "rejects non-envelopes" <|
                \_ -> Expect.equal Nothing (parseGroupEnvelope "not-an-envelope")
            , test "rejects malformed packs" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (packGroupEnvelope -1 (List.repeat 12 0) (List.repeat 16 0))
                        , \_ -> Expect.equal Nothing (packGroupEnvelope 1 (List.repeat 8 0) (List.repeat 16 0))
                        , \_ -> Expect.equal Nothing (packGroupEnvelope 1 (List.repeat 12 0) (List.repeat 15 0))
                        ]
                        ()
            , test "pack/parse round-trips epoch, nonce, and ciphertext" <|
                \_ ->
                    case packGroupEnvelope 7 nonce12 ct16 of
                        Just wire ->
                            Expect.all
                                [ \_ -> Expect.equal True (isGroupEnvelope wire)
                                , \_ ->
                                    Expect.equal (String.length groupEnvelopePrefix + 44)
                                        (String.length wire)
                                , \_ ->
                                    case parseGroupEnvelope wire of
                                        Just parts ->
                                            Expect.all
                                                [ \p -> Expect.equal 1 p.version
                                                , \p -> Expect.equal 7 p.keyEpoch
                                                , \p -> Expect.equal nonce12 p.nonce
                                                , \p -> Expect.equal ct16 p.ciphertext
                                                ]
                                                parts

                                        Nothing ->
                                            Expect.fail "expected to parse packed envelope"
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected to pack envelope parts"
            , test "forged epoch label parses under the new epoch (AAD binds it at open)" <|
                \_ ->
                    case packGroupEnvelope 6 nonce12 ct16 of
                        Just forged ->
                            Expect.all
                                [ \_ ->
                                    Expect.equal (Just 6)
                                        (Maybe.map .keyEpoch (parseGroupEnvelope forged))
                                , \_ ->
                                    Expect.notEqual
                                        (buildGroupAad "#ops" 5)
                                        (buildGroupAad "#ops" 6)
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected to pack forged envelope"
            , test "never produces a wire above the daemon ceiling" <|
                \_ ->
                    let
                        biggest =
                            packGroupEnvelope 7 nonce12 (List.repeat maxGroupCiphertextBytes 0x61)
                    in
                    Expect.all
                        [ \_ ->
                            Maybe.map String.length biggest
                                |> Maybe.map (\n -> n <= maxGroupEnvelopeWireBytes)
                                |> Expect.equal (Just True)
                        , \_ ->
                            Expect.equal Nothing
                                (packGroupEnvelope 7 nonce12 (List.repeat (maxGroupCiphertextBytes + 1) 0x61))
                        ]
                        ()
            , test "contract accepted vector parses: ONYXROOM1 epoch-0 envelope" <|
                \_ ->
                    -- "@+onyx/e2ee=mls PRIVMSG #secure :ONYXROOM1 AQAA...A"
                    -- (33-byte minimum body: version 1, epoch 0).
                    case parseGroupEnvelope ("ONYXROOM1 AQ" ++ String.repeat 42 "A") of
                        Just parts ->
                            Expect.all
                                [ \p -> Expect.equal 1 p.version
                                , \p -> Expect.equal 0 p.keyEpoch
                                ]
                                parts

                        Nothing ->
                            Expect.fail "expected the minimum envelope to parse"
            , test "contract rejected vectors fail closed" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            -- Tagged plaintext: body is not an envelope at all.
                            Expect.equal Nothing (parseGroupEnvelope "ONYXROOM1 plaintext")
                        , \_ ->
                            -- Malformed envelope: '+' is not base64url.
                            Expect.equal Nothing (parseGroupEnvelope "ONYXROOM1 not+base64url")
                        ]
                        ()
            ]
        , describe "AAD and room names"
            [ test "buildGroupAad normalizes room and fails closed on invalid inputs" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (buildGroupAad " #Root " 1) (buildGroupAad "#root" 1)
                        , \_ -> Expect.notEqual (buildGroupAad "#root" 2) (buildGroupAad "#root" 1)
                        , \_ -> Expect.notEqual (buildGroupAad "#other" 1) (buildGroupAad "#root" 1)
                        , \_ -> Expect.equal Nothing (buildGroupAad "" 1)
                        , \_ -> Expect.equal Nothing (buildGroupAad "#root" -1)
                        ]
                        ()
            , test "AAD is the ASCII domain string ONYXROOM1|<room>|<epoch>" <|
                \_ ->
                    Expect.equal
                        (Just (Base64Url.utf8Bytes "ONYXROOM1|#root|1"))
                        (buildGroupAad "#root" 1)
            , test "normalizeGroupRoom trims, lowercases, and bounds bytes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "#root") (normalizeGroupRoom " #Root ")
                        , \_ -> Expect.equal Nothing (normalizeGroupRoom "")
                        , \_ -> Expect.equal Nothing (normalizeGroupRoom (String.repeat 257 "a"))
                        , \_ -> Expect.equal True (validRoomEpoch 0)
                        , \_ -> Expect.equal False (validRoomEpoch -1)
                        ]
                        ()
            ]
        , describe "display rule"
            [ test "ciphertext without plaintext renders the locked placeholder" <|
                \_ ->
                    case packGroupEnvelope 1 nonce12 ct16 of
                        Just wire ->
                            Expect.all
                                [ \_ ->
                                    Expect.equal groupLockedPlaceholder
                                        (groupMessageDisplayText wire Nothing)
                                , \_ ->
                                    Expect.equal False
                                        (String.contains "room secret"
                                            (groupMessageDisplayText wire Nothing)
                                        )
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected to pack envelope"
            , test "attached plaintext wins; ordinary chat passes through" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal "opened body"
                                (groupMessageDisplayText "ONYXROOM1 AAAA" (Just "opened body"))
                        , \_ ->
                            Expect.equal "ordinary room chat"
                                (groupMessageDisplayText "ordinary room chat" Nothing)
                        ]
                        ()
            ]
        ]
