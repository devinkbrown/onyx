module RosterTest exposing (suite)

{-| v3/roster vectors, mirroring `src/lib/memberGroups.test.ts`
(grouping/sorting), `src/shell/MemberList.a11y.test.tsx` (count
names, filter, away in text) and `src/shell/PeopleProfileCard.test.tsx`
(Message / Report): pure helpers through `Roster`, behavior through
`App.update`, rendering through `View.view`.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Roster
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


rosterOf : Model -> Query.Single Msg
rosterOf model =
    query model |> Query.find [ Selector.class "onyx-roster" ]


user : String -> String -> { nick : String, modes : Set.Set Char, away : Bool }
user nick modes =
    { nick = nick, modes = Set.fromList (String.toList modes), away = False }


prefix : Dict.Dict Char Char
prefix =
    Dict.fromList [ ( 'Y', '*' ), ( 'Q', '!' ), ( 'q', '.' ), ( 'o', '@' ), ( 'h', '%' ), ( 'v', '+' ) ]


order : List Char
order =
    [ 'Y', 'Q', 'q', 'o', 'h', 'v' ]


nicksOf : Roster.Group a -> List String
nicksOf group =
    List.map (\e -> e.member.nick) group.members


room : Model
room =
    blank
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":alice!u@h JOIN #c")
        |> (\m -> feed m ":s 353 me = #c :me @alice +bob carol")
        |> step (ChannelSelect "#c")


suite : Test
suite =
    describe "v3/roster"
        [ describe "Roster.groupMembers"
            [ test "sorts by role precedence then alphabetically within a group" <|
                \_ ->
                    let
                        groups =
                            Roster.groupMembers order prefix [ user "zoe" "o", user "amy" "o", user "bob" "", user "cal" "v" ]
                    in
                    Expect.all
                        [ \g -> Expect.equal [ "op", "voice", "member" ] (List.map .key g)
                        , \g -> Expect.equal [ [ "amy", "zoe" ], [ "cal" ], [ "bob" ] ] (List.map nicksOf g)
                        , \g -> Expect.equal [ "Ops", "Voice", "Members" ] (List.map .label g)
                        ]
                        groups
            , test "groups by highest-precedence role (Yo → netop, qv → owner)" <|
                \_ ->
                    Roster.groupMembers order prefix [ user "a" "Yo", user "b" "qv", user "c" "hv" ]
                        |> List.map .key
                        |> Expect.equal [ "netop", "owner", "halfop" ]
            , test "an empty roster has no groups and a zero count" <|
                \_ ->
                    Roster.groupMembers order prefix (List.drop 1 [ user "x" "" ])
                        |> Roster.totalCount
                        |> Expect.equal 0
            ]
        , describe "Roster.presenceGroups (v3/ui-roster)"
            [ test "here stays in its role section, plain members read Online, away gathers last" <|
                \_ ->
                    let
                        away nick modes =
                            { nick = nick, modes = Set.fromList (String.toList modes), away = True }

                        groups =
                            Roster.groupMembers order prefix
                                [ user "zoe" "o", away "amy" "o", user "bob" "", away "cal" "v", away "abe" "", user "dee" "v" ]
                                |> Roster.presenceGroups
                    in
                    Expect.all
                        [ \g -> Expect.equal [ "op", "voice", "member", "away" ] (List.map .key g)
                        , \g -> Expect.equal [ "Ops", "Voice", "Online", "Away" ] (List.map .label g)
                        , \g -> Expect.equal [ [ "zoe" ], [ "dee" ], [ "bob" ], [ "abe", "amy", "cal" ] ] (List.map nicksOf g)
                        ]
                        groups
            , test "a role whose members are all away drops out; no away means no Away section" <|
                \_ ->
                    let
                        allAway =
                            Roster.groupMembers order prefix [ { nick = "op1", modes = Set.fromList [ 'o' ], away = True }, user "m" "" ]
                                |> Roster.presenceGroups

                        allHere =
                            Roster.groupMembers order prefix [ user "op1" "o", user "m" "" ]
                                |> Roster.presenceGroups
                    in
                    Expect.equal ( [ "member", "away" ], [ "op", "member" ] )
                        ( List.map .key allAway, List.map .key allHere )
            ]
        , describe "Roster.filterGroups"
            [ test "trimmed, case-insensitive nick substring; empty groups drop out" <|
                \_ ->
                    Roster.groupMembers order prefix [ user "Alice" "o", user "bob" "v", user "malia" "" ]
                        |> Roster.filterGroups "  ALI "
                        |> List.map nicksOf
                        |> Expect.equal [ [ "Alice" ], [ "malia" ] ]
            , test "a blank query keeps every group" <|
                \_ ->
                    let
                        groups =
                            Roster.groupMembers order prefix [ user "a" "o", user "b" "" ]
                    in
                    Expect.equal groups (Roster.filterGroups "   " groups)
            , test "matchesFilter" <|
                \_ ->
                    Expect.equal [ True, True, False ]
                        [ Roster.matchesFilter "" "x", Roster.matchesFilter "Ob" "bob", Roster.matchesFilter "z" "bob" ]
            ]
        , describe "count labels"
            [ test "singular / plural / filtered accessible names" <|
                \_ ->
                    Expect.equal [ "1 member", "2 members", "1 of 3 members shown" ]
                        [ Roster.countAriaLabel "" 1 1, Roster.countAriaLabel "" 2 2, Roster.countAriaLabel "a" 1 3 ]
            , test "visible count text is total, or visible/total while filtering" <|
                \_ ->
                    Expect.equal [ "3", "1/3" ] [ Roster.countText "" 3 3, Roster.countText "a" 1 3 ]
            , test "row summary names the role in words and away in text" <|
                \_ ->
                    Expect.equal [ "Op", "Voice · Away" ]
                        [ Roster.rowSummary { key = "op", label = "Op", symbol = "@", sort = 4 } False
                        , Roster.rowSummary { key = "voice", label = "Voice", symbol = "+", sort = 6 } True
                        ]
            ]
        , describe "roster view"
            [ test "header count carries an accessible name and is not a live region" <|
                \_ ->
                    rosterOf room
                        |> Query.find [ Selector.class "onyx-roster-count" ]
                        |> Expect.all
                            [ Query.has [ Selector.text "4", Selector.attribute (Attr.attribute "aria-label" "4 members") ]
                            , Query.hasNot [ Selector.attribute (Attr.attribute "aria-live" "polite") ]
                            ]
            , test "filter field uses the oracle copy and test id" <|
                \_ ->
                    rosterOf room
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "member-filter") ]
                        |> Query.has [ Selector.attribute (Attr.placeholder "Filter members") ]
            , test "typing filters rows and reports visible/total" <|
                \_ ->
                    rosterOf room
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "member-filter") ]
                        |> Event.simulate (Event.input "ali")
                        |> Event.expect (MemberFilterInput "ali")
            , test "a filtered roster shows only matches with visible/total" <|
                \_ ->
                    let
                        q =
                            rosterOf (step (MemberFilterInput "ALI") room)
                    in
                    Expect.all
                        [ \_ -> q |> Query.findAll [ Selector.class "onyx-member" ] |> Query.count (Expect.equal 1)
                        , \_ -> q |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "1 of 4 members shown") ]
                        , \_ -> q |> Query.has [ Selector.text "1/4" ]
                        ]
                        ()
            , test "no match renders the oracle empty status" <|
                \_ ->
                    rosterOf (step (MemberFilterInput " zz ") room)
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "member-filter-empty") ]
                        |> Query.has [ Selector.text "No members match “zz”.", Selector.attribute (Attr.attribute "role" "status") ]
            , test "Escape clears a non-empty filter" <|
                \_ ->
                    rosterOf (step (MemberFilterInput "ali") room)
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "member-filter") ]
                        |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "Escape" ) ]))
                        |> Event.expect (MemberFilterInput "")
            , test "roles render as words, never mode letters" <|
                \_ ->
                    rosterOf room
                        |> Query.findAll [ Selector.class "onyx-member-role" ]
                        |> Query.first
                        |> Query.has [ Selector.text "Op" ]
            , test "away is stated in text beside the role" <|
                \_ ->
                    rosterOf (feed room ":bob!u@h AWAY :lunch")
                        |> Query.has [ Selector.text "Voice · Away", Selector.class "onyx-member-presence-dot--away" ]
            , test "a row's Message action opens the DM via MemberMessage" <|
                \_ ->
                    rosterOf room
                        |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Message alice") ]
                        |> Event.simulate Event.click
                        |> Event.expect (MemberMessage "alice")
            , test "double-clicking a row opens the DM" <|
                \_ ->
                    rosterOf room
                        |> Query.findAll [ Selector.class "onyx-member" ]
                        |> Query.first
                        |> Event.simulate Event.doubleClick
                        |> Event.expect (MemberMessage "alice")
            , test "your own row offers no Message action" <|
                \_ ->
                    rosterOf room
                        |> Expect.all
                            [ Query.has [ Selector.attribute (Attr.attribute "aria-label" "View member card for me") ]
                            , Query.findAll [ Selector.attribute (Attr.attribute "aria-label" "Message me") ]
                                >> Query.count (Expect.equal 0)
                            ]
            , test "rows are one button that opens the member card" <|
                \_ ->
                    rosterOf room
                        |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "View member card for alice") ]
                        |> Event.simulate Event.click
                        |> Event.expect (UserProfileOpened { nick = "alice", channel = "#c" })
            , test "the list is a popover sheet the room header can open" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            rosterOf room
                                |> Query.has [ Selector.attribute (Attr.attribute "popover" "auto"), Selector.id "onyx-members" ]
                        , \_ ->
                            query room
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "members-toggle") ]
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "popovertarget" "onyx-members")
                                    , Selector.attribute (Attr.attribute "aria-label" "Members, 4 people")
                                    ]
                        ]
                        ()
            , test "a small room folds the filter behind a search icon" <|
                \_ ->
                    Expect.all
                        [ \_ -> rosterOf room |> Query.has [ Selector.class "onyx-mlist-find" ]
                        , \_ -> rosterOf room |> Query.hasNot [ Selector.class "onyx-roster-filter--open" ]
                        , \_ -> rosterOf (step (MemberFilterInput "al") room) |> Query.has [ Selector.class "onyx-roster-filter--open" ]
                        ]
                        ()
            , test "MemberMessage selects the DM" <|
                \_ ->
                    step (MemberMessage "alice") room
                        |> .activeChannel
                        |> Maybe.map String.toLower
                        |> Expect.equal (Just "alice")
            , test "the filter survives as plain local state (no wire output)" <|
                \_ ->
                    update (MemberFilterInput "x") room
                        |> Tuple.second
                        |> Expect.equal []
            ]
        , describe "profile card actions"
            [ test "Message on the card opens the DM through the same path" <|
                \_ ->
                    query (step (UserProfileOpened { nick = "alice", channel = "#c" }) room)
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "member-card-message") ]
                        |> Event.simulate Event.click
                        |> Event.expect (MemberMessage "alice")
            , test "Report stages the person-safety report sheet" <|
                \_ ->
                    query (step (UserProfileOpened { nick = "alice", channel = "#c" }) room)
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "member-card-report") ]
                        |> Event.simulate Event.click
                        |> Event.expect (SafetyOpenReport { nick = "alice", guest = True })
            , test "the staged report renders the safety sheet" <|
                \_ ->
                    step (SafetyOpenReport { nick = "alice", guest = True }) room
                        |> .personSafety
                        |> Maybe.map .reason
                        |> Expect.equal (Just "harassment")
            ]
        ]
