module GroupWelcomeTest exposing (suite)

{-| Vectors for the OGW1 welcome-wrap structural half: envelope framing
and the canonical context builder. Oracles:
`src/lib/e2ee/groupWelcome.ts` (`decodeGroupWelcome`,
`buildGroupWelcomeContext`) and `src/lib/e2ee/groupKeyring.ts`
(`normalizeGroupRoom`).

ECDH/HKDF/AES-GCM interop, the plaintext checks, the epoch-key
commitment, and the keyring install run ports-side and are covered by
`elm/groupWelcome.smoke.mjs` over real WebCrypto.
-}

import Base64Url
import Expect
import GroupWelcome exposing (..)
import Test exposing (..)


{-| A structurally valid envelope: magic + version + 65B `0x04` key +
12B nonce + 125B ciphertext. -}
goodWire : String
goodWire =
    Base64Url.encode
        (Base64Url.utf8Bytes "OGW1"
            ++ [ 1 ]
            ++ (4 :: List.repeat 64 9)
            ++ List.repeat 12 7
            ++ List.repeat 125 3
        )


goodContext : ContextInput
goodContext =
    { room = "#Secure"
    , fromAccount = "Alice"
    , fromDevice = "phone"
    , toAccount = "BOB"
    , toDevice = "laptop"
    , epoch = 3
    , commitId = 5 :: List.repeat 31 0
    }


suite : Test
suite =
    describe "GroupWelcome"
        [ describe "decodeEnvelope"
            [ test "accepts a well-framed 207-byte envelope" <|
                \_ ->
                    case decodeEnvelope goodWire of
                        Just envelope ->
                            Expect.all
                                [ \_ -> Expect.equal 65 (List.length envelope.ephemeralPub)
                                , \_ -> Expect.equal (Just 4) (List.head envelope.ephemeralPub)
                                , \_ -> Expect.equal 12 (List.length envelope.nonce)
                                , \_ -> Expect.equal 125 (List.length envelope.ciphertext)
                                ]
                                ()

                        Nothing ->
                            Expect.fail "valid envelope refused"
            , test "rejects bad magic, version, sizes, and trailing bytes" <|
                \_ ->
                    let
                        raw =
                            Maybe.withDefault [] (Base64Url.decode goodWire)

                        rewire bytes =
                            Base64Url.encode bytes

                        badMagic =
                            rewire (69 :: List.drop 1 raw)

                        badVersion =
                            rewire (List.take 4 raw ++ (2 :: List.drop 5 raw))

                        badEphemeral =
                            rewire (List.take 5 raw ++ (5 :: List.drop 6 raw))

                        truncated =
                            rewire (List.take 206 raw)

                        trailing =
                            Base64Url.encode (raw ++ [ 0 ])
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (decodeEnvelope badMagic)
                        , \_ -> Expect.equal Nothing (decodeEnvelope badVersion)
                        , \_ -> Expect.equal Nothing (decodeEnvelope badEphemeral)
                        , \_ -> Expect.equal Nothing (decodeEnvelope truncated)
                        , \_ -> Expect.equal Nothing (decodeEnvelope trailing)
                        , \_ -> Expect.equal Nothing (decodeEnvelope "")
                        , \_ -> Expect.equal Nothing (decodeEnvelope "!!!not-b64!!!")
                        ]
                        ()
            ]
        , describe "buildContext"
            [ test "builds the canonical domain-separated context" <|
                \_ ->
                    case buildContext goodContext of
                        Just context ->
                            let
                                domain =
                                    Base64Url.utf8Bytes contextDomain
                            in
                            Expect.all
                                [ \_ -> Expect.equal domain (List.take (List.length domain) context)
                                , \_ -> Expect.equal (Just 0) (List.head (List.drop (List.length domain) context))
                                , \_ -> Expect.equal (5 :: List.repeat 31 0) (List.drop (List.length context - 32) context)
                                ]
                                ()

                        Nothing ->
                            Expect.fail "valid context refused"
            , test "lowercases accounts and the room, keeps device case" <|
                \_ ->
                    case buildContext goodContext of
                        Just context ->
                            -- "#Secure"/"Alice"/"BOB" enter; only the
                            -- lowered forms may appear on the wire.
                            Expect.all
                                [ \_ -> Expect.equal True (contains (Base64Url.utf8Bytes "#secure") context)
                                , \_ -> Expect.equal True (contains (Base64Url.utf8Bytes "alice") context)
                                , \_ -> Expect.equal True (contains (Base64Url.utf8Bytes "bob") context)
                                , \_ -> Expect.equal True (contains (Base64Url.utf8Bytes "phone") context)
                                , \_ -> Expect.equal False (contains (Base64Url.utf8Bytes "#Secure") context)
                                , \_ -> Expect.equal False (contains (Base64Url.utf8Bytes "Alice") context)
                                , \_ -> Expect.equal False (contains (Base64Url.utf8Bytes "BOB") context)
                                ]
                                ()

                        Nothing ->
                            Expect.fail "valid context refused"
            , test "rejects bad rooms, accounts, devices, epochs, commit ids" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (buildContext { goodContext | room = "   " })
                        , \_ -> Expect.equal Nothing (buildContext { goodContext | room = String.repeat 300 "x" })
                        , \_ -> Expect.equal Nothing (buildContext { goodContext | fromAccount = "bad name!" })
                        , \_ -> Expect.equal Nothing (buildContext { goodContext | toDevice = String.repeat 33 "d" })
                        , \_ -> Expect.equal Nothing (buildContext { goodContext | epoch = -1 })
                        , \_ -> Expect.equal Nothing (buildContext { goodContext | commitId = List.repeat 32 0 })
                        , \_ -> Expect.equal Nothing (buildContext { goodContext | commitId = List.repeat 31 1 })
                        ]
                        ()
            ]
        , describe "normalizeRoom"
            [ test "trims, lowercases, and caps at 256 bytes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "#secure") (normalizeRoom "  #Secure ")
                        , \_ -> Expect.equal Nothing (normalizeRoom "  ")
                        , \_ -> Expect.equal Nothing (normalizeRoom (String.repeat 257 "r"))
                        ]
                        ()
            ]
        ]


{-| True when the needle byte list occurs inside the haystack. -}
contains : List Int -> List Int -> Bool
contains needle haystack =
    if List.isEmpty needle then
        True

    else if List.length haystack < List.length needle then
        False

    else if List.take (List.length needle) haystack == needle then
        True

    else
        contains needle (List.drop 1 haystack)
