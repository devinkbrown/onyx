module RecoveryCodesTest exposing (suite)

{-| Vectors ported from `src/lib/irc/recoveryCodes.test.ts`. -}

import Expect
import RecoveryCodes exposing (..)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "RecoveryCodes"
        [ test "parses status counts" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just { remaining = 0 }) (parseRecoveryCodesStatus "RECOVERYCODES: 0 unused codes")
                    , \_ -> Expect.equal (Just { remaining = 1 }) (parseRecoveryCodesStatus "RECOVERYCODES: 1 unused code")
                    , \_ -> Expect.equal (Just { remaining = 10 }) (parseRecoveryCodesStatus "RECOVERYCODES: 10 unused codes")
                    , \_ -> Expect.equal Nothing (parseRecoveryCodesStatus "nope")
                    , \_ -> Expect.equal Nothing (parseRecoveryCodesStatus "RECOVERYCODES: 3unused codes")
                    ]
                    ()
        , test "parses dashed code lines, rejecting ambiguous I" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal (Just { index = 3, code = "ABCDE-FGHJK" })
                            (parseRecoveryCodeLine "RECOVERYCODES: 3. ABCDE-FGHJK")
                    , \_ -> Expect.equal Nothing (parseRecoveryCodeLine "RECOVERYCODES: 3. ABCDE-FGHIJ")
                    , \_ -> Expect.equal Nothing (parseRecoveryCodeLine "RECOVERYCODES: generated 10")
                    , \_ -> Expect.equal Nothing (parseRecoveryCodeLine "RECOVERYCODES: 0. ABCDE-FGHJK")
                    ]
                    ()
        , test "recognizes lifecycle notices" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (isRecoveryCodesGenerated "RECOVERYCODES: generated 10 single-use codes — copy them now")
                    , \_ -> Expect.equal True (isRecoveryCodesLoginOk "RECOVERYCODES: login ok — that code is now spent")
                    , \_ -> Expect.equal True (isRecoveryCodesCleared "RECOVERYCODES: all recovery codes cleared")
                    , \_ -> Expect.equal False (isRecoveryCodesGenerated "RECOVERYCODES: 3 unused codes")
                    ]
                    ()
        , test "normalizes dashed input for LOGIN" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "ABCDEFGHJK" (normalizeRecoveryCodeInput "abCde-fghjk")
                    , \_ -> Expect.equal "ABCDEFGHJK" (normalizeRecoveryCodeInput "  ABCDE FGH JK ")
                    ]
                    ()
        ]
