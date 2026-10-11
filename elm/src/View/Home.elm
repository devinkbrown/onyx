module View.Home exposing (coach, emptyRoomIntro, home, rooms)

{-| Home briefing (the shell's no-active-conversation surface),
mirroring `shell/home/HomeBriefingView.tsx` + `HomeMarkCaughtUp.tsx`,
the `FirstHourCoach` card, and the `MessageView` empty-feed intro.

Derivations live in `Home`; this module only arranges them. Actions
reuse existing folds: rows/cards open through `ChannelSelect` (which
marks read), Browse rooms / Start a room through `BrowserOpen` /
`CreateRoomOpen`, retry through `OutboxFlushRequest`; the v3/home
folds add `HomeMarkAllCaughtUp`, `HomeCoachDismiss`, `HomeInviteCopy`.

Narrowings: no device-memory (vault) catch-up, continue-reading
resume points, recap cards, formation strip, recently-visited rooms,
or room-invite tier (Elm has no INVITE inbox projection yet); the
queued-send rows show destination + status but not the per-row
Open / Remove controls (the durable queue stays ports-side).
-}

import App exposing (Channel, Model, Msg(..))
import Dict
import Home
import Html exposing (Html, button, dd, div, dl, dt, h1, h2, h3, li, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, classList, id, tabindex, type_)
import Html.Events exposing (onClick)
import Outbox
import Stats
import View.GuestClaim exposing (guestClaimChip)
-- v3/gap-organize
import Organizer
import View.Attention
import View.Organize


{-| Every open conversation, projected for Home. -}
rooms : Model -> List Home.Room
rooms model =
    Home.projectRooms
        (App.isChannelName model)
        (\name -> Dict.member (String.toLower name) model.firstUnreadId)
        (Dict.values model.channels)


isGuest : Model -> Bool
isGuest model =
    model.accountName == Nothing


home : Model -> Html Msg
home model =
    let
        all =
            rooms model

        joined =
            List.filter (\r -> r.kind == Home.RoomKind) all
                |> List.sortBy (.name >> String.toLower)

        dms =
            List.filter (\r -> r.kind == Home.DmKind) all
                |> List.sortBy (.name >> String.toLower)

        inbox =
            Home.composeInbox all

        plan =
            Home.planCatchUpAll all

        connected =
            model.connection == App.Live

        caughtUpEmpty =
            inbox.empty && not (List.isEmpty all)
    in
    section [ class "onyx-home", attribute "aria-label" "Home", attribute "data-testid" "home" ]
        [ div [ class "onyx-home-inner" ]
            [ div [ class "onyx-home-masthead" ]
                [ p [ class "onyx-home-welcome" ] [ text (Home.welcomeLine model.ourNick) ]
                , h1 [ class "onyx-home-title" ] [ text (Home.title inbox) ]
                , if plan.rooms > 0 then
                    signalStrip plan

                  else
                    text ""
                , if caughtUpEmpty then
                    p [ class "onyx-home-caught-up", attribute "role" "status" ] [ text "Caught up in the rooms you joined." ]

                  else
                    text ""
                , View.Attention.homeMemoryNote model -- v3/gap-organize
                , p
                    [ class "onyx-home-announce"
                    , attribute "role" "status"
                    , attribute "aria-live" "polite"
                    , tabindex -1
                    ]
                    [ text model.homeCaughtUpAnnounce ]
                ]
            , -- v3/ui-mobile-shell: one clear next step first (the quiet
              -- state's Browse / Start), then the quieter asks.
              if inbox.empty then
                quietSection
                    { caughtUp = caughtUpEmpty
                    , connected = connected
                    , firstRoom =
                        Home.showFirstRoomPrompt
                            { connected = connected
                            , hasRooms = not (List.isEmpty joined)
                            , directoryCount = List.length model.channelList
                            }
                    }

              else
                inboxSection model plan inbox
            , -- v3/ui-mobile-shell: the guest "Keep the name" ask lives on
              -- Home (and in the You hub), never as a strip over a room.
              guestClaimChip model
            , coach model Home.HomeNext
            , View.Organize.homeSaved model -- v3/gap-organize
            , outboxSection model connected
            , if Home.showInviteFriends { connected = connected, roomCount = List.length joined, dmCount = List.length dms } then
                inviteSection model

              else
                text ""
            , roomAccess joined dms
            ]
        ]


signalStrip : Home.CaughtUpPlan -> Html Msg
signalStrip plan =
    section [ class "onyx-home-signal", attribute "aria-label" "Catch-up summary" ]
        [ p [ class "onyx-home-signal-lead" ]
            [ strong [] [ text "Needs your attention" ]
            , text " "
            , span [] [ text (Home.signalMessage plan) ]
            ]
        , dl [ class "onyx-home-signal-metrics" ]
            [ div [] [ dt [] [ text "Unread" ], dd [] [ text (String.fromInt plan.unread) ] ]
            , div [] [ dt [] [ text "Mentions" ], dd [] [ text (String.fromInt plan.mentions) ] ]
            ]
        ]


inboxSection : Model -> Home.CaughtUpPlan -> Home.Inbox -> Html Msg
inboxSection model plan inbox =
    let
        -- v3/gap-organize: "Since you left" — who, when, what about
        digest =
            View.Attention.digest model
    in
    section [ class "onyx-home-inbox", attribute "aria-label" "Catch up on what you missed" ]
        [ div [ class "onyx-home-head" ]
            [ div []
                [ h2 [ class "onyx-home-label" ] [ text "Needs your attention" ]
                , p [ class "onyx-home-summary" ] [ text (Home.catchUpSummary plan) ]
                , View.Attention.digestHead model digest
                ]
            , if plan.rooms > 0 then
                button
                    [ type_ "button"
                    , class "onyx-home-caught-up-button"
                    , attribute "aria-label" (Home.markCaughtUpLabel plan)
                    , attribute "data-testid" "home-mark-caught-up"
                    , onClick HomeMarkAllCaughtUp
                    ]
                    [ span [] [ text "Mark all caught up" ]
                    , span [ class "onyx-home-count", attribute "aria-hidden" "true" ] [ text (String.fromInt plan.rooms) ]
                    ]

              else
                text ""
            ]
        , tier (View.Attention.digestLine model digest) "Mentions" "Mentions" inbox.mentions
        , tier (View.Attention.digestLine model digest) "Unread" "Unread rooms and messages" inbox.missed
        ]


tier : (String -> Html Msg) -> String -> String -> List Home.Room -> Html Msg
tier detail heading groupLabel rows =
    if List.isEmpty rows then
        text ""

    else
        div [ class "onyx-home-tier", attribute "role" "group", attribute "aria-label" groupLabel ]
            [ h3 [ class "onyx-home-label" ] [ text heading ]
            , ul [ class "onyx-home-list" ] (List.map (inboxRow detail) rows)
            ]


avatar : Home.Kind -> String -> Html Msg
avatar kind name =
    span
        [ class "onyx-home-avatar"
        , classList [ ( "onyx-home-avatar-person", kind == Home.DmKind ) ]
        , attribute "aria-hidden" "true"
        ]
        [ text (Home.initials name) ]


inboxRow : (String -> Html Msg) -> Home.Room -> Html Msg
inboxRow detail row =
    li []
        [ button
            [ type_ "button"
            , class "onyx-home-row"
            , classList [ ( "is-unread", row.unread > 0 || row.highlights > 0 ), ( "is-mention", row.highlights > 0 ) ]
            , attribute "aria-label" (Home.inboxAria row)
            , -- v3/gap-organize: land on the first unread line
              onClick (OrganizeMsg (Organizer.DigestJump row.name))
            ]
            [ avatar row.kind row.name
            , span [ class "onyx-home-row-copy" ]
                [ span [ class "onyx-home-row-name" ] [ text (Home.visibleName row.kind row.name) ]
                , if row.highlights > 0 then
                    span [ class "onyx-home-row-meta" ]
                        [ text
                            (if row.highlights == 1 then
                                "mentioned you"

                             else
                                String.fromInt row.highlights ++ " mentions"
                            )
                        ]

                  else
                    text ""
                , detail row.name -- v3/gap-organize
                ]
            , if row.unread > 0 then
                span [ class "onyx-home-unread" ] [ text (String.fromInt row.unread) ]

              else
                text ""
            ]
        ]


outboxSection : Model -> Bool -> Html Msg
outboxSection model connected =
    case
        Outbox.homeChrome
            { connected = connected
            , queuedCount = toFloat (List.length model.outbox)
            , prunePendingCount = 0
            , uncertainCount = toFloat (List.length model.outboxUncertain)
            , deliveryFailed = model.outboxFailed
            }
    of
        Nothing ->
            text ""

        Just chrome ->
            section
                [ class "onyx-home-outbox"
                , class ("onyx-home-outbox-" ++ toneName chrome.tone)
                , attribute "aria-labelledby" "home-outbox-title"
                ]
                [ div [ class "onyx-home-head" ]
                    [ div []
                        [ h2 [ id "home-outbox-title", class "onyx-home-label" ] [ text chrome.title ]
                        , p [ class "onyx-home-summary", attribute "role" "status" ] [ text chrome.detail ]
                        , p [ class "onyx-home-privacy" ]
                            [ text "Message bodies stay inside their conversations; Home shows only destination and age." ]
                        ]
                    , if chrome.showRetry then
                        button [ type_ "button", class "onyx-home-action", onClick OutboxFlushRequest ] [ text "Try sending now" ]

                      else
                        text ""
                    ]
                , ul [ class "onyx-home-outbox-list", attribute "aria-label" "Queued messages waiting on this device" ]
                    (List.map
                        (\entry ->
                            li [ class "onyx-home-outbox-item" ]
                                [ span [ class "onyx-home-outbox-target" ] [ text entry.target ]
                                , span [ class "onyx-home-outbox-age" ]
                                    [ text
                                        (Outbox.entryStatusLabel entry.queuedAt model.nowMs
                                            ++ " · "
                                            ++ Stats.relTime (entry.queuedAt / 1000) model.nowMs
                                        )
                                    ]
                                , View.Organize.homeOutboxActions model entry -- v3/gap-organize
                                ]
                        )
                        model.outbox
                    )
                , -- v3/gap-organize
                  p [ class "onyx-home-privacy" ] [ text "Remove deletes this device's queued copy; it cannot recall a message the connection already took." ]
                ]


toneName : Outbox.Tone -> String
toneName tone =
    case tone of
        Outbox.ToneOffline ->
            "offline"

        Outbox.ToneQueued ->
            "queued"

        Outbox.ToneWarning ->
            "warning"

        Outbox.ToneError ->
            "error"


quietSection : { caughtUp : Bool, connected : Bool, firstRoom : Bool } -> Html Msg
quietSection input =
    section
        [ class "onyx-home-empty"
        , classList [ ( "is-first-room", input.firstRoom ) ]
        , attribute "aria-label" "The room is quiet"
        ]
        [ p [ class "onyx-home-empty-copy" ]
            [ text (Home.quietDescription { caughtUp = input.caughtUp, connected = input.connected }) ]
        , div [ class "onyx-home-actions", attribute "role" "group", attribute "aria-label" "Find or start a room" ]
            [ button [ type_ "button", class "onyx-home-action onyx-home-action--primary", onClick BrowserOpen ] [ text "Browse rooms" ]
            , button [ type_ "button", class "onyx-home-action onyx-home-action--quiet", onClick CreateRoomOpen ] [ text "Start a room" ]
            ]
        ]


inviteSection : Model -> Html Msg
inviteSection model =
    section [ class "onyx-home-invite", attribute "aria-label" "Invite friends" ]
        [ p [ class "onyx-home-empty-copy" ] [ text "Onyx is better with your people. Copy an invite link and send it to a friend." ]
        , button
            [ type_ "button"
            , class "onyx-home-action onyx-home-action--quiet"
            , attribute "data-testid" "home-invite-friends"
            -- v3/dmsafety: opens the share sheet (was a direct copy).
            , onClick (InviteShareOpen (App.homeInviteChannel model))
            ]
            [ text "Invite friends" ]
        ]


roomAccess : List Home.Room -> List Home.Room -> Html Msg
roomAccess joined dms =
    if List.isEmpty joined && List.isEmpty dms then
        text ""

    else
        section [ class "onyx-home-rooms", attribute "aria-label" "Room access" ]
            [ h2 [ class "onyx-home-label" ] [ text "Your rooms" ]
            , roomGroup "Joined rooms" "#" joined
            , roomGroup "Direct messages" "@" dms
            ]


roomGroup : String -> String -> List Home.Room -> Html Msg
roomGroup heading mark rows =
    if List.isEmpty rows then
        text ""

    else
        div [ class "onyx-home-room-group" ]
            [ h3 [] [ text heading ]
            , div [ class "onyx-home-room-grid" ] (List.map (roomCard mark) rows)
            ]


roomCard : String -> Home.Room -> Html Msg
roomCard mark row =
    button
        [ type_ "button"
        , class "onyx-home-room"
        , classList [ ( "is-unread", row.unread > 0 ), ( "is-mention", row.highlights > 0 ) ]
        , attribute "aria-label" (Home.roomCardAria row)
        , onClick (ChannelSelect row.name)
        ]
        [ span [ class "onyx-home-room-mark", attribute "aria-hidden" "true" ] [ text mark ]
        , span [ class "onyx-home-room-name" ] [ text (Home.visibleName row.kind row.name) ]
        , if row.highlights > 0 then
            span [ class "onyx-home-room-mention", attribute "aria-hidden" "true" ] [ text ("@" ++ String.fromInt row.highlights) ]

          else
            text ""
        , if row.unread > 0 then
            span [ class "onyx-home-unread", attribute "aria-hidden" "true" ] [ text (String.fromInt row.unread) ]

          else
            span [ class "onyx-home-room-verb", attribute "aria-hidden" "true" ] [ text "Open" ]
        ]


{-| One quiet, dismissible tip (never a modal slideshow). -}
coach : Model -> Home.CoachTip -> Html Msg
coach model surface =
    case Home.coachTip { guest = isGuest model, dismissed = model.homeCoachDismissed, surface = surface } of
        Nothing ->
            text ""

        Just tip ->
            let
                copy =
                    Home.coachText tip
            in
            div
                [ class "onyx-coach"
                , attribute "role" "note"
                , attribute "aria-label" "A quick start tip"
                , attribute "data-testid" "first-hour-coach"
                , attribute "data-tip" copy.id
                ]
                [ span [ class "onyx-coach-eyebrow" ] [ text "Quick start" ]
                , p [ class "onyx-coach-text", id "first-hour-coach-copy" ] [ text copy.text ]
                , button
                    [ type_ "button"
                    , class "onyx-coach-dismiss"
                    , attribute "aria-label" "Dismiss quick start tip"
                    , attribute "aria-describedby" "first-hour-coach-copy"
                    , attribute "data-testid" "first-hour-coach-dismiss"
                    , onClick HomeCoachDismiss
                    ]
                    [ span [ class "onyx-shi", attribute "data-icon" "close", attribute "aria-hidden" "true" ] [] ]
                ]


{-| Empty-feed intro inside a joined conversation with no rows. -}
emptyRoomIntro : Model -> Channel -> Html Msg
emptyRoomIntro model channel =
    let
        kind =
            if App.isChannelName model channel.name then
                Home.RoomKind

            else
                Home.DmKind

        firstHour =
            kind == Home.RoomKind && isGuest model && not model.homeCoachDismissed

        intro =
            Home.emptyRoomIntro { kind = kind, target = channel.name, firstHour = firstHour }
    in
    div []
        [ div [ class "onyx-feed-empty", attribute "role" "status", attribute "data-testid" "feed-empty" ]
            [ p [ class "onyx-feed-empty-title" ] [ text intro.title ]
            , p [ class "onyx-feed-empty-body" ] [ text intro.body ]
            ]
        , if kind == Home.RoomKind then
            coach model Home.RoomSayHi

          else
            text ""
        ]
