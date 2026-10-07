module Facepile exposing
    ( RoleKey(..)
    , MemberInput
    , Entry
    , Pile
    , defaultCap
    , roleOfModes
    , groupLabel
    , buildFacepile
    , pickFacepileMembers
    )

{-| Overlapping avatar-stack selection (mirroring
`src/shell/facepile.ts`: deterministic, DOM-free prioritization
of the people most worth surfacing in a room, plus the overflow
count).

Priority (highest first): role rank (netop > founder > owner >
admin > op > halfop > voice > member), presence (here before
away), recent activity (newer first, missing counts as oldest),
then case-insensitive nick with a raw tiebreak. Members dedupe
by case-insensitive nick (first wins); blanks drop. The visible
list caps (default 5); everyone beyond becomes the overflow.

Narrowings: the nick tiebreak compares `toLower` + raw where
the oracle uses `localeCompare` with base sensitivity, so
locale-specific orderings (e.g. Turkish dotted-I) may differ;
ASCII orders identically. Recency rides an optional stamp —
production roster members carry none on both sides.
-}

import Set exposing (Set)


{-| Role keys in descending precedence. -}
type RoleKey
    = Netop
    | Founder
    | Owner
    | Admin
    | Op
    | Halfop
    | Voice
    | Member


{-| Default avatars shown before overflow collapses the rest. -}
defaultCap : Int
defaultCap =
    5


{-| Minimal member shape the pile needs. -}
type alias MemberInput =
    { nick : String
    , modes : Set Char
    , away : Bool
    , lastActiveAt : Maybe Int
    }


{-| A visible pile entry. -}
type alias Entry =
    { nick : String
    , role : RoleKey
    , away : Bool
    , owner : Bool
    }


{-| The full pile result. -}
type alias Pile =
    { entries : List Entry
    , total : Int
    , overflow : Int
    }


{-| Highest-precedence role held (mirroring `resolveRole`). -}
roleOfModes : Set Char -> RoleKey
roleOfModes modes =
    if Set.member 'Y' modes then
        Netop

    else if Set.member 'Q' modes then
        Founder

    else if Set.member 'q' modes then
        Owner

    else if Set.member 'a' modes then
        Admin

    else if Set.member 'o' modes then
        Op

    else if Set.member 'h' modes then
        Halfop

    else if Set.member 'v' modes then
        Voice

    else
        Member


roleRank : RoleKey -> Int
roleRank role =
    case role of
        Netop ->
            0

        Founder ->
            1

        Owner ->
            2

        Admin ->
            3

        Op ->
            4

        Halfop ->
            5

        Voice ->
            6

        Member ->
            7


toEntry : MemberInput -> Entry
toEntry member =
    let
        role =
            roleOfModes member.modes
    in
    { nick = member.nick
    , role = role
    , away = member.away
    , owner = role == Founder || role == Owner
    }


{-| Dedupe by case-insensitive nick, first occurrence wins. -}
dedupe : List MemberInput -> List MemberInput
dedupe members =
    let
        step member ( seen, kept ) =
            let
                key =
                    String.toLower (String.trim member.nick)
            in
            if key == "" || Set.member key seen then
                ( seen, kept )

            else
                ( Set.insert key seen, member :: kept )
    in
    List.reverse (Tuple.second (List.foldl step ( Set.empty, [] ) members))


compareMembers : MemberInput -> MemberInput -> Order
compareMembers a b =
    let
        rankDiff =
            compare (roleRank (roleOfModes a.modes)) (roleRank (roleOfModes b.modes))
    in
    if rankDiff /= EQ then
        rankDiff

    else
        let
            awayDiff =
                compare (boolToInt a.away) (boolToInt b.away)
        in
        if awayDiff /= EQ then
            awayDiff

        else
            let
                aRecent =
                    Maybe.withDefault -1 a.lastActiveAt

                bRecent =
                    Maybe.withDefault -1 b.lastActiveAt
            in
            if aRecent /= bRecent then
                -- Newer first. Timestamps are non-negative, so the
                -- reversed comparison cannot overflow.
                compare bRecent aRecent

            else
                let
                    ci =
                        compare (String.toLower a.nick) (String.toLower b.nick)
                in
                if ci /= EQ then
                    ci

                else
                    compare a.nick b.nick


boolToInt : Bool -> Int
boolToInt value =
    if value then
        1

    else
        0


{-| Cap normalization (mirroring `normalizeCap`). -}
normalizeCap : Maybe Int -> Int
normalizeCap cap =
    case cap of
        Nothing ->
            defaultCap

        Just n ->
            max 0 n


{-| Build the complete pile (mirroring `buildFacepile`). The
decorated index keeps the sort stable regardless of the sort
implementation underneath.
-}
buildFacepile : List MemberInput -> Maybe Int -> Pile
buildFacepile members cap =
    let
        unique =
            dedupe members

        limit =
            normalizeCap cap

        indexed =
            List.indexedMap Tuple.pair unique

        sorted =
            List.sortWith
                (\( i, a ) ( j, b ) ->
                    case compareMembers a b of
                        EQ ->
                            compare i j

                        ord ->
                            ord
                )
                indexed
                |> List.map Tuple.second

        visible =
            List.take limit sorted
    in
    { entries = List.map toEntry visible
    , total = List.length unique
    , overflow = max 0 (List.length unique - List.length visible)
    }


{-| The visible entries alone (mirroring
`pickFacepileMembers`). -}
pickFacepileMembers : List MemberInput -> Maybe Int -> List Entry
pickFacepileMembers members cap =
    (buildFacepile members cap).entries


{-| Accessible group name (mirroring the ribbon `groupLabel`). -}
groupLabel : Int -> String
groupLabel count =
    String.fromInt count ++ (if count == 1 then " person here" else " people here")
