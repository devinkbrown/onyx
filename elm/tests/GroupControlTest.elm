module GroupControlTest exposing (suite)

{-| Vectors ported from `src/lib/e2ee/groupControl.test.ts`,
the pure sections of `src/lib/e2ee/groupControlPayload.test.ts`,
and the accept/reject lines of `onyx-client-contract.v2.json`
(`command_vectors`, `message_policy_vectors`).

Crypto round-trips (sign/verify/seal/open) live behind ports; everything
structural is covered here.
-}

import Base64Url
import Dict
import Expect
import GroupControl exposing (..)
import Test exposing (Test, describe, test)
import Wire


commitRoute : Routing
commitRoute =
    { channel = "#Root"
    , kind = Commit
    , fromDevice = "laptop.1"
    , fromAccount = "Alice"
    , toAccount = Nothing
    , toDevice = Nothing
    }


welcomeRoute : Routing
welcomeRoute =
    { channel = "&staff"
    , kind = Welcome
    , fromDevice = "desktop"
    , fromAccount = "Alice"
    , toAccount = Just "Kain"
    , toDevice = Just "phone-2"
    }


sampleBody : List Int
sampleBody =
    Base64Url.utf8Bytes "pub-material:body-v1"


signerPub256 : List Int
signerPub256 =
    List.repeat 32 0xAB


parseLine : String -> Maybe ControlRecord
parseLine line =
    parseGroupControlMessage (Wire.parseIrcMessage line)


suite : Test
suite =
    describe "GroupControl"
        [ describe "routing codec"
            [ test "round-trips a canonical commit without opening the payload" <|
                \_ ->
                    let
                        line =
                            buildGroupControlLine
                                { channel = "#root"
                                , kind = Commit
                                , fromDevice = "laptop.1"
                                , toAccount = Nothing
                                , toDevice = Nothing
                                , payload = "AQIDBA"
                                }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "E2EEGROUP #root commit laptop.1 :AQIDBA\r\n") line
                        , \_ ->
                            Expect.equal
                                (Just
                                    { channel = "#root"
                                    , kind = Commit
                                    , fromDevice = "laptop.1"
                                    , toAccount = Nothing
                                    , toDevice = Nothing
                                    , payload = "AQIDBA"
                                    }
                                )
                                (Maybe.andThen parseLine line)
                        ]
                        ()
            , test "round-trips targeted welcome routing metadata" <|
                \_ ->
                    let
                        line =
                            buildGroupControlLine
                                { channel = "&staff"
                                , kind = Welcome
                                , fromDevice = "desktop"
                                , toAccount = Just "Kain"
                                , toDevice = Just "phone-2"
                                , payload = "b3BhcXVl"
                                }
                    in
                    case Maybe.andThen parseLine line of
                        Just record ->
                            Expect.all
                                [ \r -> Expect.equal Welcome r.kind
                                , \r -> Expect.equal (Just "Kain") r.toAccount
                                , \r -> Expect.equal (Just "phone-2") r.toDevice
                                ]
                                record

                        Nothing ->
                            Expect.fail "expected a welcome record"
            , test "rejects ambiguous routing, injection, and non-canonical payloads" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal Nothing
                                (buildGroupControlLine
                                    { channel = "#root\r\nJOIN #bad"
                                    , kind = Commit
                                    , fromDevice = "phone"
                                    , toAccount = Nothing
                                    , toDevice = Nothing
                                    , payload = "AQ"
                                    }
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (parseLine "E2EEGROUP #root commit phone AQ smuggled")
                        , \_ ->
                            Expect.equal Nothing
                                (parseLine "E2EEGROUP #root commit phone :A")
                        , \_ ->
                            Expect.equal Nothing
                                (buildGroupControlLine
                                    { channel = "#root"
                                    , kind = Commit
                                    , fromDevice = "phone"
                                    , toAccount = Nothing
                                    , toDevice = Nothing
                                    , payload = String.repeat (maxGroupControlPayloadChars + 1) "A"
                                    }
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (buildGroupControlLine
                                    { channel = "#" ++ String.repeat 43 "界"
                                    , kind = Commit
                                    , fromDevice = "phone"
                                    , toAccount = Nothing
                                    , toDevice = Nothing
                                    , payload = "AQ"
                                    }
                                )
                        ]
                        ()
            , test "contract v2 accepted command vectors parse as records" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            parseLine "E2EEGROUP #secure key-package phone :AQIDBA"
                                |> Maybe.map (\r -> ( r.channel, r.fromDevice, r.payload ))
                                |> Expect.equal (Just ( "#secure", "phone", "AQIDBA" ))
                        , \_ ->
                            parseLine "E2EEGROUP #secure commit phone :b3BhcXVl"
                                |> Maybe.map .kind
                                |> Expect.equal (Just Commit)
                        , \_ ->
                            parseLine "E2EEGROUP #secure welcome phone Bob tablet :d2VsY29tZQ"
                                |> Maybe.map (\r -> ( r.toAccount, r.toDevice ))
                                |> Expect.equal (Just ( Just "Bob", Just "tablet" ))
                        ]
                        ()
            , test "delivery verbs are not E2EEGROUP records (inbound layer owns them)" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal Nothing
                                (parseLine ":Alice!alice@localhost E2EE.KEYPACKAGE #secure alice phone :AQIDBA")
                        , \_ ->
                            Expect.equal Nothing
                                (parseLine ":Alice!alice@localhost E2EE.COMMIT #secure alice phone :b3BhcXVl")
                        , \_ ->
                            Expect.equal Nothing
                                (parseLine ":Alice!alice@localhost E2EE.WELCOME #secure alice phone Bob tablet :d2VsY29tZQ")
                        ]
                        ()
            ]
        , describe "normalizeControlChannel / routing"
            [ test "normalizes channel case and rejects injection shapes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "#root") (normalizeControlChannel "  #Root  ")
                        , \_ -> Expect.equal Nothing (normalizeControlChannel "#root\r\nJOIN #bad")
                        , \_ -> Expect.equal Nothing (normalizeControlChannel "root")
                        , \_ -> Expect.equal Nothing (normalizeControlChannel "")
                        ]
                        ()
            , test "welcome requires targets; non-welcome rejects them" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just
                                    { channel = "&staff"
                                    , kind = Welcome
                                    , fromAccount = "alice"
                                    , fromDevice = "desktop"
                                    , toAccount = Just "Kain"
                                    , toDevice = Just "phone-2"
                                    }
                                )
                                (normalizeGroupControlRouting welcomeRoute)
                        , \_ ->
                            Expect.equal Nothing
                                (normalizeGroupControlRouting
                                    { channel = "#root"
                                    , kind = Commit
                                    , fromAccount = "Alice"
                                    , fromDevice = "phone"
                                    , toAccount = Just "x"
                                    , toDevice = Nothing
                                    }
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (normalizeGroupControlRouting
                                    { channel = "#root"
                                    , kind = Welcome
                                    , fromAccount = "Alice"
                                    , fromDevice = "phone"
                                    , toAccount = Nothing
                                    , toDevice = Nothing
                                    }
                                )
                        ]
                        ()
            ]
        , describe "buildGroupControlTranscript"
            [ test "binds domain, routing, version, epoch, body, signer in fixed order" <|
                \_ ->
                    case buildGroupControlTranscript commitRoute payloadVersion 7 sampleBody signerPub256 of
                        Just t ->
                            let
                                domain =
                                    Base64Url.utf8Bytes payloadDomain

                                account =
                                    Base64Url.utf8Bytes "alice"

                                channel =
                                    Base64Url.utf8Bytes "#root"

                                afterAccount =
                                    List.length domain + 2 + List.length account
                            in
                            Expect.all
                                [ \_ ->
                                    Expect.equal domain (List.take (List.length domain) t)
                                , \_ ->
                                    Expect.equal (Just 0) (getAtTest (List.length domain) t)
                                , \_ ->
                                    Expect.equal (Just (List.length account)) (getAtTest (List.length domain + 1) t)
                                , \_ ->
                                    Expect.equal account
                                        (List.take (List.length account)
                                            (List.drop (List.length domain + 2) t)
                                        )
                                , \_ ->
                                    Expect.equal (Just (List.length channel)) (getAtTest afterAccount t)
                                , \_ ->
                                    Expect.equal channel
                                        (List.take (List.length channel)
                                            (List.drop (afterAccount + 1) t)
                                        )
                                , \_ ->
                                    -- signer_pub is the last 32 bytes.
                                    Expect.equal signerPub256 (List.drop (List.length t - 32) t)
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected a transcript"
            , test "rejects empty/oversized body, bad epoch/version, bad signer" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal Nothing
                                (buildGroupControlTranscript commitRoute payloadVersion 1 [] signerPub256)
                        , \_ ->
                            Expect.equal Nothing
                                (buildGroupControlTranscript commitRoute
                                    payloadVersion
                                    1
                                    (List.repeat (maxGroupControlBodyBytes + 1) 0)
                                    signerPub256
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (buildGroupControlTranscript commitRoute 99 1 sampleBody signerPub256)
                        , \_ ->
                            Expect.equal Nothing
                                (buildGroupControlTranscript commitRoute payloadVersion -1 sampleBody signerPub256)
                        , \_ ->
                            Expect.equal Nothing
                                (buildGroupControlTranscript commitRoute payloadVersion 1 sampleBody (List.repeat 31 0))
                        , \_ -> Expect.equal True (validControlEpoch 0)
                        , \_ -> Expect.equal False (validControlEpoch -1)
                        ]
                        ()
            ]
        , describe "OGC1 parse / pack"
            [ test "pack/parse round-trips a v2 commit envelope" <|
                \_ ->
                    let
                        parts =
                            { version = payloadVersion
                            , kind = Commit
                            , epoch = 7
                            , body = sampleBody
                            , signerPub = signerPub256
                            , signature = List.repeat 64 0xCD
                            , diagnosticOnly = False
                            }
                    in
                    case packGroupControlPayload parts of
                        Just wire ->
                            case parseGroupControlPayload wire of
                                Just parsed ->
                                    Expect.all
                                        [ \p -> Expect.equal payloadVersion p.version
                                        , \p -> Expect.equal Commit p.kind
                                        , \p -> Expect.equal 7 p.epoch
                                        , \p -> Expect.equal sampleBody p.body
                                        , \p -> Expect.equal signerPub256 p.signerPub
                                        , \p -> Expect.equal (List.repeat 64 0xCD) p.signature
                                        , \p -> Expect.equal False p.diagnosticOnly
                                        ]
                                        parsed

                                Nothing ->
                                    Expect.fail "expected to parse packed payload"

                        Nothing ->
                            Expect.fail "expected to pack payload parts"
            , test "parses OGC1 v1 only as a diagnostic locked payload" <|
                \_ ->
                    let
                        body =
                            Base64Url.utf8Bytes "pub-material:v1"

                        raw =
                            Base64Url.utf8Bytes payloadMagic
                                ++ [ 1, 3 ]
                                ++ [ 0, 0, 0, 1 ]
                                ++ [ 0, List.length body ]
                                ++ body
                                ++ List.repeat 32 0
                                ++ List.repeat 64 0
                    in
                    case parseGroupControlPayload (Base64Url.encode raw) of
                        Just parsed ->
                            Expect.all
                                [ \p -> Expect.equal True p.diagnosticOnly
                                , \p -> Expect.equal 1 p.version
                                ]
                                parsed

                        Nothing ->
                            Expect.fail "expected a diagnostic v1 payload"
            , test "rejects bad magic, version, kind, and body bounds" <|
                \_ ->
                    let
                        body =
                            Base64Url.utf8Bytes "pub-material:ver"

                        envelope versionByte kindByte bodyLen rawBody =
                            Base64Url.encode
                                (Base64Url.utf8Bytes payloadMagic
                                    ++ [ versionByte, kindByte ]
                                    ++ [ 0, 0, 0, 1 ]
                                    ++ [ 0, bodyLen ]
                                    ++ rawBody
                                    ++ List.repeat 32 0
                                    ++ List.repeat 64 0
                                )
                    in
                    Expect.all
                        [ \_ ->
                            -- Flipped magic byte.
                            let
                                raw =
                                    0x00 :: List.drop 1 (Base64Url.utf8Bytes payloadMagic ++ List.repeat 104 0)
                            in
                            Expect.equal Nothing (parseGroupControlPayload (Base64Url.encode raw))
                        , \_ ->
                            Expect.equal Nothing
                                (parseGroupControlPayload (envelope 9 1 (List.length body) body))
                        , \_ ->
                            Expect.equal Nothing
                                (parseGroupControlPayload (envelope payloadVersion 0xFF (List.length body) body))
                        , \_ ->
                            Expect.equal Nothing
                                (parseGroupControlPayload
                                    (Base64Url.encode
                                        (Base64Url.utf8Bytes payloadMagic
                                            ++ [ 1, 3, 0, 0, 0, 0, 0, 0 ]
                                            ++ List.repeat 32 0
                                            ++ List.repeat 64 0
                                        )
                                    )
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (parseGroupControlPayload
                                    (envelope
                                        payloadVersion
                                        3
                                        (maxGroupControlBodyBytes + 1)
                                        (List.repeat (maxGroupControlBodyBytes + 1) 0)
                                    )
                                )
                        , \_ -> Expect.equal Nothing (parseGroupControlPayload "")
                        , \_ -> Expect.equal Nothing (parseGroupControlPayload "A")
                        ]
                        ()
            , test "pack rejects bad field sizes and versions" <|
                \_ ->
                    let
                        good =
                            { version = payloadVersion
                            , kind = Commit
                            , epoch = 1
                            , body = sampleBody
                            , signerPub = List.repeat 32 0
                            , signature = List.repeat 64 0
                            , diagnosticOnly = False
                            }
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (packGroupControlPayload { good | signerPub = List.repeat 31 0 })
                        , \_ -> Expect.equal Nothing (packGroupControlPayload { good | signature = List.repeat 63 0 })
                        , \_ -> Expect.equal Nothing (packGroupControlPayload { good | version = 99 })
                        , \_ -> Expect.equal Nothing (packGroupControlPayload { good | body = [] })
                        ]
                        ()
            ]
        , describe "inbound delivery records"
            [ test "contract key-package delivery parses unlocked" <|
                \_ ->
                    case parseDelivery (":Alice!alice@localhost E2EE.KEYPACKAGE #secure Alice phone :" ++ deliveryPayload KeyPackage) Nothing of
                        Nothing ->
                            Expect.fail "delivery rejected"

                        Just delivery ->
                            Expect.all
                                [ \_ -> Expect.equal "E2EE.KEYPACKAGE" delivery.command
                                , \_ -> Expect.equal "#secure" delivery.channel
                                , \_ -> Expect.equal KeyPackage delivery.kind
                                , \_ -> Expect.equal "alice" delivery.fromAccount
                                , \_ -> Expect.equal "phone" delivery.fromDevice
                                , \_ -> Expect.equal Nothing delivery.toAccount
                                , \_ -> Expect.equal (Just "Alice!alice@localhost") delivery.sourcePrefix
                                , \_ -> Expect.equal False delivery.locked
                                , \_ -> Expect.equal Nothing delivery.lockReason
                                ]
                                ()
            , test "contract commit delivery parses unlocked" <|
                \_ ->
                    case parseDelivery (":Alice!alice@localhost E2EE.COMMIT #secure alice phone :" ++ deliveryPayload Commit) Nothing of
                        Nothing ->
                            Expect.fail "delivery rejected"

                        Just delivery ->
                            Expect.all
                                [ \_ -> Expect.equal Commit delivery.kind
                                , \_ -> Expect.equal False delivery.locked
                                ]
                                ()
            , test "contract welcome delivery keeps targets" <|
                \_ ->
                    case parseDelivery (":Alice!alice@localhost E2EE.WELCOME #secure alice phone Bob tablet :" ++ deliveryPayload Welcome) Nothing of
                        Nothing ->
                            Expect.fail "delivery rejected"

                        Just delivery ->
                            Expect.all
                                [ \_ -> Expect.equal Welcome delivery.kind
                                , \_ -> Expect.equal (Just "Bob") delivery.toAccount
                                , \_ -> Expect.equal (Just "tablet") delivery.toDevice
                                , \_ -> Expect.equal False delivery.locked
                                ]
                                ()
            , test "tagged delivery line skips tags" <|
                \_ ->
                    case parseDelivery ("@msgid=1 :Alice!alice@localhost E2EE.COMMIT #secure alice phone :" ++ deliveryPayload Commit) Nothing of
                        Nothing ->
                            Expect.fail "delivery rejected"

                        Just delivery ->
                            Expect.equal False delivery.locked
            , test "delivery re-parses from a Wire message with an empty command" <|
                \_ ->
                    case parseDeliveryMessage (Wire.parseIrcMessage (":Alice!alice@localhost E2EE.COMMIT #secure alice phone :" ++ deliveryPayload Commit)) Nothing of
                        Nothing ->
                            Expect.fail "delivery rejected"

                        Just delivery ->
                            Expect.all
                                [ \_ -> Expect.equal "#secure" delivery.channel
                                , \_ -> Expect.equal "alice" delivery.fromAccount
                                , \_ -> Expect.equal False delivery.locked
                                ]
                                ()
            , test "legacy account-less shape locks with an explicit account" <|
                \_ ->
                    case parseDelivery (":Alice!alice@localhost E2EE.COMMIT #secure phone :" ++ deliveryPayload Commit) (Just "alice") of
                        Nothing ->
                            Expect.fail "delivery rejected"

                        Just delivery ->
                            Expect.all
                                [ \_ -> Expect.equal True delivery.locked
                                , \_ -> Expect.equal (Just MissingAccount) delivery.lockReason
                                , \_ -> Expect.equal "phone" delivery.fromDevice
                                ]
                                ()
            , test "legacy shape without an account is dropped" <|
                \_ ->
                    Expect.equal Nothing
                        (parseDelivery (":Alice!alice@localhost E2EE.COMMIT #secure phone :" ++ deliveryPayload Commit) Nothing)
            , test "canonical-but-opaque payload locks as bad payload" <|
                \_ ->
                    case parseDelivery ":Alice!alice@localhost E2EE.COMMIT #secure alice phone :AQIDBA" Nothing of
                        Nothing ->
                            Expect.fail "delivery rejected"

                        Just delivery ->
                            Expect.all
                                [ \_ -> Expect.equal True delivery.locked
                                , \_ -> Expect.equal (Just BadPayload) delivery.lockReason
                                ]
                                ()
            , test "legacy payload version locks as legacy" <|
                \_ ->
                    case parseDelivery (":Alice!alice@localhost E2EE.COMMIT #secure alice phone :" ++ deliveryPayloadLegacy) Nothing of
                        Nothing ->
                            Expect.fail "delivery rejected"

                        Just delivery ->
                            Expect.all
                                [ \_ -> Expect.equal True delivery.locked
                                , \_ -> Expect.equal (Just LegacyOgc1) delivery.lockReason
                                ]
                                ()
            , test "delivery rejections stay silent" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal Nothing
                                (parseDelivery ":s E2EE.COMMIT #secure alice phone :not+base64url" Nothing)
                        , \_ ->
                            Expect.equal Nothing
                                (parseDelivery (":s E2EE.COMMIT #secure alice :" ++ deliveryPayload Commit) Nothing)
                        , \_ ->
                            Expect.equal Nothing
                                (parseDelivery (":s E2EE.BOGUS #secure alice phone :" ++ deliveryPayload Commit) Nothing)
                        , \_ -> Expect.equal Nothing (parseDelivery "" Nothing)
                        , \_ ->
                            Expect.equal Nothing
                                (parseDelivery (":s E2EE.COMMIT #secure alice phone :" ++ deliveryPayload Commit ++ "\u{0000}") Nothing)
                        ]
                        ()
            , test "FAIL code matrix parses every contract code" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just FailNotLoggedIn) (parseE2eGroupFail "NOT_LOGGED_IN")
                        , \_ -> Expect.equal (Just FailCapRequired) (parseE2eGroupFail "CAP_REQUIRED")
                        , \_ -> Expect.equal (Just FailIrcxRequired) (parseE2eGroupFail "IRCX_REQUIRED")
                        , \_ -> Expect.equal (Just FailNotOnChannel) (parseE2eGroupFail "NOT_ON_CHANNEL")
                        , \_ -> Expect.equal (Just FailBadPayload) (parseE2eGroupFail "BAD_PAYLOAD")
                        , \_ -> Expect.equal (Just FailDeviceNotOwned) (parseE2eGroupFail "DEVICE_NOT_OWNED")
                        , \_ -> Expect.equal (Just FailTargetUnavailable) (parseE2eGroupFail "target_unavailable")
                        , \_ -> Expect.equal (Just FailSessionUnavailable) (parseE2eGroupFail "SESSION_UNAVAILABLE")
                        , \_ -> Expect.equal (Just FailTemporarilyUnavailable) (parseE2eGroupFail "TEMPORARILY_UNAVAILABLE")
                        , \_ -> Expect.equal Nothing (parseE2eGroupFail "BOGUS")
                        , \_ -> Expect.equal Nothing (parseE2eGroupFail "")
                        ]
                        ()
            , test "FAIL texts stay human-readable" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "the target device is unavailable" (e2eGroupFailText FailTargetUnavailable)
                        , \_ -> Expect.equal "no reusable E2EE session is available" (e2eGroupFailText FailSessionUnavailable)
                        ]
                        ()
            , test "install info extracts epoch and signer" <|
                \_ ->
                    Expect.equal
                        (Just { epoch = 1, signerB64 = Base64Url.encode (List.repeat 32 9) })
                        (installInfo (deliveryPayload Commit))
            , test "install info rejects legacy and garbage" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (installInfo deliveryPayloadLegacy)
                        , \_ -> Expect.equal Nothing (installInfo "AQIDBA")
                        , \_ -> Expect.equal Nothing (installInfo "")
                        ]
                        ()
            ]
        , describe "pairing"
            [ test "commit then welcome completes a pair" <|
                \_ ->
                    let
                        ( half, halfEvent ) =
                            bufferDelivery blankPairBuffer (pairable Commit (deliveryPayload Commit))

                        ( full, fullEvent ) =
                            bufferDelivery half (pairable Welcome (deliveryPayload Welcome))
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (isHalf halfEvent)
                        , \_ ->
                            Expect.equal True
                                (isReadyFor fullEvent [ welcomeTargetKey (Just "Bob") (Just "tablet") ])
                        , \_ -> Expect.equal 1 (Dict.size full.pairs)
                        ]
                        ()
            , test "welcome then commit readies every waiting target" <|
                \_ ->
                    let
                        ( w1, _ ) =
                            bufferDelivery blankPairBuffer (pairable Welcome (deliveryPayload Welcome))

                        ( w2, _ ) =
                            bufferDelivery w1 (pairableWelcome "carol" "desk" (deliveryPayloadAlt Welcome))

                        ( full, fullEvent ) =
                            bufferDelivery w2 (pairable Commit (deliveryPayload Commit))
                    in
                    Expect.all
                        [ \_ -> Expect.equal 1 (Dict.size full.pairs)
                        , \_ ->
                            Expect.equal True
                                (isReadyFor fullEvent
                                    [ welcomeTargetKey (Just "Bob") (Just "tablet")
                                    , welcomeTargetKey (Just "carol") (Just "desk")
                                    ]
                                )
                        ]
                        ()
            , test "retransmits coalesce" <|
                \_ ->
                    let
                        ( half, _ ) =
                            bufferDelivery blankPairBuffer (pairable Commit (deliveryPayload Commit))

                        ( _, dupEvent ) =
                            bufferDelivery half (pairable Commit (deliveryPayload Commit))
                    in
                    Expect.equal True (isDuplicate dupEvent)
            , test "conflicting payloads quarantine the pair" <|
                \_ ->
                    let
                        ( half, _ ) =
                            bufferDelivery blankPairBuffer (pairable Commit (deliveryPayload Commit))

                        ( quar, quarEvent ) =
                            bufferDelivery half (pairable Commit (deliveryPayloadAlt Commit))

                        ( _, afterEvent ) =
                            bufferDelivery quar (pairable Welcome (deliveryPayload Welcome))
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (isEquivocated quarEvent)
                        , \_ -> Expect.equal True (isEquivocated afterEvent)
                        , \_ ->
                            Expect.equal [ True ]
                                (List.map .quarantined (Dict.values quar.pairs))
                        , \_ ->
                            Expect.equal [ Nothing ]
                                (List.map .commit (Dict.values quar.pairs))
                        ]
                        ()
            , test "key-packages have no pair role" <|
                \_ ->
                    let
                        ( buffer, event ) =
                            bufferDelivery blankPairBuffer (pairable KeyPackage (deliveryPayload Commit))
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (isIgnored event)
                        , \_ -> Expect.equal 0 (Dict.size buffer.pairs)
                        ]
                        ()
            , test "a full buffer refuses new keys" <|
                \_ ->
                    let
                        fill n buf =
                            if n <= 0 then
                                buf

                            else
                                fill (n - 1)
                                    (Tuple.first
                                        (bufferDelivery buf
                                            { room = "#r" ++ String.fromInt n
                                            , kind = Commit
                                            , fromAccount = "alice"
                                            , fromDevice = "phone"
                                            , toAccount = Nothing
                                            , toDevice = Nothing
                                            , payload = deliveryPayload Commit
                                            , signerB64 = "s"
                                            , epoch = 1
                                            }
                                        )
                                    )

                        full =
                            fill maxHalfPairs blankPairBuffer

                        ( _, event ) =
                            bufferDelivery full
                                { room = "#overflow"
                                , kind = Commit
                                , fromAccount = "alice"
                                , fromDevice = "phone"
                                , toAccount = Nothing
                                , toDevice = Nothing
                                , payload = deliveryPayload Commit
                                , signerB64 = "s"
                                , epoch = 1
                                }
                    in
                    Expect.all
                        [ \_ -> Expect.equal maxHalfPairs (Dict.size full.pairs)
                        , \_ -> Expect.equal True (isFull event)
                        ]
                        ()
            ]
        ]


parseDelivery : String -> Maybe String -> Maybe Delivery
parseDelivery line account =
    parseDeliveryLine line account


deliveryParts : ControlKind -> Int -> PayloadParts
deliveryParts kind version =
    { version = version
    , kind = kind
    , epoch = 1
    , body = sampleBody
    , signerPub = List.repeat 32 9
    , signature = List.repeat 64 8
    , diagnosticOnly = False
    }


deliveryPayload : ControlKind -> String
deliveryPayload kind =
    case packGroupControlPayload (deliveryParts kind payloadVersion) of
        Just wire ->
            wire

        Nothing ->
            ""


deliveryPayloadLegacy : String
deliveryPayloadLegacy =
    case packGroupControlPayload (deliveryParts Commit payloadLegacyVersion) of
        Just wire ->
            wire

        Nothing ->
            ""


deliveryPayloadAlt : ControlKind -> String
deliveryPayloadAlt kind =
    let
        parts =
            deliveryParts kind payloadVersion
    in
    case packGroupControlPayload { parts | body = [ 9, 9, 9 ], signerPub = List.repeat 32 4 } of
        Just wire ->
            wire

        Nothing ->
            ""


pairable : ControlKind -> String -> Pairable
pairable kind payload =
    { room = "#secure"
    , kind = kind
    , fromAccount = "alice"
    , fromDevice = "phone"
    , toAccount =
        if kind == Welcome then
            Just "Bob"

        else
            Nothing
    , toDevice =
        if kind == Welcome then
            Just "tablet"

        else
            Nothing
    , payload = payload
    , signerB64 = "s"
    , epoch = 1
    }


pairableWelcome : String -> String -> String -> Pairable
pairableWelcome toAccount toDevice payload =
    let
        base =
            pairable Welcome payload
    in
    { base | toAccount = Just toAccount, toDevice = Just toDevice }


isHalf : PairEvent -> Bool
isHalf event =
    case event of
        PairHalf _ ->
            True

        _ ->
            False


isReadyFor : PairEvent -> List String -> Bool
isReadyFor event targets =
    case event of
        PairReady _ ready ->
            List.sort ready == List.sort targets

        _ ->
            False


isDuplicate : PairEvent -> Bool
isDuplicate event =
    case event of
        PairDuplicate _ ->
            True

        _ ->
            False


isEquivocated : PairEvent -> Bool
isEquivocated event =
    case event of
        PairEquivocated _ ->
            True

        _ ->
            False


isIgnored : PairEvent -> Bool
isIgnored event =
    case event of
        PairIgnored _ ->
            True

        _ ->
            False


isFull : PairEvent -> Bool
isFull event =
    case event of
        PairFull _ ->
            True

        _ ->
            False


getAtTest : Int -> List Int -> Maybe Int
getAtTest idx bytes =
    List.head (List.drop idx bytes)
