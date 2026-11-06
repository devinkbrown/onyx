module View.RoomHeader exposing (conversationShown, roomHeader)

{-| v3/room-header — the conversation header.

One row above the transcript: the room glyph and name, a summary line
(member count and the one-line topic) that opens the room details, a
facepile on wide screens, and the conversation tools (Members, Search,
Pins, Media) that used to crowd the top bar.

The details panel holds what used to sit loose above the transcript:
the full topic (editable by room operators), Follow, the named-topic
tools, and the history tools (catch up, fill gaps) with their
explanations. It is always in the DOM (`hidden` while closed), so the
tools keep one home and one set of names.

On phones the top bar already names the page, so the header drops the
name and keeps the summary and the tools on one row.

-}

import App exposing (Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, button, div, form, h2, header, input, label, p, section, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, for, hidden, id, type_, value)
import Html.Events exposing (custom, onClick, onInput, onSubmit)
import Json.Decode as Decode
import Media
import RuntimeDomain
import Nav
import Set
import View.Thread


{-| A conversation is on screen (not Home, not the calls hub). On
phones the collection page can still cover it; CSS handles that. -}
conversationShown : Model -> Bool
conversationShown model =
    not model.callsOpen && Nav.isCollection model.navSection && model.activeChannel /= Nothing


roomHeader : Model -> Html Msg
roomHeader model =
    case model.activeChannel |> Maybe.andThen (\name -> Dict.get (String.toLower name) model.channels) of
        Nothing ->
            text ""

        Just channel ->
            if not (conversationShown model) then
                text ""

            else
                let
                    isRoom =
                        App.isChannelName model channel.name

                    memberCount =
                        Dict.size channel.members

                    countLabel =
                        String.fromInt memberCount
                            ++ (if memberCount == 1 then
                                    " member"

                                else
                                    " members"
                               )

                    topicLine =
                        if not isRoom then
                            "Direct message"

                        else if String.isEmpty (String.trim channel.topic) then
                            "No topic yet"

                        else
                            channel.topic
                in
                header
                    [ class "onyx-room-head"
                    , classList [ ( "onyx-room-head--open", model.roomDetailsOpen ) ]
                    , attribute "aria-label" ("About " ++ channel.name)
                    ]
                    [ div [ class "onyx-room-bar" ]
                        [ div [ class "onyx-room-id" ]
                            [ if isRoom then
                                span [ class "onyx-room-glyph", attribute "aria-hidden" "true" ] [ text "#" ]

                              else
                                span [ class "onyx-room-avatar", attribute "aria-hidden" "true" ]
                                    [ Avatar.view { name = channel.name, owner = False, size = Avatar.Sm, extraClass = "", hidden = True } ]
                            , div [ class "onyx-room-titles" ]
                                [ h2 [ class "onyx-room-name" ] [ text (roomTitle channel.name) ]
                                , button
                                    [ type_ "button"
                                    , class "onyx-room-summary"
                                    , id "room-details-toggle"
                                    , attribute "aria-expanded" (boolString model.roomDetailsOpen)
                                    , attribute "title" "Room details"
                                    , onClick RoomDetailsToggle
                                    ]
                                    ((if isRoom then
                                        [ span [ class "onyx-room-count" ] [ text countLabel ]
                                        , span [ class "onyx-room-sep", attribute "aria-hidden" "true" ] [ text "·" ]
                                        ]

                                      else
                                        []
                                     )
                                        ++ [ span
                                                [ classList
                                                    [ ( "onyx-room-topic", True )
                                                    , ( "onyx-room-topic--empty", isRoom && String.isEmpty (String.trim channel.topic) )
                                                    ]
                                                ]
                                                [ text topicLine ]
                                           , span [ class "sr-only" ] [ text " — room details" ]
                                           ]
                                    )
                                ]
                            ]
                        , tools model isRoom
                        ]
                    , details model channel isRoom
                    ]


{-| Long names stay whole in the DOM; CSS ellipsizes them. -}
roomTitle : String -> String
roomTitle name =
    name


tools : Model -> Bool -> Html Msg
tools model isRoom =
    div
        [ class "onyx-room-tools onyx-topbar-tools"
        , attribute "role" "group"
        , attribute "aria-label" "Conversation tools"
        , attribute "data-more-open" (boolString model.roomToolsOpen)
        , if model.roomToolsOpen then
            custom "keydown" (Decode.map (\m -> { message = m, stopPropagation = True, preventDefault = True }) (keyDecoder "Escape" RoomToolsToggle))

          else
            class ""
        ]
        [ if isRoom then
            callButton model

          else
            text ""
        , button
            [ type_ "button"
            , class "onyx-search-toggle onyx-convo-tool"
            , classList [ ( "onyx-search-toggle-open", model.searchOpen ) ]
            , attribute "aria-pressed" (boolString model.searchOpen)
            , attribute "aria-label" "Search"
            , attribute "title" "Search messages"
            , onClick SearchOpen
            ]
            [ icon "search", span [ class "onyx-tool-label" ] [ text "Search" ] ]
        , if isRoom then
            button
                [ class "onyx-client-panel-toggle onyx-convo-tool"
                , type_ "button"
                , attribute "aria-controls" "client-members"
                , attribute "aria-expanded" (boolString model.clientMembersOpen)
                , attribute "aria-label" "Members"
                , attribute "title" "Members"
                , onClick ToggleClientMembers
                ]
                [ icon "members", span [ class "onyx-tool-label" ] [ text "Members" ] ]

          else
            text ""
        , -- Phones fold the less-used tools behind one button; wider
          -- screens show them inline (this button is hidden there).
          button
            [ type_ "button"
            , class "onyx-room-more-toggle onyx-convo-tool"
            , id "room-tools-more"
            , attribute "aria-expanded" (boolString model.roomToolsOpen)
            , attribute "aria-controls" "room-tools-more-list"
            , attribute "aria-label" "More conversation tools"
            , onClick RoomToolsToggle
            ]
            [ icon "more" ]
        , div [ class "onyx-room-more", id "room-tools-more-list" ]
            [ pinsToggle model
            , mediaToggle model
            ]
        ]


{-| Start or join this room's voice call, or leave it while you're in it.
The join button carries the `data-onyx-media-capture` hook: ports.js asks for
the microphone inside this click (browsers require a user gesture) and the
runtime then joins the call. Calls need a signed-in account and a live
connection. -}
callButton : Model -> Html Msg
callButton model =
    let
        room =
            Maybe.withDefault "" model.activeChannel

        inThisCall =
            model.calls.lifecycle /= Media.Idle && model.calls.channel == Just room

        signedIn =
            model.accountName /= Nothing

        live =
            model.connection == App.Live
    in
    if inThisCall then
        button
            [ type_ "button"
            , class "onyx-call-toggle onyx-call-toggle--leave onyx-convo-tool"
            , attribute "aria-label" "Leave call"
            , attribute "title" "Leave call"
            , onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaLeave (Just room)))
            ]
            [ icon "call-end", span [ class "onyx-tool-label" ] [ text "Leave call" ] ]

    else
        button
            [ type_ "button"
            , class "onyx-call-toggle onyx-convo-tool"
            , attribute "data-onyx-media-capture" "voice"
            , attribute "data-onyx-media-conversation" room
            , attribute "aria-label" ("Voice call in " ++ room)
            , attribute "title"
                (if not signedIn then
                    "Sign in to start or join calls"

                 else if not live then
                    "Calls need a connection"

                 else
                    "Start or join the voice call"
                )
            , disabled (not signedIn || not live || String.isEmpty room)
            ]
            [ icon "call", span [ class "onyx-tool-label" ] [ text "Call" ] ]


{-| Pinned-messages toggle (channel-gated, labelled with the live pin
count). -}
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
                String.fromInt count ++ " pinned message" ++ (if count == 1 then "" else "s")

            else
                "Pinned messages"
    in
    button
        [ type_ "button"
        , class "onyx-pins-toggle onyx-convo-tool"
        , classList [ ( "onyx-pins-toggle-open", model.showPinnedMessages ) ]
        , attribute "aria-pressed" (boolString model.showPinnedMessages)
        , attribute "aria-label" label
        , attribute "title" label
        , attribute "data-testid" "ribbon-pins"
        , disabled (model.activeChannel == Nothing)
        , onClick PinnedMessagesOpen
        ]
        ([ icon "pin", span [ class "onyx-tool-label" ] [ text "Pins" ] ]
            ++ (if count > 0 then
                    [ span [ class "onyx-tool-count", attribute "aria-hidden" "true" ] [ text (String.fromInt count) ] ]

                else
                    []
               )
        )


{-| Conversation-media toggle (labelled for the active conversation). -}
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
        [ type_ "button"
        , class "onyx-media-toggle onyx-convo-tool"
        , classList [ ( "onyx-media-toggle-open", model.mediaIndexOpen ) ]
        , attribute "aria-pressed" (boolString model.mediaIndexOpen)
        , attribute "aria-label" label
        , attribute "title" "Pictures, files, and links"
        , attribute "data-testid" "ribbon-room-media"
        , disabled (model.activeChannel == Nothing)
        , onClick MediaIndexOpen
        ]
        [ icon "media", span [ class "onyx-tool-label" ] [ text "Media" ] ]


details : Model -> App.Channel -> Bool -> Html Msg
details model channel isRoom =
    let
        key =
            String.toLower channel.name

        hasHistory =
            List.any (\cap -> cap == "chathistory" || cap == "draft/chathistory") model.caps

        busy =
            Set.member key model.historyLoading

        offline =
            model.connection /= App.Live
    in
    section
        [ class "onyx-room-details"
        , id "room-details"
        , attribute "aria-label" ("Room details for " ++ channel.name)
        , hidden (not model.roomDetailsOpen)
        , custom "keydown" (Decode.map (\m -> { message = m, stopPropagation = True, preventDefault = True }) escapeDecoder)
        ]
        [ if isRoom then
            topicBlock model channel

          else
            text ""
        , if isRoom && not (Dict.isEmpty channel.members) then
            div [ class "onyx-room-section onyx-room-people" ]
                [ h3Label "People here"
                , View.Thread.facepileRow channel
                ]

          else
            text ""
        , if model.prefs.topicTools then
            div [ class "onyx-room-section" ]
                [ h3Label "Conversations"
                , p [ class "onyx-room-hint" ] [ text "Follow the room or a named topic, or start a topic people can reply under." ]
                , View.Thread.topicTools model channel
                ]

          else
            text ""
        , div [ class "onyx-room-section" ]
            [ h3Label "History"
            , View.Thread.ephemeralPolicyNotice model channel.name
            , View.Thread.retentionScopeNotice model channel.name
            , div [ class "history-catch-up", attribute "role" "group", attribute "aria-label" "History catch-up" ]
                [ button [ type_ "button", onClick ThreadCatchUp, disabled (offline || busy || not hasHistory) ] [ text "Check for newer messages" ]
                , button [ type_ "button", onClick ThreadFillGaps, disabled (offline || busy || List.length channel.messages < 2 || not hasHistory) ] [ text "Fill gaps in history" ]
                ]
            , p [ class "onyx-room-hint" ]
                [ text
                    (if not hasHistory then
                        "This server does not offer message history."

                     else
                        "Catch up fetches anything newer than the latest message here. Filling gaps re-requests the span between the oldest and newest loaded messages — server paging can leave gaps when messages share a timestamp."
                    )
                ]
            ]
        , div [ class "onyx-room-details-foot" ]
            [ button [ type_ "button", class "onyx-room-details-close", onClick RoomDetailsClose ] [ text "Done" ] ]
        ]


topicBlock : Model -> App.Channel -> Html Msg
topicBlock model channel =
    let
        canEdit =
            App.isChannelOp model channel.name

        topic =
            String.trim channel.topic
    in
    div [ class "onyx-room-section onyx-room-topic-block" ]
        [ h3Label "Topic"
        , case model.roomTopicDraft of
            Just draft ->
                form [ class "onyx-room-topic-form", onSubmit RoomTopicEditSubmit ]
                    [ label [ class "sr-only", for "room-topic-input" ] [ text ("Topic for " ++ channel.name) ]
                    , input
                        [ id "room-topic-input"
                        , class "onyx-room-topic-input"
                        , value draft
                        , attribute "maxlength" (String.fromInt App.maxRoomTopicChars)
                        , attribute "autocomplete" "off"
                        , onInput RoomTopicEditInput
                        ]
                        []
                    , div [ class "onyx-room-topic-actions" ]
                        [ button [ type_ "submit", class "onyx-room-primary", disabled (model.connection /= App.Live) ] [ text "Save topic" ]
                        , button [ type_ "button", onClick RoomTopicEditCancel ] [ text "Cancel" ]
                        ]
                    ]

            Nothing ->
                div [ class "onyx-room-topic-view" ]
                    [ p
                        [ classList [ ( "onyx-room-topic-full", True ), ( "onyx-room-topic--empty", String.isEmpty topic ) ] ]
                        [ text
                            (if String.isEmpty topic then
                                "No topic set."

                             else
                                topic
                            )
                        ]
                    , if canEdit then
                        button [ type_ "button", id "room-topic-edit", class "onyx-room-topic-edit", onClick RoomTopicEditStart ]
                            [ text
                                (if String.isEmpty topic then
                                    "Set topic"

                                 else
                                    "Edit topic"
                                )
                            ]

                      else
                        text ""
                    ]
        ]


h3Label : String -> Html Msg
h3Label title =
    Html.h3 [ class "onyx-room-section-title" ] [ text title ]


icon : String -> Html Msg
icon name =
    span [ class "onyx-icon", attribute "data-icon" name, attribute "aria-hidden" "true" ] []


boolString : Bool -> String
boolString on =
    if on then
        "true"

    else
        "false"


keyDecoder : String -> Msg -> Decode.Decoder Msg
keyDecoder wanted msg =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                if key == wanted then
                    Decode.succeed msg

                else
                    Decode.fail "other key"
            )


escapeDecoder : Decode.Decoder Msg
escapeDecoder =
    Decode.field "key" Decode.string
        |> Decode.andThen
            (\key ->
                if key == "Escape" then
                    Decode.succeed RoomDetailsClose

                else
                    Decode.fail "not escape"
            )
