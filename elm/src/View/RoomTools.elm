module View.RoomTools exposing (transcriptExport, webhookManager)

{-| v3/gap-people — two Room settings tools.

  - `webhookManager`: incoming webhooks for any room host (op and
    above — the server's `WEBHOOK` channel-op gate), in any room size.
    They used to live in Room care, which only owners of 3–30 person
    rooms could open. Create (optional name), list, delete by id; the
    server's replies (`WEBHOOK: created … — POST … to <url>`, shown
    once; `id=… name=… by=…` rows) appear newest first.
  - `transcriptExport`: download this room's scrollback held on this
    device as text or JSON (the `/export` build), for everyone.

-}

import App exposing (ConnectionState(..), Model, Msg(..), webhookNotices)
import GapPeople
import Html exposing (Html, button, div, input, label, p, text)
import Html.Attributes exposing (attribute, class, disabled, for, id, type_, value)
import Html.Events exposing (onClick, onInput)
import Dict


webhookManager : Model -> String -> Html Msg
webhookManager model room =
    let
        live =
            model.connection == Live
    in
    div [ class "rset-readonly gp-webhooks", attribute "data-testid" "chset-webhooks" ]
        ([ p [ class "rset-readonly-label" ] [ text "Incoming webhooks" ]
         , p [ class "rset-hint" ] [ text "Discord-compatible webhook URLs post into this room. The URL is shown once, below, when you create one." ]
         , label [ class "rset-label", for "chset-webhook-name" ] [ text "Webhook name (optional)" ]
         , input
            [ id "chset-webhook-name"
            , class "rset-input"
            , attribute "data-testid" "chset-webhook-name"
            , attribute "maxlength" "32"
            , attribute "autocomplete" "off"
            , value model.webhookName
            , onInput WebhookNameInput
            ]
            []
         , div [ class "gp-actions" ]
            [ button
                [ type_ "button"
                , class "rset-btn"
                , attribute "data-testid" "chset-webhook-create"
                , disabled (not live)
                , onClick (WebhookCreate room)
                ]
                [ text "Create webhook" ]
            , button
                [ type_ "button"
                , class "rset-btn"
                , attribute "data-testid" "chset-webhook-list"
                , disabled (not live)
                , onClick (WebhookList room)
                ]
                [ text "List webhooks" ]
            ]
         , label [ class "rset-label", for "chset-webhook-delete" ] [ text "Delete a webhook by id" ]
         , input
            [ id "chset-webhook-delete"
            , class "rset-input"
            , attribute "data-testid" "chset-webhook-delete-id"
            , attribute "autocomplete" "off"
            , value model.webhookDeleteId
            , onInput WebhookDeleteIdInput
            ]
            []
         , div [ class "gp-actions" ]
            [ button
                [ type_ "button"
                , class "rset-btn gp-btn-danger"
                , attribute "data-testid" "chset-webhook-delete"
                , disabled (not live || String.isEmpty (String.trim model.webhookDeleteId))
                , onClick (WebhookDelete room)
                ]
                [ text "Delete webhook" ]
            ]
         ]
            ++ (if String.isEmpty model.webhookStatus then
                    []

                else
                    [ p [ class "rset-hint gp-status", attribute "role" "status", attribute "data-testid" "chset-webhook-status" ] [ text model.webhookStatus ] ]
               )
            ++ (case webhookNotices model of
                    [] ->
                        []

                    notices ->
                        [ div [ class "gp-notices", attribute "aria-live" "polite" ]
                            (List.map
                                (\notice -> p [ class "gp-notice", attribute "data-testid" "chset-webhook-notice" ] [ text notice ])
                                notices
                            )
                        ]
               )
        )


transcriptExport : Model -> String -> Html Msg
transcriptExport model room =
    let
        count =
            Dict.get (String.toLower room) model.channels
                |> Maybe.map (.messages >> List.length)
                |> Maybe.withDefault 0
    in
    div [ class "gp-export", attribute "data-testid" "chset-export" ]
        [ p [ class "rset-hint", id "chset-export-hint" ]
            [ text
                ("Downloads the scrollback stored on this device only"
                    ++ (if count > 0 then
                            " (" ++ String.fromInt count ++ " message" ++ plural count ++ " here)."

                        else
                            " (no messages loaded here yet)."
                       )
                    ++ " Not a complete server history."
                )
            ]
        , div [ class "gp-actions" ]
            [ button
                [ type_ "button"
                , class "rset-btn"
                , attribute "data-testid" "chset-export-txt"
                , attribute "aria-describedby" "chset-export-hint"
                , onClick (GapPeopleMsg (GapPeople.TranscriptExport "txt"))
                ]
                [ text "Download text" ]
            , button
                [ type_ "button"
                , class "rset-btn"
                , attribute "data-testid" "chset-export-json"
                , attribute "aria-describedby" "chset-export-hint"
                , onClick (GapPeopleMsg (GapPeople.TranscriptExport "json"))
                ]
                [ text "Download JSON" ]
            ]
        ]


plural : Int -> String
plural n =
    if n == 1 then
        ""

    else
        "s"
