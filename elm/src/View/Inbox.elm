module View.Inbox exposing (inbox, inboxSheet, relativeAge)

{-| Notification inbox — the bell with an unread badge in the top bar,
and the inbox sheet mounted with the other overlays.

The sheet is a real modal (ported from the v3 `View.Sheet` inbox): a
light-dismiss veil, a `role="dialog"` panel with `aria-modal`, a titled
head, and Escape/close. `ports.js` (`installLightboxFocus`) moves focus
into the panel, wraps Tab inside it, isolates the page behind it, and
returns focus to the bell when it closes. It drops from the top-right
under the bar on wide screens and becomes a bottom sheet on phones
(`app.css`, "Inbox sheet").

Rows carry `data-type` / `data-unread`, a meta line (kind, context,
relative age, repeat count) over the clipped text. Rows that cannot be
opened render as plain rows, not buttons; invites offer Join, removals
Rejoin.

-}

import App exposing (InboxFilter(..), InboxNotification, Model, Msg(..), NotificationType(..), inboxDismissId, inboxFilterMatches, isAttentionNotification, isNavigableNotification, notificationContext, notificationKindGlyph, notificationKindLabel, notificationKindToken, unreadAttentionCount)
import Html exposing (Html, button, div, h2, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled, id, type_)
import Html.Events exposing (onClick)
import Set


inbox : Model -> Html Msg
inbox model =
    let
        unread =
            unreadAttentionCount model
    in
    div [ class "shell-ribbon-inbox" ]
        [ button
            [ type_ "button"
            , class "shell-ribbon-bell"
            , attribute "data-testid" "inbox-bell"
            , attribute "aria-haspopup" "dialog"
            , attribute "aria-expanded"
                (if model.showNotificationCenter then
                    "true"

                 else
                    "false"
                )
            , attribute "aria-label"
                (if unread > 0 then
                    "Notifications, " ++ String.fromInt unread ++ " unread"

                 else
                    "Notifications"
                )
            , onClick NotificationCenterOpened
            ]
            ([ span [ class "onyx-icon", attribute "data-icon" "bell", attribute "aria-hidden" "true" ] [] ]
                ++ (if unread > 0 then
                        [ span [ class "shell-ribbon-badge", attribute "data-testid" "inbox-badge", attribute "aria-hidden" "true" ]
                            [ text (badgeText unread) ]
                        ]

                    else
                        []
                   )
            )
        , -- Announced once per change, never as part of the button name
          -- churn: "3 unread notifications".
          span [ class "sr-only", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
            [ text
                (if unread > 0 then
                    String.fromInt unread ++ " unread notification" ++ plural unread

                 else
                    ""
                )
            ]
        ]


badgeText : Int -> String
badgeText count =
    if count > 9 then
        "9+"

    else
        String.fromInt count


plural : Int -> String
plural count =
    if count == 1 then
        ""

    else
        "s"


{-| The open inbox, mounted in the shell overlays. -}
inboxSheet : Model -> Html Msg
inboxSheet model =
    if model.showNotificationCenter then
        inboxPanel model

    else
        text ""


inboxPanel : Model -> Html Msg
inboxPanel model =
    let
        ordered =
            List.reverse model.notifications

        visible =
            List.filter (inboxFilterMatches model.inboxFilter) ordered

        count filter =
            List.length (List.filter (inboxFilterMatches filter) model.notifications)

        unreadCount =
            List.length (List.filter (\note -> not (Set.member note.id model.readNotificationIds)) model.notifications)
    in
    div [ class "notif-center-layer" ]
        [ div
            [ class "notif-center-veil"
            , attribute "aria-hidden" "true"
            , attribute "data-testid" "inbox-backdrop"
            , onClick NotificationCenterClosed
            ]
            []
        , section
            [ class "notif-center"
            , attribute "role" "dialog"
            , attribute "aria-modal" "true"
            , attribute "aria-label" "Notification inbox"
            , attribute "data-testid" "inbox-panel"
            , attribute "tabindex" "-1"
            ]
            [ div [ class "notif-center__grip", attribute "aria-hidden" "true" ] []
            , div [ class "notif-center__head" ]
                [ h2 [ class "notif-center__title", id "inbox-title" ] [ text "Inbox" ]
                , button
                    [ type_ "button"
                    , class "notif-center__action"
                    , onClick NotificationsMarkedRead
                    , disabled (unreadCount == 0)
                    ]
                    [ text "Mark all read" ]
                , button
                    [ type_ "button"
                    , class "notif-center__close"
                    , id "inbox-close"
                    , attribute "aria-label" "Close inbox"
                    , onClick NotificationCenterClosed
                    ]
                    [ span [ class "onyx-icon", attribute "data-icon" "close", attribute "aria-hidden" "true" ] [] ]
                ]
            , div [ class "notif-center__filters", attribute "role" "group", attribute "aria-label" "Inbox filters" ]
                [ filterButton model InboxAll "All" (count InboxAll)
                , filterButton model InboxAttention "Needs you" (count InboxAttention)
                , filterButton model InboxOther "Other" (count InboxOther)
                ]
            , div [ class "notif-center__scroll" ]
                [ if List.isEmpty model.notifications then
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
            ]
        ]


filterButton : Model -> InboxFilter -> String -> Int -> Html Msg
filterButton model filter label count =
    button
        [ type_ "button"
        , class "notif-center__filter"
        , attribute "aria-pressed"
            (if model.inboxFilter == filter then
                "true"

             else
                "false"
            )
        , onClick (InboxFilterSet filter)
        ]
        [ text (label ++ " (" ++ String.fromInt count ++ ")") ]


inboxRow : Model -> InboxNotification -> Html Msg
inboxRow model note =
    let
        context =
            notificationContext note

        kindLabel =
            notificationKindLabel note.kind

        read =
            Set.member note.id model.readNotificationIds

        when =
            relativeAge note.atMs model.nowMs

        meta =
            span [ class "notif-center__meta" ]
                ([ span [ class "notif-center__kind" ] [ text kindLabel ] ]
                    ++ (if context /= kindLabel then
                            [ span [ class "notif-center__context" ] [ text context ] ]

                        else
                            []
                       )
                    ++ (if note.count > 1 then
                            [ span [ class "notif-center__count" ] [ text ("×" ++ String.fromInt note.count) ] ]

                        else
                            []
                       )
                    ++ (case when of
                            Just label ->
                                [ span [ class "notif-center__when" ] [ text label ] ]

                            Nothing ->
                                []
                       )
                    ++ (if read then
                            [ span [ class "notif-center__read" ] [ text "Read" ] ]

                        else
                            [ span [ class "sr-only" ] [ text "Unread" ] ]
                       )
                )

        content =
            [ span [ class "notif-center__glyph", attribute "aria-hidden" "true" ] [ text (notificationKindGlyph note.kind) ]
            , span [ class "notif-center__body" ]
                [ meta
                , span [ class "notif-center__text" ] [ text (clipped note.text) ]
                ]
            ]

        opener =
            if isNavigableNotification note then
                button
                    [ type_ "button"
                    , class "notif-center__open"
                    , attribute "aria-label" (openVerb note ++ " " ++ context ++ ": " ++ clipped note.text)
                    , onClick (NotificationActivated note.id)
                    ]
                    content

            else
                div [ class "notif-center__open notif-center__open--static" ] content

        action =
            case ( note.kind, note.channel ) of
                ( NotifKick, Just channel ) ->
                    [ button
                        [ type_ "button"
                        , class "notif-center__join"
                        , attribute "aria-label" ("Rejoin " ++ channel)
                        , onClick (NotificationJoin note.id)
                        ]
                        [ text "Rejoin" ]
                    ]

                _ ->
                    []
    in
    li
        [ class "notif-center__row"
        , attribute "data-testid" "inbox-row"
        , attribute "data-type" (notificationKindToken note.kind)
        , attribute "data-unread"
            (if read then
                "false"

             else
                "true"
            )
        , attribute "data-attention"
            (if isAttentionNotification note then
                "true"

             else
                "false"
            )
        ]
        ([ opener ]
            ++ action
            ++ [ button
                    [ type_ "button"
                    , class "notif-center__dismiss"
                    , id (inboxDismissId note.id)
                    , attribute "aria-label" ("Dismiss notification from " ++ context ++ ": " ++ clipped note.text)
                    , attribute "data-notification-id" note.id
                    , onClick (NotificationDismissed note.id)
                    ]
                    [ span [ class "onyx-icon", attribute "data-icon" "close", attribute "aria-hidden" "true" ] [] ]
               ]
        )


openVerb : InboxNotification -> String
openVerb note =
    case note.kind of
        NotifInvite ->
            "Join the room from"

        NotifDm ->
            "Open message from"

        NotifMemo ->
            "Open memo from"

        _ ->
            "Open notification from"


{-| Compact relative age ("now", "5m", "3h", "2d"); Nothing when either
clock is unset so a zero stamp never renders as "20000d". -}
relativeAge : Float -> Float -> Maybe String
relativeAge atMs nowMs =
    if atMs <= 0 || nowMs <= 0 then
        Nothing

    else
        let
            minutes =
                floor (max 0 (nowMs - atMs) / 60000)
        in
        if minutes < 1 then
            Just "now"

        else if minutes < 60 then
            Just (String.fromInt minutes ++ "m")

        else if minutes < 48 * 60 then
            Just (String.fromInt (minutes // 60) ++ "h")

        else
            Just (String.fromInt (minutes // 1440) ++ "d")


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
