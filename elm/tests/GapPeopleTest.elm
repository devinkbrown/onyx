module GapPeopleTest exposing (suite)

{-| v3/gap-people — role-gated moderation, peer accounts from the wire,
the windowed member list, webhooks for every room host, the
room-handover offer protocol, the timed-block review, Room care's
Invite / Leave and the Room settings transcript export.

Wire vectors are real Onyx Server line shapes (extended-join,
account-notify, account-tag, WHOX 354 with our token, WHOIS 330,
`CHANNEL TRANSFER` replies) fed through `App.update`.
-}

import App exposing (..)
import Dict
import Expect
import GapPeople
import Html
import Html.Attributes as Attr
import ModAuthority
import Moderation exposing (ModerationKind(..))
import PeerAccount exposing (Knowledge(..))
import RoomSettings
import RoomTransfer
import RosterWindow
import Set
import Stewardship
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import TimedBlock
import View
import Wire


feed : Model -> String -> Model
feed model raw =
    Tuple.first (update (WsLineReceived raw) model)


feedOut : Model -> String -> ( Model, List Outbound )
feedOut model raw =
    update (WsLineReceived raw) model


after : Msg -> Model -> Model
after msg model =
    Tuple.first (update msg model)


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


line : String -> Outbound
line raw =
    SendLine (raw ++ "\u{000D}\n")


parse : String -> Wire.IrcMessage
parse =
    Wire.parseIrcMessage


{-| #c with us ("me") at `ourModes`, an owner (ann), an op (oz), a
voiced member (vic) and a plain member (bo). -}
room : Set.Set Char -> Model
room ourModes =
    let
        member nick modes =
            ( String.toLower nick, { nick = nick, modes = Set.fromList modes, away = False } )
    in
    { blank
        | connection = Live
        , ourNick = "me"
        , activeChannel = Just "#c"
        , caps = [ "message-tags", "extended-join", "account-notify", "account-tag" ]
        , channels =
            Dict.singleton "#c"
                { name = "#c"
                , topic = ""
                , members =
                    Dict.fromList
                        [ ( "me", { nick = "me", modes = ourModes, away = False } )
                        , member "ann" [ 'q' ]
                        , member "oz" [ 'o' ]
                        , member "vic" [ 'v' ]
                        , member "bo" []
                        ]
                , modes = "+nt"
                , messages = []
                , lastSeen = Nothing
                , unread = 0
                , highlights = 0
                , createdAt = Nothing
                }
    }


actor : List Char -> ModAuthority.Actor
actor modes =
    { modes = Set.fromList modes, networkOperator = False }


suite : Test
suite =
    describe "v3/gap-people"
        [ accountTests
        , authorityTests
        , timedBlockTests
        , transferTests
        , rosterTests
        , webhookTests
        , roomCareTests
        , exportTests
        ]



-- PEER ACCOUNTS


accountTests : Test
accountTests =
    describe "peer accounts from the wire"
        [ test "extended-join, account-notify, account-tag, WHOX and WHOIS all fold" <|
            \_ ->
                let
                    fold raws =
                        List.foldl (\raw acc -> PeerAccount.foldMessage (parse raw) acc) PeerAccount.empty raws

                    accounts =
                        fold
                            [ ":alice!a@onyx/alice JOIN #c alice-acct :Alice Example"
                            , ":bob!b@onyx/guest JOIN #c * :Bob"
                            , ":carl!c@onyx/guest JOIN #c"
                            , "@time=2026-10-10T12:00:00.000Z;account=dana :dana!d@onyx/dana PRIVMSG #c :hi"
                            , ":irc.onyx.test 354 me 616 #c erin H@ erin"
                            , ":irc.onyx.test 354 me 616 #c fay G 0"
                            , ":irc.onyx.test 330 me gus gus-acct :is logged in as"
                            , ":bob!b@onyx/guest ACCOUNT bobby"
                            ]
                in
                Expect.equal
                    [ SignedIn "alice-acct", SignedIn "bobby", Unknown, SignedIn "dana", SignedIn "erin", Guest, SignedIn "gus-acct" ]
                    (List.map (\n -> PeerAccount.knowledge n accounts) [ "alice", "Bob", "carl", "dana", "erin", "fay", "gus" ])
        , test "ACCOUNT * logs out, NICK carries the account, QUIT forgets" <|
            \_ ->
                let
                    accounts =
                        List.foldl (\raw acc -> PeerAccount.foldMessage (parse raw) acc)
                            PeerAccount.empty
                            [ ":alice!a@h JOIN #c alice :A"
                            , ":bob!b@h JOIN #c bob :B"
                            , ":alice!a@h NICK alicia"
                            , ":bob!b@h ACCOUNT *"
                            , ":carl!c@h JOIN #c carl :C"
                            , ":carl!c@h QUIT :bye"
                            ]
                in
                Expect.equal [ Unknown, SignedIn "alice", Guest, Unknown ]
                    (List.map (\n -> PeerAccount.knowledge n accounts) [ "alice", "alicia", "bob", "carl" ])
        , test "only our WHOX token parses; malformed accounts say nothing" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (PeerAccount.parseWhoxRow (parse ":s 354 me 42 #c erin H erin"))
                    , \_ -> Expect.equal Nothing (PeerAccount.parseWhoxRow (parse ":s 354 me 616 #c erin H"))
                    , \_ ->
                        Expect.equal (Just { channel = "#c", nick = "fay", away = True, account = Nothing })
                            (PeerAccount.parseWhoxRow (parse ":s 354 me 616 #c fay G 0"))
                    , \_ ->
                        Expect.equal Unknown
                            (PeerAccount.knowledge "x" (PeerAccount.foldMessage (parse ":x!x@h JOIN #c :bad:acct :X") PeerAccount.empty))
                    ]
                    ()
        , test "our own join asks WHOX for the roster with accounts" <|
            \_ ->
                let
                    ( _, out ) =
                        feedOut { blank | connection = Live, ourNick = "me" } ":me!u@h JOIN #c"
                in
                Expect.equal True (List.member (line "WHO #c %tcnfa,616") out)
        , test "WHOX rows set away and accounts; the card drops the Guest badge" <|
            \_ ->
                let
                    folded =
                        room Set.empty
                            |> (\m -> feed m ":irc.onyx.test 354 me 616 #c bo G bo-acct")
                            |> (\m -> feed m ":irc.onyx.test 354 me 616 #c vic H 0")

                    carded nick =
                        after (UserProfileOpened { nick = nick, channel = "#c" }) folded
                in
                Expect.all
                    [ \_ -> Expect.equal (Just True) (Dict.get "#c" folded.channels |> Maybe.andThen (\c -> Dict.get "bo" c.members) |> Maybe.map .away)
                    , \_ -> Expect.equal (SignedIn "bo-acct") (peerKnowledge folded "bo")
                    , \_ -> query (carded "bo") |> Query.find [ Selector.class "onyx-member-card" ] |> Query.hasNot [ Selector.text "Guest" ]
                    , \_ -> query (carded "bo") |> Query.find [ Selector.class "onyx-member-card" ] |> Query.has [ Selector.text "Account bo-acct" ]
                    , \_ -> query (carded "vic") |> Query.find [ Selector.class "onyx-member-card" ] |> Query.has [ Selector.text "Guest" ]
                    ]
                    ()
        , test "a registered joiner reads as signed in; logging out flips to Guest; the socket close forgets" <|
            \_ ->
                let
                    joined =
                        feed (room Set.empty) ":kim!k@onyx/kim JOIN #c kim :Kim"

                    loggedOut =
                        feed joined ":kim!k@onyx/kim ACCOUNT *"

                    closed =
                        after (WsClosed { clean = False, reason = "" }) joined
                in
                Expect.all
                    [ \_ -> Expect.equal (SignedIn "kim") (peerKnowledge joined "kim")
                    , \_ -> Expect.equal Guest (peerKnowledge loggedOut "kim")
                    , \_ -> Expect.equal Unknown (peerKnowledge closed "kim")
                    ]
                    ()
        ]



-- ROLE-GATED MODERATION


authorityTests : Test
authorityTests =
    describe "moderation follows the room role"
        [ test "kinds by actor and target rank" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (ModAuthority.deskKinds (actor [ 'v' ]))
                    , \_ -> Expect.equal [ Kick, Ban, Op, Deop, Voice, Devoice ] (ModAuthority.deskKinds (actor [ 'o' ]))
                    , \_ -> Expect.equal [ Op, Voice, Kick, Ban ] (ModAuthority.cardKinds (actor [ 'o' ]) Set.empty)
                    , \_ -> Expect.equal [ Op, Devoice, Kick, Ban ] (ModAuthority.cardKinds (actor [ 'o' ]) (Set.singleton 'v'))
                    , \_ -> Expect.equal [ Deop, Voice, Kick, Ban ] (ModAuthority.cardKinds (actor [ 'o' ]) (Set.singleton 'o'))
                    , \_ -> Expect.equal [] (ModAuthority.cardKinds (actor [ 'o' ]) (Set.singleton 'q'))
                    , \_ -> Expect.equal [ Deop, Voice, Kick, Ban ] (ModAuthority.cardKinds (actor [ 'q' ]) (Set.singleton 'o'))
                    , \_ -> Expect.equal [] (ModAuthority.cardKinds (actor [ 'Q' ]) (Set.singleton 'Y'))
                    , \_ -> Expect.equal [] (ModAuthority.cardKinds (actor [ 'v' ]) Set.empty)
                    , \_ -> Expect.equal (Just "They rank above you in this room.") (ModAuthority.refusal (actor [ 'o' ]) (Set.singleton 'Q') Kick)
                    ]
                    ()
        , test "an op sees card controls with no experience level set" <|
            \_ ->
                let
                    carded nick model =
                        query (after (UserProfileOpened { nick = nick, channel = "#c" }) model)
                in
                Expect.all
                    [ \_ -> carded "bo" (room (Set.singleton 'o')) |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Moderate bo") ] |> Query.has [ Selector.text "Give moderator", Selector.text "Give speak", Selector.text "Remove", Selector.text "Block" ]
                    , \_ -> carded "vic" (room (Set.singleton 'o')) |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Moderate vic") ] |> Query.has [ Selector.text "Remove speak" ]
                    , \_ -> carded "ann" (room (Set.singleton 'o')) |> Query.findAll [ Selector.attribute (Attr.attribute "aria-label" "Moderate ann") ] |> Query.count (Expect.equal 0)
                    , \_ -> carded "bo" (room (Set.singleton 'v')) |> Query.findAll [ Selector.attribute (Attr.attribute "aria-label" "Moderate bo") ] |> Query.count (Expect.equal 0)
                    , \_ ->
                        carded "bo" (room (Set.singleton 'o'))
                            |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Remove bo from #c") ]
                            |> Event.simulate Event.click
                            |> Event.expect (ModerationPropose { kind = Kick, channel = "#c", target = Just "bo", mask = Nothing, reason = Nothing })
                    ]
                    ()
        , test "the desk refuses kinds the role cannot stage; confirm refuses a higher rank" <|
            \_ ->
                let
                    desk model =
                        let
                            d =
                                model.moderationDesk
                        in
                        { model | moderationDesk = { d | member = "bo", action = "kick" } }

                    memberStaged =
                        after (ModerationDeskSubmitMember "#c") (desk (room (Set.singleton 'v')))

                    opStaged =
                        after (ModerationDeskSubmitMember "#c") (desk (room (Set.singleton 'o')))

                    upward =
                        after (ModerationPropose { kind = Kick, channel = "#c", target = Just "ann", mask = Nothing, reason = Nothing }) (room (Set.singleton 'o'))

                    ( _, upwardOut ) =
                        update ModerationConfirm upward
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing memberStaged.moderationDraft
                    , \_ -> Expect.notEqual Nothing opStaged.moderationDraft
                    , \_ -> Expect.equal [] upwardOut
                    , \_ -> query upward |> Query.find [ Selector.class "onyx-moderation-review" ] |> Query.has [ Selector.text "They rank above you in this room." ]
                    ]
                    ()
        ]



-- TIMED BLOCK


timedBlockTests : Test
timedBlockTests =
    describe "timed block guards and review"
        [ test "match-everyone and match-you masks are refused" <|
            \_ ->
                let
                    me =
                        { nick = "kn", account = Just "kain" }

                    everyone =
                        Just "That block would match everyone. Use a more specific address."

                    yourself =
                        Just "That block would match you. Use an address that leaves you out."
                in
                Expect.equal
                    [ everyone, everyone, yourself, yourself, Nothing, Nothing, everyone, yourself, yourself, Nothing, everyone, everyone, Nothing ]
                    (List.map (TimedBlock.check me)
                        [ "*!*@*", "*", "kn!*@*", "k*", "kn!*@1.2.3.4", "spam!*@*", "$a:*", "$a:kain", "$~a:other", "$~a:kain", "$r:*", "$m:*!*@*", "$o" ]
                    )
        , test "glob matching is case-insensitive, handles * and ?, and never backtracks" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ True, True, True, True, False, False, True, False ] (List.map (\( p, v ) -> TimedBlock.globMatch p v) [ ( "KN", "kn" ), ( "k*", "kn" ), ( "*n", "kn" ), ( "k?", "kn" ), ( "k", "kn" ), ( "?", "kn" ), ( "***", "" ), ( "a*b", "a" ) ])
                    , \_ ->
                        -- 40 stars against a long non-match: exponential for a
                        -- backtracking matcher, instant here.
                        Expect.equal False (TimedBlock.globMatch (String.repeat 40 "*a" ++ "b") (String.repeat 60 "a"))
                    ]
                    ()
        , test "review guards the mask, edits drop the review, confirm re-checks authority" <|
            \_ ->
                let
                    form m mask =
                        let
                            f =
                                m.banAdd
                        in
                        { m | banAdd = { f | mask = mask, minutes = "90" } }

                    op =
                        room (Set.singleton 'o')

                    everyone =
                        after (BanAddReview "#c") (form op "*!*@*")

                    staged =
                        after (BanAddReview "#c") (form op "spam!*@*")

                    edited =
                        after (BanAddMask "spam2!*@*") staged

                    deopped =
                        feed staged ":ann!a@h MODE #c -o me"

                    ( deoppedModel, deoppedOut ) =
                        update (BanAddSubmit "#c") deopped
                in
                Expect.all
                    [ \_ -> Expect.equal False everyone.banAdd.reviewing
                    , \_ -> Expect.equal "That block would match everyone. Use a more specific address." everyone.banAdd.error
                    , \_ -> Expect.equal True staged.banAdd.reviewing
                    , \_ -> query (after ModerationSheetOpen staged) |> Query.find [ testid "ban-add-review" ] |> Query.has [ Selector.text "Block spam!*@* in #c for 90 minutes?" ]
                    , \_ -> Expect.equal False edited.banAdd.reviewing
                    , \_ -> Expect.equal [] deoppedOut
                    , \_ -> Expect.equal "You no longer have moderator permission in this room." deoppedModel.banAdd.error
                    ]
                    ()
        ]



-- ROOM HANDOVER


owned : Model
owned =
    -- Us ("me") as the owner of #c, offering to bo.
    room (Set.singleton 'q')


transferTests : Test
transferTests =
    describe "room handover offers"
        [ test "signal lines and parsing" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "@+onyx/room=#c;+onyx/room-transfer=offer TAGMSG bo\u{000D}\n" (RoomTransfer.signalLine RoomTransfer.Offer { to = "bo", channel = "#c" })
                    , \_ ->
                        Expect.equal (Just { verb = RoomTransfer.Accept, channel = "#c", from = "bo" })
                            (RoomTransfer.parseSignal "me" (parse "@+onyx/room-transfer=accept;+onyx/room=#c :bo!b@h TAGMSG me"))
                    , \_ -> Expect.equal Nothing (RoomTransfer.parseSignal "me" (parse "@+onyx/room-transfer=accept;+onyx/room=#c :bo!b@h TAGMSG someone"))
                    , \_ -> Expect.equal Nothing (RoomTransfer.parseSignal "me" (parse "@+onyx/room-transfer=accept;+onyx/room=#c :me!m@h TAGMSG me"))
                    , \_ -> Expect.equal Nothing (RoomTransfer.parseSignal "me" (parse "@+onyx/room-transfer=take;+onyx/room=#c :bo!b@h TAGMSG me"))
                    , \_ -> Expect.equal Nothing (RoomTransfer.parseSignal "me" (parse "@+onyx/room-transfer=offer;+onyx/room=lobby :bo!b@h TAGMSG me"))
                    ]
                    ()
        , test "the recipient sees an offer from the owner, in the inbox and Room care" <|
            \_ ->
                let
                    received =
                        feed (room Set.empty) "@+onyx/room-transfer=offer;+onyx/room=#c :ann!a@h TAGMSG me"

                    forged =
                        feed (room Set.empty) "@+onyx/room-transfer=offer;+onyx/room=#c :bo!b@h TAGMSG me"

                    note =
                        List.filter (\n -> n.channel == Just "#c") received.notifications |> List.head

                    opened =
                        case note of
                            Just n ->
                                after (NotificationActivated n.id) received

                            Nothing ->
                                received

                    ( accepted, acceptOut ) =
                        update (StewardAcceptTransfer "#c") opened
                in
                Expect.all
                    [ \_ -> Expect.equal (Just { channel = "#c", from = "ann", to = "me", accepted = False }) (stewardOfferFor received "#c")
                    , \_ -> Expect.equal Nothing (stewardOfferFor forged "#c")
                    , \_ -> Expect.notEqual Nothing note
                    , \_ -> Expect.equal (Just "#c") opened.stewardRoom
                    , \_ -> Expect.equal True (List.any (\t -> t.title == "ann offered you #c") received.toasts)
                    , \_ ->
                        -- Room care open on the offer: the toast no longer sits over it.
                        Expect.equal False (List.any (\t -> t.title == "ann offered you #c") opened.toasts)
                    , \_ -> query opened |> Query.find [ testid "steward-panel" ] |> Query.has [ Selector.text "Take #c?" ]
                    , \_ -> Expect.equal [ line "@+onyx/room=#c;+onyx/room-transfer=accept TAGMSG ann" ] acceptOut
                    , \_ -> Expect.equal (Just True) (Maybe.map .accepted (stewardOfferFor accepted "#c"))
                    ]
                    ()
        , test "the owner learns accept / decline; grant moves the registration when it can" <|
            \_ ->
                let
                    ( offered, offerOut ) =
                        update (StewardOfferTransfer "#c") { owned | stewardSuccessor = "bo" }

                    acceptedBy =
                        feed offered "@+onyx/room-transfer=accept;+onyx/room=#c :bo!b@h TAGMSG me"

                    declinedBy =
                        feed offered "@+onyx/room-transfer=decline;+onyx/room=#c :bo!b@h TAGMSG me"

                    registered =
                        let
                            withR =
                                { acceptedBy
                                    | channels =
                                        Dict.update "#c" (Maybe.map (\c -> { c | modes = "+ntr" })) acceptedBy.channels
                                }
                        in
                        feed withR ":irc.onyx.test 354 me 616 #c bo H bo-acct"

                    ( _, plainOut ) =
                        update (StewardGrantTransfer "#c") acceptedBy

                    ( regGranted, regOut ) =
                        update (StewardGrantTransfer "#c") registered
                in
                Expect.all
                    [ \_ -> Expect.equal [ line "@+onyx/room=#c;+onyx/room-transfer=offer TAGMSG bo" ] offerOut
                    , \_ -> Expect.equal (Just True) (Maybe.map .accepted (stewardOfferFor acceptedBy "#c"))
                    , \_ -> Expect.equal Nothing (stewardOfferFor declinedBy "#c")
                    , \_ -> Expect.equal [ line "MODE #c +q bo", line "MODE #c -q me" ] plainOut
                    , \_ -> Expect.equal [ line "MODE #c +q bo", line "MODE #c -q me", line "CHANNEL TRANSFER #c bo-acct" ] regOut
                    , \_ -> Expect.equal "The registration moves to bo-acct and bo becomes an owner now." regGranted.stewardStatus
                    ]
                    ()
        , test "without message-tags the offer fails honestly; replies and the rank grant settle it" <|
            \_ ->
                let
                    ( untagged, untaggedOut ) =
                        update (StewardOfferTransfer "#c") { owned | stewardSuccessor = "bo", caps = [] }

                    received =
                        feed (room Set.empty) "@+onyx/room-transfer=offer;+onyx/room=#c :ann!a@h TAGMSG me"

                    granted =
                        feed received ":ann!a@h MODE #c +q me"

                    failed =
                        feed owned ":irc.onyx.test FAIL CHANNEL ACCESS_DENIED :Channel TRANSFER failed"

                    moved =
                        feed owned ":irc.onyx.test NOTICE me :Channel #c founder transferred to bo-acct"
                in
                Expect.all
                    [ \_ -> Expect.equal [] untaggedOut
                    , \_ -> Expect.equal Nothing (stewardOfferFor untagged "#c")
                    , \_ -> Expect.equal True (String.contains "cannot deliver a handover offer" untagged.stewardStatus)
                    , \_ -> Expect.equal Nothing (stewardOfferFor granted "#c")
                    , \_ -> Expect.equal True (List.any (\t -> t.title == "You now own #c") granted.toasts)
                    , \_ -> Expect.equal True (List.any (\t -> t.title == "The registration did not move") failed.toasts)
                    , \_ -> Expect.equal True (List.any (\t -> t.title == "Registration moved") moved.toasts)
                    ]
                    ()
        ]



-- ROSTER WINDOW


bigRoom : Int -> Model
bigRoom n =
    let
        base =
            room Set.empty

        extra =
            List.range 1 n
                |> List.map (\i -> "p" ++ String.padLeft 4 '0' (String.fromInt i))
                |> List.map (\nick -> ( nick, { nick = nick, modes = Set.empty, away = False } ))
    in
    { base
        | channels =
            Dict.update "#c" (Maybe.map (\c -> { c | members = Dict.union c.members (Dict.fromList extra) })) base.channels
    }


rosterTests : Test
rosterTests =
    describe "windowed member list"
        [ test "a 4,000-person room paints a window with a Show more; the filter still finds everyone" <|
            \_ ->
                let
                    big =
                        bigRoom 4000

                    roster =
                        query big |> Query.find [ Selector.class "onyx-roster" ]

                    filtered =
                        query (after (MemberFilterInput "p3999") big) |> Query.find [ Selector.class "onyx-roster" ]
                in
                Expect.all
                    [ \_ -> roster |> Query.findAll [ Selector.class "onyx-member" ] |> Query.count (Expect.atMost (RosterWindow.initialRows * 4))
                    , \_ -> roster |> Query.find [ Selector.attribute (Attr.attribute "data-group" "member") ] |> Query.has [ Selector.text "4002" ]
                    , \_ -> roster |> Query.find [ testid "roster-show-more" ] |> Query.has [ Selector.text "Show 300 more" ]
                    , \_ ->
                        roster
                            |> Query.find [ testid "roster-show-more" ]
                            |> Event.simulate Event.click
                            |> Event.expect (GapPeopleMsg (GapPeople.RosterShowMore "member"))
                    , \_ -> filtered |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "View member card for p3999") ]
                    ]
                    ()
        , test "Show more widens one group, moves focus, and resets with the room" <|
            \_ ->
                let
                    big =
                        bigRoom 600

                    ( more, out ) =
                        update (GapPeopleMsg (GapPeople.RosterShowMore "member")) big

                    switched =
                        after (ChannelSelect "bo") more
                in
                Expect.all
                    [ \_ -> Expect.equal (RosterWindow.initialRows + RosterWindow.step) (RosterWindow.limitFor "member" more.rosterLimits)
                    , \_ -> Expect.equal [ PrefsFocus { id = RosterWindow.rowId "member" RosterWindow.initialRows } ] out
                    , \_ -> query more |> Query.find [ Selector.class "onyx-roster" ] |> Query.has [ Selector.id (RosterWindow.rowId "member" RosterWindow.initialRows) ]
                    , \_ -> Expect.equal Dict.empty (after (MemberFilterInput "x") more).rosterLimits
                    , \_ -> Expect.equal ( Just "bo", Dict.empty ) ( switched.activeChannel, switched.rosterLimits )
                    ]
                    ()
        ]



-- WEBHOOKS


webhookTests : Test
webhookTests =
    describe "webhooks in Room settings for every room host"
        [ test "an op of a two-person room manages webhooks; members read only" <|
            \_ ->
                let
                    small model =
                        { model
                            | channels =
                                Dict.update "#c" (Maybe.map (\c -> { c | members = Dict.filter (\k _ -> k == "me" || k == "bo") c.members })) model.channels
                        }

                    sheet model =
                        query (after (RoomSettingsMsg RoomSettings.Open) model) |> Query.find [ testid "chset-webhooks" ]

                    smallOp =
                        small (room (Set.singleton 'o'))

                    noted =
                        { smallOp | serviceLog = [ "Webhook: WEBHOOK: id=wh1 name=ci by=me", "Account: other" ] }
                in
                Expect.all
                    [ \_ -> sheet (small (room (Set.singleton 'o'))) |> Query.find [ testid "chset-webhook-create" ] |> Event.simulate Event.click |> Event.expect (WebhookCreate "#c")
                    , \_ -> sheet (small (room (Set.singleton 'o'))) |> Query.find [ testid "chset-webhook-delete" ] |> Query.has [ Selector.disabled True ]
                    , \_ -> sheet (small (room Set.empty)) |> Query.has [ Selector.text "Managed by room hosts." ]
                    , \_ -> sheet (small (room Set.empty)) |> Query.findAll [ testid "chset-webhook-create" ] |> Query.count (Expect.equal 0)
                    , \_ -> sheet noted |> Query.findAll [ testid "chset-webhook-notice" ] |> Query.count (Expect.equal 1)
                    , \_ -> Expect.equal [ line "WEBHOOK CREATE #c ci" ] (Tuple.second (update (WebhookCreate "#c") (small (room (Set.singleton 'o')))))
                    ]
                    ()
        ]



-- ROOM CARE


roomCareTests : Test
roomCareTests =
    describe "Room care: invite, leave, offers outside the band"
        [ test "Invite opens the invite sheet; Leave confirms then parts" <|
            \_ ->
                let
                    open =
                        after (StewardOpen "#c") owned

                    invited =
                        after (GapPeopleMsg (GapPeople.StewardInvite "#c")) open

                    asked =
                        after (GapPeopleMsg GapPeople.StewardAskLeave) open

                    soleOwner =
                        { asked | channels = Dict.update "#c" (Maybe.map (\c -> { c | members = Dict.remove "ann" c.members })) asked.channels }

                    ( left, leftOut ) =
                        update (GapPeopleMsg (GapPeople.StewardConfirmLeave "#c")) asked
                in
                Expect.all
                    [ \_ -> query open |> Query.find [ testid "steward-invite" ] |> Event.simulate Event.click |> Event.expect (GapPeopleMsg (GapPeople.StewardInvite "#c"))
                    , \_ -> Expect.equal Nothing invited.stewardRoom
                    , \_ -> Expect.notEqual Nothing invited.inviteShare
                    , \_ -> query asked |> Query.find [ testid "steward-panel" ] |> Query.has [ Selector.text "Leave #c?", Selector.text "You can come back unless the room is invite-only or closed." ]
                    , \_ -> query soleOwner |> Query.find [ testid "steward-panel" ] |> Query.has [ Selector.text "You are the only owner. Hand the room to someone first, or it stays without an owner." ]
                    , \_ -> Expect.equal [ line "PART #c" ] leftOut
                    , \_ -> Expect.equal Nothing left.stewardRoom
                    , \_ -> Expect.equal False (after (GapPeopleMsg GapPeople.StewardCancelLeave) asked).stewardLeaving
                    ]
                    ()
        , test "an offer to us shows the Room offer entry even outside 3–30" <|
            \_ ->
                let
                    big =
                        feed (bigRoom 40) "@+onyx/room-transfer=offer;+onyx/room=#c :ann!a@h TAGMSG me"
                in
                Expect.all
                    [ \_ -> query (bigRoom 40) |> Query.findAll [ testid "steward-open" ] |> Query.count (Expect.equal 0)
                    , \_ -> query big |> Query.find [ testid "steward-open" ] |> Query.has [ Selector.text "Room offer" ]
                    ]
                    ()
        , test "offers end when a party leaves" <|
            \_ ->
                let
                    received =
                        feed (room Set.empty) "@+onyx/room-transfer=offer;+onyx/room=#c :ann!a@h TAGMSG me"
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (stewardOfferFor (feed received ":ann!a@h PART #c :bye") "#c")
                    , \_ -> Expect.equal Nothing (stewardOfferFor (feed received ":ann!a@h QUIT :bye") "#c")
                    , \_ -> Expect.equal (Just "anna") (Maybe.map .from (stewardOfferFor (feed received ":ann!a@h NICK anna") "#c"))
                    , \_ -> Expect.equal True (Stewardship.channelKey "#C" == "#c")
                    ]
                    ()
        ]



-- TRANSCRIPT EXPORT


exportTests : Test
exportTests =
    describe "Room settings transcript export"
        [ test "the buttons export without touching the composer" <|
            \_ ->
                let
                    base =
                        room Set.empty

                    model =
                        { base | composer = "half-written" }

                    ( exported, out ) =
                        update (GapPeopleMsg (GapPeople.TranscriptExport "json")) model

                    isDownload o =
                        case o of
                            TranscriptDownload d ->
                                d.mime == "application/json"

                            _ ->
                                False
                in
                Expect.all
                    [ \_ -> query (after (RoomSettingsMsg RoomSettings.Open) model) |> Query.find [ testid "chset-export-txt" ] |> Event.simulate Event.click |> Event.expect (GapPeopleMsg (GapPeople.TranscriptExport "txt"))
                    , \_ -> Expect.equal True (List.any isDownload out)
                    , \_ -> Expect.equal "half-written" exported.composer
                    ]
                    ()
        ]
