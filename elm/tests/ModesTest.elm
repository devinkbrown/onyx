module ModesTest exposing (suite)

{-| Vectors ported from `src/lib/store/store.channel.test.ts`
(`selectOwnPrefix` rank order, `parseChannelModeString`) plus direct
coverage of the data-driven arg rules, delta application, CHANMODES
strictness, the user-mode catalog (`modes.md`), and extban shapes.
-}

import Dict
import Expect
import Modes exposing (..)
import Set
import Test exposing (Test, describe, test)


groups : ArgGroups
groups =
    defaultChanGroups


prefixModes : Set.Set Char
prefixModes =
    Set.fromList [ 'Y', 'Q', 'q', 'o', 'v' ]


suite : Test
suite =
    describe "Modes"
        [ describe "status ladder"
            [ test "plain members have no status" <|
                \_ -> Expect.equal Nothing (highestStatusMode [])
            , test "single op ranks op" <|
                \_ -> Expect.equal (Just 'o') (highestStatusMode [ 'o' ])
            , test "voice alone ranks voice" <|
                \_ -> Expect.equal (Just 'v') (highestStatusMode [ 'v' ])
            , test "legacy admin outranks op (oracle parity)" <|
                \_ -> Expect.equal (Just 'a') (highestStatusMode [ 'o', 'a' ])
            , test "legacy halfop outranks voice (oracle parity)" <|
                \_ -> Expect.equal (Just 'h') (highestStatusMode [ 'h', 'v' ])
            , test "founder outranks everything stored" <|
                \_ -> Expect.equal (Just 'Q') (highestStatusMode [ 'v', 'o', 'q', 'Q' ])
            , test "unknown letters never win" <|
                \_ -> Expect.equal Nothing (highestStatusMode [ 'x', 'z' ])
            , test "server default maps follow PREFIX=(YQqov)*!.@+" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just '*') (Dict.get 'Y' defaultModeToPrefix)
                        , \_ -> Expect.equal (Just 'o') (Dict.get '@' defaultPrefixToMode)
                        , \_ -> Expect.equal (Just 'v') (Dict.get '+' defaultPrefixToMode)
                        ]
                        ()
            ]
        , describe "user-mode catalog"
            [ test "self-settable modes" <|
                \_ ->
                    Expect.equal True
                        (List.all (\m -> userModeAccess m == Just SelfOnly)
                            [ 'i', 'B', 'D', 'g', 'C', 'R', 'p', 'Q', 'H' ]
                        )
            , test "oper cross-user paths" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just SelfAndOper) (userModeAccess 'P')
                        , \_ -> Expect.equal (Just SelfAndOper) (userModeAccess 'j')
                        , \_ -> Expect.equal (Just OperOnly) (userModeAccess 'z')
                        , \_ -> Expect.equal (Just OperOnly) (userModeAccess 'M')
                        ]
                        ()
            , test "daemon-derived modes are server-only" <|
                \_ ->
                    Expect.equal True
                        (List.all (\m -> userModeAccess m == Just ServerOnly)
                            [ 'o', 'r', 'x', 'a' ]
                        )
            , test "unknown letters are ignored" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (userModeAccess 'w')
                        , \_ -> Expect.equal Nothing (userModeAccess 's')
                        ]
                        ()
            ]
        , describe "CHANMODES groups"
            [ test "parses the server default token" <|
                \_ ->
                    Expect.equal (Just { lists = "beIZ", alwaysArg = "k", setOnly = "lfj" })
                        (parseChanGroups "beIZ,k,lfj,imnstCTNMSgWOAVUFD")
            , test "rejects malformed group tables whole" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseChanGroups "beIZ,k,lfj")
                        , \_ -> Expect.equal Nothing (parseChanGroups "bb,k,lfj,imnst")
                        , \_ -> Expect.equal Nothing (parseChanGroups "beIZ,k,lfj,imnst!")
                        , \_ -> Expect.equal Nothing (parseChanGroups "beIZ,k,lfk,imnst")
                        ]
                        ()
            , test "arg consumption follows the classes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (modeConsumesArg groups prefixModes 'b' True)
                        , \_ -> Expect.equal True (modeConsumesArg groups prefixModes 'b' False)
                        , \_ -> Expect.equal True (modeConsumesArg groups prefixModes 'k' False)
                        , \_ -> Expect.equal True (modeConsumesArg groups prefixModes 'l' True)
                        , \_ -> Expect.equal False (modeConsumesArg groups prefixModes 'l' False)
                        , \_ -> Expect.equal False (modeConsumesArg groups prefixModes 'm' True)
                        , \_ -> Expect.equal True (modeConsumesArg groups prefixModes 'o' True)
                        , \_ -> Expect.equal True (modeConsumesArg groups prefixModes 'v' False)
                        ]
                        ()
            ]
        , describe "parseChannelModeString"
            [ test "splits flags from key and limit" <|
                \_ ->
                    let
                        st =
                            parseChannelModeString "+mntkl secret 50"
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (List.member 'm' st.flags)
                        , \_ -> Expect.equal True (List.member 't' st.flags)
                        , \_ -> Expect.equal (Just "secret") st.key
                        , \_ -> Expect.equal (Just 50) st.limit
                        ]
                        ()
            , test "returns empty state for blank input" <|
                \_ ->
                    Expect.equal { flags = [], key = Nothing, limit = Nothing }
                        (parseChannelModeString "")
            , test "unparseable limit clears to Nothing" <|
                \_ ->
                    Expect.equal Nothing (parseChannelModeString "+l abc").limit
            ]
        , describe "applyChannelModeDelta"
            [ test "adds flags canonically sorted" <|
                \_ ->
                    Expect.equal "+mnt"
                        (applyChannelModeDelta "" "+mnt" [] groups prefixModes)
            , test "binds key and limit args" <|
                \_ ->
                    Expect.equal "+kl secret 50"
                        (applyChannelModeDelta "" "+kl" [ "secret", "50" ] groups prefixModes)
            , test "removing key clears the stored value" <|
                \_ ->
                    Expect.equal ""
                        (applyChannelModeDelta "+k secret" "-k" [] groups prefixModes)
            , test "status and list modes are tracked elsewhere" <|
                \_ ->
                    Expect.equal "+m"
                        (applyChannelModeDelta "" "+mob" [ "alice", "*!*@*" ] groups prefixModes)
            , test "limit removal drops the number but keeps flags" <|
                \_ ->
                    Expect.equal "+m"
                        (applyChannelModeDelta "+ml 50" "-l" [] groups prefixModes)
            ]
        , describe "parseExtBan"
            [ test "accepts typed masks" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just { negated = False, banType = 'a', mask = "alice" })
                                (parseExtBan "$a:alice")
                        , \_ ->
                            Expect.equal (Just { negated = False, banType = 'c', mask = "#staff" })
                                (parseExtBan "$c:#staff")
                        ]
                        ()
            , test "accepts negation" <|
                \_ ->
                    Expect.equal (Just { negated = True, banType = 'm', mask = "*!*@*" })
                        (parseExtBan "$~m:*!*@*")
            , test "rejects unknown types, empty masks, and plain masks" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseExtBan "$x:yz")
                        , \_ -> Expect.equal Nothing (parseExtBan "$a:")
                        , \_ -> Expect.equal Nothing (parseExtBan "alice!*@*")
                        , \_ -> Expect.equal Nothing (parseExtBan "$a:has space")
                        , \_ -> Expect.equal Nothing (parseExtBan "$o:")
                        , \_ -> Expect.equal Nothing (parseExtBan "$z:")
                        , \_ -> Expect.equal Nothing (parseExtBan "$a")
                        ]
                        ()
            , test "accepts oper/secure types with patterns and bare" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just { negated = False, banType = 'o', mask = "ops" })
                                (parseExtBan "$o:ops")
                        , \_ ->
                            Expect.equal (Just { negated = False, banType = 'o', mask = "" })
                                (parseExtBan "$o")
                        , \_ ->
                            Expect.equal (Just { negated = False, banType = 'z', mask = "" })
                                (parseExtBan "$z")
                        , \_ ->
                            Expect.equal (Just { negated = True, banType = 'o', mask = "" })
                                (parseExtBan "$~o")
                        ]
                        ()
            ]
        , describe "buildExtBan"
            [ test "builds typed and negated masks" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "$a:alice") (buildExtBan False 'a' "alice")
                        , \_ -> Expect.equal (Just "$~m:*!*@*") (buildExtBan True 'm' "*!*@*")
                        , \_ -> Expect.equal (Just "$o") (buildExtBan False 'o' "")
                        , \_ -> Expect.equal (Just "$~z") (buildExtBan True 'z' "")
                        ]
                        ()
            , test "refuses invalid parts" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (buildExtBan False 'x' "yz")
                        , \_ -> Expect.equal Nothing (buildExtBan False 'a' "")
                        , \_ -> Expect.equal Nothing (buildExtBan False 'a' "has space")
                        , \_ -> Expect.equal Nothing (buildExtBan False 'a' "has\ttab")
                        ]
                        ()
            , test "round-trips through the parser" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just { negated = True, banType = 'r', mask = "bob" })
                                (buildExtBan True 'r' "bob" |> Maybe.andThen parseExtBan)
                        , \_ -> Expect.equal "Account ($a:)" (extBanTypeLabel 'a')
                        , \_ -> Expect.equal "Oper class ($o:)" (extBanTypeLabel 'o')
                        ]
                        ()
            ]
        , describe "role resolution"
            [ test "plain members resolve to the member role" <|
                \_ ->
                    Expect.equal
                        { key = "member", label = "Member", symbol = "", sort = 7 }
                        (resolveRole Set.empty serverOrder serverPrefixes)
            , test "learned order decides before the named ladder" <|
                \_ ->
                    Expect.equal
                        { key = "op", label = "Op", symbol = "@", sort = 3 }
                        (resolveRole (Set.fromList [ 'o', 'v' ]) serverOrder serverPrefixes)
            , test "an exotic learned letter ranks with its symbol" <|
                \_ ->
                    Expect.equal
                        { key = "member", label = "Member", symbol = "!", sort = 0 }
                        (resolveRole (Set.fromList [ 'X' ]) [ 'X', 'o', 'v' ] (Dict.fromList [ ( 'X', '!' ), ( 'o', '@' ), ( 'v', '+' ) ]))
            , test "the named ladder covers modes the learned map drops" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                { key = "op", label = "Op", symbol = "@", sort = 4 }
                                (resolveRole (Set.fromList [ 'o', 'v' ]) [] Dict.empty)
                        , \_ ->
                            Expect.equal
                                { key = "halfop", label = "Half-op", symbol = "%", sort = 5 }
                                (resolveRole (Set.fromList [ 'h' ]) [] Dict.empty)
                        ]
                        ()
            , test "group labels follow the oracle section headings" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Network Operators" (groupLabelFor "netop")
                        , \_ -> Expect.equal "Ops" (groupLabelFor "op")
                        , \_ -> Expect.equal "Members" (groupLabelFor "member")
                        , \_ -> Expect.equal "Members" (groupLabelFor "bogus")
                        ]
                        ()
            , test "compareNicks mirrors localeCompare primary + tertiary" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal LT (compareNicks "alice" "Bob")
                        , \_ -> Expect.equal GT (compareNicks "Bob" "alice")
                        , \_ -> Expect.equal LT (compareNicks "alice" "Alice")
                        , \_ -> Expect.equal GT (compareNicks "ALICE" "alice")
                        , \_ -> Expect.equal EQ (compareNicks "alice" "alice")
                        , \_ ->
                            Expect.equal
                                [ "alice", "Alice", "bob", "Zed" ]
                                (List.sortWith compareNicks [ "bob", "Alice", "alice", "Zed" ])
                        , \_ ->
                            Expect.equal
                                [ "Nick1", "nick10", "nick2" ]
                                (List.sortWith compareNicks [ "nick2", "Nick1", "nick10" ])
                        ]
                        ()
            ]
        , describe "MODEX named modes"
            [ test "the table carries all 25 server names" <|
                \_ ->
                    Expect.equal 25 (List.length modexTable)
            , test "lookup is ASCII case-insensitive" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just "AUTHONLY")
                                (Maybe.map .name (lookupModexName "authonly"))
                        , \_ ->
                            Expect.equal (Just 'a')
                                (Maybe.andThen .letter (lookupModexName "AuthOnly"))
                        , \_ ->
                            Expect.equal (Just ModexMember)
                                (Maybe.map .kind (lookupModexName "voice"))
                        ]
                        ()
            , test "unknown and malformed names stay Nothing" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (lookupModexName "BOGUS")
                        , \_ -> Expect.equal Nothing (lookupModexName "")
                        , \_ -> Expect.equal Nothing (lookupModexName "AUTH-ONLY")
                        , \_ -> Expect.equal Nothing (lookupModexName "AUTH ONLY")
                        , \_ -> Expect.equal Nothing (lookupModexName (String.repeat 65 "A"))
                        ]
                        ()
            , test "PUBLIC has no letter; oper-only marks ride CLONE/REGISTERED/SERVICE" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (Maybe.andThen .letter (lookupModexName "PUBLIC"))
                        , \_ -> Expect.equal (Just True) (Maybe.map .requiresOper (lookupModexName "CLONE"))
                        , \_ -> Expect.equal (Just True) (Maybe.map .requiresOper (lookupModexName "REGISTERED"))
                        , \_ -> Expect.equal (Just True) (Maybe.map .requiresOper (lookupModexName "SERVICE"))
                        , \_ -> Expect.equal (Just False) (Maybe.map .requiresOper (lookupModexName "AUDITORIUM"))
                        , \_ -> Expect.equal (Just (Just '@')) (Maybe.map .statusPrefix (lookupModexName "HOST"))
                        ]
                        ()
            , test "letters round-trip to canonical names" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "AUTHONLY") (letterToModexName 'a')
                        , \_ -> Expect.equal (Just "VOICE") (letterToModexName 'v')
                        , \_ -> Expect.equal Nothing (letterToModexName 'Z')
                        ]
                        ()
            , test "targets parse channel and member shapes" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just { channel = "#c", member = Nothing })
                                (parseModexTarget "#c")
                        , \_ ->
                            Expect.equal
                                (Just { channel = "#c", member = Just "alice" })
                                (parseModexTarget "#c,alice")
                        , \_ -> Expect.equal Nothing (parseModexTarget "c")
                        , \_ -> Expect.equal Nothing (parseModexTarget "#c,alice,bob")
                        , \_ -> Expect.equal Nothing (parseModexTarget "#c,")
                        , \_ -> Expect.equal Nothing (parseModexTarget "")
                        ]
                        ()
            , test "query builder emits bare MODEX lines" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "MODEX #c") (buildModexQuery "#c")
                        , \_ -> Expect.equal (Just "MODEX #c,alice") (buildModexQuery "  #c,alice  ")
                        , \_ -> Expect.equal Nothing (buildModexQuery "bogus")
                        , \_ -> Expect.equal Nothing (buildModexQuery "")
                        ]
                        ()
            , test "826 rows validate each token to canonical names" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal [ "AUTHONLY", "MODERATED" ]
                                (parseModexListRow "AUTHONLY MODERATED")
                        , \_ ->
                            Expect.equal [ "VOICE" ]
                                (parseModexListRow "voice BOGUS")
                        , \_ -> Expect.equal [] (parseModexListRow "")
                        ]
                        ()
            ]
        ]


serverOrder : List Char
serverOrder =
    [ 'Y', 'Q', 'q', 'o', 'v' ]


serverPrefixes : Dict.Dict Char Char
serverPrefixes =
    Dict.fromList [ ( 'Y', '*' ), ( 'Q', '!' ), ( 'q', '.' ), ( 'o', '@' ), ( 'v', '+' ) ]
