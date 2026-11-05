module View.Connection exposing (dialog)

{-| Connection and identity controls. Passwords stay in the input's DOM.
The submit event carries only the account name; the ports runtime reads and
clears the password field before issuing IDENTIFY.
-}

import App exposing (ConnectionState(..), Model, Msg(..))
import Html exposing (Html, button, dd, div, dl, dt, form, h2, input, label, p, span, text)
import Html.Attributes exposing (attribute, class, disabled, for, id, maxlength, name, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)


dialog : Model -> Html Msg
dialog model =
    if not model.connectionDialogOpen then
        text ""

    else
        div [ class "onyx-connect-veil" ]
            [ div
                [ class "onyx-connect-dialog"
                , attribute "role" "dialog"
                , attribute "aria-modal" "true"
                , attribute "aria-labelledby" "connection-title"
                , attribute "data-testid" "connection-dialog"
                ]
                [ div [ class "onyx-connect-head" ]
                    [ div []
                        [ p [ class "onyx-connect-kicker" ] [ text "Onyx" ]
                        , h2 [ id "connection-title" ] [ text "Your connection" ]
                        ]
                    , button
                        [ type_ "button"
                        , attribute "aria-label" "Close connection dialog"
                        , onClick ConnectionDialogClose
                        ]
                        [ text "Close" ]
                    ]
                , status model
                , case model.accountName of
                    Just account ->
                        div [ class "onyx-connect-account" ]
                            [ p [] [ text ("Signed in as " ++ account ++ ".") ]
                            , button [ type_ "button", onClick ConnectionAccountSettings ] [ text "Account settings" ]
                            ]

                    Nothing ->
                        div []
                            [ div [ class "onyx-connect-modes", attribute "role" "group", attribute "aria-label" "Identity options" ]
                                [ modeButton model False "Chat name"
                                , modeButton model True "Sign in"
                                ]
                            , if model.connectionSignIn then
                                signInForm model

                              else
                                nameForm model
                            ]
                , case model.connectionNickNotice of
                    Just notice -> p [ class "onyx-connect-success", attribute "role" "status" ] [ text notice ]
                    Nothing -> text ""
                , error model
                , p [ class "onyx-connect-footnote" ]
                    [ text "Your recent history stays on this device. Changing your chat name does not create an account." ]
                ]
            ]


modeButton : Model -> Bool -> String -> Html Msg
modeButton model signIn label_ =
    button
        [ type_ "button"
        , attribute "aria-pressed" (if model.connectionSignIn == signIn then "true" else "false")
        , onClick (ConnectionModeChanged signIn)
        ]
        [ text label_ ]


status : Model -> Html Msg
status model =
    let
        ( title, detail ) =
            case model.connection of
                Live ->
                    ( "Connected", "You can join rooms and send messages." )

                Registering ->
                    ( "Connecting…", "Onyx is establishing your connection." )

                Offline ->
                    ( "Offline"
                    , if model.reconnectIn > 0 then
                        "Trying again in " ++ String.fromInt model.reconnectIn ++ " seconds."

                      else
                        "Your history and drafts are still here. Reconnect to continue."
                    )
    in
    div [ class "onyx-connect-status", attribute "role" "status" ]
        [ span [ class "onyx-connect-status-title" ] [ text title ]
        , p [] [ text detail ]
        , dl [ class "onyx-connect-facts" ]
            [ dt [] [ text "Chat name" ]
            , dd [] [ text model.ourNick ]
            , dt [] [ text "Network" ]
            , dd [] [ text "Onyx" ]
            ]
        , if model.connection == Offline then
            button [ type_ "button", onClick ReconnectNow ] [ text "Reconnect now" ]

          else
            text ""
        ]


nameForm : Model -> Html Msg
nameForm model =
    form [ class "onyx-connect-form", onSubmit ConnectionNickSubmit ]
        [ label [ for "connection-nick" ] [ text "Choose a chat name" ]
        , input
            [ id "connection-nick"
            , type_ "text"
            , value model.connectionNickDraft
            , maxlength App.maxNickAliasLength
            , attribute "autocomplete" "nickname"
            , attribute "spellcheck" "false"
            , onInput ConnectionNickInput
            ]
            []
        , p [ class "onyx-connect-hint" ] [ text "People see this name in rooms. The network confirms it before it changes." ]
        , button
            [ type_ "submit"
            , class "onyx-connect-primary"
            , disabled (model.connection /= Live || model.connectionNickPending /= Nothing || String.trim model.connectionNickDraft == model.ourNick)
            ]
            [ text (if model.connectionNickPending /= Nothing then "Waiting for confirmation…" else "Use this name") ]
        , if model.connectionNickPending /= Nothing then
            div [ class "onyx-connect-recovery" ]
                [ p [] [ text "Your current name stays active until the network confirms. If this attempt stalls, disconnect and retry." ]
                , button [ type_ "button", onClick ConnectionCancelSignIn ] [ text "Disconnect to retry" ]
                ]
          else
            text ""
        , if App.guestClaimVisible model then
            button [ type_ "button", onClick ConnectionKeepName ] [ text "Keep this name with an account" ]

          else
            text ""
        ]


signInForm : Model -> Html Msg
signInForm model =
    form
        [ class "onyx-connect-form"
        , attribute "aria-label" "Sign in to Onyx"
        , attribute "data-private-auth-form" "identify"
        , onSubmit ConnectionSignInSubmit
        ]
        [ label [ for "connection-account" ] [ text "Account name" ]
        , input
            [ id "connection-account"
            , type_ "text"
            , value model.connectionAccountDraft
            , attribute "autocomplete" "username"
            , maxlength 64
            , onInput ConnectionAccountInput
            ]
            []
        , label [ for "connection-password" ] [ text "Password" ]
        , input
            [ id "connection-password"
            , name "connection-password"
            , type_ "password"
            , attribute "autocomplete" "current-password"
            , attribute "required" ""
            , placeholder "Your account password"
            ]
            []
        , p [ class "onyx-connect-hint" ] [ text "Use an account you already have on this network." ]
        , if model.identifyReplyAccount /= Nothing then
            div [ class "onyx-connect-recovery" ]
                [ p [] [ text "Still waiting? Disconnect to clear this attempt, then reconnect and sign in again." ]
                , button [ type_ "button", onClick ConnectionCancelSignIn ] [ text "Disconnect to retry" ]
                ]

          else
            text ""
        , button
            [ type_ "submit"
            , class "onyx-connect-primary"
            , disabled (model.connection /= Live || model.identifyReplyAccount /= Nothing)
            ]
            [ text (if model.identifyReplyAccount /= Nothing then "Signing in…" else "Sign in") ]
        ]


error : Model -> Html Msg
error model =
    let
        detail =
            case model.connectionDialogError of
                Just local ->
                    Just local

                Nothing ->
                    case model.accountActionError of
                        Just server ->
                            if server.command == "IDENTIFY" then
                                Just (if String.isEmpty server.description then "Sign-in failed. Check your account details." else server.description)

                            else
                                Nothing

                        Nothing ->
                            Nothing
    in
    case detail of
        Just message ->
            p [ class "onyx-connect-error", attribute "role" "alert" ] [ text message ]

        Nothing ->
            text ""
