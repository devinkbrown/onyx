module View.RoomHeader exposing (jumpToggle, mediaToggle, pinsToggle, roomHeader, roomTopic)

{-| v3/frame — the room header at the top of the conversation column
(roadmap 3.1 direction: name, one-line topic, presence, overflow).

Everything here is ROOM-scoped; network-scoped controls (palette
launcher, the inbox, Operator, connection pill, You) stay in the
global `View.Topbar`.

v3/ui-mobile-shell — ONE row on every viewport:

  - phones get a back control first (`room-back`, to the Rooms or
    Messages page the conversation lives in — the conversation is a
    pushed page there, and the global bar hides);
  - the privacy glyph, the room name (`h2`) and its one-line topic
    (desktop: the `More` / `Less` expander for long topics); a DM
    shows its E2EE posture + Verify (`View.DmSafety.convoHeader`)
    as the subtitle line instead;
  - actions: the facepile (desktop), the call presence chip / Join
    call (`View.CallPresence`, never inside the overflow), Search
    (an icon; phones reach it through More), Members
    (`View.Roster.membersToggle`, the v3/ui-roster people icon + count
    that opens the member sheet where the context rail is hidden) and
    the More disclosure.

The More disclosure (`aria-expanded`, `aria-controls`; an anchored
menu on desktop, a bottom action sheet on phones) holds the room's
alert level (`room-notify`), Invite friends (`room-invite-friends`),
Room settings, Pins, Media, Jump to date, the time scrubber and — for
room moderators — Moderation. Running an action closes it
(`App.settleRoomMenu`); Escape closes it through the one ordered
overlay list (`App.escapeMsg`); a click outside closes it through the
scrim. The 3.8 room state (scheduled event, bridge badge, group-control
mark) keeps a slim second line that only renders when one of them has
something to say. Moved controls keep their classes, test ids and
accessible names.

-}

import App exposing (Model, Msg(..))
import Avatar
import Dict
import Facepile
import Html exposing (Html, button, div, h2, header, p, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, id, type_)
import Html.Events exposing (onClick)
import Nav
import RoomSettings
import Sidebar
import View.CallDock -- v3/calls-c6
import View.CallPresence
import View.DmSafety
import View.ModDesk
import View.Notify
import View.Polish -- v3/polish
import View.RoomSettings
import View.Roster
import View.WatchTogether -- v3/gap-watch


roomHeader : Model -> Html Msg
roomHeader model =
    case model.activeChannel of
        Nothing ->
            text ""

        Just name ->
            let
                topic =
                    roomTopic model name

                -- v3/roomsettings
                isRoom =
                    App.isChannelName model name

                channel =
                    Dict.get (String.toLower name) model.channels
            in
            header
                [ class "onyx-room-header"
                , attribute "aria-label" ("Conversation header for " ++ name)
                , attribute "data-testid" "room-header"
                , attribute "data-kind"
                    (if isRoom then
                        "room"

                     else
                        "dm"
                    )
                ]
                [ backButton model name isRoom
                , div [ class "onyx-room-header-id" ]
                    ((if isRoom then
                        [ privacyGlyph model name ]

                      else
                        [ dmAvatar name ]
                     )
                        ++ [ div [ class "onyx-room-header-titles" ]
                                (h2 [ class "onyx-room-header-name" ] [ text name ]
                                    :: (if isRoom then
                                            topicLine model name topic

                                        else
                                            case channel of
                                                Just ch ->
                                                    [ div [ class "onyx-room-header-safety" ] [ View.DmSafety.convoHeader model ch ] ]

                                                Nothing ->
                                                    []
                                       )
                                )
                           ]
                    )
                , div [ class "onyx-room-header-actions" ]
                    [ case ( isRoom, channel ) of
                        ( True, Just ch ) ->
                            facepileRow ch

                        _ ->
                            text ""
                    , View.CallPresence.headerVoice model -- v3/calls-c1
                    , View.Roster.membersToggle model -- v3/ui-roster: narrow layouts open the member sheet
                    , searchToggle model
                    , moreMenu model name isRoom channel
                    ]
                , if isRoom then
                    subRow model name

                  else
                    text ""
                ]


{-| Phones: back to the collection the conversation lives in (the
nav fold re-opens that page). The badge counts other conversations
waiting. -}
backButton : Model -> String -> Bool -> Html Msg
backButton model name isRoom =
    let
        section =
            Nav.sectionFor (App.isChannelName model) name

        waiting =
            model.channels
                |> Dict.values
                |> List.filter (\c -> String.toLower c.name /= String.toLower name && Sidebar.hasAttention c)
                |> List.length

        label =
            "Back to "
                ++ Nav.label section
                ++ (if waiting > 0 then
                        ", " ++ String.fromInt waiting ++ " with new messages"

                    else
                        ""
                   )
    in
    button
        [ type_ "button"
        , class "onyx-room-back"
        , attribute "aria-label" label
        , attribute "title"
            (if isRoom then
                "Rooms"

             else
                "Messages"
            )
        , attribute "data-testid" "room-back"
        , onClick (NavSelect section)
        ]
        [ span [ class "onyx-shi", attribute "data-icon" "back", attribute "aria-hidden" "true" ] []
        , if waiting > 0 then
            span [ class "onyx-room-back-count", attribute "aria-hidden" "true" ] [ text (String.fromInt waiting) ]

          else
            text ""
        ]


dmAvatar : String -> Html Msg
dmAvatar name =
    span [ class "onyx-face onyx-room-header-avatar", attribute "aria-hidden" "true" ] [ text (Avatar.initials name) ]


{-| The active room's topic ("" when unset or unknown). -}
roomTopic : Model -> String -> String
roomTopic model name =
    Dict.get (String.toLower name) model.channels
        |> Maybe.map (.topic >> String.trim)
        |> Maybe.withDefault ""


icon : String -> Html msg
icon name =
    span [ class "onyx-shi", attribute "data-icon" name, attribute "aria-hidden" "true" ] []


searchToggle : Model -> Html Msg
searchToggle model =
    button
        [ class "onyx-search-toggle onyx-room-header-btn onyx-room-header-icon"
        , classList [ ( "onyx-search-toggle-open", model.searchOpen ) ]
        , attribute "aria-pressed" (boolAttr model.searchOpen)
        , attribute "title" "Search messages"
        , attribute "aria-keyshortcuts" "Control+F Meta+F" -- v3/gap-commands
        , disabled (model.activeChannel == Nothing)
        , onClick SearchOpen
        ]
        [ icon "search", span [ class "sr-only" ] [ text "Search" ] ]


moreMenu : Model -> String -> Bool -> Maybe App.Channel -> Html Msg
moreMenu model name isRoom channel =
    div [ class "onyx-room-more" ]
        ([ button
            [ class "onyx-room-more-toggle onyx-room-header-btn onyx-room-header-icon"
            , attribute "aria-label" "More room actions"
            , attribute "aria-expanded" (boolAttr model.roomMenuOpen)
            , attribute "aria-controls" "onyx-room-more-menu"
            , attribute "title" "More"
            , attribute "data-testid" "room-more"
            , onClick RoomMenuToggle
            ]
            [ icon "more", span [ class "sr-only" ] [ text "More" ] ]
         ]
            ++ (if model.roomMenuOpen then
                    [ div
                        [ class "onyx-room-more-scrim"
                        , attribute "aria-hidden" "true"
                        , onClick RoomMenuClose
                        ]
                        []
                    , div
                        [ class "onyx-room-more-menu"
                        , id "onyx-room-more-menu"
                        , attribute "role" "group"
                        , attribute "aria-label" "Room actions"
                        , attribute "data-testid" "room-more-menu"
                        ]
                        ([ div [ class "onyx-room-more-head", attribute "aria-hidden" "true" ]
                            [ span [ class "onyx-room-more-grip" ] []
                            , span [ class "onyx-room-more-title" ] [ text name ]
                            ]
                         ]
                            ++ (case ( isRoom, channel ) of
                                    ( True, Just ch ) ->
                                        [ div [ class "onyx-room-more-alerts" ] [ View.Notify.roomNotifyStrip model ch.name ] ]

                                    _ ->
                                        []
                               )
                            ++ [ button
                                    [ type_ "button"
                                    , class "onyx-room-more-search"
                                    , onClick SearchOpen
                                    ]
                                    [ text "Search messages" ]
                               ]
                            ++ (if isRoom then
                                    [ button
                                        [ type_ "button"
                                        , class "onyx-room-more-invite"
                                        , attribute "data-testid" "room-invite-friends"
                                        , onClick (InviteShareOpen name)
                                        ]
                                        [ text "Invite friends" ]
                                    ]

                                else
                                    []
                               )
                            ++ View.RoomSettings.settingsToggle model
                            -- v3/roomsettings
                            ++ [ View.CallDock.dmCallItem model -- v3/calls-c6
                               , pinsToggle model
                               , mediaToggle model
                               , jumpToggle model
                               , View.Polish.scrubberToggle model -- v3/polish
                               , View.WatchTogether.menuItem model -- v3/gap-watch
                               ]
                            ++ View.ModDesk.moderationToggle model
                        )
                    ]

                else
                    []
               )
        )


{-| Pinned-messages toggle (the ribbon overflow entry in the
oracle: channel-gated, labeled with the live pin count). -}
pinsToggle : Model -> Html Msg
pinsToggle model =
    let
        count =
            case model.activeChannel of
                Nothing ->
                    0

                Just channel ->
                    List.length (App.channelPins model channel)

        label =
            if count > 0 then
                String.fromInt count
                    ++ " pinned message"
                    ++ (if count == 1 then
                            ""

                        else
                            "s"
                       )

            else
                "Pinned messages"
    in
    button
        [ class "onyx-pins-toggle"
        , classList [ ( "onyx-pins-toggle-open", model.showPinnedMessages ) ]
        , attribute "aria-pressed" (boolAttr model.showPinnedMessages)
        , attribute "aria-label" label
        , attribute "data-testid" "ribbon-pins"
        , disabled (model.activeChannel == Nothing)
        , onClick PinnedMessagesOpen
        ]
        [ text "Pins" ]


{-| Conversation-media toggle (the ribbon overflow entry in the
oracle: channel-gated, labelled for the active conversation). -}
mediaToggle : Model -> Html Msg
mediaToggle model =
    let
        label =
            case model.activeChannel of
                Nothing ->
                    "Pictures, files, and links"

                Just channel ->
                    "Pictures, files, and links for " ++ channel
    in
    button
        [ class "onyx-media-toggle"
        , classList [ ( "onyx-media-toggle-open", model.mediaIndexOpen ) ]
        , attribute "aria-pressed" (boolAttr model.mediaIndexOpen)
        , attribute "aria-label" label
        , attribute "data-testid" "ribbon-room-media"
        , disabled (model.activeChannel == Nothing)
        , onClick MediaIndexOpen
        ]
        [ text "Media" ]


{-| Jump-to-date toggle (the discoverable time-travel entry in the
oracle: channel-gated, opening the date sheet for the active
conversation). -}
jumpToggle : Model -> Html Msg
jumpToggle model =
    button
        [ class "onyx-jump-toggle"
        , attribute "aria-label" "Jump to date"
        , attribute "data-testid" "topbar-jump-to-date"
        , disabled (model.activeChannel == Nothing)
        , onClick JumpToDateOpen
        ]
        [ text "Jump to date" ]


boolAttr : Bool -> String
boolAttr on =
    if on then
        "true"

    else
        "false"



-- v3/roomsettings


{-| Privacy in words (the glyph is decorative; the label carries it). -}
privacyGlyph : Model -> String -> Html Msg
privacyGlyph model name =
    case (App.roomSettingsCtx model).room of
        Just room ->
            let
                privacy =
                    RoomSettings.privacyOf room
            in
            span
                [ class "onyx-room-privacy"
                , attribute "data-testid" "room-privacy"
                , attribute "data-privacy" privacy.key
                , attribute "role" "img"
                , attribute "aria-label" privacy.label
                , attribute "title" privacy.label
                ]
                [ View.CallPresence.callIcon privacy.icon ]

        Nothing ->
            text ""


{-| Topics longer than one line expand in place. -}
topicExpandThreshold : Int
topicExpandThreshold =
    60


topicLine : Model -> String -> String -> List (Html Msg)
topicLine model name topic =
    let
        expanded =
            RoomSettings.topicExpanded name model.roomSettings

        long =
            String.length topic > topicExpandThreshold
    in
    [ div [ class "onyx-room-header-topic-row" ]
        ([ p
            [ class "onyx-room-header-topic"
            , classList
                [ ( "onyx-room-header-topic-open", expanded && long )
                , ( "onyx-room-header-topic-empty", String.isEmpty topic )
                ]
            , id "onyx-room-header-topic"
            , attribute "title" topic
            ]
            [ text
                (if String.isEmpty topic then
                    "No topic set"

                 else
                    topic
                )
            ]
         ]
            ++ (if long then
                    [ button
                        [ type_ "button"
                        , class "onyx-room-topic-toggle"
                        , attribute "aria-expanded" (boolAttr expanded)
                        , attribute "aria-controls" "onyx-room-header-topic"
                        , attribute "aria-label"
                            (if expanded then
                                "Show less of the topic"

                             else
                                "Show the full topic"
                            )
                        , attribute "data-testid" "room-topic-toggle"
                        , onClick (RoomSettingsMsg (RoomSettings.TopicExpandToggle name))
                        ]
                        [ text
                            (if expanded then
                                "Less"

                             else
                                "More"
                            )
                        ]
                    ]

                else
                    []
               )
        )
    ]


{-| The 3.8 room state line (scheduled event, bridge badge, group-
control mark). Each part self-gates, so the line collapses (`:empty`)
when none has anything to say. -}
subRow : Model -> String -> Html Msg
subRow model name =
    div [ class "onyx-room-header-sub" ]
        [ View.RoomSettings.scheduledEventLine model name
        , View.RoomSettings.bridgeBadge model name
        , View.RoomSettings.groupControlMark model name
        ]


{-| Overlapping avatar stack (mirroring the ribbon `Facepile`:
prioritized faces open the member card). Moved from the transcript.
-}
facepileRow : App.Channel -> Html Msg
facepileRow channel =
    let
        pile =
            Facepile.buildFacepile
                (List.map
                    (\m -> { nick = m.nick, modes = m.modes, away = m.away, lastActiveAt = Nothing })
                    (Dict.values channel.members)
                )
                Nothing
    in
    if pile.total == 0 then
        text ""

    else
        div
            [ class "onyx-facepile"
            , attribute "role" "group"
            , attribute "aria-label" (Facepile.groupLabel pile.total)
            ]
            (List.map (facepileFace channel.name) pile.entries
                ++ (if pile.overflow > 0 then
                        [ span
                            [ class "onyx-facepile-overflow"
                            , attribute "title" (String.fromInt pile.overflow ++ " more")
                            , attribute "aria-label" (String.fromInt pile.overflow ++ " more people in this room")
                            ]
                            [ span [ attribute "aria-hidden" "true" ] [ text ("+" ++ String.fromInt pile.overflow) ] ]
                        ]

                    else
                        []
                   )
            )


facepileFace : String -> Facepile.Entry -> Html Msg
facepileFace channel entry =
    button
        [ type_ "button"
        , class "onyx-facepile-face"
        , attribute "aria-label"
            ("Open profile for "
                ++ entry.nick
                ++ ", "
                ++ (if entry.away then
                        "away"

                    else
                        "here"
                   )
            )
        , attribute "title"
            (if entry.away then
                entry.nick ++ " — away"

             else
                entry.nick
            )
        , onClick (App.UserProfileOpened { nick = entry.nick, channel = channel })
        ]
        [ Avatar.view
            { name = entry.nick
            , owner = entry.owner
            , size = Avatar.Sm
            , extraClass =
                if entry.away then
                    "onyx-facepile-away"

                else
                    ""
            , hidden = True
            }
        ]
