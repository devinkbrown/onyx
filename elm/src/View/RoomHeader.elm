module View.RoomHeader exposing (jumpToggle, mediaToggle, pinsToggle, roomHeader, roomTopic)

{-| v3/frame — the room header at the top of the conversation column
(roadmap 3.1 direction: name, one-line topic, presence, overflow).

Everything here is ROOM-scoped; network-scoped controls (palette
launcher, Calls, Alerts, Operator, connection pill, You, Leave) stay in
the global `View.Topbar`. Layout:

  - the room name (`h2`) and its one-line topic;
  - the call presence chip / status / Join call (`View.CallPresence`),
    kept visible — never inside the overflow;
  - Search (frequent, so it stays visible);
  - a "More" disclosure (`aria-expanded`, `aria-controls`) that holds
    Pins, Media, Jump to date and — for room moderators — Moderation.
    Running an action closes it (`App.settleRoomMenu`); Escape closes it
    through the one ordered overlay list (`App.escapeMsg`); a click
    outside closes it through the transparent scrim.

The moved buttons keep their classes, test ids and accessible names.

v3/roomsettings finishes the header (roadmap 3.1 / 3.8):

  - a privacy glyph before the name (words in its label, never mode
    letters) and an expandable one-line topic (`More` / `Less`,
    per-room, so it resets on room change);
  - the facepile (rooms), moved here from the top of the transcript;
  - a second row with the room notify strip (`room-notify`), the
    Invite friends / DM safety trigger (`View.DmSafety.convoHeader`),
    the scheduled-event line, the bridge badge and the group-control
    mark — all moved or new, all keeping their test ids;
  - "Room settings" as the first More action (`View.RoomSettings`).

-}

import App exposing (Model, Msg(..))
import Avatar
import Dict
import Facepile
import Html exposing (Html, button, div, h2, header, p, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, id, type_)
import Html.Events exposing (onClick)
import RoomSettings
import View.CallPresence
import View.DmSafety
import View.CallDock -- v3/calls-c6
import View.ModDesk
import View.Notify
import View.RoomSettings
import View.Roster
import View.Polish -- v3/polish


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
                ]
                [ div [ class "onyx-room-header-id" ]
                    ((if isRoom then
                        [ privacyGlyph model name ]

                      else
                        []
                     )
                        ++ [ h2 [ class "onyx-room-header-name" ] [ text name ] ]
                        ++ (if isRoom then
                                topicLine model name topic

                            else
                                []
                           )
                    )
                , div [ class "onyx-room-header-actions" ]
                    [ case ( isRoom, channel ) of
                        ( True, Just ch ) ->
                            facepileRow ch

                        _ ->
                            text ""
                    , View.Roster.membersToggle model -- v3/ui-roster: narrow layouts open the member sheet
                    , View.CallPresence.headerVoice model -- v3/calls-c1
                    , searchToggle model
                    , moreMenu model
                    ]
                , case channel of
                    Just ch ->
                        subRow model isRoom ch

                    Nothing ->
                        text ""
                ]


{-| The active room's topic ("" when unset or unknown). -}
roomTopic : Model -> String -> String
roomTopic model name =
    Dict.get (String.toLower name) model.channels
        |> Maybe.map (.topic >> String.trim)
        |> Maybe.withDefault ""


searchToggle : Model -> Html Msg
searchToggle model =
    button
        [ class "onyx-search-toggle onyx-room-header-btn"
        , classList [ ( "onyx-search-toggle-open", model.searchOpen ) ]
        , attribute "aria-pressed" (boolAttr model.searchOpen)
        , disabled (model.activeChannel == Nothing)
        , onClick SearchOpen
        ]
        [ text "Search" ]


moreMenu : Model -> Html Msg
moreMenu model =
    div [ class "onyx-room-more" ]
        ([ button
            [ class "onyx-room-more-toggle onyx-room-header-btn"
            , attribute "aria-label" "More room actions"
            , attribute "aria-expanded" (boolAttr model.roomMenuOpen)
            , attribute "aria-controls" "onyx-room-more-menu"
            , attribute "data-testid" "room-more"
            , onClick RoomMenuToggle
            ]
            [ text "More" ]
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
                        (View.RoomSettings.settingsToggle model
                            -- v3/roomsettings
                            ++ [ View.CallDock.dmCallItem model -- v3/calls-c6
                               , pinsToggle model
                               , mediaToggle model
                               , jumpToggle model
                               , View.Polish.scrubberToggle model -- v3/polish
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
        [ text "Jump" ]


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
    [ p
        [ class "onyx-room-header-topic"
        , classList [ ( "onyx-room-header-topic-open", expanded && long ) ]
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


{-| Second header row: alerts, invite / DM safety, and the 3.8 room
state (scheduled event, bridge badge, group-control mark).
-}
subRow : Model -> Bool -> App.Channel -> Html Msg
subRow model isRoom ch =
    div [ class "onyx-room-header-sub" ]
        (if isRoom then
            [ View.Notify.roomNotifyStrip model ch.name
            , View.DmSafety.convoHeader model ch
            , View.RoomSettings.scheduledEventLine model ch.name
            , View.RoomSettings.bridgeBadge model ch.name
            , View.RoomSettings.groupControlMark model ch.name
            ]

         else
            [ View.DmSafety.convoHeader model ch ]
        )


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
