module GroupDirectoryTest exposing (suite)

{-| Vectors for the group device-directory surface: ODD1 codec, E2EEKEY
snapshot lines, the bounded collector, and signer admission. Oracles:
`src/lib/e2ee/groupDeviceDirectory.ts` (codec, snapshot grammar,
collector bounds) and the directory half of
`src/lib/e2ee/trustedGroupSigner.ts` (by-signer lookup, ownerSeen,
algorithm/legacy/trust gates).

Trust marking (`trusted = True`) arrives from the ports derivation
verdict, so tests construct trusted rows directly for admission/finish
vectors; collected rows are always provisional.
-}

import Base64Url
import Expect
import GroupDirectory exposing (..)
import Test exposing (Test, describe, test)


sampleEntry : DirectoryEntry
sampleEntry =
    { signerPub = 1 :: List.repeat 31 0
    , encryptionPub = 4 :: List.repeat 64 7
    }


sampleWire : String
sampleWire =
    case encodeEntry sampleEntry of
        Just wire ->
            wire

        Nothing ->
            ""


deviceLine : String -> String -> String
deviceLine deviceId key =
    "E2EEKEY DEVICE account=alice id=" ++ deviceId ++ " alg=onyx-ogc1-v1 key=" ++ key


collectAll : List String -> Collector
collectAll lines =
    List.foldl (\line acc -> Tuple.first (acceptLine line acc)) blankCollector lines


suite : Test
suite =
    describe "GroupDirectory"
        [ describe "ODD1 codec"
            [ test "encode round-trips through decode" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (String.isEmpty sampleWire)
                        , \_ -> Expect.equal (Just sampleEntry) (decodeEntry sampleWire)
                        ]
                        ()
            , test "decode rejects structural violations" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (decodeEntry "")
                        , \_ -> Expect.equal Nothing (decodeEntry "not+base64url")
                        , \_ -> Expect.equal Nothing (decodeEntry "AQIDBA")
                        , \_ -> Expect.equal Nothing (decodeEntry (sampleWire ++ "="))
                        ]
                        ()
            , test "encode rejects zero signers and misshapen keys" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (encodeEntry { sampleEntry | signerPub = List.repeat 32 0 })
                        , \_ -> Expect.equal Nothing (encodeEntry { sampleEntry | signerPub = [ 1 ] })
                        , \_ -> Expect.equal Nothing (encodeEntry { sampleEntry | encryptionPub = List.repeat 65 7 })
                        , \_ -> Expect.equal Nothing (encodeEntry { sampleEntry | encryptionPub = [ 4 ] })
                        ]
                        ()
            ]
        , describe "snapshot lines"
            [ test "device and end lines parse" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just
                                    (DeviceLine
                                        { account = "alice"
                                        , deviceId = "phone"
                                        , algorithm = "onyx-ogc1-v1"
                                        , publicKey = sampleWire
                                        }
                                    )
                                )
                                (parseSnapshotLine (deviceLine "phone" sampleWire))
                        , \_ ->
                            Expect.equal
                                (Just (EndLine { account = "alice", count = 1 }))
                                (parseSnapshotLine "E2EEKEY END account=alice devices=1")
                        ]
                        ()
            , test "malformed lines are rejected" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseSnapshotLine "")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "E2EEKEY BOGUS account=alice devices=1")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "E2EEKEY DEVICE account=alice id=phone")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine (deviceLine "phone" sampleWire ++ " extra=1"))
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "E2EEKEY DEVICE account=alice account=bob id=p alg=a key=k")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "E2EEKEY DEVICE Account=alice id=p alg=a key=k")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "E2EEKEY END account=alice devices=many")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "E2EEKEY END account=alice devices=065")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "E2EEKEY END account=alice devices=65")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "E2EEKEY END account=alice")
                        , \_ -> Expect.equal Nothing (parseSnapshotLine "PRIVMSG #x :E2EEKEY END account=alice devices=0")
                        ]
                        ()
            ]
        , describe "collector"
            [ test "a complete snapshot collects provisional rows" <|
                \_ ->
                    let
                        collector =
                            collectAll [ deviceLine "phone" sampleWire, deviceLine "laptop" sampleWire, "E2EEKEY END account=alice devices=2" ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (isComplete collector)
                        , \_ -> Expect.equal False (isFailed collector)
                        , \_ -> Expect.equal 2 (List.length collector.rows)
                        , \_ ->
                            Expect.equal [ True, True ]
                                (List.map .legacy collector.rows)
                        , \_ ->
                            Expect.equal [ False, False ]
                                (List.map .trusted collector.rows)
                        ]
                        ()
            , test "count mismatch, duplicates, drift, and post-END lines fail sticky" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal True
                                (isFailed (collectAll [ deviceLine "phone" sampleWire, "E2EEKEY END account=alice devices=2" ]))
                        , \_ ->
                            Expect.equal True
                                (isFailed (collectAll [ deviceLine "phone" sampleWire, deviceLine "phone" sampleWire, "E2EEKEY END account=alice devices=2" ]))
                        , \_ ->
                            Expect.equal True
                                (isFailed (collectAll [ deviceLine "phone" sampleWire, "E2EEKEY DEVICE account=bob id=p alg=a key=k", "E2EEKEY END account=alice devices=1" ]))
                        , \_ ->
                            let
                                ( ended, admitted ) =
                                    acceptLine "E2EEKEY END account=alice devices=0" blankCollector
                            in
                            Expect.all
                                [ \_ -> Expect.equal True admitted
                                , \_ ->
                                    Expect.equal ( ended, False )
                                        (acceptLine "E2EEKEY DEVICE account=alice id=p alg=a key=k" ended)
                                ]
                                ()
                        , \_ ->
                            Expect.equal True
                                (isFailed (collectAll [ "bogus", "E2EEKEY END account=alice devices=0" ]))
                        ]
                        ()
            , test "finish needs END and rejects duplicate trusted signers" <|
                \_ ->
                    let
                        complete =
                            collectAll [ deviceLine "phone" sampleWire, "E2EEKEY END account=alice devices=1" ]

                        key =
                            Base64Url.encode sampleEntry.signerPub

                        trustedRow =
                            { account = "alice"
                            , deviceId = "phone"
                            , algorithm = directoryAlgorithm
                            , publicKey = sampleWire
                            , directoryKey = Just key
                            , trusted = True
                            , legacy = False
                            , entry = Just sampleEntry
                            }

                        dupCollector =
                            { blankCollector
                                | account = Just "alice"
                                , rows = [ trustedRow, { trustedRow | deviceId = "laptop" } ]
                                , ended = True
                                , expectedCount = Just 2
                            }
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (finishCollector blankCollector)
                        , \_ ->
                            Expect.equal (Just "alice")
                                (Maybe.map .account (finishCollector complete))
                        , \_ -> Expect.equal Nothing (finishCollector dupCollector)
                        ]
                        ()
            ]
        , describe "admission"
            [ test "trusted rows admit by signer; strangers and mismatches lock" <|
                \_ ->
                    let
                        key =
                            Base64Url.encode sampleEntry.signerPub

                        trustedRow =
                            { account = "alice"
                            , deviceId = "phone"
                            , algorithm = directoryAlgorithm
                            , publicKey = sampleWire
                            , directoryKey = Just key
                            , trusted = True
                            , legacy = False
                            , entry = Just sampleEntry
                            }

                        rows =
                            [ trustedRow ]
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal (Admitted trustedRow)
                                (admitSigner rows "alice" "phone" key)
                        , \_ ->
                            Expect.equal (Rejected SignerMismatch)
                                (admitSigner rows "alice" "phone" (Base64Url.encode (List.repeat 32 5)))
                        , \_ ->
                            Expect.equal (Rejected DeviceAbsent)
                                (admitSigner rows "bob" "tablet" (Base64Url.encode (List.repeat 32 5)))
                        , \_ ->
                            Expect.equal (Rejected UnsupportedAlgorithm)
                                (admitSigner [ { trustedRow | legacy = True } ] "alice" "phone" key)
                        , \_ ->
                            Expect.equal (Rejected BadDirectoryEntry)
                                (admitSigner [ { trustedRow | trusted = False } ] "alice" "phone" key)
                        ]
                        ()
            , test "markDerived trusts only full agreement" <|
                \_ ->
                    let
                        key =
                            Base64Url.encode sampleEntry.signerPub

                        rows =
                            (collectAll [ deviceLine "phone" sampleWire, "E2EEKEY END account=alice devices=1" ]).rows

                        trustedVerdict =
                            [ { deviceId = "phone", directoryKey = Just key, derivedId = Just "ogc1-x", trusted = True } ]

                        marked =
                            markDerived rows trustedVerdict
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal [ True ]
                                (List.map .trusted marked)
                        , \_ ->
                            Expect.equal [ False ]
                                (List.map .legacy marked)
                        , \_ ->
                            case List.head marked of
                                Nothing ->
                                    Expect.fail "no rows collected"

                                Just row ->
                                    Expect.equal (Admitted row)
                                        (admitSigner marked "alice" "phone" key)
                        , \_ ->
                            Expect.equal [ False ]
                                (List.map .trusted
                                    (markDerived rows
                                        [ { deviceId = "phone", directoryKey = Just key, derivedId = Just "ogc1-x", trusted = False } ]
                                    )
                                )
                        , \_ ->
                            Expect.equal [ Nothing ]
                                (List.map .entry
                                    (markDerived rows
                                        [ { deviceId = "phone", directoryKey = Nothing, derivedId = Nothing, trusted = False } ]
                                    )
                                )
                        , \_ ->
                            Expect.equal [ False ]
                                (List.map .trusted (markDerived rows []))
                        ]
                        ()
            , test "collected rows are never admitted before derivation" <|
                \_ ->
                    let
                        collector =
                            collectAll [ deviceLine "phone" sampleWire, "E2EEKEY END account=alice devices=1" ]

                        key =
                            Base64Url.encode sampleEntry.signerPub
                    in
                    -- Provisional rows are legacy, and the legacy gate
                    -- precedes the trust gate exactly like the oracle.
                    Expect.equal (Rejected UnsupportedAlgorithm)
                        (admitSigner collector.rows "alice" "phone" key)
            ]
        ]
