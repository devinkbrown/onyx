module ModDeskTest exposing (suite)

{-| v3/moddesk — the room desk sheet and the operator desk / Event
Spine console, mirroring `shell/OperDesk.test.tsx`,
`shell/OperEventConsole.test.tsx`, `lib/moderation/eventFilters.test.ts`
and the cockpit gating in `shell/ModerationCockpit.test.tsx`.
-}

import App exposing (ConnectionState(..), Model, Msg(..), OperDeskIntent(..), Outbound(..), blank, update)
import Dict
import EventReplay
import Expect
import Html
import Html.Attributes as Attr
import OperConsole
import OperDesk
import OperReply
import Prefs
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


operModel : Model
operModel =
    { blank | connection = Live, ourNick = "root", isOper = True, operDeskOpen = True }


{-| v3/gap-oper: the desk is tabbed; the controls below live in Network. -}
onTab : OperReply.Section -> Model -> Model
onTab section model =
    let
        console =
            model.operConsole
    in
    { model | operConsole = { console | tab = section } }


run : List Msg -> Model -> ( Model, List Outbound )
run msgs model =
    List.foldl
        (\msg ( m, out ) ->
            let
                ( next, more ) =
                    update msg m
            in
            ( next, out ++ more )
        )
        ( model, [] )
        msgs


sent : List Outbound -> List String
sent =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    Just (String.replace "\r\n" "" line)

                _ ->
                    Nothing
        )


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testId : String -> Selector.Selector
testId id =
    Selector.attribute (Attr.attribute "data-testid" id)


rows : List EventReplay.EventReplayEvent
rows =
    [ { ts = 1720000000000, category = "kill", categoryCode = "KILL", severity = "warn", origin = "node-a", message = "killed badactor" }
    , { ts = 1720000000100, category = "mesh", categoryCode = "MESH", severity = "info", origin = "node-b", message = "peer up" }
    ]


opChannel : Set.Set Char -> App.Channel
opChannel modes =
    { name = "#c"
    , topic = ""
    , members = Dict.singleton "me" { nick = "me", modes = modes, away = False }
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


{-| v3/frame: Moderation lives in the room header's More menu. -}
menuOpen : Model -> Model
menuOpen model =
    { model | roomMenuOpen = True }


roomModel : Set.Set Char -> Model
roomModel modes =
    { blank | connection = Live, ourNick = "me", activeChannel = Just "#c", channels = Dict.singleton "#c" (opChannel modes) }


suite : Test
suite =
    describe "v3/moddesk"
        [ describe "OperDesk pure helpers"
            [ test "formatWirePreview colonizes only a trailing parameter that needs it" <|
                \_ ->
                    Expect.equal
                        [ "EVENT BROADCAST :server restart at 03:00", "EVENT ADD FLOOD", "REHASH" ]
                        [ OperDesk.formatWirePreview { command = "EVENT", params = [ "BROADCAST", "server restart at 03:00" ], summary = "", destructive = True }
                        , OperDesk.formatWirePreview { command = "EVENT", params = [ "ADD", "FLOOD" ], summary = "", destructive = False }
                        , OperDesk.formatWirePreview { command = "REHASH", params = [], summary = "", destructive = True }
                        ]
            , test "category labels read as words" <|
                \_ -> Expect.equal [ "Server link", "Flood" ] (List.map OperDesk.categoryLabel [ "SERVER_LINK", "FLOOD" ])
            , test "roles read as words, never mode letters" <|
                \_ -> Expect.equal [ "IRC operator", "Network administrator" ] [ OperDesk.roleLabel False, OperDesk.roleLabel True ]
            , test "filters locally by category, severity, and text" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 1 (List.length (OperDesk.filterEventRows { category = "KILL", severity = "", text = "" } rows))
                        , \_ -> Expect.equal (Just "mesh") (Maybe.map .category (List.head (OperDesk.filterEventRows { category = "", severity = "info", text = "" } rows)))
                        , \_ -> Expect.equal 1 (List.length (OperDesk.filterEventRows { category = "", severity = "", text = "badactor" } rows))
                        ]
                        ()
            , test "strips control characters and ignores blank filters" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "kill" (OperDesk.normalizeEventFilter 80 "  ki\u{0007}ll  ")
                        , \_ -> Expect.equal 2 (List.length (OperDesk.filterEventRows { category = "   ", severity = "   ", text = "   " } rows))
                        ]
                        ()
            , test "filter options are distinct and sorted" <|
                \_ -> Expect.equal [ "KILL", "MESH" ] (OperDesk.eventCategoriesIn (rows ++ List.reverse rows))
            ]
        , describe "operator desk behavior"
            [ test "reviews a network broadcast before it reaches the wire" <|
                \_ ->
                    let
                        ( staged, out1 ) =
                            run [ OperDeskField OperDesk.Broadcast "Maintenance at 03:00 UTC", OperDeskSubmit (OperBroadcast "Maintenance at 03:00 UTC") ] operModel

                        ( confirmed, out2 ) =
                            update OperDeskConfirm staged
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (sent out1)
                        , \_ -> Expect.equal (Just "EVENT BROADCAST :Maintenance at 03:00 UTC") (Maybe.map OperDesk.formatWirePreview staged.operDesk.pending)
                        , \_ -> Expect.equal [ "EVENT BROADCAST :Maintenance at 03:00 UTC" ] (sent out2)
                        , \_ -> Expect.equal "" confirmed.operDesk.broadcast
                        , \_ -> Expect.notEqual Nothing confirmed.operDesk.lastSent
                        , \_ -> Expect.equal Nothing confirmed.operDesk.pending
                        ]
                        ()
            , test "abandons a staged action on cancel" <|
                \_ ->
                    let
                        ( m, out ) =
                            run [ OperDeskSubmit OperRehash, OperDeskCancel ] operModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing m.operDesk.pending
                        , \_ -> Expect.equal [] (sent out)
                        ]
                        ()
            , test "sends a non-destructive read straight away" <|
                \_ ->
                    let
                        ( m, out ) =
                            run [ OperDeskSubmit OperPrivs, OperDeskSubmit OperEventList ] operModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "PRIVS", "EVENT LIST" ] (sent out)
                        , \_ -> Expect.equal Nothing m.operDesk.pending
                        ]
                        ()
            , test "subscribes and unsubscribes the selected category" <|
                \_ ->
                    run
                        [ OperDeskField OperDesk.Category "FLOOD"
                        , OperDeskSubmit (OperEventSubscribe "FLOOD")
                        , OperDeskSubmit (OperEventUnsubscribe "FLOOD")
                        ]
                        operModel
                        |> Tuple.second
                        |> sent
                        |> Expect.equal [ "EVENT ADD FLOOD", "EVENT DEL FLOOD" ]
            , test "refuses a smuggled control character instead of truncating it" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (OperDeskSubmit (OperBroadcast "ok\u{0007}bye")) operModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (sent out)
                        , \_ -> Expect.equal Nothing m.operDesk.pending
                        , \_ -> Expect.equal [ "The broadcast cannot include line breaks or control characters." ] m.operDesk.errors
                        ]
                        ()
            , test "a pasted CRLF never stages a second command line" <|
                \_ ->
                    let
                        ( m, out ) =
                            update (OperDeskSubmit (OperBroadcast "notice\u{000D}\nKILL root :bye")) operModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (sent out)
                        , \_ -> Expect.equal Nothing m.operDesk.pending
                        ]
                        ()
            , test "requires a recorded reason before staging a disconnect" <|
                \_ ->
                    let
                        ( noReason, _ ) =
                            update (OperDeskSubmit (OperKill { target = "flooder", reason = "" })) operModel

                        ( staged, out1 ) =
                            run
                                [ OperDeskField OperDesk.KillNick "flooder"
                                , OperDeskField OperDesk.KillReason "Repeat flooding"
                                , OperDeskSubmit (OperKill { target = "flooder", reason = "Repeat flooding" })
                                ]
                                noReason

                        ( done, out2 ) =
                            update OperDeskConfirm staged
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing noReason.operDesk.pending
                        , \_ -> Expect.equal [ "A reason is required — it is recorded network-wide." ] noReason.operDesk.errors
                        , \_ -> Expect.equal [] (sent out1)
                        , \_ -> Expect.equal [] staged.operDesk.errors
                        , \_ -> Expect.equal [ "KILL flooder :Repeat flooding" ] (sent out2)
                        , \_ -> Expect.equal ( "", "" ) ( done.operDesk.killNick, done.operDesk.killReason )
                        ]
                        ()
            , test "rejects an all-wildcard observe mask that would flood the session" <|
                \_ ->
                    let
                        ( refused, out1 ) =
                            update (OperDeskSubmit (OperObserve { mask = "*!*@*", actions = [] })) operModel

                        ( _, out2 ) =
                            update (OperDeskSubmit (OperObserve { mask = "ada!*@*.example", actions = [] })) refused
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (sent out1)
                        , \_ -> Expect.notEqual [] refused.operDesk.errors
                        , \_ -> Expect.equal [ "EVENT OBSERVE ada!*@*.example" ] (sent out2)
                        ]
                        ()
            , test "blocks every send while the socket is down" <|
                \_ ->
                    let
                        offline =
                            { operModel | connection = Offline }

                        ( staged, _ ) =
                            update (OperDeskSubmit OperRehash) operModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (sent (Tuple.second (run [ OperDeskSubmit OperPrivs, OperDeskSubmit (OperEventSubscribe "FLOOD") ] offline)))
                        , \_ -> Expect.equal [] (sent (Tuple.second (update OperDeskConfirm { staged | connection = Offline })))
                        ]
                        ()
            , test "a downgraded session refuses instead of leaking intent" <|
                \_ ->
                    let
                        ( staged, _ ) =
                            update (OperDeskSubmit OperRehash) operModel

                        ( m, out ) =
                            update OperDeskConfirm { staged | isOper = False }
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (sent out)
                        , \_ -> Expect.equal [ "Operator access required" ] (List.map .title m.toasts)
                        , \_ -> Expect.equal Nothing m.operDesk.lastSent
                        ]
                        ()
            , test "the desk opens only for server operators" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (Tuple.first (update OperDeskOpen { blank | isOper = False })).operDeskOpen
                        , \_ -> Expect.equal True (Tuple.first (update OperDeskOpen { blank | isOper = True })).operDeskOpen
                        , \_ -> Expect.equal False (Tuple.first (update OperDeskClose operModel)).operDeskOpen
                        ]
                        ()
            ]
        , describe "event console behavior"
            [ test "offers EVENT REPLAY JSON and sends when connected" <|
                \_ ->
                    let
                        ( m, out ) =
                            update OperEventReplayRequested operModel
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "EVENT REPLAY JSON ALL 50" ] (sent out)
                        , \_ -> Expect.equal True m.operEventReplay.pending
                        , \_ -> Expect.equal (Just True) (Maybe.map (String.startsWith "EVENT REPLAY JSON ALL 50") m.operDesk.lastReplay)
                        ]
                        ()
            , test "replay respects the limit set and refuses non-opers" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [ "EVENT REPLAY JSON ALL 100" ] (sent (Tuple.second (run [ OperEventReplayLimit 100, OperEventReplayRequested ] operModel)))
                        , \_ -> Expect.equal [ "EVENT REPLAY JSON ALL 50" ] (sent (Tuple.second (run [ OperEventReplayLimit 7, OperEventReplayRequested ] operModel)))
                        , \_ -> Expect.equal [] (sent (Tuple.second (update OperEventReplayRequested { operModel | isOper = False })))
                        ]
                        ()
            , test "server JSON notices fold into the structured feed" <|
                \_ ->
                    let
                        lines =
                            [ ":irc.example NOTICE root :{\"type\":\"event-replay\",\"count\":1,\"severity_floor\":\"debug\"}"
                            , ":irc.example NOTICE root :{\"type\":\"event\",\"ts\":1720000000000,\"category\":\"kill\",\"category_code\":\"KILL\",\"severity\":\"warn\",\"origin\":\"node-a\",\"message\":\"killed badactor\"}"
                            , ":irc.example NOTICE root :{\"type\":\"event-replay-end\",\"count\":1}"
                            ]

                        ( m, _ ) =
                            run (List.map App.WsLineReceived lines) { operModel | nowMs = 1720000000000 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True m.operEventReplay.complete
                        , \_ -> Expect.equal [ "KILL" ] (List.map .categoryCode m.operEventReplay.events)
                        ]
                        ()
            , test "a peer cannot forge a feed row" <|
                \_ ->
                    let
                        ( m, _ ) =
                            update (App.WsLineReceived ":mallory!u@h NOTICE root :{\"type\":\"event-replay\",\"count\":1,\"severity_floor\":\"debug\"}") operModel
                    in
                    Expect.equal False m.operEventReplay.pending
            , test "renders and filters structured rows without sending" <|
                \_ ->
                    let
                        withFeed =
                            { operModel | operEventReplay = { pending = False, severityFloor = Just "debug", expectedCount = Just 2, complete = True, receivedAt = Nothing, events = rows } }

                        filtered =
                            Tuple.first (update (OperDeskField OperDesk.FilterCategory "MESH") withFeed)

                        empty =
                            Tuple.first (update (OperDeskField OperDesk.FilterText "missing-text") filtered)
                    in
                    Expect.all
                        [ \_ -> query withFeed |> Query.findAll [ testId "oper-event-json-row" ] |> Query.count (Expect.equal 2)
                        , \_ -> query filtered |> Query.findAll [ testId "oper-event-json-row" ] |> Query.count (Expect.equal 1)
                        , \_ -> query filtered |> Query.find [ testId "oper-event-json-cat" ] |> Query.has [ Selector.text "MESH" ]
                        , \_ -> query empty |> Query.findAll [ testId "oper-event-filter-empty" ] |> Query.count (Expect.equal 1)
                        , \_ -> query withFeed |> Query.find [ testId "oper-event-filter-category" ] |> Event.simulate (Event.input "MESH") |> Event.expect (OperDeskField OperDesk.FilterCategory "MESH")
                        ]
                        ()
            ]
        , describe "operator sheet view"
            [ test "renders nothing until the session holds operator status" <|
                \_ ->
                    Expect.all
                        [ \_ -> query { operModel | isOper = False } |> Query.findAll [ testId "oper-desk" ] |> Query.count (Expect.equal 0)
                        , \_ -> query { operModel | isOper = False } |> Query.findAll [ testId "oper-desk-open" ] |> Query.count (Expect.equal 0)
                        , \_ -> query { operModel | operDeskOpen = False } |> Query.find [ testId "oper-desk-open" ] |> Event.simulate Event.click |> Event.expect OperDeskOpen
                        ]
                        ()
            , test "roles read as words in the authority rail" <|
                \_ ->
                    Expect.all
                        [ \_ -> query operModel |> Query.find [ testId "oper-desk-role" ] |> Query.has [ Selector.text "IRC operator" ]
                        , \_ -> query { operModel | isNetworkAdmin = True } |> Query.find [ testId "oper-desk-role" ] |> Query.has [ Selector.text "Network administrator" ]
                        ]
                        ()
            , test "the destructive review shows the exact wire line" <|
                \_ ->
                    let
                        staged =
                            Tuple.first (update (OperDeskSubmit OperRehash) operModel)
                    in
                    Expect.all
                        [ \_ -> query staged |> Query.find [ testId "oper-desk-review-wire" ] |> Query.has [ Selector.text "REHASH" ]
                        , \_ -> query staged |> Query.find [ testId "oper-desk-review-confirm" ] |> Event.simulate Event.click |> Event.expect OperDeskConfirm
                        , \_ -> query staged |> Query.find [ testId "oper-desk-review-cancel" ] |> Event.simulate Event.click |> Event.expect OperDeskCancel
                        ]
                        ()
            , test "offline disables the reads and shows the reconnect note" <|
                \_ ->
                    Expect.all
                        [ \_ -> query (onTab OperReply.Network { operModel | connection = Offline }) |> Query.find [ testId "oper-desk-privs" ] |> Query.has [ Selector.disabled True ]
                        , \_ -> query { operModel | connection = Offline } |> Query.findAll [ testId "oper-desk-offline" ] |> Query.count (Expect.equal 1)
                        , \_ -> query operModel |> Query.findAll [ testId "oper-desk-offline" ] |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "the disconnect submit stays disabled without nick and reason" <|
                \_ ->
                    query (onTab OperReply.Network operModel)
                        |> Query.find [ testId "oper-desk-kill-submit" ]
                        |> Query.has [ Selector.disabled True ]
            ]
        , describe "moderation sheet"
            [ test "moderators get Moderation; members get the read-only Room safety entry" <|
                \_ ->
                    -- v3/gap-people: members reach the read-only desk.
                    Expect.all
                        [ \_ -> query (menuOpen (roomModel (Set.singleton 'o'))) |> Query.find [ testId "moderation-open" ] |> Event.simulate Event.click |> Event.expect ModerationSheetOpen
                        , \_ -> query (menuOpen (roomModel (Set.singleton 'o'))) |> Query.find [ testId "moderation-open" ] |> Query.has [ Selector.text "Moderation" ]
                        , \_ -> query (menuOpen (roomModel (Set.singleton 'v'))) |> Query.find [ testId "moderation-open" ] |> Query.has [ Selector.text "Room safety" ]
                        , \_ -> query (menuOpen (roomModel (Set.singleton 'v'))) |> Query.find [ testId "moderation-open" ] |> Event.simulate Event.click |> Event.expect ModerationSheetOpen
                        ]
                        ()
            , test "the ban desk no longer renders inline in the main column" <|
                \_ ->
                    Expect.all
                        [ \_ -> query (roomModel (Set.singleton 'o')) |> Query.findAll [ testId "ban-list-panel" ] |> Query.count (Expect.equal 0)
                        , \_ -> query (roomModel (Set.singleton 'o')) |> Query.findAll [ testId "moderation-cockpit" ] |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "opening needs a room we are in; members get the read-only desk" <|
                \_ ->
                    let
                        member =
                            Tuple.first (update ModerationSheetOpen (roomModel (Set.singleton 'v')))

                        q =
                            query member |> Query.find [ testId "moderation-cockpit" ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (Tuple.first (update ModerationSheetOpen (roomModel (Set.singleton 'o')))).moderationOpen
                        , \_ -> Expect.equal True member.moderationOpen
                        , \_ -> Expect.equal False (Tuple.first (update ModerationSheetOpen { blank | connection = Live })).moderationOpen
                        , \_ -> q |> Query.has [ Selector.text "You are a member here." ]
                        , \_ -> q |> Query.findAll [ testId "desk-readonly" ] |> Query.count (Expect.equal 1)
                        , \_ -> q |> Query.find [ testId "desk-readonly-safeguards" ] |> Query.has [ Selector.text "Moderated", Selector.text "Off" ]
                        , \_ -> q |> Query.findAll [ testId "desk-member-form" ] |> Query.count (Expect.equal 0)
                        , \_ -> q |> Query.findAll [ testId "ban-add-form" ] |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "the open sheet carries the current-room header and the desk" <|
                \_ ->
                    let
                        opened =
                            Tuple.first (update ModerationSheetOpen (roomModel (Set.singleton 'o')))

                        q =
                            query opened |> Query.find [ testId "moderation-cockpit" ]
                    in
                    Expect.all
                        [ \_ -> q |> Query.has [ Selector.text "Room safety", Selector.text "Room desk", Selector.text "You are a room moderator here." ]
                        , -- v3/rx-sheets: the room rides in the pinned head as its subtitle
                          \_ -> q |> Query.find [ Selector.class "onyx-moddesk-head" ] |> Query.find [ Selector.class "onyx-sheet-sub" ] |> Query.has [ Selector.text "#c" ]
                        , \_ -> q |> Query.findAll [ testId "ban-list-panel" ] |> Query.count (Expect.equal 1)
                        , \_ -> q |> Query.findAll [ testId "desk-invite-form" ] |> Query.count (Expect.equal 1)
                        , -- v3/gap-people: a room moderator always gets the member form
                          -- (the room role gates it, not the experience mode)
                          \_ -> q |> Query.findAll [ testId "desk-member-form" ] |> Query.count (Expect.equal 1)
                        , \_ -> q |> Query.findAll [ testId "ban-add-form" ] |> Query.count (Expect.equal 1)
                        , \_ -> q |> Query.has [ Selector.text "Server activity" ]
                        , \_ -> q |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Close room desk") ] |> Event.simulate Event.click |> Event.expect ModerationSheetClose
                        ]
                        ()
            , test "the member-action form appears for a moderator and every action the role offers is listed" <|
                \_ ->
                    let
                        opened =
                            Tuple.first (update ModerationSheetOpen (roomModel (Set.singleton 'o')))

                        q =
                            query opened |> Query.find [ testId "desk-member-form" ]
                    in
                    Expect.all
                        [ \_ -> q |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Member action") ] |> Query.findAll [ Selector.tag "option" ] |> Query.count (Expect.equal 6)
                        , \_ -> q |> Query.find [ testId "desk-member-submit" ] |> Query.has [ Selector.text "Review action" ]
                        ]
                        ()
            , test "a member action the room role does not offer never stages a review" <|
                \_ ->
                    let
                        stage modes =
                            let
                                base =
                                    roomModel modes

                                desk =
                                    base.moderationDesk
                            in
                            Tuple.first (update (ModerationDeskSubmitMember "#c") { base | moderationDesk = { desk | member = "alice", action = "kick" } })
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (stage (Set.singleton 'v')).moderationDraft
                        , \_ -> Expect.notEqual Nothing (stage (Set.singleton 'o')).moderationDraft
                        ]
                        ()
            , test "closing hides the sheet" <|
                \_ ->
                    Expect.equal False (Tuple.first (run [ ModerationSheetOpen, ModerationSheetClose ] (roomModel (Set.singleton 'o')))).moderationOpen
            ]
        ]
