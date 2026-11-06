module View.Roster exposing (roster)

{-| Member roster grouped by resolved role — network operators,
founders, owners, admins, ops, half-ops, voice, then plain members —
each with a count. Role resolution follows the learned ISUPPORT
PREFIX declaration order first (mirroring `memberGroups.ts`), so an
exotic server letter ranks instead of dropping.
-}

import App exposing (Member, Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, button, div, h2, li, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, id)
import Html.Events exposing (onClick)
import Html.Lazy as Lazy
import Modes
import View.Stewardship exposing (roomCareButton)
import View.Bans exposing (banPanel)


roster : Model -> Html Msg
roster model =
    section [ class "onyx-roster", id "client-members", attribute "aria-label" "Members" ]
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
                            [ roomCareButton model name
                            , Lazy.lazy4 rosterGroups
                                channel.name
                                channel.members
                                model.isupport.prefixOrder
                                model.isupport.modeToPrefix
                            , banPanel model name
                            ]
        ]


rosterGroups : String -> Dict.Dict String Member -> List Char -> Dict.Dict Char Char -> Html Msg
rosterGroups channelName channelMembers prefixOrder modeToPrefix =
    let
        withRoles =
            List.map
                (\m -> ( Modes.resolveRole m.modes prefixOrder modeToPrefix, m ))
                (Dict.values channelMembers)

        group key =
            withRoles
                |> List.filter (\( role, _ ) -> role.key == key)
                |> List.sortWith (\( _, a ) ( _, b ) -> Modes.compareNicks a.nick b.nick)
    in
    div []
        (Modes.roleSequence
            |> List.concatMap
                (\key ->
                    case group key of
                        [] ->
                            []

                        members ->
                            [ div [ class "onyx-roster-group" ]
                                [ h2 [] [ text (Modes.groupLabelFor key ++ " (" ++ String.fromInt (List.length members) ++ ")") ]
                                , ul [] (List.map (\( role, m ) -> rosterRow channelName role m) members)
                                ]
                            ]
                )
        )


{-| Short role badge for a member row ("Owner", "Mod", …). -}
roleBadge : Modes.ResolvedRole -> String
roleBadge role =
    case role.key of
        "netop" ->
            "Staff"

        "founder" ->
            "Founder"

        "owner" ->
            "Owner"

        "admin" ->
            "Admin"

        "op" ->
            "Mod"

        "halfop" ->
            "Helper"

        "voice" ->
            "Voice"

        _ ->
            role.label


rosterRow : String -> Modes.ResolvedRole -> Member -> Html Msg
rosterRow channel role member =
    li
        [ classList
            [ ( "onyx-member", True )
            , ( "onyx-away", member.away )
            ]
        ]
        [ button
            [ attribute "type" "button"
            , class "onyx-member-row"
            , attribute "aria-label" ("View network profile for " ++ member.nick ++ (if member.away then ", away" else ""))
            , onClick (App.WhoisRequest member.nick)
            ]
            [ Avatar.view
                { name = member.nick
                , owner = role.key == "owner" || role.key == "founder"
                , size = Avatar.Sm
                , extraClass = ""
                , hidden = True
                }
            , span [ class "onyx-member-nick" ] [ text member.nick ]
            , if String.isEmpty (String.trim role.symbol) then
                text ""

              else
                span [ class "onyx-member-badge", attribute "title" role.label ] [ text (roleBadge role) ]
            , span [ class "onyx-member-presence-dot", classList [ ( "is-away", member.away ) ], attribute "aria-hidden" "true" ] []
            ]
        ]
