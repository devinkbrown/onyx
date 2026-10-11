module SidebarTest exposing (suite)

{-| Sectioned sidebar + New conversation vectors, mirroring
`src/shell/ChannelSidebar.test.tsx`, `src/shell/NewMessageSheet.test.tsx`,
`lib/channel/sidebarFilter.test.ts`, `lib/channel/messagesInbox.test.ts`
and the `dmListPreviewText` vectors: pure derivation through `Sidebar`,
behavior through `App.update`, rendering through `View.view`.
-}

import App exposing (..)
import Dict
import DmCipher
import Expect
import Html
import Html.Attributes
import Json.Encode
import Set
import Sidebar
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


rail : Model -> Query.Single Msg
rail model =
    query model |> Query.find [ Selector.class "onyx-rail" ]


row : Int -> String -> ChatMessage
row at body =
    { id = at
    , from = "bob"
    , body = body
    , whisper = False
    , audience = Nothing
    , highlight = False
    , plaintext = Nothing
    , outboxId = Nothing
    , pending = False
    , at = at
    , msgid = Nothing
    , reactions = []
    , edited = False
    , deleted = False
    , redacted = False
    , topic = ""
    , msgType = "msg"
    , replyTo = Nothing
    }


conv : String -> List ChatMessage -> Channel
conv name messages =
    { name = name
    , topic = ""
    , members = Dict.empty
    , modes = ""
    , messages = messages
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


isChan : String -> Bool
isChan name =
    String.startsWith "#" name || String.startsWith "&" name


input : { isChannel : String -> Bool, starred : Set.Set String, query : String, unreadOnly : Bool }
input =
    { isChannel = isChan, starred = Set.empty, query = "", unreadOnly = False }


names : List Channel -> List String
names =
    List.map .name


{-| Live, owned (endpoint + nick) model with two rooms. -}
owned : Model
owned =
    { blank | endpoint = Just "wss://onyx.example/ws" }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":me!u@h JOIN #b")
        |> step (ChannelSelect "#c")


suite : Test
suite =
    describe "Sidebar"
        [ describe "filter"
            [ test "empty query matches everything; match is case-insensitive substring" <|
                \_ ->
                    Expect.equal
                        [ True, True, False, True ]
                        [ Sidebar.matchesQuery "  " "#Any"
                        , Sidebar.matchesQuery "GEN" "#general"
                        , Sidebar.matchesQuery "zz" "#general"
                        , Sidebar.matchesQuery " ral " "#general"
                        ]
            , test "query filters rooms and DMs; unread-only keeps attention rows" <|
                \_ ->
                    let
                        loud =
                            conv "#loud" []
                                |> (\c -> { c | unread = 2 })

                        pinged =
                            conv "alice" []
                                |> (\c -> { c | highlights = 1 })

                        all =
                            [ conv "#general" [], loud, pinged, conv "bob" [] ]

                        byQuery =
                            Sidebar.sections { input | query = "o" } all

                        byUnread =
                            Sidebar.sections { input | unreadOnly = True } all
                    in
                    Expect.equal
                        ( ( names byQuery.rooms, names byQuery.dms ), ( names byUnread.rooms, names byUnread.dms ) )
                        ( ( [ "#loud" ], [ "bob" ] ), ( [ "#loud" ], [ "alice" ] ) )
            , test "a filter hiding everything reports empty with oracle copy" <|
                \_ ->
                    let
                        s =
                            Sidebar.sections { input | query = "nope" } [ conv "#general" [], conv "bob" [] ]
                    in
                    Expect.equal
                        ( s.filterEmpty, Sidebar.filterEmptyCopy " nope " False, Sidebar.filterEmptyCopy "" True )
                        ( True, "No rooms or messages match “nope”.", "Nothing unread right now." )
            , test "an inactive filter is never empty" <|
                \_ ->
                    Expect.equal (Sidebar.sections input []).filterEmpty False
            ]
        , describe "sections"
            [ test "starred rooms move to Favorites (lowered or raw key), both alpha" <|
                \_ ->
                    let
                        s =
                            Sidebar.sections
                                { input | starred = Set.fromList [ "#zeta", "#Beta" ] }
                                [ conv "#Zeta" [], conv "#alpha" [], conv "#Beta" [], conv "#gamma" [] ]
                    in
                    Expect.equal ( names s.favorites, names s.rooms, s.roomsJoined )
                        ( [ "#Beta", "#Zeta" ], [ "#alpha", "#gamma" ], 4 )
            , test "DMs sort by newest activity, nick alpha only on ties" <|
                \_ ->
                    let
                        seen =
                            conv "dora" [] |> (\c -> { c | lastSeen = Just 5000 })

                        s =
                            Sidebar.sections input
                                [ conv "carol" [ row 1000 "old" ]
                                , conv "Bob" []
                                , conv "alice" []
                                , conv "erin" [ row 9000 "new", row 2000 "older" ]
                                , seen
                                ]
                    in
                    Expect.equal (names s.dms) [ "erin", "dora", "carol", "alice", "Bob" ]
            ]
        , describe "badges and labels"
            [ test "mentions win, unread caps at 99+, quiet rows carry none" <|
                \_ ->
                    let
                        c =
                            conv "#c" []
                    in
                    Expect.equal
                        [ Sidebar.badgeText { c | unread = 4, highlights = 2 }
                        , Sidebar.badgeText { c | unread = 120 }
                        , Sidebar.badgeText { c | unread = 7 }
                        , Sidebar.badgeText c
                        ]
                        [ Just "2", Just "99+", Just "7", Nothing ]
            , test "accessible names mirror the oracle suffixes" <|
                \_ ->
                    let
                        c =
                            conv "#c" []

                        d =
                            conv "bob" []
                    in
                    Expect.equal
                        [ Sidebar.roomAriaLabel { c | unread = 3, highlights = 1 } True
                        , Sidebar.roomAriaLabel c False
                        , Sidebar.dmAriaLabel { d | highlights = 2 } { preview = Just "hey", keyChanged = True, offline = 2 }
                        ]
                        [ "#c, 3 unread, 1 mention, favorite"
                        , "#c"
                        , "DM with bob, hey, device key changed, 2 mentions, 2 offline"
                        ]
            , test "offline stamp is calm and empty at zero" <|
                \_ ->
                    Expect.equal (List.map Sidebar.offlineStamp [ 0, 1, 3 ]) [ "", "1 offline", "3 offline" ]
            , test "activity stamps: now · m · h · d, empty when unknown" <|
                \_ ->
                    let
                        now =
                            1782820800000

                        ago s =
                            Sidebar.activityStamp now (round (now - s * 1000))
                    in
                    Expect.equal
                        [ ago 5, ago 240, ago 7200, ago (3 * 86400), Sidebar.activityStamp now 0 ]
                        [ "now", "4m", "2h", "3d", "" ]
            ]
        , describe "DM preview"
            [ test "newest readable row previews; system, deleted and pending rows skip" <|
                \_ ->
                    let
                        joinRow =
                            row 5 "" |> (\r -> { r | msgType = "join" })

                        gone =
                            row 4 "secret" |> (\r -> { r | deleted = True })

                        pending =
                            row 3 "sending" |> (\r -> { r | pending = True })
                    in
                    Expect.equal
                        (Sidebar.dmPreview (conv "bob" [ joinRow, gone, pending, row 2 "  hello\n  there ", row 1 "first" ]))
                        (Just "hello there")
            , test "sealed bodies preview as Encrypted message, never the envelope" <|
                \_ ->
                    Expect.equal
                        [ Sidebar.dmPreviewText (row 1 DmCipher.lockedPlaceholder)
                        , Sidebar.dmPreviewText (row 1 "ONYXDM1 c2VhbGVk")
                        , Sidebar.dmPreviewText (row 1 "plain")
                        ]
                        [ Just "Encrypted message", Just "Encrypted message", Just "plain" ]
            , test "opened plaintext previews; blank text falls back; long text clips at 96" <|
                \_ ->
                    let
                        long =
                            String.repeat 100 "x"
                    in
                    Expect.equal
                        [ Sidebar.dmPreviewText (row 1 "ONYXDM1 abc" |> (\r -> { r | plaintext = Just "opened" }))
                        , Sidebar.dmPreviewText (row 1 "   ")
                        , Sidebar.dmPreviewText (row 1 " " |> (\r -> { r | msgType = "action" }))
                        , Sidebar.dmPreviewText (row 1 long)
                        ]
                        [ Just "opened", Just "Message", Just "Action message", Just (String.repeat 95 "x" ++ "…") ]
            , test "no previewable row yields no preview" <|
                \_ ->
                    Expect.equal (Sidebar.dmPreview (conv "bob" [])) Nothing
            ]
        , describe "star toggle"
            [ test "stars then unstars through the shared folds and persists" <|
                \_ ->
                    let
                        ( starred, out ) =
                            update (SidebarStarToggle "#B") owned

                        ( unstarred, out2 ) =
                            update (SidebarStarToggle "#B") starred
                    in
                    Expect.equal
                        ( ( Set.toList starred.starredChannels, out ), ( Set.toList unstarred.starredChannels, out2 ) )
                        ( ( [ "#b" ], [ StarredSave { channels = [ "#b" ] } ] ), ( [], [ StarredSave { channels = [] } ] ) )
            , test "ownerless sessions never write" <|
                \_ ->
                    let
                        ownerless =
                            { owned | endpoint = Nothing }
                    in
                    Expect.equal (update (SidebarStarToggle "#b") ownerless) ( ownerless, [] )
            , test "the row star renders only with an owner, with oracle names" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            rail owned
                                |> Query.findAll [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-channel-star") ]
                                |> Query.count (Expect.equal 2)
                        , \_ ->
                            rail { owned | endpoint = Nothing }
                                |> Query.findAll [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-channel-star") ]
                                |> Query.count (Expect.equal 0)
                        , \_ ->
                            rail owned
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Add #b to favorites") ]
                                |> Event.simulate Event.click
                                |> Event.expect (SidebarStarToggle "#b")
                        ]
                        ()
            , test "a starred room renders under Favorites with the remove label" <|
                \_ ->
                    let
                        starred =
                            step (SidebarStarToggle "#b") owned
                    in
                    Expect.all
                        [ \_ ->
                            rail starred
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-favorites") ]
                                |> Query.has [ Selector.text "Favorites", Selector.text "#b" ]
                        , \_ ->
                            rail starred
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-channels") ]
                                |> Query.hasNot [ Selector.text "#b" ]
                        , \_ ->
                            rail starred
                                |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-label" "Remove #b from favorites") ]
                        , \_ ->
                            rail owned
                                |> Query.hasNot [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-favorites") ]
                        ]
                        ()
            ]
        , describe "rail rendering"
            [ test "DM rows carry the latest preview line" <|
                \_ ->
                    let
                        dm =
                            owned
                                |> (\m -> feed m ":bob!u@h PRIVMSG me :see you at noon")
                    in
                    rail dm
                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-dm-preview") ]
                        |> Query.has [ Selector.text "see you at noon" ]
            , test "channel colour labels render when set" <|
                \_ ->
                    let
                        colored =
                            { owned | channelColors = Dict.fromList [ ( "#b", "#ff8800" ) ] }
                    in
                    rail colored
                        |> Query.findAll [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-channel-color") ]
                        |> Query.count (Expect.equal 1)
            , test "the filter narrows rows and shows the empty copy" <|
                \_ ->
                    let
                        filtered =
                            step (SidebarFilterInput "zzz") owned
                    in
                    Expect.all
                        [ \_ ->
                            rail filtered
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-filter-empty") ]
                                |> Query.has [ Selector.text "No rooms or messages match “zzz”." ]
                        , \_ ->
                            rail (step (SidebarFilterInput "b") owned)
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-channels") ]
                                |> Query.hasNot [ Selector.text "#c" ]
                        , \_ ->
                            rail filtered
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-filter-clear") ]
                                |> Event.simulate Event.click
                                |> Event.expect SidebarFilterClear
                        , \_ ->
                            rail owned
                                |> Query.hasNot [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-filter-clear") ]
                        ]
                        ()
            , test "unread-only toggles, Escape and Clear reset both axes" <|
                \_ ->
                    let
                        on =
                            owned |> step (SidebarFilterInput "x") |> step SidebarUnreadOnlyToggle

                        cleared =
                            step SidebarFilterClear on
                    in
                    Expect.all
                        [ \_ -> Expect.equal ( on.sidebarFilter, on.sidebarUnreadOnly ) ( "x", True )
                        , \_ -> Expect.equal ( cleared.sidebarFilter, cleared.sidebarUnreadOnly ) ( "", False )
                        , \_ ->
                            rail on
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-filter") ]
                                |> Event.simulate (Event.custom "keydown" (Json.Encode.object [ ( "key", Json.Encode.string "Escape" ) ]))
                                |> Event.expect SidebarFilterClear
                        , \_ ->
                            rail on
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-unread-only") ]
                                |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-pressed" "true") ]
                        ]
                        ()
            , test "Browse rooms, Start a room and New conversation stay wired" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            rail owned
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-browse-rooms") ]
                                |> Event.simulate Event.click
                                |> Event.expect BrowserOpen
                        , \_ ->
                            rail owned
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "sidebar-start-room") ]
                                |> Event.simulate Event.click
                                |> Event.expect CreateRoomOpen
                        , \_ ->
                            rail owned
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "New conversation") ]
                                |> Event.simulate Event.click
                                |> Event.expect NewMessageOpen
                        ]
                        ()
            , test "no rooms shows the zero-state copy; no DMs shows the messages empty copy" <|
                \_ ->
                    -- v3/rx-shell: the empty collections say what they are
                    -- for and offer the next step.
                    rail blank
                        |> Query.has
                            [ Selector.text "No rooms yet. Browse rooms to join one."
                            , Selector.text "No messages yet. Start one with New."
                            ]
            ]
        , describe "New conversation sheet"
            [ test "starts a conversation only for a valid (trimmed) recipient" <|
                \_ ->
                    let
                        started =
                            owned
                                |> step NewMessageOpen
                                |> step (NewMessageInput "  River_7  ")
                                |> step NewMessageSubmit
                    in
                    Expect.equal
                        ( started.activeChannel, started.newMessageOpen, Dict.member "river_7" started.channels )
                        ( Just "River_7", False, True )
            , test "accepts shared-contract recipients" <|
                \_ ->
                    Expect.equal
                        (List.map
                            (\name ->
                                (owned |> step NewMessageOpen |> step (NewMessageInput name) |> step NewMessageSubmit).activeChannel
                            )
                            [ "_alice", "[alice", "a" ++ String.repeat 32 "b", String.repeat 64 "a" ]
                        )
                        (List.map Just [ "_alice", "[alice", "a" ++ String.repeat 32 "b", String.repeat 64 "a" ])
            , test "invalid recipients show an alert and never start" <|
                \_ ->
                    Expect.all
                        (List.concatMap
                            (\name ->
                                let
                                    typed =
                                        owned |> step NewMessageOpen |> step (NewMessageInput name)
                                in
                                [ \_ -> Expect.equal (step NewMessageSubmit typed) typed
                                , \_ ->
                                    query typed
                                        |> Query.find [ Selector.attribute (Html.Attributes.attribute "role" "alert") ]
                                        |> Query.has [ Selector.containing [ Selector.text "Name" ] ]
                                ]
                            )
                            [ "33alice", "alice smith" ]
                        )
                        ()
            , test "explains the offline state and disables the action" <|
                \_ ->
                    let
                        offline =
                            { owned | connection = Offline, autoReconnect = False }
                                |> step NewMessageOpen
                                |> step (NewMessageInput "River_7")
                    in
                    Expect.all
                        [ \_ ->
                            query offline
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "role" "status"), Selector.class "onyx-newmsg-state" ]
                                |> Query.has [ Selector.containing [ Selector.text "You’re offline. Reconnect to start a conversation." ] ]
                        , \_ ->
                            query offline
                                |> Query.find [ Selector.class "onyx-newmsg-primary" ]
                                |> Query.has [ Selector.text "Waiting for connection", Selector.disabled True ]
                        , \_ -> Expect.equal (step NewMessageSubmit offline) offline
                        ]
                        ()
            , test "announces connecting while registering" <|
                \_ ->
                    query ({ owned | connection = Registering } |> step NewMessageOpen)
                        |> Query.find [ Selector.class "onyx-newmsg-state" ]
                        |> Query.has [ Selector.containing [ Selector.text "Connecting to Onyx" ] ]
            , test "gives a clear empty state and accessible input guidance" <|
                \_ ->
                    let
                        q =
                            query (step NewMessageOpen owned)
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.text "No person selected yet." ] q
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "new-message-recipient" ]
                                |> Query.has [ Selector.attribute (Html.Attributes.attribute "aria-describedby" "new-message-recipient-hint new-message-recipient-error") ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "onyx-newmsg-primary" ]
                                |> Query.has [ Selector.text "Start conversation", Selector.disabled True ]
                        ]
                        ()
            , test "Escape, backdrop, close and Cancel all dismiss" <|
                \_ ->
                    let
                        q =
                            query (step NewMessageOpen owned)
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "role" "dialog"), Selector.class "onyx-newmsg-sheet" ]
                                |> Event.simulate (Event.custom "keydown" (Json.Encode.object [ ( "key", Json.Encode.string "Escape" ) ]))
                                |> Event.expect NewMessageClose
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "onyx-newmsg-backdrop" ]
                                |> Event.simulate Event.click
                                |> Event.expect NewMessageClose
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Html.Attributes.attribute "aria-label" "Close new conversation") ]
                                |> Event.simulate Event.click
                                |> Event.expect NewMessageClose
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "onyx-newmsg-secondary" ]
                                |> Event.simulate Event.click
                                |> Event.expect NewMessageClose
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "onyx-newmsg-sheet" ]
                                |> Query.find [ Selector.tag "form" ]
                                |> Event.simulate (Event.custom "submit" (Json.Encode.object []))
                                |> Event.expect NewMessageSubmit
                        , \_ ->
                            Expect.equal
                                (step NewMessageClose (owned |> step NewMessageOpen |> step (NewMessageInput "x"))
                                    |> (\m -> ( m.newMessageOpen, m.newMessageRecipient ))
                                )
                                ( False, "" )
                        , \_ -> query owned |> Query.hasNot [ Selector.class "onyx-newmsg-sheet" ]
                        ]
                        ()
            ]
        ]
