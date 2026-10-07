module FacepileTest exposing (suite)

{-| Oracle-mirrored vectors for the avatar-stack selection
(mirroring `src/shell/facepile.test.ts`: caps, overflow, role
precedence, presence, recency, nick tiebreak, dedupe, blanks,
zero cap).
-}

import Expect
import Facepile exposing (..)
import Set
import Test exposing (Test, describe, test)


member : String -> List Char -> MemberInput
member nick modes =
    { nick = nick, modes = Set.fromList modes, away = False, lastActiveAt = Nothing }


awayMember : String -> List Char -> MemberInput
awayMember nick modes =
    { nick = nick, modes = Set.fromList modes, away = True, lastActiveAt = Nothing }


activeMember : String -> Int -> MemberInput
activeMember nick at =
    { nick = nick, modes = Set.empty, away = False, lastActiveAt = Just at }


nicks : List Entry -> List String
nicks entries =
    List.map .nick entries


suite : Test
suite =
    describe "Facepile"
        [ test "returns an empty pile for no members" <|
            \_ ->
                Expect.equal { entries = [], total = 0, overflow = 0 } (buildFacepile [] Nothing)
        , test "returns the single member" <|
            \_ ->
                case pickFacepileMembers [ member "solo" [] ] Nothing of
                    [ entry ] ->
                        Expect.all
                            [ \_ -> Expect.equal "solo" entry.nick
                            , \_ -> Expect.equal Member entry.role
                            , \_ -> Expect.equal False entry.away
                            , \_ -> Expect.equal False entry.owner
                            ]
                            ()

                    _ ->
                        Expect.fail "expected one entry"
        , test "shows exactly N without overflow when count equals the cap" <|
            \_ ->
                let
                    result =
                        buildFacepile [ member "a" [], member "b" [], member "c" [] ] (Just 3)
                in
                Expect.all
                    [ \_ -> Expect.equal 3 (List.length result.entries)
                    , \_ -> Expect.equal 3 result.total
                    , \_ -> Expect.equal 0 result.overflow
                    ]
                    ()
        , test "caps the visible list and reports the overflow count when over N" <|
            \_ ->
                let
                    result =
                        buildFacepile (List.map (\n -> member n []) [ "a", "b", "c", "d", "e", "f", "g" ]) (Just 5)
                in
                Expect.all
                    [ \_ -> Expect.equal 5 (List.length result.entries)
                    , \_ -> Expect.equal 7 result.total
                    , \_ -> Expect.equal 2 result.overflow
                    ]
                    ()
        , test "defaults the cap to five" <|
            \_ ->
                let
                    result =
                        buildFacepile (List.map (\i -> member ("u" ++ String.fromInt i) []) (List.range 0 7)) Nothing
                in
                Expect.all
                    [ \_ -> Expect.equal defaultCap (List.length result.entries)
                    , \_ -> Expect.equal 5 (List.length result.entries)
                    , \_ -> Expect.equal 3 result.overflow
                    ]
                    ()
        , test "orders by role precedence" <|
            \_ ->
                Expect.equal
                    [ "netop", "boss", "own", "admin", "oper", "half", "voiced", "plain" ]
                    (nicks
                        (pickFacepileMembers
                            [ member "plain" []
                            , member "voiced" [ 'v' ]
                            , member "half" [ 'h' ]
                            , member "oper" [ 'o' ]
                            , member "admin" [ 'a' ]
                            , member "boss" [ 'Q' ]
                            , member "netop" [ 'Y' ]
                            , member "own" [ 'q' ]
                            ]
                            (Just 8)
                        )
                    )
        , test "picks the highest-precedence role when a member holds several modes" <|
            \_ ->
                case pickFacepileMembers [ member "multi" [ 'v', 'o', 'q' ] ] Nothing of
                    [ entry ] ->
                        Expect.all
                            [ \_ -> Expect.equal Owner entry.role
                            , \_ -> Expect.equal True entry.owner
                            ]
                            ()

                    _ ->
                        Expect.fail "expected one entry"
        , test "marks founders and owners for the avatar ring, but not ops" <|
            \_ ->
                let
                    entries =
                        pickFacepileMembers [ member "f" [ 'Q' ], member "o" [ 'q' ], member "op" [ 'o' ] ] (Just 3)

                    byNick name =
                        List.filter (\e -> e.nick == name) entries |> List.head |> Maybe.map .owner
                in
                Expect.all
                    [ \_ -> Expect.equal (Just True) (byNick "f")
                    , \_ -> Expect.equal (Just True) (byNick "o")
                    , \_ -> Expect.equal (Just False) (byNick "op")
                    ]
                    ()
        , test "sorts present members ahead of away members within a role tier" <|
            \_ ->
                Expect.equal
                    [ "amos", "zara" ]
                    (nicks (pickFacepileMembers [ awayMember "zara" [ 'o' ], member "amos" [ 'o' ] ] Nothing))
        , test "keeps a high-role away member ahead of a low-role present member" <|
            \_ ->
                Expect.equal
                    [ "awayop", "lurker" ]
                    (nicks (pickFacepileMembers [ member "lurker" [], awayMember "awayop" [ 'o' ] ] Nothing))
        , test "breaks ties by recent activity, most-recent first" <|
            \_ ->
                Expect.equal
                    [ "fresh", "mid", "old" ]
                    (nicks (pickFacepileMembers [ activeMember "old" 100, activeMember "fresh" 900, activeMember "mid" 500 ] Nothing))
        , test "falls back to case-insensitive alphabetical order as the final tiebreak" <|
            \_ ->
                Expect.equal
                    [ "alice", "Bob", "Charlie" ]
                    (nicks (pickFacepileMembers [ member "Charlie" [], member "alice" [], member "Bob" [] ] Nothing))
        , test "dedupes by case-insensitive nick, first occurrence wins" <|
            \_ ->
                let
                    result =
                        buildFacepile [ member "Nova" [ 'o' ], member "nova" [ 'v' ], member "other" [] ] Nothing

                    novas =
                        List.filter (\e -> String.toLower e.nick == "nova") result.entries
                in
                Expect.all
                    [ \_ -> Expect.equal 2 result.total
                    , \_ -> Expect.equal 1 (List.length novas)
                    , \_ -> Expect.equal (Just Op) (Maybe.map .role (List.head novas))
                    ]
                    ()
        , test "ignores blank nicks" <|
            \_ ->
                let
                    result =
                        buildFacepile [ member "   " [], member "real" [] ] Nothing
                in
                Expect.all
                    [ \_ -> Expect.equal 1 result.total
                    , \_ -> Expect.equal [ "real" ] (nicks result.entries)
                    ]
                    ()
        , test "treats a zero cap as all-overflow" <|
            \_ ->
                let
                    result =
                        buildFacepile [ member "a" [], member "b" [] ] (Just 0)
                in
                Expect.all
                    [ \_ -> Expect.equal 0 (List.length result.entries)
                    , \_ -> Expect.equal 2 result.total
                    , \_ -> Expect.equal 2 result.overflow
                    ]
                    ()
        ]
