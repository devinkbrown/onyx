module HomeTest exposing (suite)

{-| Vectors for the v3/home slice: the pure `Home` derivations
(mirroring `lib/catchup/markCaughtUp.test.ts`, `homeInbox`,
`HomeBriefingView.test.tsx` copy helpers, `firstHour` tips and the
`MessageView` empty intro), the `HomeMarkAllCaughtUp` /
`HomeCoachDismiss` / `HomeInviteCopy` folds through `App.update`, and
the rendered Home / empty-room surfaces.
-}

import App exposing (..)
import Dict
import Expect
import Home exposing (Kind(..))
import Html
import Html.Attributes
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


room : String -> Kind -> Int -> Int -> Home.Room
room name kind unread highlights =
    { name = name, kind = kind, unread = unread, highlights = highlights, lastActivity = 0, hasBoundary = False }


chan : String -> Int -> Int -> Channel
chan name unread highlights =
    { name = name
    , topic = ""
    , members = Dict.empty
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = unread
    , highlights = highlights
    , createdAt = Nothing
    }


withChannels : List Channel -> Model -> Model
withChannels list model =
    { model | channels = Dict.fromList (List.map (\c -> ( String.toLower c.name, c )) list) }


busy : Model
busy =
    withChannels
        [ chan "#news" 4 0
        , chan "#lounge" 2 1
        , chan "#quiet" 0 0
        , chan "mira" 3 0
        ]
        { blank | ourNick = "kai", nowMs = 1000 }


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


home : Model -> Query.Single Msg
home model =
    query model |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "home") ]


suite : Test
suite =
    describe "Home"
        [ describe "planCatchUpAll"
            [ test "empty plan when nothing is unread" <|
                \_ ->
                    Home.planCatchUpAll [ room "#a" RoomKind 0 0 ]
                        |> Expect.equal { targets = [], rooms = 0, unread = 0, mentions = 0 }
            , test "includes only rooms with unread or highlights" <|
                \_ ->
                    Home.planCatchUpAll [ room "#a" RoomKind 0 0, room "#b" RoomKind 2 0, room "#c" RoomKind 0 1 ]
                        |> .targets
                        |> List.map .target
                        |> List.sort
                        |> Expect.equal [ "#b", "#c" ]
            , test "sums unread and mentions across channels and DMs" <|
                \_ ->
                    let
                        plan =
                            Home.planCatchUpAll [ room "#a" RoomKind 3 1, room "bob" DmKind 2 2 ]
                    in
                    Expect.equal ( plan.rooms, plan.unread, plan.mentions ) ( 2, 5, 3 )
            , test "orders mentions first, then most unread, then name A→Z" <|
                \_ ->
                    Home.planCatchUpAll
                        [ room "#zeta" RoomKind 1 0
                        , room "#alpha" RoomKind 1 0
                        , room "#big" RoomKind 9 0
                        , room "#ping" RoomKind 1 2
                        , room "Bob" DmKind 1 0
                        ]
                        |> .targets
                        |> List.map .target
                        |> Expect.equal [ "#ping", "#big", "#alpha", "#zeta", "Bob" ]
            , test "is deterministic regardless of input order" <|
                \_ ->
                    let
                        xs =
                            [ room "#a" RoomKind 1 0, room "#b" RoomKind 2 1, room "c" DmKind 2 0 ]
                    in
                    Expect.equal (Home.planCatchUpAll xs) (Home.planCatchUpAll (List.reverse xs))
            , test "clamps negative counters to zero" <|
                \_ ->
                    let
                        plan =
                            Home.planCatchUpAll [ room "#a" RoomKind -3 1 ]
                    in
                    Expect.equal ( plan.unread, plan.mentions ) ( 0, 1 )
            , test "tags channel vs DM kind on each target" <|
                \_ ->
                    Home.planCatchUpAll [ room "#a" RoomKind 1 0, room "bob" DmKind 2 0 ]
                        |> .targets
                        |> List.map .kind
                        |> Expect.equal [ DmKind, RoomKind ]
            ]
        , describe "caughtUpAnnounce"
            [ test "already caught up" <|
                \_ -> Expect.equal "Already all caught up." (Home.caughtUpAnnounce (Home.planCatchUpAll []))
            , test "pluralises rooms and omits mentions when none" <|
                \_ ->
                    Home.caughtUpAnnounce (Home.planCatchUpAll [ room "#a" RoomKind 1 0, room "#b" RoomKind 1 0 ])
                        |> Expect.equal "Marked 2 rooms as caught up."
            , test "includes cleared mentions" <|
                \_ ->
                    Home.caughtUpAnnounce (Home.planCatchUpAll [ room "#a" RoomKind 1 1 ])
                        |> Expect.equal "Marked 1 room as caught up, clearing 1 mention."
            , test "mark-all label names unread and rooms" <|
                \_ ->
                    Home.markCaughtUpLabel (Home.planCatchUpAll [ room "#a" RoomKind 3 0, room "#b" RoomKind 5 0 ])
                        |> Expect.equal "Mark all caught up — clears 8 unread across 2 rooms"
            , test "signal strip phrase" <|
                \_ ->
                    Home.signalMessage (Home.planCatchUpAll [ room "#a" RoomKind 3 0, room "#b" RoomKind 5 0, room "c" DmKind 1 0 ])
                        |> Expect.equal "3 conversations need you"
            ]
        , describe "composeInbox"
            [ test "a mentioned room is listed under mentions only" <|
                \_ ->
                    let
                        inbox =
                            Home.composeInbox [ room "#a" RoomKind 3 1, room "#b" RoomKind 2 0 ]
                    in
                    Expect.equal ( List.map .name inbox.mentions, List.map .name inbox.missed ) ( [ "#a" ], [ "#b" ] )
            , test "orders by recency then name" <|
                \_ ->
                    Home.composeInbox
                        [ { name = "#old", kind = RoomKind, unread = 1, highlights = 0, lastActivity = 10, hasBoundary = False }
                        , { name = "#new", kind = RoomKind, unread = 1, highlights = 0, lastActivity = 20, hasBoundary = False }
                        , { name = "#b", kind = RoomKind, unread = 1, highlights = 0, lastActivity = 10, hasBoundary = False }
                        ]
                        |> .missed
                        |> List.map .name
                        |> Expect.equal [ "#new", "#b", "#old" ]
            , test "empty when nothing is unread" <|
                \_ -> Expect.equal True (Home.composeInbox [ room "#a" RoomKind 0 0 ]).empty
            ]
        , describe "copy helpers"
            [ test "inbox aria with boundary and mentions" <|
                \_ ->
                    Home.inboxAria { name = "#mentions", kind = RoomKind, unread = 3, highlights = 2, lastActivity = 0, hasBoundary = True }
                        |> Expect.equal "Open #mentions at your first unread message, 3 unread, 2 mentions"
            , test "inbox aria plain" <|
                \_ -> Expect.equal "Open #news, 4 unread" (Home.inboxAria (room "#news" RoomKind 4 0))
            , test "visible name drops a room sigil, keeps a DM nick" <|
                \_ -> Expect.equal ( "lounge", "mira" ) ( Home.visibleName RoomKind "#lounge", Home.visibleName DmKind "mira" )
            , test "room card aria names kind and counts" <|
                \_ ->
                    Expect.equal [ "Open room #quiet", "Open room #news, 4 unread, 1 mention", "Open conversation with mira, 3 unread" ]
                        [ Home.roomCardAria (room "#quiet" RoomKind 0 0)
                        , Home.roomCardAria (room "#news" RoomKind 4 1)
                        , Home.roomCardAria (room "mira" DmKind 3 0)
                        ]
            , test "initials" <|
                \_ -> Expect.equal [ "L", "M", "?" ] [ Home.initials "#lounge", Home.initials "@mira", Home.initials "#" ]
            , test "title flips on an empty inbox" <|
                \_ ->
                    Expect.equal ( "The room is quiet.", "What did you miss?" )
                        ( Home.title (Home.composeInbox []), Home.title (Home.composeInbox [ room "#a" RoomKind 1 0 ]) )
            , test "greeting carries the nick" <|
                \_ -> Expect.equal ( "Welcome to Onyx, kai", "Welcome to Onyx" ) ( Home.welcomeLine " kai ", Home.welcomeLine "" )
            , test "quiet description" <|
                \_ ->
                    Expect.equal
                        [ "Nothing needs your attention right now."
                        , "Find a room to join, or start one for your people."
                        , "Reconnect to see live rooms, or use what is saved on this device."
                        ]
                        [ Home.quietDescription { caughtUp = True, connected = True }
                        , Home.quietDescription { caughtUp = False, connected = True }
                        , Home.quietDescription { caughtUp = False, connected = False }
                        ]
            , test "first-room prompt needs connected, no rooms, empty directory" <|
                \_ ->
                    Expect.equal [ True, False, False, False ]
                        [ Home.showFirstRoomPrompt { connected = True, hasRooms = False, directoryCount = 0 }
                        , Home.showFirstRoomPrompt { connected = False, hasRooms = False, directoryCount = 0 }
                        , Home.showFirstRoomPrompt { connected = True, hasRooms = True, directoryCount = 0 }
                        , Home.showFirstRoomPrompt { connected = True, hasRooms = False, directoryCount = 3 }
                        ]
            , test "invite friends when missing rooms or DMs" <|
                \_ ->
                    Expect.equal [ True, True, False, False ]
                        [ Home.showInviteFriends { connected = True, roomCount = 0, dmCount = 2 }
                        , Home.showInviteFriends { connected = True, roomCount = 2, dmCount = 0 }
                        , Home.showInviteFriends { connected = True, roomCount = 1, dmCount = 1 }
                        , Home.showInviteFriends { connected = False, roomCount = 0, dmCount = 0 }
                        ]
            , test "coach tip only for an undismissed guest" <|
                \_ ->
                    Expect.equal [ Just Home.HomeNext, Nothing, Nothing ]
                        [ Home.coachTip { guest = True, dismissed = False, surface = Home.HomeNext }
                        , Home.coachTip { guest = True, dismissed = True, surface = Home.HomeNext }
                        , Home.coachTip { guest = False, dismissed = False, surface = Home.HomeNext }
                        ]
            , test "coach copy" <|
                \_ ->
                    Expect.equal ( "home-next", "Say hi — type below and press Enter." )
                        ( (Home.coachText Home.HomeNext).id, (Home.coachText Home.RoomSayHi).text )
            , test "empty intro: first hour says hi, otherwise still waters, DMs private" <|
                \_ ->
                    Expect.equal [ "Say hi", "Still waters here", "A private conversation" ]
                        [ (Home.emptyRoomIntro { kind = RoomKind, target = "#a", firstHour = True }).title
                        , (Home.emptyRoomIntro { kind = RoomKind, target = "#a", firstHour = False }).title
                        , (Home.emptyRoomIntro { kind = DmKind, target = "bob", firstHour = True }).title
                        ]
            , test "still-waters body names the room" <|
                \_ ->
                    (Home.emptyRoomIntro { kind = RoomKind, target = "#a", firstHour = False }).body
                        |> Expect.equal "Say the first thing in #a."
            ]
        , describe "update folds"
            [ test "mark all caught up clears every unread room and DM" <|
                \_ ->
                    let
                        ( next, _ ) =
                            update HomeMarkAllCaughtUp busy
                    in
                    next.channels
                        |> Dict.values
                        |> List.map (\c -> c.unread + c.highlights)
                        |> List.sum
                        |> Expect.equal 0
            , test "mark all caught up announces the plan" <|
                \_ ->
                    (Tuple.first (update HomeMarkAllCaughtUp busy)).homeCaughtUpAnnounce
                        |> Expect.equal "Marked 3 rooms as caught up, clearing 1 mention."
            , test "mark all syncs MARKREAD per target when negotiated" <|
                \_ ->
                    update HomeMarkAllCaughtUp { busy | caps = [ "draft/read-marker" ] }
                        |> Tuple.second
                        |> List.length
                        |> Expect.equal 3
            , test "nothing unread is a no-op" <|
                \_ ->
                    let
                        quiet =
                            withChannels [ chan "#quiet" 0 0 ] blank
                    in
                    Expect.equal ( quiet, [] ) (update HomeMarkAllCaughtUp quiet)
            , test "coach dismissal is session state" <|
                \_ -> Expect.equal True (Tuple.first (update HomeCoachDismiss blank)).homeCoachDismissed
            , test "invite friends copies a join link for the first room" <|
                \_ ->
                    case Tuple.second (update HomeInviteCopy busy) of
                        [ ClipboardCopy { text, tag } ] ->
                            Expect.equal ( tag, String.contains "join=%23lounge" text ) ( "home-invite", True )

                        other ->
                            Expect.fail (Debug.toString other)
            , test "invite copy receipt lands as a toast" <|
                \_ ->
                    update (ClipboardResult { tag = "home-invite", ok = True }) blank
                        |> Tuple.first
                        |> .toasts
                        |> List.map .title
                        |> Expect.equal [ "Invite link copied" ]
            ]
        , describe "view"
            [ test "blank Home greets and offers browse / start" <|
                \_ ->
                    home blank
                        |> Expect.all
                            [ Query.has [ Selector.text "Welcome to Onyx" ]
                            , Query.has [ Selector.text "The room is quiet." ]
                            , Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Browse rooms" ] ]
                                >> Event.simulate Event.click
                                >> Event.expect BrowserOpen
                            , Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Start a room" ] ]
                                >> Event.simulate Event.click
                                >> Event.expect CreateRoomOpen
                            , Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "home-invite-friends") ]
                                >> Event.simulate Event.click
                                >> Event.expect (InviteShareOpen "")
                            ]
            , test "busy Home lists mentions and unread, opening via ChannelSelect" <|
                \_ ->
                    home busy
                        |> Expect.all
                            [ Query.has [ Selector.text "What did you miss?" ]
                            , Query.has [ Selector.text "Welcome to Onyx, kai" ]
                            , Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Open #news, 4 unread") ]
                                >> Event.simulate Event.click
                                >> Event.expect (ChannelSelect "#news")
                            , Query.has [ Selector.attribute (Html.Attributes.attribute "aria-label" "Open #lounge, 2 unread, 1 mention") ]
                            , Query.has [ Selector.attribute (Html.Attributes.attribute "aria-label" "Open mira, 3 unread") ]
                            , Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "home-mark-caught-up") ]
                                >> Event.simulate Event.click
                                >> Event.expect HomeMarkAllCaughtUp
                            ]
            , test "joined room cards include quiet rooms" <|
                \_ ->
                    home busy
                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Open room #quiet") ]
                        |> Event.simulate Event.click
                        |> Event.expect (ChannelSelect "#quiet")
            , test "queued sends surface destination only" <|
                \_ ->
                    home { blank | outbox = [ { id = "o1", target = "#private-room", text = "secret body", queuedAt = 500 } ], nowMs = 1000 }
                        |> Expect.all
                            [ Query.has [ Selector.text "#private-room" ]
                            , Query.has [ Selector.text "Awaiting send" ]
                            , Query.hasNot [ Selector.text "secret body" ]
                            ]
            , test "guest sees the coach and can dismiss it" <|
                \_ ->
                    home blank
                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "first-hour-coach-dismiss") ]
                        |> Event.simulate Event.click
                        |> Event.expect HomeCoachDismiss
            , test "signed-in users get no coach" <|
                \_ ->
                    home { blank | accountName = Just "kai" }
                        |> Query.hasNot [ Selector.attribute (Html.Attributes.attribute "data-testid" "first-hour-coach") ]
            , test "empty joined room says hi to a guest" <|
                \_ ->
                    query (withChannels [ chan "#fresh" 0 0 ] { blank | activeChannel = Just "#fresh" })
                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "feed-empty") ]
                        |> Query.has [ Selector.text "Say hi" ]
            , test "empty joined room reads still waters once signed in" <|
                \_ ->
                    query (withChannels [ chan "#fresh" 0 0 ] { blank | activeChannel = Just "#fresh", accountName = Just "kai" })
                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "feed-empty") ]
                        |> Query.has [ Selector.text "Say the first thing in #fresh." ]
            ]
        ]
