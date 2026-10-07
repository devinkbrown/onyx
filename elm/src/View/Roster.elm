module View.Roster exposing (roster)

{-| Member roster grouped by resolved role — network operators,
founders, owners, admins, ops, half-ops, voice, then plain members —
each with a count. Role resolution follows the learned ISUPPORT
PREFIX declaration order first (mirroring `memberGroups.ts`), so an
exotic server letter ranks instead of dropping.
-}

import App exposing (Channel, Member, Model, Msg(..))
import Dict
import Html exposing (Html, button, div, h2, li, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList)
import Html.Events exposing (onClick)
import Modes
import View.Stewardship exposing (roomCareButton)


roster : Model -> Html Msg
roster model =
    section [ class "onyx-roster" ]
        [ h2 [] [ text "Members" ]
        , case model.activeChannel of
            Nothing ->
                div [ class "onyx-empty-small" ] [ text "—" ]

            Just name ->
                case Dict.get (String.toLower name) model.channels of
                    Nothing ->
                        div [ class "onyx-empty-small" ] [ text "—" ]

                    Just channel ->
                        div []
                            ([ roomCareButton model name ]
                                ++ rosterGroups model channel
                            )
        ]


rosterGroups : Model -> Channel -> List (Html Msg)
rosterGroups model channel =
    let
        withRoles =
            List.map
                (\m -> ( Modes.resolveRole m.modes model.isupport.prefixOrder model.isupport.modeToPrefix, m ))
                (Dict.values channel.members)

        group key =
            withRoles
                |> List.filter (\( role, _ ) -> role.key == key)
                |> List.sortWith (\( _, a ) ( _, b ) -> Modes.compareNicks a.nick b.nick)
    in
    Modes.roleSequence
        |> List.concatMap
            (\key ->
                case group key of
                    [] ->
                        []

                    members ->
                        [ div [ class "onyx-roster-group" ]
                            [ h2 [] [ text (Modes.groupLabelFor key ++ " (" ++ String.fromInt (List.length members) ++ ")") ]
                            , ul [] (List.map (\( role, m ) -> rosterRow role m) members)
                            ]
                        ]
            )


rosterRow : Modes.ResolvedRole -> Member -> Html Msg
rosterRow role member =
    li
        [ classList
            [ ( "onyx-member", True )
            , ( "onyx-away", member.away )
            ]
        ]
        [ span [ class "onyx-member-prefix" ] [ text role.symbol ]
        , span [] [ text member.nick ]
        , button
            [ attribute "type" "button"
            , class "onyx-member-profile"
            , attribute "aria-label" ("View network profile for " ++ member.nick)
            , onClick (App.WhoisRequest member.nick)
            ]
            [ text "Profile" ]
        ]
