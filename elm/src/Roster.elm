module Roster exposing
    ( Entry
    , Group
    , countAriaLabel
    , countText
    , filterGroups
    , groupMembers
    , isSelf
    , matchesFilter
    , rowSummary
    , totalCount
    )

{-| Pure member-list logic for the v3 roster (mirroring
`src/lib/memberGroups.ts` grouping plus the `visibleGroups` /
`totalCount` / count-label memos in `src/shell/MemberList.tsx`).

Groups follow `Modes.roleSequence` with role words from
`Modes.groupLabelFor`; members sort with `Modes.compareNicks`. The
filter is a trimmed, case-insensitive nick substring match; an empty
query keeps every group. Groups emptied by the filter drop out.

-}

import Dict exposing (Dict)
import Modes
import Set exposing (Set)


type alias Entry a =
    { role : Modes.ResolvedRole
    , member : { a | nick : String, modes : Set Char }
    }


type alias Group a =
    { key : String
    , label : String
    , members : List (Entry a)
    }


{-| Resolve each member's highest role, then bucket by role key in
the rendered group order, alphabetical within a group.
-}
groupMembers : List Char -> Dict Char Char -> List { a | nick : String, modes : Set Char } -> List (Group a)
groupMembers prefixOrder modeToPrefix members =
    let
        entries =
            List.map
                (\m -> { role = Modes.resolveRole m.modes prefixOrder modeToPrefix, member = m })
                members
    in
    Modes.roleSequence
        |> List.filterMap
            (\key ->
                case
                    entries
                        |> List.filter (\e -> e.role.key == key)
                        |> List.sortWith (\a b -> Modes.compareNicks a.member.nick b.member.nick)
                of
                    [] ->
                        Nothing

                    inGroup ->
                        Just { key = key, label = Modes.groupLabelFor key, members = inGroup }
            )


{-| Trimmed, case-insensitive nick substring match. -}
matchesFilter : String -> String -> Bool
matchesFilter query nick =
    let
        q =
            String.toLower (String.trim query)
    in
    String.isEmpty q || String.contains q (String.toLower nick)


filterGroups : String -> List (Group a) -> List (Group a)
filterGroups query groups =
    if String.isEmpty (String.trim query) then
        groups

    else
        groups
            |> List.map (\g -> { g | members = List.filter (\e -> matchesFilter query e.member.nick) g.members })
            |> List.filter (\g -> not (List.isEmpty g.members))


totalCount : List (Group a) -> Int
totalCount groups =
    List.sum (List.map (\g -> List.length g.members) groups)


{-| Visible header count: `visible/total` while filtering, else the
total (the desktop roster variant of the oracle).
-}
countText : String -> Int -> Int -> String
countText query visible total =
    if String.isEmpty (String.trim query) then
        String.fromInt total

    else
        String.fromInt visible ++ "/" ++ String.fromInt total


{-| Accessible name for the header count (not a live region). -}
countAriaLabel : String -> Int -> Int -> String
countAriaLabel query visible total =
    if String.isEmpty (String.trim query) then
        String.fromInt total
            ++ (if total == 1 then
                    " member"

                else
                    " members"
               )

    else
        String.fromInt visible ++ " of " ++ String.fromInt total ++ " members shown"


{-| Visible role-and-presence line: the role word, plus "Away". -}
rowSummary : Modes.ResolvedRole -> Bool -> String
rowSummary role away =
    if away then
        role.label ++ " · Away"

    else
        role.label


{-| Self rows get no Message action (oracle `openDmFromRow` no-op). -}
isSelf : String -> String -> Bool
isSelf ourNick nick =
    String.toLower ourNick == String.toLower nick
