module ModerationTest exposing (suite)

{-| Oracle-mirrored vectors for moderation drafts (mirroring
`src/lib/moderation/actionModel.test.ts`). -}

import Expect
import Moderation exposing (..)
import Test exposing (Test, describe, test)


named : ModerationKind -> String -> String -> Draft
named kind channel target =
    { kind = kind, channel = channel, target = Just target, mask = Nothing, reason = Nothing }


expectOk : Draft -> { action : NormalizedAction, review : ReviewCopy }
expectOk draft =
    case validateDraft draft "Ada" of
        Ok valid ->
            valid

        Err errors ->
            Expect.fail ("expected ok: " ++ String.join "; " errors)
                |> always { action = KickAction { channel = "", target = "", reason = Nothing }, review = reviewCopy (KickAction { channel = "", target = "", reason = Nothing }) }


okAction : Draft -> NormalizedAction
okAction draft =
    (expectOk draft).action


expectErr : Draft -> String -> Expect.Expectation
expectErr draft fragment =
    case validateDraft draft "Ada" of
        Ok _ ->
            Expect.fail "expected rejection"

        Err errors ->
            Expect.equal True
                (List.any (String.contains fragment) errors)


suite : Test
suite =
    describe "Moderation"
        [ test "normalizes kick, ban, unban, op, and voice drafts" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal
                            (KickAction { channel = "#garden", target = "bob", reason = Nothing })
                            (okAction (named Kick " #garden " " bob "))
                    , \_ ->
                        Expect.equal
                            (KickAction { channel = "#garden", target = "bob", reason = Just "please slow down" })
                            (okAction
                                { kind = Kick
                                , channel = "#garden"
                                , target = Just "bob"
                                , mask = Nothing
                                , reason = Just "  please slow down  "
                                }
                            )
                    , \_ ->
                        Expect.equal
                            (BanAction { channel = "#garden", target = Just "bob", mask = "bob!*@*", reason = Nothing })
                            (okAction (named Ban "#garden" "bob"))
                    , \_ ->
                        Expect.equal
                            (BanAction { channel = "#garden", target = Nothing, mask = "bad!*@*", reason = Nothing })
                            (okAction
                                { kind = Ban
                                , channel = "#garden"
                                , target = Nothing
                                , mask = Just "  bad!*@*  "
                                , reason = Nothing
                                }
                            )
                    , \_ ->
                        Expect.equal
                            (UnbanAction { channel = "#garden", mask = "bad!*@*" })
                            (okAction
                                { kind = Unban
                                , channel = "#garden"
                                , target = Nothing
                                , mask = Just " bad!*@* "
                                , reason = Nothing
                                }
                            )
                    , \_ ->
                        Expect.equal Op
                            (case (okAction (named Op "#garden" "bob")) of
                                RoleAction details ->
                                    details.kind

                                _ ->
                                    Kick
                            )
                    , \_ ->
                        Expect.equal Deop
                            (case (okAction (named Deop "#garden" "bob")) of
                                RoleAction details ->
                                    details.kind

                                _ ->
                                    Kick
                            )
                    , \_ ->
                        Expect.equal Voice
                            (case (okAction (named Voice "#garden" "bob")) of
                                RoleAction details ->
                                    details.kind

                                _ ->
                                    Kick
                            )
                    , \_ ->
                        Expect.equal Devoice
                            (case (okAction (named Devoice "#garden" "bob")) of
                                RoleAction details ->
                                    details.kind

                                _ ->
                                    Kick
                            )
                    ]
                    ()
        , test "rejects blank channel, target, mask, and whitespace-only reason" <|
            \_ ->
                Expect.all
                    [ \_ -> expectErr (named Kick "   " "bob") "valid room"
                    , \_ -> expectErr (named Kick "#garden" "   ") "someone to remove"
                    , \_ ->
                        expectErr
                            { kind = Unban, channel = "#garden", target = Nothing, mask = Just "   ", reason = Nothing }
                            "valid block"
                    , \_ ->
                        expectErr
                            { kind = Ban, channel = "#garden", target = Nothing, mask = Nothing, reason = Nothing }
                            "person or a block"
                    , \_ ->
                        case
                            validateDraft
                                { kind = Kick, channel = "#garden", target = Just "bob", mask = Nothing, reason = Just "   " }
                                "Ada"
                        of
                            Ok valid ->
                                Expect.equal
                                    (KickAction { channel = "#garden", target = "bob", reason = Nothing })
                                    valid.action

                            Err errors ->
                                Expect.fail ("expected ok: " ++ String.join "; " errors)
                    ]
                    ()
        , test "rejects control characters in every user-authored field" <|
            \_ ->
                Expect.all
                    [ \_ -> expectErr (named Kick "#gar\nden" "bob") "valid room"
                    , \_ -> expectErr (named Kick "#garden" "bo\u{0007}b") "someone to remove"
                    , \_ ->
                        expectErr
                            { kind = Ban, channel = "#garden", target = Nothing, mask = Just "bad\u{0000}!*@*", reason = Nothing }
                            "valid block address"
                    , \_ ->
                        expectErr
                            { kind = Kick, channel = "#garden", target = Just "bob", mask = Nothing, reason = Just "no\u{0007}bells" }
                            "control characters"
                    ]
                    ()
        , test "rejects self targets and everyone-matching masks, but lifts freely" <|
            \_ ->
                Expect.all
                    [ \_ -> expectErr (named Kick "#garden" "ADA") "cannot moderate yourself"
                    , \_ -> expectErr (named Ban "#garden" "ada") "cannot moderate yourself"
                    , \_ ->
                        expectErr
                            { kind = Ban, channel = "#garden", target = Nothing, mask = Just "Ada!*@*", reason = Nothing }
                            "cannot moderate yourself"
                    , \_ -> expectErr (named Op "#garden" "Ada") "cannot moderate yourself"
                    , \_ -> expectErr (named Voice "#garden" "ada") "cannot moderate yourself"
                    , \_ ->
                        expectErr
                            { kind = Ban, channel = "#garden", target = Nothing, mask = Just "*!*@*", reason = Nothing }
                            "match everyone"
                    , \_ ->
                        expectErr
                            { kind = Ban, channel = "#garden", target = Nothing, mask = Just "*", reason = Nothing }
                            "match everyone"
                    , \_ ->
                        expectErr
                            { kind = Ban, channel = "#garden", target = Nothing, mask = Just "*!*@*.*", reason = Nothing }
                            "match everyone"
                    , \_ -> Expect.equal False (isDangerousBanMask "bad!*@*")
                    , \_ ->
                        case
                            validateDraft
                                { kind = Unban, channel = "#garden", target = Nothing, mask = Just "Ada!*@*", reason = Nothing }
                                "Ada"
                        of
                            Ok _ ->
                                Expect.pass

                            Err errors ->
                                Expect.fail ("expected ok: " ++ String.join "; " errors)
                    , \_ ->
                        case
                            validateDraft
                                { kind = Unban, channel = "#garden", target = Nothing, mask = Just "*", reason = Nothing }
                                "Ada"
                        of
                            Ok _ ->
                                Expect.pass

                            Err errors ->
                                Expect.fail ("expected ok: " ++ String.join "; " errors)
                    ]
                    ()
        , test "exposes advanced kick/ban and keeps role changes in network-ops" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (kindsForMode "standard")
                    , \_ -> Expect.equal [ Kick, Ban ] (kindsForMode "advanced")
                    , \_ -> Expect.equal [ Kick, Ban, Op, Deop, Voice, Devoice ] (kindsForMode "network-ops")
                    ]
                    ()
        , test "rejects invalid rooms, nicknames, masks, and oversized notes" <|
            \_ ->
                let
                    longChannel =
                        "#" ++ String.repeat maxChannelLength "x"

                    longNick =
                        String.repeat (maxNickLength + 1) "x"

                    longMask =
                        "bad" ++ String.repeat maxMaskLength "x" ++ "!*@*"

                    longReason =
                        String.repeat (maxReasonLength + 1) "n"
                in
                Expect.all
                    [ \_ -> expectErr (named Kick "garden" "bob") "valid room"
                    , \_ -> expectErr (named Kick longChannel "bob") "valid room"
                    , \_ -> expectErr (named Kick "#garden" "bo b") "someone to remove"
                    , \_ -> expectErr (named Kick "#garden" longNick) "someone to remove"
                    , \_ ->
                        expectErr
                            { kind = Ban, channel = "#garden", target = Nothing, mask = Just longMask, reason = Nothing }
                            "valid block address"
                    , \_ ->
                        expectErr
                            { kind = Kick, channel = "#garden", target = Just "bob", mask = Nothing, reason = Just longReason }
                            "200 characters"
                    ]
                    ()
        , test "rejects a missing actor nickname and unknown kinds" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        case validateDraft (named Kick "#garden" "bob") "  " of
                            Ok _ ->
                                Expect.fail "expected rejection"

                            Err _ ->
                                Expect.pass
                    , \_ -> Expect.equal False (isModerationKind "tempBan")
                    , \_ -> Expect.equal True (isModerationKind "kick")
                    ]
                    ()
        , test "builds plain-language review copy for every kind" <|
            \_ ->
                let
                    actions =
                        [ KickAction { channel = "#garden", target = "bob", reason = Just "spam" }
                        , BanAction { channel = "#garden", target = Just "bob", mask = "bob!*@*", reason = Nothing }
                        , UnbanAction { channel = "#garden", mask = "bob!*@*" }
                        , RoleAction { kind = Op, channel = "#garden", target = "bob" }
                        , RoleAction { kind = Deop, channel = "#garden", target = "bob" }
                        , RoleAction { kind = Voice, channel = "#garden", target = "bob" }
                        , RoleAction { kind = Devoice, channel = "#garden", target = "bob" }
                        ]

                    check action =
                        let
                            copy =
                                reviewCopy action
                        in
                        Expect.all
                            [ \_ -> Expect.equal True (String.length copy.title > 3)
                            , \_ -> Expect.equal True (String.contains "#garden" copy.summary)
                            , \_ -> Expect.equal True (String.length copy.confirmLabel > 3)
                            , \_ -> Expect.equal True (String.length copy.impact > 3)
                            , \_ -> Expect.equal False (String.contains "MODE" copy.title)
                            , \_ -> Expect.equal False (String.contains "KICK" copy.title)
                            ]
                            ()
                in
                Expect.all (List.map (\action _ -> check action) actions) ()
        ]
