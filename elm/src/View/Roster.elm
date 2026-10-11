module View.Roster exposing (membersToggle, roster)

{-| Member list for the active room.

v3/ui-roster — a calm list in the Discord / Slack mould:

  - **Sections, in words, with counts.** Role groups resolve exactly as
    before (learned ISUPPORT PREFIX order first, `Roster.groupMembers`),
    then `Roster.presenceGroups` keeps the people who are here in their
    role section — plain members read "Online" — and gathers everyone
    away into one dimmed "Away" section at the end. Every section is a
    native disclosure (`details` / `summary`), so long groups collapse
    with no model state; a long Away section starts collapsed.
  - **One clean line per person.** Avatar with a presence dot and the
    full name; the whole line is one button that opens the existing
    member card (Message, Mention, Block, Report, network profile).
    The role and away words stay in the row's text for screen readers
    ("Voice · Away") and only show on screen where the section does
    not already say it (an operator who is away). Mode letters never
    render. Double-click still opens the DM. On fine pointers a single
    Message icon appears on hover / focus; touch rows carry no buttons.
  - **Filter only when needed.** Up to 20 members the field folds into
    a search icon in the list header (CSS expands it on focus or while
    it holds a query); above 20 it is always open. Escape clears it.
  - **Phone / narrow.** The section is an `auto` popover
    (`id="onyx-members"`): wide layouts show it in flow as the 240px
    context rail; below 1100px it is hidden and `membersToggle` (a
    people icon with the count in the room header) opens it as a sheet
    — the browser owns open/close, light dismiss and Escape.

-}

import App exposing (Channel, Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, button, details, div, h2, input, label, li, p, section, span, summary, text, ul)
import Html.Attributes exposing (attribute, class, classList, for, id, placeholder, title, type_, value)
import Html.Events exposing (onClick, onInput, preventDefaultOn, stopPropagationOn)
import Json.Decode as Decode
import Roster
import View.Icon exposing (icon)
import View.Stewardship exposing (roomCareButton)


{-| The popover id the room-header toggle targets. -}
sheetId : String
sheetId =
    "onyx-members"


{-| Above this many members the filter field is always open. -}
filterAlwaysAbove : Int
filterAlwaysAbove =
    20


{-| An Away section longer than this starts collapsed. -}
awayFoldAbove : Int
awayFoldAbove =
    8


roster : Model -> Html Msg
roster model =
    let
        activeChannel =
            model.activeChannel
                |> Maybe.andThen (\name -> Dict.get (String.toLower name) model.channels)
    in
    section
        [ class "onyx-roster"
        , id sheetId
        , attribute "popover" "auto"
        , attribute "aria-label" "Members"
        ]
        (case ( model.activeChannel, activeChannel ) of
            ( Just name, Just channel ) ->
                let
                    groups =
                        Roster.groupMembers model.isupport.prefixOrder model.isupport.modeToPrefix (Dict.values channel.members)

                    total =
                        Roster.totalCount groups

                    visible =
                        Roster.presenceGroups (Roster.filterGroups model.memberFilter groups)

                    filterOpen =
                        total > filterAlwaysAbove || not (String.isEmpty (String.trim model.memberFilter))
                in
                [ header model.memberFilter (Roster.totalCount visible) total (not (List.isEmpty groups)) filterOpen ]
                    ++ (if List.isEmpty groups then
                            [ p [ class "onyx-roster-empty" ] [ text "No one here yet" ] ]

                        else
                            filterField model.memberFilter filterOpen
                                :: (if List.isEmpty visible then
                                        [ p
                                            [ class "onyx-roster-empty"
                                            , attribute "data-testid" "member-filter-empty"
                                            , attribute "role" "status"
                                            ]
                                            [ text ("No members match “" ++ String.trim model.memberFilter ++ "”.") ]
                                        ]

                                    else
                                        [ div [ class "onyx-mlist-groups" ] (List.map (rosterGroup model channel) visible) ]
                                   )
                       )
                    ++ [ div [ class "onyx-mlist-foot" ] [ roomCareButton model name ] ]

            _ ->
                [ div [ class "onyx-roster-head" ]
                    [ h2 [ class "onyx-mlist-title" ] [ text "Members" ] ]
                , div [ class "onyx-empty-small" ] [ text "—" ]
                ]
        )


{-| The room-header entry for narrow layouts: a people icon with the
member count that opens the member sheet (`popovertarget`). Rooms only;
hidden by CSS where the context rail is on screen.
-}
membersToggle : Model -> Html Msg
membersToggle model =
    case model.activeChannel |> Maybe.andThen (\name -> Dict.get (String.toLower name) model.channels) of
        Just channel ->
            if App.isChannelName model channel.name then
                let
                    total =
                        Dict.size channel.members
                in
                button
                    [ type_ "button"
                    , class "onyx-members-toggle onyx-room-header-btn"
                    , attribute "popovertarget" sheetId
                    , attribute "data-testid" "members-toggle"
                    , attribute "aria-keyshortcuts" "Alt+M" -- v3/gap-commands
                    , attribute "aria-label"
                        ("Members, "
                            ++ String.fromInt total
                            ++ (if total == 1 then
                                    " person"

                                else
                                    " people"
                               )
                        )
                    , title "Members"
                    ]
                    [ icon "people"
                    , span [ class "onyx-members-toggle-count", attribute "aria-hidden" "true" ] [ text (String.fromInt total) ]
                    ]

            else
                text ""

        Nothing ->
            text ""


header : String -> Int -> Int -> Bool -> Bool -> Html Msg
header query visible total any filterOpen =
    div [ class "onyx-roster-head" ]
        [ h2 [ class "onyx-mlist-title" ] [ text "Members" ]
        , span
            [ class "onyx-roster-count"
            , attribute "aria-label" (Roster.countAriaLabel query visible total)
            ]
            [ text (Roster.countText query visible total) ]
        , if any && not filterOpen then
            -- The folded filter: the icon is the field's label, so a
            -- click focuses the field and CSS unfolds it.
            label
                [ class "onyx-mlist-find"
                , for "onyx-member-filter"
                , title "Filter members"
                ]
                [ icon "search", span [ class "sr-only" ] [ text "Filter members" ] ]

          else
            text ""
        , button
            [ type_ "button"
            , class "onyx-mlist-close"
            , attribute "popovertarget" sheetId
            , attribute "popovertargetaction" "hide"
            , attribute "aria-label" "Close members"
            , title "Close"
            ]
            [ icon "x" ]
        ]


filterField : String -> Bool -> Html Msg
filterField query open =
    div
        [ classList
            [ ( "onyx-roster-filter", True )
            , ( "onyx-roster-filter--open", open )
            ]
        , attribute "role" "search"
        ]
        [ label [ class "sr-only", for "onyx-member-filter" ] [ text "Filter members" ]
        , icon "search"
        , input
            [ id "onyx-member-filter"
            , class "onyx-roster-filter-input"
            , type_ "search"
            , attribute "data-testid" "member-filter"
            , placeholder "Filter members"
            , attribute "autocomplete" "off"
            , attribute "spellcheck" "false"
            , value query
            , onInput MemberFilterInput
            , stopPropagationOn "keydown" (escapeClears query)
            ]
            []
        ]


{-| Escape clears a non-empty filter and stops there (the oracle
`preventDefault` + `stopPropagation`); any other key passes through.
-}
escapeClears : String -> Decode.Decoder ( Msg, Bool )
escapeClears query =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                if key == "Escape" && not (String.isEmpty query) then
                    Decode.succeed ( MemberFilterInput "", True )

                else
                    Decode.fail "pass"
            )


rosterGroup : Model -> Channel -> Roster.Group { away : Bool } -> Html Msg
rosterGroup model channel group =
    let
        count =
            List.length group.members

        startsOpen =
            group.key /= "away" || count <= awayFoldAbove
    in
    details
        ([ classList
            [ ( "onyx-roster-group", True )
            , ( "onyx-roster-group--away", group.key == "away" )
            ]
         , attribute "data-group" group.key
         ]
            ++ (if startsOpen then
                    [ attribute "open" "" ]

                else
                    []
               )
        )
        [ summary [ class "onyx-mlist-group-head" ]
            [ h2 [ class "onyx-mlist-group-title" ]
                [ span [] [ text group.label ]
                , span [ class "onyx-mlist-group-count" ] [ text (String.fromInt count) ]
                ]
            , icon "chevron-down"
            ]
        , ul [ class "onyx-mlist-rows" ] (List.map (\e -> rosterRow model channel.name group.key e) group.members)
        ]


rosterRow : Model -> String -> String -> Roster.Entry { away : Bool } -> Html Msg
rosterRow model channel groupKey entry =
    let
        member =
            entry.member

        role =
            entry.role

        self =
            Roster.isSelf model.ourNick member.nick

        -- The section heading already names the role (and Away); the
        -- row repeats it on screen only for elevated people listed
        -- under Away.
        hintShown =
            groupKey == "away" && role.key /= "member"
    in
    li
        ([ classList
            [ ( "onyx-member", True )
            , ( "onyx-away", member.away )
            , ( "onyx-member--self", self )
            ]
         ]
            ++ (if self then
                    []

                else
                    [ attribute "title" "Double-click to message"
                    , preventDefaultOn "dblclick" (Decode.succeed ( MemberMessage member.nick, True ))
                    ]
               )
        )
        ([ button
            [ type_ "button"
            , class "onyx-mlist-main"
            , attribute "aria-label" ("View member card for " ++ member.nick)
            , -- v3/gap-organize: on phones the list is a top-layer popover, which
              -- would sit over the card this opens; choosing someone closes it
              -- (the browser's own hide action; a no-op where the list is in flow)
              attribute "popovertarget" sheetId
            , attribute "popovertargetaction" "hide"
            , onClick (App.UserProfileOpened { nick = member.nick, channel = channel })
            ]
            [ span [ class "onyx-member-avatar-slot" ]
                [ Avatar.view
                    { name = member.nick
                    , owner = role.key == "owner" || role.key == "founder"
                    , size = Avatar.Sm
                    , extraClass = ""
                    , hidden = True
                    }
                , span
                    [ classList
                        [ ( "onyx-member-presence-dot", True )
                        , ( "onyx-member-presence-dot--away", member.away )
                        ]
                    , attribute "aria-hidden" "true"
                    ]
                    []
                ]
            , span [ class "onyx-mlist-name" ] [ text member.nick ]
            , if self then
                span [ class "onyx-mlist-you", attribute "aria-hidden" "true" ] [ text "you" ]

              else
                text ""
            ]
         , span
            [ classList
                [ ( "onyx-member-role", True )
                , ( "onyx-member-role--shown", hintShown )
                ]
            ]
            [ text (Roster.rowSummary role member.away) ]
         ]
            ++ (if self then
                    []

                else
                    [ button
                        [ type_ "button"
                        , class "onyx-member-message"
                        , attribute "data-testid" "member-row-message"
                        , attribute "aria-label" ("Message " ++ member.nick)
                        , title ("Message " ++ member.nick)
                        , Html.Attributes.tabindex -1
                        , onClick (MemberMessage member.nick)
                        ]
                        [ icon "message" ]
                    ]
               )
        )
