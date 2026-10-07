module GroupCommitTest exposing (suite)

{-| OGCMT2 codec: exact 151-byte layout, strict decode, canonical
base64url, u64 epoch bounds, context/preimage shapes. Oracle
`lib/e2ee/groupCommit.ts`.
-}

import Expect
import GroupCommit exposing (..)
import Test exposing (Test, describe, test)


bytes32 : Int -> List Int
bytes32 fill =
    List.repeat 32 fill


validFixture : GroupCommit
validFixture =
    { priorEpoch = 7
    , nextEpoch = 8
    , priorCommitHash = bytes32 1
    , commitId = bytes32 2
    , membershipDigest = bytes32 3
    , newEpochKeyCommitment = bytes32 4
    }


genesisFixture : GroupCommit
genesisFixture =
    { priorEpoch = 0
    , nextEpoch = 1
    , priorCommitHash = List.repeat 32 0
    , commitId = bytes32 2
    , membershipDigest = bytes32 3
    , newEpochKeyCommitment = bytes32 4
    }


suite : Test
suite =
    describe "GroupCommit"
        [ describe "encode"
            [ test "emits the exact 151-byte layout" <|
                \_ ->
                    case encodeGroupCommit validFixture of
                        Nothing ->
                            Expect.fail "expected bytes"

                        Just body ->
                            Expect.all
                                [ \_ -> Expect.equal 151 (List.length body)
                                , \_ -> Expect.equal [ 79, 71, 67, 77, 84, 50 ] (List.take 6 body)
                                , \_ -> Expect.equal (Just 1) (List.head (List.drop 6 body))
                                , \_ -> Expect.equal [ 0, 0, 0, 0, 0, 0, 0, 7 ] (List.take 8 (List.drop 7 body))
                                , \_ -> Expect.equal [ 0, 0, 0, 0, 0, 0, 0, 8 ] (List.take 8 (List.drop 15 body))
                                , \_ -> Expect.equal (bytes32 1) (List.take 32 (List.drop 23 body))
                                , \_ -> Expect.equal (bytes32 2) (List.take 32 (List.drop 55 body))
                                , \_ -> Expect.equal (bytes32 3) (List.take 32 (List.drop 87 body))
                                , \_ -> Expect.equal (bytes32 4) (List.take 32 (List.drop 119 body))
                                ]
                                ()
            , test "refuses unordered epochs and zero fields" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (encodeGroupCommit { validFixture | nextEpoch = 7 })
                        , \_ -> Expect.equal Nothing (encodeGroupCommit { validFixture | priorEpoch = -1 })
                        , \_ -> Expect.equal Nothing (encodeGroupCommit { validFixture | commitId = bytes32 0 })
                        , \_ -> Expect.equal Nothing (encodeGroupCommit { validFixture | priorCommitHash = bytes32 0 })
                        , \_ -> Expect.equal Nothing (encodeGroupCommit { validFixture | membershipDigest = [ 1 ] })
                        ]
                        ()
            , test "genesis allows a zero prior hash" <|
                \_ ->
                    Expect.equal True
                        (encodeGroupCommit genesisFixture /= Nothing)
            ]
        , describe "decode"
            [ test "round-trips a valid body" <|
                \_ ->
                    case encodeGroupCommit validFixture of
                        Nothing ->
                            Expect.fail "expected bytes"

                        Just body ->
                            Expect.equal (Just validFixture) (decodeGroupCommitBytes body)
            , test "rejects bad length magic and version" <|
                \_ ->
                    case encodeGroupCommit validFixture of
                        Nothing ->
                            Expect.fail "expected bytes"

                        Just body ->
                            Expect.all
                                [ \_ -> Expect.equal Nothing (decodeGroupCommitBytes (List.drop 1 body))
                                , \_ -> Expect.equal Nothing (decodeGroupCommitBytes (0 :: List.drop 1 body))
                                , \_ ->
                                    Expect.equal Nothing
                                        (decodeGroupCommitBytes
                                            (List.take 6 body ++ [ 2 ] ++ List.drop 7 body)
                                        )
                                ]
                                ()
            , test "base64url round-trips canonically" <|
                \_ ->
                    case encodeGroupCommitBase64url validFixture of
                        Nothing ->
                            Expect.fail "expected wire"

                        Just wire ->
                            Expect.all
                                [ \_ -> Expect.equal True (String.length wire <= 256)
                                , \_ ->
                                    Expect.equal (Just validFixture)
                                        (decodeGroupCommitBase64url wire)
                                , \_ -> Expect.equal Nothing (decodeGroupCommitBase64url "!!!not-b64!!!")
                                ]
                                ()
            , test "u64 epochs past Int range refuse" <|
                \_ ->
                    case encodeGroupCommit validFixture of
                        Nothing ->
                            Expect.fail "expected bytes"

                        Just body ->
                            -- Flip the top epoch byte: epoch 7 becomes past-maxInt.
                            let
                                huge =
                                    List.take 7 body ++ [ 128 ] ++ List.drop 8 body
                            in
                            Expect.equal Nothing (decodeGroupCommitBytes huge)
            ]
        , describe "context and preimage"
            [ test "context carries domain separator and length fields" <|
                \_ ->
                    case
                        buildGroupCommitContext
                            { room = "#Room"
                            , fromAccount = "Alice"
                            , fromDevice = "laptop.1"
                            , priorEpoch = 7
                            , nextEpoch = 8
                            , commitId = bytes32 2
                            }
                    of
                        Nothing ->
                            Expect.fail "expected context"

                        Just context ->
                            let
                                domain =
                                    List.map Char.toCode (String.toList "ONYX-GROUP-COMMIT-v1")
                            in
                            Expect.all
                                [ \_ -> Expect.equal domain (List.take (List.length domain) context)
                                , \_ ->
                                    Expect.equal (Just 0)
                                        (List.head (List.drop (List.length domain) context))
                                , \_ ->
                                    Expect.equal True
                                        (List.take 32 (List.reverse context) |> List.reverse |> (==) (bytes32 2))
                                ]
                                ()
            , test "context refuses bad identities" <|
                \_ ->
                    let
                        base =
                            { room = "#r"
                            , fromAccount = "alice"
                            , fromDevice = "d1"
                            , priorEpoch = 0
                            , nextEpoch = 1
                            , commitId = bytes32 2
                            }
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (buildGroupCommitContext { base | room = "" })
                        , \_ -> Expect.equal Nothing (buildGroupCommitContext { base | fromAccount = "has space" })
                        , \_ -> Expect.equal Nothing (buildGroupCommitContext { base | fromDevice = "bad/device" })
                        , \_ -> Expect.equal Nothing (buildGroupCommitContext { base | commitId = bytes32 0 })
                        ]
                        ()
            , test "preimage binds hash-domain context and body" <|
                \_ ->
                    case encodeGroupCommit validFixture of
                        Nothing ->
                            Expect.fail "expected bytes"

                        Just body ->
                            case commitHashPreimage validFixture [ 9, 9 ] of
                                Nothing ->
                                    Expect.fail "expected preimage"

                                Just preimage ->
                                    let
                                        domain =
                                            List.map Char.toCode (String.toList "ONYX-GROUP-COMMIT-HASH-v1")
                                    in
                                    Expect.all
                                        [ \_ -> Expect.equal domain (List.take (List.length domain) preimage)
                                        , \_ ->
                                            Expect.equal (Just 0)
                                                (List.head (List.drop (List.length domain) preimage))
                                        , \_ ->
                                            Expect.equal body
                                                (List.drop (List.length preimage - 151) preimage)
                                        , \_ -> Expect.equal Nothing (commitHashPreimage validFixture [])
                                        ]
                                        ()
            ]
        ]
