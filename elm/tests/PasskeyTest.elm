module PasskeyTest exposing (suite)

{-| WebAuthn passkeys: fail-closed challenge/rpId/credential validation,
ceremony builders, and the WEBAUTHN reply fold (context-gated success
codes, FAIL/WARN clearing, LIST accumulation, AUTH settle). Oracles
`lib/webauthn/passkey.ts` and the `store.ts` WEBAUTHN fold.
-}

import Expect
import Passkey exposing (..)
import Test exposing (Test, describe, test)
import Wire


chal16 : String
chal16 =
    "AAAAAAAAAAAAAAAAAAAAAA"


reply : Wire.StandardReplyKind -> String -> List String -> String -> Wire.StandardReply
reply kind code context description =
    { kind = kind, command = "WEBAUTHN", code = code, context = context, description = description }


fold : PasskeySession -> Wire.StandardReply -> ( PasskeySession, PasskeyEffect )
fold =
    foldPasskeyReply


suite : Test
suite =
    describe "Passkey"
        [ describe "validation"
            [ test "challenges need 16 strict-base64url bytes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (validateChallenge chal16 /= Nothing)
                        , \_ -> Expect.equal Nothing (validateChallenge "AAAAAAAAAAAAAAA")
                        , \_ -> Expect.equal Nothing (validateChallenge "!!!")
                        , \_ -> Expect.equal Nothing (validateChallenge "")
                        ]
                        ()
            , test "rp ids are non-empty host labels" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "irc.example") (validateRpId "irc.example")
                        , \_ -> Expect.equal Nothing (validateRpId "")
                        , \_ -> Expect.equal Nothing (validateRpId "has space")
                        ]
                        ()
            , test "credential ids are bounded base64url" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "QUJD") (validateCredentialId "QUJD")
                        , \_ -> Expect.equal Nothing (validateCredentialId "")
                        , \_ -> Expect.equal Nothing (validateCredentialId (String.repeat 1365 "A"))
                        , \_ -> Expect.equal Nothing (validateCredentialId "not valid!")
                        ]
                        ()
            , test "create args bind challenge rp and account" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal True
                                (validateCreateArgs { challenge = chal16, rpId = "irc.example", account = "alice" } /= Nothing)
                        , \_ ->
                            Expect.equal Nothing
                                (validateCreateArgs { challenge = chal16, rpId = "irc.example", account = "" })
                        , \_ ->
                            Expect.equal Nothing
                                (validateCreateArgs { challenge = "short", rpId = "irc.example", account = "alice" })
                        ]
                        ()
            , test "get args fail on one malformed allow-cred" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal True
                                (validateGetArgs { challenge = chal16, rpId = "irc.example", allowCreds = [ "QUJD" ] } /= Nothing)
                        , \_ ->
                            Expect.equal
                                Nothing
                                (validateGetArgs { challenge = chal16, rpId = "irc.example", allowCreds = [ "QUJD", "!!" ] })
                        , \_ ->
                            Expect.equal True
                                (validateGetArgs { challenge = chal16, rpId = "irc.example", allowCreds = [] } /= Nothing)
                        ]
                        ()
            , test "ceremony uses ES256 and EdDSA" <|
                \_ ->
                    Expect.equal [ -7, -8 ] credentialAlgs
            ]
        , describe "builders"
            [ test "REGISTER takes an optional label" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "WEBAUTHN REGISTER\r\n" (webauthnRegister Nothing)
                        , \_ -> Expect.equal "WEBAUTHN REGISTER desk\r\n" (webauthnRegister (Just "desk"))
                        , \_ -> Expect.equal "WEBAUTHN REGISTER\r\n" (webauthnRegister (Just "   "))
                        ]
                        ()
            , test "AUTH LIST REMOVE RENAME shape their targets" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "WEBAUTHN AUTH alice\r\n") (webauthnAuth "alice")
                        , \_ -> Expect.equal "WEBAUTHN LIST\r\n" webauthnList
                        , \_ -> Expect.equal (Just "WEBAUTHN REMOVE QUJD\r\n") (webauthnRemove "QUJD")
                        , \_ -> Expect.equal (Just "WEBAUTHN RENAME QUJD desk\r\n") (webauthnRename "QUJD" "desk")
                        , \_ -> Expect.equal Nothing (webauthnRename "QUJD" "")
                        ]
                        ()
            , test "FINISH lines carry validated fields" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just "WEBAUTHN REGISTER-FINISH QUJD Q0Q Q0Q\r\n")
                                (webauthnRegisterFinish "QUJD" "Q0Q" "Q0Q")
                        , \_ ->
                            Expect.equal
                                (Just "WEBAUTHN AUTH-FINISH QUJD Q0Q Q0Q U0U\r\n")
                                (webauthnAuthFinish "QUJD" "Q0Q" "Q0Q" "U0U")
                        , \_ -> Expect.equal Nothing (webauthnRegisterFinish "!!" "Q0Q" "Q0Q")
                        ]
                        ()
            ]
        , describe "reply fold"
            [ test "REGISTER-CHALLENGE needs the register action" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal ( blankPasskeySession, NoEffect )
                                (fold blankPasskeySession
                                    (reply Wire.Note "REGISTER-CHALLENGE" [ chal16, "irc.example" ] "alice")
                                )
                        , \_ ->
                            case
                                fold { blankPasskeySession | lastAction = Just ActionRegister }
                                    (reply Wire.Note "REGISTER-CHALLENGE" [ chal16, "irc.example" ] "alice")
                            of
                                ( _, RunCreateCeremony args ) ->
                                    Expect.equal "irc.example" args.rpId

                                _ ->
                                    Expect.fail "expected RunCreateCeremony"
                        , \_ ->
                            case
                                fold { blankPasskeySession | lastAction = Just ActionRegister }
                                    (reply Wire.Note "REGISTER-CHALLENGE" [ "short", "irc.example" ] "alice")
                            of
                                ( session, ReportError _ ) ->
                                    Expect.equal (Just "Malformed passkey challenge.") session.error

                                _ ->
                                    Expect.fail "expected ReportError"
                        ]
                        ()
            , test "REGISTERED notices and refreshes the list" <|
                \_ ->
                    case
                        fold { blankPasskeySession | lastAction = Just ActionRegister, busy = True }
                            (reply Wire.Note "REGISTERED" [] "desk")
                    of
                        ( session, SendLine line ) ->
                            Expect.all
                                [ \_ -> Expect.equal "WEBAUTHN LIST\r\n" line
                                , \_ -> Expect.equal (Just "Passkey added (desk)") session.notice
                                , \_ -> Expect.equal (Just True) session.supported
                                ]
                                ()

                        _ ->
                            Expect.fail "expected SendLine"
            , test "CRED rows accumulate bounded and deduped until LIST" <|
                \_ ->
                    let
                        listing =
                            beginList blankPasskeySession

                        step session code context description =
                            Tuple.first (fold session (reply Wire.Note code context description))

                        withRows =
                            listing
                                |> (\s -> step s "CRED" [ "QUJD", "3" ] "desk")
                                |> (\s -> step s "CRED" [ "QUJD", "4" ] "desk")
                                |> (\s -> step s "CRED" [ "!!", "1" ] "bad")

                        ( committed, _ ) =
                            fold withRows (reply Wire.Note "LIST" [] "end (1)")
                    in
                    Expect.all
                        [ \_ -> Expect.equal 1 (List.length committed.creds)
                        , \_ -> Expect.equal (Just 3) (Maybe.map .signCount (List.head committed.creds))
                        , \_ -> Expect.equal (Just "desk") (Maybe.map .label (List.head committed.creds))
                        , \_ -> Expect.equal (Just True) committed.supported
                        ]
                        ()
            , test "CRED without a pending list is ignored" <|
                \_ ->
                    Expect.equal ( blankPasskeySession, NoEffect )
                        (fold blankPasskeySession (reply Wire.Note "CRED" [ "QUJD", "1" ] "desk"))
            , test "REMOVED drops by id or label" <|
                \_ ->
                    let
                        session =
                            { blankPasskeySession
                                | lastAction = Just ActionRemove
                                , creds = [ { id = "QUJD", label = "desk", signCount = 1, createdAt = Nothing } ]
                            }

                        ( next, _ ) =
                            fold session (reply Wire.Note "REMOVED" [] "desk")
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] next.creds
                        , \_ -> Expect.equal (Just "Passkey removed") next.notice
                        ]
                        ()
            , test "RENAMED patches the matching row" <|
                \_ ->
                    let
                        session =
                            { blankPasskeySession
                                | lastAction = Just ActionRename
                                , creds = [ { id = "QUJD", label = "old", signCount = 1, createdAt = Nothing } ]
                            }

                        ( next, _ ) =
                            fold session (reply Wire.Note "RENAMED" [ "QUJD" ] "new")
                    in
                    Expect.equal (Just "new") (Maybe.map .label (List.head next.creds))
            , test "STATUS marks the feature supported" <|
                \_ ->
                    Expect.equal (Just True)
                        (.supported (Tuple.first (fold blankPasskeySession (reply Wire.Note "STATUS" [] ""))))
            , test "AUTH collects allow-creds and settles" <|
                \_ ->
                    let
                        ( challenged, _ ) =
                            fold blankPasskeySession
                                (reply Wire.Note "AUTH-CHALLENGE" [ chal16, "irc.example" ] "")

                        ( withCred, _ ) =
                            fold challenged (reply Wire.Note "ALLOW-CRED" [] "QUJD")

                        ( settled, effect ) =
                            settleAuth withCred
                    in
                    Expect.all
                        [ \_ ->
                            case effect of
                                RunGetCeremony args ->
                                    Expect.equal "irc.example" args.rpId

                                _ ->
                                    Expect.fail "expected RunGetCeremony"
                        , \_ -> Expect.equal True (settled.pendingAuth /= Nothing)
                        ]
                        ()
            , test "malformed allow-creds fail the ceremony at settle" <|
                \_ ->
                    let
                        ( challenged, _ ) =
                            fold blankPasskeySession
                                (reply Wire.Note "AUTH-CHALLENGE" [ chal16, "irc.example" ] "")

                        ( withBad, _ ) =
                            fold challenged (reply Wire.Note "ALLOW-CRED" [] "!!")

                        ( _, effect ) =
                            settleAuth withBad
                    in
                    Expect.equal (ReportError "Malformed passkey challenge.") effect
            , test "FAIL clears busy and records the error" <|
                \_ ->
                    let
                        ( session, effect ) =
                            fold { blankPasskeySession | busy = True, lastAction = Just ActionRegister }
                                (reply Wire.Fail "BAD_REQUEST" [] "bad request")
                    in
                    Expect.all
                        [ \_ -> Expect.equal False session.busy
                        , \_ -> Expect.equal (Just "bad request") session.error
                        , \_ -> Expect.equal (ReportError "bad request") effect
                        ]
                        ()
            , test "rename INVALID_SUBCOMMAND disables the affordance" <|
                \_ ->
                    let
                        ( session, _ ) =
                            fold { blankPasskeySession | lastAction = Just ActionRename }
                                (reply Wire.Fail "INVALID_SUBCOMMAND" [] "")
                    in
                    Expect.all
                        [ \_ -> Expect.equal True session.renameUnsupported
                        , \_ -> Expect.equal (Just "This server does not support renaming passkeys yet.") session.error
                        ]
                        ()
            , test "TEMPORARILY_UNAVAILABLE resolves support to false" <|
                \_ ->
                    Expect.equal (Just False)
                        (.supported
                            (Tuple.first
                                (fold (beginList blankPasskeySession)
                                    (reply Wire.Fail "TEMPORARILY_UNAVAILABLE" [] "off")
                                )
                            )
                        )
            , test "stray FAIL with nothing in flight is ignored" <|
                \_ ->
                    let
                        ( session, effect ) =
                            fold blankPasskeySession
                                (reply Wire.Fail "BAD_REQUEST" [] "bad request")
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing session.error
                        , \_ -> Expect.equal NoEffect effect
                        ]
                        ()
            ]
        ]
