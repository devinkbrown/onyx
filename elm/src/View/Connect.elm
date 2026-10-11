module View.Connect exposing (connectGate)

{-| First-run join screen, mirroring `src/app/Connect.tsx`: one primary
guest path (display name + optional room), with Sign in and Create
account as secondary modes under "Other ways to join".

Copy, labels, aria names, and `data-testid` hooks follow the oracle
(the mode buttons carry its `conn-mode-*` ids). The status line is a
polite live region that distinguishes failure types without naming a
server; its idle copy repeats the lede, so it is visually hidden until
there is news (connecting, an error). Fields lock while a dial is in
flight; Cancel abandons it. A pending deep-link room (`?join=`, an
invite) is named in the guest title and the room hint, since leaving
the room field empty joins it.
-}

import App exposing (ConnectMode(..), ConnectPhase(..), Model, Msg(..))
import Html exposing (Html, a, button, div, form, h1, h2, input, label, main_, nav, p, span, text)
import Html.Attributes exposing (attribute, autocomplete, class, classList, disabled, for, href, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import View.PublicFrame exposing (brandMark)
import View.GapShell -- v3/gap-shell


connectGate : Model -> Html Msg
connectGate model =
    let
        form_ =
            model.connectForm

        phase =
            App.connectPhase model

        copy =
            App.connectModeCopy form_.mode

        busy =
            phase == ConnectConnecting

        -- A deep link (`?join=`) or invite is already carrying the
        -- room: the guest door names it.
        invitedRoom =
            if String.isEmpty (String.trim form_.room) then
                model.pendingDeepLinkJoin

            else
                Nothing

        title =
            case ( form_.mode, invitedRoom ) of
                ( ConnectGuest, Just room ) ->
                    "Join " ++ room

                _ ->
                    copy.title
    in
    main_ [ class "conn", attribute "data-testid" "connect" ]
        [ div [ class "conn-card" ]
            [ a [ class "conn-brand", href "/", attribute "aria-label" "Onyx home" ]
                [ brandMark "conn-brand-mark"
                , span [ class "conn-brand-name" ] [ text "Onyx" ]
                ]
            , h1 [ class "conn-title" ] [ text title ]
            , p [ class "conn-body" ] [ text copy.body ]
            , form
                [ class "conn-form"
                , attribute "aria-label" "Connect form"
                , attribute "novalidate" ""
                , onSubmit ConnectSubmit
                ]
                (fields model invitedRoom busy
                    ++ [ div [ class "conn-actions" ]
                            (button
                                [ type_ "submit"
                                , class "conn-submit"
                                , disabled (not (App.connectCanSubmit model))
                                , attribute "aria-label" (submitAria form_.mode)
                                , attribute "data-testid" "conn-submit"
                                ]
                                [ text (App.connectSubmitLabel form_.mode phase) ]
                                :: (if busy then
                                        [ button
                                            [ type_ "button"
                                            , class "conn-cancel"
                                            , onClick ConnectCancel
                                            , attribute "data-testid" "conn-cancel"
                                            ]
                                            [ text "Cancel" ]
                                        ]

                                    else
                                        []
                                   )
                            )
                       , p
                            [ classList
                                [ ( "conn-status", True )
                                , ( "conn-status-idle", phase == ConnectIdle )
                                , ( "conn-status-error", phase == ConnectError )
                                , ( "conn-status-busy", busy )
                                ]
                            , attribute "role" "status"
                            , attribute "aria-live" "polite"
                            , attribute "data-testid" "conn-status"
                            ]
                            [ text (App.connectStatusMessage model) ]
                       , View.GapShell.connectAction model -- v3/gap-shell
                       ]
                )
            , modeNav form_.mode busy
            ]
        , nav [ class "conn-foot", attribute "aria-label" "About Onyx" ]
            [ a [ href "/about/" ] [ text "About" ]
            , a [ href "/privacy/" ] [ text "Privacy" ]
            , a [ href "/guidelines/" ] [ text "House rules" ]
            , a [ href "/status/" ] [ text "Status" ]
            ]
        ]


submitAria : ConnectMode -> String
submitAria mode =
    case mode of
        ConnectGuest ->
            "Join Onyx as a guest"

        ConnectSignIn ->
            "Sign in to Onyx"

        ConnectRegister ->
            "Create your Onyx account"


fields : Model -> Maybe String -> Bool -> List (Html Msg)
fields model invitedRoom busy =
    let
        f =
            model.connectForm

        roomPlaceholder =
            Maybe.withDefault "#lounge" invitedRoom

        nickField =
            field
                { id_ = "conn-nick"
                , label_ = App.connectFieldLabel f.mode
                , kind = "text"
                , placeholder_ = "your-name"
                , auto = "username"
                , value_ = f.nick
                , error = f.nickError
                , hint = Nothing
                , busy = busy
                , onInput_ = ConnectNickInput
                }
    in
    case f.mode of
        ConnectGuest ->
            [ nickField
            , field
                { id_ = "conn-room"
                , label_ = "Room"
                , kind = "text"
                , placeholder_ = roomPlaceholder
                , auto = "off"
                , value_ = f.room
                , error = f.roomError
                , hint =
                    Just
                        (case invitedRoom of
                            Just room ->
                                "Optional — leave empty to join " ++ room ++ "."

                            Nothing ->
                                "Optional — leave empty to land on Home and browse rooms."
                        )
                , busy = busy
                , onInput_ = ConnectRoomInput
                }
            ]

        ConnectSignIn ->
            [ nickField
            , if f.recoveryOpen then
                field
                    { id_ = "conn-recovery"
                    , label_ = "Recovery code"
                    , kind = "text"
                    , placeholder_ = "ABCDE-FGHJK"
                    , auto = "one-time-code"
                    , value_ = f.recoveryCode
                    , error = f.passwordError
                    , hint = Just "Use one of the codes you saved when you set them up."
                    , busy = busy
                    , onInput_ = ConnectRecoveryCodeInput
                    }

              else
                field
                    { id_ = "conn-password"
                    , label_ = "Account password"
                    , kind = "password"
                    , placeholder_ = "your account password"
                    , auto = "current-password"
                    , value_ = f.password
                    , error = f.passwordError
                    , hint = Nothing
                    , busy = busy
                    , onInput_ = ConnectPasswordInput
                    }
            , button
                [ type_ "button"
                , class "conn-link"
                , disabled busy
                , onClick ConnectRecoveryToggle
                , attribute "data-testid" "conn-recovery-toggle"
                ]
                [ text
                    (if f.recoveryOpen then
                        "Use your password instead"

                     else
                        "Use a recovery code"
                    )
                ]
            , field
                { id_ = "conn-room"
                , label_ = "Room"
                , kind = "text"
                , placeholder_ = roomPlaceholder
                , auto = "off"
                , value_ = f.room
                , error = f.roomError
                , hint = Just "Optional."
                , busy = busy
                , onInput_ = ConnectRoomInput
                }
            ]

        ConnectRegister ->
            let
                strength =
                    App.passwordStrength f.password

                -- The submit stays disabled until the form is valid, so
                -- say why as soon as it is knowable: a short password,
                -- or a confirmation that already differs.
                passwordHint =
                    if String.isEmpty f.password then
                        Nothing

                    else
                        App.validateConnectPassword f.password

                confirmError =
                    case f.confirmError of
                        Just err ->
                            Just err

                        Nothing ->
                            if not (String.isEmpty f.confirm) && String.length f.confirm >= String.length f.password then
                                App.validateConnectConfirm f.password f.confirm

                            else
                                Nothing
            in
            [ nickField
            , field
                { id_ = "conn-email"
                , label_ = "Email"
                , kind = "email"
                , placeholder_ = "you@example.com"
                , auto = "email"
                , value_ = f.email
                , error = f.emailError
                , hint = Just "Optional — used for verification and recovery."
                , busy = busy
                , onInput_ = ConnectEmailInput
                }
            , field
                { id_ = "conn-password"
                , label_ = "Password"
                , kind = "password"
                , placeholder_ = "at least 8 characters"
                , auto = "new-password"
                , value_ = f.password
                , error = f.passwordError
                , hint = passwordHint
                , busy = busy
                , onInput_ = ConnectPasswordInput
                }
            , if String.isEmpty f.password then
                text ""

              else
                div
                    [ class "conn-strength"
                    , attribute "data-score" (String.fromInt strength.score)
                    , attribute "aria-label" ("Password strength: " ++ strength.label)
                    ]
                    [ div [ class "conn-strength-bar" ]
                        (List.range 1 4
                            |> List.map
                                (\i ->
                                    span
                                        [ classList [ ( "conn-strength-seg", True ), ( "conn-strength-on", i <= strength.score ) ] ]
                                        []
                                )
                        )
                    , span [ class "conn-strength-label" ] [ text strength.label ]
                    ]
            , field
                { id_ = "conn-confirm"
                , label_ = "Confirm password"
                , kind = "password"
                , placeholder_ = "re-enter your password"
                , auto = "new-password"
                , value_ = f.confirm
                , error = confirmError
                , hint = Nothing
                , busy = busy
                , onInput_ = ConnectConfirmInput
                }
            ]


field :
    { id_ : String
    , label_ : String
    , kind : String
    , placeholder_ : String
    , auto : String
    , value_ : String
    , error : Maybe String
    , hint : Maybe String
    , busy : Bool
    , onInput_ : String -> Msg
    }
    -> Html Msg
field cfg =
    let
        errId =
            cfg.id_ ++ "-error"

        hintId =
            cfg.id_ ++ "-hint"

        describedBy =
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
             , value cfg.value_
             , disabled cfg.busy
             , onInput cfg.onInput_
             ]
                ++ describedBy
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


modeNav : ConnectMode -> Bool -> Html Msg
modeNav current busy =
    let
        entry mode key label_ =
            if mode == current then
                text ""

            else
                button
                    [ type_ "button"
                    , class "conn-alt-btn"
                    , disabled busy
                    , onClick (ConnectModeSet mode)
                    , attribute "data-testid" ("conn-mode-" ++ key)
                    ]
                    [ text label_ ]
    in
    nav [ class "conn-alt", attribute "aria-label" "Other ways to join", attribute "data-testid" "conn-modes" ]
        [ h2 [ class "conn-alt-title" ] [ text "Other ways to join" ]
        , div [ class "conn-alt-row" ]
            [ entry ConnectGuest "guest" "Join as a guest"
            , entry ConnectSignIn "signin" "Sign in"
            , entry ConnectRegister "register" "Create account"
            ]
        ]
