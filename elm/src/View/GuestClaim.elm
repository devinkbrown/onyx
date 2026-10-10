module View.GuestClaim exposing (guestClaim, guestClaimChip, guestClaimSheet)

{-| Guest claim affordance — the in-session "keep this nick" chip and
claim sheet mirroring `GuestClaimPrompt.tsx` (compact dismissible chip
outside the composer column; sheet runs REGISTER → optional VERIFY →
IDENTIFY on the live socket without disconnecting).

Visibility mirrors `showChip` (guest + non-empty live nick + not
dismissed; the first-hour handoff suppress has no Elm state and stays
ahead). The sheet mirrors the prompt's two forms (register vs verify
when `ClaimVerifying` or `verifyRequired`), verbatim copy and error
precedence (local error, then `registerError`, then the IDENTIFY
`accountActionError`), busy gating (submit disabled + close refused
while pending or identifying), and the `data-testid` hooks. Focus
trap/Escape stay with the ports layer's DOM concerns, as with the
reclaim dialog.
-}

import App exposing (GuestClaimPhase(..), Model, Msg(..), guestClaimMinPassword, guestClaimVisible, isGuestClaimBusy)
import Html exposing (Html, b, button, div, form, input, label, p, span, text)
import Html.Attributes exposing (attribute, class, disabled, for, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import View.Sheet as Sheet


guestClaim : Model -> Html Msg
guestClaim model =
    div [] [ guestClaimChip model, guestClaimSheet model ]


{-| v3/frame — the "Keep the name" chip. v3/ui-mobile-shell: a compact,
dismissible banner on Home (the You hub keeps "Keep this name" too);
it never sits over a conversation. -}
guestClaimChip : Model -> Html Msg
guestClaimChip model =
    if guestClaimVisible model then
        chip model

    else
        text ""


{-| v3/frame — the claim sheet (the frame's overlay layer). -}
guestClaimSheet : Model -> Html Msg
guestClaimSheet model =
    if model.guestClaimOpen && model.accountName == Nothing && not (String.isEmpty (String.trim model.ourNick)) then
        sheet model

    else
        text ""


chip : Model -> Html Msg
chip model =
    let
        nick =
            String.trim model.ourNick
    in
    div
        [ class "guest-claim-chip"
        , attribute "role" "region"
        , attribute "aria-label" "Keep this name"
        , attribute "data-testid" "guest-claim"
        ]
        [ span [ class "guest-claim-chip__icon onyx-shi", attribute "data-icon" "key", attribute "aria-hidden" "true" ] []
        , p [ class "guest-claim-chip__text" ]
            [ span [ class "guest-claim-chip__line" ]
                [ text "Keep the name "
                , b [ class "guest-claim-chip__nick" ] [ text nick ]
                ]
            , span [ class "guest-claim-chip__hint" ] [ text "Register it so it stays yours. You stay connected." ]
            ]
        , div [ class "guest-claim-chip__actions" ]
            [ button
                [ type_ "button"
                , class "guest-claim-chip__keep"
                , attribute "data-testid" "guest-claim-open"
                , attribute "aria-label" "Keep this name"
                , onClick GuestClaimOpen
                ]
                [ text "Keep name" ]
            , button
                [ type_ "button"
                , class "guest-claim-chip__dismiss"
                , attribute "aria-label" "Dismiss keep-name prompt"
                , attribute "title" "Not now"
                , attribute "data-testid" "guest-claim-dismiss"
                , onClick GuestClaimDismiss
                ]
                [ span [ class "onyx-shi", attribute "data-icon" "close", attribute "aria-hidden" "true" ] [] ]
            ]
        ]


claimErrorText : Model -> Maybe String
claimErrorText model =
    case model.guestClaimError of
        Just local ->
            Just local

        Nothing ->
            case model.registerError of
                Just server ->
                    Just server

                Nothing ->
                    case model.accountActionError of
                        Just err ->
                            if err.command == "IDENTIFY" then
                                Just
                                    (if String.isEmpty err.description then
                                        err.code

                                     else
                                        err.description
                                    )

                            else
                                Nothing

                        Nothing ->
                            Nothing


sheet : Model -> Html Msg
sheet model =
    let
        busy =
            isGuestClaimBusy model

        verifying =
            model.guestClaimPhase == ClaimVerifying || model.verifyRequired
    in
    Sheet.view
        { scope = "guest-claim"
        , label = Sheet.LabelledBy (Sheet.titleId "guest-claim")
        , onClose = GuestClaimClose
        , placement = Sheet.Center
        , layerClass = "guest-claim-veil"
        , panelClass = "guest-claim-sheet"
        , backdropClass = ""
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "data-testid" "guest-claim-sheet" ]
        }
            [ Sheet.headerWith
                (Sheet.head { scope = "guest-claim", title = "Keep this name", closeLabel = "Close keep this name", onClose = GuestClaimClose }
                    |> (\h -> { h | subtitle = Just "Create an account for the name you are using. You stay connected while it is set up." })
                )
            , if verifying then
                verifyForm model busy

              else
                registerForm model busy
            ]


errorRow : Model -> Html Msg
errorRow model =
    case claimErrorText model of
        Just err ->
            p [ class "guest-claim-sheet__error", attribute "role" "alert" ]
                [ span [ class "ui-icon ui-icon--alert", attribute "aria-hidden" "true" ] []
                , text err
                ]

        Nothing ->
            text ""


registerForm : Model -> Bool -> Html Msg
registerForm model busy =
    form
        [ class "guest-claim-sheet__form"
        , attribute "aria-label" "Keep this name"
        , attribute "data-testid" "guest-claim-form"
        , onSubmit GuestClaimSubmit
        ]
        [ label [ class "guest-claim-sheet__label", for "guest-claim-nick" ] [ text "Name" ]
        , input
            [ type_ "text"
            , id "guest-claim-nick"
            , attribute "data-testid" "guest-claim-nick"
            , attribute "autocomplete" "username"
            , attribute "readonly" "true"
            , value (String.trim model.ourNick)
            ]
            []
        , p [ class "guest-claim-sheet__hint" ] [ text "Your current name on this connection (not editable here)." ]
        , label [ class "guest-claim-sheet__label", for "guest-claim-password" ] [ text "Password" ]
        , input
            [ type_ "password"
            , id "guest-claim-password"
            , placeholder ("at least " ++ String.fromInt guestClaimMinPassword ++ " characters")
            , attribute "autocomplete" "new-password"
            , value model.guestClaimPassword
            , onInput GuestClaimPasswordInput
            ]
            []
        , label [ class "guest-claim-sheet__label", for "guest-claim-email" ] [ text "Recovery email (optional)" ]
        , input
            [ type_ "email"
            , id "guest-claim-email"
            , placeholder "you@example.com"
            , attribute "autocomplete" "email"
            , value model.guestClaimEmail
            , onInput GuestClaimEmailInput
            ]
            []
        , p [ class "guest-claim-sheet__hint" ] [ text "Optional. Used if the server requires verification or later recovery." ]
        , errorRow model
        , div [ class "guest-claim-sheet__actions" ]
            [ button
                [ type_ "submit"
                , class "guest-claim-sheet__submit"
                , attribute "data-testid" "guest-claim-submit"
                , disabled busy
                ]
                [ text
                    (if model.guestClaimPhase == ClaimIdentifying then
                        "Signing in"

                     else
                        "Create account"
                    )
                ]
            , button
                [ type_ "button"
                , class "guest-claim-sheet__cancel"
                , attribute "data-testid" "guest-claim-not-now"
                , disabled busy
                , onClick GuestClaimClose
                ]
                [ text "Not now" ]
            ]
        ]


verifyForm : Model -> Bool -> Html Msg
verifyForm model busy =
    form
        [ class "guest-claim-sheet__form"
        , attribute "aria-label" "Verify your name"
        , attribute "data-testid" "guest-claim-verify-form"
        , onSubmit GuestClaimVerifySubmit
        ]
        [ p [ class "guest-claim-sheet__lede" ]
            [ text "Enter the verification code sent for "
            , b [ class "guest-claim-chip__nick" ]
                [ text
                    (if String.isEmpty model.guestClaimNick then
                        String.trim model.ourNick

                     else
                        model.guestClaimNick
                    )
                ]
            , text "."
            ]
        , label [ class "guest-claim-sheet__label", for "guest-claim-verify" ] [ text "Verification code" ]
        , input
            [ type_ "text"
            , id "guest-claim-verify"
            , attribute "inputmode" "numeric"
            , attribute "autocomplete" "one-time-code"
            , value model.guestClaimVerifyCode
            , onInput GuestClaimVerifyInput
            ]
            []
        , errorRow model
        , div [ class "guest-claim-sheet__actions" ]
            [ button
                [ type_ "submit"
                , class "guest-claim-sheet__submit"
                , attribute "data-testid" "guest-claim-verify-submit"
                , disabled busy
                ]
                [ text "Verify" ]
            ]
        ]
