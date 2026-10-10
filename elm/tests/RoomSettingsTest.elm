module RoomSettingsTest exposing (suite)

{-| v3/roomsettings — vectors mirroring the oracle
`ChannelSettings.test.tsx` (notifications select, roles & ACCESS:
non-op gating, LIST on open for ops only, add with expanded mask and
timeout, empty-mask error, remove), `interop/bridgeStatus.test.ts`,
`notifications/scheduledEvents.test.ts`,
`GroupControlRoomIndicator.test.tsx`, plus the finished room header
(privacy glyph, expandable topic, facepile / notify strip / safety
trigger moved out of the transcript) and the More-menu entry.
Behavior runs through `App.update`; pure helpers run directly.
-}

import App exposing (..)
import Dict
import Expect
import GroupControl
import Html
import Html.Attributes as Attr
import Ircx
import Json.Encode as Encode
import RoomSettings exposing (BridgePlatform(..), BridgeState(..))
import Set
import Switcher
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


step : Msg -> Model -> ( Model, List Outbound )
step =
    update


after : Msg -> Model -> Model
after msg model =
    Tuple.first (update msg model)


targetValue : String -> Encode.Value
targetValue v =
    Encode.object [ ( "target", Encode.object [ ( "value", Encode.string v ) ] ) ]


rsMsg : RoomSettings.Msg -> Msg
rsMsg =
    RoomSettingsMsg


line : String -> Outbound
line raw =
    SendLine (raw ++ "\u{000D}\n")


roomWith : { op : Bool, modes : String, topic : String } -> Model
roomWith o =
    { blank
        | ourNick = "me"
        , activeChannel = Just "#c"
        , channels =
            Dict.singleton "#c"
                { name = "#c"
                , topic = o.topic
                , members =
                    Dict.fromList
                        [ ( "me"
                          , { nick = "me"
                            , modes =
                                if o.op then
                                    Set.singleton 'o'

                                else
                                    Set.empty
                            , away = False
                            }
                          )
                        , ( "ann", { nick = "ann", modes = Set.singleton 'q', away = False } )
                        , ( "vic", { nick = "vic", modes = Set.singleton 'v', away = False } )
                        , ( "bo", { nick = "bo", modes = Set.empty, away = False } )
                        ]
                , modes = o.modes
                , messages = []
                , lastSeen = Nothing
                , unread = 0
                , highlights = 0
                , createdAt = Nothing
                }
    }


member : Model
member =
    roomWith { op = False, modes = "+nt", topic = "Harbour talk" }


op : Model
op =
    roomWith { op = True, modes = "+nt", topic = "Harbour talk" }


withProps : List ( String, String ) -> Model -> Model
withProps pairs model =
    let
        props =
            model.props
    in
    { model | props = { props | channelProps = Dict.singleton "#c" (Dict.fromList pairs) } }


withAccess : List Ircx.AccessEntry -> Model -> Model
withAccess entries model =
    let
        access =
            model.access
    in
    { model | access = { access | lists = Dict.singleton "#c" entries } }


opened : Model -> Model
opened =
    after (rsMsg RoomSettings.Open)


sheet : Model -> Query.Single Msg
sheet model =
    query model |> Query.find [ testid "channel-settings" ]


suite : Test
suite =
    describe "v3/roomsettings"
        [ openClose
        , gating
        , writes
        , accessTests
        , headerTests
        , bridgeVectors
        , eventVectors
        , groupVectors
        , pureHelpers
        ]


openClose : Test
openClose =
    describe "open / close"
        [ test "More menu offers Room settings; running it closes the menu and opens the sheet" <|
            \_ ->
                let
                    menuOpen =
                        { member | roomMenuOpen = True }

                    next =
                        after (rsMsg RoomSettings.Open) menuOpen
                in
                Expect.all
                    [ \_ ->
                        query menuOpen
                            |> Query.find [ testid "room-more-menu" ]
                            |> Query.find [ testid "ribbon-room-settings" ]
                            |> Event.simulate Event.click
                            |> Event.expect (rsMsg RoomSettings.Open)
                    , \_ -> Expect.equal False next.roomMenuOpen
                    , \_ -> Expect.equal (Just "#c") next.roomSettings.openFor
                    , \_ -> sheet next |> Query.has [ Selector.attribute (Attr.attribute "role" "dialog"), Selector.text "Room settings" ]
                    ]
                    ()
        , test "registered once in the Escape order; one Escape closes it" <|
            \_ ->
                let
                    m =
                        opened member
                in
                Expect.all
                    [ \_ -> Expect.equal [ "room-settings" ] (List.map Tuple.first (overlayStack m))
                    , \_ -> Expect.equal Nothing (after (ShortcutPressed Switcher.Dismiss) m).roomSettings.openFor
                    ]
                    ()
        , test "leaving the room closes the sheet" <|
            \_ ->
                Expect.equal Nothing
                    (after (ChannelSelect "#other") (opened member)).roomSettings.openFor
        , test "a DM has no settings sheet and no More entry" <|
            \_ ->
                let
                    dm =
                        { member | activeChannel = Just "ann" }
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (opened dm).roomSettings.openFor
                    , \_ -> query { dm | roomMenuOpen = True } |> Query.hasNot [ testid "ribbon-room-settings" ]
                    ]
                    ()
        , test "opening seeds drafts from live room state" <|
            \_ ->
                let
                    m =
                        opened
                            (withProps [ ( "encryption-policy", "required" ), ( "history-policy", "members" ), ( "EPHEMERAL", "86400" ) ]
                                (roomWith { op = True, modes = "+ntkl hush 25", topic = "Harbour talk" })
                            )
                in
                Expect.equal
                    ( ( m.roomSettings.topicDraft, m.roomSettings.keyDraft, m.roomSettings.limitDraft )
                    , ( m.roomSettings.encryptionDraft, m.roomSettings.historyDraft, m.roomSettings.ephemeralDraft )
                    )
                    ( ( "Harbour talk", "hush", "25" ), ( "required", "members", "86400" ) )
        ]


gating : Test
gating =
    describe "op gating"
        [ test "members get read-only rules, retention, encryption and history" <|
            \_ ->
                sheet (opened member)
                    |> Expect.all
                        [ Query.has [ testid "chset-rules-readonly", Selector.text "Topic locked · No external messages" ]
                        , Query.has [ testid "chset-retention-readonly", testid "chset-encryption-readonly", testid "chset-history-readonly" ]
                        , Query.hasNot [ testid "chset-flag-m" ]
                        , Query.has [ testid "chset-access-state", Selector.text "Member access" ]
                        ]
        , test "hosts get the switches with aria-checked from live modes" <|
            \_ ->
                sheet (opened op)
                    |> Expect.all
                        [ Query.find [ testid "chset-flag-t" ] >> Query.has [ Selector.attribute (Attr.attribute "aria-checked" "true") ]
                        , Query.find [ testid "chset-flag-m" ] >> Query.has [ Selector.attribute (Attr.attribute "aria-checked" "false") ]
                        , Query.has [ Selector.text "Host access" ]
                        ]
        , test "a +t room shows members the topic read-only" <|
            \_ -> sheet (opened member) |> Query.has [ testid "chset-topic-readonly", Selector.text "Harbour talk" ]
        , test "without +t any member may edit the topic" <|
            \_ ->
                sheet (opened (roomWith { op = False, modes = "+n", topic = "" }))
                    |> Query.has [ testid "chset-topic-input" ]
        , test "notifications are personal, not op-gated, and reflect the stored level" <|
            \_ ->
                let
                    m =
                        opened { member | channelNotify = Dict.singleton "#c" "none" }
                in
                sheet m
                    |> Query.find [ Selector.id "chset-notify" ]
                    |> Query.find [ Selector.attribute (Attr.selected True) ]
                    |> Query.has [ Selector.text "Mute" ]
        , test "changing the notifications select writes through the notify slice" <|
            \_ ->
                sheet (opened member)
                    |> Query.find [ Selector.id "chset-notify" ]
                    |> Event.simulate (Event.custom "change" (targetValue "mentions"))
                    |> Event.expect (RoomNotifyLevel { channel = "#c", level = "mentions" })
        , test "roles read as words: owners, voice; plain members counted" <|
            \_ ->
                sheet (opened member)
                    |> Query.find [ testid "chset-roles" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Owners", Selector.text "ann", Selector.text "Voice", Selector.text "vic" ]
                        , Query.has [ Selector.text "2 members without a role" ]
                        ]
        ]


writes : Test
writes =
    describe "writes"
        [ test "a member's flag toggle sends nothing" <|
            \_ -> Expect.equal [] (Tuple.second (step (rsMsg (RoomSettings.FlagToggle 'm')) (opened member)))
        , test "a host's flag toggle sends MODE +m / -t" <|
            \_ ->
                Expect.equal ( [ line "MODE #c +m" ], [ line "MODE #c -t" ] )
                    ( Tuple.second (step (rsMsg (RoomSettings.FlagToggle 'm')) (opened op))
                    , Tuple.second (step (rsMsg (RoomSettings.FlagToggle 't')) (opened op))
                    )
        , test "offline: no writes at all" <|
            \_ ->
                Expect.equal []
                    (Tuple.second (step (rsMsg (RoomSettings.FlagToggle 'm')) (opened { op | connection = Offline })))
        , test "topic save sends TOPIC with the draft; unchanged sends nothing" <|
            \_ ->
                let
                    m =
                        opened op
                in
                Expect.equal ( [ line "TOPIC #c :New harbour" ], [] )
                    ( Tuple.second (step (rsMsg RoomSettings.TopicSubmit) (after (rsMsg (RoomSettings.TopicInput "New harbour")) m))
                    , Tuple.second (step (rsMsg RoomSettings.TopicSubmit) m)
                    )
        , test "a member cannot submit a +t topic" <|
            \_ ->
                Expect.equal []
                    (Tuple.second (step (rsMsg RoomSettings.TopicSubmit) (after (rsMsg (RoomSettings.TopicInput "x")) (opened member))))
        , test "key and limit apply / remove" <|
            \_ ->
                let
                    keyed =
                        opened (roomWith { op = True, modes = "+kl hush 25", topic = "" })
                in
                Expect.equal
                    [ [ line "MODE #c +k s3cret" ], [ line "MODE #c -k hush" ], [ line "MODE #c +l 40" ], [ line "MODE #c -l" ], [] ]
                    [ Tuple.second (step (rsMsg RoomSettings.KeySubmit) (after (rsMsg (RoomSettings.KeyInput "s3cret")) keyed))
                    , Tuple.second (step (rsMsg RoomSettings.KeySubmit) (after (rsMsg (RoomSettings.KeyInput "  ")) keyed))
                    , Tuple.second (step (rsMsg RoomSettings.LimitSubmit) (after (rsMsg (RoomSettings.LimitInput "40")) keyed))
                    , Tuple.second (step (rsMsg RoomSettings.LimitSubmit) (after (rsMsg (RoomSettings.LimitInput "")) keyed))
                    , Tuple.second (step (rsMsg RoomSettings.LimitSubmit) (after (rsMsg (RoomSettings.LimitInput "-3")) keyed))
                    ]
        , test "encryption policy writes the prop optimistically and publishes PROP" <|
            \_ ->
                let
                    ( m, out ) =
                        step (rsMsg RoomSettings.EncryptionSubmit) (after (rsMsg (RoomSettings.EncryptionInput "required")) (opened op))
                in
                Expect.equal
                    ( [ line "PROP #c encryption-policy required" ], Just "required" )
                    ( out, Dict.get "#c" m.props.channelProps |> Maybe.andThen (Dict.get "encryption-policy") )
        , test "history policy and retention write their props" <|
            \_ ->
                Expect.equal
                    ( [ line "PROP #c history-policy members" ], [ line "PROP #c EPHEMERAL 3600" ] )
                    ( Tuple.second (step (rsMsg RoomSettings.HistorySubmit) (after (rsMsg (RoomSettings.HistoryInput "members")) (opened op)))
                    , Tuple.second (step (rsMsg RoomSettings.EphemeralSubmit) (after (rsMsg (RoomSettings.EphemeralInput "3600")) (opened op)))
                    )
        , test "an unknown history policy never becomes the draft" <|
            \_ -> Expect.equal "public" (after (rsMsg (RoomSettings.HistoryInput "everyone")) (opened op)).roomSettings.historyDraft
        , test "a host clears the scheduled event (PROP with an empty value)" <|
            \_ ->
                let
                    m =
                        withProps [ ( "ocean.event", "4102444800|Community call" ) ] op

                    ( next, out ) =
                        step (rsMsg RoomSettings.EventClear) m
                in
                Expect.equal ( [ line "PROP #c ocean.event :" ], Nothing )
                    ( out, Dict.get "#c" next.props.channelProps |> Maybe.andThen (Dict.get "ocean.event") )
        ]


accessTests : Test
accessTests =
    describe "roles & access (IRCX ACCESS)"
        [ test "hides the ACCESS manager from non-ops" <|
            \_ ->
                sheet (opened member)
                    |> Expect.all
                        [ Query.has [ Selector.text "Roles", Selector.text "Access entries grant founder, owner, host, or voice on join — or deny/grant masks." ]
                        , Query.hasNot [ testid "chset-access-add" ]
                        ]
        , test "does not request ACCESS LIST for non-ops" <|
            \_ -> Expect.equal False (List.member (line "ACCESS #c LIST") (Tuple.second (step (rsMsg RoomSettings.Open) member)))
        , test "lists committed entries and refreshes on open for ops" <|
            \_ ->
                let
                    seeded =
                        withAccess
                            [ { level = Ircx.Host, mask = "bob!*@*", setBy = Just "alice", duration = Just 3600 }
                            , { level = Ircx.Deny, mask = "*!*@spam.example", setBy = Nothing, duration = Nothing }
                            ]
                            op

                    ( m, out ) =
                        step (rsMsg RoomSettings.Open) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member (line "ACCESS #c LIST") out)
                    , \_ -> Expect.equal True (Set.member "#c" m.access.loading)
                    , \_ ->
                        sheet m
                            |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Room access entries") ]
                            |> Query.has [ Selector.text "bob!*@*", Selector.text "*!*@spam.example", Selector.text "1 hour · set by alice" ]
                    ]
                    ()
        , test "adds with an expanded nick mask" <|
            \_ ->
                let
                    m =
                        opened op
                            |> after (rsMsg (RoomSettings.AccessLevelInput "VOICE"))
                            |> after (rsMsg (RoomSettings.AccessMaskInput "carol"))
                in
                Expect.equal [ line "ACCESS #c ADD VOICE carol!*@*" ] (Tuple.second (step (rsMsg RoomSettings.AccessSubmit) m))
        , test "passes an optional timeout through" <|
            \_ ->
                let
                    m =
                        opened op
                            |> after (rsMsg (RoomSettings.AccessLevelInput "DENY"))
                            |> after (rsMsg (RoomSettings.AccessMaskInput "bad!*@spam.example"))
                            |> after (rsMsg (RoomSettings.AccessTimeoutInput "3600"))
                in
                Expect.equal [ line "ACCESS #c ADD DENY bad!*@spam.example 3600" ] (Tuple.second (step (rsMsg RoomSettings.AccessSubmit) m))
        , test "an empty mask surfaces a form error and skips the wire" <|
            \_ ->
                let
                    ( m, out ) =
                        step (rsMsg RoomSettings.AccessSubmit) (opened op)
                in
                Expect.all
                    [ \_ -> Expect.equal [] out
                    , \_ ->
                        sheet m
                            |> Query.find [ Selector.attribute (Attr.attribute "role" "alert") ]
                            |> Query.has [ Selector.text "Enter a name or hostmask (e.g. alice or alice!*@*)." ]
                    ]
                    ()
        , test "removes an entry through ACCESS DELETE" <|
            \_ ->
                let
                    m =
                        opened (withAccess [ { level = Ircx.Host, mask = "bob!*@*", setBy = Nothing, duration = Nothing } ] op)
                in
                sheet m
                    |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Remove HOST access for bob!*@*") ]
                    |> Event.simulate Event.click
                    |> Event.expect (rsMsg (RoomSettings.AccessRemove { level = "HOST", mask = "bob!*@*" }))
        , test "the remove intent sends ACCESS DELETE" <|
            \_ ->
                Expect.equal [ line "ACCESS #c DELETE HOST bob!*@*" ]
                    (Tuple.second (step (rsMsg (RoomSettings.AccessRemove { level = "HOST", mask = "bob!*@*" })) (opened op)))
        , test "empty list says so" <|
            \_ -> sheet (opened op) |> Query.has [ testid "chset-access-empty" ]
        ]


headerTests : Test
headerTests =
    describe "room header (3.1 completion)"
        [ test "facepile, notify strip and Invite friends sit in the header, not the transcript" <|
            \_ ->
                Expect.all
                    [ \_ -> query member |> Query.find [ testid "room-header" ] |> Query.has [ Selector.class "onyx-facepile" ]
                    , -- v3/ui-mobile-shell: alerts + invite live in the header's More menu
                      \_ -> query { member | roomMenuOpen = True } |> Query.find [ testid "room-header" ] |> Query.has [ testid "room-notify", testid "room-invite-friends" ]
                    , \_ -> query member |> Query.find [ Selector.class "onyx-thread-pane" ] |> Query.hasNot [ Selector.class "onyx-facepile" ]
                    , \_ -> query member |> Query.find [ Selector.class "onyx-thread-pane" ] |> Query.hasNot [ testid "room-notify" ]
                    ]
                    ()
        , test "privacy glyph speaks in words" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        query member
                            |> Query.find [ testid "room-privacy" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Public room") ]
                    , \_ ->
                        query (roomWith { op = False, modes = "+i", topic = "" })
                            |> Query.find [ testid "room-privacy" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Invite-only room") ]
                    ]
                    ()
        , test "a long topic expands in place, per room" <|
            \_ ->
                let
                    long =
                        roomWith { op = False, modes = "", topic = String.repeat 8 "Harbour talk " }

                    expanded =
                        after (rsMsg (RoomSettings.TopicExpandToggle "#c")) long
                in
                Expect.all
                    [ \_ ->
                        query long
                            |> Query.find [ testid "room-topic-toggle" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "false") ]
                    , \_ ->
                        query expanded
                            |> Query.find [ testid "room-topic-toggle" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "true"), Selector.text "Less" ]
                    , \_ -> query member |> Query.hasNot [ testid "room-topic-toggle" ]
                    , \_ -> Expect.equal False (RoomSettings.topicExpanded "#other" expanded.roomSettings)
                    ]
                    ()
        , test "a DM header carries the safety trigger, no privacy glyph or topic" <|
            \_ ->
                let
                    dm =
                        { member
                            | activeChannel = Just "ann"
                            , channels =
                                Dict.insert "ann"
                                    { name = "ann", topic = "", members = Dict.empty, modes = "", messages = [], lastSeen = Nothing, unread = 0, highlights = 0, createdAt = Nothing }
                                    member.channels
                        }
                in
                query dm
                    |> Query.find [ testid "room-header" ]
                    |> Expect.all
                        [ Query.has [ testid "dm-safety-verify" ]
                        , Query.hasNot [ testid "room-privacy" ]
                        , Query.hasNot [ Selector.text "No topic set" ]
                        ]
        , test "scheduled event line + Join call once live; hosts can clear" <|
            \_ ->
                let
                    m =
                        withProps [ ( "ocean.event", "1000|Community call" ) ] { op | nowMs = 1000 * 1000 + 60000 }
                in
                query m
                    |> Query.find [ testid "scheduled-event" ]
                    |> Expect.all
                        [ Query.has [ Selector.text "Community call", Selector.text "happening now", testid "scheduled-event-join", testid "scheduled-event-clear" ]
                        , Query.find [ testid "scheduled-event-clear" ] >> Event.simulate Event.click >> Event.expect (rsMsg RoomSettings.EventClear)
                        ]
        , test "an event more than an hour old is gone; members get no clear" <|
            \_ ->
                Expect.all
                    [ \_ -> query (withProps [ ( "ocean.event", "1000|Old" ) ] { member | nowMs = 1000 * 1000 + 61 * 60000 }) |> Query.hasNot [ testid "scheduled-event" ]
                    , \_ -> query (withProps [ ( "ocean.event", "4102444800|Later" ) ] { member | nowMs = 1000 }) |> Query.find [ testid "scheduled-event" ] |> Query.hasNot [ testid "scheduled-event-clear" ]
                    ]
                    ()
        , test "bridge badge only when a bridge is advertised" <|
            \_ ->
                Expect.all
                    [ \_ -> query member |> Query.hasNot [ testid "bridge-badge" ]
                    , \_ ->
                        query (withProps [ ( "ocean.bridge", "platform=discord state=up" ) ] member)
                            |> Query.find [ testid "bridge-badge" ]
                            |> Query.has [ Selector.text "Discord bridge: Up" ]
                    ]
                    ()
        , test "group-control mark only once the room has a projection" <|
            \_ ->
                Expect.all
                    [ \_ -> query member |> Query.hasNot [ testid "group-control-mark" ]
                    , \_ ->
                        query { member | accountName = Just "me", groupRooms = Dict.singleton "#c" { status = GroupControl.RoomControlApplied, epoch = Just 1 } }
                            |> Query.find [ testid "group-control-mark" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "data-state" "applied") ]
                    ]
                    ()
        , test "Integrations: full bridge badge reads No bridge; insights deep-link the ledger" <|
            \_ ->
                sheet (opened member)
                    |> Expect.all
                        [ Query.find [ testid "chset-bridge" ] >> Query.has [ Selector.text "No bridge", Selector.attribute (Attr.attribute "data-bridged" "false") ]
                        , Query.find [ testid "room-insights-open-stats" ] >> Query.has [ Selector.attribute (Attr.href "/stats/?room=%23c") ]
                        , Query.has [ testid "group-control-room-indicator" ]
                        ]
        ]


bridgeVectors : Test
bridgeVectors =
    let
        parsed raw =
            let
                s =
                    RoomSettings.parseBridgeStatus raw
            in
            ( s.bridged, ( s.platform, s.state, s.lastSeen ) )
    in
    describe "parseBridgeStatus (interop/bridgeStatus.test.ts)"
        [ test "prop name" <| \_ -> Expect.equal "ocean.bridge" RoomSettings.bridgeStatusProp
        , test "key-value payload" <|
            \_ -> Expect.equal ( True, ( Discord, BridgeUp, Just "2026-07-10T12:00:00Z" ) ) (parsed "platform=discord state=up lastSeen=2026-07-10T12:00:00Z")
        , test "JSON with compatible names, unknown ignored" <|
            \_ -> Expect.equal ( True, ( Matrix, BridgeDegraded, Nothing ) ) (parsed "{\"platform\":\"matrix\",\"health\":\"partial\",\"ignored\":\"field\"}")
        , test "IRC and down aliases" <|
            \_ -> Expect.equal ( True, ( IrcBridge, BridgeDown, Nothing ) ) (parsed "target=irc status=offline")
        , test "case, hyphen, comma, semicolon variants" <|
            \_ -> Expect.equal ( True, ( Matrix, BridgeUp, Just "2026-07-10T12:00:00Z" ) ) (parsed "Network=Matrix; status=Healthy, updated-at:2026-07-10T12:00:00Z")
        , test "drops non-string JSON values" <|
            \_ -> Expect.equal ( True, ( UnknownPlatform, BridgeDegraded, Nothing ) ) (parsed "{\"platform\":123,\"state\":true,\"lastSeen\":{\"nested\":true}}")
        , test "degraded / down aliases from JSON" <|
            \_ ->
                Expect.equal
                    [ ( True, ( Discord, BridgeDegraded, Just "now" ) ), ( True, ( Matrix, BridgeDown, Nothing ) ) ]
                    [ parsed "{\"type\":\"discord\",\"status\":\"warn\",\"seen\":\"now\"}", parsed "{\"platform\":\"matrix\",\"health\":\"failed\"}" ]
        , test "malformed non-empty fails soft" <|
            \_ -> Expect.equal ( True, ( UnknownPlatform, BridgeDegraded, Nothing ) ) (parsed "bridge status unknown")
        , test "empty means no bridge" <|
            \_ -> Expect.equal ( False, ( UnknownPlatform, BridgeDown, Nothing ) ) (parsed "  ")
        , test "copy" <|
            \_ ->
                Expect.equal
                    ( "No bridge", "Ask a room admin to set up a bridge." )
                    ( RoomSettings.bridgeLabel (RoomSettings.parseBridgeStatus ""), RoomSettings.bridgeAction (RoomSettings.parseBridgeStatus "") )
        ]


eventVectors : Test
eventVectors =
    let
        ev at =
            { at = at, title = "x" }
    in
    describe "scheduled events (notifications/scheduledEvents.test.ts)"
        [ test "parses <unix>|<title>" <|
            \_ -> Expect.equal (Just { at = 1780000000, title = "Community call" }) (RoomSettings.parseScheduledEvent "1780000000|Community call")
        , test "rejects malformed props" <|
            \_ -> Expect.equal [ Nothing, Nothing, Nothing, Nothing, Nothing ] (List.map RoomSettings.parseScheduledEvent [ "", "notime|", "|title", "abc|title", "123" ])
        , test "rejects out-of-range timestamps" <|
            \_ ->
                Expect.equal ( True, Nothing, Nothing )
                    ( RoomSettings.isValidScheduledTimestamp 8640000000000
                    , RoomSettings.parseScheduledEvent "8640000000001|too late"
                    , RoomSettings.parseScheduledEvent "1e308|overflow"
                    )
        , test "visible until one hour after start" <|
            \_ ->
                Expect.equal ( True, False )
                    ( RoomSettings.eventVisible (ev 2000) (2000 * 1000 + 59 * 60 * 1000)
                    , RoomSettings.eventVisible (ev 2000) (2000 * 1000 + 61 * 60 * 1000)
                    )
        , test "countdown labels" <|
            \_ ->
                Expect.equal [ "in 1 min", "in 3h", "in 3d", "in 1 min", "in 1 min", "happening now", "" ]
                    [ RoomSettings.eventCountdown (ev 70) 10000
                    , RoomSettings.eventCountdown (ev (3 * 60 * 60)) 0
                    , RoomSettings.eventCountdown (ev (3 * 24 * 60 * 60)) 0
                    , RoomSettings.eventCountdown (ev 100) 80000
                    , RoomSettings.eventCountdown (ev 100) 99999
                    , RoomSettings.eventCountdown (ev 100) 100000
                    , RoomSettings.eventCountdown (ev 1.0e308) 0
                    ]
        ]


groupVectors : Test
groupVectors =
    let
        mark status =
            RoomSettings.groupMark { isChannel = True, authenticated = True, status = status }
                |> Maybe.map (\m -> ( m.state, m.detail ))
    in
    describe "group-control mark (GroupControlRoomIndicator.test.tsx)"
        [ test "unavailable without a projection" <|
            \_ -> Expect.equal (Just ( "unavailable", "Room controls unavailable" )) (mark Nothing)
        , test "applied keeps message protection inactive" <|
            \_ ->
                Expect.equal
                    (Just ( "applied", "Room controls applied; message protection remains inactive" ))
                    (mark (Just GroupControl.RoomControlApplied))
        , test "room statuses map without internals" <|
            \_ ->
                Expect.equal
                    [ Just ( "locked", "Room controls locked" ), Just ( "pending", "Room controls pending" ), Just ( "recovery-required", "Room controls need recovery" ) ]
                    [ mark (Just GroupControl.RoomLocked), mark (Just GroupControl.RoomDirectoryPending), mark (Just GroupControl.RoomRejected) ]
        , test "fails closed signed out; never for non-channels" <|
            \_ ->
                Expect.equal
                    ( Just "Sign in to inspect room controls", Nothing )
                    ( RoomSettings.groupMark { isChannel = True, authenticated = False, status = Just GroupControl.RoomControlApplied } |> Maybe.map .detail
                    , RoomSettings.groupMark { isChannel = False, authenticated = True, status = Nothing }
                    )
        , test "protection label never claims active" <|
            \_ ->
                Expect.equal (Just "Message protection: not active")
                    (RoomSettings.groupMark { isChannel = True, authenticated = True, status = Just GroupControl.RoomControlApplied } |> Maybe.map .protection)
        ]


pureHelpers : Test
pureHelpers =
    let
        room modes props =
            { name = "#c", topic = "", modes = modes, props = Dict.fromList props }
    in
    describe "pure helpers"
        [ test "formatEphemeral" <|
            \_ ->
                Expect.equal [ "Full history", "1 day", "2 days", "2 hours", "5 minutes", "61 seconds" ]
                    (List.map RoomSettings.formatEphemeral [ Nothing, Just 86400, Just 172800, Just 7200, Just 300, Just 61 ])
        , test "ephemeral prop bounds (60s..30d, either case)" <|
            \_ ->
                Expect.equal [ Just 3600, Just 120, Nothing, Nothing ]
                    (List.map RoomSettings.ephemeralSecondsOf
                        [ Dict.singleton "EPHEMERAL" "3600", Dict.singleton "ephemeral" "120", Dict.singleton "EPHEMERAL" "30", Dict.singleton "EPHEMERAL" "9999999" ]
                    )
        , test "modeSummary" <|
            \_ ->
                Expect.equal [ "No special room rules", "Moderated · Invite only · Join key · Member limit 9" ]
                    [ RoomSettings.modeSummary (room "" []), RoomSettings.modeSummary (room "+mikl k 9" []) ]
        , test "privacy words" <|
            \_ ->
                Expect.equal [ "public", "secret", "key", "encrypted" ]
                    (List.map (RoomSettings.privacyOf >> .key)
                        [ room "+nt" [], room "+s" [], room "+k pw" [], room "" [ ( "encryption-policy", "required" ) ] ]
                    )
        , test "encryption and history policies parse fail-closed" <|
            \_ ->
                Expect.equal ( "off", "public" )
                    ( RoomSettings.encryptionPolicyOf (Dict.singleton "encryption-policy" "bogus")
                    , RoomSettings.historyPolicyOf (Dict.singleton "history-policy" "anyone")
                    )
        , test "insight counters" <|
            \_ ->
                Expect.equal [ "999", "1.2k", "12k", "1.5M", "+5", "−1.2k", "0", "07:00 UTC", "—" ]
                    [ RoomSettings.insightCount 999
                    , RoomSettings.insightCount 1234
                    , RoomSettings.insightCount 12345
                    , RoomSettings.insightCount 1500000
                    , RoomSettings.insightSigned 5
                    , RoomSettings.insightSigned -1234
                    , RoomSettings.insightSigned 0
                    , RoomSettings.insightHour (Just 7)
                    , RoomSettings.insightHour Nothing
                    ]
        ]
