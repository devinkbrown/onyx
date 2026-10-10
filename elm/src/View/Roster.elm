module View.Roster exposing (roster)

{-| Member roster grouped by resolved role — network operators,
founders, owners, admins, ops, half-ops, voice, then plain members —
each with a count. Role resolution follows the learned ISUPPORT
PREFIX declaration order first (mirroring `memberGroups.ts`), so an
exotic server letter ranks instead of dropping.

v3/roster: a "Filter members" field (Escape clears), a header count
(`N` or `visible/total`, named but never a live region), avatar with a
presence dot per row, the role as a word plus "Away" in text, and a
per-row Message action (double-click the row too) that opens the DM
through `MemberMessage` — the same path the profile card uses.
Grouping and filtering live in the pure `Roster` module.
-}

import App exposing (Channel, Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, button, div, h2, input, label, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, for, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, preventDefaultOn, stopPropagationOn)
import Json.Decode as Decode
import Roster
import View.Stewardship exposing (roomCareButton)


roster : Model -> Html Msg
roster model =
    let
        activeChannel =
            model.activeChannel
                |> Maybe.andThen (\name -> Dict.get (String.toLower name) model.channels)
    in
    section [ class "onyx-roster" ]
        (case ( model.activeChannel, activeChannel ) of
            ( Just name, Just channel ) ->
                let
                    groups =
                        Roster.groupMembers model.isupport.prefixOrder model.isupport.modeToPrefix (Dict.values channel.members)

                    visible =
                        Roster.filterGroups model.memberFilter groups
                in
                [ header model.memberFilter (Roster.totalCount visible) (Roster.totalCount groups)
                , roomCareButton model name
                ]
                    ++ (if List.isEmpty groups then
                            [ p [ class "onyx-roster-empty" ] [ text "No one here yet" ] ]

                        else
                            filterField model.memberFilter
                                :: (if List.isEmpty visible then
                                        [ p
                                            [ class "onyx-roster-empty"
                                            , attribute "data-testid" "member-filter-empty"
                                            , attribute "role" "status"
                                            ]
                                            [ text ("No members match “" ++ String.trim model.memberFilter ++ "”.") ]
                                        ]

                                    else
                                        List.map (rosterGroup model channel) visible
                                   )
                       )

            _ ->
                [ h2 [] [ text "Members" ]
                , div [ class "onyx-empty-small" ] [ text "—" ]
                ]
        )


header : String -> Int -> Int -> Html Msg
header query visible total =
    div [ class "onyx-roster-head" ]
        [ h2 [] [ text "Members" ]
        , span
            [ class "onyx-roster-count"
            , attribute "aria-label" (Roster.countAriaLabel query visible total)
            ]
            [ text (Roster.countText query visible total) ]
        ]


filterField : String -> Html Msg
filterField query =
    div [ class "onyx-roster-filter", attribute "role" "search" ]
        [ label [ class "sr-only", for "onyx-member-filter" ] [ text "Filter members" ]
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
    div [ class "onyx-roster-group" ]
        [ h2 [] [ text (group.label ++ " (" ++ String.fromInt (List.length group.members) ++ ")") ]
        , ul [] (List.map (\e -> rosterRow model channel.name e) group.members)
        ]


rosterRow : Model -> String -> Roster.Entry { away : Bool } -> Html Msg
rosterRow model channel entry =
    let
        member =
            entry.member

        role =
            entry.role

        self =
            Roster.isSelf model.ourNick member.nick
    in
    li
        ([ classList
            [ ( "onyx-member", True )
            , ( "onyx-away", member.away )
            ]
         , attribute "title" "Double-click to message"
         ]
            ++ (if self then
                    []

                else
                    [ preventDefaultOn "dblclick" (Decode.succeed ( MemberMessage member.nick, True )) ]
               )
        )
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
        , span [ class "onyx-member-prefix", attribute "aria-hidden" "true" ] [ text role.symbol ]
        , span [ class "onyx-member-identity" ]
            [ button
                [ attribute "type" "button"
                , class "onyx-member-nick"
                , attribute "aria-label" ("View member card for " ++ member.nick)
                , onClick (App.UserProfileOpened { nick = member.nick, channel = channel })
                ]
                [ text member.nick ]
            , span [ class "onyx-member-role" ] [ text (Roster.rowSummary role member.away) ]
            ]
        , span [ class "onyx-member-row-actions" ]
            ((if self then
                []

              else
                [ button
                    [ attribute "type" "button"
                    , class "onyx-member-message"
                    , attribute "data-testid" "member-row-message"
                    , attribute "aria-label" ("Message " ++ member.nick)
                    , onClick (MemberMessage member.nick)
                    ]
                    [ text "Message" ]
                ]
             )
                ++ [ button
                        [ attribute "type" "button"
                        , class "onyx-member-profile"
                        , attribute "aria-label" ("View network profile for " ++ member.nick)
                        , onClick (App.WhoisRequest member.nick)
                        ]
                        [ text "Profile" ]
                   ]
            )
        ]
