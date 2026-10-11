module View.AuthGate exposing (connectNote, gate, signInLinks, takesOver)

{-| v3/gap-auth — the auth steps the connect gate was missing, drawn in
the connect card's own visual language (`conn-*` classes, plus the
`ga-*` additions in `css/gap-auth.css`):

  - two-step sign-in code entry (after the server's two-factor 904);
  - the pre-001 CHALLENGE question, and an honest stop when the
    connection check fails or the question times out;
  - passkey sign-in (WEBAUTHN AUTH on a plain connection);
  - forgot password (RESETPASS request → code + new password → done).

`gate` replaces the connect form while a step is active (`takesOver`).
`signInLinks` and `connectNote` are the two small hooks the regular
connect form carries (Forgot password / passkey, and the "connection
check" note while a proof of work is being solved). Secrets typed here
(codes, new passwords) live only until they are sent.

-}

import App exposing (Model, Msg(..))
import AuthGate exposing (Challenge(..), ChallengeStop(..), Flow(..), PasskeyPhase(..), ResetPhase(..), TwoFactorPhase(..))
import Html exposing (Html, a, button, div, form, h1, input, label, main_, nav, p, span, strong, text)
import Html.Attributes exposing (attribute, autocomplete, class, classList, disabled, for, href, id, maxlength, placeholder, tabindex, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import View.PublicFrame exposing (brandMark)


takesOver : Model -> Bool
takesOver model =
    AuthGate.takesOver model.authGate


gate : Model -> Html Msg
gate model =
    let
        state =
            model.authGate
    in
    let
        current =
            panel model state
    in
    main_ [ class "conn ga", attribute "data-testid" "auth-gate" ]
        [ div [ class "conn-card" ]
            [ -- One column normally; two side by side on a short
              -- landscape window (css/gap-auth.css), so the field and
              -- its button stay on screen.
              div [ class "ga-grid" ]
                [ div [ class "ga-head" ]
                    (a [ class "conn-brand", href "/", attribute "aria-label" "Onyx home" ]
                        [ brandMark "conn-brand-mark"
                        , span [ class "conn-brand-name" ] [ text "Onyx" ]
                        ]
                        :: current.head
                    )
                , div [ class "ga-body" ] current.body
                ]
            ]
        , nav [ class "conn-foot", attribute "aria-label" "About Onyx" ]
            [ a [ href "/about/" ] [ text "About" ]
            , a [ href "/privacy/" ] [ text "Privacy" ]
            , a [ href "/status/" ] [ text "Status" ]
            ]
        ]


{-| One step of the gate: the words (`head`: title, lede, the question)
and what the person does about them (`body`: form, buttons, links). -}
type alias Step =
    { head : List (Html Msg), body : List (Html Msg) }


panel : Model -> AuthGate.State -> Step
panel model state =
    case state.challenge of
        QuestionAsked asked ->
            questionPanel state asked

        ChallengeStopped stop ->
            stoppedPanel stop

        _ ->
            case state.flow of
                TwoFactor account phase ->
                    twoFactorPanel state account phase

                PasskeySignIn account phase ->
                    passkeyPanel model state account phase

                Reset phase ->
                    resetPanel state phase

                NoFlow ->
                    { head = [], body = [] }



-- PIECES


title : String -> Html Msg
title copy =
    h1 [ class "conn-title", id "auth-title", tabindex -1 ] [ text copy ]


lede : List (Html Msg) -> Html Msg
lede children =
    p [ class "conn-body" ] children


msg : AuthGate.Msg -> Msg
msg =
    AuthGateMsg


type alias FieldCfg =
    { id_ : String
    , label_ : String
    , kind : String
    , auto : String
    , placeholder_ : String
    , value_ : String
    , error : Maybe String
    , hint : Maybe String
    , busy : Bool
    , extra : List (Html.Attribute Msg)
    , onInput_ : String -> AuthGate.Msg
    }


field : FieldCfg -> Html Msg
field cfg =
    let
        errId =
            cfg.id_ ++ "-error"

        hintId =
            cfg.id_ ++ "-hint"

        described =
            case ( cfg.error, cfg.hint ) of
                ( Just _, _ ) ->
                    [ attribute "aria-describedby" errId, attribute "aria-invalid" "true" ]

                ( Nothing, Just _ ) ->
                    [ attribute "aria-describedby" hintId ]

                _ ->
                    []
    in
    div [ class "conn-field" ]
        [ label [ for cfg.id_, class "conn-label" ] [ text cfg.label_ ]
        , input
            ([ id cfg.id_
             , type_ cfg.kind
             , class "conn-input"
             , placeholder cfg.placeholder_
             , autocomplete (cfg.auto /= "off")
             , attribute "autocomplete" cfg.auto
             , attribute "spellcheck" "false"
             , attribute "autocapitalize" "off"
             , attribute "data-testid" cfg.id_
             , value cfg.value_
             , disabled cfg.busy
             , onInput (cfg.onInput_ >> AuthGateMsg)
             ]
                ++ cfg.extra
                ++ described
            )
            []
        , case cfg.error of
            Just err ->
                p [ id errId, class "conn-error", attribute "role" "alert" ] [ text err ]

            Nothing ->
                case cfg.hint of
                    Just hint ->
                        p [ id hintId, class "conn-hint" ] [ text hint ]

                    Nothing ->
                        text ""
        ]


submitRow : { label_ : String, testid : String, enabled : Bool, cancel : Maybe ( String, AuthGate.Msg ) } -> Html Msg
submitRow cfg =
    div [ class "conn-actions" ]
        (button
            [ type_ "submit"
            , class "conn-submit"
            , disabled (not cfg.enabled)
            , attribute "data-testid" cfg.testid
            ]
            [ text cfg.label_ ]
            :: (case cfg.cancel of
                    Just ( label_, cancelMsg ) ->
                        [ button
                            [ type_ "button"
                            , class "conn-cancel"
                            , onClick (msg cancelMsg)
                            , attribute "data-testid" "auth-cancel"
                            ]
                            [ text label_ ]
                        ]

                    Nothing ->
                        []
               )
        )


status : String -> Bool -> Html Msg
status copy busy =
    p
        [ classList [ ( "conn-status", True ), ( "conn-status-busy", busy ), ( "conn-status-idle", String.isEmpty copy ) ]
        , attribute "role" "status"
        , attribute "aria-live" "polite"
        , attribute "data-testid" "auth-status"
        ]
        [ text copy ]


linkButton : String -> String -> AuthGate.Msg -> Bool -> Html Msg
linkButton testid copy target off =
    button
        [ type_ "button"
        , class "conn-link"
        , disabled off
        , onClick (msg target)
        , attribute "data-testid" testid
        ]
        [ text copy ]


alt : List (Html Msg) -> Html Msg
alt items =
    nav [ class "conn-alt ga-alt", attribute "aria-label" "Other options" ]
        [ div [ class "ga-alt-row" ] items ]



-- CHALLENGE


questionPanel : AuthGate.State -> { question : String, error : Maybe String, sent : Bool } -> Step
questionPanel state asked =
    { head =
        [ title "One quick question"
        , lede [ text "Onyx is asking new connections to answer a question before they join. It keeps automated sign-ups out during busy moments." ]
        , div [ class "ga-question", attribute "data-testid" "auth-challenge-question" ]
            [ span [ class "ga-question-label" ] [ text "Question" ]
            , p [ class "ga-question-text" ] [ text asked.question ]
            ]
        ]
    , body =
    [ form [ class "conn-form", attribute "aria-label" "Answer the question", attribute "novalidate" "", onSubmit (msg AuthGate.AnswerSubmit) ]
        [ field
            { id_ = "auth-answer"
            , label_ = "Your answer"
            , kind = "text"
            , auto = "off"
            , placeholder_ = "type your answer"
            , value_ = state.answer
            , error = asked.error
            , hint = Just "Answer soon — the connection times out if you wait too long."
            , busy = asked.sent
            , extra = [ maxlength 64 ]
            , onInput_ = AuthGate.AnswerInput
            }
        , submitRow
            { label_ =
                if asked.sent then
                    "Checking…"

                else
                    "Continue"
            , testid = "auth-answer-submit"
            , enabled = not asked.sent && not (String.isEmpty (String.trim state.answer))
            , cancel = Just ( "Cancel", AuthGate.ChallengeDismiss )
            }
        , status
            (if asked.sent then
                "Checking your answer."

             else
                ""
            )
            asked.sent
        ]
    ]
    }


stoppedPanel : ChallengeStop -> Step
stoppedPanel stop =
    let
        ( heading, body ) =
            case stop of
                StopPowRejected ->
                    ( "Connection check didn't pass"
                    , "Onyx is asking new connections to complete a quick automatic check, and this browser's answer wasn't accepted. Wait a moment, then try again."
                    )

                StopTimedOut ->
                    ( "That took too long"
                    , "The question has to be answered soon after connecting, and the connection timed out first. Try again for a fresh one."
                    )
    in
    { head = [ title heading, lede [ text body ] ]
    , body =
        [ div [ class "conn-actions ga-actions" ]
            [ button
                [ type_ "button"
                , class "conn-submit"
                , id "auth-retry"
                , onClick (msg AuthGate.ChallengeRetry)
                , attribute "data-testid" "auth-retry"
                ]
                [ text "Try again" ]
            , button
                [ type_ "button"
                , class "conn-cancel"
                , onClick (msg AuthGate.ChallengeDismiss)
                , attribute "data-testid" "auth-cancel"
                ]
                [ text "Back" ]
            ]
        ]
    }



-- TWO-STEP


twoFactorPanel : AuthGate.State -> String -> TwoFactorPhase -> Step
twoFactorPanel state account phase =
    let
        busy =
            phase /= TfaCode

        ( submitLabel, statusCopy ) =
            case phase of
                TfaCode ->
                    ( "Verify", "" )

                TfaDialing ->
                    ( "Connecting…", "Connecting to Onyx." )

                TfaVerifying ->
                    ( "Checking…", "Checking your code." )
    in
    { head =
        [ title "Two-step sign-in"
        , lede
            [ text "Open your authenticator app and enter the code for "
            , strong [] [ text account ]
            , text "."
            ]
        ]
    , body =
    [ form [ class "conn-form", attribute "aria-label" "Authentication code", attribute "novalidate" "", onSubmit (msg AuthGate.CodeSubmit) ]
        [ field
            { id_ = "auth-code"
            , label_ = "Authentication code"
            , kind = "text"
            , auto = "one-time-code"
            , placeholder_ = "123456"
            , value_ = state.code
            , error = state.error
            , hint = Just "The code changes every 30 seconds."
            , busy = busy
            , extra = [ class "ga-code ga-otp", attribute "inputmode" "numeric", attribute "pattern" "[0-9 ]*", maxlength 10 ]
            , onInput_ = AuthGate.CodeInput
            }
        , submitRow
            { label_ = submitLabel
            , testid = "auth-code-submit"
            , enabled = not busy && AuthGate.normalizeTotpCode state.code /= Nothing
            , cancel = Just ( "Cancel", AuthGate.Cancel )
            }
        , status statusCopy busy
        ]
    , alt [ linkButton "auth-use-recovery" "Use a recovery code instead" AuthGate.UseRecoveryCode busy ]
    ]
    }



-- PASSKEY


passkeyPanel : Model -> AuthGate.State -> String -> PasskeyPhase -> Step
passkeyPanel model state account phase =
    let
        problem =
            case state.error of
                Just err ->
                    Just err

                Nothing ->
                    if phase == PkWaiting && not model.passkey.busy then
                        model.passkey.error

                    else
                        Nothing

        statusCopy =
            case ( phase, problem ) of
                ( _, Just _ ) ->
                    ""

                ( PkDialing, Nothing ) ->
                    "Connecting to Onyx."

                ( PkWaiting, Nothing ) ->
                    "Waiting for your passkey…"

                ( PkStopped, Nothing ) ->
                    ""

        canRetry =
            problem /= Nothing || phase == PkStopped
    in
    { head =
        [ title "Sign in with a passkey"
        , lede
            [ text "Use the passkey saved for "
            , strong [] [ text account ]
            , text ". Your browser or phone will ask you to confirm it's you."
            ]
        ]
    , body =
    [ case problem of
        Just err ->
            p [ class "conn-error ga-problem", attribute "role" "alert", attribute "data-testid" "auth-passkey-error" ] [ text err ]

        Nothing ->
            text ""
    , div [ class "conn-actions ga-actions" ]
        ((if canRetry then
            [ button
                [ type_ "button"
                , class "conn-submit"
                , onClick (msg AuthGate.PasskeyRetry)
                , attribute "data-testid" "auth-passkey-retry"
                ]
                [ text "Try again" ]
            ]

          else
            [ button [ type_ "button", class "conn-submit", disabled True ]
                [ text
                    (if phase == PkDialing then
                        "Connecting…"

                     else
                        "Waiting…"
                    )
                ]
            ]
         )
            ++ [ button
                    [ type_ "button"
                    , class "conn-cancel"
                    , onClick (msg AuthGate.Cancel)
                    , attribute "data-testid" "auth-cancel"
                    ]
                    [ text "Cancel" ]
               ]
        )
    , status statusCopy (statusCopy /= "")
    , alt [ linkButton "auth-passkey-password" "Use your password instead" AuthGate.Cancel False ]
    ]
    }



-- RESET


resetPanel : AuthGate.State -> ResetPhase -> Step
resetPanel state phase =
    case phase of
        ResetAsk ->
            resetAskPanel state False

        ResetAsking ->
            resetAskPanel state True

        ResetEnter ->
            resetEnterPanel state False

        ResetSetting ->
            resetEnterPanel state True

        ResetDone ->
            { head =
                [ title "Password changed"
                , lede
                    [ text "You can now sign in to "
                    , strong [] [ text state.resetAccount ]
                    , text " with your new password."
                    ]
                ]
            , body =
                [ div [ class "conn-actions ga-actions" ]
                    [ button
                        [ type_ "button"
                        , class "conn-submit"
                        , id "auth-done"
                        , onClick (msg AuthGate.DoneSignIn)
                        , attribute "data-testid" "auth-done"
                        ]
                        [ text "Sign in" ]
                    ]
                ]
            }


resetAskPanel : AuthGate.State -> Bool -> Step
resetAskPanel state busy =
    { head =
        [ title "Reset your password"
        , lede [ text "Enter your account name. If the account has a verified email address, we'll send a reset code to it." ]
        ]
    , body =
    [ form [ class "conn-form", attribute "aria-label" "Request a reset code", attribute "novalidate" "", onSubmit (msg AuthGate.ResetRequestSubmit) ]
        [ field
            { id_ = "auth-reset-account"
            , label_ = "Account name"
            , kind = "text"
            , auto = "username"
            , placeholder_ = "your-name"
            , value_ = state.resetAccount
            , error = state.error
            , hint = Nothing
            , busy = busy
            , extra = [ maxlength 64 ]
            , onInput_ = AuthGate.ResetAccountInput
            }
        , submitRow
            { label_ =
                if busy then
                    "Sending…"

                else
                    "Email me a code"
            , testid = "auth-reset-request"
            , enabled = not busy && not (String.isEmpty (String.trim state.resetAccount))
            , cancel = Just ( "Cancel", AuthGate.Cancel )
            }
        , status
            (if busy then
                "Asking Onyx for a reset code."

             else
                ""
            )
            busy
        ]
    , alt [ linkButton "auth-reset-have-code" "I already have a code" AuthGate.ResetHaveCode busy ]
    ]
    }


resetEnterPanel : AuthGate.State -> Bool -> Step
resetEnterPanel state busy =
    let
        ready =
            AuthGate.normalizeResetCode state.resetCode
                /= Nothing
                && AuthGate.validateNewPassword state.resetPassword
                == Nothing
                && state.resetPassword
                == state.resetConfirm
    in
    { head =
        [ title "Check your email"
        , lede
            [ text "If "
            , strong [] [ text state.resetAccount ]
            , text " has a verified email address, a reset code is on its way. It expires in 15 minutes."
            ]
        ]
    , body =
    [ form [ class "conn-form", attribute "aria-label" "Set a new password", attribute "novalidate" "", onSubmit (msg AuthGate.ResetConfirmSubmit) ]
        [ field
            { id_ = "auth-reset-code"
            , label_ = "Reset code"
            , kind = "text"
            , auto = "one-time-code"
            , placeholder_ = "32 letters and numbers"
            , value_ = state.resetCode
            , error = Nothing
            , hint = Just "Copy it from the email exactly."
            , busy = busy
            , extra = [ class "ga-code", maxlength 80 ]
            , onInput_ = AuthGate.ResetCodeInput
            }
        , field
            { id_ = "auth-reset-password"
            , label_ = "New password"
            , kind = "password"
            , auto = "new-password"
            , placeholder_ = "at least 8 characters"
            , value_ = state.resetPassword
            , error = Nothing
            , hint = Nothing
            , busy = busy
            , extra = []
            , onInput_ = AuthGate.ResetPasswordInput
            }
        , field
            { id_ = "auth-reset-confirm"
            , label_ = "Confirm new password"
            , kind = "password"
            , auto = "new-password"
            , placeholder_ = "re-enter the new password"
            , value_ = state.resetConfirm
            , error = Nothing
            , hint = Nothing
            , busy = busy
            , extra = []
            , onInput_ = AuthGate.ResetConfirmInput
            }
        , -- The reason is about the whole form (a wrong code, a
          -- mismatch, a refused password), so it sits above the button
          -- rather than under one field.
          case state.error of
            Just err ->
                p [ id "auth-reset-error", class "conn-error", attribute "role" "alert", attribute "data-testid" "auth-reset-error" ] [ text err ]

            Nothing ->
                text ""
        , submitRow
            { label_ =
                if busy then
                    "Saving…"

                else
                    "Set new password"
            , testid = "auth-reset-confirm-submit"
            , enabled = not busy && ready
            , cancel = Just ( "Cancel", AuthGate.Cancel )
            }
        , status
            (if busy then
                "Setting your new password."

             else
                ""
            )
            busy
        ]
    , alt [ linkButton "auth-reset-again" "Send a new code" AuthGate.ResetAgain busy ]
    ]
    }



-- HOOKS ON THE CONNECT FORM


{-| Sign-in mode extras: Forgot password and passkey sign-in. -}
signInLinks : Model -> Bool -> Html Msg
signInLinks model busy =
    div [ class "ga-signin-links" ]
        [ div [ class "ga-signin-row" ]
            [ linkButton "conn-forgot" "Forgot password?" AuthGate.ResetOpen busy
            , if model.passkeyBrowserSupported == Just False then
                text ""

              else
                linkButton "conn-passkey" "Sign in with a passkey" AuthGate.PasskeyStart busy
            ]
        , case ( model.authGate.flow, model.authGate.error ) of
            ( NoFlow, Just err ) ->
                p [ class "conn-error", attribute "role" "alert", attribute "data-testid" "conn-passkey-error" ] [ text err ]

            _ ->
                text ""
        ]


{-| While the network asks for a proof of work, say why the connect
takes a moment longer. -}
connectNote : Model -> Html Msg
connectNote model =
    case model.authGate.challenge of
        PowSolving _ ->
            note

        PowSent ->
            note

        _ ->
            text ""


note : Html Msg
note =
    p [ class "conn-hint ga-note", attribute "data-testid" "conn-challenge-note" ]
        [ text "Onyx is running a quick automatic check on new connections. This only takes a moment." ]

