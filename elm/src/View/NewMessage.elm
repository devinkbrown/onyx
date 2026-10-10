module View.NewMessage exposing (newMessageSheet)

{-| "New conversation" DM starter sheet (mirroring
`shell/NewMessageSheet.tsx`): a nickname field validated through the
shared `Invite.nicknameError` / `parseNickname` contract, offline and
connecting status copy that keeps the action disabled, Cancel / close /
backdrop / Escape dismissal, and submit through `NewMessageSubmit`
(which opens the DM via the profile-card path). The focus trap and
focus restore stay with the ports layer like the other sheets.
-}

import App exposing (ConnectionState(..), Model, Msg(..))
import Html exposing (Html, button, div, form, h2, input, label, p, section, span, text)
import Html.Attributes exposing (attribute, class, disabled, for, id, maxlength, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Invite
import Json.Decode as Decode


newMessageSheet : Model -> Html Msg
newMessageSheet model =
    if model.newMessageOpen then
        sheet model

    else
        text ""


sheet : Model -> Html Msg
sheet model =
    let
        unavailable =
            model.connection /= Live

        recipient =
            model.newMessageRecipient

        valid =
            Invite.parseNickname (Just recipient) /= Nothing

        error =
            if String.isEmpty (String.trim recipient) then
                Nothing

            else
                Invite.nicknameError recipient False
    in
    div [ class "onyx-newmsg" ]
        [ div
            [ class "onyx-newmsg-backdrop"
            , attribute "role" "presentation"
            , attribute "data-testid" "new-message-backdrop"
            , onClick NewMessageClose
            ]
            []
        , section
            [ class "onyx-newmsg-sheet"
            , attribute "role" "dialog"
            , attribute "aria-modal" "true"
            , attribute "aria-labelledby" "new-message-title"
            , attribute "aria-describedby" "new-message-description"
            , attribute "tabindex" "-1"
            , on "keydown" escapeDecoder
            ]
            ([ div [ class "onyx-newmsg-header" ]
                [ div [ class "onyx-newmsg-mark", attribute "aria-hidden" "true" ] [ text "✦" ]
                , div []
                    [ p [ class "onyx-newmsg-eyebrow" ] [ text "Private message" ]
                    , h2 [ id "new-message-title" ] [ text "New conversation" ]
                    ]
                , button
                    [ type_ "button"
                    , class "onyx-newmsg-close"
                    , attribute "aria-label" "Close new conversation"
                    , onClick NewMessageClose
                    ]
                    [ span [ attribute "aria-hidden" "true" ] [ text "×" ] ]
                ]
             , p [ id "new-message-description", class "onyx-newmsg-help" ]
                [ text "Start a private conversation with someone on this server." ]
             ]
                ++ (if unavailable then
                        [ p
                            [ class "onyx-newmsg-state"
                            , attribute "role" "status"
                            , attribute "aria-live" "polite"
                            ]
                            [ text
                                (if model.connection == Registering || model.autoReconnect then
                                    "Connecting to Onyx… You can start when you’re online."

                                 else
                                    "You’re offline. Reconnect to start a conversation."
                                )
                            ]
                        ]

                    else
                        []
                   )
                ++ [ form [ onSubmit NewMessageSubmit ]
                        [ label [ for "new-message-recipient" ] [ text "Who do you want to message?" ]
                        , p [ id "new-message-recipient-hint", class "onyx-newmsg-hint" ]
                            [ text "Enter their nickname exactly as they use it, for example "
                            , span [] [ text "River_7" ]
                            , text "."
                            ]
                        , input
                            [ id "new-message-recipient"
                            , value recipient
                            , onInput NewMessageInput
                            , attribute "autocomplete" "off"
                            , attribute "autocapitalize" "none"
                            , attribute "spellcheck" "false"
                            , disabled unavailable
                            , maxlength 64
                            , attribute "aria-describedby" "new-message-recipient-hint new-message-recipient-error"
                            , attribute "aria-invalid"
                                (if error /= Nothing then
                                    "true"

                                 else
                                    "false"
                                )
                            ]
                            []
                        , case error of
                            Just message ->
                                p
                                    [ id "new-message-recipient-error"
                                    , class "onyx-newmsg-error"
                                    , attribute "role" "alert"
                                    ]
                                    [ text message ]

                            Nothing ->
                                text ""
                        , if String.isEmpty recipient then
                            p [ class "onyx-newmsg-empty", attribute "aria-live" "polite" ] [ text "No person selected yet." ]

                          else
                            text ""
                        , div [ class "onyx-newmsg-actions" ]
                            [ button
                                [ type_ "button"
                                , class "onyx-newmsg-secondary"
                                , onClick NewMessageClose
                                ]
                                [ text "Cancel" ]
                            , button
                                [ type_ "submit"
                                , class "onyx-newmsg-primary"
                                , disabled (unavailable || not valid)
                                ]
                                [ text
                                    (if unavailable then
                                        "Waiting for connection"

                                     else
                                        "Start conversation"
                                    )
                                ]
                            ]
                        ]
                   ]
            )
        ]


{-| Escape dismisses the sheet (IME composition yields). -}
escapeDecoder : Decode.Decoder Msg
escapeDecoder =
    Decode.map2 Tuple.pair
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "isComposing" Decode.bool, Decode.succeed False ])
        |> Decode.andThen
            (\( key, composing ) ->
                if key == "Escape" && not composing then
                    Decode.succeed NewMessageClose

                else
                    Decode.fail "ignored"
            )
