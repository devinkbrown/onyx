module View.Inbox exposing (inbox, inboxSheet)

{-| Notification inbox — the mentions/messages bell with an unread
badge and a filterable newest-first popover (mirroring
`NotificationCenter.tsx`: attention-only badge, All/Needs-you/Other
filters with counts, verbatim empty copy, glyph + label + context per
row, click-to-open marking read and jumping, per-row dismiss, and
mark-all-read).

Focus-trap/Escape handling stays with the ports layer's DOM concerns;
follow-topic pins stay ahead (the room opens without the topic jump).

v3/ui-sheets — the bell stays in the top bar; the panel itself is a
`View.Sheet` popover mounted with the other overlays (`inboxSheet`):
top-right under the bar on desktop, a bottom sheet on phones, with the
shared light-dismiss veil, focus scope and Escape.
-}

import App exposing (InboxFilter(..), InboxNotification, Model, Msg(..), NotificationType(..), isAttentionNotification, notificationContext, notificationKindGlyph, notificationKindLabel, unreadAttentionCount)
import Html exposing (Html, button, div, li, p, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled)
import Html.Events exposing (onClick)
import Set
import View.Sheet as Sheet


inbox : Model -> Html Msg
inbox model =
    let
        unread =
            unreadAttentionCount model
    in
    div [ class "shell-ribbon-inbox" ]
        [ button
            [ class "shell-ribbon-bell"
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
            ([ span [ class "shell-ribbon-bell-icon", attribute "aria-hidden" "true" ] [] ]
                ++ (if unread > 0 then
                        [ span [ class "shell-ribbon-badge", attribute "data-testid" "inbox-badge" ]
                            [ text (String.fromInt unread) ]
                        ]

                    else
                        []
                   )
            )
        ]


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
            List.filter (filterMatches model.inboxFilter) ordered

        count filter =
            List.length (List.filter (filterMatches filter) model.notifications)
    in
    Sheet.view
        { scope = "inbox"
        , label = Sheet.Labelled "Notification inbox"
        , onClose = NotificationCenterClosed
        , placement = Sheet.Popover
        , layerClass = "notif-center-layer"
        , panelClass = "notif-center"
        , backdropClass = ""
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "data-testid" "inbox-panel" ]
        }
        [ Sheet.headerWith
            (Sheet.head { scope = "inbox", title = "Inbox", closeLabel = "Close inbox", onClose = NotificationCenterClosed }
                |> (\h ->
                        { h
                            | actions =
                                [ button
                                    [ class "notif-center__action"
                                    , attribute "type" "button"
                                    , onClick NotificationsMarkedRead
                                    , disabled (List.isEmpty model.notifications)
                                    ]
                                    [ text "Mark all read" ]
                                ]
                        }
                   )
            )
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
        [ class "notif-center__filter"
        , attribute "aria-pressed"
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

        kindLabel =
            notificationKindLabel note.kind

        read =
            Set.member note.id model.readNotificationIds

        when =
            relativeAge note.atMs model.nowMs
    in
    li
        [ class "notif-center__row"
        , attribute "data-testid" "inbox-row"
        , attribute "data-type" (kindToken note.kind)
        , attribute "data-unread"
            (if read then
                "false"

             else
                "true"
            )
        ]
        [ button
            [ class "notif-center__open"
            , attribute "aria-label" ("Open notification from " ++ context ++ ": " ++ clipped note.text)
            , onClick (NotificationActivated note.id)
            ]
            [ span [ class "notif-center__glyph", attribute "aria-hidden" "true" ] [ text (notificationKindGlyph note.kind) ]
            , span [ class "notif-center__body" ]
                [ span [ class "notif-center__meta" ]
                    ([ span [ class "notif-center__kind" ] [ text kindLabel ] ]
                        ++ (if context /= kindLabel then
                                [ span [ class "notif-center__context" ] [ text context ] ]

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
                                []
                           )
                    )
                , span [ class "notif-center__text" ] [ text (clipped note.text) ]
                ]
            ]
        , button
            [ class "notif-center__dismiss"
            , attribute "aria-label" ("Dismiss notification from " ++ context ++ ": " ++ clipped note.text)
            , attribute "data-notification-id" note.id
            , onClick (NotificationDismissed note.id)
            ]
            [ span [ class "onyx-sheet-x", attribute "aria-hidden" "true" ] [] ]
        ]


kindToken : NotificationType -> String
kindToken kind =
    case kind of
        NotifMention ->
            "mention"

        NotifDm ->
            "dm"

        NotifFollow ->
            "follow"

        NotifSystem ->
            "system"

        NotifError ->
            "error"


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
