module StewardshipTest exposing (suite)

{-| Room stewardship: the 3–30 band, one owner plus up to two
co-admins, accept-to-take transfer, typed-name delete, and the
last-member dissolve. Oracle `roomStewardship.ts` (+ its test file).
-}

import Dict
import Expect
import Stewardship exposing (..)
import Test exposing (Test, describe, test)


five : List StewardMember
five =
    [ { nick = "alice", modes = [ "Q", "q" ] }
    , { nick = "bob", modes = [ "o" ] }
    , { nick = "cara", modes = [ "o" ] }
    , { nick = "drew", modes = [] }
    , { nick = "erin", modes = [] }
    ]


suite : Test
suite =
    describe "Stewardship"
        [ describe "consumer room size"
            [ test "is the 3-30 band where members can invite" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (isConsumerStewardshipRoom 2)
                        , \_ -> Expect.equal True (isConsumerStewardshipRoom 3)
                        , \_ -> Expect.equal True (isConsumerStewardshipRoom 30)
                        , \_ -> Expect.equal False (isConsumerStewardshipRoom 31)
                        , \_ -> Expect.equal True (membersCanInvite 5)
                        , \_ -> Expect.equal False (membersCanInvite 2)
                        , \_ -> Expect.equal 5 (memberCount five)
                        , \_ -> Expect.equal 1 (memberCount [ { nick = "  ", modes = [] }, { nick = "alice", modes = [] } ])
                        ]
                        ()
            ]
        , describe "one owner, two co-admins"
            [ test "reads owner and helpers from existing roster ranks" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [ "alice" ] (listOwners five)
                        , \_ -> Expect.equal [ "bob", "cara" ] (listCoAdmins five)
                        , \_ -> Expect.equal True (actorIsOwner five "alice")
                        , \_ -> Expect.equal False (actorIsOwner five "bob")
                        , \_ -> Expect.equal False (actorIsOwner five "mallory")
                        , \_ -> Expect.equal True (isOwnerModes [ "q" ])
                        , \_ -> Expect.equal True (isOwnerModes [ "Q" ])
                        , \_ -> Expect.equal False (isCoAdminModes [ "o", "q" ])
                        ]
                        ()
            , test "cannot add a third co-admin" <|
                \_ ->
                    Expect.equal
                        (StewardRefused "This room already has two people who can help.")
                        (rejectThirdCoAdmin five "alice" "drew")
            , test "lets the owner add a helper when a seat is free" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (StewardOk "drew")
                                (rejectThirdCoAdmin
                                    [ { nick = "alice", modes = [ "q" ] }
                                    , { nick = "bob", modes = [ "o" ] }
                                    , { nick = "drew", modes = [] }
                                    ]
                                    "alice"
                                    "drew"
                                )
                        , \_ ->
                            Expect.equal
                                (StewardRefused "Only the owner can add someone who can help.")
                                (rejectThirdCoAdmin five "bob" "drew")
                        , \_ ->
                            Expect.equal
                                (StewardRefused "That person is not in this room.")
                                (rejectThirdCoAdmin five "alice" "mallory")
                        , \_ ->
                            Expect.equal
                                (StewardRefused "They already help with this room.")
                                (rejectThirdCoAdmin five "alice" "bob")
                        , \_ ->
                            Expect.equal
                                (StewardRefused "The owner already looks after this room.")
                                (rejectThirdCoAdmin five "alice" "alice")
                        ]
                        ()
            ]
        , describe "accept-to-take transfer"
            [ test "waits for accept before any owner rank is granted" <|
                \_ ->
                    let
                        offered =
                            offerTransfer { current = Nothing, channel = "#harbor", from = "alice", to = "drew", members = five }

                        accepted =
                            acceptTransfer { current = offered, channel = "#harbor", acceptor = "drew" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just { channel = "#harbor", from = "alice", to = "drew", accepted = False }) offered
                        , \_ -> Expect.equal False (canCompleteTransfer offered)
                        , \_ -> Expect.equal Nothing (transferModeCommands offered five)
                        , \_ -> Expect.equal (Just { channel = "#harbor", from = "alice", to = "drew", accepted = True }) accepted
                        , \_ -> Expect.equal True (canCompleteTransfer accepted)
                        , \_ ->
                            Expect.equal
                                (Just
                                    { commands = [ { modes = "+q", nick = "drew" }, { modes = "-q", nick = "alice" } ]
                                    , founderRemains = True
                                    }
                                )
                                (transferModeCommands accepted five)
                        ]
                        ()
            , test "does not let a bystander accept, and does not pick a successor" <|
                \_ ->
                    let
                        offered =
                            offerTransfer { current = Nothing, channel = "#harbor", from = "alice", to = "drew", members = five }
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (acceptTransfer { current = offered, channel = "#harbor", acceptor = "erin" })
                        , \_ -> Expect.equal Nothing (offerTransfer { current = Nothing, channel = "#harbor", from = "alice", to = "alice", members = five })
                        , \_ -> Expect.equal Nothing (offerTransfer { current = Nothing, channel = "#harbor", from = "bob", to = "drew", members = five })
                        , \_ -> Expect.equal Nothing (offerTransfer { current = Nothing, channel = "#harbor", from = "alice", to = "mallory", members = five })
                        , \_ ->
                            Expect.equal offered
                                (offerTransfer { current = offered, channel = "#harbor", from = "alice", to = "drew", members = five })
                        , \_ ->
                            Expect.equal offered
                                (declineTransfer { current = offered, channel = "#other", actor = "drew" })
                        , \_ ->
                            Expect.equal Nothing
                                (declineTransfer { current = offered, channel = "#harbor", actor = "drew" })
                        , \_ ->
                            Expect.equal Nothing
                                (declineTransfer { current = offered, channel = "#harbor", actor = "alice" })
                        ]
                        ()
            , test "grants only the ranks the roster still holds" <|
                \_ ->
                    let
                        accepted =
                            Just { channel = "#harbor", from = "alice", to = "drew", accepted = True }

                        small =
                            [ { nick = "alice", modes = [ "q" ] }
                            , { nick = "drew", modes = [] }
                            ]
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just
                                    { commands = [ { modes = "+q", nick = "drew" }, { modes = "-q", nick = "alice" } ]
                                    , founderRemains = False
                                    }
                                )
                                (transferModeCommands accepted small)
                        , \_ -> Expect.equal Nothing (transferModeCommands accepted [ { nick = "alice", modes = [ "q" ] } ])
                        ]
                        ()
            ]
        , describe "delete requires the room name"
            [ test "refuses delete until the typed name matches" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (canDeleteRoom { actorIsOwner = True, typedName = "", room = "#harbor" })
                        , \_ -> Expect.equal False (canDeleteRoom { actorIsOwner = True, typedName = "#other", room = "#harbor" })
                        , \_ -> Expect.equal False (canDeleteRoom { actorIsOwner = False, typedName = "#harbor", room = "#harbor" })
                        , \_ -> Expect.equal True (canDeleteRoom { actorIsOwner = True, typedName = "#harbor", room = "#harbor" })
                        , \_ -> Expect.equal True (canDeleteRoom { actorIsOwner = True, typedName = "#harbor", room = "#harbor" })
                        , \_ -> Expect.equal True (canDeleteRoom { actorIsOwner = True, typedName = "harbor", room = "#harbor" })
                        , \_ -> Expect.equal True (typedNameMatchesRoom "HARBOR" "#harbor")
                        ]
                        ()
            ]
        , describe "last member leave"
            [ test "dissolves when the last person leaves" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (lastMemberLeaveDissolves 1)
                        , \_ -> Expect.equal False (lastMemberLeaveDissolves 2)
                        ]
                        ()
            ]
        , describe "transfer memory"
            [ test "keys offers by channel and drops on decline" <|
                \_ ->
                    let
                        offer =
                            { channel = "#harbor", from = "alice", to = "drew", accepted = False }

                        stored =
                            writeTransfer (Just offer) "#harbor" Dict.empty
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just offer) (transferFor "#HARBOR" stored)
                        , \_ -> Expect.equal Nothing (transferFor "#other" stored)
                        , \_ -> Expect.equal Nothing (transferFor "#harbor" (writeTransfer Nothing "#harbor" stored))
                        ]
                        ()
            ]
        ]
