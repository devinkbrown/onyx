module View.Invite exposing (route, view)

{-| Invite landing page, mirroring `src/routes/Invite.tsx`: the join
door (destination card, preview, access note) plus the display-name
form (validation, join link, clipboard copy, sign-in escape hatch),
inside the public frame with the "Friends" context line.

Fold ownership: the query card, join/sign-in hrefs, and name
validation live in `App` (`inviteCard`, `inviteJoinHref`,
`inviteSignInHref`); the copy round-trip is the `ClipboardCopy`
outbound with a single-flight guard. Document metadata beyond the
title (description/meta dance) stays ports-side.

Narrowings: the decorative vein SVG is a CSS-owned `div` (no elm/svg
dependency — the artwork is `aria-hidden` either way); moving focus
to the name field on a failed submit is a DOM behaviour; the PWA
update-coordinator hold while typing stays ports-side.
-}

import App exposing (InviteCopy(..), Model, Msg(..), inviteCard, inviteJoinHref, inviteSignInHref)
import Html exposing (Html, a, aside, button, div, form, h1, input, label, p, section, span, text)
import Html.Attributes exposing (attribute, class, disabled, href, id, maxlength, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, preventDefaultOn)
import Invite
import Json.Decode as Decode
import View.PublicFrame exposing (frame)


contextLine : Html Msg
contextLine =
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text "Friends" ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text "Invite" ]
        ]


copyButtonLabel : InviteCopy -> String
copyButtonLabel copy =
    case copy of
        CopyBusy ->
            "Copying link…"

        CopyCopied ->
            "Copied link"

        _ ->
            "Copy link"


copyStatusText : InviteCopy -> String
copyStatusText copy =
    case copy of
        CopyCopied ->
            "Invite link copied to clipboard."

        CopyFailed ->
            "Copy failed. You can still join below."

        _ ->
            ""


destination : Invite.InviteCard -> Html Msg
destination card =
    let
        heading =
            case card.channel of
                Just "#root" ->
                    "Join #root"

                _ ->
                    Invite.inviteHeadline card

        roomMark =
            String.left 1 (Maybe.withDefault "#" card.channel)
    in
    aside [ class "invite-destination" ]
        ([ div [ class "invite-identity" ]
            [ span [ class "invite-room-mark", attribute "aria-hidden" "true" ] [ text roomMark ]
            , div [ class "invite-identity-copy" ]
                [ h1 [ id "invite-heading" ] [ text heading ]
                , p [ class "invite-lede" ] [ text (Invite.inviteWelcome card) ]
                ]
            ]
         ]
            ++ (if card.channel == Nothing then
                    [ p [ class "invite-recovery", attribute "role" "note" ]
                        [ text "This link does not name a room. Open Onyx and choose one there, or ask your friend for a new room invite." ]
                    ]

                else
                    [ div [ class "invite-preview", attribute "role" "note", attribute "aria-label" "Invite preview" ]
                        ([ p [ class "invite-preview-title" ] [ text (Invite.inviteTitle card) ]
                         , p [ class "invite-preview-desc" ] [ text (Invite.inviteDescription card) ]
                         ]
                            ++ (case card.topic of
                                    Just topic ->
                                        [ p [ class "invite-preview-topic" ] [ text topic ] ]

                                    Nothing ->
                                        []
                               )
                        )
                    ]
               )
            ++ [ p [ class "invite-access-note", attribute "role" "note" ]
                    [ text "This link points to a destination. The room still applies its own access rules when you join." ]
               ]
        )


joinForm : Model -> Html Msg
joinForm model =
    let
        invalid =
            Invite.guestNameError model.inviteName /= Nothing

        busy =
            model.inviteCopy == CopyBusy

        joinLink =
            if invalid then
                a [ class "r-btn primary", attribute "data-testid" "invite-join", onClick InviteJoinSubmit ]
                    [ text "Join" ]

            else
                a [ class "r-btn primary", href (inviteJoinHref model), attribute "data-testid" "invite-join" ]
                    [ text "Join" ]
    in
    div [ class "invite-form-panel" ]
        [ form [ class "invite-join", preventDefaultOn "submit" (Decode.succeed ( InviteJoinSubmit, True )) ]
            [ div [ class "form-field" ]
                ([ label [ attribute "for" "invite-display-name" ] [ text "Display name" ]
                 , input
                    [ id "invite-display-name"
                    , type_ "text"
                    , placeholder "your-name"
                    , attribute "autocomplete" "username"
                    , maxlength 64
                    , value model.inviteName
                    , onInput InviteNameInput
                    ]
                    []
                 ]
                    ++ (case model.inviteNameError of
                            Just err ->
                                [ p [ class "form-field-error", attribute "role" "alert" ] [ text err ] ]

                            Nothing ->
                                []
                       )
                )
            , div [ class "invite-actions" ]
                [ joinLink
                , button
                    [ type_ "button"
                    , class "r-btn ghost"
                    , disabled busy
                    , attribute "aria-busy" (if busy then "true" else "false")
                    , onClick InviteCopyRequest
                    ]
                    [ text (copyButtonLabel model.inviteCopy) ]
                ]
            ]
        , p [ class "invite-alt" ]
            [ text "Already have an account? "
            , a [ href (inviteSignInHref model) ] [ text "Sign in" ]
            ]
        , p [ class "invite-alt" ]
            [ a [ href "/about/" ] [ text "How Onyx works" ] ]
        , p
            [ class "invite-copy-status"
            , attribute "role" (if model.inviteCopy == CopyFailed then "alert" else "status")
            , attribute "aria-live" (if model.inviteCopy == CopyFailed then "assertive" else "polite")
            , attribute "aria-atomic" "true"
            ]
            [ text (copyStatusText model.inviteCopy) ]
        ]


{-| The invite body. -}
view : Model -> Html Msg
view model =
    let
        card =
            inviteCard model
    in
    div [ class "ui-root r invite-page" ]
        [ div [ class "r-ground", attribute "aria-hidden" "true" ] []
        , div [ class "r-flecks", attribute "aria-hidden" "true" ] []
        , div [ class "r-veins", attribute "aria-hidden" "true" ] []
        , div [ class "r-grain", attribute "aria-hidden" "true" ] []
        , section [ class "invite-door", attribute "aria-labelledby" "invite-heading" ]
            [ destination card
            , joinForm model
            ]
        ]


{-| The invite route inside the public frame. -}
route : Model -> List (Html Msg)
route model =
    [ frame model "/invite/" "Onyx invite" (Just contextLine) [ view model ] ]
