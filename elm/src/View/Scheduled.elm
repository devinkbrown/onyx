module View.Scheduled exposing (scheduledSheet)

{-| Scheduled "send later" queue sheet: every owned message waiting to
dispatch (room or DM, text, send time, live state) with a per-entry
cancel. Gated on `showScheduledMessages`; focus-trap/Escape handling
stays with the ports layer's DOM concerns like the other overlays,
while the global Escape key closes the sheet through
`SetShowScheduledMessages`.

Row state and copy mirror `ScheduledMessagesSheet.tsx`; timestamps
use the UTC send label (`App.scheduleSendLabel`) with the exact
instant on the `time` element.
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, li, p, span, strong, text, time, ul)
import Html.Attributes exposing (attribute, class, href, type_)
import Html.Events exposing (onClick)
import Schedule


scheduledSheet : Model -> Html Msg
scheduledSheet model =
    if not model.showScheduledMessages then
        text ""

    else
        let
            rows =
                App.ownedScheduledMessages model

            now =
                floor model.nowMs

            connected =
                model.connection == App.Live
        in
        div [ class "onyx-scheduled-wrap" ]
            [ div [ class "onyx-scheduled", attribute "role" "dialog", attribute "aria-label" "Scheduled messages" ]
                [ div [ class "onyx-scheduled-head" ]
                    [ span [ class "onyx-scheduled-title" ] [ text "Scheduled messages" ]
                    , button
                        [ type_ "button"
                        , class "onyx-scheduled-close"
                        , attribute "aria-label" "Close scheduled messages"
                        , onClick (SetShowScheduledMessages False)
                        ]
                        [ text "×" ]
                    ]
                , p [ class "onyx-scheduled-desc" ]
                    [ text "Messages waiting to send. They are kept on this device and send when their time arrives and you are connected." ]
                , if List.isEmpty rows then
                    p [ class "onyx-scheduled-empty" ]
                        [ strong [] [ text "No scheduled messages." ]
                        , span [] [ text "Use Send later in the composer to keep a message on this device until later." ]
                        ]

                  else
                    ul [ class "onyx-scheduled-list", attribute "aria-label" "Pending scheduled messages" ]
                        (List.map (scheduledRow model now connected) rows)
                ]
            ]


scheduledRow : Model -> Int -> Bool -> Schedule.ScheduledMessage -> Html Msg
scheduledRow model now connected row =
    let
        isChannel =
            App.isChannelName model row.channel

        uncertain =
            row.claim /= Nothing

        state =
            Schedule.classifyScheduledMessage
                { sendAt = row.sendAt
                , now = now
                , connected = connected
                , protected = App.scheduledRowProtected model row
                , encryptionRequired = App.scheduledRowEncryptionRequired model row
                }

        instant =
            App.millisToIso (toFloat row.sendAt)

        cancelLabel =
            (if uncertain then
                "Remove uncertain scheduled message"

             else
                "Cancel scheduled message"
            )
                ++ " to "
                ++ row.channel
                ++ ": "
                ++ String.left 40 row.text
    in
    li [ class "onyx-scheduled-item" ]
        [ div [ class "onyx-scheduled-meta" ]
            [ span [ class "onyx-scheduled-channel" ]
                [ text
                    ((if isChannel then
                        "Room"

                      else
                        "Direct message"
                     )
                        ++ " · "
                        ++ row.channel
                    )
                ]
            , time [ class "onyx-scheduled-when", attribute "datetime" instant, attribute "title" instant ]
                [ text (App.scheduleSendLabel row.sendAt now) ]
            ]
        , p [ class "onyx-scheduled-text" ] [ text row.text ]
        , div [ class "onyx-scheduled-actions" ]
            [ span [ class "onyx-scheduled-state", attribute "role" "status" ]
                [ text (Schedule.scheduledRowStateLabel uncertain state) ]
            , if isChannel then
                a
                    [ class "onyx-scheduled-ledger"
                    , href (App.statsRoomHref row.channel)
                    , attribute "aria-label" ("Room ledger for " ++ row.channel)
                    ]
                    [ text "Room ledger" ]

              else
                text ""
            , button
                [ type_ "button"
                , class "onyx-scheduled-cancel"
                , attribute "aria-label" cancelLabel
                , onClick (CancelScheduledMessage { id = row.id })
                ]
                [ text
                    (if uncertain then
                        "Remove row"

                     else
                        "Cancel"
                    )
                ]
            ]
        , if uncertain then
            p [ class "onyx-scheduled-uncertain" ]
                [ text "Sending was attempted. Removing this row cannot confirm or undo delivery." ]

          else
            text ""
        ]
