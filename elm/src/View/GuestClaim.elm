module View.GuestClaim exposing (guestClaim)

{-| Guest claim affordance — the in-session "keep this nick" chip and
claim sheet mirroring `GuestClaimPrompt.tsx` (compact dismissible chip
outside the composer column; sheet runs REGISTER → optional VERIFY →
IDENTIFY on the live socket without disconnecting).

Visibility mirrors `showChip` (guest + non-empty live nick + not
dismissed) and `FirstHour.shouldSuppressGuestClaim` via
`guestClaimVisible`. The sheet mirrors the prompt's two forms (register vs verify
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
import RuntimeDomain


guestClaim : Model -> Html Msg
guestClaim model =
    div []
        [ if guestClaimVisible model then
            chip model

          else
            text ""
        , if model.guestClaimOpen && model.accountName == Nothing && not (String.isEmpty (String.trim model.ourNick)) then
            sheet model

          else
            text ""
        ]


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
        [ p [ class "guest-claim-chip__text" ]
            [ text "Keep "
            , b [ class "guest-claim-chip__nick" ] [ text nick ]
            , text "?"
            ]
        , div [ class "guest-claim-chip__actions" ]
            [ button
                [ type_ "button"
                , class "guest-claim-chip__keep"
                , attribute "data-testid" "guest-claim-open"
                , attribute "aria-label" "Keep this name"
                , onClick GuestClaimOpen
                ]
                [ text "Keep" ]
            , button
                [ type_ "button"
                , class "guest-claim-chip__dismiss"
                , attribute "aria-label" "Dismiss keep-name prompt"
                , attribute "data-testid" "guest-claim-dismiss"
                , onClick GuestClaimDismiss
                ]
                [ span [ attribute "aria-hidden" "true" ] [ text "✕" ] ]
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
            model.guestClaimPhase == ClaimVerifying
                || model.verifyRequired
                || Maybe.map (\status -> status.outcome == "account-registered") model.privateAccountStatus == Just True

        verified =
            Maybe.map (\status -> status.outcome == "email-verified") model.privateAccountStatus == Just True
    in
    div [ class "guest-claim-veil" ]
        [ div
            [ class "guest-claim-sheet"
            , attribute "role" "dialog"
            , attribute "aria-modal" "true"
            , attribute "aria-label" "Keep this name"
            , attribute "data-testid" "guest-claim-sheet"
            ]
            [ p [ class "guest-claim-sheet__lede" ]
                [ text
                    (if verified then
                        "Your account email is verified. Sign in separately when you are ready."

                     else
                        "Create an account for the name you are using. You stay connected while it is set up."
                    )
                ]
            , if verified then
                button [ type_ "button", attribute "aria-label" "Close keep this name", onClick GuestClaimClose ] [ text "Close" ]

              else if verifying then
                if model.runtimeOwnerStamp /= Nothing then
                    div []
                        [ privateGuestForm busy "Verify your account email" "The verification code is entered in a private browser form." "account-verify" "account-verify" (if String.isEmpty model.guestClaimNick then String.trim model.ourNick else model.guestClaimNick)
                        , privateRecoveryControls model
                        ]
                else
                    verifyForm model busy

              else if model.runtimeOwnerStamp /= Nothing then
                div []
                    [ privateGuestForm busy "Create your account" "Password and optional recovery email are collected in a private browser form." "account-register" "account-register" (String.trim model.ourNick)
                    , privateRecoveryControls model
                    ]

              else
                registerForm model busy
            ]
        ]


privateGuestForm : Bool -> String -> String -> String -> String -> String -> Html Msg
privateGuestForm busy title description kind action account =
    div [ class "guest-claim-sheet__form", attribute "aria-label" title ]
        [ p [ class "guest-claim-sheet__lede" ] [ text description ]
        , p [ class "guest-claim-sheet__hint" ] [ text ("Account name: " ++ account) ]
        , button
            [ type_ "button"
            , class "guest-claim-sheet__submit"
            , disabled busy
            , onClick (App.RuntimePrivateAccountFormRequested { kind = kind, action = action, account = Just account })
            ]
            [ text title ]
        , button [ type_ "button", disabled busy, attribute "aria-label" "Close keep this name", onClick GuestClaimClose ] [ text "Close" ]
        ]


privateRecoveryControls : Model -> Html Msg
privateRecoveryControls model =
    let
        account =
            if String.isEmpty model.guestClaimNick then
                String.trim model.ourNick
            else
                String.trim model.guestClaimNick
    in
    div [ class "guest-claim-sheet__actions", attribute "aria-label" "Account recovery" ]
        [ button
            [ type_ "button"
            , disabled (String.isEmpty account)
            , onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "password-reset-request" Nothing (Just account)))
            ]
            [ text "Request a password reset" ]
        , button
            [ type_ "button"
            , disabled (String.isEmpty account)
            , onClick (App.RuntimePrivateAccountFormRequested { kind = "password-reset-confirm", action = "password-reset-confirm", account = Just account })
            ]
            [ text "Enter a reset code" ]
        ]


errorRow : Model -> Html Msg
errorRow model =
    case claimErrorText model of
        Just err ->
            p [ class "guest-claim-sheet__error", attribute "role" "alert" ]
                [ span [ attribute "aria-hidden" "true" ] [ text "⚠" ]
                , text (" " ++ err)
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
