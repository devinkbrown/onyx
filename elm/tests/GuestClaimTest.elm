module GuestClaimTest exposing (suite)

{-| Vectors for the guest claim flow, mirroring
`src/shell/GuestClaimPrompt.tsx` (chip visibility, verbatim submit
validation, REGISTER → VERIFY → IDENTIFY chaining, busy guards,
sign-in/close resets) and the `registerAccount` / `verifyAccount`
store actions (bare-command `SUCCESS` / `VERIFICATION_REQUIRED`
folds, terminal `FAIL` folds, live-context gating).
-}

import App exposing (..)
import Expect
import Json.Decode as Decode
import Test exposing (Test, describe, test)


guest : Model
guest =
    { blank | ourNick = "kai", endpoint = Just "wss://irc.example" }


withPassword : Model -> Model
withPassword model =
    { model | guestClaimPassword = "s3cret-long" }


submitted : Model
submitted =
    Tuple.first (update GuestClaimSubmit (withPassword guest))


suite : Test
suite =
    describe "guest claim"
        [ describe "guestClaimVisible"
            [ test "guest with a nick shows the chip" <|
                \_ ->
                    Expect.equal True (guestClaimVisible guest)
            , test "authed account hides the chip" <|
                \_ ->
                    Expect.equal False (guestClaimVisible { guest | accountName = Just "kai" })
            , test "dismissed chip stays hidden" <|
                \_ ->
                    Expect.equal False (guestClaimVisible { guest | guestClaimDismissed = True })
            , test "blank nick hides the chip" <|
                \_ ->
                    Expect.equal False (guestClaimVisible { guest | ourNick = "  " })
            ]
        , describe "submitGuestClaim"
            [ test "empty nick asks for a name" <|
                \_ ->
                    let
                        ( failed, out ) =
                            update GuestClaimSubmit (withPassword { guest | ourNick = "" })
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal (Just "You need a name on this connection before claiming.") failed.guestClaimError
                        ]
                        ()
            , test "empty password asks for one" <|
                \_ ->
                    let
                        ( failed, out ) =
                            update GuestClaimSubmit guest
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal (Just "Choose a password to protect the account.") failed.guestClaimError
                        ]
                        ()
            , test "short password names the minimum" <|
                \_ ->
                    let
                        ( failed, _ ) =
                            update GuestClaimSubmit { guest | guestClaimPassword = "short" }
                    in
                    Expect.equal (Just "Use at least 8 characters.") failed.guestClaimError
            , test "offline asks for reconnect" <|
                \_ ->
                    let
                        ( failed, out ) =
                            update GuestClaimSubmit (withPassword { guest | connection = Offline })
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal (Just "Reconnect required — the connection was lost before registration could start.") failed.guestClaimError
                        ]
                        ()
            , test "valid submit sends REGISTER with * email" <|
                \_ ->
                    let
                        ( _, out ) =
                            update GuestClaimSubmit (withPassword guest)
                    in
                    Expect.all
                        [ \m -> Expect.equal ClaimRegistering m.guestClaimPhase
                        , \m -> Expect.equal True m.registerPending
                        , \m -> Expect.equal (Just "kai") m.registerReplyAccount
                        , \m -> Expect.equal "kai" m.guestClaimNick
                        , \m -> Expect.equal "s3cret-long" m.guestClaimPasswordHeld
                        , \_ -> Expect.equal [ SendLine "REGISTER kai * s3cret-long\r\n" ] out
                        ]
                        submitted
            , test "trimmed email rides along" <|
                \_ ->
                    let
                        keyed =
                            withPassword guest

                        mailed =
                            { keyed | guestClaimEmail = "  a@x.li " }

                        ( _, out ) =
                            update GuestClaimSubmit mailed
                    in
                    Expect.equal [ SendLine "REGISTER kai a@x.li s3cret-long\r\n" ] out
            , test "busy submit is a no-op" <|
                \_ ->
                    let
                        ( again, out ) =
                            update GuestClaimSubmit submitted
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal ClaimRegistering again.guestClaimPhase
                        ]
                        ()
            ]
        , describe "REGISTER replies"
            [ test "SUCCESS chains IDENTIFY once" <|
                \_ ->
                    let
                        ( chained, out ) =
                            feedOut submitted ":irc.example REGISTER SUCCESS kai :Account registered"
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ SendLine "IDENTIFY kai s3cret-long\r\n" ] out
                        , \m -> Expect.equal ClaimIdentifying m.guestClaimPhase
                        , \m -> Expect.equal True m.guestClaimIdentifyIssued
                        , \m -> Expect.equal False m.registerPending
                        , \m -> Expect.equal Nothing m.registerReplyAccount
                        , \m -> Expect.equal (Just "kai") m.identifyReplyAccount
                        ]
                        chained
            , test "VERIFICATION_REQUIRED promotes to verifying" <|
                \_ ->
                    let
                        promoted =
                            feed submitted ":irc.example REGISTER VERIFICATION_REQUIRED kai"
                    in
                    Expect.all
                        [ \m -> Expect.equal ClaimVerifying m.guestClaimPhase
                        , \m -> Expect.equal True m.verifyRequired
                        , \m -> Expect.equal False m.registerPending
                        , \m -> Expect.equal Nothing m.registerReplyAccount
                        ]
                        promoted
            , test "FAIL REGISTER records the description and idles" <|
                \_ ->
                    let
                        failed =
                            feed submitted ":s FAIL REGISTER TAKEN :that name is taken"
                    in
                    Expect.all
                        [ \m -> Expect.equal False m.registerPending
                        , \m -> Expect.equal (Just "that name is taken") m.registerError
                        , \m -> Expect.equal False m.verifyRequired
                        , \m -> Expect.equal Nothing m.registerReplyAccount
                        , \m -> Expect.equal ClaimIdle m.guestClaimPhase
                        ]
                        failed
            , test "FAIL code without description falls back to the code" <|
                \_ ->
                    Expect.equal
                        (Just "TAKEN")
                        (feed submitted ":s FAIL REGISTER TAKEN").registerError
            , test "stray FAIL without a live attempt is silent" <|
                \_ ->
                    let
                        stray =
                            feed guest ":s FAIL REGISTER TAKEN :that name is taken"
                    in
                    Expect.all
                        [ \m -> Expect.equal False m.registerPending
                        , \m -> Expect.equal Nothing m.registerError
                        ]
                        stray
            , test "stray command without context is not consumed" <|
                \_ ->
                    let
                        ( untouched, out ) =
                            feedOut guest ":irc.example REGISTER SUCCESS kai :Account registered"
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \m -> Expect.equal False m.registerPending
                        ]
                        untouched
            ]
        , describe "VERIFY leg"
            [ test "submit sends VERIFY for the captured nick" <|
                \_ ->
                    let
                        promoted =
                            feed submitted ":irc.example REGISTER VERIFICATION_REQUIRED kai"

                        keyed =
                            { promoted | guestClaimVerifyCode = "482910" }

                        ( _, out ) =
                            update GuestClaimVerifySubmit keyed
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ SendLine "VERIFY kai 482910\r\n" ] out
                        , \m -> Expect.equal True m.registerPending
                        , \m -> Expect.equal (Just "kai") m.verifyReplyAccount
                        ]
                        (Tuple.first (update GuestClaimVerifySubmit keyed))
            , test "empty code asks for one" <|
                \_ ->
                    let
                        promoted =
                            feed submitted ":irc.example REGISTER VERIFICATION_REQUIRED kai"

                        ( failed, out ) =
                            update GuestClaimVerifySubmit promoted
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal (Just "Enter the verification code from your email.") failed.guestClaimError
                        ]
                        ()
            , test "VERIFY SUCCESS chains IDENTIFY" <|
                \_ ->
                    let
                        promoted =
                            feed submitted ":irc.example REGISTER VERIFICATION_REQUIRED kai"

                        keyed =
                            { promoted | guestClaimVerifyCode = "482910" }

                        ( sent, _ ) =
                            update GuestClaimVerifySubmit keyed

                        ( chained, out ) =
                            feedOut sent ":irc.example VERIFY SUCCESS kai"
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ SendLine "IDENTIFY kai s3cret-long\r\n" ] out
                        , \m -> Expect.equal ClaimIdentifying m.guestClaimPhase
                        ]
                        chained
            , test "FAIL VERIFY records and idles" <|
                \_ ->
                    let
                        promoted =
                            feed submitted ":irc.example REGISTER VERIFICATION_REQUIRED kai"

                        keyed =
                            { promoted | guestClaimVerifyCode = "482910" }

                        ( sent, _ ) =
                            update GuestClaimVerifySubmit keyed

                        failed =
                            feed sent ":s FAIL VERIFY BADCODE :wrong code"
                    in
                    Expect.all
                        [ \m -> Expect.equal (Just "wrong code") m.registerError
                        , \m -> Expect.equal ClaimIdle m.guestClaimPhase
                        , \m -> Expect.equal Nothing m.verifyReplyAccount
                        ]
                        failed
            ]
        , describe "IDENTIFY tail"
            [ test "FAIL IDENTIFY drops the claim to idle but keeps the verdict" <|
                \_ ->
                    let
                        ( chained, _ ) =
                            feedOut submitted ":irc.example REGISTER SUCCESS kai :Account registered"

                        failed =
                            feed chained ":s FAIL IDENTIFY BADPASS :bad password"
                    in
                    Expect.all
                        [ \m -> Expect.equal ClaimIdle m.guestClaimPhase
                        , \m -> Expect.equal False m.guestClaimIdentifyIssued
                        , \m -> Expect.equal (Just "bad password") (Maybe.map .description m.accountActionError)
                        ]
                        failed
            , test "900 closes the sheet and forgets credentials" <|
                \_ ->
                    let
                        opened =
                            { submitted | guestClaimOpen = True }

                        logged =
                            feed opened ":s 900 me nick!u@h kai :You are now logged in as kai"
                    in
                    Expect.all
                        [ \m -> Expect.equal False m.guestClaimOpen
                        , \m -> Expect.equal ClaimIdle m.guestClaimPhase
                        , \m -> Expect.equal "" m.guestClaimPasswordHeld
                        , \m -> Expect.equal "" m.guestClaimPassword
                        , \m -> Expect.equal (Just "kai") m.accountName
                        ]
                        logged
            , test "WsClosed resets the claim" <|
                \_ ->
                    let
                        opened =
                            { submitted | guestClaimOpen = True }

                        ( closed, _ ) =
                            update (WsClosed { clean = True, reason = "lost" }) opened
                    in
                    Expect.all
                        [ \m -> Expect.equal False m.guestClaimOpen
                        , \m -> Expect.equal ClaimIdle m.guestClaimPhase
                        , \m -> Expect.equal "" m.guestClaimPasswordHeld
                        , \m -> Expect.equal False m.registerPending
                        , \m -> Expect.equal Nothing m.registerReplyAccount
                        ]
                        closed
            ]
        , describe "sheet chrome"
            [ test "open requires a visible chip" <|
                \_ ->
                    let
                        ( shut, _ ) =
                            update GuestClaimOpen { guest | accountName = Just "kai" }

                        ( opened, _ ) =
                            update GuestClaimOpen guest
                    in
                    Expect.all
                        [ \_ -> Expect.equal False shut.guestClaimOpen
                        , \_ -> Expect.equal True opened.guestClaimOpen
                        ]
                        ()
            , test "busy close is refused" <|
                \_ ->
                    let
                        opened =
                            { submitted | guestClaimOpen = True }

                        ( kept, _ ) =
                            update GuestClaimClose opened
                    in
                    Expect.equal True kept.guestClaimOpen
            , test "idle close keeps drafts" <|
                \_ ->
                    let
                        opened =
                            { guest | guestClaimOpen = True, guestClaimEmail = "a@x.li" }

                        ( closed, _ ) =
                            update GuestClaimClose opened
                    in
                    Expect.all
                        [ \m -> Expect.equal False m.guestClaimOpen
                        , \m -> Expect.equal "a@x.li" m.guestClaimEmail
                        ]
                        closed
            , test "dismiss persists per owner" <|
                \_ ->
                    let
                        ( dismissed, out ) =
                            update GuestClaimDismiss guest
                    in
                    Expect.all
                        [ \m -> Expect.equal True m.guestClaimDismissed
                        , \_ ->
                            Expect.equal
                                [ GuestClaimDismissSave { serverUrl = "wss://irc.example", identity = "kai" } ]
                                out
                        ]
                        dismissed
            , test "dismiss without an owner saves nothing" <|
                \_ ->
                    let
                        ownerless =
                            { guest | endpoint = Nothing }

                        ( _, out ) =
                            update GuestClaimDismiss ownerless
                    in
                    Expect.equal [] out
            , test "loaded dismissal applies only when true" <|
                \_ ->
                    let
                        ( yes, _ ) =
                            update (GuestClaimDismissLoaded (mustValue True)) guest

                        ( no, _ ) =
                            update (GuestClaimDismissLoaded (mustValue False)) guest
                    in
                    Expect.all
                        [ \_ -> Expect.equal True yes.guestClaimDismissed
                        , \_ -> Expect.equal False no.guestClaimDismissed
                        ]
                        ()
            ]
        ]


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


feedOut : Model -> String -> ( Model, List Outbound )
feedOut model line =
    update (WsLineReceived line) model


mustValue : Bool -> Decode.Value
mustValue flag =
    case Decode.decodeString Decode.value (if flag then "true" else "false") of
        Ok value ->
            value

        Err _ ->
            Debug.todo "bool must decode"
