module View.Connect exposing (gate)

{-| The connect gate: guest / sign in / create account before the shell.

Ported from the v3 client (`c18b9591:elm/src/View/Connect.elm`). Kept:
one primary path with secondary modes under "Other ways to join", a
polite live status line that never names a server, field-level labels
and hints, and the `data-testid` hooks (`connect`, `connect-status`,
`connect-submit`, `connect-mode-*`).

Adapted: the sign-in password field is DOM-owned. It has no `value`
binding and no input handler; it keeps the `connection-password` id the
runtime reads and clears when `PrivateIdentifyRequested` fires (the
same contract as the connection dialog, which never renders while the
gate is up). Create account collects no password here at all: it hands
off to the guest-claim sheet and the runtime's private form. "Look
around first" closes the gate, so nobody is trapped behind it.

-}

import App exposing (ConnectionState(..), Model, Msg(..))
import ConnectGate exposing (Mode(..), Phase(..))
import Html exposing (Html, button, div, form, h1, h2, input, label, main_, nav, p, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, maxlength, name, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)


gate : Model -> ConnectGate.Gate -> Html Msg
gate model current =
    let
        busy =
            current.pending /= Nothing || (current.mode == SignIn && model.identifyReplyAccount /= Nothing)

        phase =
            ConnectGate.phase
                { live = model.connection == Live
                , registering = model.connection == Registering
                , busy = busy
                }

        errorText =
            case current.error of
                Just local ->
                    Just local

                Nothing ->
                    case model.connectionDialogError of
                        Just dialog ->
                            Just dialog

                        Nothing ->
                            if current.mode == SignIn then
                                model.accountActionError
                                    |> Maybe.andThen
                                        (\err ->
                                            if err.command == "IDENTIFY" then
                                                Just
                                                    (if String.isEmpty err.description then
                                                        "Sign-in failed. Check your account details."

                                                     else
                                                        err.description
                                                    )

                                            else
                                                Nothing
                                        )

                            else
                                Nothing
    in
    main_
        [ class "onyx-gate"
        , attribute "data-testid" "connect"
        , attribute "data-mode" (ConnectGate.modeKey current.mode)
        , attribute "aria-labelledby" "connect-title"
        ]
        [ div [ class "onyx-gate-card" ]
            [ div [ class "onyx-gate-brand" ]
                [ span [ class "onyx-gem", attribute "aria-hidden" "true" ] []
                , span [ class "onyx-gate-brand-name" ] [ text "Onyx" ]
                ]
            , h1 [ id "connect-title", class "onyx-gate-title" ] [ text (ConnectGate.title current.mode) ]
            , p [ class "onyx-gate-body" ] [ text (ConnectGate.bodyCopy current.mode) ]
            , div
                [ classList
                    [ ( "onyx-gate-status", True )
                    , ( "onyx-gate-status--offline", phase == Unreachable )
                    , ( "onyx-gate-status--ready", phase == Ready )
                    ]
                , attribute "data-phase" (phaseKey phase)
                ]
                [ p [ attribute "role" "status", attribute "aria-live" "polite", attribute "data-testid" "connect-status" ]
                    [ span [ class "onyx-gate-dot", attribute "aria-hidden" "true" ] []
                    , text (ConnectGate.statusLine current.mode phase model.reconnectIn)
                    ]
                , if phase == Unreachable then
                    button [ type_ "button", class "onyx-gate-secondary", onClick ReconnectNow ] [ text "Reconnect now" ]

                  else
                    text ""
                ]
            , form
                ([ class "onyx-gate-form"
                 , attribute "aria-labelledby" "connect-title"
                 , attribute "novalidate" ""
                 , onSubmit ConnectGateSubmit
                 ]
                    ++ (if current.mode == SignIn then
                            [ attribute "data-private-auth-form" "identify" ]

                        else
                            []
                       )
                )
                (fields model current busy
                    ++ [ case errorText of
                            Just message ->
                                p [ class "onyx-gate-error", attribute "role" "alert", id "connect-error" ] [ text message ]

                            Nothing ->
                                text ""
                       , button
                            [ type_ "submit"
                            , class "onyx-gate-primary"
                            , attribute "data-testid" "connect-submit"
                            , disabled (phase /= Ready)
                            ]
                            [ text (ConnectGate.submitLabel current.mode phase) ]
                       ]
                )
            , nav [ class "onyx-gate-modes", attribute "aria-labelledby" "connect-modes-title", attribute "data-testid" "connect-modes" ]
                [ h2 [ id "connect-modes-title", class "onyx-gate-modes-title" ] [ text "Other ways to join" ]
                , div [ class "onyx-gate-mode-list" ]
                    (List.filterMap (modeButton current.mode busy)
                        [ ( Guest, "Join as a guest" )
                        , ( SignIn, "Sign in" )
                        , ( Register, "Create an account" )
                        ]
                    )
                ]
            , div [ class "onyx-gate-skip" ]
                [ button
                    [ type_ "button"
                    , class "onyx-gate-link"
                    , attribute "data-testid" "connect-skip"
                    , onClick ConnectGateSkip
                    ]
                    [ text "Look around first" ]
                , p [] [ text "Your recent history and drafts stay on this device. You can sign in later from You." ]
                ]
            ]
        ]


phaseKey : Phase -> String
phaseKey phase =
    case phase of
        Connecting ->
            "connecting"

        Ready ->
            "ready"

        Unreachable ->
            "offline"

        Waiting ->
            "waiting"


modeButton : Mode -> Bool -> ( Mode, String ) -> Maybe (Html Msg)
modeButton current busy ( mode, label_ ) =
    if mode == current then
        Nothing

    else
        Just
            (button
                [ type_ "button"
                , class "onyx-gate-secondary"
                , attribute "data-testid" ("connect-mode-" ++ ConnectGate.modeKey mode)
                , disabled busy
                , onClick (ConnectGateMode mode)
                ]
                [ text label_ ]
            )


fields : Model -> ConnectGate.Gate -> Bool -> List (Html Msg)
fields model current busy =
    let
        nameField labelText hint auto =
            field
                { id_ = "connect-name"
                , label_ = labelText
                , hint = hint
                , input_ =
                    input
                        [ id "connect-name"
                        , type_ "text"
                        , class "onyx-gate-input"
                        , value current.name
                        , maxlength
                            (if current.mode == SignIn then
                                64

                             else
                                App.maxNickAliasLength
                            )
                        , placeholder "your-name"
                        , attribute "autocomplete" auto
                        , attribute "autocapitalize" "off"
                        , attribute "spellcheck" "false"
                        , attribute "aria-describedby" "connect-name-hint"
                        , disabled busy
                        , onInput ConnectGateName
                        ]
                        []
                }
    in
    case current.mode of
        Guest ->
            [ nameField "Display name"
                ("Optional. Leave it blank to keep " ++ String.trim model.ourNick ++ ".")
                "nickname"
            , field
                { id_ = "connect-room"
                , label_ = "Room"
                , hint = "Optional. Leave it blank to start on Home and browse rooms."
                , input_ =
                    input
                        [ id "connect-room"
                        , type_ "text"
                        , class "onyx-gate-input"
                        , value current.room
                        , maxlength 64
                        , placeholder "#lounge"
                        , attribute "autocomplete" "off"
                        , attribute "autocapitalize" "off"
                        , attribute "spellcheck" "false"
                        , attribute "aria-describedby" "connect-room-hint"
                        , disabled busy
                        , onInput ConnectGateRoom
                        ]
                        []
                }
            ]

        SignIn ->
            [ nameField "Account name" "The name you registered on Onyx." "username"
            , field
                { id_ = "connection-password"
                , label_ = "Password"
                , hint = "Sent once to sign you in, then cleared from this page."
                , input_ =
                    -- DOM-owned: no value binding, no input handler.
                    input
                        [ id "connection-password"
                        , name "connection-password"
                        , type_ "password"
                        , class "onyx-gate-input"
                        , attribute "autocomplete" "current-password"
                        , attribute "required" ""
                        , attribute "aria-describedby" "connection-password-hint"
                        , disabled busy
                        ]
                        []
                }
            ]

        Register ->
            [ nameField "Account name"
                ("Leave it blank to keep " ++ String.trim model.ourNick ++ ". The network confirms the name first.")
                "username"
            ]


field : { id_ : String, label_ : String, hint : String, input_ : Html Msg } -> Html Msg
field cfg =
    div [ class "onyx-gate-field" ]
        [ label [ for cfg.id_, class "onyx-gate-label" ] [ text cfg.label_ ]
        , cfg.input_
        , p [ id (cfg.id_ ++ "-hint"), class "onyx-gate-hint" ] [ text cfg.hint ]
        ]
