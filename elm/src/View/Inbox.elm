module View.Inbox exposing (inbox)

{-| Notification inbox — the mentions/messages bell with an unread
badge and a filterable newest-first popover (mirroring
`NotificationCenter.tsx`: attention-only badge, All/Needs-you/Other
filters with counts, verbatim empty copy, glyph + label + context per
row, click-to-open marking read and jumping, per-row dismiss, and
mark-all-read).

Focus-trap/Escape handling stays with the ports layer's DOM concerns;
follow-topic pins stay ahead (the room opens without the topic jump).
-}

import App exposing (InboxFilter(..), InboxNotification, Model, Msg(..), isAttentionNotification, notificationContext, notificationKindGlyph, notificationKindLabel, unreadAttentionCount)
import Html exposing (Html, button, div, li, p, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled)
import Html.Events exposing (onClick)
import Set


inbox : Model -> Html Msg
inbox model =
    let
        unread =
            unreadAttentionCount model
    in
    div [ class "shell-ribbon-inbox" ]
        ([ button
            [ class "shell-ribbon-bell"
            , attribute "data-testid" "inbox-bell"
            , attribute "aria-label"
                (if unread > 0 then
                    "Notifications, " ++ String.fromInt unread ++ " unread"

                 else
                    "Notifications"
                )
            , onClick NotificationCenterOpened
            ]
            ([ span [ attribute "aria-hidden" "true" ] [ text "🔔" ] ]
                ++ (if unread > 0 then
                        [ span [ class "shell-ribbon-badge", attribute "data-testid" "inbox-badge" ]
                            [ text (String.fromInt unread) ]
                        ]

                    else
                        []
                   )
            )
         ]
            ++ (if model.showNotificationCenter then
                    [ inboxPanel model ]

                else
                    []
               )
        )


inboxPanel : Model -> Html Msg
inboxPanel model =
    let
        ordered =
            List.reverse model.notifications

        visible =
            List.filter (filterMatches model.inboxFilter) ordered

        count filter =
            List.length (List.filter (filterMatches filter) model.notifications)
    in
    div [ class "notif-center", attribute "role" "dialog", attribute "aria-label" "Notification inbox", attribute "data-testid" "inbox-panel" ]
        [ div [ class "notif-center__head" ]
            [ span [] [ text "Inbox" ]
            , button [ onClick NotificationsMarkedRead, disabled (List.isEmpty model.notifications) ] [ text "Mark all read" ]
            , button [ onClick NotificationCenterClosed, attribute "aria-label" "Close inbox" ] [ text "×" ]
            ]
        , div [ class "notif-center__filters", attribute "role" "group", attribute "aria-label" "Inbox filters" ]
            [ filterButton model InboxAll "All" (count InboxAll)
            , filterButton model InboxAttention "Needs you" (count InboxAttention)
            , filterButton model InboxOther "Other" (count InboxOther)
            ]
        , if List.isEmpty model.notifications then
            p [ class "notif-center__empty" ] [ text "Nothing yet — mentions and messages land here." ]

          else if List.isEmpty visible then
            p [ class "notif-center__empty" ]
                [ text
                    (case model.inboxFilter of
                        InboxAttention ->
                            "No mentions, follows, or direct messages yet."

                        InboxOther ->
                            "No other notifications yet."

                        InboxAll ->
                            "Nothing yet — mentions and messages land here."
                    )
                ]

          else
            ul [ class "notif-center__list" ] (List.map (inboxRow model) visible)
        ]


filterButton : Model -> InboxFilter -> String -> Int -> Html Msg
filterButton model filter label count =
    button
        [ attribute "aria-pressed"
            (if model.inboxFilter == filter then
                "true"

             else
                "false"
            )
        , onClick (InboxFilterSet filter)
        ]
        [ text (label ++ " (" ++ String.fromInt count ++ ")") ]


filterMatches : InboxFilter -> InboxNotification -> Bool
filterMatches filter note =
    case filter of
        InboxAll ->
            True

        InboxAttention ->
            isAttentionNotification note

        InboxOther ->
            not (isAttentionNotification note)


inboxRow : Model -> InboxNotification -> Html Msg
inboxRow model note =
    let
        context =
            notificationContext note

        read =
            Set.member note.id model.readNotificationIds
    in
    li [ class "notif-center__row", attribute "data-testid" "inbox-row" ]
        [ button
            [ class "notif-center__open"
            , attribute "aria-label" ("Open notification from " ++ context ++ ": " ++ clipped note.text)
            , onClick (NotificationActivated note.id)
            ]
            [ span [ class "notif-center__glyph", attribute "aria-hidden" "true" ] [ text (notificationKindGlyph note.kind) ]
            , span [ class "notif-center__body" ]
                [ span [ class "notif-center__kind" ] [ text (notificationKindLabel note.kind) ]
                , span [ class "notif-center__context" ] [ text context ]
                , span [ class "notif-center__text" ] [ text (clipped note.text) ]
                , if read then
                    span [ class "notif-center__read" ] [ text "Read" ]

                  else
                    span [] []
                ]
            ]
        , button
            [ class "notif-center__dismiss"
            , attribute "aria-label" ("Dismiss notification from " ++ context ++ ": " ++ clipped note.text)
            , attribute "data-notification-id" note.id
            , onClick (NotificationDismissed note.id)
            ]
            [ text "×" ]
        ]


{-| Clip row text for labels (mirroring the oracle `clipped`:
whitespace-collapsed, 72 chars max with an ellipsis). -}
clipped : String -> String
clipped value =
    let
        normalized =
            String.words value |> String.join " "
    in
    if String.length normalized > 72 then
        String.slice 0 72 normalized ++ "..."

    else
        normalized
