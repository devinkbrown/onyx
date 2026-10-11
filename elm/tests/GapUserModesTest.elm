module GapUserModesTest exposing (suite)

{-| v3/gap-usermodes — the App glue around the `UserModes` core: lines
reach it before the older folds, its effects become wire lines and local
rows, the hooks the older folds call (ignore, autojoin, send-later) route
through it, and the views read what it folded. Wire vectors for the core
itself live in `UserModesTest`.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Decode as Decode
import Json.Encode as Encode
import PrefsPanel
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import UserModes
import View


signedIn : Model
signedIn =
    { blank
        | connection = Live
        , ourNick = "kn"
        , accountName = Just "kn"
        , endpoint = Just "wss://irc.example"
        , serverPrefix = Just "onyx.test"
        , nowMs = 1.0e12
    }


guestLive : Model
guestLive =
    { signedIn | accountName = Nothing }


feed : String -> ( Model, List Outbound ) -> ( Model, List Outbound )
feed line ( model, outs ) =
    let
        ( next, more ) =
            update (WsLineReceived line) model
    in
    ( next, outs ++ more )


feedAll : List String -> Model -> ( Model, List Outbound )
feedAll lines model =
    List.foldl feed ( model, [] ) lines


inRoom : Model -> Model
inRoom model =
    feedAll
        [ ":kn!u@h JOIN #lounge"
        , ":onyx.test 353 kn = #lounge :kn alice"
        , ":onyx.test 366 kn #lounge :End of /NAMES list."
        ]
        model
        |> Tuple.first
        |> (\m -> { m | activeChannel = Just "#lounge" })


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


saves : List Outbound -> List String
saves outs =
    List.filterMap
        (\o ->
            case o of
                UserModesSave r ->
                    Just r.json

                _ ->
                    Nothing
        )
        outs


um : UserModes.Msg -> Msg
um =
    UserModesMsg


run : Msg -> Model -> ( Model, List Outbound )
run =
    update


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


toastTitles : Model -> List String
toastTitles model =
    List.map .title model.toasts


rowBodies : Model -> String -> List String
rowBodies model target =
    Dict.get (String.toLower target) model.channels
        |> Maybe.map (.messages >> List.map .body)
        |> Maybe.withDefault []


suite : Test
suite =
    describe "v3/gap-usermodes glue"
        [ wireTests
        , mirrorTests
        , scheduleTests
        , storageTests
        , viewTests
        ]


wireTests : Test
wireTests =
    describe "inbound lines"
        [ test "a fresh 001 asks the server for the modes" <|
            \_ ->
                let
                    ( _, outs ) =
                        update (WsLineReceived ":onyx.test 001 kn :Welcome") { signedIn | connection = Registering }
                in
                Expect.equal True (List.member "MODE kn\r\n" (sends outs))
        , test "221 seeds the switches without reaching the numeric log" <|
            \_ ->
                let
                    ( m, _ ) =
                        update (WsLineReceived ":onyx.test 221 kn :+iR") signedIn
                in
                Expect.all
                    [ \_ -> Expect.equal True (UserModes.modeOn m.userModes 'R')
                    , \_ -> Expect.equal True (UserModes.modeOn m.userModes 'i')
                    , \_ -> Expect.equal [] m.serviceLog
                    ]
                    ()
        , test "004 teaches which modes the server offers, and the old fold still runs" <|
            \_ ->
                let
                    ( m, _ ) =
                        update (WsLineReceived ":onyx.test 004 kn onyx.test onyx-9.1 iRg bklmn") signedIn
                in
                Expect.all
                    [ \_ -> Expect.equal (Just (Set.fromList [ 'i', 'R', 'g' ])) m.userModes.advertised
                    , \_ -> Expect.equal (Just "onyx-9.1") m.serverVersion
                    ]
                    ()
        , test "toggling a switch sends the change, a query and saves the wish" <|
            \_ ->
                let
                    ( m, outs ) =
                        run (um (UserModes.ToggleMode 'g')) signedIn
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MODE kn +g\r\n", "MODE kn\r\n" ] (sends outs)
                    , \_ -> Expect.equal 1 (List.length (saves outs))
                    , \_ -> Expect.equal True (UserModes.modeOn m.userModes 'g')
                    ]
                    ()
        , test "a 718 becomes a request, a toast and a bell count; Accept sends ACCEPT" <|
            \_ ->
                let
                    ( m, _ ) =
                        update (WsLineReceived ":onyx.test 718 kn mira u@cloak.example :is messaging you, and you have umode +g set. Use ACCEPT to allow") signedIn

                    ( accepted, outs ) =
                        run (um (UserModes.RequestAccept "mira")) m
                in
                Expect.all
                    [ \_ -> Expect.equal [ "mira" ] (List.map .nick m.userModes.requests)
                    , \_ -> Expect.equal True (List.member "mira wants to message you" (toastTitles m))
                    , \_ -> Expect.equal [ "ACCEPT +mira\r\n", "ACCEPT *\r\n" ] (sends outs)
                    , \_ -> Expect.equal [] accepted.userModes.requests
                    ]
                    ()
        , test "a 716 leaves a note in the DM that was refused" <|
            \_ ->
                let
                    ( withDm, _ ) =
                        update (WsLineReceived ":mira!m@h PRIVMSG kn :hi") signedIn

                    ( m, _ ) =
                        update (WsLineReceived ":onyx.test 716 kn mira :is in +g mode (must be accepted)") withDm
                in
                Expect.equal True
                    (List.any (String.contains "mira approves new conversations first") (rowBodies m "mira"))
        , test "a memo delivered at sign-in lands as a DM and a toast" <|
            \_ ->
                let
                    ( m, _ ) =
                        update (WsLineReceived ":onyx.test NOTICE kn :MEMO from alice :happy birthday") signedIn
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member "happy birthday" (rowBodies m "alice"))
                    , \_ -> Expect.equal True (List.any (String.contains "alice") (toastTitles m))
                    , \_ -> Expect.equal [] m.serviceLog
                    ]
                    ()
        , test "a user's NOTICE that imitates a memo is just a notice" <|
            \_ ->
                let
                    ( m, _ ) =
                        update (WsLineReceived ":mallory!u@h NOTICE kn :MEMO from boss :wire me money") signedIn
                in
                Expect.equal Nothing (Dict.get "boss" m.channels)
        , test "an offline person's profile asks WHOWAS then SEEN" <|
            \_ ->
                let
                    ( opened, askOuts ) =
                        update (WhoisRequest "wren") signedIn

                    ( noSuch, whowasOuts ) =
                        update (WsLineReceived ":onyx.test 401 kn wren :No such nick") opened

                    ( answered, seenOuts ) =
                        feedAll
                            [ ":onyx.test 314 kn wren w cloak.example * :Wren Ito"
                            , ":onyx.test 330 kn wren wrenacct :is logged in as"
                            , ":onyx.test 312 kn wren onyx.test :999999000"
                            , ":onyx.test 369 kn wren :End of WHOWAS"
                            ]
                            noSuch
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member "WHOIS wren wren\r\n" (sends askOuts))
                    , \_ -> Expect.equal [ "WHOWAS wren 1\r\n" ] (sends whowasOuts)
                    , \_ -> Expect.equal [ "SEEN wrenacct\r\n" ] (sends seenOuts)
                    , \_ -> Expect.equal True (UserModes.offlineFor "wren" answered.userModes /= Nothing)
                    ]
                    ()
        ]


mirrorTests : Test
mirrorTests =
    describe "hooks the older folds call"
        [ test "blocking mirrors to SILENCE only when opted in and signed in" <|
            \_ ->
                let
                    on m =
                        let
                            u =
                                m.userModes
                        in
                        { m | userModes = { u | serverIgnore = True } }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "SILENCE +bob!*@*\r\n" ] (sends (Tuple.second (run (IgnoreUser "bob") (on signedIn))))
                    , \_ -> Expect.equal [] (sends (Tuple.second (run (IgnoreUser "bob") signedIn)))
                    , \_ -> Expect.equal [] (sends (Tuple.second (run (IgnoreUser "bob") (on guestLive))))
                    ]
                    ()
        , test "the local block is unchanged by the mirror" <|
            \_ ->
                let
                    u =
                        signedIn.userModes

                    ( m, _ ) =
                        run (IgnoreUser "Bob") { signedIn | userModes = { u | serverIgnore = True } }
                in
                Expect.equal True (Set.member "bob" m.ignoredUsers)
        , test "unblocking lifts the server block it mirrored" <|
            \_ ->
                let
                    u =
                        signedIn.userModes

                    base =
                        { signedIn | ignoredUsers = Set.singleton "bob", userModes = { u | silenced = [ "bob!*@*" ] } }
                in
                Expect.equal [ "SILENCE -bob!*@*\r\n" ] (sends (Tuple.second (run (UnignoreUser "bob") base)))
        , test "/ignore from the composer mirrors too" <|
            \_ ->
                let
                    u =
                        signedIn.userModes

                    ( _, outs ) =
                        run ComposerSend { signedIn | activeChannel = Just "#c", composer = "/ignore bob", userModes = { u | serverIgnore = True } }
                in
                Expect.equal True (List.member "SILENCE +bob!*@*\r\n" (sends outs))
        , test "/autojoin and /unautojoin reach the account when signed in" <|
            \_ ->
                let
                    added =
                        run ComposerSend { signedIn | activeChannel = Just "#c", composer = "/autojoin" }

                    removed =
                        run ComposerSend { signedIn | activeChannel = Just "#c", composer = "/unautojoin", autoJoinChannels = [ "#c" ] }

                    guestAdded =
                        run ComposerSend { guestLive | activeChannel = Just "#c", composer = "/autojoin" }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "AUTOJOIN ADD #c\r\n" ] (sends (Tuple.second added))
                    , \_ -> Expect.equal [ "AUTOJOIN DEL #c\r\n" ] (sends (Tuple.second removed))
                    , \_ -> Expect.equal [] (sends (Tuple.second guestAdded))
                    , \_ -> Expect.equal [ "#c" ] (Tuple.first guestAdded).autoJoinChannels
                    ]
                    ()
        , test "the Account list refreshes when the panel opens" <|
            \_ ->
                let
                    ( _, outs ) =
                        run (SetAccountOpen True) signedIn
                in
                Expect.equal True (List.member "AUTOJOIN LIST\r\n" (sends outs))
        , test "the Privacy pane refreshes the approved list when it opens" <|
            \_ ->
                let
                    ( opened, _ ) =
                        run PrefsOpen signedIn

                    ( _, outs ) =
                        run (PrefsSelectCategory PrefsPanel.Privacy) opened
                in
                Expect.equal True (List.member "ACCEPT *\r\n" (sends outs))
        , test "the Notifications sheet refreshes the server blocks when signed in" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (List.member "SILENCE\r\n" (sends (Tuple.second (run NotifySheetOpen signedIn))))
                    , \_ -> Expect.equal False (List.member "SILENCE\r\n" (sends (Tuple.second (run NotifySheetOpen guestLive))))
                    ]
                    ()
        ]


scheduleTests : Test
scheduleTests =
    describe "send later on the server"
        [ test "with 'On the server' chosen a preset sends DEFER AT and keeps the draft until it is confirmed" <|
            \_ ->
                let
                    base =
                        inRoom { signedIn | composer = "see you at six" }

                    ( chosen, _ ) =
                        run (um (UserModes.DeferChoose True)) base

                    ( opened, _ ) =
                        run ScheduleOpen chosen

                    ( sent, outs ) =
                        run (SchedulePresetClicked { id = "in-15m" }) opened
                in
                Expect.all
                    [ \_ ->
                        Expect.equal [ "DEFER AT 1000000900000 #lounge :see you at six\r\n" ] (sends outs)
                    , \_ -> Expect.equal "see you at six" sent.composer
                    , \_ -> Expect.equal [] sent.scheduledMessages
                    , \_ -> Expect.equal 1 (List.length sent.userModes.deferInflight)
                    ]
                    ()
        , test "the server's 'scheduled' notice settles it: toast, draft cleared, held list kept" <|
            \_ ->
                let
                    base =
                        inRoom { signedIn | composer = "see you at six" }

                    ( chosen, _ ) =
                        run (um (UserModes.DeferChoose True)) base

                    ( opened, _ ) =
                        run ScheduleOpen chosen

                    ( sent, _ ) =
                        run (SchedulePresetClicked { id = "in-15m" }) opened

                    ( done, outs ) =
                        update (WsLineReceived ":onyx.test NOTICE kn :DEFER: scheduled") sent
                in
                Expect.all
                    [ \_ -> Expect.equal "" done.composer
                    , \_ -> Expect.equal False done.scheduleOpen
                    , \_ -> Expect.equal True (List.member "Scheduled on the server" (toastTitles done))
                    , \_ -> Expect.equal 1 (List.length done.userModes.deferHeld)
                    , \_ -> Expect.equal 1 (List.length (saves outs))
                    ]
                    ()
        , test "a refusal keeps the draft and says why in the picker" <|
            \_ ->
                let
                    base =
                        inRoom { signedIn | composer = "see you at six" }

                    ( chosen, _ ) =
                        run (um (UserModes.DeferChoose True)) base

                    ( opened, _ ) =
                        run ScheduleOpen chosen

                    ( sent, _ ) =
                        run (SchedulePresetClicked { id = "in-15m" }) opened

                    ( done, _ ) =
                        update (WsLineReceived ":onyx.test NOTICE kn :DEFER: already scheduled") sent
                in
                Expect.all
                    [ \_ -> Expect.equal "see you at six" done.composer
                    , \_ -> Expect.equal True (done.scheduleError /= Nothing)
                    , \_ -> Expect.equal [] done.userModes.deferHeld
                    ]
                    ()
        , test "without the choice, a preset still schedules on this device" <|
            \_ ->
                let
                    base =
                        inRoom { signedIn | composer = "see you at six" }

                    ( opened, _ ) =
                        run ScheduleOpen base

                    ( _, outs ) =
                        run (SchedulePresetClicked { id = "in-15m" }) opened
                in
                Expect.equal [] (sends outs)
        , test "a draft the server can't hold quietly stays local" <|
            \_ ->
                let
                    base =
                        inRoom { signedIn | composer = "line one\nline two" }

                    ( chosen, _ ) =
                        run (um (UserModes.DeferChoose True)) base

                    ( opened, _ ) =
                        run ScheduleOpen chosen

                    ( _, outs ) =
                        run (SchedulePresetClicked { id = "in-15m" }) opened
                in
                Expect.equal [] (List.filter (String.startsWith "DEFER") (sends outs))
        ]


storageTests : Test
storageTests =
    describe "owner-scoped storage"
        [ test "the owner's slot is requested once it is known" <|
            \_ ->
                let
                    ( m, outs ) =
                        run (um UserModes.OpenPrivacyPanel) signedIn
                in
                Expect.all
                    [ \_ ->
                        Expect.equal True
                            (List.any
                                (\o ->
                                    case o of
                                        UserModesRequest r ->
                                            r.identity == "kn" && r.serverUrl == "wss://irc.example"

                                        _ ->
                                            False
                                )
                                outs
                            )
                    , \_ -> Expect.equal True (m.userModesOwner /= Nothing)
                    ]
                    ()
        , test "stored wishes are re-applied when they arrive after 221" <|
            \_ ->
                let
                    ( known, _ ) =
                        update (WsLineReceived ":onyx.test 221 kn :+x") signedIn

                    raw =
                        Decode.decodeString Decode.value "{\"v\":1,\"wanted\":\"R\",\"realname\":\"Wren Ito\"}" |> Result.withDefault Encode.null

                    ( loaded, outs ) =
                        run (UserModesLoaded raw) known
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member "MODE kn +R\r\n" (sends outs))
                    , \_ -> Expect.equal True (List.member "SETNAME :Wren Ito\r\n" (sends outs))
                    , \_ -> Expect.equal "Wren Ito" loaded.userModes.realname
                    ]
                    ()
        , test "switching account forgets the previous owner's wishes" <|
            \_ ->
                let
                    u =
                        signedIn.userModes

                    ( m, _ ) =
                        run (um UserModes.OpenPrivacyPanel) { signedIn | userModesOwner = Just { serverUrl = "wss://irc.example", identity = "someone" }, userModes = { u | wanted = Set.fromList [ 'R' ], serverIgnore = True } }
                in
                Expect.all
                    [ \_ -> Expect.equal Set.empty m.userModes.wanted
                    , \_ -> Expect.equal False m.userModes.serverIgnore
                    ]
                    ()
        , test "the socket closing ends in-flight asks" <|
            \_ ->
                let
                    u =
                        signedIn.userModes

                    base =
                        { signedIn | userModes = { u | memoListing = True, whowasPending = Just "wren", seenPending = [ "x" ] } }

                    ( m, _ ) =
                        run (WsClosed { clean = True, reason = "" }) base
                in
                Expect.all
                    [ \_ -> Expect.equal False m.userModes.memoListing
                    , \_ -> Expect.equal Nothing m.userModes.whowasPending
                    , \_ -> Expect.equal [] m.userModes.seenPending
                    ]
                    ()
        ]


viewTests : Test
viewTests =
    describe "views"
        [ test "Preferences has a Privacy pane with a switch per offered mode" <|
            \_ ->
                let
                    ( m, _ ) =
                        update (WsLineReceived ":onyx.test 221 kn :+R") signedIn

                    ( opened, _ ) =
                        run PrefsOpen m

                    ( pane, _ ) =
                        run (PrefsSelectCategory PrefsPanel.Privacy) opened
                in
                Expect.all
                    [ \q -> q |> Query.find [ testid "um-mode-regonly" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-checked" "true") ]
                    , \q -> q |> Query.find [ testid "um-mode-approve" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-checked" "false") ]
                    , \q -> q |> Query.findAll [ Selector.attribute (Attr.attribute "role" "switch"), Selector.attribute (Attr.attribute "data-mode" "D") ] |> Query.count (Expect.equal 0)
                    ]
                    (query pane)
        , test "a switch click dispatches ToggleMode" <|
            \_ ->
                let
                    ( opened, _ ) =
                        run PrefsOpen signedIn

                    ( pane, _ ) =
                        run (PrefsSelectCategory PrefsPanel.Privacy) opened
                in
                query pane
                    |> Query.find [ testid "um-mode-hiderooms" ]
                    |> Event.simulate Event.click
                    |> Event.expect (UserModesMsg (UserModes.ToggleMode 'p'))
        , test "the switches are disabled while offline, with a plain reason" <|
            \_ ->
                let
                    ( opened, _ ) =
                        run PrefsOpen { signedIn | connection = Offline }

                    ( pane, _ ) =
                        run (PrefsSelectCategory PrefsPanel.Privacy) opened
                in
                Expect.all
                    [ \q -> q |> Query.find [ testid "um-mode-regonly" ] |> Query.has [ Selector.disabled True ]
                    , \q -> q |> Query.has [ testid "um-modes-offline" ]
                    ]
                    (query pane)
        , test "the approved list appears with +g and shows its people" <|
            \_ ->
                let
                    ( m, _ ) =
                        feedAll [ ":onyx.test 221 kn :+g", ":onyx.test 281 kn alice :is on your accept list", ":onyx.test 282 kn :End of /ACCEPT list" ] signedIn

                    ( opened, _ ) =
                        run PrefsOpen m

                    ( pane, _ ) =
                        run (PrefsSelectCategory PrefsPanel.Privacy) opened
                in
                query pane
                    |> Query.find [ testid "um-approved-list" ]
                    |> Query.has [ Selector.text "alice" ]
        , test "the Inbox shows message requests with Accept and Ignore, and counts them on the bell" <|
            \_ ->
                let
                    ( m, _ ) =
                        update (WsLineReceived ":onyx.test 718 kn mira u@h :is messaging you") signedIn

                    ( opened, _ ) =
                        run NotificationCenterOpened m
                in
                Expect.all
                    [ \q -> q |> Query.find [ testid "message-request" ] |> Query.has [ Selector.text "mira" ]
                    , \q -> q |> Query.find [ testid "message-request-accept" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Accept message request from mira") ]
                    , \q -> q |> Query.has [ testid "inbox-offline-messages" ]
                    ]
                    (query opened)
        , test "opening the inbox marks the requests seen" <|
            \_ ->
                let
                    ( m, _ ) =
                        update (WsLineReceived ":onyx.test 718 kn mira u@h :is messaging you") signedIn

                    ( opened, _ ) =
                        run NotificationCenterOpened m
                in
                Expect.all
                    [ \_ -> Expect.equal 1 m.userModes.requestsUnseen
                    , \_ -> Expect.equal 0 opened.userModes.requestsUnseen
                    ]
                    ()
        , test "the mailbox opens from the inbox and lists what waits" <|
            \_ ->
                let
                    ( opened, outs ) =
                        run (um UserModes.MemoOpen) signedIn

                    ( listed, _ ) =
                        feedAll [ ":onyx.test NOTICE kn :MEMO from mira :call me", ":onyx.test NOTICE kn :MEMO: End of offline memos (1)" ] opened
                in
                Expect.all
                    [ \_ -> Expect.equal [ "MEMO LIST\r\n", "MEMO FORWARD\r\n", "MEMO IGNORE LIST\r\n" ] (sends outs)
                    , \_ -> query listed |> Query.find [ testid "um-memo-row" ] |> Query.has [ Selector.text "call me" ]
                    ]
                    ()
        , test "the mailbox tells a guest it needs an account" <|
            \_ ->
                let
                    ( opened, _ ) =
                        run (um UserModes.MemoOpen) guestLive
                in
                query opened |> Query.has [ testid "um-memo-guest" ]
        , test "the block list gains the server switch when signed in, a sign-in hint when not" <|
            \_ ->
                let
                    ( a, _ ) =
                        run NotifySheetOpen signedIn

                    ( g, _ ) =
                        run NotifySheetOpen guestLive
                in
                Expect.all
                    [ \_ -> query a |> Query.has [ testid "um-serverignore" ]
                    , \_ -> query g |> Query.has [ testid "um-blocks-signin" ]
                    , \_ -> query g |> Query.hasNot [ testid "um-serverignore" ]
                    ]
                    ()
        , test "the Account panel lists the account's rooms" <|
            \_ ->
                let
                    ( opened, _ ) =
                        run (SetAccountOpen True) signedIn

                    ( listed, _ ) =
                        feedAll [ ":onyx.test NOTICE kn :AUTOJOIN #lounge", ":onyx.test NOTICE kn :AUTOJOIN: end of list" ] opened
                in
                query listed |> Query.find [ testid "um-autojoin-list" ] |> Query.has [ Selector.text "#lounge" ]
        , test "the send-later picker offers the choice to accounts and a hint to guests" <|
            \_ ->
                let
                    base m =
                        inRoom { m | composer = "hi" } |> run ScheduleOpen |> Tuple.first
                in
                Expect.all
                    [ \_ -> query (base signedIn) |> Query.has [ testid "um-where-server" ]
                    , \_ -> query (base signedIn) |> Query.find [ testid "um-where-device" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-checked" "true") ]
                    , \_ -> query (base guestLive) |> Query.has [ testid "um-schedule-signin" ]
                    ]
                    ()
        , test "the server option says why it is unavailable instead of hiding" <|
            \_ ->
                let
                    m =
                        inRoom { signedIn | composer = "a\nb" } |> run ScheduleOpen |> Tuple.first
                in
                query m
                    |> Query.find [ testid "um-where-server" ]
                    |> Query.has [ Selector.disabled True, Selector.text "One line only." ]
        , test "server-held sends are labelled as uncancellable in the scheduled sheet" <|
            \_ ->
                let
                    u =
                        signedIn.userModes

                    held =
                        { signedIn
                            | showScheduledMessages = True
                            , userModes = { u | deferHeld = [ { channel = "#lounge", text = "see you at six", sendAt = 1000000900000, account = "kn" } ] }
                        }
                in
                query held
                    |> Query.find [ testid "um-held-item" ]
                    |> Query.has [ Selector.text "Can't be cancelled", Selector.text "see you at six" ]
        , test "your own card edits the network name; an absent member's card offers last-seen" <|
            \_ ->
                let
                    room =
                        inRoom signedIn

                    own =
                        run (UserProfileOpened { nick = "kn", channel = "#lounge" }) room |> Tuple.first

                    absent =
                        run (UserProfileOpened { nick = "wren", channel = "#lounge" }) room |> Tuple.first
                in
                Expect.all
                    [ \_ -> query own |> Query.has [ testid "um-selfname" ]
                    , \_ -> query absent |> Query.has [ testid "um-lastseen" ]
                    , \_ -> query absent |> Query.hasNot [ testid "um-selfname" ]
                    ]
                    ()
        ]
