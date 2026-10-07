module GroupPublisherTest exposing (suite)

{-| Vectors for our ODD1 publication machine: account canonicalization,
the ADDED-confirm grammar, transient-vs-terminal failures, and the full
lifecycle (connect → register → account → project → ADD → retry → ack).
Oracle: `src/lib/e2ee/groupDevicePublisher.ts` (status/failure
taxonomy, two-send cap, generation invalidation, confirm/failure
observers, ADD wire shape).
-}

import Expect
import GroupDirectory
import GroupPublisher exposing (..)
import Test exposing (..)


goodDirectory : String
goodDirectory =
    case GroupDirectory.encodeEntry { signerPub = 1 :: List.repeat 31 0, encryptionPub = 4 :: List.repeat 64 7 } of
        Just wire ->
            wire

        Nothing ->
            ""


goodIdentity : Identity
goodIdentity =
    { deviceId = "ogc1-ABCDEFGHIJKLMNOPQRSTUV", directory = goodDirectory }


{-| Drive a fresh machine to `Sent` with the good identity. -}
toSent : State
toSent =
    let
        ( s1, _ ) =
            connected (blank "wss://example.test")

        ( s2, _ ) =
            registered s1

        ( s3, fx3 ) =
            setAccount (Just "Alice") s2

        ( s4, _ ) =
            case fx3 of
                [ RequestIdentity ] ->
                    identityProjected (Just goodIdentity) s3

                _ ->
                    ( s3, [] )
    in
    s4


suite : Test
suite =
    describe "GroupPublisher"
        [ describe "canonicalAccount"
            [ test "trims and lowercases" <|
                \_ -> Expect.equal (Just "alice@example") (canonicalAccount (Just "  Alice@Example "))
            , test "rejects bad characters" <|
                \_ -> Expect.equal Nothing (canonicalAccount (Just "ali ce!"))
            , test "rejects empty and overlong" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (canonicalAccount (Just "   "))
                        , \_ -> Expect.equal Nothing (canonicalAccount (Just (String.repeat 65 "a")))
                        , \_ -> Expect.equal Nothing (canonicalAccount Nothing)
                        ]
                        ()
            ]
        , describe "parseConfirm"
            [ test "accepts a well-formed ADDED body" <|
                \_ ->
                    Expect.equal
                        (Just { id = "dev1", alg = "onyx-ogc1-v1" })
                        (parseConfirm "E2EEKEY ADDED id=dev1 alg=onyx-ogc1-v1")
            , test "rejects DEVICE rows, wrong verbs, and bad tokens" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseConfirm "E2EEKEY DEVICE a=b c=d")
                        , \_ -> Expect.equal Nothing (parseConfirm "E2EEKEY ADDED id=dev 1 alg=x")
                        , \_ -> Expect.equal Nothing (parseConfirm "E2EEKEY ADDED id=dev1")
                        , \_ -> Expect.equal Nothing (parseConfirm "E2EEKEY REMOVED id=dev1 alg=x")
                        , \_ -> Expect.equal Nothing (parseConfirm "NOISE")
                        ]
                        ()
            ]
        , describe "isTransientFailure"
            [ test "matches the oracle transient set case-insensitively" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (isTransientFailure "store_failed")
                        , \_ -> Expect.equal True (isTransientFailure "DURABLE_UNAVAILABLE")
                        , \_ -> Expect.equal True (isTransientFailure "temporarily_unavailable")
                        , \_ -> Expect.equal False (isTransientFailure "DEVICE_REVOKED")
                        , \_ -> Expect.equal False (isTransientFailure "")
                        ]
                        ()
            ]
        , describe "lifecycle"
            [ test "needs connected + registered + account before projecting" <|
                \_ ->
                    let
                        ( s1, fx1 ) =
                            connected (blank "wss://example.test")

                        ( s2, fx2 ) =
                            registered s1
                    in
                    Expect.all
                        [ \_ -> Expect.equal ( [], Inactive ) ( fx1, s1.status )
                        , \_ -> Expect.equal ( [], Inactive ) ( fx2, s2.status )
                        ]
                        ()
            , test "account arrival requests the ports identity" <|
                \_ ->
                    let
                        ( s1, _ ) =
                            connected (blank "wss://example.test")

                        ( s2, _ ) =
                            registered s1

                        ( s3, fx3 ) =
                            setAccount (Just "Alice") s2
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "alice") s3.account
                        , \_ -> Expect.equal Projecting s3.status
                        , \_ -> Expect.equal [ RequestIdentity ] fx3
                        ]
                        ()
            , test "missing projection fails without sending" <|
                \_ ->
                    let
                        ( s1, _ ) =
                            connected (blank "wss://example.test")

                        ( s2, _ ) =
                            registered s1

                        ( s3, _ ) =
                            setAccount (Just "alice") s2

                        ( s4, fx4 ) =
                            identityProjected Nothing s3
                    in
                    Expect.all
                        [ \_ -> Expect.equal Inactive s4.status
                        , \_ -> Expect.equal (Just ProjectionUnavailable) s4.failure
                        , \_ -> Expect.equal [] fx4
                        ]
                        ()
            , test "mangled directory or id fails verification" <|
                \_ ->
                    let
                        ( s1, _ ) =
                            connected (blank "wss://example.test")

                        ( s2, _ ) =
                            registered s1

                        ( s3, _ ) =
                            setAccount (Just "alice") s2

                        ( badDir, _ ) =
                            identityProjected (Just { goodIdentity | directory = goodDirectory ++ "A" }) s3

                        ( s5, _ ) =
                            setAccount (Just "alice") badDir

                        ( badId, _ ) =
                            identityProjected (Just { goodIdentity | deviceId = "nope" }) s5
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just ProjectionUnavailable) badDir.failure
                        , \_ -> Expect.equal (Just ProjectionUnavailable) badId.failure
                        ]
                        ()
            , test "verified identity sends once and schedules the retry" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Sent toSent.status
                        , \_ -> Expect.equal 1 toSent.attempts
                        , \_ -> Expect.equal (Just "ogc1-ABCDEFGHIJKLMNOPQRSTUV") toSent.deviceId
                        ]
                        ()
            , test "retry resends exactly once, then a late timer is silent" <|
                \_ ->
                    let
                        ( s5, fx5 ) =
                            retryDue toSent

                        ( s6, fx6 ) =
                            retryDue s5
                    in
                    Expect.all
                        [ \_ -> Expect.equal 2 s5.attempts
                        , \_ ->
                            Expect.equal
                                [ Publish { deviceId = "ogc1-ABCDEFGHIJKLMNOPQRSTUV", directory = goodDirectory } ]
                                fx5
                        , \_ -> Expect.equal ( [], 2 ) ( fx6, s6.attempts )
                        ]
                        ()
            , test "ADDED confirm for the pending id acks; strangers do not" <|
                \_ ->
                    let
                        ( kept, acked ) =
                            trustedBody "E2EEKEY ADDED id=ogc1-ABCDEFGHIJKLMNOPQRSTUV alg=onyx-ogc1-v1" toSent

                        ( strange, strangeAck ) =
                            trustedBody "E2EEKEY ADDED id=ogc1-XXXXXXXXXXXXXXXXXXXXXX alg=onyx-ogc1-v1" toSent

                        ( late, lateFx ) =
                            retryDue kept
                    in
                    Expect.all
                        [ \_ -> Expect.equal ( True, ServerAckObserved ) ( acked, kept.status )
                        , \_ -> Expect.equal ( False, Sent ) ( strangeAck, strange.status )
                        , \_ -> Expect.equal ( [], ServerAckObserved ) ( lateFx, late.status )
                        ]
                        ()
            , test "transient failure re-arms one retry; terminal latches reject" <|
                \_ ->
                    let
                        ( s5, fx5 ) =
                            trustedFailure "STORE_FAILED" toSent

                        ( s6, fx6 ) =
                            retryDue s5

                        ( s7, fx7 ) =
                            trustedFailure "DEVICE_REVOKED" toSent

                        ( s8, fx8 ) =
                            setAccount (Just "alice") s7
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just ServerTransient) s5.failure
                        , \_ -> Expect.equal [ ScheduleRetry ] fx5
                        , \_ -> Expect.equal ( Sent, 2 ) ( s6.status, s6.attempts )
                        , \_ ->
                            Expect.equal
                                [ Publish { deviceId = "ogc1-ABCDEFGHIJKLMNOPQRSTUV", directory = goodDirectory } ]
                                fx6
                        , \_ -> Expect.equal (Just ServerRejected) s7.failure
                        , \_ -> Expect.equal Nothing s7.deviceId
                        , \_ -> Expect.equal ( [], Inactive ) ( fx8, s8.status )
                        ]
                        ()
            , test "account change invalidates and restarts" <|
                \_ ->
                    let
                        ( s5, fx5 ) =
                            setAccount (Just "bob") toSent
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "bob") s5.account
                        , \_ -> Expect.equal Nothing s5.deviceId
                        , \_ -> Expect.equal 0 s5.attempts
                        , \_ -> Expect.equal [ RequestIdentity ] fx5
                        ]
                        ()
            , test "disconnect invalidates; the retry timer goes silent" <|
                \_ ->
                    let
                        gone =
                            disconnected toSent

                        ( s5, fx5 ) =
                            retryDue gone
                    in
                    Expect.all
                        [ \_ -> Expect.equal Inactive gone.status
                        , \_ -> Expect.equal ( [], Inactive ) ( fx5, s5.status )
                        ]
                        ()
            , test "publishLine builds the ADD wire form" <|
                \_ ->
                    Expect.equal
                        ("E2EEKEY ADD ogc1-ABCDEFGHIJKLMNOPQRSTUV onyx-ogc1-v1 " ++ goodDirectory)
                        (publishLine { deviceId = "ogc1-ABCDEFGHIJKLMNOPQRSTUV", directory = goodDirectory })
            ]
        ]
