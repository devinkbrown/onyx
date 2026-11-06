module InboxOverhaulTest exposing (suite)

{-| UI overhaul slice 2: the inbox audit (C1–C5, H1–H5, M1–M9), the wire
gates found on the live server (METADATA, EVENT, CHATHISTORY, server
NOTICEs), the room header, and the first-load invite query. Each test
names the audit item it pins.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Invite
import Nav
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Url
import View
import View.Inbox


render : Model -> Query.Single Msg
render model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


feed : Model -> String -> ( Model, List Outbound )
feed model line =
    update (WsLineReceived line) model


feedAll : Model -> List String -> Model
feedAll model lines =
    List.foldl (\line acc -> Tuple.first (feed acc line)) model lines


joined : String -> Model
joined room =
    feedAll { blank | ourNick = "me" } [ ":me!u@h JOIN " ++ room ]


{-| A live room the person is NOT looking at (Home is on screen). -}
background : Model
background =
    joined "#c"


stamp : String -> Maybe String -> Int -> RuntimeOwnerStamp
stamp ref account generation =
    { ownerRef = ref, networkId = "net", accountId = account, accountGeneration = 1, connectionGeneration = generation }


sends : List Outbound -> List String
sends outs =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    Just line

                _ ->
                    Nothing
        )
        outs


texts : Model -> List String
texts model =
    List.map .text model.notifications


unreadIds : Model -> List String
unreadIds model =
    List.filter (\n -> not (Set.member n.id model.readNotificationIds)) model.notifications |> List.map .id


envelopeBody : String
envelopeBody =
    "ONYXDM1 AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"


suite : Test
suite =
    describe "UI overhaul slice 2"
        [ critical
        , high
        , medium
        , wireGates
        , view
        , invite
        ]


critical : Test
critical =
    describe "inbox critical (C1–C5)"
        [ test "C1: a reconnect keeps the inbox; a different account parks it" <|
            \_ ->
                let
                    signedIn =
                        Tuple.first (update (RuntimeOwnerStateReceived (stamp "o1" (Just "alice") 1)) background)

                    noted =
                        Tuple.first (feed signedIn ":bob!u@h PRIVMSG #c :hi me")

                    -- The runtime reports a new physical owner on reconnect:
                    -- a fresh ownerRef, the next connection generation, no
                    -- account until SASL re-proves it.
                    ( dropped, _ ) =
                        update (RuntimeOwnerStateReceived (stamp "o2" Nothing 2)) noted

                    ( reproven, _ ) =
                        update (RuntimeOwnerStateReceived (stamp "o3" (Just "alice") 2)) dropped

                    ( other, _ ) =
                        update (RuntimeOwnerStateReceived (stamp "o4" (Just "mallory") 3)) reproven
                in
                Expect.all
                    [ \_ -> Expect.equal [ "hi me" ] (texts noted)
                    , \_ -> Expect.equal [] (texts dropped)
                    , \_ -> Expect.equal [ "hi me" ] (texts reproven)
                    , \_ -> Expect.equal [] (texts other)
                    , \_ -> Expect.equal False (Dict.member "alice" other.inboxStash)
                    ]
                    ()
        , test "C2: one coalesced connection-lost row, cleared on re-registration" <|
            \_ ->
                let
                    live =
                        { background | connection = Live }

                    ( once, _ ) =
                        update (WsClosed { clean = False, reason = "error" }) live

                    ( twice, _ ) =
                        update (WsClosed { clean = True, reason = "closed" }) once

                    ( dropAgain, _ ) =
                        update (WsClosed { clean = False, reason = "gone" }) { twice | connection = Registering }

                    ( registered, _ ) =
                        feed dropAgain ":s 001 me :welcome"

                    ( quiet, _ ) =
                        update (WsClosed { clean = True, reason = "bye" }) { live | quietNextClose = True }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "Disconnected: error" ] (texts once)
                    , \_ -> Expect.equal [ "Disconnected: error" ] (texts twice)
                    , \_ -> Expect.equal [ ( "Disconnected: gone", 2 ) ] (List.map (\n -> ( n.text, n.count )) dropAgain.notifications)
                    , \_ -> Expect.equal [] (texts registered)
                    , \_ -> Expect.equal [] (texts quiet)
                    , \_ -> Expect.equal False quiet.quietNextClose
                    ]
                    ()
        , test "C3: ignored senders file no rows, and ignoring purges theirs" <|
            \_ ->
                let
                    ( ignored, _ ) =
                        update (IgnoreUser "bob") background

                    dm =
                        Tuple.first (feed ignored ":bob!u@h PRIVMSG me :secret text")

                    channel =
                        Tuple.first (feed ignored ":bob!u@h PRIVMSG #c :hi me")

                    before =
                        feedAll background [ ":bob!u@h PRIVMSG me :one", ":carol!u@h PRIVMSG me :two" ]

                    ( purged, _ ) =
                        update (IgnoreUser "bob") before
                in
                Expect.all
                    [ \_ -> Expect.equal [] (texts dm)
                    , \_ -> Expect.equal [] (texts channel)
                    , \_ -> Expect.equal [ "one", "two" ] (texts before)
                    , \_ -> Expect.equal [ "two" ] (texts purged)
                    ]
                    ()
        , test "C4: only a live envelope notifies after decrypt, and only once" <|
            \_ ->
                let
                    sealed =
                        Tuple.first (feed background (":bob!u@h PRIVMSG me :" ++ envelopeBody))

                    open model =
                        Tuple.first (update (DmOpenResult { peer = "bob", messageId = 0, envelope = envelopeBody, plaintext = "decrypted" }) model)

                    first =
                        open sealed

                    again =
                        open first

                    replayed =
                        Tuple.first (feed { background | historyMerging = True } (":bob!u@h PRIVMSG me :" ++ envelopeBody))
                in
                Expect.all
                    [ \_ -> Expect.equal [] (texts sealed)
                    , \_ -> Expect.equal [ "decrypted" ] (texts first)
                    , \_ -> Expect.equal [ "decrypted" ] (texts again)
                    , \_ -> Expect.equal Set.empty replayed.notifyOnOpen
                    , \_ -> Expect.equal [] (texts (open replayed))
                    ]
                    ()
        , test "C5: server NOTICEs to us file no DM, no bucket named after us, no mention" <|
            \_ ->
                let
                    noticed =
                        feedAll background
                            [ ":onyx.test NOTICE me :connecting from Somewhere | AS0"
                            , ":onyx.test NOTICE me :FAIL CHATHISTORY NEED_REGISTRATION: You must negotiate"
                            , ":onyx.test NOTICE * :*** Looking up your hostname"
                            , ":Services NOTICE me :secured (TLS1.3) | you are abc"
                            ]

                    home =
                        render { noticed | navSection = Nav.Home }
                in
                Expect.all
                    [ \_ -> Expect.equal [] (texts noticed)
                    , \_ -> Expect.equal [ "#c" ] (Dict.keys noticed.channels)
                    , \_ -> Expect.equal 4 (List.length noticed.serverNotices)
                    , \_ -> home |> Query.findAll [ Selector.class "onyx-home-row-name", Selector.containing [ Selector.text "me" ] ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        ]


high : Test
high =
    describe "inbox high (H1–H5)"
        [ test "H2: opening the conversation, or a remote MARKREAD, marks its rows read" <|
            \_ ->
                let
                    noted =
                        feedAll background
                            [ "@time=2026-01-01T00:00:01.000Z :bob!u@h PRIVMSG #c :hi me"
                            , "@time=2026-01-01T00:00:05.000Z :bob!u@h PRIVMSG #c :later me"
                            ]

                    ( opened, _ ) =
                        update (ChannelSelect "#c") noted

                    remote =
                        Tuple.first (feed noted ":me!u@h MARKREAD #c timestamp=2026-01-01T00:00:02.000Z")
                in
                Expect.all
                    [ \_ -> Expect.equal 2 (unreadAttentionCount noted)
                    , \_ -> Expect.equal 0 (unreadAttentionCount opened)
                    , \_ -> Expect.equal [ "later me" ] (List.filter (\n -> not (Set.member n.id remote.readNotificationIds)) remote.notifications |> List.map .text)
                    ]
                    ()
        , test "H3: rows keep their msgid and activation lands on the message" <|
            \_ ->
                let
                    noted =
                        Tuple.first (feed background "@msgid=m1 :bob!u@h PRIVMSG #c :hi me")

                    ( landed, _ ) =
                        update (NotificationActivated "notif-0") noted

                    dmed =
                        Tuple.first (feed { blank | ourNick = "me" } ":nova!u@h PRIVMSG me :around?")

                    ( dmOpened, _ ) =
                        update (NotificationActivated "notif-0") { dmed | channels = Dict.empty }
                in
                Expect.all
                    [ \_ -> Expect.equal [ Just "m1" ] (List.map .msgid noted.notifications)
                    , \_ -> Expect.equal (Just "#c") landed.activeChannel
                    , \_ -> Expect.equal (Just "m1") landed.historyLanding
                    , \_ -> Expect.equal (Just "nova") dmOpened.activeChannel
                    ]
                    ()
        , test "H4: the bell toggles and dismissal moves focus to a neighbour" <|
            \_ ->
                let
                    noted =
                        feedAll background [ ":a!u@h PRIVMSG me :one", ":b!u@h PRIVMSG me :two" ]

                    ( opened, _ ) =
                        update NotificationCenterOpened noted

                    ( toggled, _ ) =
                        update NotificationCenterOpened opened

                    ( _, newestOut ) =
                        update (NotificationDismissed "notif-1") opened

                    ( lastOne, _ ) =
                        update (NotificationDismissed "notif-1") opened

                    ( _, lastOut ) =
                        update (NotificationDismissed "notif-0") lastOne
                in
                Expect.all
                    [ \_ -> Expect.equal True opened.showNotificationCenter
                    , \_ -> Expect.equal False toggled.showNotificationCenter
                    , \_ -> Expect.equal [ FocusElement "inbox-dismiss-notif-0" ] newestOut
                    , \_ -> Expect.equal [ FocusElement "inbox-close" ] lastOut
                    ]
                    ()
        ]


medium : Test
medium =
    describe "inbox medium (M2–M8)"
        [ test "M2: keywords and @here record mention rows" <|
            \_ ->
                let
                    keyed =
                        Tuple.first (feed { background | highlightWords = [ "deploy" ] } ":bob!u@h PRIVMSG #c :the deploy is done")

                    here =
                        Tuple.first (feed background ":bob!u@h PRIVMSG #c :@here standup")
                in
                Expect.all
                    [ \_ -> Expect.equal [ NotifMention ] (List.map .kind keyed.notifications)
                    , \_ -> Expect.equal [ NotifMention ] (List.map .kind here.notifications)
                    ]
                    ()
        , test "M3: the cap evicts read rows, then system rows, before unread attention" <|
            \_ ->
                let
                    add kind text acc =
                        addNotification acc { kind = kind, text = text, from = Nothing, channel = Nothing, topic = Nothing }

                    mentions =
                        List.foldl (\n acc -> add NotifMention ("m" ++ String.fromInt n) acc) blank (List.range 1 49)

                    withSystem =
                        add NotifSystem "sys" mentions

                    readFirst =
                        markNotificationRead withSystem "notif-10"

                    overRead =
                        add NotifMention "new1" readFirst

                    overSystem =
                        add NotifMention "new2" withSystem
                in
                Expect.all
                    [ \_ -> Expect.equal 50 (List.length overRead.notifications)
                    , \_ -> Expect.equal False (List.member "m11" (texts overRead))
                    , \_ -> Expect.equal True (List.member "sys" (texts overRead))
                    , \_ -> Expect.equal False (List.member "sys" (texts overSystem))
                    , \_ -> Expect.equal True (List.member "m1" (texts overSystem))
                    ]
                    ()
        , test "M4: repeats merge into one row with a count and come back unread" <|
            \_ ->
                let
                    failure =
                        { kind = NotifError, text = "Cannot send to #c: muted", from = Nothing, channel = Nothing, topic = Nothing }

                    once =
                        addNotification blank failure

                    read =
                        markAllNotificationsRead once

                    twice =
                        addNotification read failure

                    invites =
                        feedAll background [ ":bob!u@h INVITE me #x", ":bob!u@h INVITE me #x" ]
                in
                Expect.all
                    [ \_ -> Expect.equal [ ( "notif-0", 2 ) ] (List.map (\n -> ( n.id, n.count )) twice.notifications)
                    , \_ -> Expect.equal [ "notif-0" ] (unreadIds twice)
                    , \_ -> Expect.equal [ 2 ] (List.map .count invites.notifications)
                    ]
                    ()
        , test "M5: an invite is attention with a join, a screen share opens the DM" <|
            \_ ->
                let
                    invited =
                        Tuple.first (feed { background | connection = Live } ":bob!u@h INVITE me #x")

                    ( joining, joinOut ) =
                        update (NotificationActivated "notif-0") invited

                    shared =
                        Tuple.first (feed background ":bob!u@h PRIVMSG me :\u{0001}SCREENSHARE START\u{0001}")
                in
                Expect.all
                    [ \_ -> Expect.equal 1 (unreadAttentionCount invited)
                    , \_ -> Expect.equal [ "JOIN #x\r\n" ] (sends joinOut)
                    , \_ -> Expect.equal False joining.showNotificationCenter
                    , \_ -> Expect.equal (List.map (notificationDestination >> Maybe.map (\_ -> True)) shared.notifications) [ Just True ]
                    ]
                    ()
        , test "M6: an offline memo and being removed from a room file rows" <|
            \_ ->
                let
                    kicked =
                        Tuple.first (feed (joined "#x") ":op!u@h KICK #x me :rude")

                    ( rejoin, rejoinOut ) =
                        update (NotificationJoin "notif-0") { kicked | connection = Live }
                in
                Expect.all
                    [ \_ -> Expect.equal [ ( NotifKick, "op removed you from #x: rude" ) ] (List.map (\n -> ( n.kind, n.text )) kicked.notifications)
                    , \_ -> Expect.equal [ "JOIN #x\r\n" ] (sends rejoinOut)
                    , \_ -> Expect.equal (Set.singleton "notif-0") rejoin.readNotificationIds
                    ]
                    ()
        , test "M7: a webhook mention quotes the flattened text, not the JSON" <|
            \_ ->
                let
                    noted =
                        Tuple.first (feed background ":hook!u@h NOTICE #c :{\"content\":\"me: deploy finished\"}")
                in
                Expect.equal [ False ] (List.map (.text >> String.contains "{") noted.notifications)
        , test "M8: rows carry the server time" <|
            \_ ->
                let
                    noted =
                        Tuple.first (feed { background | nowMs = 9.0e12 } "@time=2026-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :hi me")
                in
                Expect.equal [ 1767225600000 ] (List.map .atMs noted.notifications)
        , test "relative ages stay compact and never render a zero stamp" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "now") (View.Inbox.relativeAge 1000 30000)
                    , \_ -> Expect.equal (Just "5m") (View.Inbox.relativeAge 0.001 300001)
                    , \_ -> Expect.equal (Just "3h") (View.Inbox.relativeAge 1 (3 * 3600000 + 1))
                    , \_ -> Expect.equal (Just "2d") (View.Inbox.relativeAge 1 (49 * 3600000))
                    , \_ -> Expect.equal Nothing (View.Inbox.relativeAge 0 5000)
                    ]
                    ()
        ]


wireGates : Test
wireGates =
    describe "wire gates found on the live server"
        [ test "no METADATA without draft/metadata-2" <|
            \_ ->
                let
                    ( _, without ) =
                        update (OwnMetadataSet "ocean.bio" "hi") { blank | ourNick = "me" }

                    ( _, with ) =
                        update (OwnMetadataSet "ocean.bio" "hi") { blank | ourNick = "me", caps = [ "draft/metadata-2" ] }
                in
                Expect.all
                    [ \_ -> Expect.equal [] (sends without)
                    , \_ -> Expect.equal [ "METADATA * SET ocean.bio hi\r\n" ] (sends with)
                    ]
                    ()
        , test "no CHATHISTORY before registration completes" <|
            \_ ->
                let
                    registering =
                        { blank | ourNick = "me", connection = Registering, caps = [ "draft/chathistory" ] }

                    ( early, earlyOut ) =
                        feed registering ":me!u@h JOIN #c"

                    ( _, liveOut ) =
                        feed { registering | connection = Live } ":me!u@h JOIN #c"

                    history lines =
                        List.filter (String.startsWith "CHATHISTORY") lines
                in
                Expect.all
                    [ \_ -> Expect.equal [] (history (sends earlyOut))
                    , \_ -> Expect.equal False (Set.member "#c" early.historyExhausted)
                    , \_ -> Expect.equal [ "CHATHISTORY LATEST #c * 50\r\n" ] (history (sends liveOut))
                    ]
                    ()
        , test "a FAIL echoed as a server NOTICE is never a direct message" <|
            \_ ->
                let
                    m =
                        Tuple.first (feed background ":onyx.test NOTICE me :FAIL CHATHISTORY NEED_REGISTRATION: You must negotiate")
                in
                Expect.equal ( [], Nothing ) ( texts m, Dict.get "onyx.test" m.channels |> Maybe.map .name )
        , test "a room topic edit sends a sanitized TOPIC for operators only" <|
            \_ ->
                let
                    op =
                        feedAll { blank | ourNick = "me", connection = Live } [ ":me!u@h JOIN #c", ":s 353 me = #c :@me bob", ":s 366 me #c :End" ]
                            |> (\m -> Tuple.first (update (ChannelSelect "#c") m))

                    ( editing, _ ) =
                        update RoomTopicEditStart op

                    ( typed, _ ) =
                        update (RoomTopicEditInput "  new\ntopic  ") editing

                    ( saved, out ) =
                        update RoomTopicEditSubmit typed

                    plain =
                        Tuple.first (update (ChannelSelect "#c") (joined "#c"))

                    ( notOp, _ ) =
                        update RoomTopicEditStart plain
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "") editing.roomTopicDraft
                    , \_ -> Expect.equal [ "TOPIC #c :new topic\r\n" ] (sends out)
                    , \_ -> Expect.equal Nothing saved.roomTopicDraft
                    , \_ -> Expect.equal Nothing notOp.roomTopicDraft
                    ]
                    ()
        ]


view : Test
view =
    describe "inbox and header presentation (H4, H5, M1, M9)"
        [ test "the sheet is a labelled modal and rows expose type and unread state" <|
            \_ ->
                let
                    noted =
                        feedAll background [ ":bob!u@h PRIVMSG #c :hi me" ]

                    q =
                        render { noted | showNotificationCenter = True, navSection = Nav.Rooms }
                in
                Expect.all
                    [ \_ -> q |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "inbox-panel") ] |> Query.has [ Selector.attribute (Attr.attribute "aria-modal" "true"), Selector.attribute (Attr.attribute "aria-label" "Notification inbox") ]
                    , \_ -> q |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "inbox-bell") ] |> Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "true"), Selector.attribute (Attr.attribute "aria-haspopup" "dialog") ]
                    , \_ -> q |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "inbox-row") ] |> Query.has [ Selector.attribute (Attr.attribute "data-type" "mention"), Selector.attribute (Attr.attribute "data-unread" "true") ]
                    , \_ -> q |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "inbox-backdrop") ] |> Event.simulate Event.click |> Event.expect NotificationCenterClosed
                    ]
                    ()
        , test "the badge caps at 9+" <|
            \_ ->
                let
                    many =
                        List.foldl (\n acc -> addNotification acc { kind = NotifDm, text = "d" ++ String.fromInt n, from = Just ("p" ++ String.fromInt n), channel = Nothing, topic = Nothing }) blank (List.range 1 12)
                in
                render { many | navSection = Nav.Rooms }
                    |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "inbox-badge") ]
                    |> Query.has [ Selector.text "9+" ]
        , test "the room header carries the name, count, tools, and hidden details" <|
            \_ ->
                let
                    opened =
                        feedAll { blank | ourNick = "me" } [ ":me!u@h JOIN #c", ":bob!u@h JOIN #c" ]
                            |> (\m -> Tuple.first (update (ChannelSelect "#c") m))

                    q =
                        render opened
                in
                Expect.all
                    [ \_ -> q |> Query.find [ Selector.class "onyx-room-name" ] |> Query.has [ Selector.text "#c" ]
                    , \_ -> q |> Query.find [ Selector.class "onyx-room-summary" ] |> Query.has [ Selector.text "2 members", Selector.attribute (Attr.attribute "aria-expanded" "false") ]
                    , \_ -> q |> Query.find [ Selector.id "room-details" ] |> Query.has [ Selector.attribute (Attr.hidden True) ]
                    , \_ -> q |> Query.find [ Selector.id "room-details-toggle" ] |> Event.simulate Event.click |> Event.expect RoomDetailsToggle
                    , \_ -> q |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "ribbon-pins") ] |> Query.count (Expect.equal 1)
                    ]
                    ()
        ]


invite : Test
invite =
    describe "invite links on first load"
        [ test "the join query is read at init, not only on in-app navigation" <|
            \_ ->
                case Url.fromString "https://eshmaki.me/invite/?join=%23room&as=kit" of
                    Just url ->
                        let
                            model =
                                App.init "" url
                        in
                        Expect.all
                            [ \_ -> Expect.equal (Just "#room") (inviteCard model).channel
                            , \_ -> Expect.equal "kit" model.inviteName
                            ]
                            ()

                    Nothing ->
                        Expect.fail "fixture url"
        ]
