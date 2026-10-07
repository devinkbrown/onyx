module PersonSafetyTest exposing (suite)

{-| Oracle-mirrored vectors for person safety (mirroring
`src/lib/people/personSafety.test.ts`). -}

import Expect
import PersonSafety exposing (..)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "PersonSafety"
        [ test "block copy stays quiet and device-local" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "Block bob?" (blockTitle "bob")
                    , \_ ->
                        Expect.equal
                            "You will not see bob on this device. They are not told."
                            (blockBody "bob")
                    , \_ ->
                        Expect.equal
                            { title = "Unblocked bob"
                            , description = "Messages and notifications from this name resume on this device."
                            }
                            (unblockToast "bob")
                    ]
                    ()
        , test "report room, reasons, and honest draft shape" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "#root" reportRoom
                    , \_ -> Expect.equal True (isReportReason "harassment")
                    , \_ -> Expect.equal False (isReportReason "trust-center")
                    , \_ ->
                        Expect.equal
                            "Report\nAbout: eve\nWhat: spam\nFrom: alice\nGuest: yes\nNote: posted links in #lounge"
                            (formatDraft
                                { nick = "eve"
                                , reason = Spam
                                , note = "posted links in #lounge"
                                , from = "alice"
                                , guest = True
                                }
                            )
                    , \_ ->
                        Expect.equal
                            "Report\nAbout: eve\nWhat: harassment\nFrom: alice"
                            (formatDraft
                                { nick = "eve"
                                , reason = Harassment
                                , note = ""
                                , from = "alice"
                                , guest = False
                                }
                            )
                    , \_ -> Expect.equal True (String.contains "shared #root report room" reportHonesty)
                    , \_ -> Expect.equal True (String.contains "not a private inbox or police report" reportHonesty)
                    , \_ -> Expect.equal True (String.contains "Nothing is sent automatically" reportHonesty)
                    , \_ -> Expect.equal False (String.contains "Trust & Safety" reportHonesty)
                    ]
                    ()
        , test "control characters never reach tokens or drafts" <|
            \_ ->
                let
                    bell =
                        String.fromChar (Char.fromCode 7)

                    nul =
                        String.fromChar (Char.fromCode 0)

                    draft =
                        formatDraft
                            { nick = "bad\nname"
                            , reason = Other
                            , note = "line" ++ nul ++ "break"
                            , from = ""
                            , guest = False
                            }
                in
                Expect.all
                    [ \_ -> Expect.equal False (String.contains nul draft)
                    , \_ -> Expect.equal False (String.contains bell draft)
                    , \_ -> Expect.equal True (String.contains "About: badname" draft)
                    , \_ -> Expect.equal True (String.contains "Note: linebreak" draft)
                    , \_ -> Expect.equal "xy" (sanitizeToken ("x" ++ bell ++ "y") 128)
                    , \_ -> Expect.equal "a\nb" (sanitizeMultiline ("a\nb" ++ nul) 500)
                    ]
                    ()
        , test "owner receipt keys scope by account and fail closed" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal
                            (Just "onyx:person-report-receipts:owner:%5B%22wss%3A%2F%2Fharbor.test%2Fws%22%2C%22alice%22%5D")
                            (ownerStorageKey { serverUrl = "wss://harbor.test/ws", identity = "Alice" })
                    , \_ -> Expect.equal Nothing (ownerStorageKey { serverUrl = "", identity = "alice" })
                    , \_ -> Expect.equal Nothing (ownerStorageKey { serverUrl = "wss://x", identity = "  " })
                    ]
                    ()
        ]
