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

-}

import App exposing (Model, Msg(..))
import Dict
import Html exposing (Html, button, div, h2, header, p, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, id)
import Html.Events exposing (onClick)
import View.CallPresence
import View.CallDock -- v3/calls-c6
import View.ModDesk


roomHeader : Model -> Html Msg
roomHeader model =
    case model.activeChannel of
        Nothing ->
            text ""

        Just name ->
            let
                topic =
                    roomTopic model name
            in
            header
                [ class "onyx-room-header"
                , attribute "aria-label" ("Conversation header for " ++ name)
                , attribute "data-testid" "room-header"
                ]
                [ div [ class "onyx-room-header-id" ]
                    [ h2 [ class "onyx-room-header-name" ] [ text name ]
                    , p
                        [ class "onyx-room-header-topic"
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
                , div [ class "onyx-room-header-actions" ]
                    [ View.CallPresence.headerVoice model -- v3/calls-c1
                    , searchToggle model
                    , moreMenu model
                    ]
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
                        ([ View.CallDock.dmCallItem model -- v3/calls-c6
                         , pinsToggle model
                         , mediaToggle model
                         , jumpToggle model
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
